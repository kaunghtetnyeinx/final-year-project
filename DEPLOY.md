# Juniper Cafe POS — what goes where

Copy everything in this folder into the root of your `Juniper-Cafe-POS` repo
(next to the front end's `package.json`). Result:

```
Juniper-Cafe-POS/
├── src/ ...                 front end (unchanged in this step)
├── Dockerfile               front end image (nginx)
├── docker-compose.yml       production: caddy + pos-web + pos-api + mariadb
├── .env.example             secrets + SITE_ADDRESS (copy to .env on the server)
├── deploy/
│   ├── nginx.conf, security-headers.conf, Caddyfile
│   ├── db-init/             runs on the database's first start: schema+seed, API user
│   └── backup.sh            nightly database backup (cron)
├── server/                  the API (see server/README.md)
├── database/
│   └── project_poin_seeded.sql   same SQL, for local testing / CI
└── .github/workflows/ci.yml       builds the web app, runs the 24 API tests
```

Deployment steps follow in the chat, one at a time .
