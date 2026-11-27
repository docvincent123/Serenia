#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $# == 1 ]] || exit 2
identity=$1
if [[ ! -e $identity && ! -L $identity ]]; then
  pending=$(mktemp "$(dirname -- "$identity")/.backup-key.XXXXXXXX")
  trap 'rm -f -- "$pending"' EXIT
  age-keygen > "$pending"
  ln -- "$pending" "$identity"
fi
[[ -f $identity && ! -L $identity && $(stat -c '%u:%a' -- "$identity") == 0:600 ]] || {
  echo 'Review the existing Lemvori Care backup identity and its permissions.' >&2
  exit 1
}
age-keygen -y "$identity" >/dev/null
