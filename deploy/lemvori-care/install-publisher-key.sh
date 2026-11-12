#!/usr/bin/env bash
# Explicit local trust provisioning. Never accepts private keys or rotates a different key.
set -Eeuo pipefail
umask 077
check_only=false
if [[ ${1:-} == --check ]]; then check_only=true; shift; fi
[[ $# -ge 1 && $# -le 2 ]] || { echo 'Usage: install-publisher-key [--check] PUBLIC.pem [SHA256]' >&2; exit 2; }
source_file=$1
expected=${2:-}
[[ -f $source_file && -r $source_file && ! -L $source_file ]] || { echo 'Select a readable public-key file, not a symbolic link.' >&2; exit 1; }
[[ $(stat -c '%s' -- "$source_file") -le 16384 ]] || { echo 'Public-key file is too large.' >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp -- "$source_file" "$work/public.pem"
if grep -q 'PRIVATE KEY' "$work/public.pem"; then echo 'Private signing keys must never be installed on the center server.' >&2; exit 1; fi
openssl pkey -pubin -in "$work/public.pem" -text -noout 2>/dev/null | grep -qi ED25519 || { echo 'Select an Ed25519 PUBLIC key exported by Lemvori Control.' >&2; exit 1; }
openssl pkey -pubin -in "$work/public.pem" -outform DER -out "$work/public.der" 2>/dev/null
fingerprint=$(sha256sum "$work/public.der"); fingerprint=${fingerprint%% *}
[[ -z $expected || ( $expected =~ ^[a-f0-9]{64}$ && $expected == "$fingerprint" ) ]] || { echo 'The selected key changed after confirmation. No changes made.' >&2; exit 1; }
if $check_only; then printf '%s\n' "$fingerprint"; exit 0; fi
[[ $EUID -eq 0 ]] || { echo 'Local system-administrator authorization is required.' >&2; exit 1; }
config=/etc/lemvori-care
key_file=$config/license/publisher.pem
env_file=$config/server.env
[[ -f $env_file && ! -L $env_file ]] || { echo 'Lemvori Care server configuration is missing on this computer.' >&2; exit 1; }
install -d -o root -g root -m 0700 /run/lemvori-care
exec 8>/run/lemvori-care/publisher-key.lock
flock -n 8 || { echo 'Publisher-key setup is already running.' >&2; exit 1; }
# Respect an existing custom trust configuration rather than silently replacing it.
configured=$(sed -nE 's/^LEMVORI_LICENSE_PUBLIC_KEY=(.*)$/\1/p' "$env_file" | tail -n 1)
[[ -n $configured ]] || configured=$(sed -nE 's/^SOLVIA_LICENSE_PUBLIC_KEY=(.*)$/\1/p' "$env_file" | tail -n 1)
configured=${configured#\"}; configured=${configured%\"}
configured=${configured#\'}; configured=${configured%\'}
[[ -z $configured || $configured == "$key_file" ]] || { echo 'A custom publisher-key path is configured. Review it locally before changing trust.' >&2; exit 1; }
if [[ -e $key_file || -L $key_file ]]; then
  [[ -f $key_file && ! -L $key_file ]] || { echo 'Unexpected existing publisher-key file.' >&2; exit 1; }
  openssl pkey -pubin -in "$key_file" -outform DER -out "$work/existing.der" 2>/dev/null
  cmp -s "$work/public.der" "$work/existing.der" || { echo 'A different publisher key is already trusted. Automatic replacement is refused.' >&2; exit 1; }
  if [[ $configured == "$key_file" ]] && grep -Eq '^LEMVORI_LICENSE_REQUIRED=1$' "$env_file"; then
    printf 'Publisher verification is already configured: %s\n' "$fingerprint"
    exit 0
  fi
else
  install -d -o root -g lemvori-care -m 0750 "$config/license"
  install -o root -g lemvori-care -m 0644 "$work/public.pem" "$key_file"
fi
# Atomically preserve the remaining server settings while enabling verification.
awk '!/^(LEMVORI|SOLVIA)_LICENSE_(PUBLIC_KEY|REQUIRED)=/' "$env_file" > "$work/server.env"
printf '\nLEMVORI_LICENSE_PUBLIC_KEY=%s\nLEMVORI_LICENSE_REQUIRED=1\n' "$key_file" >> "$work/server.env"
new_env=$(mktemp "$config/.server.env.XXXXXXXX")
trap 'rm -rf -- "$work"; rm -f -- "${new_env:-}"' EXIT
cat "$work/server.env" > "$new_env"
chown --reference="$env_file" "$new_env"
chmod --reference="$env_file" "$new_env"
mv -f -- "$new_env" "$env_file"
systemctl restart lemvori-care.service
printf 'Publisher key verified and installed: %s\n' "$fingerprint"
