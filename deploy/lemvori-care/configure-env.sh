#!/usr/bin/env bash
# Create first-install defaults without replacing an existing center configuration.
set -Eeuo pipefail
umask 077
[[ $# -eq 1 ]] || { echo 'Usage: configure-env.sh SERVER_ENV' >&2; exit 2; }
env_file=$1
if [[ -e $env_file || -L $env_file ]]; then
  [[ -f $env_file && ! -L $env_file && -s $env_file && -r $env_file ]] || {
    echo 'Existing server configuration is not a readable, non-empty regular file. Review it before reinstalling.' >&2
    exit 1
  }
  exit 0
fi
pending=$(mktemp "$(dirname -- "$env_file")/.server.env.XXXXXXXX")
trap 'rm -f -- "$pending"' EXIT
cat > "$pending" <<'ENV'
LEMVORI_DATABASE_URL="host=127.0.0.1 port=5432 dbname=lemvori_core user=lemvori_app"
PGPASSFILE=/etc/lemvori-care/pgpass
LEMVORI_LICENSE_REQUIRED=1
LEMVORI_LICENSE_PUBLIC_KEY=/etc/lemvori-care/license/publisher.pem
TZ=Europe/Kyiv
ENV
chmod 0640 "$pending"
# A hard link publishes the complete file atomically and refuses a concurrent
# creator; mv would overwrite that creator's configuration.
ln -- "$pending" "$env_file"
