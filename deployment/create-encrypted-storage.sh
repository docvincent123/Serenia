#!/usr/bin/env bash
# Create a NEW LUKS2 volume. Never formats an existing path or migrates live data.
set -Eeuo pipefail
if [[ $# != 3 ]]; then echo 'Usage: sudo bash create-encrypted-storage.sh /new/lemvori-data.luks /mnt/lemvori-secure SIZE_GIB' >&2; exit 2; fi
image=$1
mountpoint=$2
size_gib=$3
[[ $EUID -eq 0 ]] || { echo 'Run on the center Linux server as root.' >&2; exit 1; }
[[ $image == /* && $mountpoint == /* && $image != / && $mountpoint != / ]] || { echo 'Use absolute new paths.' >&2; exit 2; }
[[ $size_gib =~ ^[0-9]{1,4}$ && $size_gib -ge 8 && $size_gib -le 2048 ]] || { echo 'Size: 8–2048 GiB.' >&2; exit 2; }
[[ ! -e $image && ! -L $image && ! -e $mountpoint && ! -L $mountpoint ]] || { echo 'Both paths must be new. Existing data is never overwritten.' >&2; exit 1; }
for program in cryptsetup fallocate mkfs.ext4 mount install stat dirname; do command -v "$program" >/dev/null || { echo "Install prerequisite: $program" >&2; exit 1; }; done
secure_parent(){
  local directory permission
  directory=$(dirname -- "$1")
  while [[ $directory != / ]]; do
    [[ -d $directory && ! -L $directory && $(stat -c %u -- "$directory") == 0 ]] || { echo 'Every parent directory must be root-owned and free of symlinks.' >&2; exit 1; }
    permission=$(stat -c %a -- "$directory")
    (( (8#$permission & 0022) == 0 )) || { echo 'A parent directory is writable by another user.' >&2; exit 1; }
    directory=$(dirname -- "$directory")
  done
}
[[ $image != *'/../'* && $image != *'/./'* && $mountpoint != *'/../'* && $mountpoint != *'/./'* ]] || exit 2
secure_parent "$image"
secure_parent "$mountpoint"
id postgres >/dev/null 2>&1 || { echo 'Install PostgreSQL first; its postgres account must exist.' >&2; exit 1; }
mapper="lemvori-new-$$"
opened=false
mounted=false
cleanup(){ if [[ $mounted == false && $opened == true ]]; then cryptsetup close "$mapper" || true; fi; }
trap cleanup EXIT
umask 077
# noclobber protects the new image even if another process creates the path.
(set -o noclobber; : > "$image")
fallocate -l "${size_gib}G" "$image"
cryptsetup luksFormat --type luks2 --cipher aes-xts-plain64 --key-size 512 --pbkdf argon2id --verify-passphrase "$image"
cryptsetup open "$image" "$mapper"
opened=true
mkfs.ext4 -L LemvoriData "/dev/mapper/$mapper"
install -d -m 0700 "$mountpoint"
mount "/dev/mapper/$mapper" "$mountpoint"
mounted=true
install -d -m 0700 "$mountpoint/postgresql" "$mountpoint/documents" "$mountpoint/backups"
chown postgres:postgres "$mountpoint/postgresql"
echo "Encrypted volume mounted at $mountpoint."
echo 'No existing database was moved. Keep a verified backup and a recovery copy of the LUKS header before migration.'
echo 'Configure PostgreSQL data_directory, document storage and backups within this volume, then verify all three paths.'
echo 'The passphrase was not stored. A reboot requires unlocking the volume before PostgreSQL starts.'
