# Juniper Cafe POS — Complete Guide

A point-of-sale, stock and costing system for Juniper Cafe (Main Store, Malaysia).
This guide covers what the system is, how it is built, how to use every screen, and how
to run and look after it.

**Contents**

1. [Overview](#1-overview)
2. [System architecture](#2-system-architecture)
3. [Data model](#3-data-model)
4. [Business rules](#4-business-rules)
5. [Security](#5-security)
6. [Getting started](#6-getting-started)
7. [User manual — every screen](#7-user-manual--every-screen)
8. [Everyday workflows](#8-everyday-workflows)
9. [Administration](#9-administration)
10. [Deployment and operations](#10-deployment-and-operations)
11. [Development](#11-development)
12. [Troubleshooting](#12-troubleshooting)
13. [FAQ](#13-faq)
14. [Glossary](#14-glossary)

---

## 1. Overview

### What it does

| Area | Summary |
|---|---|
| **Selling** | Ring up sales with product options (e.g. Large, Oat milk), bill discounts and Cash / Card / QR payment. The system calculates service charge, SST and 5-sen rounding, and works out the change for cash. Receipts can be printed. |
| **Stock** | Every sale, purchase, production batch, adjustment and void changes stock and leaves an audit record. |
| **Menu** | Products, categories, options and photos. Items can be stocked (counted on a shelf) or made to order (e.g. coffee). |
| **Costing** | Recipes give the ingredient cost of each item and check it against a target profit margin, with suggestions when the margin is too low. |
| **Reporting** | A daily summary for closing the till, transaction history by day, and 7-day demand forecasts. |
| **People** | Admin and Staff roles, personal passwords, accounts that can be disabled. |

### Who uses it

| Role | Can use |
|---|---|
| **Staff** (cashier) | New sale, Transactions (view and print), Reports, Products (view only), change own password |
| **Admin** (manager) | Everything Staff can, plus voids, purchases, products, categories, recipes, inventory, stock movements, forecasts, users |

The server enforces these rules on every request; hiding buttons in the app is only a convenience.

### Key facts

- Currency **MYR**. All times are shown in **Malaysia time (UTC+8)**; the database stores UTC.
- Service charge **10%** and SST **6%**, both on the subtotal after any discount. The total is rounded
  to the nearest **5 sen**. The rates live in the `settings` table.
- All data is in one MariaDB database, shared by every till in real time.

---

## 2. System architecture

### 2.1 The big picture

```
                    Internet (HTTPS)
                           │
                 ┌─────────▼─────────┐
                 │      Caddy        │  HTTPS certificate (auto), the only public entry
                 │   ports 80/443    │
                 └───┬───────────┬───┘
          /api/*     │           │   everything else
          ┌──────────▼──┐     ┌──▼──────────┐
          │   pos-api   │     │   pos-web   │
          │ Node 22 +   │     │ nginx serves│
          │ Express 5   │     │ the React   │
          │  port 3000  │     │ app (static)│
          └──────┬──────┘     └─────────────┘
                 │ SQL (internal network only)
          ┌──────▼──────┐     ┌─────────────┐
          │   MariaDB   │◄────│ pos-migrate │  one-off: applies schema
          │    10.11    │     │ (runs, then │  changes, then exits
          │  (db_data)  │     │   exits)    │
          └─────────────┘     └─────────────┘
```

Everything runs as Docker containers on **one server** (an AWS EC2 instance in Singapore),
started by `docker-compose.yml`. Only Caddy is reachable from the internet. The API and the
database are only on Docker's internal network, and the database has no public port.

### 2.2 Components

| Component | Technology | Responsibility |
|---|---|---|
| **Front end** (`src/`) | React 19, TypeScript, Vite 8, Tailwind CSS v4 | Screens and forms. Shows a preview of bills; never decides prices or stock. |
| **pos-web** | nginx 1.27 | Serves the built front end. Sends security headers (CSP, no framing). `index.html` is never cached, so a redeploy reaches every till straight away. |
| **pos-api** (`server/`) | Node 22, Express 5, zod, mysql2, bcryptjs, JWT | All business rules: prices, totals, stock, permissions, sign-in. |
| **pos-migrate** | Same image as pos-api | Applies database schema changes with the admin login, then exits. The API only starts once it has finished successfully. |
| **MariaDB** | 10.11 | The single source of truth. |
| **Caddy** | Caddy 2 | HTTPS (Let's Encrypt), routes `/api/*` to the API and everything else to the web app. |

### 2.3 How a sale flows through the system

```
Cashier taps Confirm
  │  POST /api/sales { requestId, payment, lines[{productId, quantity, optionIds}], discount, cashReceived }
  ▼
pos-api
  1. Checks the session cookie and that the account is still active
  2. Validates the request (zod)
  3. Starts ONE database transaction:
       a. Same requestId seen before?  → return that sale (double-tap safe)
       b. Work out the stock used: the product itself, or its recipe's ingredients
          if it is made to order
       c. Lock those rows (in id order, so two tills can never deadlock) and check stock
       d. Prices from the DATABASE (+ option surcharges); calculate the bill
       e. Insert transaction, lines, options, stock movements; reduce stock
  4. Commit: all of it is saved, or none of it
  ▼
Receipt shown → "Start another sale"
```

### 2.4 Code layout

```
final-year-project/
├── src/                       front end
│   ├── App.tsx                session + workspace (loads data, navigation)
│   ├── screens/               NewSale, Transactions, Reports, Products, Recipes,
│   │                          Inventory, StockMovements, Forecasts, Users, Login
│   ├── components/            Table, Heading, Icon, ReceiptDialog, ChangePasswordDialog, ...
│   └── lib/                   api client, types, billing, cart, formatting (+ lib.test.ts)
├── server/                    API
│   ├── src/app.js             routes and who may use them
│   ├── src/routes/            auth, catalogue, transactions, inventory, recipes, reports, admin
│   ├── src/ledger.js          stock movements, recipe expansion, transaction loading
│   ├── src/billing.js         bill maths (same as src/lib/billing.ts)
│   ├── src/migrate.js         schema migrations
│   ├── src/forecast.js        demand forecast job
│   └── test/api.test.js       integration tests (real MariaDB)
├── database/project_poin_seeded.sql   schema + demo data
├── deploy/                    nginx, Caddy, backup, restore, auto-deploy, systemd timers
├── docker-compose.yml         the production stack
└── .github/workflows/ci.yml   CI: type-check, unit tests, build, API tests
```

### 2.5 Data loading in the app

When someone signs in, the app loads products, categories, settings and the latest 200
transactions. Admins also get recipes, stock movements and forecasts. **It loads again
every time you open a screen**, so every till sees the others' sales. If a load fails, a
red bar with **Retry** appears and the last good data stays on screen.

---

## 3. Data model

| Table | Holds |
|---|---|
| `roles` | ADMIN, STAFF |
| `users` | Name, email, bcrypt password hash, role, active flag, `must_change_password` |
| `categories` | Coffee, Bakery, Ready meals, Pantry, Drinks, **Ingredients**, plus your own |
| `products` | SKU, name, category, price, `cost_price` (latest purchase cost), `stock_quantity` (3 decimals), `reorder_level`, `track_stock` (0 = made to order), image, active |
| `product_options` | Per-product options with `price_delta` (e.g. Large +2.00) |
| `recipes` | Ingredients needed for one unit of a product (`quantity_required` + `unit`) |
| `transactions` | Sales and purchases: number (SL-1048 / PO-0040), type, status (POSTED / DRAFT / CANCELLED), subtotal, discount and reason, service charge, tax, rounding, total, payment, cash received, void details |
| `transaction_items` | Lines: product, quantity, unit price (including options), line total |
| `transaction_item_options` | A copy of the options chosen on each line (name + price at the time) |
| `stock_movements` | Every stock change: SALE, PURCHASE, ADJUSTMENT, PRODUCTION, VOID; signed quantity, reference, who, when |
| `forecast_results` | Predicted demand per product per run |
| `settings` | `service_charge_rate`, `sst_rate`, `recipe_target_margin` |
| `schema_migrations` | Which schema changes have been applied |

**Ingredients are products too** (category *Ingredients*, price 0). They are counted in a base
unit (g, ml or piece) and cannot be sold at the counter.

**Nothing in the history is ever edited or deleted.** Receipts keep their own copy of prices and
option names, so changing a price later never changes an old receipt. Stock corrections are
new movements with a reason.

---

## 4. Business rules

### 4.1 The bill

```
item subtotal   = Σ (unit price + option surcharges) × quantity
discount        = RM amount, never more than the subtotal (needs a reason)
net             = subtotal − discount
service charge  = net × 10%      (rounded to the sen)
SST             = net × 6%       (on net, not on the service charge)
total           = net + service charge + SST, rounded to the nearest 5 sen
```

Rounding to 5 sen: .x1/.x2 → .x0, .x3/.x4 → .x5, .x6/.x7 → .x5, .x8/.x9 → next .x0. Purchases
are recorded at cost (no service charge, SST or rounding).

**Example:** 2 × Cafe Latte with Large (9.50 + 2.00) and 1 × plain Cafe Latte (9.50):
subtotal 32.50 → service charge 3.25 → SST 1.95 → exact 37.70 → total **RM 37.70**.

### 4.2 Two kinds of product

| | **Stocked** (default) | **Made to order** |
|---|---|---|
| Examples | Croissant, bottled cold brew, granola | Latte, iced americano, matcha latte |
| Has a stock count | Yes | No (always available) |
| When sold | Its own stock goes down | **Its recipe's ingredients** go down |
| Where ingredients get used | When you **record production** of a batch | At the moment of sale |
| Can be purchased / adjusted | Yes | No (buy its ingredients instead) |

This way ingredients are never counted twice. A croissant uses up its flour when it is baked
(production), not again when it is sold.

A sale is **blocked** if there is not enough stock, or not enough of a made-to-order item's
ingredients. The error message says exactly what is short.

### 4.3 Stock movements

| Type | Created by | Change |
|---|---|---|
| SALE | Confirming a sale | − product, or − ingredients |
| PURCHASE | Posting a purchase | + product; its `cost_price` is updated |
| PRODUCTION | Record production | + finished item, − its ingredients |
| ADJUSTMENT | Record adjustment (with reason) | ± any stocked item |
| VOID | Voiding a sale | exactly reverses that sale's SALE movements |

Stock can never go below zero.

### 4.4 Margins

```
margin = (selling price − recipe ingredient cost) ÷ selling price
```

An ingredient's cost is its latest posted purchase cost. A made-to-order component without
its own stock is costed through its own recipe. The target margin (default 60%) is set on the
Recipes screen. Labour, rent and utilities are not included.

### 4.5 Forecast

Predicted demand for the next 7 days = (units sold in the last 28 days ÷ 28) × 7, for each
active sellable product. It is recalculated automatically once a day. The recommendation
compares it with current stock: order enough to cover the forecast and restore the reorder
level.

---

## 5. Security

| Measure | Detail |
|---|---|
| Passwords | bcrypt (cost 12). At least 10 characters with letters and numbers. |
| Temporary passwords | Seeded accounts and any password an admin sets must be changed at the next sign-in. |
| Session | 12-hour signed token in an **httpOnly, SameSite=Strict, Secure** cookie. Page scripts cannot read it. |
| Brute force | 10 sign-in attempts per 15 minutes per IP address; 10 password-change attempts per 15 minutes per account. |
| Same error for wrong email or wrong password | Doesn't reveal which emails exist. |
| Permissions | Checked on the server for every request. A disabled or demoted user loses access on their next request. |
| Prices | The browser's prices are ignored; the server uses database prices. |
| Database | No public port. The API's user can only read and write rows; schema changes use a separate admin login. |
| Uploads | Images only (checked from the file's bytes, not its name), 2 MB at most, random file names. |
| Web headers | Content-Security-Policy, X-Frame-Options DENY, nosniff, HSTS. |
| Audit | Every sale, void, purchase, adjustment and production records who did it and when. |

---

## 6. Getting started

### Signing in

1. Open the site address in a browser (Chrome or Edge recommended; tablets are supported).
2. Enter your **email** and **password**, then **Sign in**.
3. **First time, or after an admin set your password:** you'll see *Choose your own password*.
   Enter the temporary password, then your new password twice. If you choose **Sign out**
   instead, you can't use the app until you change it.

Seeded demo accounts (temporary password `Juniper@2026`):

| Email | Role |
|---|---|
| kaunghtet@juniper.store | Admin |
| yadanar@juniper.store, zinkooo@juniper.store, yanbin@juniper.store, yawpin@juniper.store, chenghao@juniper.store | Staff |

### The screen layout

- **Header:** cafe name, Malaysia time, your name and role, **Password** (change your own),
  and the sign-out icon.
- **Menu:** down the left on a wide screen, or a scrolling bar under the header on a tablet.
  You only see the screens your role can use. A red number on **Inventory** counts the items
  at or below their reorder level.

Sessions last 12 hours. If yours expires, or an admin disables your account, you're returned
to the sign-in page.

---

## 7. User manual — every screen

### 7.1 New sale (everyone)

**Ringing up a sale**

1. Find products by **search** (name or SKU) or a **category** button.
2. **Tap a product** to add one. If it has options, a box opens: tick the options, set the
   quantity, then tap **Add to sale**.
3. In **Current sale**, use **−** and **+** to change quantities. The bin icon clears the sale.
   The same product with different options shows as separate lines.
4. *Optional:* tap **+ Add discount**, then enter an amount in RM **and** a reason (e.g. staff meal).
5. Choose **Cash**, **Card** or **QR**.
6. **Cash:** type the amount the customer handed over. The change is shown, and **Not enough**
   appears if it's short.
7. Tap **Confirm**. The receipt appears: **Print receipt**, then **Start another sale**.

**Good to know**

- Each product card shows units in stock (red when low) or *Made to order*.
- A product is greyed out once the cart holds all its stock.
- The sale number (e.g. SL-1052) is given when you confirm, so two tills never clash.
- If the connection drops while confirming, just press **Confirm** again. The system recognises
  the same sale and will not charge twice.
- If someone else sold the last item first, you'll see e.g. *Only 2 × Blueberry Loaf in stock*.
  Lower the quantity and confirm again.
- Confirmed sales can't be edited. An admin can **void** one (see 7.2).

### 7.2 Transactions (everyone; actions for admin)

A list of sales and purchases, newest first.

- **Filters:** All, Sales, Purchases, Drafts, Voided.
- **Day:** pick a date to see that day (Malaysia time), or **Show latest** for the latest 200.
- **Print:** opens the receipt or purchase record for printing.

Admin actions:

| Button | Shown on | What it does |
|---|---|---|
| **Void** | Posted sales | Asks for a reason. Puts the stock back, marks the sale CANCELLED and records who voided it. Refund the customer yourself. |
| **+ New purchase** | Top right | Record a supplier delivery: product, quantity, unit cost, and **Delivered now** (stock added straight away) or **Ordered, not delivered yet** (saved as a draft). |
| **Post** | Draft purchases | The delivery arrived: adds the stock and updates the cost. |
| **Cancel** | Draft purchases | The order will never come. No stock was added, so none is removed. |

For ingredients, the unit cost is per base unit, e.g. RM 0.065 per gram of beans.

### 7.3 Reports (everyone)

The **daily report** for closing the till.

- Choose the day with **← / →** or the date box (defaults to today).
- **Totals:** total sales, number of sales, average sale, voided sales.
- **By payment method:** Cash, Card and QR totals. The **Cash** figure plus your opening float
  is what should be in the drawer.
- **Bill breakdown:** item subtotal, discounts, service charge, SST, rounding, total.
  Admins also see the supplier purchases posted that day.
- **Top items:** units sold and revenue per product.
- **Print summary:** prints an 80 mm slip for the receipt printer.

### 7.4 Products (view: everyone; edit: admin)

The catalogue with SKU, category, price, stock (or *Made to order*), status and the last update.

**Adding a product** (**+ Add product**):

| Field | Notes |
|---|---|
| Name, SKU | The SKU must be unique (e.g. CAF-101); it can't be changed later |
| Category | Choose *Ingredients* for stock-only items (price 0, never sold) |
| Selling price | Before service charge and SST |
| Reorder level | The stock count that turns it *Low* |
| Opening stock | Units on the shelf right now (new stocked items only) |
| **Made to order** | Tick for drinks and anything made per order: no stock count |
| **Options** | **+ Add option**: name and extra price (0 is fine, e.g. *Less sugar*) |
| Photo | A stock photo or a web address (https://). Upload your own after saving. |

**Editing** (**Edit** on a row): change the name, category (not into or out of Ingredients),
price, reorder level, made to order, options, photo, and **Active**. Untick *Active* to hide an
item from the sale screen without losing its history. **Upload photo** accepts PNG, JPEG or WebP
up to 2 MB.

Stock isn't edited here. Use purchases, production or adjustments, so every change is audited.
To switch a stocked item to made to order, first adjust its stock to 0.

**Categories** button: rename a category, or add a new one (e.g. *Desserts*). *Ingredients*
can't be renamed.

### 7.5 Recipes (admin)

Each product's ingredient cost and profit margin.

- **Target profit margin:** type a whole percent (1–95) and press Enter. It is saved for everyone.
- The summary shows how many products meet the target, how many are below, and the average margin.
- Click a product to open its recipe:
  - **Ingredients per 1 unit:** quantity, unit cost, line cost, share of the cost.
  - **Add ingredient:** choose an ingredient (or another product as a sub-recipe), the quantity,
    and the unit (g, ml, piece). Each ingredient always uses the same unit across all recipes.
  - **Edit** or **delete** a line.
- **Below target?** Up to three suggestions: raise the price (**Set price to RM x** applies it),
  find a cheaper supplier for the biggest cost, or use less of one ingredient (**Set to …** applies it).
- **Cost missing** means an ingredient has never been purchased, so record a purchase for it.

Recipes don't use anything up by themselves: see made-to-order and production in 4.2.

### 7.6 Inventory (admin)

The current stock of every stocked product and ingredient: on hand, reorder level, status
(*In stock*, *Low*, *Out of stock*) and the last movement. Made-to-order items aren't listed
because they have no count.

- **Record adjustment:** choose an item and enter the change (negative for a loss) and a reason.
  Ingredients may use decimals (e.g. −12.5 g).
- **Record production:** a batch made in the kitchen. Choose the product and the quantity made.
  The box shows exactly which ingredients will be used (in red if short). It adds the finished
  items and uses up the ingredients. Only stocked products with a recipe appear.

### 7.7 Stock movements (admin)

The full, append-only audit trail of stock: movement ID, product, type, change, source (sale or
PO number, reason or production note), who and when. Corrections are never edits: they are new
adjustments.

### 7.8 Forecasts (admin)

- A bar per product for predicted demand over the next 7 days, with a marker at current stock.
- **Forecast note:** how many products are predicted to run short.
- The table shows on hand, predicted demand, reorder level and a recommendation (*Order N units*
  or *Stock sufficient*).
- **Run forecast now** recalculates straight away; it also runs automatically every day.

### 7.9 Users (admin)

- **+ Add staff user:** name, email, role and a **temporary** password, which the person must
  change at first sign-in. Give it to them in person.
- **Password:** set a new temporary password for someone who forgot theirs.
- **Disable / Enable:** a disabled account is signed out on its next request. You can't disable
  or demote yourself.
- The status column shows *Active*, *Inactive* or *Temporary password*.

### 7.10 Change your password (everyone)

**Password** in the header: enter your current password, then the new one twice.

---

## 8. Everyday workflows

### Opening the shop
1. Sign in on each till.
2. Admin: check **Inventory** for the red *Low* badge, and **Forecasts** for anything to order.
3. Batch items baked this morning: **Inventory → Record production** (e.g. 24 Butter Croissants).

### Adding a new drink (e.g. Iced Americano)
1. **Products → + Add product:** name, SKU `CAF-102`, category Coffee, price, tick **Made to order**,
   add options (e.g. *Large +2.00*, *Extra shot +1.50*), then **Add product**.
2. **Edit** it and **Upload photo** if you have one.
3. **Recipes:** open it and add its ingredients (e.g. 18 g Arabica Coffee Beans, 1 piece cup).
   Missing an ingredient? Add it first as a product in the *Ingredients* category, then record
   a purchase for it so it has a cost.
4. It's on **New sale** immediately, on every till.

### Receiving a delivery
- Arrived now: **Transactions → + New purchase → Delivered now**.
- Ordered in advance: save it as a **draft**, then **Post** it when it arrives (or **Cancel** it).

### A customer's order was keyed in wrong
1. Admin: **Transactions → Void** on that sale, with a reason. Its stock comes back.
2. Refund the customer, and ring up the correct sale.

### Closing the till
1. **Reports:** check today's Cash total against the drawer (minus your float).
2. **Print summary** for your records.
3. Sign out.

### Stock count
For each difference found: **Inventory → Record adjustment** with the reason *Stock count correction*.

---

## 9. Administration

- **Staff leaving:** **Users → Disable** (their history stays).
- **Forgotten password:** **Users → Password** sets a temporary one.
- **Price change:** **Products → Edit** (old receipts keep their old prices), or **Set price** from Recipes.
- **Seasonal item:** untick **Active** to hide it, and tick it again to bring it back.
- **Service charge / SST rates:** stored in the `settings` table (`service_charge_rate`,
  `sst_rate`). There is no screen for them yet; change them in the database.

---

## 10. Deployment and operations

### 10.1 How changes reach the live site

```
push to a branch ──► CI (GitHub Actions): type-check, unit tests, build, API tests on MariaDB
merge into main  ──► server checks main every 2 minutes (pos-autodeploy.timer)
                     waits until that commit's CI checks have ALL passed
                     backup → git reset → docker compose up -d --build
                     (pos-migrate updates the schema, then the API starts)
                     health check /api/health and the site for up to ~3 minutes
                     unhealthy → automatic rollback to the previous commit
```

- See what happened: `journalctl -u pos-autodeploy -n 30`
- Deploy without waiting for CI (only in an emergency): set `REQUIRE_CI=false` in `.env`.
- Pause all deploys: `sudo systemctl stop pos-autodeploy.timer` (start it again with `start`).

### 10.2 Server configuration (`.env`, never committed)

| Variable | Purpose |
|---|---|
| `SITE_ADDRESS` | Public hostname, e.g. `13.212.45.67.sslip.io` (or `localhost` on a laptop) |
| `MARIADB_ROOT_PASSWORD` | Database admin (used only by migrations and backups) |
| `POS_APP_DB_PASSWORD` | The API's limited database user |
| `JWT_SECRET` | Signs session cookies (≥ 32 characters: `openssl rand -hex 32`) |
| `S3_BUCKET` | Optional: copy backups to S3 |
| `REQUIRE_CI` | `true` (default): deploy only after CI passes |
| `GITHUB_TOKEN` | Only for a private repository: lets the server read CI results |

### 10.3 Backups and restore

- **Nightly at 03:00 Malaysia time** (`pos-backup.timer`): a database dump and the uploaded photos,
  kept 14 days in `/var/backups/pos/`, and copied to S3 if `S3_BUCKET` is set. A backup also runs
  before every deploy. Each dump is checked to be complete.
- **Prove a backup works** (do it monthly; live data is not touched):
  ```
  sudo bash deploy/restore.sh --check "$(ls -t /var/backups/pos/project_poin-*.sql.gz | head -1)"
  ```
- **Restore for real:** asks you to type `RESTORE` and takes a safety backup first:
  ```
  sudo bash deploy/restore.sh /var/backups/pos/project_poin-<date>.sql.gz /var/backups/pos/uploads-<date>.tar.gz
  ```

One-time setup of the backup timer:
```
sudo cp deploy/systemd/pos-backup.service deploy/systemd/pos-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pos-backup.timer
```

### 10.4 Useful commands on the server

| Task | Command |
|---|---|
| What's running | `docker compose ps` |
| API logs | `docker compose logs --tail=50 pos-api` |
| Migration logs | `docker compose logs pos-migrate` |
| Restart everything | `docker compose up -d` |
| Look at the database | `docker compose exec mariadb mariadb -upos_app -p project_poin` |
| Next backup time | `systemctl list-timers pos-backup.timer` |

### 10.5 Database schema changes

The seed SQL runs only on an empty database. Every later change is a **migration** in
`server/src/migrate.js` (recorded in `schema_migrations`), applied by `pos-migrate` on each
deploy. The API refuses to start if one is missing. Migrations only add things, so rolling back
the code is always safe.

---

## 11. Development

### Front end only
```
npm install
npm run dev          # /api is forwarded to http://localhost:3000 (API_URL to change)
```

### Whole stack on your computer (Docker Desktop)
```
copy .env.example .env    # SITE_ADDRESS=localhost, plus any long random secrets
docker compose up -d --build
```
Open https://localhost (accept the local certificate warning once).

### Tests
| Command | What |
|---|---|
| `npm test` | Front-end unit tests: billing, cart, formatting |
| `npx tsc --noEmit -p .` | Type-check |
| `cd server && npm test` | API integration tests (needs a freshly seeded MariaDB in `server/.env.test`) |

CI runs all of them on every push; a failing API test shows as an annotation on the commit.

### API reference
The full list of endpoints, with who may call them, is in `server/README.md`.

---

## 12. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *Wrong email or password* | Check caps lock. After 10 tries the IP is blocked for 15 minutes. An admin can set a temporary password. |
| *Too many sign-in attempts* | Wait 15 minutes. |
| Sent back to the sign-in page | The session expired (12 hours) or the account was disabled. |
| *Cannot reach the server* / *The server is not responding* | Network or server problem. Check `docker compose ps` and the API logs. The till keeps its cart; press **Retry** / **Confirm** again. |
| Red *Could not refresh data* bar | A reload failed; the old data is still shown. Press **Retry**. |
| *Only N × … in stock* | Another till sold it first. Lower the quantity. |
| *Not enough … for this sale* | A made-to-order item's ingredient is short. Record a purchase or adjustment for it. |
| A product is missing from New sale | It's inactive, out of stock (greyed out), or in *Ingredients*. |
| *Cost missing* on Recipes | That ingredient has never been purchased. Record a purchase. |
| Can't make an item made to order | It still has stock. Adjust it to 0 first. |
| A photo doesn't show | Only https:// addresses or uploaded files are allowed. Upload the photo instead. |
| The site didn't update after a merge | CI may still be running, or it failed. See `journalctl -u pos-autodeploy -n 30`. |
| The API won't start: *schema is out of date* | `pos-migrate` failed. See `docker compose logs pos-migrate`. |

---

## 13. FAQ

**Can a sale be edited after confirming?** No. An admin voids it (with a reason) and you ring it
up again. Both stay in the history.

**Does voiding refund the customer?** No. It reverses the sale in the system; refund them
separately.

**Why can't I type a stock number on the product?** So every stock change has an author, a time
and a reason. Use purchases, production or adjustments.

**Do two tills see each other's sales?** Yes. Every screen reloads from the database when opened,
and stock is checked at the moment of each sale.

**What happens if the internet drops mid-sale?** Press **Confirm** again when it's back. The same
sale is recognised, so the customer is never charged twice.

**Is the data safe if the server breaks?** There are nightly backups for 14 days (also on S3 if
configured), and you can prove they restore with `restore.sh --check`.

**Are card and QR payments processed by the system?** No. They are recorded as the payment
method. A payment-gateway connection is planned (`server/src/routes/payments.js`).

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **SKU** | Stock-keeping unit: a product's unique code, e.g. BAK-014 |
| **Posted** | Final and counted in stock and reports |
| **Draft** | A purchase ordered but not yet received; no stock change |
| **Cancelled / Voided** | Reversed. It stays in the history but not in the totals. |
| **Made to order** | No stock count; selling it uses up its recipe's ingredients |
| **Production** | Recording a batch made in the kitchen: + finished items, − ingredients |
| **Reorder level** | At or below this, the item shows as *Low* |
| **Base unit** | The unit an ingredient is counted in: g, ml or piece |
| **Margin** | (price − ingredient cost) ÷ price |
| **Service charge / SST** | 10% / 6% of the subtotal after discount |
| **Rounding adjustment** | The difference made by rounding the total to the nearest 5 sen |
| **Migration** | A recorded, one-time change to the database structure |
| **CI** | Continuous integration: automatic checks on every push to GitHub |
