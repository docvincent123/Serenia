#!/usr/bin/env bash
# Isolated fake backend: never starts/stops actual services or asks for sudo.
set -Eeuo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export SOLVIA_CONTROL_LOG="$work/actions"
cat > "$work/backend" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SOLVIA_CONTROL_LOG"
[[ ${1:-} != restart ]] || exit 7
MOCK
chmod +x "$work/backend"
# Replace only the fixed backend in an isolated copy; preserve controller code.
python3 - "$work" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
s=Path('installer/linux/solvia-server-control').read_text()
s=s.replace('/usr/local/sbin/solvia-admin',str(root/'backend'))
s=s.replace('if (( EUID != 0 )); then','if false; then')
(root/'control').write_text(s)
PY
bash "$work/control" start
if bash "$work/control" restart; then echo 'Restart failure was hidden'; exit 1; fi
printf '3\nn\n4\n0\n' | bash "$work/control"
[[ $(cat "$work/actions") == $'start\nrestart\nstatus' ]]
printf '3\ny\n0\n' | bash "$work/control"
[[ $(tail -1 "$work/actions") == stop ]]
lines=$(wc -l < "$work/actions")
if bash "$work/control" 'start; touch /tmp/solvia-unexpected'; then exit 1; fi
[[ $(wc -l < "$work/actions") == "$lines" ]]
printf '0\n' | bash "$work/control"
[[ $(wc -l < "$work/actions") == "$lines" ]]
echo 'PASS: isolated start/restart/stop/status routing, error codes, stop confirmation, unknown-argument rejection and exit without stopping services'
