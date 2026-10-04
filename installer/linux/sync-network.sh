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
  if [[ -f /etc/solvia/server.env ]]; then
    sed -i -E "s/^SOLVIA_LAN_IP=.*/SOLVIA_LAN_IP=$ip/" /etc/solvia/server.env
    grep -q '^SOLVIA_LAN_IP=' /etc/solvia/server.env || printf 'SOLVIA_LAN_IP=%s\n' "$ip" >> /etc/solvia/server.env
  fi
  python3 - "$ip" /usr/local/share/solvia/SOLVIA-Mobile.solvia <<'PY'
import json,sys
ip,path=sys.argv[1:3]
data={
  "format":"quremed.solvia.mobile",
  "version":1,
  "center":"SOLVIA",
  "preferred":"https",
  "api_url":f"https://{ip}:8443",
  "https_url":f"https://{ip}:8443",
  "http_url":f"http://{ip}:8765",
}
with open(path,"w",encoding="utf-8") as f:
    json.dump(data,f,ensure_ascii=False,indent=2)
PY
  chmod 0644 /usr/local/share/solvia/SOLVIA-Mobile.solvia
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
  if systemctl is-enabled --quiet solvia-http.service; then
    systemctl restart solvia-http.service
  fi
fi
