"""Read-only check of a Linux path's device chain. Never asserts cloud-disk encryption."""
import json,os,pathlib,sys

def encrypted_device(device,seen=None):
    seen=set() if seen is None else seen
    device=pathlib.Path(device).resolve()
    if device in seen or len(seen)>32:return False
    seen.add(device)
    try:
        if (device/'dm'/'uuid').read_text().strip().startswith('CRYPT-LUKS'):return True
    except OSError:pass
    try:return any(encrypted_device(slave,seen) for slave in (device/'slaves').iterdir())
    except OSError:return False

def inspect(path):
    resolved=pathlib.Path(path).resolve(strict=True);stat=resolved.stat()
    encrypted=encrypted_device(pathlib.Path('/sys/dev/block')/f'{os.major(stat.st_dev)}:{os.minor(stat.st_dev)}')
    return dict(path=str(resolved),state='luks_verified' if encrypted else 'unverified',encrypted=encrypted,
        note='An unverified result is not proof of plaintext; verify managed or remote storage separately.')
if __name__=='__main__':
    if len(sys.argv)<2:raise SystemExit('Usage: python3 check-encrypted-storage.py DATA_DIRECTORY [DOCUMENTS_DIRECTORY BACKUPS_DIRECTORY]')
    print(json.dumps([inspect(path) for path in sys.argv[1:]],ensure_ascii=False,indent=2))
