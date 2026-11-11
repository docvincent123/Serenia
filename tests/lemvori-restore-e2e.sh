#!/usr/bin/env bash
# GitHub Actions integration test only. Runs against a temporary CI PostgreSQL.
set -Eeuo pipefail
umask 077
[[ $CI == true ]] || { echo "CI only: refusing to touch a non-CI database" >&2; exit 2; }
[[ $EUID != 0 ]] || { echo "Run from the unprivileged CI worker, not directly as root" >&2; exit 2; }
for bin in psql pg_dump pg_restore curl sudo systemctl; do command -v "$bin" >/dev/null; done

# CI previous step already initializes lemvori_core and activates an ED25519
# license. The following config matches deploy/lemvori-care/install.sh.
sudo install -d -o root -g root -m 0755 /opt/lemvori-care
sudo install -d -o lemvori-care -g lemvori-care -m 0750 /var/lib/lemvori-care
sudo install -d -o root -g lemvori-care -m 0750 /etc/lemvori-care /etc/lemvori-care/license
sudo install -o root -g root -m 0755 build/lemvori-ci/SolviaServer /opt/lemvori-care/lemvori-care-api
sudo install -o root -g root -m 0755 deploy/lemvori-care/network-tls.sh /opt/lemvori-care/network-tls.sh
sudo install -o root -g root -m 0755 deploy/lemvori-care/network-address.py /opt/lemvori-care/network-address.py
sudo install -o root -g root -m 0755 deploy/lemvori-care/restore.sh /opt/lemvori-care/restore.sh
sudo install -o root -g root -m 0755 deploy/lemvori-care/lemvori-carectl /usr/local/sbin/lemvori-carectl
sudo install -o root -g lemvori-care -m 0644 "$RUNNER_TEMP/license-public.pem" /etc/lemvori-care/license/publisher.pem
cat > "$RUNNER_TEMP/server.env" <<'ENV'
LEMVORI_DATABASE_URL="host=127.0.0.1 port=5432 dbname=lemvori_core user=lemvori_app"
PGPASSFILE=/etc/lemvori-care/pgpass
LEMVORI_LICENSE_REQUIRED=1
LEMVORI_LICENSE_PUBLIC_KEY=/etc/lemvori-care/license/publisher.pem
ENV
sudo install -o root -g lemvori-care -m 0640 "$RUNNER_TEMP/server.env" /etc/lemvori-care/server.env
printf '127.0.0.1:5432:lemvori_core:lemvori_app:local-ci-password-only\n' > "$RUNNER_TEMP/dbpass"
sudo install -o lemvori-care -g lemvori-care -m 0600 "$RUNNER_TEMP/dbpass" /etc/lemvori-care/pgpass
for unit in lemvori-care.service lemvori-care-network.service lemvori-care-network-refresh.service lemvori-care-network.timer; do
  sudo install -o root -g root -m 0644 "deploy/lemvori-care/$unit" "/etc/systemd/system/$unit"
done
sudo systemctl daemon-reload
sudo systemctl start lemvori-care.service
sudo systemctl start lemvori-care-network.timer
for attempt in $(seq 1 25); do
  if sudo lemvori-carectl health >/dev/null 2>&1; then break; fi
  sleep 1
done
sudo lemvori-carectl health
sudo lemvori-carectl backup
sudo lemvori-carectl list-backups
original=$(sudo -u postgres psql -At -d lemvori_core -c 'SELECT center_name FROM center_settings WHERE id=1')
[[ $original == 'CI Лемворі Центр' ]] || { echo "License center name unexpected" >&2; exit 1; }
sudo -u postgres psql -d lemvori_core -c "UPDATE center_settings SET center_name='MUTATED_AFTER_BACKUP' WHERE id=1"
[[ $(sudo -u postgres psql -At -d lemvori_core -c 'SELECT center_name FROM center_settings WHERE id=1') == 'MUTATED_AFTER_BACKUP' ]] || exit 1

# Corrupt archive must not stop service or overwrite the live database.
sudo install -d -o root -g root -m 0700 /var/backups/lemvori-care
echo INVALID > "$RUNNER_TEMP/corrupt.dump"
sudo install -o root -g root -m 0600 "$RUNNER_TEMP/corrupt.dump" \
  /var/backups/lemvori-care/lemvori-core-corrupt.dump
if sudo lemvori-carectl restore /var/backups/lemvori-care/lemvori-core-corrupt.dump 'ВІДНОВИТИ'; then
  echo "Corrupt archive unexpectedly accepted" >&2; exit 1
fi
sudo rm -f /var/backups/lemvori-care/lemvori-core-corrupt.dump
sudo lemvori-carectl health >/dev/null
[[ $(sudo -u postgres psql -At -d lemvori_core -c 'SELECT center_name FROM center_settings WHERE id=1') == 'MUTATED_AFTER_BACKUP' ]] || exit 1

# Full staging restore / stop service / pre-restore snapshot / swap / health.
archive=$(sudo find /var/backups/lemvori-care -maxdepth 1 -name 'lemvori-core-*.dump' -type f | head -n 1)
sudo lemvori-carectl restore "$archive" 'ВІДНОВИТИ'
sudo lemvori-carectl health
restored=$(sudo -u postgres psql -At -d lemvori_core -c 'SELECT center_name FROM center_settings WHERE id=1')
[[ $restored == "$original" ]] || { echo "Restored center name mismatch" >&2; exit 1; }
sudo -u postgres psql -At -d lemvori_core -c 'SELECT count(*) FROM sessions' | grep -qx 0
sudo find /var/backups/lemvori-care -maxdepth 1 -name 'lemvori-core-pre-restore-*.dump' | grep -q .
sudo -u postgres psql -At -d postgres -c "SELECT datname FROM pg_database WHERE datname LIKE 'lemvori_previous_%'" | grep -q .
echo "PASS: corrupted backup rejected; active DB unchanged; verified staged restore + safety snapshot + HTTPS health + session revocation"
# Simulate a failed API restart AFTER cutover. The script must put the
# original live database back, not merely print a warning.
rollback_archive=$(sudo lemvori-carectl backup | sed 's/^.*: //')
sudo -u postgres psql -d lemvori_core -c "UPDATE center_settings SET center_name='LIVE_MUTATION_FOR_ROLLBACK' WHERE id=1"
sudo install -d -o root -g root -m 0755 /run/systemd/system/lemvori-care.service.d
printf '[Service]\nExecStart=\nExecStart=/usr/bin/false\n' > "$RUNNER_TEMP/force-failure.conf"
sudo install -o root -g root -m 0644 "$RUNNER_TEMP/force-failure.conf" \
    /run/systemd/system/lemvori-care.service.d/failure.conf
sudo systemctl daemon-reload
if sudo lemvori-carectl restore "$rollback_archive" 'ВІДНОВИТИ'; then
  echo "Restore should fail when HTTPS server cannot start" >&2; exit 1
fi
sudo rm -f /run/systemd/system/lemvori-care.service.d/failure.conf
sudo systemctl daemon-reload
sudo systemctl restart lemvori-care.service
sudo lemvori-carectl health >/dev/null
[[ $(sudo -u postgres psql -At -d lemvori_core -c 'SELECT center_name FROM center_settings WHERE id=1') == 'LIVE_MUTATION_FOR_ROLLBACK' ]] || {
  echo "Automatic rollback did not keep the pre-restore live data" >&2; exit 1
}
echo "PASS: simulated failed HTTPS startup rolled back to original live PostgreSQL database"

