#!/usr/bin/env bash
# Installs only the Linux GTK client, never PostgreSQL or systemd server services.
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Запустіть: sudo bash install-client.sh'; exit 1; }
package=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for file in solvia-linux-app.py solvia-admin-app solvia-admin.desktop; do
  [[ -f $package/$file ]] || { echo "Немає $file у пакеті" >&2; exit 1; }
done
apt-get update
apt-get install -y python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 ca-certificates desktop-file-utils
install -d -m 0755 /usr/local/lib/solvia
install -m 0644 "$package/solvia-linux-app.py" /usr/local/lib/solvia/solvia-linux-app.py
install -m 0755 "$package/solvia-admin-app" /usr/local/bin/solvia-admin-app
install -m 0644 "$package/solvia-admin.desktop" /usr/share/applications/solvia-admin.desktop
if [[ -f $package/ui/solvia-icon.png ]]; then
  install -D -m 0644 "$package/ui/solvia-icon.png" /usr/share/icons/hicolor/256x256/apps/solvia-admin.png
fi
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
echo 'Клієнт SOLVIA встановлено. Відкрийте SOLVIA в меню та натисніть «Сервер».'
echo 'Серверні служби й базу даних цей інсталятор не встановлює.'
echo 'Для підключення до іншого ПК додайте довіру до CA центру за інструкцією LINUX.md.'
