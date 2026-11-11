#!/usr/bin/env bash
# GitHub's Azure HTTP mirror can stall; use signed packages over the upstream HTTPS mirrors.
set -Eeuo pipefail
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'This helper is only for disposable GitHub Actions runners.' >&2; exit 2; }
sudo python3 - <<'PY'
from pathlib import Path
paths=[Path('/etc/apt/sources.list'),Path('/etc/apt/apt-mirrors.txt'),Path('/etc/apt/apt-mirrors-security.txt')]
folder=Path('/etc/apt/sources.list.d')
if folder.is_dir():paths+=list(folder.glob('*.list'))+list(folder.glob('*.sources'))
for path in paths:
    if not path.is_file():continue
    previous=path.read_text()
    current=previous.replace('http://azure.archive.ubuntu.com/ubuntu','https://archive.ubuntu.com/ubuntu').replace('https://azure.archive.ubuntu.com/ubuntu','https://archive.ubuntu.com/ubuntu').replace('http://archive.ubuntu.com/ubuntu','https://archive.ubuntu.com/ubuntu').replace('http://security.ubuntu.com/ubuntu','https://security.ubuntu.com/ubuntu')
    if current!=previous:path.write_text(current)
PY
sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update
