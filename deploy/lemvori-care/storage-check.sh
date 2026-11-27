#!/usr/bin/env bash
set -Eeuo pipefail
required=()
case ${1:-} in
  --service) [[ ${LEMVORI_REQUIRE_LUKS:-0} == 1 ]] || exit 0; required=(--require-luks) ;;
  "") ;;
  *) exit 2 ;;
esac
db_dir=$(runuser -u postgres -- psql -XqAtw -h /var/run/postgresql -p 5432 -d postgres -c 'SHOW data_directory')
locations=$(runuser -u postgres -- psql -XqAtw -h /var/run/postgresql -p 5432 -d postgres \
  -c "SELECT pg_tablespace_location(oid) FROM pg_tablespace WHERE pg_tablespace_location(oid)<>''")
tablespaces=()
if [[ -n $locations ]]; then mapfile -t tablespaces <<< "$locations"; fi
python3 /opt/lemvori-care/check-encrypted-storage.py "${required[@]}" \
  "$db_dir" "$db_dir/pg_wal" /var/lib/lemvori-care /var/backups/lemvori-care /etc/lemvori-care/backup.agekey \
  "${tablespaces[@]}"
