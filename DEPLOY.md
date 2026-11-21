# Juniper Cafe POS — deployment

```
final-year-project/
├── src/                     front end (screens, components, lib)
├── Dockerfile               front end image (nginx)
├── docker-compose.yml       caddy + pos-web + pos-migrate + pos-api + mariadb
├── .env.example             secrets + SITE_ADDRESS (copy to .env on the server)
├── deploy/
│   ├── nginx.conf, security-headers.conf, Caddyfile
│   ├── db-init/             runs on the database's FIRST start only: schema + seed, API user
│   ├── auto-deploy.sh       pulls main after CI passes, rebuilds, health-checks, rolls back
│   ├── backup.sh            nightly backup: database + uploaded photos
│   ├── restore.sh           restore a backup, or --check that one restores cleanly
│   └── systemd/             timers for auto-deploy (every 2 min) and backup (03:00 MYT)
├── server/                  the API (see server/README.md); schema migrations in src/migrate.js
├── database/
│   └── project_poin_seeded.sql   same SQL, for local testing / CI
└── .github/workflows/ci.yml       type-check, unit tests, build, API tests on every push
```

## How a change reaches the server

1. Push to a branch: CI runs. Open a pull request into `main` and merge once it is green.
2. Every 2 minutes the server checks `main`. A new commit is deployed **only after all of its
   CI checks have passed**; a commit whose CI failed is skipped (push a fix).
3. Deploying = backup, `git reset` to the commit, `docker compose up -d --build`. That runs
   `pos-migrate` (schema changes) before the API starts, then checks `/api/health`.
4. If the new version is not healthy within ~3 minutes it rolls back to the previous commit.
   Migrations only add columns and tables, so the previous version still runs on the new schema.

See what it did: `journalctl -u pos-autodeploy -n 30`.

## One-time steps on the server (after this version is deployed)

```
cd /home/ubuntu/final-year-project

# 1. Nightly backups with systemd (replaces the cron line, if you added one: sudo crontab -e)
sudo cp deploy/systemd/pos-backup.service deploy/systemd/pos-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pos-backup.timer
systemctl list-timers pos-backup.timer          # shows the next run

# 2. Prove a backup restores (do this monthly; live data is not touched)
sudo bash deploy/backup.sh
sudo bash deploy/restore.sh --check "$(ls -t /var/backups/pos/project_poin-*.sql.gz | head -1)"

# 3. If the GitHub repo is private, add GITHUB_TOKEN=... to .env (see .env.example)
```

Then sign in as each seeded account: the app makes each one choose its own password.

## Restoring for real

```
sudo bash deploy/restore.sh /var/backups/pos/project_poin-<date>.sql.gz /var/backups/pos/uploads-<date>.tar.gz
```

It asks you to type `RESTORE`, takes a fresh backup first, replaces the database (and photos),
and starts everything again (an older backup is migrated up to the current schema).
