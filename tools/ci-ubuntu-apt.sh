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
# apt does not consistently inherit the proxy/CA settings used by pip and curl.
# Pass them privately to root without echoing credentials into the build log.
python3 - <<'PROXY' | sudo python3 -c 'import json,sys,os; from pathlib import Path; data=json.load(sys.stdin); lines=["Acquire::ForceIPv4 \"true\";"]; lines += ["Acquire::"+kind+"::Proxy "+json.dumps(value)+";" for kind,value in data.items() if kind in ("http","https") and value]; lines += ["Acquire::https::CaInfo "+json.dumps(data["ca"])+";"] if data.get("ca") else []; path=Path("/etc/apt/apt.conf.d/99lemvori-ci-network"); path.write_text("\n".join(lines)+"\n"); path.chmod(0o600); print("APT runtime proxy configured" if data.get("https") else "APT using direct network")'
import os,json
from pathlib import Path
http=os.environ.get('http_proxy') or os.environ.get('HTTP_PROXY') or ''
https=os.environ.get('https_proxy') or os.environ.get('HTTPS_PROXY') or http
ca=os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE') or ''
print(json.dumps({'http':http,'https':https,'ca':ca if ca and Path(ca).is_file() else ''}))
PROXY
sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update
