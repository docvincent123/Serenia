#!/usr/bin/env bash
# Self-contained *package structure* for Ubuntu 24.04; Qt shared libraries stay
# system packages and are installed by apt through Depends. No patient data.
set -Eeuo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
build=${SOLVIA_NATIVE_BUILD_DIR:-"$root/build/native-linux"}
binary="$build/solvia-native"
version=${SOLVIA_NATIVE_VERSION:-3.2.0~preview1}
[[ -x $binary ]] || { echo "Спочатку зберіть $binary" >&2; exit 1; }
command -v dpkg-deb >/dev/null || { echo "Потрібен dpkg-deb" >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
install -d "$stage/DEBIAN" "$stage/usr/bin" "$stage/usr/share/applications" \
    "$stage/usr/share/icons/hicolor/scalable/apps"
install -m 0755 "$binary" "$stage/usr/bin/solvia-native"
install -m 0644 "$root/native/linux/brand.svg" "$stage/usr/share/icons/hicolor/scalable/apps/solvia-admin.svg"
sed 's#^Exec=/usr/local/bin/solvia-native$#Exec=/usr/bin/solvia-native#' \
    "$root/native/linux/solvia-native.desktop" > "$stage/usr/share/applications/solvia-native.desktop"
cat > "$stage/DEBIAN/control" <<EOF
Package: solvia-native
Version: $version
Architecture: amd64
Section: office
Priority: optional
Maintainer: QureMed Industries
Depends: libqt6network6t64, libqt6quick6, libqt6quickcontrols2-6, libqt6svg6, qml6-module-qtqml, qml6-module-qtqml-models, qml6-module-qtqml-workerscript, qml6-module-qtquick, qml6-module-qtquick-controls, qml6-module-qtquick-layouts, qml6-module-qtquick-window, qml6-module-qtquick-templates, qml6-module-qtquick-shapes
Description: SOLVIA native Linux client for rehabilitation center staff
 Qt Quick/QML workplace application connecting to an existing SOLVIA HTTPS
 server. It does not install a database, server or medical data cache.
EOF
outfile="$build/solvia-native_${version}_amd64.deb"
dpkg-deb --root-owner-group --build "$stage" "$outfile"
dpkg-deb --info "$outfile"
echo "Пакет SOLVIA Native: $outfile"
