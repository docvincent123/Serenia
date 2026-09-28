#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Запустіть: sudo bash uninstall.sh'; exit 1; }

purge=false
[[ ${1:-} != --purge-data ]] || purge=true

systemctl disable --now solvia.service solvia-backup.timer solvia-certificate.timer 2>/dev/null || true
rm -f /etc/systemd/system/solvia.service /etc/systemd/system/solvia-backup.service /etc/systemd/system/solvia-backup.timer \
      /etc/systemd/system/solvia-certificate.service /etc/systemd/system/solvia-certificate.timer
systemctl daemon-reload

rm -f /usr/local/sbin/solvia-admin /usr/local/sbin/solvia-updater /usr/local/bin/solvia-admin-app
rm -f /usr/share/applications/solvia-admin.desktop
rm -f /usr/share/icons/hicolor/256x256/apps/solvia-admin.png
rm -f /usr/local/share/ca-certificates/quremed-solvia-local-ca.crt
rm -rf /usr/local/share/solvia
command -v update-ca-certificates >/dev/null 2>&1 && update-ca-certificates >/dev/null || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications >/dev/null 2>&1 || true

if ! $purge; then
  echo 'SOLVIA application removed. Database, /etc/solvia and /var/backups/solvia were preserved.'
  echo 'For destructive removal use: sudo bash uninstall.sh --purge-data'
  exit 0
fi

read -r -p 'This will DELETE SOLVIA database/configuration. Type ВИДАЛИТИ: ' confirm
[[ $confirm == ВИДАЛИТИ ]] || { echo 'Cancelled'; exit 1; }

pg_dropcluster --stop 16 solvia 2>/dev/null || true
userdel solvia 2>/dev/null || true
rm -rf /opt/solvia /etc/solvia /var/lib/solvia /var/backups/solvia /run/solvia-admin
echo 'SOLVIA and its local data were removed.'
