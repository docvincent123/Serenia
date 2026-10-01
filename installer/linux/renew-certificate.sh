#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
install -d -m 0700 -o root -g root /run/solvia-admin
exec 8>/run/solvia-admin/certificate.lock
flock 8
ca=/etc/solvia/ca
tls=/etc/solvia/tls
ip=$(cat /etc/solvia/address)
if [[ ! -f $ca/ca.key ]]; then
  [[ ! -f $ca/QureMed-Local-CA.crt ]] || { echo 'CA key missing; restore original CA backup'; exit 1; }
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -sha256 \
    -subj '/CN=QureMed SOLVIA Local CA' -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout "$ca/ca.key" -out "$ca/QureMed-Local-CA.crt"
fi
if [[ ${1:-} != --force && -f $tls/server.crt ]] && openssl x509 -checkend 2592000 -noout -in "$tls/server.crt" && openssl x509 -checkip "$ip" -noout -in "$tls/server.crt" && openssl x509 -checkhost localhost -noout -in "$tls/server.crt"; then exit 0; fi
work=$(mktemp -d "$tls/.renew.XXXXXX")
trap 'rm -rf "$work"' EXIT
openssl req -new -newkey rsa:2048 -nodes -subj '/CN=SOLVIA Server' -keyout "$work/server.key" -out "$work/server.csr"
printf 'subjectAltName=IP:%s,IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$ip" > "$work/extensions"
openssl x509 -req -in "$work/server.csr" -CA "$ca/QureMed-Local-CA.crt" -CAkey "$ca/ca.key" \
  -set_serial "0x$(openssl rand -hex 16)" -days 365 -sha256 -extfile "$work/extensions" -out "$work/server.crt"
openssl verify -CAfile "$ca/QureMed-Local-CA.crt" "$work/server.crt"
install -m 0640 -o root -g solvia "$work/server.key" "$tls/server.key"
install -m 0644 -o root -g solvia "$work/server.crt" "$tls/server.crt"
chmod 0644 "$ca/QureMed-Local-CA.crt"
flock -u 8
if [[ ${1:-} != --no-restart ]] && systemctl cat solvia.service >/dev/null 2>&1; then systemctl try-restart solvia.service; fi
