# Juniper Cafe POS

React 19 + Vite + Tailwind CSS v4 front end. All data lives in MariaDB and goes through
the API in `server/`: products, sales, purchases, stock, recipes, forecasts and users are
saved there and shared by every till. The front end needs the API running (see below).

## Requirements

- Node.js 22 (LTS). Check with `node -v`.
  Install on Windows: `winget install OpenJS.NodeJS.22`, or download from https://nodejs.org

## Run the front end

```
npm install
npm run dev
```

`vite dev` forwards `/api` to the API at `http://localhost:3000` (override with `API_URL`).
Start the API too (see `server/README.md`), or run the whole stack with Docker below.

## Run the whole stack locally (Docker)

Needs Docker Desktop. This is the same setup as the server, on your own computer:

```
copy .env.example .env      # then fill it in:
                            #   SITE_ADDRESS=localhost
                            #   MARIADB_ROOT_PASSWORD, POS_APP_DB_PASSWORD, JWT_SECRET: any long random text
docker compose up -d --build
```

Open https://localhost (Caddy uses its own local certificate, so the browser warns once).
The first start loads the seed data; `pos-migrate` then brings the schema up to date.
`docker compose down` stops it; `docker compose down -v` also deletes the local data.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the `dist/` build locally |
| `npm test` | Front-end unit tests (billing, cart, formatting) with Node's built-in runner |
| `npx tsc --noEmit -p .` | Type-check |

CI (`.github/workflows/ci.yml`) runs the type-check, unit tests and build, plus the API
tests against a real MariaDB, on every push. The server deploys a `main` commit only
after all of those pass.

## Code layout

| Folder | What is in it |
|---|---|
| `src/App.tsx` | Session handling and the signed-in workspace (loads data, navigation) |
| `src/screens/` | One file per screen: NewSale, Transactions, Reports, Products, Recipes, Inventory, StockMovements, Forecasts, Users, Login |
| `src/components/` | Shared pieces: Table, Heading, Icon, ReceiptDialog, ChangePasswordDialog, ... |
| `src/lib/` | API client, types, billing, cart and formatting helpers (with `lib.test.ts`) |

## Sign-in and passwords

Email + password against the API (bcrypt hashes, httpOnly session cookie).

The seeded accounts use the published password `Juniper@2026`, so each one **must choose
its own password at first sign-in**. The same applies to a password an admin sets for
someone (new account or reset): it is temporary. Everyone can change their own password
with **Password** in the header.

- **Admin** `kaunghtet@juniper.store`: all screens
- **Staff** `yadanar@juniper.store`: New sale, Transactions, Reports, Products (read only)

## Main features

- **New sale**: Cash / Card / QR; product options with surcharges (e.g. Large +RM 2.00);
  a bill discount with a reason (taken off before service charge and SST); cash received
  and change due. Service charge and SST come from the `settings` table (10% / 6%), and
  the total is rounded to the nearest 5 sen. The server recalculates every total.
- **Made-to-order items** (e.g. a latte) have no stock count: selling one uses up its
  recipe's ingredients. **Batch-made items** (e.g. croissants) keep a stock count: record
  each batch with **Inventory → Record production**, which adds the items and uses up
  the ingredients.
- **Voids** (admin): a posted sale can be voided with a reason. Its stock comes back, and
  the sale stays listed as CANCELLED.
- **Purchases** (admin): post a delivery now, or save it as a draft and post or cancel it later.
- **Daily report**: sales by payment method, discounts, voids and top items for any day,
  printable as an 80 mm slip for closing the till.
- **Products** (admin): add and edit items, categories, options and photos (upload your
  own, up to 2 MB, or use a web address).
- **Recipes**: ingredient costing, target profit margin check and suggestions.
- **Forecasts**: 7-day demand from a moving average of the last 28 days of real sales,
  recalculated daily (or with **Run forecast now**).
- Works on tablets: the menu becomes a scrolling bar, and wide tables scroll sideways.
- Every screen reloads from the database when you open it, so all tills stay in step.
- Times are in Malaysia Time (UTC+8).
