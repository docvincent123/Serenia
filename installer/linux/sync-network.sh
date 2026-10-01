#!/usr/bin/env bash
# Root-only network/TLS maintenance. No CA replacement and no database reset.
set -Eeuo pipefail
umask 027
[[ $EUID == 0 ]] || exit 1
install -d -m 0700 /run/solvia-admin
exec 6>/run/solvia-admin/network.lock
flock 6
old=$(cat /etc/solvia/address 2>/dev/null || true)
ip=$(python3 /opt/solvia/network-address.py "$old")
if [[ $old != "$ip" ]]; then
  printf '%s\n' "$ip" > /etc/solvia/address.new
  chmod 0644 /etc/solvia/address.new
  mv /etc/solvia/address.new /etc/solvia/address
  install -m 0644 /etc/solvia/address /usr/local/share/solvia/address
  echo "SOLVIA LAN address: $old -> $ip"
fi
before=$(sha256sum /etc/solvia/tls/server.crt 2>/dev/null || true)
/opt/solvia/renew-certificate.sh --no-restart
after=$(sha256sum /etc/solvia/tls/server.crt)
flock -u 6
if [[ ${1:-} != --no-restart ]] && systemctl is-enabled --quiet solvia.service; then
  if [[ $before != "$after" ]]; then
    systemctl restart solvia.service
  elif ! systemctl is-active --quiet solvia.service; then
    systemctl start solvia.service
  fi
fi
