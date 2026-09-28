#!/usr/bin/env bash
# Run on a disposable Ubuntu 24.04 CI VM only; exercises real systemd + PostgreSQL + TLS.
set -Eeuo pipefail
package=$(realpath "$1")
export SOLVIA_SERVER_IP
SOLVIA_SERVER_IP=$(hostname -I | awk '{print $1}')
printf 'admin\nАдміністратор CI\nCI-password-long-2026\nCI-password-long-2026\n' | sudo --preserve-env=SOLVIA_SERVER_IP bash "$package/install.sh"
sudo systemctl is-enabled solvia solvia-backup.timer solvia-certificate.timer
sudo systemctl is-active solvia
sudo solvia-admin health
sudo test -x /usr/local/bin/solvia-admin-app
sudo test -x /usr/local/sbin/solvia-updater
sudo test -f /opt/solvia/VERSION
test "$(sudo solvia-admin version)" = "$(tr -d '[:space:]' < "$package/VERSION")"
sudo test -f /usr/share/applications/solvia-admin.desktop
sudo desktop-file-validate /usr/share/applications/solvia-admin.desktop
sudo test -f /usr/local/share/ca-certificates/quremed-solvia-local-ca.crt
sudo -u nobody test -r /usr/local/share/solvia/address
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
sudo solvia-admin backup
sudo solvia-admin db-status
sudo solvia-admin doctor
backup_events=$(sudo -u solvia psql -X -p 55432 -d solvia -Atc "SELECT count(*) FROM backup_events WHERE action='backup' AND status='success'")
test "$backup_events" -ge 1
backup=$(sudo find /var/backups/solvia -name 'solvia-*.dump' | sort | tail -1)
printf 'ВІДНОВИТИ\n' | sudo solvia-admin restore "$backup"
# Upgrade is unattended after initial setup and preserves accounts and CA.
ca_before=$(sha256sum /tmp/solvia-ci-ca.crt | cut -d' ' -f1)
sudo --preserve-env=SOLVIA_SERVER_IP bash "$package/install.sh" </dev/null
ca_after=$(sudo sha256sum /etc/solvia/ca/QureMed-Local-CA.crt | cut -d' ' -f1)
test "$ca_before" = "$ca_after"
test "$(sudo -u solvia psql -X -p 55432 -d solvia -Atc 'SELECT count(*) FROM users')" = 1
sudo solvia-admin restart
# Failed TLS verification must never be bypassed; certificate contains the LAN SAN.
sudo openssl verify -CAfile /tmp/solvia-ci-ca.crt -verify_ip "$SOLVIA_SERVER_IP" /etc/solvia/tls/server.crt
printf 'Linux install, HTTPS login, backup, restore and upgrade passed\n'
