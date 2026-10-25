#!/usr/bin/env python3
"""Package a UI-only update for the existing Linux 3.0 application."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
root=Path(__file__).resolve().parents[1]
dist=root/'frontend/dist'
if not (dist/'index.html').is_file(): raise SystemExit('Build frontend first: npm --prefix frontend run build')
out=root/'out';out.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    package=Path(tmp)/'SOLVIA-Linux-Mint-UI';package.mkdir()
    shutil.copytree(dist,package/'ui')
    shutil.copy2(root/'installer/linux/solvia-linux-app.py',package/'solvia-linux-app.py')
    shutil.copy2(root/'tools/update-mint-ui.py',package/'update-ui.py')
    shutil.copy2(root/'docs/LINUX-MINT-DESIGN.md',package/'README.md')
    checks={str(p.relative_to(package)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(package.rglob('*')) if p.is_file()}
    (package/'manifest.json').write_text(json.dumps({'requires_version':'3.0.0','sha256':checks},indent=2)+'\n')
    target=out/'SOLVIA-3.0.0-Linux-Mint-UI.tar.gz'
    with tarfile.open(target,'w:gz') as archive:archive.add(package,arcname=package.name)
print(target)
