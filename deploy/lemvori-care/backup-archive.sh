# Sourced by the root-only backup and restore commands.
backup_identity=/etc/lemvori-care/backup.agekey

check_backup_identity() {
  [[ -f $backup_identity && ! -L $backup_identity &&
     $(stat -c '%u:%a' -- "$backup_identity") == 0:600 ]] || {
    echo 'Lemvori Care backup identity is missing or has unsafe permissions.' >&2
    return 1
  }
}

capture_backup() {
  check_backup_identity || return
  local recipient
  recipient=$(age-keygen -y "$backup_identity") || return
  runuser -u lemvori-care -- env PGPASSFILE=/etc/lemvori-care/pgpass \
    pg_dump --format=custom --no-owner --no-privileges \
      -h 127.0.0.1 -p 5432 -U lemvori_app -d lemvori_core |
    age -r "$recipient"
}

read_backup() {
  case "$1" in
    *.dump.age) check_backup_identity && age --decrypt -i "$backup_identity" -- "$1" ;;
    *.dump) cat -- "$1" ;;
    *) return 2 ;;
  esac
}
