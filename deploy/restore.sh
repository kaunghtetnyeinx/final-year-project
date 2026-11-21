#!/bin/bash
# Restore a database backup made by deploy/backup.sh.
#
#   sudo bash deploy/restore.sh --check <backup.sql.gz>
#       Safe test: loads the backup into a scratch database (restore_check), prints row
#       counts next to the live database, then deletes the scratch copy. Live data is not
#       touched. Run it monthly so you know the backups really work.
#
#   sudo bash deploy/restore.sh <backup.sql.gz> [uploads.tar.gz]
#       Real restore: REPLACES the live database (and photos, if given). Takes a fresh
#       backup first, stops the API while restoring, then starts everything again.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

CHECK=false
if [ "${1:-}" = "--check" ]; then CHECK=true; shift; fi
FILE=${1:-}
PHOTOS=${2:-}
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: $0 [--check] <backup.sql.gz> [uploads.tar.gz]"; exit 2; }
gunzip -t "$FILE" || { echo "$FILE is not a valid gzip file"; exit 1; }

DB=project_poin
# The root password is read inside the container, so it never shows in the host's process list.
sql() { docker compose exec -T mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N "$@"' sh "$@"; }
TABLES="users products recipes transactions transaction_items stock_movements"
counts() {
  for t in $TABLES; do printf "%-18s %s\n" "$t" "$(sql "$1" -e "SELECT COUNT(*) FROM $t" 2>/dev/null || echo missing)"; done
}

if $CHECK; then
  echo "Loading $FILE into scratch database restore_check ..."
  sql -e "DROP DATABASE IF EXISTS restore_check; CREATE DATABASE restore_check"
  gunzip -c "$FILE" | sql restore_check
  echo
  echo "Rows in backup:";        counts restore_check
  echo
  echo "Rows in live database:"; counts "$DB"
  sql -e "DROP DATABASE restore_check"
  echo
  echo "OK: the backup restores cleanly (scratch copy deleted; live data untouched)."
  exit 0
fi

echo "This REPLACES the live database with $FILE${PHOTOS:+ and photos from $PHOTOS}."
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

echo "Taking a safety backup of the current data first ..."
bash deploy/backup.sh
docker compose stop pos-api
sql -e "DROP DATABASE $DB; CREATE DATABASE $DB"
gunzip -c "$FILE" | sql "$DB"
# The API's limited user keeps its grant on the database name, so nothing else to redo.
if [ -n "$PHOTOS" ]; then
  docker compose run --rm --no-deps -T --entrypoint sh pos-api -c 'rm -rf /app/uploads/* && tar -C /app/uploads -xzf -' < "$PHOTOS"
fi
# Starting again runs pos-migrate, so an older backup is brought up to the current schema.
docker compose up -d
echo "Restored. Rows now:"; counts "$DB"
