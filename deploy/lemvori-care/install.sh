#!/usr/bin/env bash
# Independent Qt Native/C++ API setup. Never drops PostgreSQL data.
set -Eeuo pipefail
umask 077
trap 'echo "Lemvori Care install failed at line $LINENO. No databases were deleted." >&2' ERR
[[ $EUID == 0 ]] || { echo "Use sudo bash deploy/lemvori-care/install.sh" >&2; exit 1; }
[[ $(uname -m) == x86_64 && -x /usr/bin/apt-get ]] || { echo "Requires Ubuntu/Linux Mint x86_64" >&2; exit 1; }
mode=interactive
case $# in
  0) ;;
  1) [[ $1 == --prepare-center ]] || exit 2; mode=prepare ;;
  4)
    [[ $1 == --admin-setup && -s $2 && -f $2 && ! -L $2 && $(stat -c %s -- "$2") -le 32768 ]] || exit 2
    mode=signed; setup_file=$2; publisher_key=$3; publisher_fingerprint=$4
    [[ $publisher_fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 2 ;;
  *) echo 'Usage: install.sh [--prepare-center | --admin-setup FILE PUBLIC.pem SHA256]' >&2; exit 2 ;;
esac
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
package=$source_dir/deploy/lemvori-care
[[ -f $source_dir/CMakeLists.txt && -f $source_dir/src/server/schema.sql ]] || {
  echo "Use a complete source checkout (CMakeLists.txt and src/server/schema.sql required)." >&2; exit 1;
}
# Serialize installation with backup and restore before changing host state.
install -d -m 0700 -o root -g root /run/lemvori-care
exec 9>/run/lemvori-care/db-maintenance.lock
flock -n 9 || { echo "Another installation or database operation is running" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y cmake g++ make pkg-config libpq-dev postgresql-client libssl-dev openssl \
    ca-certificates curl iproute2 python3 nlohmann-json3-dev libcpp-httplib-dev age
if ! pg_isready -h 127.0.0.1 -p 5432 -q; then
  apt-get install -y postgresql
  systemctl start postgresql
fi
pg_isready -h 127.0.0.1 -p 5432 || { echo "PostgreSQL 5432 is not listening" >&2; exit 1; }

# Build the same C++ backend expected by the Qt Native API bridge.
cmake -S "$source_dir" -B "$source_dir/build/lemvori-api" -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build "$source_dir/build/lemvori-api" --target SolviaServer --parallel 2
[[ -x $source_dir/build/lemvori-api/SolviaServer ]] || { echo "Build failed" >&2; exit 1; }
if ss -ltnH | awk '{print $4}' | grep -Eq '(^|:)8443$' &&
   ! systemctl is-active --quiet lemvori-care.service; then
  echo "Port 8443 is used by another service. Refusing to take over." >&2; exit 1;
fi

if ! id -u lemvori-care >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/lemvori-care \
    --create-home --shell /usr/sbin/nologin lemvori-care
fi
install -d -m 0750 -o lemvori-care -g lemvori-care /var/lib/lemvori-care
install -d -m 0755 -o root -g root /opt/lemvori-care
install -d -m 0750 -o root -g lemvori-care /etc/lemvori-care /etc/lemvori-care/tls
install -d -m 0700 -o root -g root /etc/lemvori-care/ca
install -d -m 0750 -o root -g lemvori-care /etc/lemvori-care/license

unset PGPASSWORD
export LEMVORI_DATABASE_URL='host=127.0.0.1 port=5432 dbname=lemvori_core user=lemvori_app'
export PGPASSFILE=/etc/lemvori-care/pgpass
bash "$package/provision-postgres.sh" "$PGPASSFILE"

dbpsql() {
  runuser -u lemvori-care -- env -u PGPASSWORD PGPASSFILE="$PGPASSFILE" \
    psql -X -w -v ON_ERROR_STOP=1 "$LEMVORI_DATABASE_URL" "$@"
}

# Preserve the complete configured environment, including custom trust paths and
# operator settings. Do this only after the database credentials are verified.
bash "$package/configure-env.sh" /etc/lemvori-care/server.env
chown root:lemvori-care /etc/lemvori-care/server.env
chmod 0640 /etc/lemvori-care/server.env

if [[ $mode == prepare ]]; then
  runuser -u lemvori-care --preserve-environment -- "$source_dir/build/lemvori-api/SolviaServer" --prepare-center
  exit
fi
has_users=$(dbpsql -Atc "SELECT to_regclass('public.users') IS NOT NULL")
count=0
if [[ $has_users == t ]]; then count=$(dbpsql -Atc 'SELECT count(*) FROM users'); fi
if [[ $mode == signed ]]; then
  [[ $count == 0 ]] || { echo 'The existing center already has users.' >&2; exit 1; }
  bash "$package/install-publisher-key.sh" --no-restart "$publisher_key" "$publisher_fingerprint"
elif [[ $count == 0 ]]; then
  read -r -p 'First administrator login (3-64 letters/digits/._-): ' LEMVORI_ADMIN_LOGIN
  read -r -p 'Administrator display name: ' LEMVORI_ADMIN_NAME
  read -r -s -p 'Administrator password (12-128 UTF-8 bytes): ' LEMVORI_ADMIN_PASSWORD
  printf '\n'
  read -r -s -p 'Repeat administrator password: ' repeated_password
  printf '\n'
  [[ $LEMVORI_ADMIN_LOGIN =~ ^[A-Za-z0-9._-]{3,64}$ &&
     $LEMVORI_ADMIN_PASSWORD == "$repeated_password" ]] || {
    echo "Invalid login or passwords do not match" >&2; exit 1;
  }
  pw_length=$(printf '%s' "$LEMVORI_ADMIN_PASSWORD" | wc -c)
  (( pw_length >= 12 && pw_length <= 128 )) || { echo "Password must be 12-128 bytes" >&2; exit 1; }
  [[ $LEMVORI_ADMIN_PASSWORD != *$'\r'* ]] || { echo "Password contains a carriage return" >&2; exit 1; }
  export LEMVORI_ADMIN_LOGIN LEMVORI_ADMIN_NAME LEMVORI_ADMIN_PASSWORD
fi
install -d -m 0700 -o root -g root /var/backups/lemvori-care
bash "$package/provision-backup-key.sh" /etc/lemvori-care/backup.agekey
install -o root -g root -m 0644 "$source_dir/tools/check-encrypted-storage.py" /opt/lemvori-care/check-encrypted-storage.py
install -o root -g root -m 0755 "$package/storage-check.sh" /opt/lemvori-care/storage-check.sh
install -o root -g root -m 0644 "$package/backup-archive.sh" /opt/lemvori-care/backup-archive.sh

# Keep previous database and local CA during reinstall.
systemctl stop lemvori-care-network.timer lemvori-care.service 2>/dev/null || true
install -o root -g root -m 0755 "$source_dir/build/lemvori-api/SolviaServer" \
  /opt/lemvori-care/lemvori-care-api
install -o root -g root -m 0755 "$package/network-address.py" /opt/lemvori-care/network-address.py
install -o root -g root -m 0755 "$package/network-tls.sh" /opt/lemvori-care/network-tls.sh
install -o root -g root -m 0755 "$package/lemvori-carectl" /usr/local/sbin/lemvori-carectl
install -o root -g root -m 0755 "$package/install-publisher-key.sh" /opt/lemvori-care/install-publisher-key.sh
install -o root -g root -m 0755 "$package/restore.sh" /opt/lemvori-care/restore.sh
install -o root -g root -m 0755 "$package/verify-host.sh" /opt/lemvori-care/verify-host.sh

# --init executes bundled schema.sql and creates an initial admin if the users table is empty.
if [[ $mode == signed ]]; then
  export LEMVORI_LICENSE_PUBLIC_KEY=/etc/lemvori-care/license/publisher.pem
  runuser -u lemvori-care --preserve-environment -- /opt/lemvori-care/lemvori-care-api --init-admin-setup < "$setup_file"
else
  runuser -u lemvori-care --preserve-environment -- /opt/lemvori-care/lemvori-care-api --init
fi
unset LEMVORI_ADMIN_LOGIN LEMVORI_ADMIN_NAME LEMVORI_ADMIN_PASSWORD repeated_password

for unit in lemvori-care.service lemvori-care-network.service \
  lemvori-care-network-refresh.service lemvori-care-network.timer \
  lemvori-care-backup.service lemvori-care-backup.timer; do
  install -o root -g root -m 0644 "$package/$unit" "/etc/systemd/system/$unit"
done
/opt/lemvori-care/network-tls.sh --no-restart
install -o root -g root -m 0644 /etc/lemvori-care/ca/ca.crt \
  /usr/local/share/ca-certificates/lemvori-care-local-ca.crt
update-ca-certificates >/dev/null
systemctl daemon-reload
systemctl enable --now lemvori-care.service lemvori-care-network.timer
echo
lemvori-carectl address
lemvori-carectl certificate
if ! timeout 30s bash -c 'until lemvori-carectl health 2>/dev/null; do sleep 1; done'; then
  echo 'Lemvori Care did not become ready over HTTPS. Run sudo lemvori-carectl logs.' >&2
  exit 1
fi
# Persistent timers may trigger immediately. Release maintenance before enabling
# nightly backups so a missed run can actually acquire the database lock.
flock -u 9
systemctl enable --now lemvori-care-backup.timer
echo 'Management: sudo lemvori-carectl {status|logs|health|network|restart}'
echo 'Publisher public key: sudo lemvori-carectl publisher-key /path/to/ed25519-public.pem'
echo 'The first admin login will require the signed center license; never transfer the private signing key.'
echo 'Import /etc/lemvori-care/ca/ca.crt on other Qt/Android devices. Restrict TCP 8443 to trusted LAN.'
