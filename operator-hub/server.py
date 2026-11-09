#!/usr/bin/env python3
"""LemvoriLab company registry. Metadata only: never accept or store patient data.

Deploy behind a TLS-terminating reverse proxy, bound to 127.0.0.1. This is NOT
a clinical API, a remote shell, or a storage service for medical documents.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("HUB_DB_PATH", "/var/lib/lemvori-hub/registry.sqlite3"))
ORIGIN = os.environ.get("HUB_PUBLIC_ORIGIN", "")
MAX_JSON = 4096
SESSION_AGE = 8 * 3600
FAILED = {}
SCHEMA = """
CREATE TABLE IF NOT EXISTS operators(
 id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, operator_id INTEGER NOT NULL REFERENCES operators(id),
 csrf TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS centers(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '',
 server_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active'
   CHECK(status IN ('active','paused')),
 token_hash TEXT NOT NULL UNIQUE, version TEXT NOT NULL DEFAULT '',
 backup_status TEXT NOT NULL DEFAULT 'unknown',
 last_backup_at TEXT NOT NULL DEFAULT '',last_seen TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_audit(
 id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,
 center_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_centers_seen ON centers(last_seen);
"""

def utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def validate_server_id(value):
    return isinstance(value,str) and re.fullmatch(r'[0-9a-f]{64}',value) is not None

def validate_name(value,limit=160):
    return isinstance(value,str) and 0<len(value.strip()) and len(value.encode('utf-8'))<=limit and not any(ord(c)<32 for c in value)

def password_hash(password, salt=None):
    if salt is None: salt=secrets.token_bytes(16)
    key=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),salt,650000)
    return base64.b64encode(salt).decode()+':'+base64.b64encode(key).decode()

def password_valid(password,stored):
    try:
        salt,expected=stored.split(':',1)
        return hmac.compare_digest(password_hash(password,base64.b64decode(salt)),stored)
    except (ValueError,TypeError):
        return False

def secret_hash(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def connect():
    db=sqlite3.connect(str(DB_PATH),timeout=10)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=10000')
    return db

def bootstrap():
    if not ORIGIN.startswith('https://') or urlsplit(ORIGIN).path not in ('','/'):
        raise RuntimeError('Set HUB_PUBLIC_ORIGIN to a public HTTPS origin, without a path')
    DB_PATH.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(DB_PATH.parent,0o700)
    created=not DB_PATH.exists()
    db=connect()
    with db:
        db.executescript(SCHEMA)
        if not db.execute('SELECT 1 FROM operators LIMIT 1').fetchone():
            user=os.environ.get('HUB_ADMIN_USER','')
            pw=os.environ.get('HUB_ADMIN_PASSWORD','')
            if not re.fullmatch(r'[A-Za-z0-9_.-]{3,70}',user) or len(pw)<16:
                raise RuntimeError('Bootstrap needs HUB_ADMIN_USER and HUB_ADMIN_PASSWORD (16+ chars)')
            db.execute('INSERT INTO operators(username,password_hash) VALUES(?,?)',(user,password_hash(pw)))
    db.close()
    os.chmod(DB_PATH,0o600)
    if created: print('Company registry initialized. Remove bootstrap password from environment before normal use.')

def add_center(db,name,city,server_id,actor):
    if not validate_name(name) or not validate_server_id(server_id) or not isinstance(city,str) or len(city.encode())>100:
        raise ValueError('Некоректна назва, місто або ID сервера')
    center_id=str(uuid.uuid4())
    token=secrets.token_urlsafe(32)
    with db:
        db.execute('INSERT INTO centers(id,name,city,server_id,token_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                   (center_id,name.strip(),city.strip(),server_id,secret_hash(token),utc(),utc()))
        db.execute('INSERT INTO operator_audit(actor,action,center_id,created_at) VALUES(?,?,?,?)',
                   (actor,'register_center',center_id,utc()))
    return dict(id=center_id,center_token=token)

def update_heartbeat(db,token,body):
    if not isinstance(token,str) or len(token)>128 or not isinstance(body,dict):
        return False
    row=db.execute('SELECT id,server_id FROM centers WHERE token_hash=?',(secret_hash(token),)).fetchone()
    if not row or body.get('server_id')!=row['server_id']:
        return False
    version=body.get('version','')
    status=body.get('backup_status','unknown')
    backup=body.get('last_backup_at','')
    if not isinstance(version,str) or len(version)>80 or not re.fullmatch(r'[A-Za-z0-9_.+~-]*',version):
        return False
    if status not in ('ok','failed','not_configured','unknown'):
        return False
    if not isinstance(backup,str) or (backup and not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ',backup)):
        return False
    with db:
        db.execute('UPDATE centers SET version=?,backup_status=?,last_backup_at=?,last_seen=?,updated_at=? WHERE id=?',
                   (version,status,backup,utc(),utc(),row['id']))
    return True

class Handler(BaseHTTPRequestHandler):
    server_version='LemvoriOperatorHub/0.1'
    sys_version=''

    def log_message(self,format,*args):
        # No tokens, patient records, or request payloads in HTTP access logs.
        print('operator-hub',self.client_address[0],self.command,urlsplit(self.path).path,flush=True)

    def respond(self,status,data,extra=None):
        payload=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        for k,v in (extra or {}).items():self.send_header(k,v)
        self.end_headers()
        self.wfile.write(payload)

    def serve_static(self,path):
        mapping={'/':('public/index.html','text/html; charset=utf-8'),
                 '/app.css':('public/app.css','text/css; charset=utf-8'),
                 '/app.js':('public/app.js','application/javascript; charset=utf-8')}
        if path not in mapping:return self.respond(404,{'error':'Not found'})
        file,kind=mapping[path]
        payload=(HERE/file).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self';connect-src 'self';form-action 'self';base-uri 'none';frame-ancestors 'none'")
        self.send_header('Referrer-Policy','no-referrer')
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        if self.headers.get_content_type()!='application/json':raise ValueError('Потрібен Content-Type: application/json')
        length=self.headers.get('Content-Length','')
        if not length.isdecimal() or int(length)>MAX_JSON:raise ValueError('Некоректний розмір запиту')
        value=json.loads(self.rfile.read(int(length)))
        if not isinstance(value,dict):raise ValueError('Очікується JSON-об’єкт')
        return value

    def operator(self,db):
        cookie=SimpleCookie()
        try:cookie.load(self.headers.get('Cookie',''))
        except Exception:return None
        raw=cookie.get('lemvori_session')
        if not raw:return None
        record=db.execute('SELECT o.username,s.csrf FROM sessions s JOIN operators o ON o.id=s.operator_id WHERE s.token_hash=? AND s.expires>?',
                          (secret_hash(raw.value),int(time.time()))).fetchone()
        return dict(record) if record else None

    def origin_ok(self):
        # The HTTPS proxy must preserve Origin. No wildcard CORS is used.
        return self.headers.get('Origin','')==ORIGIN

    def do_GET(self):
        path=urlsplit(self.path).path
        if not path.startswith('/api/'):return self.serve_static(path)
        db=connect()
        try:
            user=self.operator(db)
            if path=='/api/session':return self.respond(200,{'authenticated':bool(user),'operator':user['username'] if user else '', 'csrf':user['csrf'] if user else ''})
            if not user:return self.respond(401,{'error':'Потрібен вхід до компанійного кабінету'})
            if path=='/api/centers':
                items=[dict(x) for x in db.execute('SELECT id,name,city,server_id,status,version,backup_status,last_backup_at,last_seen,created_at FROM centers ORDER BY name')]
                return self.respond(200,{'centers':items})
            return self.respond(404,{'error':'Not found'})
        finally:db.close()

    def do_POST(self):self.write_request()
    def do_PATCH(self):self.write_request()

    def write_request(self):
        path=urlsplit(self.path).path
        db=connect()
        try:
            body=self.read_json()
            if path=='/api/heartbeat' and self.command=='POST':
                header=self.headers.get('Authorization','')
                if not header.startswith('Bearer ') or not update_heartbeat(db,header[7:],body):
                    return self.respond(401,{'error':'Невідома інсталяція'})
                return self.respond(200,{'ok':True})
            if not self.origin_ok():return self.respond(403,{'error':'Походження запиту не підтверджено'})
            if path=='/api/login' and self.command=='POST':
                ip=self.client_address[0]
                history=[stamp for stamp in FAILED.get(ip,[]) if time.time()-stamp<300]
                if len(history)>=10:return self.respond(429,{'error':'Забагато спроб входу'})
                name=body.get('username');password=body.get('password')
                if not isinstance(name,str) or not isinstance(password,str) or len(password)>256:
                    return self.respond(400,{'error':'Некоректні облікові дані'})
                row=db.execute('SELECT id,password_hash FROM operators WHERE username=?',(name,)).fetchone()
                dummy=password_hash('a-placeholder',b'0123456789abcdef')
                if not hmac.compare_digest(password_hash(password,base64.b64decode((row['password_hash'] if row else dummy).split(':')[0])),
                                           row['password_hash'] if row else dummy):
                    FAILED[ip]=history+[time.time()]
                    return self.respond(401,{'error':'Неправильний логін або пароль'})
                FAILED.pop(ip,None)
                session=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(24)
                with db:
                    db.execute('DELETE FROM sessions WHERE expires<?',(int(time.time()),))
                    db.execute('INSERT INTO sessions(token_hash,operator_id,csrf,expires) VALUES(?,?,?,?)',
                               (secret_hash(session),row['id'],csrf,int(time.time())+SESSION_AGE))
                return self.respond(200,{'ok':True,'csrf':csrf},{'Set-Cookie':f'lemvori_session={session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age={SESSION_AGE}'})
            user=self.operator(db)
            if not user:return self.respond(401,{'error':'Сеанс завершився'})
            if not hmac.compare_digest(self.headers.get('X-CSRF',''),user['csrf']):return self.respond(403,{'error':'CSRF-перевірка не пройдена'})
            if path=='/api/logout' and self.command=='POST':
                cookie=SimpleCookie();cookie.load(self.headers.get('Cookie',''))
                raw=cookie.get('lemvori_session')
                if raw:
                    with db:db.execute('DELETE FROM sessions WHERE token_hash=?',(secret_hash(raw.value),))
                return self.respond(200,{'ok':True},{'Set-Cookie':'lemvori_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'})
            if path=='/api/centers' and self.command=='POST':
                try:
                    created=add_center(db,body.get('name'),body.get('city',''),body.get('server_id'),user['username'])
                except sqlite3.IntegrityError:return self.respond(409,{'error':'Центр із цим сервером уже зареєстрований'})
                return self.respond(201,created)
            match=re.fullmatch(r'/api/centers/([0-9a-f-]{36})',path)
            if match and self.command=='PATCH':
                status=body.get('status')
                if status not in ('active','paused'):return self.respond(400,{'error':'Некоректний статус'})
                with db:
                    cursor=db.execute('UPDATE centers SET status=?,updated_at=? WHERE id=?',(status,utc(),match.group(1)))
                    if not cursor.rowcount:return self.respond(404,{'error':'Центр не знайдено'})
                    db.execute('INSERT INTO operator_audit(actor,action,center_id,created_at) VALUES(?,?,?,?)',
                               (user['username'],'status_'+status,match.group(1),utc()))
                return self.respond(200,{'ok':True,'note':'Статус компанійного обліку; не зупиняє медичний сервер'})
            match=re.fullmatch(r'/api/centers/([0-9a-f-]{36})/rotate-token',path)
            if match and self.command=='POST':
                new_token=secrets.token_urlsafe(32)
                with db:
                    cursor=db.execute('UPDATE centers SET token_hash=?,updated_at=? WHERE id=?',(secret_hash(new_token),utc(),match.group(1)))
                    if not cursor.rowcount:return self.respond(404,{'error':'Центр не знайдено'})
                    db.execute('INSERT INTO operator_audit(actor,action,center_id,created_at) VALUES(?,?,?,?)',
                               (user['username'],'rotate_heartbeat_token',match.group(1),utc()))
                return self.respond(200,{'center_token':new_token})
            return self.respond(404,{'error':'Not found'})
        except (ValueError,json.JSONDecodeError):
            return self.respond(400,{'error':'Некоректні дані запиту'})
        except sqlite3.DatabaseError:
            return self.respond(503,{'error':'Помилка внутрішнього сховища'})
        finally:db.close()

if __name__=='__main__':
    bootstrap()
    if '--init-only' in os.sys.argv[1:]:
        print('Operator database initialized. Exit without opening a listener.')
        raise SystemExit(0)
    port=int(os.environ.get('HUB_PORT','8769'))
    print(f'LemvoriLab metadata hub bound to 127.0.0.1:{port}. HTTPS proxy required.',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
