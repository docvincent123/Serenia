#!/usr/bin/env bash
# Run on a disposable Ubuntu 24.04 CI VM only; exercises real systemd + PostgreSQL + TLS.
set -Eeuo pipefail
package=$(realpath "$1")
export SOLVIA_SERVER_IP
SOLVIA_SERVER_IP=$(hostname -I | awk '{print $1}')
printf 'admin\nАдміністратор CI\nCI-password-long-2026\nCI-password-long-2026\n' | sudo --preserve-env=SOLVIA_SERVER_IP bash "$package/install.sh"
sudo systemctl is-enabled solvia solvia-http solvia-backup.timer solvia-certificate.timer solvia-network.timer
sudo systemctl is-active solvia solvia-http
sudo solvia-admin health
sudo bash tests/linux-updater.sh
sudo test -x /usr/local/bin/solvia-admin-app
sudo test -x /usr/local/sbin/solvia-updater
sudo test -f /opt/solvia/VERSION
test "$(sudo solvia-admin version)" = "$(tr -d '[:space:]' < "$package/VERSION")"
sudo test -f /usr/share/applications/solvia-admin.desktop
sudo desktop-file-validate /usr/share/applications/solvia-admin.desktop
sudo test -f /usr/local/share/ca-certificates/quremed-solvia-local-ca.crt
sudo -u nobody test -r /usr/local/share/solvia/address
sudo -u nobody test -r /usr/local/share/solvia/SOLVIA-Mobile.solvia
sudo -u nobody test -r /usr/local/share/ca-certificates/quremed-solvia-local-ca.crt
# Peer auth and socket-only DB, no database TCP exposure.
test "$(sudo -u postgres psql -X -p 55432 -Atc 'SHOW listen_addresses')" = ''
sudo test "$(sudo stat -c %a /etc/solvia/ca/ca.key)" = 600
sudo test "$(sudo stat -c %a /etc/solvia/tls/server.key)" = 640
sudo cp /etc/solvia/ca/QureMed-Local-CA.crt /tmp/solvia-ci-ca.crt
sudo chmod 644 /tmp/solvia-ci-ca.crt
python3 - <<'PY'
import json, ssl, os, urllib.request
base='https://'+os.environ['SOLVIA_SERVER_IP']+':8443'
context=ssl.create_default_context(cafile='/tmp/solvia-ci-ca.crt')
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context))
with client.open(base+'/api/health') as r:
    assert json.load(r)['platform']=='linux'
with client.open(base+'/index.html') as r:
    assert b'id="root"' in r.read()
request=urllib.request.Request(base+'/api/login', data=json.dumps({'login':'admin','password':'CI-password-long-2026'}).encode(), headers={'Content-Type':'application/json'})
with client.open(request) as r:
    login=json.load(r)
    assert login['user']['name']=='Адміністратор CI'
token=login['token']
request=urllib.request.Request(base+'/api/admin/system', headers={'Authorization':'Bearer '+token})
with client.open(request) as r:
    system=json.load(r)
    assert system['database']['name']=='solvia'
    assert int(system['counts']['users']) >= 1
PY
python3 - <<'PY'
import json, os, urllib.request, urllib.error, http.client
ip=os.environ['SOLVIA_SERVER_IP']
client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
with client.open('http://127.0.0.1:8765/api/health', timeout=5) as r:
    health=json.load(r)
    assert health['ok'] is True
with open('/usr/local/share/solvia/SOLVIA-Mobile.solvia', encoding='utf-8') as f:
    profile=json.load(f)
assert profile['preferred']=='https'
assert profile['https_url']==f'https://{ip}:8443'
assert profile['api_url']==f'https://{ip}:8443'
assert not profile.get('http_url')
# The API must remain unreachable over unencrypted LAN HTTP.
try:
    response=client.open('http://'+ip+':8765/api/health', timeout=5)
except urllib.error.HTTPError as error:
    raise AssertionError('LAN HTTP listener is exposed') from error
except (urllib.error.URLError, http.client.HTTPException):
    pass
else:
    response.close()
    raise AssertionError('LAN HTTP listener is exposed')
