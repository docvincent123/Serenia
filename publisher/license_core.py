"""Publisher-only Ed25519 signing. Contains no embedded signing secret."""
import base64
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

CATALOG=json.loads(Path(__file__).with_name('modules.json').read_text(encoding='utf-8'))
MODULES={m['id']:m for m in CATALOG}
LICENSE_PRESETS = {
    "Реєстратура": ("appointments", "roster"),
    "Психологічна служба": ("clinical", "reports", "messages", "roster"),
    "Реабілітація": ("rehabilitation", "reports", "messages", "roster"),
}

def resolve_modules(selected):
    requested=set(selected)
    if requested-MODULES.keys():raise ValueError('Невідомий модуль')
    requested.update(m['id'] for m in CATALOG if m['core'])
    while True:
        expanded=requested | {dependency for name in requested for dependency in MODULES[name]['depends']}
        if expanded==requested:return sorted(requested)
        requested=expanded

def read_center_request(path):
    with Path(path).open("rb") as source:
        content = source.read(65537)
    if len(content) > 65536:
        raise ValueError("Файл запиту завеликий")
    request = json.loads(content)
    if (not isinstance(request, dict) or request.get("format") != "lemvori.center-request"
            or type(request.get("version")) is not int or request["version"] != 1):
        raise ValueError("Це не запит центру Lemvori Care")
    server_id = request.get("server_id")
    if not isinstance(server_id, str) or not re.fullmatch(r"[a-f0-9]{64}", server_id):
        raise ValueError("Некоректний ID сервера")
    center = request.get("center", "")
    if not isinstance(center, str) or len(center.encode("utf-8")) > 200 or "\0" in center:
        raise ValueError("Некоректна назва закладу")
    wanted = request.get("requested_modules", [])
    if not isinstance(wanted, list) or len(wanted) > len(CATALOG) or not all(isinstance(item, str) for item in wanted):
        raise ValueError("Некоректний перелік модулів")
    return server_id, center.strip(), resolve_modules(wanted)


def load_signing_key(private_pem, password):
    encrypted = private_pem.lstrip().startswith(b"-----BEGIN ENCRYPTED PRIVATE KEY-----")
    if encrypted and not password:
        raise ValueError("Введіть пароль приватного ключа видавця")
    try:
        key = serialization.load_pem_private_key(private_pem, password=password.encode() if encrypted else None)
    except (ValueError, TypeError) as error:
        raise ValueError("Не вдалося прочитати приватний PEM. Перевірте ключ та його пароль.") from error
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Потрібен приватний ключ Ed25519")
    return key


def publisher_public_key(private_pem, password):
    key = load_signing_key(private_pem, password).public_key()
    public = key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    der = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return public, hashlib.sha256(der).hexdigest()


def create_keys(password):
    if len(password)<12:raise ValueError('Захистіть приватний ключ паролем щонайменше з 12 символів')
    key=Ed25519PrivateKey.generate()
    private=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.BestAvailableEncryption(password.encode()))
    public=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
    return private,public

def expiry_timestamp(value):
    timestamp=dt.datetime.fromisoformat(value)
    if timestamp.tzinfo is None:raise ValueError('Укажіть часовий пояс строку дії')
    if timestamp<=dt.datetime.now(dt.timezone.utc):raise ValueError('Строк дії має бути в майбутньому')
    return int(timestamp.timestamp())

def calendar_expiry(value):
    if not value.strip():return 0
    last_day=dt.date.fromisoformat(value.strip())
    end=dt.datetime.combine(last_day+dt.timedelta(days=1),dt.time(),ZoneInfo('Europe/Kyiv'))
    return int(end.timestamp())

