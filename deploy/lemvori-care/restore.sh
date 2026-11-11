#!/usr/bin/env bash
# Restore root-controlled Lemvori Care custom backups with staging, verification,
# safety snapshot, database renames and automatic rollback. No in-place restore.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
file="$1"; confirmation="$2"
[[ $confirmation == 'ВІДНОВИТИ' ]] || { echo 'Type ВІДНОВИТИ to proceed' >&2; exit 2; }
[[ -f $file && ! -L $file && $file == *.dump ]] || { echo 'Select a .dump file' >&2; exit 2; }
source_path=$(realpath -e -- "$file")
case "$source_path" in
  /var/backups/lemvori-care/lemvori-core-*.dump) ;;
  *) echo 'Backup must be in /var/backups/lemvori-care and created by this system' >&2; exit 2 ;;
esac
[[ $(stat -c %u "$source_path") == 0 && $(stat -c %a "$source_path") == 600 ]] || {
  echo 'Backup must be root-owned with 0600 permissions' >&2; exit 2;
}
[[ -s $source_path ]] || { echo 'Empty backup' >&2; exit 2; }
[[ -f /etc/lemvori-care/pgpass ]] || { echo 'Missing PostgreSQL credentials' >&2; exit 1; }
install -d -o root -g root -m 0700 /run/lemvori-care /var/backups/lemvori-care
exec 9>/run/lemvori-care/db-maintenance.lock
flock -n 9 || { echo 'Another DB operation is running' >&2; exit 1; }

suffix=$(date -u +%Y%m%d%H%M%S)_$$_$RANDOM
stage="lemvori_stage_$suffix"
retired="lemvori_previous_$suffix"
failed_db="lemvori_failed_$suffix"
backup="/var/backups/lemvori-care/lemvori-core-pre-restore-$suffix.dump"
tmpbackup=$(mktemp /var/backups/lemvori-care/.safety.XXXXXXXX)
tmppass=$(mktemp /etc/lemvori-care/.pgpass-stage.XXXXXXXX)
tmpdump=$(mktemp /etc/lemvori-care/.restore.XXXXXXXX)
# PostgreSQL custom archives need seekable files, not stdin pipes.
# Keep the source root-only; expose a read-only temporary copy just to
# the unprivileged Lemvori service group during staged restore.
cp -- "$source_path" "$tmpdump"
chown root:lemvori-care "$tmpdump"
chmod 0440 "$tmpdump"
stage_created=0
old_renamed=0
new_promoted=0
service_stopped=0
api_was_active=0
timer_was_active=0
committed=0

# Stage database needs a wildcard in a temporary protected .pgpass copy only.
sed -E 's/^127[.]0[.]0[.]1:5432:lemvori_core:lemvori_app:/127.0.0.1:5432:*:lemvori_app:/' \
  /etc/lemvori-care/pgpass > "$tmppass"
chown lemvori-care:lemvori-care "$tmppass"
chmod 0600 "$tmppass"

