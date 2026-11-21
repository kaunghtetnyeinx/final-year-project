# Juniper Cafe POS — API

Node 22 + Express 5 + MariaDB. Owns all data and all rules: the browser only displays.

- **Totals are computed here** from database prices and option surcharges (10% service charge and 6% SST on the subtotal after any discount, 5-sen rounding). Prices sent by the browser are ignored.
- **One sale = one database transaction**: header, lines, options, stock and movements are saved together or not at all.
- **Double-tap safe**: each Confirm sends a `requestId` (UUID). Sending it again returns the first sale.
- **No overselling**: products and ingredients are locked while a sale is saved; two tills can't sell the same last item.
- **Stock that matches reality**: stocked products go down when sold; made-to-order products use up their recipe's ingredients instead; batch production adds finished stock and uses up ingredients. Every change is a `stock_movements` row (SALE, PURCHASE, ADJUSTMENT, PRODUCTION, VOID).
- **Real login**: bcrypt password hashes, 12-hour session in an httpOnly, SameSite=Strict cookie, 10 login attempts per 15 min per IP. Seeded and admin-set passwords are temporary (`mustChangePassword`).
- **Roles enforced on the server**: Staff = sale screens; Admin = everything. A deactivated user is locked out on their next request.

## Run locally

```
cp .env.example .env        # fill DB_* and JWT_SECRET (openssl rand -hex 32), COOKIE_SECURE=false
npm ci
npm run migrate             # bring the database schema up to date (needs a user that may ALTER tables)
npm run dev                 # http://localhost:3000/api/health
```

## Database schema changes (migrations)

The seed SQL (`deploy/db-init`) only runs when the database volume is **empty**. Every schema
change after that is a migration in `src/migrate.js`, recorded in `schema_migrations`:

- In Docker, the one-off `pos-migrate` container applies them with the admin login before the
  API starts. The API's own user (`pos_app`) can only read and write rows, never change tables.
- The API refuses to start if a migration is missing, with a message saying so.
- Each migration checks the current schema first, so running them again is safe.

To add one: append `{ name: "006_...", up(conn) { ... } }` to `migrations`. Keep it additive
(new columns with defaults, new tables) so a rollback to the previous version still works.

## Tests

Needs a local MariaDB with a **freshly imported** `database/project_poin_seeded.sql`
(the tests apply the migrations themselves).

```
cp .env.test.example .env.test   # point at that database
npm test                         # auth, passwords, roles, sales, options, discounts, made-to-order,
                                 # voids, production, drafts, categories, photos, reports, forecasts
```

CI runs the same suite on every push; failures are posted as annotations on the commit.

## Endpoints (all under `/api`)

| Who | Method & path | What |
|---|---|---|
| Public | `GET /health` | Server + database up |
| Public | `POST /auth/login` `{email, password}` | Sign in, sets cookie |
| Public | `POST /auth/logout` | Sign out |
| Public | `GET /uploads/:file` | Uploaded product photo |
| Signed in | `GET /auth/me` | Current user (with `mustChangePassword`) |
| Signed in | `POST /auth/change-password` `{currentPassword, newPassword}` | Change own password |
| Signed in | `GET /products` | Active products with options (Admin: `?all=1` includes inactive) |
| Signed in | `GET /categories`, `GET /settings` | Categories; rates + target margin |
| Signed in | `POST /sales` `{requestId, payment, lines:[{productId, quantity, optionIds?}], discount?, discountReason?, cashReceived?}` | New sale → receipt data |
| Signed in | `GET /transactions?type=&status=&date=YYYY-MM-DD&limit=`, `GET /transactions/:number` | Sales and purchases |
| Signed in | `GET /reports/daily?date=YYYY-MM-DD` | Day totals, by payment method, voids, top items |
| Admin | `POST /sales/:number/void` `{reason}` | Void a posted sale; its stock is put back |
| Admin | `POST /products`, `PATCH /products/:id` | Add / edit product (price, category, reorder, made to order, image, active) |
| Admin | `PUT /products/:id/options` `{options:[{id?, name, priceDelta}]}` | Replace a product's options |
| Admin | `POST /products/:id/image` (raw PNG/JPEG/WebP body, 2 MB) | Upload a product photo |
| Admin | `POST /categories`, `PATCH /categories/:id` | Add / rename a category (not Ingredients) |
| Admin | `POST /purchases` `{productId, quantity, unitCost, status?}` | Supplier delivery; POSTED adds stock + updates cost |
| Admin | `POST /purchases/:number/post`, `POST /purchases/:number/cancel` | Post or cancel a DRAFT purchase |
| Admin | `POST /inventory/adjustments` `{productId, change, reason}` | Stock correction with audit reason (3 decimals for ingredients) |
| Admin | `POST /inventory/production` `{productId, quantity, note?}` | Record a batch: adds the product, uses up its recipe |
| Admin | `GET /stock-movements` | Movement history |
| Admin | `GET/POST /recipes`, `PATCH/DELETE /recipes/:id` | Recipe lines (no self/circular, one unit per ingredient) |
| Admin | `PUT /settings/target-margin` `{value}` | Recipe target margin |
| Admin | `GET /forecasts`, `POST /forecasts/run` | Latest forecast per product; run the job now |
| Admin | `GET/POST /users`, `PATCH /users/:id` | Staff accounts (temporary password, role, active) |
| Reserved | `POST /payments/webhook` | Returns 404 until `PAYMENTS_GATEWAY_ENABLED=true` |

Responses use the same field names as the front end's types in `src/lib/types.ts`.

## Forecast job

`src/forecast.js`: predicted units for the next 7 days = average units sold per day over the
last 28 days × 7, for every active sellable product, written to `forecast_results`. The API
runs it when the newest result is more than 20 hours old (checked at start-up and hourly).

## Ready for later

- **Payment gateway**: `routes/payments.js` holds the webhook slot and the checklist (verify signature, idempotent update).
