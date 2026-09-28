#!/usr/bin/env bash
# SOLVIA server package installer: Ubuntu 24.04 / elementary OS 8, x86_64.
set -Eeuo pipefail
umask 027
export LC_ALL=C.UTF-8
trap 'echo "Встановлення зупинено (рядок $LINENO). База не видалена. Журнал: journalctl -u solvia -n 60" >&2' ERR
[[ $EUID == 0 ]] || { echo 'Запустіть: sudo bash install.sh'; exit 1; }
install -d -m 0700 -o root -g root /run/solvia-admin
exec 9>/run/solvia-admin/install.lock
flock -n 9 || { echo 'Інше встановлення вже працює'; exit 1; }
source /etc/os-release
[[ ${UBUNTU_CODENAME:-${VERSION_CODENAME:-}} == noble && $(uname -m) == x86_64 ]] || {
  echo 'Цей пакет підтримує Ubuntu 24.04 / elementary OS 8 (x86_64).'; exit 1;
}
package=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f $package/SolviaServer && -f $package/ui/index.html && -f $package/solvia-admin-app && -f $package/solvia-admin.desktop ]] || { echo 'Розпакуйте весь Linux-пакет поруч з install.sh'; exit 1; }
cd "$package"
sha256sum --check SHA256SUMS
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql-16 openssl curl ca-certificates libstdc++6 libssl3t64 libpq5 python3 xdg-utils libnss3-tools desktop-file-utils
libraries=$(ldd ./SolviaServer)
printf '%s\n' "$libraries"
if grep -q 'not found' <<< "$libraries"; then echo 'Відсутні бібліотеки сервера'; exit 1; fi
id solvia &>/dev/null || useradd --system --home-dir /var/lib/solvia --create-home --shell /usr/sbin/nologin solvia
install -d -m 0750 -o root -g solvia /etc/solvia /etc/solvia/tls
install -d -m 0700 /etc/solvia/ca /var/backups/solvia
install -d -m 0750 -o solvia -g solvia /var/lib/solvia
if [[ ! -d /etc/postgresql/16/solvia ]]; then
  pg_createcluster 16 solvia --port 55432 -- --auth-local=peer --auth-host=scram-sha-256
  pg_conftool 16 solvia set listen_addresses ""
fi
# Refuse unexpected shared/custom cluster configuration instead of changing it.
[[ $(pg_conftool -s 16 solvia show port) == 55432 ]] || { echo 'Unexpected SOLVIA PostgreSQL port'; exit 1; }
[[ $(pg_conftool -s 16 solvia show listen_addresses) == "" ]] || { echo 'SOLVIA database must use Unix socket only'; exit 1; }
systemctl enable --now postgresql@16-solvia
pg=(runuser -u postgres -- psql -X -p 55432 -v ON_ERROR_STOP=1)
if [[ $("${pg[@]}" -Atc "SELECT 1 FROM pg_roles WHERE rolname='solvia'") != 1 ]]; then
  "${pg[@]}" -c 'CREATE ROLE solvia LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
fi
if [[ $("${pg[@]}" -Atc "SELECT 1 FROM pg_database WHERE datname='solvia'") != 1 ]]; then
  runuser -u postgres -- createdb -p 55432 -O solvia solvia
fi
export SOLVIA_DATABASE_URL='host=/var/run/postgresql port=55432 dbname=solvia user=solvia'
runuser -u solvia -- psql -X "$SOLVIA_DATABASE_URL" -Atc 'SELECT 1' >/dev/null
existing=$(runuser -u solvia -- psql -X "$SOLVIA_DATABASE_URL" -Atc "SELECT to_regclass('public.users') IS NOT NULL")
if [[ $existing == t ]]; then
  count=$(runuser -u solvia -- psql -X "$SOLVIA_DATABASE_URL" -Atc 'SELECT count(*) FROM users')
else count=0; fi
if [[ $count == 0 ]]; then
  read -r -p 'Логін першого адміністратора: ' SOLVIA_ADMIN_LOGIN
  read -r -p 'ПІБ адміністратора: ' SOLVIA_ADMIN_NAME
  read -r -s -p 'Пароль (12–128 байтів UTF-8): ' SOLVIA_ADMIN_PASSWORD; echo
  read -r -s -p 'Повторіть пароль: ' confirmation; echo
  [[ $SOLVIA_ADMIN_LOGIN =~ ^[A-Za-z0-9._-]{3,64}$ && $SOLVIA_ADMIN_PASSWORD == "$confirmation" ]] || { echo 'Некоректний логін або паролі не збігаються'; exit 1; }
  bytes=$(printf %s "$SOLVIA_ADMIN_PASSWORD" | wc -c)
  ((bytes >= 12 && bytes <= 128)) || { echo 'Некоректна довжина пароля'; exit 1; }
  export SOLVIA_ADMIN_LOGIN SOLVIA_ADMIN_NAME SOLVIA_ADMIN_PASSWORD
