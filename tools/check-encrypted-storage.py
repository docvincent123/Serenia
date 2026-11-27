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
    try:
        slaves=list((device/'slaves').iterdir())
        return bool(slaves) and all(encrypted_device(slave,seen.copy()) for slave in slaves)
    except OSError:return False

def inspect(path):
    resolved=pathlib.Path(path).resolve(strict=True);stat=resolved.stat()
    encrypted=encrypted_device(pathlib.Path('/sys/dev/block')/f'{os.major(stat.st_dev)}:{os.minor(stat.st_dev)}')
    return dict(path=str(resolved),state='luks_verified' if encrypted else 'unverified',encrypted=encrypted,
        note='An unverified result is not proof of plaintext; verify managed or remote storage separately.')
if __name__=='__main__':
    args=sys.argv[1:]
    required=bool(args and args[0]=='--require-luks')
    paths=args[1:] if required else args
    if not paths:raise SystemExit('Usage: check-encrypted-storage.py [--require-luks] PATH ...')
    results=[inspect(path) for path in paths]
    print(json.dumps(results,ensure_ascii=False,indent=2))
    if required and any(not result['encrypted'] for result in results):
        raise SystemExit('A Lemvori Care data or key path has no verified LUKS volume.')
