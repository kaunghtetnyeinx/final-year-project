# Juniper Cafe POS (prototype)

React 19 + Vite + Tailwind CSS v4. All data is in memory: it resets when the page reloads.

## Requirements

- Node.js 22 (LTS). Check with `node -v`.
  Install on Windows: `winget install OpenJS.NodeJS.22`, or download from https://nodejs.org

## Run

```
cd Juniper-Cafe-POS
npm install
npm run dev
```

Open the address it prints, e.g. http://localhost:5173/ . Stop the server with Ctrl + C.

## Other commands

| Command | What it does |
|---|---|
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the `dist/` build locally |
| `npx tsc --noEmit -p .` | Type-check |

## Sign-in

Sign-in uses the API in `server/` (email + password, bcrypt hashes, httpOnly session
cookie). Run the API alongside the front end: `vite dev` forwards `/api` to
`http://localhost:3000` (override with `API_URL`); in production Caddy does this.

Seeded accounts all use the password `Juniper@2026` (change them after first deploy):
**Admin** `kaunghtet@juniper.store` (all screens) or **Staff** `yadanar@juniper.store`
(sales screens only).

Admins create new accounts under **Users → + Add staff user** (name, email, role and
password: at least 10 characters with letters and numbers). The Users screen can also
set a new password for anyone and disable or enable accounts. A disabled account is
signed out on its next request.

## Main features

- New sale: Cash / Card / QR, 10% service charge, 6% SST, rounding to the nearest 5 sen
- Receipts: shown after Confirm and printable from any row in Transactions
- Recipes: ingredient costing, target profit margin check and suggestions
- Inventory, stock movements, forecasts and users (admin)
- Times are in Malaysia Time (UTC+8)
