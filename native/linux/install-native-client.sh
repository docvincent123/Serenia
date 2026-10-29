#!/usr/bin/env bash
# Installs Qt client only. NEVER touches PostgreSQL, SOLVIA services or patient data.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Запустіть sudo bash native/linux/install-native-client.sh' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
binary=${SOLVIA_NATIVE_BINARY:-"$root/build/native-linux/solvia-native"}
[[ -x $binary ]] || { echo 'Немає зібраного solvia-native; спершу bash native/linux/build-native.sh' >&2; exit 1; }
install -m 0755 "$binary" /usr/local/bin/solvia-native
install -D -m 0644 "$root/native/linux/brand.svg" /usr/share/icons/hicolor/scalable/apps/solvia-admin.svg
install -m 0644 "$root/native/linux/solvia-native.desktop" /usr/share/applications/solvia-native.desktop
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
echo 'Нативна SOLVIA встановлена (меню: SOLVIA Native).'
echo 'Старе робоче місце SOLVIA не видалено, сервер і база даних не змінені.'
if [[ ${1:-} == --make-default ]]; then
    old=/usr/share/applications/solvia-admin.desktop
    if [[ -f $old ]]; then
        cp -p "$old" /usr/share/applications/solvia-classic.desktop
        sed -i 's/^Name=.*/Name=SOLVIA Classic/' /usr/share/applications/solvia-classic.desktop
    fi
    install -m 0644 "$root/native/linux/solvia-native.desktop" "$old"
    sed -i 's/^Name=.*/Name=SOLVIA/' "$old"
    echo 'SOLVIA Native призначено основним ярликом; класичний GTK-клієнт залишено для повернення.'
fi
