#!/usr/bin/env bash
# Provision the dedicated local database. Existing database credentials are retained.
set -Eeuo pipefail
umask 077

[[ $# -eq 1 ]] || { echo 'Usage: provision-postgres.sh PGPASSFILE' >&2; exit 2; }
pgpass=$1
connection='host=127.0.0.1 port=5432 dbname=lemvori_core user=lemvori_app'
credential_prefix='127.0.0.1:5432:lemvori_core:lemvori_app:'
pending=
trap 'if [[ -n $pending ]]; then rm -f -- "$pending"; fi' EXIT

as_postgres() {
  runuser -u postgres -- psql -XqAt -v ON_ERROR_STOP=1 \
    -h /var/run/postgresql -p 5432 -U postgres -d postgres "$@"
}

check_connection() {
  runuser -u lemvori-care -- env -u PGPASSWORD PGPASSFILE="$1" \
    psql -XqAtw -v ON_ERROR_STOP=1 "$connection" \
    -c "SELECT has_schema_privilege(current_user, 'public', 'CREATE')"
}

stage_password() {
  local password=$1
  password=${password//\\/\\\\}
  password=${password//:/\\:}
  pending=$(mktemp "$(dirname -- "$pgpass")/.pgpass.XXXXXXXX")
  printf '%s%s\n' "$credential_prefix" "$password" > "$pending"
  chown lemvori-care:lemvori-care "$pending"
  chmod 0600 "$pending"
}

if [[ -e $pgpass || -L $pgpass ]]; then
  [[ -f $pgpass && ! -L $pgpass && -s $pgpass ]] || {
    echo 'Review the existing PostgreSQL password file before installing.' >&2
    exit 1
  }
  chown lemvori-care:lemvori-care "$pgpass"
  chmod 0600 "$pgpass"
  if [[ $(check_connection "$pgpass" 2>/dev/null) == t ]]; then exit 0; fi
fi

role_exists=$(as_postgres -c "SELECT EXISTS(SELECT FROM pg_roles WHERE rolname='lemvori_app')")
db_exists=$(as_postgres -c "SELECT EXISTS(SELECT FROM pg_database WHERE datname='lemvori_core')")
if [[ $role_exists == f ]]; then
  [[ $db_exists == f ]] || {
    echo 'lemvori_core exists without lemvori_app. Check database ownership before installing.' >&2
    exit 1
  }
  if [[ ! -f $pgpass ]]; then
    stage_password "$(openssl rand -hex 32)"
    ln -- "$pending" "$pgpass"
    rm -- "$pending"
    pending=
  fi
  # Recover the generated credential if interrupted before the role was committed.
  credential=$(<"$pgpass")
  password=${credential#"$credential_prefix"}
  [[ $credential == "$credential_prefix"* && $password =~ ^[0-9a-f]{64}$ ]] || {
    echo 'lemvori_app is missing and the password file does not contain an installer-generated credential.' >&2
    exit 1
  }
  # psql reads password prompts from the pipe in a session without a TTY.
  # \password encrypts locally, and the transaction prevents a half-created role.
  printf 'BEGIN;\nSET LOCAL password_encryption = %s;\nCREATE ROLE lemvori_app LOGIN;\n\\password lemvori_app\n%s\n%s\nCOMMIT;\n' \
    "'scram-sha-256'" "$password" "$password" |
    setsid --wait runuser -u postgres -- psql -Xq -v ON_ERROR_STOP=1 \
      -h /var/run/postgresql -p 5432 -U postgres -d postgres >/dev/null
  unset password credential
fi

if [[ $db_exists == f ]]; then
  as_postgres -c 'CREATE DATABASE lemvori_core OWNER lemvori_app'
fi

if [[ ! -f $pgpass ]]; then
  read -r -s -p 'Existing PostgreSQL password for lemvori_app: ' password
  printf '\n'
  [[ -n $password && $password != *$'\r'* ]] || { echo 'A password is required.' >&2; exit 1; }
  stage_password "$password"
  unset password
fi

[[ $(check_connection "${pending:-$pgpass}") == t ]] || {
  echo 'lemvori_app must be able to log in and create tables in lemvori_core.public.' >&2
  exit 1
}
if [[ -n $pending ]]; then ln -- "$pending" "$pgpass"; fi
