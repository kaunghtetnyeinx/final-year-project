#!/bin/bash
# Auto-deploy: if GitHub has a new commit on the branch, pull it, rebuild, check health,
# and roll back to the previous commit if the new version is not healthy.
# Run by the systemd timer every 2 minutes (see deploy/systemd/). Safe to run by hand too.
set -uo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

# Only one deploy at a time.
exec 9>/tmp/pos-autodeploy.lock
flock -n 9 || { echo "another deploy is running; skipping"; exit 0; }

log() { echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') $*"; }

SITE=$(grep '^SITE_ADDRESS=' .env | cut -d= -f2)
healthy() {
  # Up to ~3 minutes: the API waits for the database, Caddy may renew a certificate.
  for _ in $(seq 1 36); do
    if curl -fsS --max-time 5 "https://${SITE}/api/health" >/dev/null 2>&1 \
      && curl -fsS --max-time 5 -o /dev/null "https://${SITE}/"; then
      return 0
    fi
    sleep 5
  done
  return 1
}

git fetch --quiet origin "$BRANCH" || { log "git fetch failed (network or deploy key)"; exit 1; }
CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse "origin/$BRANCH")
[ "$CURRENT" = "$TARGET" ] && exit 0   # nothing new: stay quiet
# A commit that already failed is not retried; push a fix (a new commit) instead.
[ -f /tmp/pos-autodeploy.failed ] && [ "$(cat /tmp/pos-autodeploy.failed)" = "$TARGET" ] && exit 0

log "new commit on $BRANCH: ${CURRENT:0:7} -> ${TARGET:0:7} ($(git log -1 --format=%s "$TARGET"))"

# Safety copy of the database before anything changes.
if sudo -n bash "$APP_DIR/deploy/backup.sh"; then log "pre-deploy backup done"; else log "WARNING: pre-deploy backup failed"; fi

git reset --hard --quiet "$TARGET"
if docker compose up -d --build --remove-orphans && healthy; then
  log "deployed ${TARGET:0:7} OK"
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

log "ERROR: ${TARGET:0:7} failed to build or is not healthy; rolling back to ${CURRENT:0:7}"
docker compose logs --tail=40 pos-api pos-web caddy 2>&1 | sed 's/^/    /'
git reset --hard --quiet "$CURRENT"
if docker compose up -d --build --remove-orphans && healthy; then
  log "rolled back to ${CURRENT:0:7}; site is up. Fix the commit and push again."
else
  log "CRITICAL: rollback is not healthy either. Check 'docker compose ps' and logs now."
fi
# Remember the bad commit so the timer doesn't retry it every 2 minutes.
echo "$TARGET" > /tmp/pos-autodeploy.failed
exit 1