def issue_license(private_pem,password,*,server_id,center,modules,max_users=40,max_devices=40,expires_at=0,support_until=0,center_id=None,workflow=None):
    if not re.fullmatch('[a-f0-9]{64}',server_id):raise ValueError('Ідентифікатор сервера: 64 символи 0–9, a–f')
    if not center.strip() or len(center.encode())>200 or "\0" in center:raise ValueError('Укажіть назву центру до 200 байтів')
    if not 1<=int(max_users)<=10000 or not 1<=int(max_devices)<=10000:raise ValueError('Ліміти: 1–10000')
    if expires_at and expires_at<=int(dt.datetime.now(dt.timezone.utc).timestamp()):raise ValueError('Ліцензія вже завершилася')
    key=load_signing_key(private_pem,password)
    enabled=resolve_modules(modules)
    grant=dict(version=2,server_id=server_id,center_id=center_id or str(uuid.uuid4()),center=center.strip(),
        license_id=str(uuid.uuid4()),issued_at=int(dt.datetime.now(dt.timezone.utc).timestamp()),expires_at=int(expires_at),
        perpetual=not bool(expires_at),support_until=int(support_until),max_users=int(max_users),max_devices=int(max_devices),
        modules=enabled,module_versions={name:MODULES[name]['version'] for name in enabled})
    if workflow:
        opening=workflow.get('opening_time','');closing=workflow.get('closing_time','');days=workflow.get('working_days','')
        if not all(re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',value) for value in [opening,closing]) or opening>=closing:raise ValueError('Перевірте години роботи центру')
        if not re.fullmatch('[1-7]{1,7}',days) or len(set(days))!=len(days):raise ValueError('Робочі дні: унікальні цифри 1–7 без пробілів')
        if int(workflow['slot_step_minutes']) not in [15,30,60] or not 15<=int(workflow['default_duration_minutes'])<=240 or not 1<=int(workflow['session_hours'])<=24:raise ValueError('Перевірте крок запису, тривалість і час сеансу')
        minutes=lambda time:int(time[:2])*60+int(time[3:])
        if int(workflow['default_duration_minutes'])>minutes(closing)-minutes(opening):raise ValueError('Тривалість прийому більша за робочий день')
        if set(workflow)!={'opening_time','closing_time','working_days','slot_step_minutes','default_duration_minutes','session_hours'}:raise ValueError('Непідтримувані правила центру')
        grant['workflow']=workflow
    payload=json.dumps(grant,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()
    envelope=dict(format='quremed.solvia.license',payload=base64.b64encode(payload).decode(),signature=base64.b64encode(key.sign(payload)).decode())
    return envelope,grant

def issue_first_admin(private_pem, key_password, *, server_id, name, login, password):
    if not re.fullmatch(r"[a-f0-9]{64}", server_id):
        raise ValueError("Перевірте ID сервера")
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", login):
        raise ValueError("Логін має містити 3–64 латинські літери, цифри або ._-")
    if not name.strip() or len(name.encode()) > 150 or "\0" in name:
        raise ValueError("Вкажіть ім’я адміністратора")
    secret = password.encode()
    if not 12 <= len(secret) <= 128 or any(char in password for char in "\r\n\0"):
        raise ValueError("Пароль адміністратора має містити 12–128 байтів")
    key = load_signing_key(private_pem, key_password)
    salt = secrets.token_hex(32)
    verifier = hashlib.pbkdf2_hmac("sha256", secret, salt.encode("ascii"), 600_000).hex()
    data = {"version": 1, "server_id": server_id, "name": name.strip(), "login": login,
            "password_hash": salt + ":" + verifier, "expires_at": int(dt.datetime.now(dt.timezone.utc).timestamp()) + 86400}
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    return {"format": "lemvori.admin-setup", "payload": base64.b64encode(payload).decode(),
            "signature": base64.b64encode(key.sign(payload)).decode()}

def write_new(path,data,private=False):
    path=Path(path)
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL
    descriptor=os.open(path,flags,0o600 if private else 0o644)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise


def validate_private_key_file(path):
    """Check the PEM header before trying to unlock a publisher key."""
    path = Path(path).expanduser()
    if not path.is_file():
        raise ValueError("Виберіть наявний приватний PEM або створіть пару ключів")
    with path.open("rb") as source:
        content = source.read(16385)
    if len(content) > 16384:
        raise ValueError("Завеликий PEM-файл приватного ключа")
    header = content.partition(b"\n")[0].strip()
    if header not in (b"-----BEGIN ENCRYPTED PRIVATE KEY-----", b"-----BEGIN PRIVATE KEY-----"):
        raise ValueError("Потрібен lemvori-publisher-private.pem")
    return path
