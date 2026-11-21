# Juniper Cafe POS — API

Node 22 + Express 5 + MariaDB. Owns all data and all rules: the browser only displays.

- **Totals are computed here** from database prices (10% service charge, 6% SST on the subtotal, 5-sen rounding). Prices sent by the browser are ignored.
- **One sale = one database transaction**: header, lines, stock and movements are saved together or not at all.
- **Double-tap safe**: each Confirm sends a `requestId` (UUID). Sending it again returns the first sale.
- **No overselling**: products are locked while a sale is saved; two tills can't sell the same last item.
- **Real login**: bcrypt password hashes, 12-hour session in an httpOnly, SameSite=Strict cookie, 10 login attempts per 15 min per IP.
- **Roles enforced on the server**: Staff = sale screens; Admin = everything. A deactivated user is locked out on their next request.

## Run locally

```
cp .env.example .env        # fill DB_* and JWT_SECRET (openssl rand -hex 32), COOKIE_SECURE=false
npm ci
npm run dev                 # http://localhost:3000/api/health
```

## Tests

Needs a local MariaDB with a **freshly imported** `database/project_poin_seeded.sql`.

```
cp .env.test.example .env.test   # point at that database
npm test                         # 24 tests: auth, roles, sales, double-tap, oversell, purchases, recipes, users
```

## Endpoints (all under `/api`)

| Who | Method & path | What |
|---|---|---|
| Public | `GET /health` | Server + database up |
| Public | `POST /auth/login` `{email, password}` | Sign in, sets cookie |
| Public | `POST /auth/logout` | Sign out |
| Signed in | `GET /auth/me` | Current user |
| Signed in | `GET /products` | Active products (Admin: `?all=1` includes inactive) |
| Signed in | `GET /categories`, `GET /settings` | Categories; rates + target margin |
| Signed in | `POST /sales` `{requestId, payment, lines:[{productId, quantity}]}` | New sale → receipt data |
| Signed in | `GET /transactions?type=&status=&limit=`, `GET /transactions/:number` | Sales and purchases |
| Admin | `POST /products`, `PATCH /products/:id` | Add / edit product (price, reorder, image, active) |
| Admin | `POST /purchases` `{productId, quantity, unitCost, status?}` | Supplier delivery; POSTED adds stock + updates cost |
| Admin | `POST /inventory/adjustments` `{productId, change, reason}` | Stock correction with audit reason |
| Admin | `GET /stock-movements` | Movement history |
| Admin | `GET/POST /recipes`, `PATCH/DELETE /recipes/:id` | Recipe lines (no self/circular, one unit per ingredient) |
| Admin | `PUT /settings/target-margin` `{value}` | Recipe target margin |
| Admin | `GET /forecasts` | Latest forecast per product |
| Admin | `GET/POST /users`, `PATCH /users/:id` | Staff accounts (temporary password, role, active) |
| Reserved | `POST /payments/webhook` | Returns 404 until `PAYMENTS_GATEWAY_ENABLED=true` |

Responses use the same field names as the prototype's types in `src/App.tsx` (`Product`, `Transaction`, `Movement`, `RecipeLine`), so Step 4 can swap the hard-coded data for these calls with little change to the screens.

## Ready for later

- **Payment gateway**: `routes/payments.js` holds the webhook slot and the checklist (verify signature, idempotent update).
- **Forecast job**: writes rows to `forecast_results`; `GET /forecasts` already returns the newest row per product.
