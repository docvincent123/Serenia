#!/usr/bin/env bash
# Installs only the Linux GTK client, never PostgreSQL or systemd server services.
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Запустіть: sudo bash install-client.sh'; exit 1; }
mode=${1:-client}
case $mode in client|--console|--with-console) ;; *) echo 'Використання: sudo bash install-client.sh [--console|--with-console]' >&2; exit 2;; esac
package=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for file in solvia-linux-app.py solvia-admin-app solvia-admin.desktop; do
  [[ -f $package/$file ]] || { echo "Немає $file у пакеті" >&2; exit 1; }
done
[[ -f $package/ui/index.html ]] || { echo "Немає локального інтерфейсу ui/index.html у пакеті" >&2; exit 1; }
missing=()
for dependency in python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 ca-certificates desktop-file-utils; do
  installed_status=$(dpkg-query -W -f='${Status}' "$dependency" 2>/dev/null || true)
  [[ $installed_status == 'install ok installed' ]] || missing+=("$dependency")
done
if ((${#missing[@]})); then
  apt-get update
  apt-get install -y "${missing[@]}"
fi
install -d -m 0755 /usr/local/lib/solvia
rm -rf /usr/local/lib/solvia/ui
cp -r "$package/ui" /usr/local/lib/solvia/ui
chmod -R a+rX /usr/local/lib/solvia/ui
install -m 0644 "$package/solvia-linux-app.py" /usr/local/lib/solvia/solvia-linux-app.py
if [[ $mode != --console ]]; then
  install -m 0755 "$package/solvia-admin-app" /usr/local/bin/solvia-admin-app
  install -m 0644 "$package/solvia-admin.desktop" /usr/share/applications/solvia-admin.desktop
fi
if [[ $mode != client ]]; then
  install -m 0755 "$package/solvia-server-app" /usr/local/bin/solvia-server-app
  install -m 0644 "$package/solvia-server-console.desktop" /usr/share/applications/solvia-server-console.desktop
fi
if [[ -f $package/ui/solvia-icon.png ]]; then
  install -D -m 0644 "$package/ui/solvia-icon.png" /usr/share/icons/hicolor/256x256/apps/solvia-admin.png
fi
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
echo 'Клієнт SOLVIA встановлено. Відкрийте SOLVIA в меню та натисніть «Сервер».'
echo 'Серверні служби й базу даних цей інсталятор не встановлює.'
echo 'Для підключення до іншого ПК додайте довіру до CA центру за інструкцією LINUX.md.'
