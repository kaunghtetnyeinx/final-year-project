#!/bin/bash
# Nightly backup: the database, plus uploaded product photos. Keeps 14 days on the server;
# also copies to S3 if S3_BUCKET is set. Prove a backup can be restored with:
#   sudo bash deploy/restore.sh --check /var/backups/pos/project_poin-<date>.sql.gz
#
# Install the nightly run (once), either with the systemd timer:
#   sudo cp deploy/systemd/pos-backup.* /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now pos-backup.timer
# or with cron:  sudo crontab -e   then add:
#   0 19 * * * /bin/bash /home/ubuntu/final-year-project/deploy/backup.sh >> /var/log/pos-backup.log 2>&1
#   (19:00 UTC = 03:00 Malaysia time)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
DIR=/var/backups/pos
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%d-%H%M)
FILE="$DIR/project_poin-$STAMP.sql.gz"
docker compose exec -T mariadb sh -c \
  'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers "$MARIADB_DATABASE"' \
  | gzip > "$FILE"
# A dump that ends early (database stopped mid-way) is not a backup: check it is complete.
if ! gunzip -c "$FILE" | tail -n 5 | grep -q "Dump completed"; then
  echo "$(date -u) ERROR: $FILE is incomplete" >&2
  exit 1
fi
echo "$(date -u) backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Uploaded photos live in the API container's volume.
PHOTOS="$DIR/uploads-$STAMP.tar.gz"
if docker compose exec -T pos-api tar -C /app/uploads -czf - . > "$PHOTOS" 2>/dev/null; then
  echo "$(date -u) photos written: $PHOTOS ($(du -h "$PHOTOS" | cut -f1))"
else
  rm -f "$PHOTOS"
  echo "$(date -u) WARNING: could not copy uploaded photos (is pos-api running?)"
fi

find "$DIR" \( -name 'project_poin-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -mtime +14 -delete
if [ -n "${S3_BUCKET:-}" ]; then
  aws s3 cp "$FILE" "s3://${S3_BUCKET}/db-backups/" --only-show-errors
  [ -f "$PHOTOS" ] && aws s3 cp "$PHOTOS" "s3://${S3_BUCKET}/db-backups/" --only-show-errors
  echo "copied to s3://${S3_BUCKET}/db-backups/"
fi