pg_admin() { runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -p 5432 -d postgres "$@"; }
pg_app() {
  local database="$1"; shift
  runuser -u lemvori-care -- env PGPASSFILE="$tmppass" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U lemvori_app -d "$database" "$@"
}
exists() {
  [[ $(pg_admin -Atc "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname='$1')") == t ]]
}
disconnect_db() {
  pg_admin -Atc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$1' AND pid<>pg_backend_pid()" >/dev/null
}
resume() {
  if (( api_was_active )); then systemctl start lemvori-care.service || true; fi
  if (( timer_was_active )); then systemctl start lemvori-care-network.timer || true; fi
}
rollback() {
  echo 'Restore cutover failed: rolling back old database' >&2
  systemctl stop lemvori-care.service >/dev/null 2>&1 || true
  if (( new_promoted )) && exists lemvori_core; then
    disconnect_db lemvori_core || true
    pg_admin -c "ALTER DATABASE lemvori_core RENAME TO $failed_db" || true
  fi
  if (( old_renamed )) && exists "$retired"; then
    disconnect_db "$retired" || true
    pg_admin -c "ALTER DATABASE $retired RENAME TO lemvori_core" || true
  fi
  resume
}
finish() {
  local status=$?
  trap - EXIT INT TERM
  if (( ! committed )); then
    if (( old_renamed || new_promoted )); then rollback
    elif (( service_stopped )); then resume
    fi
    if (( stage_created )) && exists "$stage"; then
      disconnect_db "$stage" || true
      pg_admin -c "DROP DATABASE $stage" || true
    fi
  fi
  rm -f -- "$tmppass" "$tmpbackup" "$tmpdump"
  (( status == 0 )) || echo 'Restore did not complete. Inspect service and backup logs.' >&2
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pg_restore --list "$source_path" >/dev/null
pg_admin -c "CREATE DATABASE $stage OWNER lemvori_app TEMPLATE template0"
stage_created=1
echo "Checking selected archive in isolated database: $stage"
# Run restore as unprivileged app DB role, NOT PostgreSQL superuser.
runuser -u lemvori-care -- env PGPASSFILE="$tmppass" \
  pg_restore --exit-on-error --no-owner --no-privileges --single-transaction \
    -h 127.0.0.1 -p 5432 -U lemvori_app -d "$stage" "$tmpdump"

for table in installation_identity center_settings users patients sessions center_license; do
  [[ $(pg_app "$stage" -Atc "SELECT to_regclass('public.$table') IS NOT NULL") == t ]] || {
    echo "Required table missing: $table" >&2; exit 1;
  }
done
old_id=$(pg_app lemvori_core -Atc 'SELECT server_id FROM installation_identity WHERE id=1')
new_id=$(pg_app "$stage" -Atc 'SELECT server_id FROM installation_identity WHERE id=1')
[[ $old_id =~ ^[a-f0-9]{64}$ && $new_id == "$old_id" ]] || {
  echo 'Backup server identity differs: refusing to restore data from another center' >&2; exit 1;
}
[[ $(pg_app "$stage" -Atc 'SELECT count(*) FROM center_settings WHERE id=1') == 1 ]] || {
  echo 'Missing center configuration' >&2; exit 1;
}
active_admins=$(pg_app "$stage" -Atc "SELECT count(*) FROM users WHERE role='admin' AND active=TRUE")
(( active_admins > 0 )) || { echo 'Missing active administrator' >&2; exit 1; }
pg_app "$stage" -c 'DELETE FROM sessions' >/dev/null

if systemctl is-active --quiet lemvori-care.service; then api_was_active=1; fi
(( api_was_active )) || { echo 'Lemvori API must be running for verified cutover' >&2; exit 1; }
if systemctl is-active --quiet lemvori-care-network.timer; then timer_was_active=1; fi
systemctl stop lemvori-care-network.timer >/dev/null 2>&1 || true
service_stopped=1
systemctl stop lemvori-care.service

echo 'Saving pre-restore safety copy of the original center database'
runuser -u lemvori-care -- env PGPASSFILE=/etc/lemvori-care/pgpass \
  pg_dump --format=custom --no-owner --no-privileges -h 127.0.0.1 -p 5432 \
  -U lemvori_app -d lemvori_core > "$tmpbackup"
pg_restore --list "$tmpbackup" >/dev/null
chmod 0600 "$tmpbackup"
mv -n -- "$tmpbackup" "$backup"

disconnect_db lemvori_core
pg_admin -c "ALTER DATABASE lemvori_core RENAME TO $retired"
old_renamed=1
disconnect_db "$stage"
pg_admin -c "ALTER DATABASE $stage RENAME TO lemvori_core"
new_promoted=1
stage_created=0

systemctl start lemvori-care.service
healthy=0
for attempt in $(seq 1 25); do
  response=$(curl --noproxy '*' --fail --silent --show-error --max-time 2 \
    --cacert /etc/lemvori-care/ca/ca.crt https://127.0.0.1:8443/api/health 2>/dev/null || true)
  response_id=$(printf '%s' "$response" | python3 -c \
    'import json,sys;d=json.load(sys.stdin);print(d["server_id"] if d.get("ok") is True else "")' 2>/dev/null || true)
  if [[ $response_id == "$new_id" ]]; then healthy=1; break; fi
  sleep 1
done
(( healthy )) || { echo 'New HTTPS service failed health / identity check' >&2; exit 1; }
if (( timer_was_active )); then systemctl start lemvori-care-network.timer; fi
committed=1
echo "RESTORED: lemvori_core | previous DB retained: $retired"
echo "Pre-restore safety archive: $backup"
echo 'All restored login sessions were revoked; workers must log in again.'
