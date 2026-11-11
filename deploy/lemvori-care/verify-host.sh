#!/usr/bin/env bash
# Read-only diagnostic. No credentials, personal records or secrets printed.
set -Eeuo pipefail
fail=0
pass(){ printf '[OK] %s\n' "$*"; }
warn(){ printf '[FAIL] %s\n' "$*" >&2; fail=$((fail+1)); }
command -v systemctl >/dev/null || { echo 'Requires systemd' >&2; exit 2; }
systemctl is-enabled --quiet lemvori-care.service && pass 'API enabled on boot' || warn 'API not enabled'
systemctl is-active --quiet lemvori-care.service && pass 'C++ API running' || warn 'API stopped'
systemctl is-enabled --quiet lemvori-care-network.timer && pass 'Network timer enabled' || warn 'Network timer disabled'
systemctl is-active --quiet lemvori-care-network.timer && pass 'Network timer active' || warn 'Network timer inactive'
ss -ltn | awk '{print $4}' | grep -Eq '(^|:)8443$' && pass 'HTTPS 8443 listening' || warn 'HTTPS 8443 missing'
ss -ltn | awk '{print $4}' | grep -Eq '(^|:)5432$' && pass 'PostgreSQL 5432 listening' || warn 'PostgreSQL 5432 missing'
if curl --noproxy '*' -fsS --max-time 5 --cacert /etc/lemvori-care/ca/ca.crt \
    https://127.0.0.1:8443/api/health 2>/dev/null |
  python3 -c 'import json,sys;d=json.load(sys.stdin);assert d.get("ok") is True and len(d.get("server_id",""))==64' 2>/dev/null; then
  pass 'Trusted HTTPS API and valid server identity'
else warn 'HTTPS health check failed'; fi
if [[ -r /etc/lemvori-care/address ]]; then
  ip=$(cat /etc/lemvori-care/address)
  if openssl verify -CAfile /etc/lemvori-care/ca/ca.crt -verify_ip "$ip" \
    /etc/lemvori-care/tls/server.crt >/dev/null 2>&1; then
    pass "Certificate covers LAN IP ($ip)"
  else warn "TLS certificate mismatch for LAN IP ($ip)"; fi
else warn 'LAN address file missing'; fi
if [[ $EUID == 0 ]]; then
  if runuser -u lemvori-care -- env PGPASSFILE=/etc/lemvori-care/pgpass \
    psql -X -At -h 127.0.0.1 -p 5432 -U lemvori_app -d lemvori_core \
    -c "SELECT current_database() || ':' || current_user || ':' || (SELECT count(*) FROM users)" 2>/dev/null |
    grep -q '^lemvori_core:lemvori_app:'; then
    pass 'PostgreSQL lemvori_core connected with essential tables'
  else warn 'Database authentication or schema failed'; fi
  [[ -x /opt/lemvori-care/restore.sh ]] && pass 'Staged restore executable installed' || warn 'Restore executable missing'
  if [[ -d /var/backups/lemvori-care ]]; then
    count=$(find /var/backups/lemvori-care -maxdepth 1 -type f -name 'lemvori-core-*.dump' | wc -l)
    pass "Protected backup folder present ($count copies)"
  else warn 'Backup directory absent'; fi
else
  echo '[INFO] Run with sudo for protected DB / backup diagnostics'
fi
if command -v dpkg-query >/dev/null; then
  if dpkg-query -W 2>/dev/null | grep -Eiq 'lemvori-care-native'; then
    pass 'Qt Native package found in dpkg'
  else echo '[INFO] Qt package not detected under expected name; check manually'; fi
fi
printf 'Diagnostics: %s failure(s)\n' "$fail"
exit $((fail > 0))
