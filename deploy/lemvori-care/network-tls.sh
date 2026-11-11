#!/usr/bin/env bash
# Rotate only the server certificate when LAN IPv4 changes. Never replace an existing CA.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
config=/etc/lemvori-care
ca=$config/ca
tls=$config/tls
install -d -m 0750 -o root -g lemvori-care "$config" "$tls"
install -d -m 0700 -o root -g root "$ca" /run/lemvori-care
exec 9>/run/lemvori-care/network.lock
flock -x 9
old=$(cat "$config/address" 2>/dev/null || true)
ip=$(python3 /opt/lemvori-care/network-address.py "$old")
work=$(mktemp -d "$config/.tls-work.XXXXXXXX")
trap 'rm -rf "$work"' EXIT

if [[ ! -f $ca/ca.crt || ! -f $ca/ca.key ]]; then
    if [[ -e $ca/ca.crt || -e $ca/ca.key ]]; then
        echo "Incomplete local CA: restore original ca.key and ca.crt. Refusing to replace trust." >&2
        exit 1
    fi
    openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
        -subj "/CN=Lemvori Care Local CA" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        -keyout "$work/ca.key" -out "$work/ca.crt" >/dev/null 2>&1
    install -o root -g root -m 0600 "$work/ca.key" "$ca/ca.key"
    install -o root -g root -m 0644 "$work/ca.crt" "$ca/ca.crt"
fi

renew=1
if [[ -f $tls/server.crt && -f $tls/server.key ]] &&
    openssl x509 -checkend 2592000 -noout -in "$tls/server.crt" >/dev/null 2>&1 &&
    openssl verify -CAfile "$ca/ca.crt" -verify_ip "$ip" "$tls/server.crt" >/dev/null 2>&1 &&
    openssl verify -CAfile "$ca/ca.crt" -verify_hostname localhost "$tls/server.crt" >/dev/null 2>&1; then
    renew=0
fi
if (( renew )); then
    openssl req -new -newkey rsa:2048 -nodes \
        -subj "/CN=Lemvori Care API" \
        -keyout "$work/server.key" -out "$work/server.csr" >/dev/null 2>&1
    printf 'subjectAltName=IP:%s,IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$ip" > "$work/extensions"
    openssl x509 -req -in "$work/server.csr" -CA "$ca/ca.crt" -CAkey "$ca/ca.key" \
        -set_serial "0x$(openssl rand -hex 16)" -days 365 -sha256 \
        -extfile "$work/extensions" -out "$work/server.crt" >/dev/null 2>&1
    openssl verify -CAfile "$ca/ca.crt" -verify_ip "$ip" "$work/server.crt" >/dev/null
    openssl verify -CAfile "$ca/ca.crt" -verify_hostname localhost "$work/server.crt" >/dev/null
    install -o root -g lemvori-care -m 0640 "$work/server.key" "$tls/server.key"
    install -o root -g lemvori-care -m 0644 "$work/server.crt" "$tls/server.crt"
fi
if [[ $ip != "$old" ]]; then
    printf '%s\n' "$ip" > "$work/address"
    install -o root -g root -m 0644 "$work/address" "$config/address"
    echo "Lemvori Care IP: ${old:-unset} -> $ip"
fi
if (( renew )); then echo "Lemvori Care HTTPS certificate renewed (CA retained)"; fi
flock -u 9
if [[ ${1:-} != --no-restart ]] && { (( renew )) || [[ $ip != "$old" ]]; }; then
    if systemctl is-active --quiet lemvori-care.service; then
        systemctl restart lemvori-care.service
    fi
fi
