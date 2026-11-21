#!/bin/bash
# Nightly database backup. Keeps 14 days on the server; also copies to S3 if S3_BUCKET is set.
# Install (once):  sudo crontab -e   then add:
#   0 19 * * * /home/ubuntu/Juniper-Cafe-POS/deploy/backup.sh >> /var/log/pos-backup.log 2>&1
#   (19:00 UTC = 03:00 Malaysia time)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
DIR=/var/backups/pos
mkdir -p "$DIR"
FILE="$DIR/project_poin-$(date -u +%Y%m%d-%H%M).sql.gz"
docker compose exec -T mariadb sh -c \
  'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers "$MARIADB_DATABASE"' \
  | gzip > "$FILE"
echo "$(date -u) backup written: $FILE ($(du -h "$FILE" | cut -f1))"
find "$DIR" -name 'project_poin-*.sql.gz' -mtime +14 -delete
if [ -n "${S3_BUCKET:-}" ]; then
  aws s3 cp "$FILE" "s3://${S3_BUCKET}/db-backups/" --only-show-errors
  echo "copied to s3://${S3_BUCKET}/db-backups/"
fi
