"""Publisher-only Ed25519 signing. Contains no embedded signing secret."""
import base64
import datetime as dt
import json
import os
import re
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

CATALOG=json.loads(Path(__file__).with_name('modules.json').read_text(encoding='utf-8'))
MODULES={m['id']:m for m in CATALOG}

def resolve_modules(selected):
    requested=set(selected)
    if requested-MODULES.keys():raise ValueError('Невідомий модуль')
    requested.update(m['id'] for m in CATALOG if m['core'])
    while True:
        expanded=requested | {dependency for name in requested for dependency in MODULES[name]['depends']}
        if expanded==requested:return sorted(requested)
        requested=expanded

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
    if not center.strip() or len(center.encode())>200:raise ValueError('Укажіть назву центру до 200 байтів')
    if not 1<=int(max_users)<=10000 or not 1<=int(max_devices)<=10000:raise ValueError('Ліміти: 1–10000')
    if expires_at and expires_at<=int(dt.datetime.now(dt.timezone.utc).timestamp()):raise ValueError('Ліцензія вже завершилася')
    key=serialization.load_pem_private_key(private_pem,password=password.encode())
    if not isinstance(key,Ed25519PrivateKey):raise ValueError('Потрібен приватний ключ Ed25519')
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

def write_new(path,data,private=False):
    path=Path(path)
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL
    descriptor=os.open(path,flags,0o600 if private else 0o644)
    try:
        with os.fdopen(descriptor,'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise

def validate_private_key_file(path):
    """Check a PEM file is a private signing key, not a directory/public key."""
    path = Path(path).expanduser()
    if not path.is_file():
        raise ValueError("Не знайдено приватний PEM-ключ. Виберіть існуючий файл або створіть нову пару ключів.")
    if path.stat().st_size > 16384:
        raise ValueError("Завеликий PEM-файл приватного ключа")
    with path.open("rb") as source:
        header = source.readline().strip()
    if header not in (b"-----BEGIN ENCRYPTED PRIVATE KEY-----", b"-----BEGIN PRIVATE KEY-----"):
        raise ValueError("Це не приватний ключ! Потрібен lemvori-publisher-private.pem, не public.pem і не ліцензія.")
    return path
