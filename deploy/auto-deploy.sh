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

env_value() { grep "^$1=" .env | tail -1 | cut -d= -f2-; }
SITE=$(env_value SITE_ADDRESS)
# Deploy only commits whose GitHub CI checks all passed. Set REQUIRE_CI=false in .env to
# skip the check (e.g. if GitHub Actions is down and a fix must go out).
REQUIRE_CI=$(env_value REQUIRE_CI); REQUIRE_CI=${REQUIRE_CI:-true}
# Only needed for a private repository (a fine-grained token with read access to checks).
GITHUB_TOKEN=$(env_value GITHUB_TOKEN)
REPO=$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')

# Prints success | pending | failure | none (no checks yet) | error
ci_state() {
  local auth=()
  [ -n "$GITHUB_TOKEN" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsS --max-time 15 "${auth[@]}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/commits/$1/check-runs?per_page=100" 2>/dev/null \
  | python3 -c '
import json, sys
runs = json.load(sys.stdin).get("check_runs", [])
if not runs: print("none")
elif any(r["status"] != "completed" for r in runs): print("pending")
elif all(r["conclusion"] in ("success", "skipped", "neutral") for r in runs): print("success")
else: print("failure")' 2>/dev/null || echo error
}
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

if [ "$REQUIRE_CI" = "true" ]; then
  STATE=$(ci_state "$TARGET")
  case "$STATE" in
    success) ;;
    pending|none)
      # Log once per commit, then wait quietly; the timer checks again in 2 minutes.
      if [ "$(cat /tmp/pos-autodeploy.waiting 2>/dev/null)" != "$TARGET" ]; then
        log "new commit ${TARGET:0:7}: waiting for CI to pass before deploying"
        echo "$TARGET" > /tmp/pos-autodeploy.waiting
      fi
      exit 0 ;;
    failure)
      log "CI failed for ${TARGET:0:7} ($(git log -1 --format=%s "$TARGET")); not deploying. Push a fix."
      echo "$TARGET" > /tmp/pos-autodeploy.failed
      exit 1 ;;
    *)
      log "could not read CI status for ${TARGET:0:7} from GitHub; will retry"
      exit 0 ;;
  esac
fi

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