PY
sudo solvia-admin backup
# Two backups at the same timestamp must preserve both archives.
clock_bin=$(mktemp -d)
printf '#!/bin/sh\nprintf "20260101T000000\\n"\n' > "$clock_bin/date"
chmod +x "$clock_bin/date"
backup_one=$(sudo env PATH="$clock_bin:$PATH" /usr/local/sbin/solvia-admin backup)
backup_two=$(sudo env PATH="$clock_bin:$PATH" /usr/local/sbin/solvia-admin backup)
test "$backup_one" != "$backup_two"
sudo test -s "$backup_one"
sudo test -s "$backup_two"
rm -rf "$clock_bin"
sudo solvia-admin db-status
sudo solvia-admin doctor
backup_events=$(sudo -u solvia psql -X -p 55432 -d solvia -Atc "SELECT count(*) FROM backup_events WHERE action='backup' AND status='success'")
test "$backup_events" -ge 1
backup=$(sudo find /var/backups/solvia -name 'solvia-*.dump' | sort | tail -1)
sudo solvia-admin verify-backup "$backup"
test "$(sudo -u postgres psql -X -p 55432 -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'solvia_verify_%'")" = 0
test "$(sudo -u postgres psql -X -p 55432 -Atc "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'solvia_verify_%'")" = 0
test "$(sudo -u solvia psql -X -p 55432 -d solvia -Atc "SELECT count(*) FROM backup_events WHERE action='verify' AND status='success'")" -ge 1
invalid_backup=$(mktemp)
printf 'not a PostgreSQL archive\n' > "$invalid_backup"
if sudo solvia-admin verify-backup "$invalid_backup"; then echo 'Corrupt backup accepted'; exit 1; fi
rm -f "$invalid_backup"
sudo solvia-admin health
printf 'ВІДНОВИТИ\n' | sudo solvia-admin restore "$backup"
# Simulate a stale DHCP address and certificate without changing the runner network.
ca_original=$(sudo sha256sum /etc/solvia/ca/QureMed-Local-CA.crt | cut -d' ' -f1)
printf '192.168.250.254\n' | sudo tee /etc/solvia/address >/dev/null
sudo /opt/solvia/renew-certificate.sh --force >/dev/null
sudo systemctl restart solvia
sudo solvia-admin health
test "$(cat /usr/local/share/solvia/address)" = "$SOLVIA_SERVER_IP"
sudo openssl verify -CAfile /tmp/solvia-ci-ca.crt -verify_ip "$SOLVIA_SERVER_IP" /etc/solvia/tls/server.crt
sudo openssl verify -CAfile /tmp/solvia-ci-ca.crt -verify_hostname localhost /etc/solvia/tls/server.crt
curl --fail --silent --noproxy '*' --cacert /tmp/solvia-ci-ca.crt https://localhost:8443/api/health
sudo systemctl stop solvia solvia-http
sudo /opt/solvia/sync-network.sh
sudo systemctl is-active solvia solvia-http
cert_before=$(sudo sha256sum /etc/solvia/tls/server.crt)
sudo /opt/solvia/sync-network.sh
cert_after=$(sudo sha256sum /etc/solvia/tls/server.crt)
test "$cert_before" = "$cert_after"
test "$ca_original" = "$(sudo sha256sum /etc/solvia/ca/QureMed-Local-CA.crt | cut -d' ' -f1)"
# Installer must also recover from an old IP supplied by the updater.
export SOLVIA_SERVER_IP=192.168.250.254
# Upgrade is unattended after initial setup and preserves accounts and CA.
ca_before=$(sha256sum /tmp/solvia-ci-ca.crt | cut -d' ' -f1)
sudo --preserve-env=SOLVIA_SERVER_IP bash "$package/install.sh" </dev/null
ca_after=$(sudo sha256sum /etc/solvia/ca/QureMed-Local-CA.crt | cut -d' ' -f1)
test "$ca_before" = "$ca_after"
test "$(sudo -u solvia psql -X -p 55432 -d solvia -Atc 'SELECT count(*) FROM users')" = 1
sudo solvia-admin restart
# Failed TLS verification must never be bypassed; certificate contains the LAN SAN.
SOLVIA_SERVER_IP=$(cat /usr/local/share/solvia/address)
sudo openssl verify -CAfile /tmp/solvia-ci-ca.crt -verify_ip "$SOLVIA_SERVER_IP" /etc/solvia/tls/server.crt
printf 'Linux install, HTTPS + loopback-only HTTP, backup, restore and upgrade passed\n'