fi
old_ip=''
[[ ! -f /etc/solvia/address ]] || old_ip=$(cat /etc/solvia/address)
ip=${SOLVIA_SERVER_IP:-$old_ip}
if [[ -z $ip ]]; then read -r -p 'Стала IPv4-адреса Linux-сервера в LAN (наприклад 192.168.1.105): ' ip; fi
python3 - "$ip" <<'PY'
import ipaddress, sys
ip = ipaddress.IPv4Address(sys.argv[1])
if ip.is_unspecified or ip.is_multicast or ip.is_loopback or not any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):
    raise SystemExit('Потрібна приватна IPv4-адреса LAN')
PY
# Stop writers before the update snapshot and migrations.
systemctl stop solvia.service 2>/dev/null || true
# A failed update never deletes or silently replaces data.
if [[ $count != 0 ]]; then
  snapshot="/var/backups/solvia/pre-update-$(date -u +%Y%m%dT%H%M%S).dump"
  runuser -u solvia -- /usr/lib/postgresql/16/bin/pg_dump -Fc "$SOLVIA_DATABASE_URL" > "$snapshot"
  chmod 0600 "$snapshot"
fi
install -d -m 0755 /opt/solvia
# Keep the previous application for diagnosis; do not roll back migrated schemas automatically.
if [[ -f /opt/solvia/SolviaServer ]]; then cp -a /opt/solvia/SolviaServer /opt/solvia/SolviaServer.previous; fi
install -m 0755 SolviaServer /opt/solvia/SolviaServer
rm -rf /opt/solvia/ui.previous
if [[ -d /opt/solvia/ui ]]; then mv /opt/solvia/ui /opt/solvia/ui.previous; fi
cp -r ui /opt/solvia/ui
chmod -R a+rX /opt/solvia/ui
runuser -u solvia --preserve-environment -- /opt/solvia/SolviaServer --init
unset SOLVIA_ADMIN_PASSWORD SOLVIA_ADMIN_LOGIN SOLVIA_ADMIN_NAME confirmation
printf '%s\n' "$ip" > /etc/solvia/address
printf 'SOLVIA_DATABASE_URL="%s"\nSOLVIA_HOST=%s\n' "$SOLVIA_DATABASE_URL" "$ip" > /etc/solvia/server.env
chmod 0640 /etc/solvia/server.env /etc/solvia/address
chown root:solvia /etc/solvia/server.env /etc/solvia/address
install -m 0755 solvia-admin /usr/local/sbin/solvia-admin
install -m 0755 solvia-admin-app /usr/local/bin/solvia-admin-app
install -m 0644 solvia-admin.desktop /usr/share/applications/solvia-admin.desktop
if [[ -f /opt/solvia/ui/solvia-icon.png ]]; then
  install -D -m 0644 /opt/solvia/ui/solvia-icon.png /usr/share/icons/hicolor/256x256/apps/solvia-admin.png
fi
install -m 0755 renew-certificate.sh /opt/solvia/renew-certificate.sh
/opt/solvia/renew-certificate.sh --force
install -D -m 0644 /etc/solvia/ca/QureMed-Local-CA.crt /usr/local/share/ca-certificates/quremed-solvia-local-ca.crt
update-ca-certificates >/dev/null
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
install -m 0644 ./*.service ./*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now solvia.service solvia-certificate.timer solvia-backup.timer
systemctl restart solvia.service
/usr/local/sbin/solvia-admin health
printf '\nSOLVIA готова: https://%s:8443\n' "$ip"
echo 'Linux Admin: відкрийте «SOLVIA Admin» у меню програм або виконайте solvia-admin-app.'
echo 'Сертифікат для ПК/Android: /etc/solvia/ca/QureMed-Local-CA.crt'
openssl x509 -in /etc/solvia/ca/QureMed-Local-CA.crt -noout -fingerprint -sha256
echo 'Установіть довіру тільки до цього CA. Збережіть його відбиток для звірки.'
echo 'Якщо firewall активний: дозвольте TCP 8443 лише з підмережі центру (див. LINUX.md).'
