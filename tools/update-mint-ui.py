#!/usr/bin/env python3
"""Update the UI of an existing SOLVIA 3.0 Linux install; never install a server."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import uuid


def apply(package, prefix=Path('/')):
    package, prefix = Path(package).resolve(), Path(prefix).resolve()
    manifest = json.loads((package/'manifest.json').read_text())
    if manifest['requires_version'] != '3.0.0':
        raise ValueError('Непідтримувана версія пакета.')
    for name, expected in manifest['sha256'].items():
        file = (package/name).resolve()
        if not file.is_relative_to(package) or not file.is_file():
            raise ValueError('Некоректний файл пакета: '+name)
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError('Пошкоджено файл пакета: '+name)
    if not (package/'ui/index.html').is_file():
        raise ValueError('Пакет не містить готового інтерфейсу.')
    bases = [prefix/'opt/solvia', prefix/'usr/local/lib/solvia']
    targets = [base for base in bases if (base/'ui/index.html').is_file()]
    if not targets:
        raise ValueError('Не знайдено встановленої SOLVIA. Цей пакет не є встановлювачем сервера.')
    wrapper = prefix/'usr/local/lib/solvia/solvia-linux-app.py'
    version_file = prefix/'opt/solvia/VERSION'
    version_ok = (version_file.is_file() and version_file.read_text().strip() == '3.0.0')
    if wrapper.is_file():
        # A client-only installation has no server VERSION file.
        if 'SOLVIA 3.0.0' not in wrapper.read_text():
            raise ValueError('Потрібна Linux-версія SOLVIA 3.0.0. Оновлення не застосовано.')
        version_ok = True
    if not version_ok:
        raise ValueError('Не вдалося підтвердити версію SOLVIA 3.0.0. Оновлення не застосовано.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    staged, changed = [], []
    wrapper_backup = None
    with (targets[0]/'.mint-ui-update.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            # Prepare everything before replacing any installed asset.
            for base in targets:
                stage = Path(tempfile.mkdtemp(prefix='.mint-ui-', dir=base))
                staged.append(stage)
                shutil.copytree(package/'ui', stage/'ui')
                for file in (stage/'ui').rglob('*'):
                    file.chmod(0o755 if file.is_dir() else 0o644)
            if wrapper.is_file():
                backup_path = wrapper.with_name('solvia-linux-app.py.before-mint-'+stamp)
                shutil.copy2(wrapper, backup_path)
                wrapper_backup = backup_path
            for base, stage in zip(targets, staged):
                backup = base/('ui.before-mint-'+stamp)
                (base/'ui').rename(backup)
                changed.append((base, backup))
                (stage/'ui').rename(base/'ui')
            if wrapper.is_file():
                replacement = wrapper.with_name('.mint-wrapper-'+stamp)
                shutil.copy2(package/'solvia-linux-app.py', replacement)
                replacement.chmod(0o644)
                os.replace(replacement, wrapper)
        except Exception:
            for base, backup in reversed(changed):
                if (base/'ui').exists(): shutil.rmtree(base/'ui')
                backup.rename(base/'ui')
            if wrapper_backup: shutil.copy2(wrapper_backup, wrapper)
            raise
        finally:
            for stage in staged: shutil.rmtree(stage, ignore_errors=True)
    return [str(backup) for _, backup in changed]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path('/'), help='Filesystem prefix for isolated verification')
    args = parser.parse_args()
    try:
        if args.prefix.resolve() == Path('/') and os.geteuid() != 0:
            raise PermissionError('Запустіть: sudo python3 update-ui.py')
        backups = apply(Path(__file__).resolve().parent, args.prefix)
        print('Готово. Закрийте й знову відкрийте SOLVIA. Базу даних і серверні служби не змінено.')
        for backup in backups: print('Попередній інтерфейс: '+backup)
    except Exception as error:
        parser.exit(1, 'Оновлення не застосовано: '+str(error)+'\n')
