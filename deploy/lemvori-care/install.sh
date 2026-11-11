#!/usr/bin/env bash
# Independent Qt Native/C++ API setup. Never drops PostgreSQL data.
set -Eeuo pipefail
umask 077
trap 'echo "Lemvori Care install failed at line $LINENO. No databases were deleted." >&2' ERR
[[ $EUID == 0 ]] || { echo "Use sudo bash deploy/lemvori-care/install.sh" >&2; exit 1; }
[[ $(uname -m) == x86_64 && -x /usr/bin/apt-get ]] || { echo "Requires Ubuntu/Linux Mint x86_64" >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
package=$source_dir/deploy/lemvori-care
[[ -f $source_dir/CMakeLists.txt && -f $source_dir/src/server/schema.sql ]] || {
  echo "Use a complete source checkout (CMakeLists.txt and src/server/schema.sql required)." >&2; exit 1;
}
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y cmake g++ make pkg-config libpq-dev postgresql-client libssl-dev openssl \
    ca-certificates curl iproute2 python3 nlohmann-json3-dev libcpp-httplib-dev
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

pgpass=/etc/lemvori-care/pgpass
if [[ ! -f $pgpass ]]; then
  read -r -s -p 'PostgreSQL password for lemvori_app: ' db_password
  printf '\n'
  [[ -n $db_password && $db_password != *$'\n'* ]] || { echo "Password is required" >&2; exit 1; }
  escaped=${db_password//\\/\\\\}
  escaped=${escaped//:/\\:}
  printf '127.0.0.1:5432:lemvori_core:lemvori_app:%s\n' "$escaped" > "$pgpass"
  unset db_password escaped
fi
chown lemvori-care:lemvori-care "$pgpass"
chmod 0600 "$pgpass"
cat > /etc/lemvori-care/server.env <<'ENV'
LEMVORI_DATABASE_URL="host=127.0.0.1 port=5432 dbname=lemvori_core user=lemvori_app"
PGPASSFILE=/etc/lemvori-care/pgpass
TZ=Europe/Kyiv
ENV
chown root:lemvori-care /etc/lemvori-care/server.env
chmod 0640 /etc/lemvori-care/server.env
export LEMVORI_DATABASE_URL='host=127.0.0.1 port=5432 dbname=lemvori_core user=lemvori_app'
export PGPASSFILE=/etc/lemvori-care/pgpass

dbpsql() {
  runuser -u lemvori-care --preserve-environment -- \
    psql -X -v ON_ERROR_STOP=1 "$LEMVORI_DATABASE_URL" "$@"
}
dbpsql -Atc "SELECT current_database() || ':' || current_user" |
  grep -qx 'lemvori_core:lemvori_app' || {
  echo "Cannot log in as lemvori_app to lemvori_core" >&2; exit 1;
}
[[ $(dbpsql -Atc "SELECT has_schema_privilege(current_user, 'public', 'CREATE')") == t ]] || {
  echo "Role lemvori_app needs CREATE privilege on public schema" >&2; exit 1;
}

# Keep previous database and local CA during reinstall.
systemctl stop lemvori-care-network.timer lemvori-care.service 2>/dev/null || true
install -o root -g root -m 0755 "$source_dir/build/lemvori-api/SolviaServer" \
  /opt/lemvori-care/lemvori-care-api
install -o root -g root -m 0755 "$package/network-address.py" /opt/lemvori-care/network-address.py
install -o root -g root -m 0755 "$package/network-tls.sh" /opt/lemvori-care/network-tls.sh
install -o root -g root -m 0755 "$package/lemvori-carectl" /usr/local/sbin/lemvori-carectl

has_users=$(dbpsql -Atc "SELECT to_regclass('public.users') IS NOT NULL")
count=0
if [[ $has_users == t ]]; then count=$(dbpsql -Atc 'SELECT count(*) FROM users'); fi
if [[ $count == 0 ]]; then
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
  export LEMVORI_ADMIN_LOGIN LEMVORI_ADMIN_NAME LEMVORI_ADMIN_PASSWORD
fi
# --init executes bundled schema.sql and creates an initial admin if the users table is empty.
runuser -u lemvori-care --preserve-environment -- /opt/lemvori-care/lemvori-care-api --init
unset LEMVORI_ADMIN_LOGIN LEMVORI_ADMIN_NAME LEMVORI_ADMIN_PASSWORD repeated_password

for unit in lemvori-care.service lemvori-care-network.service \
  lemvori-care-network-refresh.service lemvori-care-network.timer; do
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
lemvori-carectl health
echo 'Management: sudo lemvori-carectl {status|logs|health|network|restart}'
echo 'Import /etc/lemvori-care/ca/ca.crt on other Qt/Android devices. Restrict TCP 8443 to trusted LAN.'
