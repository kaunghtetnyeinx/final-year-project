import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import { createPortal } from "react-dom"

// Workspace currency is MYR (see header), so every amount uses one formatter.
const money = (value: number) => `RM ${value.toFixed(2)}`
/** Unit costs can be fractions of a sen (e.g. RM 0.065 per g): up to 4 decimals, at least 2. */
const unitMoney = (value: number) => `RM ${value.toFixed(4).replace(/0{1,2}$/, "")}`
const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`
/** Quantities are decimal(12,3): show up to 3 decimals without trailing zeros. */
const qty = (value: number) => String(Number(value.toFixed(3)))

// All dates and times are shown in Malaysia Time (UTC+8), whatever the device's timezone.
const MY_TIMEZONE = "Asia/Kuala_Lumpur"
const malaysiaParts = (date: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: MY_TIMEZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>
/** e.g. "03 Nov 2026" */
const myDate = (date = new Date()) => {
  const p = malaysiaParts(date)
  return `${p.day} ${p.month} ${p.year}`
}
/** e.g. "3 Nov · 21:45" */
const myStamp = (date = new Date()) => {
  const p = malaysiaParts(date)
  return `${Number(p.day)} ${p.month} · ${p.hour}:${p.minute}`
}
/** e.g. "03 Nov 2026, 21:45" */
const myDateTime = (date: Date) => {
  const p = malaysiaParts(date)
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`
}

// Every sale bill carries a service charge and SST, both calculated on the
// item subtotal. Each amount is rounded to the sen so the receipt adds up exactly.
// The rates come from the `settings` table (GET /api/settings); the server
// recalculates every bill itself, so this copy is only for the on-screen preview.
type Rates = { serviceChargeRate: number; sstRate: number }
const DEFAULT_RATES: Rates = { serviceChargeRate: 0.1, sstRate: 0.06 }
/** 0.1 -> "10", 0.06 -> "6" */
const ratePct = (rate: number) => String(Number((rate * 100).toFixed(2)))
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
type Bill = {
  subtotal: number
  serviceCharge: number
  tax: number
  /** Rounding adjustment to the nearest 5 sen (e.g. -0.02 or +0.01). */
  rounding: number
  /** Amount payable, after rounding. */
  total: number
}
// Every sale bill (Cash, Card and QR) is rounded to the nearest 5 sen, following
// Malaysia's rounding mechanism:
// x.x1/x.x2 -> x.x0, x.x3/x.x4 -> x.x5, x.x6/x.x7 -> x.x5, x.x8/x.x9 -> next x.x0.
const roundTo5Sen = (value: number) => round2(Math.round(round2(value) * 20) / 20)
const saleBill = (lines: { quantity: number; unitPrice: number }[], rates: Rates): Bill => {
  const subtotal = round2(
    lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  )
  const serviceCharge = round2(subtotal * rates.serviceChargeRate)
  const tax = round2(subtotal * rates.sstRate)
  const exact = round2(subtotal + serviceCharge + tax)
  const total = roundTo5Sen(exact)
  return { subtotal, serviceCharge, tax, rounding: round2(total - exact), total }
}
/** "+RM 0.01" / "-RM 0.02" / "RM 0.00" */
const signedMoney = (value: number) =>
  value === 0 ? money(0) : `${value > 0 ? "+" : "-"}${money(Math.abs(value))}`

/** The signed-in account, as returned by the API (see server/src/auth.js publicUser). */
type SessionUser = { id: number; name: string; email: string; role: Role }

/** A user row from GET /api/users (see server/src/routes/admin.js toUser). */
type StaffUser = {
  id: number
  code: string
  name: string
  email: string
  role: Role
  isActive: boolean
  createdAt: string
}

/** Called when a request gets 401 (session expired or account disabled); App sets it. */
let onSessionLost = () => {}

/**
 * Calls the POS API. The session lives in an httpOnly cookie, so the browser
 * sends it automatically; the page never sees or stores the token.
 * Throws an Error carrying the server's message on any non-2xx reply.
 */
async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.")
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // A wrong password on the login form is also a 401, but that is not a lost session.
    if (response.status === 401 && !path.startsWith("/auth/")) onSessionLost()
    // Validation errors carry field messages in details; show the first one.
    const detail = Array.isArray(data.details) ? data.details[0]?.message : undefined
    throw new Error(
      detail ||
        data.error ||
        (response.status >= 500
          ? "The server is not responding. Please try again shortly."
          : `Request failed (${response.status})`),
    )
  }
  return data as T
}

type Role = "ADMIN" | "STAFF"
type View = "New sale" | "Transactions" | "Products" | "Recipes" | "Inventory" | "Stock movements" | "Forecasts" | "Users"
/** A row of `products` (GET /api/products). Ingredients are products too. */
type Product = {
  id: number
  sku: string
  name: string
  category: string
  price: number
  /** Latest posted purchase cost per unit (4 decimals); 0 = never purchased. */
  costPrice: number
  stock: number
  reorder: number
  image: string | null
  isActive: boolean
  /** ISO timestamp */
  updated: string
}
type CartLine = { productId: number; quantity: number }
type Payment = "Cash" | "Card" | "QR"
const payments: Payment[] = ["Cash", "Card", "QR"]
type Movement = {
  id: string
  productId: number
  product: string
  type: "SALE" | "PURCHASE" | "ADJUSTMENT"
  change: number
  source: string
  by: string
  created: Date
}
type TransactionLine = {
  productId: number
  name: string
  sku: string
  quantity: number
  unitPrice: number
}
type Transaction = Bill & {
  number: string
  type: "SALE" | "PURCHASE"
  status: "POSTED" | "DRAFT" | "CANCELLED"
  at: Date
  by: string
  payment: Payment | null
  lines: TransactionLine[]
}
type Category = { id: number; name: string }
type Forecast = {
  productId: number
  predicted: number
  horizonDays: number
  forecastDate: string
  model: string
  modelVersion: string | null
  generatedAt: Date
}

// The API sends timestamps as ISO strings; these turn them into Dates.
type Wire<T, K extends keyof T> = Omit<T, K> & { [P in K]: string }
const toTransaction = (tx: Wire<Transaction, "at">): Transaction => ({ ...tx, at: new Date(tx.at) })
const toMovement = (m: Wire<Movement, "created">): Movement => ({ ...m, created: new Date(m.created) })
const toRecipe = (r: Wire<RecipeLine, "createdAt" | "updatedAt">): RecipeLine => ({
  ...r,
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
})
const toForecast = (f: Wire<Forecast, "generatedAt">): Forecast => ({
  ...f,
  generatedAt: new Date(f.generatedAt),
})

const image = {
  coffee:
    "https://images.unsplash.com/photo-1564327367919-cb377ea6a88f?auto=format&fit=crop&w=700&q=85",
  bakery:
    "https://images.unsplash.com/photo-1704283735270-f973e7e9c14e?auto=format&fit=crop&w=700&q=85",
  meal: "https://images.unsplash.com/photo-1730871082582-49e083b500a1?auto=format&fit=crop&w=700&q=85",
  pantry:
    "https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85",
  cake: "https://images.unsplash.com/photo-1529942458412-eda69f76291d?auto=format&fit=crop&w=700&q=85",
  store:
    "https://images.unsplash.com/photo-1528699633788-424224dc89b5?auto=format&fit=crop&w=1400&q=85",
}
/** Stock photos offered in the product form (the store photo is for the login page). */
const productPhotos = Object.entries(image).filter(([key]) => key !== "store")
const photoOf = (product: Product) => product.image || image.pantry

const INGREDIENTS = "Ingredients"
const isIngredient = (product: Product) => product.category === INGREDIENTS

/** One row of the ERD `recipe` table (columns in camelCase). */
type RecipeLine = {
  recipeId: number
  /** Finished product made by this recipe (FK products). */
  productId: number
  /** Ingredient or component, also a product (FK products). */
  ingredientId: number
  /** Amount of the ingredient needed for ONE unit of the product; decimal(12,3), > 0. */
  quantityRequired: number
  /** Base unit, e.g. g, ml or piece; varchar(20), not blank. */
  unit: string
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

type NavigationItem = {
  label: View
  admin?: boolean
}

const navigation: NavigationItem[] = [
  { label: "New sale" },
  { label: "Transactions" },
  { label: "Products" },
  { label: "Recipes", admin: true },
  { label: "Inventory", admin: true },
  { label: "Stock movements", admin: true },
  { label: "Forecasts", admin: true },
  { label: "Users", admin: true },
]

type IconProps = {
  name: string
  size?: number
}

function Icon({ name, size = 16 }: IconProps) {
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    trash: (
      <>
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3M14 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    trend: <path d="m3 17 6-6 4 4 8-9M15 6h6v6" />,
    printer: (
      <>
        <path d="M7 9V3h10v6" />
        <rect x="3" y="9" width="18" height="8" rx="2" />
        <path d="M7 14h10v7H7z" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) return setError("Enter your email and password.")
    setBusy(true)
    setError("")
    try {
      const { user } = await api<{ user: SessionUser }>("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password },
      })
      onLogin(user)
    } catch (err) {
      setError((err as Error).message)
      setPassword("")
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="grid min-h-screen grid-cols-[1fr_1fr] bg-[#F5F4F0]">
      <section className="relative m-4 overflow-hidden">
        <img
          src={image.store}
          alt="Juniper Cafe counter"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#183B34]/65" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <div className="font-display text-xl font-bold">Juniper Cafe</div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-white/65">
              Coffee · Bakery · Kitchen
            </p>
            <h1 className="mt-4 max-w-lg font-display text-5xl font-bold leading-[1.05] tracking-[-.04em]">
              Every sale, every bean,
              <br />
              accounted for.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-white/70">
              Sales, stock and demand forecasts for Juniper Cafe in one place.
            </p>
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center px-16">
        <form className="w-full max-w-sm" onSubmit={submit} noValidate>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[#28695E]">
            Juniper Cafe POS
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold">
            Sign in to workspace
          </h2>
          <p className="mt-2 text-sm text-[#757973]">
            Use the account your administrator created for you.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-6 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]"
            >
              {error}
            </p>
          )}
          <label className="mt-6 block text-xs font-bold">
            Email
            <input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3.5 text-sm outline-none focus:border-[#28695E]"
            />
          </label>
          <label className="mt-4 block text-xs font-bold">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3.5 text-sm outline-none focus:border-[#28695E]"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-6 flex w-full items-center justify-between bg-[#28695E] px-5 py-4 text-sm font-bold text-white disabled:opacity-60"
          >
            <span>{busy ? "Signing in…" : "Sign in"}</span>
            <Icon name="arrow" />
          </button>
          <p className="mt-4 flex items-center gap-2 text-[11px] text-[#858983]">
            <Icon name="lock" size={13} />
            Passwords are hashed with bcrypt and never stored in plaintext
          </p>
        </form>
      </section>
    </main>
  )
}

type HeadingProps = {
  title: string
  subtitle: string
}

function Heading({ title, subtitle }: HeadingProps) {
  return (
    <header>
      <h1 className="font-display text-[28px] font-bold tracking-[-.035em]">
        {title}
      </h1>
      <p className="mt-1 text-xs text-[#7E817C]">{subtitle}</p>
    </header>
  )
}

function NewSale({
  catalogue,
  categories,
  cart,
  setCart,
  rates,
  payment,
  onPaymentChange,
  onPost,
  posting,
  error,
}: {
  catalogue: Product[]
  categories: string[]
  cart: CartLine[]
  setCart: Dispatch<SetStateAction<CartLine[]>>
  rates: Rates
  payment: Payment
  onPaymentChange: (payment: Payment) => void
  onPost: () => void
  posting: boolean
  error: string
}) {
  const [category, setCategory] = useState("All items")
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  // Ingredients are stock items only; they are not sold at the counter.
  const sellable = catalogue.filter((product) => product.isActive && !isIngredient(product))
  const shown = sellable.filter(
    (product) =>
      (category === "All items" || product.category === category) &&
      `${product.name} ${product.sku}`.toLowerCase().includes(query),
  )
  // Price and stock always come from the latest catalogue, never a copy in the cart.
  const lines = cart
    .map((line) => ({ ...line, product: catalogue.find((p) => p.id === line.productId) }))
    .filter((line): line is CartLine & { product: Product } => Boolean(line.product))
  const stockOf = (id: number) =>
    catalogue.find((product) => product.id === id)?.stock ?? 0
  const inCart = (id: number) =>
    cart.find((item) => item.productId === id)?.quantity ?? 0
  const add = (product: Product) =>
    setCart((current) => {
      const line = current.find((item) => item.productId === product.id)
      if (!line)
        return product.stock > 0 ? [...current, { productId: product.id, quantity: 1 }] : current
      return current.map((item) =>
        item.productId === product.id
          ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) }
          : item,
      )
    })
  const change = (id: number, by: number) =>
    setCart((current) =>
      current
        .map((item) =>
          item.productId === id
            ? { ...item, quantity: Math.min(item.quantity + by, stockOf(id)) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    )
  const short = lines.find((line) => line.quantity > line.product.stock)
  const bill = saleBill(
    lines.map((line) => ({ quantity: line.quantity, unitPrice: line.product.price })),
    rates,
  )
  return (
    <div className="grid min-h-full grid-cols-[minmax(520px,1fr)_330px] gap-5 p-7">
      <section>
        <Heading
          title="New sale"
          subtitle="Add whole-unit products, then confirm to save the sale and update stock."
        />
        <p className="mb-2 mt-5 text-xs font-bold">Find a product</p>
        <label className="flex items-center gap-3 rounded border border-[#D8D9D4] bg-white px-4 py-3">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search by product name or SKU"
          />
        </label>
        <div className="my-4 flex flex-wrap gap-2">
          {["All items", ...categories].map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              className={`rounded border px-3.5 py-2 text-xs font-bold ${
                category === item
                  ? "border-[#28695E] bg-[#28695E] text-white"
                  : "border-[#DCDAD4] bg-white text-[#666A65]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {shown.length === 0 && (
            <p className="col-span-2 rounded-md border border-dashed border-[#D8D9D4] p-6 text-center text-xs text-[#8B8F89]">
              {sellable.length === 0 ? "No products yet." : "No products match this search."}
            </p>
          )}
          {shown.map((product) => (
            <button
              key={product.id}
              onClick={() => add(product)}
              disabled={inCart(product.id) >= product.stock}
              className="group overflow-hidden rounded-md border border-[#DEDFDA] bg-white text-left transition hover:border-[#91A59F] disabled:opacity-50"
            >
              <img
                src={photoOf(product)}
                alt=""
                className="aspect-video w-full object-cover saturate-[.72]"
              />
              <div className="p-3">
                <div className="flex justify-between gap-3">
                  <p className="text-sm font-bold">{product.name}</p>
                  <strong className="shrink-0 text-sm">
                    {money(product.price)}
                  </strong>
                </div>
                <div className="mt-2 flex justify-between text-[11px]">
                  <span className="text-[#92948E]">{product.sku}</span>
                  <span
                    className={
                      product.stock <= product.reorder
                        ? "text-[#A75347]"
                        : "text-[#747A75]"
                    }
                  >
                    {product.stock} units
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-4 border-l-2 border-[#28695E] bg-[#EAF1EF] p-3 text-xs text-[#5E6863]">
          <strong>Posting rule:</strong> Stock is reduced only when the sale is
          confirmed. Every line creates one append-only stock movement.
        </div>
      </section>
      <aside className="mt-[68px] flex h-fit min-h-[520px] flex-col rounded-md border border-[#DEDFDA] bg-white">
        <div className="flex items-start justify-between border-b border-[#E4E5E0] p-5">
          <div>
            <h2 className="font-display text-lg font-bold">Current sale</h2>
            <p className="mt-1 text-[11px] text-[#888C86]">
              DRAFT · Sale number is assigned on confirm
            </p>
          </div>
          <button
            onClick={() => setCart([])}
            disabled={!cart.length || posting}
            aria-label="Clear sale"
            title="Clear sale"
            className="p-1 text-[#777C76] disabled:opacity-35"
          >
            <Icon name="trash" />
          </button>
        </div>
        <div className="min-h-64 flex-1 p-3">
          {lines.length === 0 ? (
            <div className="grid h-52 place-items-center text-center">
              <div>
                <p className="text-sm font-bold">No products added</p>
                <p className="mt-1 text-xs text-[#8B8F89]">
                  Select a product to start this sale.
                </p>
              </div>
            </div>
          ) : (
            lines.map(({ product, quantity }) => (
              <div
                key={product.id}
                className="flex items-center gap-3 border-b border-[#ECEDE9] py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{product.name}</p>
                  <p
                    className={`mt-1 text-[11px] ${quantity > product.stock ? "text-[#A34E42]" : "text-[#888C86]"}`}
                  >
                    {quantity > product.stock
                      ? `Only ${product.stock} left`
                      : `${product.sku} · ${money(product.price)}`}
                  </p>
                </div>
                <div className="flex items-center border border-[#DCDDD8]">
                  <button
                    onClick={() => change(product.id, -1)}
                    disabled={posting}
                    aria-label={`Remove one ${product.name}`}
                    className="p-1.5"
                  >
                    <Icon name="minus" size={11} />
                  </button>
                  <span className="w-6 text-center text-xs font-bold">
                    {quantity}
                  </span>
                  <button
                    onClick={() => change(product.id, 1)}
                    disabled={posting || quantity >= product.stock}
                    aria-label={`Add one ${product.name}`}
                    className="p-1.5 disabled:opacity-30"
                  >
                    <Icon name="plus" size={11} />
                  </button>
                </div>
                <strong className="w-16 text-right text-xs">
                  {money(product.price * quantity)}
                </strong>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-[#E4E5E0] p-5">
          <dl className="space-y-1.5 text-xs text-[#6F746E]">
            {(
              [
                [`Subtotal (${lines.reduce((s, i) => s + i.quantity, 0)} units)`, money(bill.subtotal)],
                [`Service charge (${ratePct(rates.serviceChargeRate)}%)`, money(bill.serviceCharge)],
                [`SST (${ratePct(rates.sstRate)}%)`, money(bill.tax)],
                ["Rounding adj.", signedMoney(bill.rounding)],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <dt>{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex justify-between border-t border-dashed border-[#DCDDD8] pt-3 font-display text-xl font-bold">
            <span>Total</span>
            <span className="tabular-nums">{money(bill.total)}</span>
          </div>
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#858983]">
              Payment method
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {payments.map((method) => (
                <button
                  key={method}
                  onClick={() => onPaymentChange(method)}
                  disabled={posting}
                  className={`rounded border px-3 py-2 text-xs font-bold ${
                    payment === method
                      ? "border-[#28695E] bg-[#28695E] text-white"
                      : "border-[#DCDAD4] bg-white text-[#666A65]"
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-4 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">
              {error}
            </p>
          )}
          <button
            onClick={onPost}
            disabled={!lines.length || posting || Boolean(short)}
            className="mt-4 w-full rounded bg-[#28695E] py-3.5 text-sm font-bold text-white disabled:opacity-35"
          >
            {posting ? "Saving sale…" : "Confirm"}
          </button>
          <p className="mt-3 text-center text-[10px] text-[#969A94]">
            Posted transactions cannot be edited or cancelled.
          </p>
        </div>
      </aside>
    </div>
  )
}

/** Thermal-style receipt. Used for the on-screen preview and for printing. */
function Receipt({ tx, rates }: { tx: Transaction; rates: Rates }) {
  const isSale = tx.type === "SALE"
  const units = tx.lines.reduce((sum, line) => sum + line.quantity, 0)
  const Rule = () => <div className="my-3 border-t border-dashed border-[#A4A9A3]" />
  const Row = ({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) => (
    <div className={`flex justify-between gap-4 ${strong ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  )
  return (
    <div className="receipt w-[300px] bg-white px-6 py-7 font-mono text-[11px] leading-[1.6] text-[#1F2421]">
      <header className="text-center">
        <div className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-[#1F2421] font-display text-sm font-bold">
          J
        </div>
        <p className="mt-2 font-display text-lg font-bold tracking-tight">Juniper Cafe</p>
        <p className="text-[10px] text-[#5F655F]">Main Store · Coffee · Bakery · Kitchen</p>
        <p className="mt-3 text-[10px] font-bold uppercase tracking-[.25em]">
          {isSale ? "Sales receipt" : "Purchase record"}
        </p>
      </header>

      {tx.status !== "POSTED" && (
        <p className="mt-3 border border-dashed border-[#A34E42] py-1 text-center text-[10px] font-bold uppercase tracking-[.1em] text-[#A34E42]">
          {tx.status} · Not a valid receipt
        </p>
      )}

      <Rule />
      <Row label={isSale ? "Receipt no." : "PO no."} value={tx.number} />
      <Row label="Date" value={`${myDateTime(tx.at)} MYT`} />
      <Row label={isSale ? "Cashier" : "Recorded by"} value={tx.by} />
      <Rule />

      <div className="space-y-2">
        {tx.lines.map((line, index) => (
          <div key={`${line.sku}-${index}`}>
            <div className="flex justify-between gap-4">
              <span className="font-bold">{line.name}</span>
              <span className="tabular-nums">{money(line.unitPrice * line.quantity)}</span>
            </div>
            <div className="text-[10px] text-[#5F655F]">
              {line.quantity} x {unitMoney(line.unitPrice)}
              {isSale ? "" : " (cost)"} · {line.sku}
            </div>
          </div>
        ))}
      </div>

      <Rule />
      <Row label={`Subtotal (${units} ${units === 1 ? "item" : "items"})`} value={money(tx.subtotal)} />
      {isSale && (
        <>
          <Row label={`Service charge ${ratePct(rates.serviceChargeRate)}%`} value={money(tx.serviceCharge)} />
          <Row label={`SST ${ratePct(rates.sstRate)}%`} value={money(tx.tax)} />
          <Row label="Rounding adj." value={signedMoney(tx.rounding)} />
        </>
      )}
      <div className="my-3 border-t-2 border-double border-[#1F2421]" />
      <div className="flex justify-between text-[14px] font-bold">
        <span>TOTAL</span>
        <span className="tabular-nums">{money(tx.total)}</span>
      </div>
      {isSale && tx.payment && (
        <div className="mt-1">
          <Row label="Paid by" value={tx.payment} />
        </div>
      )}
      <Rule />

      <footer className="text-center text-[10px] text-[#5F655F]">
        {isSale ? (
          <>
            <p className="font-bold text-[#1F2421]">Thank you! Please come again.</p>
            <p className="mt-1">All prices in MYR.</p>
            <p>Goods sold are not returnable.</p>
          </>
        ) : (
          <p>Supplier delivery · stock added on posting</p>
        )}
        <p className="mt-2 tracking-[.2em]">* * *</p>
      </footer>
    </div>
  )
}

/**
 * Modal with a receipt preview and a Print button. The receipt is also rendered
 * into a print-only container at <body> level, so only the receipt is printed
 * (see the @media print rules in index.css).
 */
function ReceiptDialog({
  tx,
  rates,
  onClose,
  success = false,
  closeLabel = "Close",
}: {
  tx: Transaction
  rates: Rates
  onClose: () => void
  success?: boolean
  closeLabel?: string
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const label = tx.type === "SALE" ? "receipt" : "record"
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${tx.number} ${label}`}
    >
      <div className="flex max-h-[calc(100vh-48px)] w-full max-w-[400px] flex-col overflow-hidden rounded-md bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-[#E4E5E0] px-6 py-4">
          {success && (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E4F0E7] text-[#357049]">
              <Icon name="check" size={18} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold">
              {success ? "Sale confirmed" : `${tx.number} ${label}`}
            </h2>
            <p className="text-[11px] text-[#767A74]">
              {success
                ? `${tx.number} · Paid via ${tx.payment} · ${money(tx.total)}`
                : `${tx.type === "SALE" ? "Sale" : "Purchase"} · ${tx.status} · ${money(tx.total)}`}
            </p>
          </div>
          {!success && (
            <button onClick={onClose} aria-label="Close" className="p-1 text-[#777C76]">
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#EEEDEA] px-6 py-6">
          <div className="mx-auto w-fit shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_24px_rgba(0,0,0,.08)]">
            <Receipt tx={tx} rates={rates} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-[#E4E5E0] px-6 py-4">
          <button
            onClick={() => window.print()}
            className="flex items-center justify-center gap-2 rounded border border-[#28695E] py-3 text-sm font-bold text-[#28695E]"
          >
            <Icon name="printer" />
            Print {label}
          </button>
          <button
            onClick={onClose}
            className="rounded bg-[#28695E] py-3 text-sm font-bold text-white"
          >
            {closeLabel}
          </button>
        </div>
      </div>
      {createPortal(
        <div className="print-root">
          <Receipt tx={tx} rates={rates} />
        </div>,
        document.body,
      )}
    </div>
  )
}

function Transactions({
  transactions,
  catalogue,
  rates,
  isAdmin,
  onPostPurchase,
}: {
  transactions: Transaction[]
  catalogue: Product[]
  rates: Rates
  isAdmin: boolean
  onPostPurchase: (productId: number, quantity: number, unitCost: number) => Promise<void>
}) {
  const [filter, setFilter] = useState("All")
  const filters = ["All", "Sales", "Purchases", "Drafts"]
  const shown = transactions.filter((tx) => {
    if (filter === "Sales") return tx.type === "SALE"
    if (filter === "Purchases") return tx.type === "PURCHASE"
    if (filter === "Drafts") return tx.status === "DRAFT"
    return true
  })
  const rows = shown.map((tx) => [
    tx.number,
    tx.type,
    tx.status,
    myStamp(tx.at),
    tx.by,
    tx.payment ?? "—",
    money(tx.total),
  ])
  const [viewing, setViewing] = useState<Transaction | null>(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  return (
    <div className="p-8">
      <Heading
        title="Transactions"
        subtitle="Sale and purchase headers with posting status and calculated line totals."
      />
      <div className="mt-6 flex justify-between">
        <div className="flex gap-2">
          {filters.map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded border px-4 py-2 text-xs font-bold ${
                filter === item
                  ? "border-[#28695E] bg-[#28695E] text-white"
                  : "border-[#D9DAD5] bg-white"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button
            className="rounded bg-[#24302C] px-4 py-2 text-xs font-bold text-white"
            onClick={() => setPurchaseOpen(true)}
          >
            + New purchase
          </button>
        )}
      </div>
      <Table
        headers={[
          "Number",
          "Type",
          "Status",
          "Date",
          "Created by",
          "Payment",
          "Total",
        ]}
        rows={rows}
        empty="No transactions match this filter."
        action={(index) => (
          <button
            onClick={() => setViewing(shown[index])}
            aria-label={`Print ${shown[index].number}`}
            className="flex items-center gap-1.5 rounded border border-[#D9DAD5] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#28695E] hover:border-[#28695E]"
          >
            <Icon name="printer" size={13} />
            Print
          </button>
        )}
      />
      {viewing && (
        <ReceiptDialog tx={viewing} rates={rates} onClose={() => setViewing(null)} />
      )}
      {purchaseOpen && (
        <NewPurchaseModal
          catalogue={catalogue.filter((p) => p.isActive)}
          onClose={() => setPurchaseOpen(false)}
          onPost={async (productId, quantity, unitCost) => {
            await onPostPurchase(productId, quantity, unitCost)
            setPurchaseOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** Suggested unit cost for a delivery: the last purchase cost, else the selling price. */
const defaultCost = (product?: Product) =>
  product ? (product.costPrice > 0 ? product.costPrice : product.price) : 0

function NewPurchaseModal({
  catalogue,
  onClose,
  onPost,
}: {
  catalogue: Product[]
  onClose: () => void
  onPost: (productId: number, quantity: number, unitCost: number) => Promise<void>
}) {
  const [productId, setProductId] = useState(catalogue[0]?.id ?? 0)
  const [quantity, setQuantity] = useState(1)
  const product = catalogue.find((item) => item.id === productId)
  const [unitCost, setUnitCost] = useState(defaultCost(product))
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const total = round2(unitCost * quantity)
  const post = async () => {
    if (!product || quantity < 1) return
    if (unitCost <= 0) return setError("Unit cost must be greater than 0.")
    if (Math.abs(unitCost * 10000 - Math.round(unitCost * 10000)) > 1e-6)
      return setError("Unit cost can have at most 4 decimal places.")
    setBusy(true)
    setError("")
    try {
      await onPost(product.id, quantity, unitCost)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-4 font-display text-xl font-bold">New purchase</h2>
        <p className="mt-2 text-sm text-[#767A74]">
          Record a supplier delivery. Stock is added straight away.
        </p>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <label className="mt-5 block text-left text-xs font-bold">
          Product
          <select
            value={productId}
            onChange={(event) => {
              const id = Number(event.target.value)
              setProductId(id)
              setUnitCost(defaultCost(catalogue.find((item) => item.id === id)))
            }}
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          >
            {catalogue.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.stock} on hand
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-left text-xs font-bold">
          Quantity (whole units)
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) =>
              setQuantity(Math.max(1, Math.floor(Number(event.target.value)) || 1))
            }
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <label className="mt-4 block text-left text-xs font-bold">
          Unit cost (MYR per unit, e.g. per g for ingredients)
          <input
            type="number"
            min={0}
            step="any"
            value={unitCost}
            onChange={(event) =>
              setUnitCost(Math.max(0, Number(event.target.value) || 0))
            }
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <div className="mt-5 flex justify-between text-sm font-bold">
          <span>Total</span>
          <span>{money(total)}</span>
        </div>
        <button
          onClick={post}
          disabled={!product || unitCost <= 0 || busy}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-35"
        >
          {busy ? "Saving…" : "Post purchase"}
        </button>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

type TableProps = {
  headers: string[]
  rows: string[][]
  empty?: string
  /** Optional trailing cell per row, e.g. a button. Receives the row index. */
  action?: (rowIndex: number) => ReactNode
  /** Width of the action column in px (default 76). */
  actionWidth?: number
}

function Table({ headers, rows, empty = "No records found.", action, actionWidth = 76 }: TableProps) {
  const gridTemplateColumns = `repeat(${headers.length}, minmax(0, 1fr))${action ? ` ${actionWidth}px` : ""}`
  return (
    <div className="mt-5 overflow-hidden rounded border border-[#DEDFDA] bg-white">
      <div
        className="grid bg-[#EEEDEA] px-5 py-3 text-[10px] font-bold uppercase tracking-[.1em] text-[#777C76]"
        style={{ gridTemplateColumns }}
      >
        {headers.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {action && <span className="sr-only">Actions</span>}
      </div>
      {rows.length === 0 && (
        <p className="border-t border-[#E8E9E4] px-5 py-6 text-center text-xs text-[#8B8F89]">
          {empty}
        </p>
      )}
      {rows.map((row, rowIndex) => (
        <div
          key={`${row[0]}-${rowIndex}`}
          className={`grid items-center border-t border-[#E8E9E4] px-5 text-xs ${action ? "py-2.5" : "py-4"}`}
          style={{ gridTemplateColumns }}
        >
          {row.map((cell, index) => (
            <span
              key={index}
              className={`truncate pr-3 ${
                index === 0
                  ? "font-bold text-[#28695E]"
                  : cell === "POSTED" || cell === "Active" || cell === "In stock"
                    ? "font-bold text-[#477252]"
                    : cell === "CANCELLED" || cell === "Low" || cell === "Out of stock"
                      ? "font-bold text-[#A34E42]"
                      : cell === "DRAFT" || cell === "Inactive"
                        ? "font-bold text-[#8A7A4A]"
                        : ""
              }`}
              title={cell}
            >
              {cell}
            </span>
          ))}
          {action && <div className="flex justify-end">{action(rowIndex)}</div>}
        </div>
      ))}
    </div>
  )
}

function Products({
  products,
  categories,
  isAdmin,
  onSaved,
}: {
  products: Product[]
  categories: string[]
  isAdmin: boolean
  onSaved: (product: Product) => void
}) {
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  const shown = products.filter((p) =>
    `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query),
  )
  const rows = shown.map((p) => [
    p.sku,
    p.name,
    p.category,
    isIngredient(p) ? "—" : money(p.price),
    p.isActive ? "Active" : "Inactive",
    myDate(new Date(p.updated)),
  ])
  // null = closed, "new" = add form, a product = edit form
  const [editing, setEditing] = useState<Product | "new" | null>(null)
  return (
    <div className="p-8">
      <Heading
        title="Products"
        subtitle="Current retail catalogue and selling prices. Historical prices remain on transaction lines."
      />
      <div className="mt-6 flex justify-between">
        <label className="flex w-80 items-center gap-2 rounded border border-[#D9DAD5] bg-white px-3 py-2.5">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent text-xs outline-none"
            placeholder="Search products or SKU"
          />
        </label>
        {isAdmin && (
          <button
            className="rounded bg-[#24302C] px-4 text-xs font-bold text-white"
            onClick={() => setEditing("new")}
          >
            + Add product
          </button>
        )}
      </div>
      <Table
        headers={[
          "SKU",
          "Product",
          "Category",
          "Selling price",
          "Status",
          "Updated",
        ]}
        rows={rows}
        empty="No products match this search."
        action={
          isAdmin
            ? (index) => (
                <button
                  onClick={() => setEditing(shown[index])}
                  className="rounded border border-[#D9DAD5] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#28695E] hover:border-[#28695E]"
                >
                  Edit
                </button>
              )
            : undefined
        }
      />
      {editing && (
        <ProductModal
          product={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={(product) => {
            onSaved(product)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

const CUSTOM_PHOTO = "custom"

/** Add a product (product = null) or edit one. Stock is not edited here: use purchases or adjustments. */
function ProductModal({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null
  categories: string[]
  onClose: () => void
  onSaved: (product: Product) => void
}) {
  const isNew = product === null
  const startPhoto = product?.image ?? image.coffee
  const preset = productPhotos.find(([, url]) => url === startPhoto)?.[0]
  const [name, setName] = useState(product?.name ?? "")
  const [sku, setSku] = useState(product?.sku ?? "")
  const [category, setCategory] = useState(product?.category ?? categories[0] ?? "")
  const [price, setPrice] = useState(product?.price ?? 0)
  const [stock, setStock] = useState(0)
  const [reorder, setReorder] = useState(product?.reorder ?? 0)
  const [photo, setPhoto] = useState(preset ?? CUSTOM_PHOTO)
  const [customUrl, setCustomUrl] = useState(preset ? "" : startPhoto)
  const [isActive, setIsActive] = useState(product?.isActive ?? true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const cleanSku = sku.trim().toUpperCase()
    if (!name.trim() || !cleanSku) return setError("Name and SKU are required.")
    if (price <= 0 && category !== INGREDIENTS)
      return setError("Selling price must be greater than 0.")
    const imageUrl =
      photo === CUSTOM_PHOTO ? customUrl.trim() || null : (image[photo as keyof typeof image] ?? null)
    if (imageUrl && !/^https?:\/\/\S+$/.test(imageUrl))
      return setError("Image must be a web address starting with http:// or https://")
    setBusy(true)
    setError("")
    try {
      const { product: saved } = isNew
        ? await api<{ product: Product }>("/products", {
            method: "POST",
            body: { name: name.trim(), sku: cleanSku, category, price, stock, reorder, image: imageUrl },
          })
        : await api<{ product: Product }>(`/products/${product.id}`, {
            method: "PATCH",
            body: { name: name.trim(), price, reorder, image: imageUrl, isActive },
          })
      onSaved(saved)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  const field = "mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none disabled:bg-[#F3F3F1] disabled:text-[#8B8F89]"
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-6">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-4 font-display text-xl font-bold">
          {isNew ? "Add product" : `Edit ${product.name}`}
        </h2>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <label className="mt-5 block text-left text-xs font-bold">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} className={field} />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          SKU
          <input
            value={sku}
            disabled={!isNew}
            onChange={(event) => setSku(event.target.value)}
            className={field}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Category
          <select
            value={category}
            disabled={!isNew}
            onChange={(event) => setCategory(event.target.value)}
            className={field}
          >
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Selling price (MYR)
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(event) => setPrice(Math.max(0, Number(event.target.value) || 0))}
            className={field}
          />
        </label>
        {isNew && (
          <label className="mt-3 block text-left text-xs font-bold">
            Opening stock
            <input
              type="number"
              min={0}
              step={1}
              value={stock}
              onChange={(event) =>
                setStock(Math.max(0, Math.floor(Number(event.target.value)) || 0))
              }
              className={field}
            />
          </label>
        )}
        <label className="mt-3 block text-left text-xs font-bold">
          Reorder level
          <input
            type="number"
            min={0}
            step={1}
            value={reorder}
            onChange={(event) =>
              setReorder(Math.max(0, Math.floor(Number(event.target.value)) || 0))
            }
            className={field}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Image
          <select value={photo} onChange={(event) => setPhoto(event.target.value)} className={field}>
            {productPhotos.map(([key]) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
            <option value={CUSTOM_PHOTO}>Custom image URL…</option>
          </select>
        </label>
        {photo === CUSTOM_PHOTO && (
          <input
            value={customUrl}
            onChange={(event) => setCustomUrl(event.target.value)}
            placeholder="https://…"
            aria-label="Image URL"
            className={field}
          />
        )}
        {!isNew && (
          <label className="mt-4 flex items-center gap-2 text-left text-xs font-bold">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active (shown on the sale screen)
          </label>
        )}
        {!isNew && (
          <p className="mt-3 text-left text-[11px] text-[#858983]">
            Stock changes through purchases and inventory adjustments, so every change is audited.
          </p>
        )}
        <button
          onClick={save}
          disabled={busy}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : isNew ? "Add product" : "Save changes"}
        </button>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recipes & margins
// ---------------------------------------------------------------------------

/** Latest posted purchase unit cost per SKU. The server keeps it in products.cost_price. */
const latestPurchaseCosts = (catalogue: Product[]) =>
  new Map(catalogue.filter((p) => p.costPrice > 0).map((p) => [p.sku, p.costPrice]))

/** The base unit already used for an ingredient in any recipe (ERD: one consistent unit per ingredient). */
const baseUnitOf = (ingredientId: number, recipes: RecipeLine[], exceptRecipeId?: number) =>
  recipes.find((r) => r.ingredientId === ingredientId && r.recipeId !== exceptRecipeId)?.unit

/** True if `fromId`'s recipe (directly or through sub-recipes) uses `targetId`. */
const recipeReaches = (
  fromId: number,
  targetId: number,
  recipes: RecipeLine[],
  seen = new Set<number>(),
): boolean => {
  if (fromId === targetId) return true
  if (seen.has(fromId)) return false
  seen.add(fromId)
  return recipes
    .filter((r) => r.productId === fromId)
    .some((r) => recipeReaches(r.ingredientId, targetId, recipes, seen))
}

type CostedLine = RecipeLine & {
  ingredient: Product | undefined
  unitCost: number | null
  lineCost: number | null
  source: "purchase" | "recipe" | "missing"
}
type RecipeCosting = { lines: CostedLine[]; cost: number; missing: string[] }

/**
 * Cost of ONE unit of a product from its recipe. An ingredient's unit cost is its
 * latest purchase cost, or, if the ingredient has its own recipe, that sub-recipe's cost.
 */
function costRecipe(
  productId: number,
  recipes: RecipeLine[],
  catalogue: Product[],
  costs: Map<string, number>,
  trail: number[] = [],
): RecipeCosting {
  const path = [...trail, productId]
  const lines: CostedLine[] = recipes
    .filter((r) => r.productId === productId)
    .map((r) => {
      const ingredient = catalogue.find((p) => p.id === r.ingredientId)
      let unitCost: number | null = null
      let source: CostedLine["source"] = "missing"
      if (ingredient && !path.includes(ingredient.id)) {
        if (recipes.some((x) => x.productId === ingredient.id)) {
          const sub = costRecipe(ingredient.id, recipes, catalogue, costs, path)
          if (sub.missing.length === 0) {
            unitCost = sub.cost
            source = "recipe"
          }
        } else if (costs.has(ingredient.sku)) {
          unitCost = costs.get(ingredient.sku)!
          source = "purchase"
        }
      }
      return {
        ...r,
        ingredient,
        unitCost,
        source,
        lineCost: unitCost === null ? null : unitCost * r.quantityRequired,
      }
    })
  return {
    lines,
    cost: lines.reduce((sum, line) => sum + (line.lineCost ?? 0), 0),
    missing: lines
      .filter((line) => line.unitCost === null)
      .map((line) => line.ingredient?.name ?? `Product #${line.ingredientId}`),
  }
}

type MarginStatus = "met" | "below" | "incomplete" | "none"
const statusBadge: Record<MarginStatus, [string, string]> = {
  met: ["Target maintained", "bg-[#E4F0E7] text-[#357049]"],
  below: ["Below target", "bg-[#F5E7E3] text-[#A34E42]"],
  incomplete: ["Cost missing", "bg-[#F4EEDC] text-[#8A7A4A]"],
  none: ["No recipe", "bg-[#EEEDEA] text-[#777C76]"],
}

/** Horizontal margin bar with a marker at the target. */
function MarginBar({ margin, target }: { margin: number | null; target: number }) {
  const width = Math.max(0, Math.min(1, margin ?? 0)) * 100
  const met = margin !== null && margin >= target - 1e-9
  return (
    <div className="relative h-1.5 w-full rounded-full bg-[#ECEDE9]">
      <div
        className={`h-full rounded-full ${met ? "bg-[#4F8A62]" : "bg-[#C46A5C]"}`}
        style={{ width: `${width}%` }}
      />
      <div
        className="absolute -top-1 h-3.5 w-0.5 bg-[#24302C]"
        style={{ left: `${target * 100}%` }}
        title={`Target ${pct(target)}`}
      />
    </div>
  )
}

type Suggestion = {
  kind: "Price" | "Supplier" | "Recipe"
  title: string
  detail: string
  applyLabel?: string
  apply?: () => void
}

function Recipes({
  catalogue,
  recipes,
  setRecipes,
  target,
  onTargetChange,
  onApplyPrice,
}: {
  catalogue: Product[]
  recipes: RecipeLine[]
  setRecipes: Dispatch<SetStateAction<RecipeLine[]>>
  target: number
  onTargetChange: (target: number) => Promise<void>
  onApplyPrice: (productId: number, price: number) => Promise<void>
}) {
  const costs = latestPurchaseCosts(catalogue)
  // The input is edited freely; the target is saved only when it is a valid whole percent.
  const [targetText, setTargetText] = useState(String(Math.round(target * 100)))
  const [targetError, setTargetError] = useState("")
  useEffect(() => setTargetText(String(Math.round(target * 100))), [target])
  const saveTarget = async () => {
    const value = Math.round(Number(targetText))
    if (!(value >= 1 && value <= 95)) {
      setTargetError("Enter a whole number from 1 to 95.")
      return setTargetText(String(Math.round(target * 100)))
    }
    setTargetError("")
    if (value / 100 === target) return
    try {
      await onTargetChange(value / 100)
    } catch (err) {
      setTargetError((err as Error).message)
    }
  }
  const rows = catalogue
    .filter((p) => !isIngredient(p) || recipes.some((r) => r.productId === p.id))
    .map((product) => {
      const costing = costRecipe(product.id, recipes, catalogue, costs)
      const hasRecipe = costing.lines.length > 0
      const complete = hasRecipe && costing.missing.length === 0
      const margin =
        complete && product.price > 0 ? (product.price - costing.cost) / product.price : null
      const status: MarginStatus = !hasRecipe
        ? "none"
        : !complete || margin === null
          ? "incomplete"
          : margin >= target - 1e-9
            ? "met"
            : "below"
      return { product, costing, margin, status }
    })
  const [selectedId, setSelectedId] = useState(
    () => rows.find((r) => r.status === "below")?.product.id ?? rows[0]?.product.id ?? 0,
  )
  const selected = rows.find((r) => r.product.id === selectedId) ?? rows[0]
  const evaluated = rows.filter((r) => r.margin !== null)
  const average = evaluated.length
    ? evaluated.reduce((sum, r) => sum + (r.margin ?? 0), 0) / evaluated.length
    : null
  const columns = "minmax(0,2fr) repeat(3, minmax(0,1fr)) minmax(0,1.5fr) minmax(0,1.2fr)"

  return (
    <div className="p-8">
      <Heading
        title="Recipes & margins"
        subtitle="Ingredient cost per unit from each recipe, checked against the target profit margin."
      />
      <div className="mt-6 grid grid-cols-[260px_1fr_1fr_1fr] gap-4">
        <label className="rounded border border-[#28695E] bg-[#EAF1EF] p-5 text-xs font-bold text-[#28695E]">
          Target profit margin
          <div className="mt-2 flex items-baseline gap-1">
            <input
              type="number"
              min={1}
              max={95}
              step={1}
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              onBlur={saveTarget}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              aria-label="Target profit margin percent"
              className="w-20 border border-[#B9CEC8] bg-white px-2 py-1 font-display text-2xl font-bold text-[#24302C] outline-none"
            />
            <span className="font-display text-2xl text-[#24302C]">%</span>
          </div>
          {targetError && (
            <span className="mt-1 block text-[10px] font-normal text-[#A34E42]">{targetError}</span>
          )}
        </label>
        {[
          [`${rows.filter((r) => r.status === "met").length} / ${evaluated.length}`, "Products meeting target"],
          [String(rows.filter((r) => r.status === "below").length), "Below target"],
          [average === null ? "—" : pct(average), "Average margin"],
        ].map(([value, label]) => (
          <div key={label} className="rounded border border-[#DEDFDA] bg-white p-5">
            <p className="font-display text-2xl font-bold">{value}</p>
            <p className="mt-1 text-xs text-[#7E827C]">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-[#7E827C]">
        Margin = (selling price − ingredient cost) ÷ selling price. Selling prices exclude
        service charge and SST. Ingredient costs use each ingredient's latest posted purchase.
        Labour, rent and utilities are not in the data model, so this is the ingredient-cost
        margin. Recipes do not deduct ingredient stock when a sale is posted.
      </p>

      <div className="mt-5 overflow-hidden rounded border border-[#DEDFDA] bg-white">
        <div
          className="grid bg-[#EEEDEA] px-5 py-3 text-[10px] font-bold uppercase tracking-[.1em] text-[#777C76]"
          style={{ gridTemplateColumns: columns }}
        >
          {["Product", "Selling price", "Recipe cost", "Profit / unit", "Margin", "Status"].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        {rows.map(({ product, costing, margin, status }) => {
          const [label, badge] = statusBadge[status]
          const active = selected?.product.id === product.id
          return (
            <button
              key={product.id}
              onClick={() => setSelectedId(product.id)}
              aria-pressed={active}
              className={`grid w-full items-center border-t border-[#E8E9E4] px-5 py-3.5 text-left text-xs ${
                active ? "bg-[#F3F7F5] shadow-[inset_3px_0_0_#28695E]" : "hover:bg-[#F7F7F5]"
              }`}
              style={{ gridTemplateColumns: columns }}
            >
              <span className="truncate pr-3">
                <span className="font-bold">{product.name}</span>
                <span className="ml-2 text-[#92948E]">{product.sku}</span>
              </span>
              <span>{isIngredient(product) ? "—" : money(product.price)}</span>
              <span>{costing.lines.length ? unitMoney(round4(costing.cost)) : "—"}</span>
              <span>{margin === null ? "—" : money(product.price - costing.cost)}</span>
              <span className="flex items-center gap-3 pr-4">
                <span className="w-12 font-bold">{margin === null ? "—" : pct(margin)}</span>
                {margin !== null && <MarginBar margin={margin} target={target} />}
              </span>
              <span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badge}`}>
                  {label}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {selected && (
        <RecipeDetail
          key={selected.product.id}
          product={selected.product}
          costing={selected.costing}
          margin={selected.margin}
          status={selected.status}
          target={target}
          catalogue={catalogue}
          recipes={recipes}
          setRecipes={setRecipes}
          onApplyPrice={onApplyPrice}
        />
      )}
    </div>
  )
}

const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000

function RecipeDetail({
  product,
  costing,
  margin,
  status,
  target,
  catalogue,
  recipes,
  setRecipes,
  onApplyPrice,
}: {
  product: Product
  costing: RecipeCosting
  margin: number | null
  status: MarginStatus
  target: number
  catalogue: Product[]
  recipes: RecipeLine[]
  setRecipes: Dispatch<SetStateAction<RecipeLine[]>>
  onApplyPrice: (productId: number, price: number) => Promise<void>
}) {
  const price = product.price
  const cost = costing.cost
  const [label, badge] = statusBadge[status]

  // ---- Recipe line form (add / edit) ----
  const [editingId, setEditingId] = useState<number | null>(null)
  const [ingredientId, setIngredientId] = useState(0)
  const [quantity, setQuantity] = useState("")
  const [unit, setUnit] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const options = catalogue.filter((p) => p.id !== product.id && p.isActive)
  /** Runs one API change, showing any server error in the form. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const replaceLine = (line: RecipeLine) =>
    setRecipes((current) => current.map((r) => (r.recipeId === line.recipeId ? line : r)))
  const resetForm = () => {
    setEditingId(null)
    setIngredientId(0)
    setQuantity("")
    setUnit("")
    setNotes("")
    setError("")
  }
  const startEdit = (line: RecipeLine) => {
    setEditingId(line.recipeId)
    setIngredientId(line.ingredientId)
    setQuantity(qty(line.quantityRequired))
    setUnit(line.unit)
    setNotes(line.notes ?? "")
    setError("")
  }
  const chooseIngredient = (id: number) => {
    setIngredientId(id)
    const known = baseUnitOf(id, recipes)
    if (known) setUnit(known)
  }
  const save = () => {
    const amount = Number(quantity)
    const cleanUnit = unit.trim()
    if (!ingredientId) return setError("Choose an ingredient.")
    // Application rules from the ERD
    if (ingredientId === product.id) return setError("A product cannot be an ingredient of itself.")
    if (recipeReaches(ingredientId, product.id, recipes))
      return setError("This would create a circular recipe.")
    if (!Number.isFinite(amount) || amount <= 0)
      return setError("Quantity required must be greater than 0.")
    if (Math.abs(amount * 1000 - Math.round(amount * 1000)) > 1e-6)
      return setError("Quantity can have at most 3 decimal places.")
    if (!cleanUnit) return setError("Unit is required.")
    if (cleanUnit.length > 20) return setError("Unit can be at most 20 characters.")
    const known = baseUnitOf(ingredientId, recipes, editingId ?? undefined)
    if (known && known !== cleanUnit)
      return setError(`Use the same base unit as other recipes for this ingredient: "${known}".`)
    const duplicate = recipes.some(
      (r) => r.productId === product.id && r.ingredientId === ingredientId && r.recipeId !== editingId,
    )
    if (duplicate) return setError("This ingredient is already in the recipe. Edit that line instead.")
    const fields = { quantityRequired: amount, unit: cleanUnit, notes: notes.trim() || null }
    run(async () => {
      if (editingId !== null) {
        const { recipe } = await api<{ recipe: Wire<RecipeLine, "createdAt" | "updatedAt"> }>(
          `/recipes/${editingId}`,
          { method: "PATCH", body: fields },
        )
        replaceLine(toRecipe(recipe))
      } else {
        const { recipe } = await api<{ recipe: Wire<RecipeLine, "createdAt" | "updatedAt"> }>("/recipes", {
          method: "POST",
          body: { productId: product.id, ingredientId, ...fields },
        })
        setRecipes((current) => [...current, toRecipe(recipe)])
      }
      resetForm()
    })
  }
  const remove = (recipeId: number) =>
    run(async () => {
      await api(`/recipes/${recipeId}`, { method: "DELETE" })
      setRecipes((current) => current.filter((r) => r.recipeId !== recipeId))
      if (editingId === recipeId) resetForm()
    })
  const setLineQuantity = (recipeId: number, amount: number) =>
    run(async () => {
      const { recipe } = await api<{ recipe: Wire<RecipeLine, "createdAt" | "updatedAt"> }>(
        `/recipes/${recipeId}`,
        { method: "PATCH", body: { quantityRequired: amount } },
      )
      replaceLine(toRecipe(recipe))
    })

  // ---- Suggestions when the target margin is not met ----
  const suggestions: Suggestion[] = []
  const maxCost = price * (1 - target)
  const gap = cost - maxCost // > 0: how much cost must fall to reach the target
  if (status === "below") {
    const newPrice = Math.ceil((cost / (1 - target)) * 10 - 1e-9) / 10
    suggestions.push({
      kind: "Price",
      title: `Increase the price to ${money(newPrice)}`,
      detail: `From ${money(price)} (+${pct((newPrice - price) / price)}). At ${money(newPrice)} the margin is ${pct((newPrice - cost) / newPrice)}.`,
      applyLabel: `Set price to ${money(newPrice)}`,
      apply: () => run(() => onApplyPrice(product.id, newPrice)),
    })

    const purchased = costing.lines
      .filter((l) => l.source === "purchase" && (l.lineCost ?? 0) > 0)
      .sort((a, b) => (b.lineCost ?? 0) - (a.lineCost ?? 0))
    const biggest = purchased[0]
    if (biggest && (biggest.lineCost ?? 0) > gap) {
      const lineCost = biggest.lineCost ?? 0
      const targetUnitCost = Math.floor(((lineCost - gap) / biggest.quantityRequired) * 10000) / 10000
      suggestions.push({
        kind: "Supplier",
        title: `Find a cheaper supplier for ${biggest.ingredient?.name}`,
        detail: `It is the largest cost in this recipe (${pct(lineCost / cost)}). Buying it at ${unitMoney(targetUnitCost)}/${biggest.unit} or less (now ${unitMoney(biggest.unitCost ?? 0)}/${biggest.unit}, −${pct(gap / lineCost)}) reaches the target.`,
      })
    } else if (biggest) {
      suggestions.push({
        kind: "Supplier",
        title: "A supplier change alone is not enough",
        detail: `Even ${biggest.ingredient?.name} at no cost would not close the ${money(gap)} gap. Combine a price increase with lower ingredient costs.`,
      })
    }

    // Reduce one ingredient by at most 35% (pieces such as eggs or bottles are not reduced).
    const reductions = costing.lines
      .filter((l) => l.unitCost && l.lineCost && l.lineCost > gap && l.unit.toLowerCase() !== "piece")
      .map((l) => {
        const newQty = Math.floor((((l.lineCost ?? 0) - gap) / (l.unitCost ?? 1)) * 10) / 10
        return { line: l, newQty, cut: 1 - newQty / l.quantityRequired }
      })
      .filter((r) => r.newQty > 0 && r.cut <= 0.35)
      .sort((a, b) => a.cut - b.cut)
    const best = reductions[0]
    if (best) {
      suggestions.push({
        kind: "Recipe",
        title: `Use less ${best.line.ingredient?.name}`,
        detail: `Reduce it from ${qty(best.line.quantityRequired)} ${best.line.unit} to ${qty(best.newQty)} ${best.line.unit} per unit (−${pct(best.cut)}), saving ${unitMoney(round4((best.line.quantityRequired - best.newQty) * (best.line.unitCost ?? 0)))} per unit. Check that taste and portion size stay acceptable.`,
        applyLabel: `Set to ${qty(best.newQty)} ${best.line.unit}`,
        apply: () => setLineQuantity(best.line.recipeId, best.newQty),
      })
    } else {
      suggestions.push({
        kind: "Recipe",
        title: "No single ingredient can be reduced enough",
        detail: "Cutting any one ingredient by up to 35% would not reach the target. Use a price increase or a cheaper supplier instead.",
      })
    }
  }

  return (
    <section className="mt-6 rounded border border-[#DEDFDA] bg-white">
      <header className="flex items-start justify-between gap-6 border-b border-[#E4E5E0] p-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#858983]">
            Recipe · {product.sku}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold">{product.name}</h2>
          <span className={`mt-2 inline-block rounded-full px-2 py-1 text-[10px] font-bold ${badge}`}>
            {label}
          </span>
        </div>
        <dl className="grid grid-cols-4 gap-6 text-right">
          {[
            ["Selling price", isIngredient(product) ? "—" : money(price)],
            ["Recipe cost", costing.lines.length ? unitMoney(round4(cost)) : "—"],
            ["Profit / unit", margin === null ? "—" : money(price - cost)],
            ["Margin", margin === null ? "—" : pct(margin)],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="text-[10px] font-bold uppercase tracking-[.1em] text-[#858983]">{term}</dt>
              <dd className="mt-1 font-display text-xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {margin !== null && (
        <div className="border-b border-[#E4E5E0] px-6 py-4">
          <div className="mb-2 flex justify-between text-[11px] text-[#7E827C]">
            <span>Margin {pct(margin)}</span>
            <span>Target {pct(target)} · max ingredient cost {money(maxCost)}</span>
          </div>
          <MarginBar margin={margin} target={target} />
        </div>
      )}

      {/* Recipe lines */}
      <div className="p-6">
        <h3 className="text-xs font-bold">Ingredients per 1 unit</h3>
        {costing.missing.length > 0 && (
          <p className="mt-3 rounded bg-[#F4EEDC] px-3 py-2 text-xs text-[#7A6A3A]">
            No purchase cost yet for {costing.missing.join(", ")}. Record a purchase in
            Transactions to calculate the margin.
          </p>
        )}
        <div className="mt-3 overflow-hidden rounded border border-[#E4E5E0]">
          <div className="grid grid-cols-[minmax(0,2fr)_90px_110px_100px_70px_minmax(0,1.6fr)_100px_120px] bg-[#F3F3F1] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#777C76]">
            {["Ingredient", "Quantity", "Unit cost", "Line cost", "Share", "Notes", "Updated", ""].map((h, i) => (
              <span key={i}>{h}</span>
            ))}
          </div>
          {costing.lines.length === 0 && (
            <p className="border-t border-[#E8E9E4] px-4 py-6 text-center text-xs text-[#8B8F89]">
              No recipe yet. Add the ingredients needed to make one {product.name}.
            </p>
          )}
          {[...costing.lines]
            .sort((a, b) => (b.lineCost ?? -1) - (a.lineCost ?? -1))
            .map((line) => (
              <div
                key={line.recipeId}
                className={`grid grid-cols-[minmax(0,2fr)_90px_110px_100px_70px_minmax(0,1.6fr)_100px_120px] items-center border-t border-[#E8E9E4] px-4 py-2.5 text-xs ${
                  editingId === line.recipeId ? "bg-[#F3F7F5]" : ""
                }`}
              >
                <span className="truncate pr-2">
                  <span className="font-bold">{line.ingredient?.name ?? `#${line.ingredientId}`}</span>
                  {line.source === "recipe" && (
                    <span className="ml-1.5 text-[10px] text-[#28695E]">sub-recipe</span>
                  )}
                </span>
                <span>
                  {qty(line.quantityRequired)} {line.unit}
                </span>
                <span>{line.unitCost === null ? "—" : `${unitMoney(round4(line.unitCost))}/${line.unit}`}</span>
                <span className="font-bold">{line.lineCost === null ? "—" : unitMoney(round4(line.lineCost))}</span>
                <span>{line.lineCost === null || cost === 0 ? "—" : pct(line.lineCost / cost)}</span>
                <span className="truncate pr-2 text-[#7E827C]" title={line.notes ?? ""}>
                  {line.notes ?? "—"}
                </span>
                <span className="text-[#7E827C]">{myStamp(line.updatedAt)}</span>
                <span className="flex justify-end gap-1.5">
                  <button
                    onClick={() => startEdit(line)}
                    className="rounded border border-[#D9DAD5] px-2 py-1 text-[11px] font-bold text-[#28695E]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(line.recipeId)}
                    disabled={busy}
                    aria-label={`Remove ${line.ingredient?.name}`}
                    className="rounded border border-[#D9DAD5] px-2 py-1 text-[#A34E42]"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </span>
              </div>
            ))}
        </div>

        {/* Add / edit form */}
        <div className="mt-4 rounded border border-dashed border-[#CAD7D3] bg-[#FAFBFA] p-4">
          <p className="text-xs font-bold">
            {editingId !== null ? "Edit ingredient line" : "Add ingredient"}
          </p>
          {error && (
            <p className="mt-2 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{error}</p>
          )}
          <div className="mt-3 grid grid-cols-[minmax(0,2fr)_110px_100px_minmax(0,2fr)_auto] items-end gap-3">
            <label className="text-[11px] font-bold text-[#666A65]">
              Ingredient
              <select
                value={ingredientId}
                disabled={editingId !== null}
                onChange={(event) => chooseIngredient(Number(event.target.value))}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none disabled:bg-[#F3F3F1]"
              >
                <option value={0}>Select…</option>
                <optgroup label="Ingredients">
                  {options.filter(isIngredient).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {baseUnitOf(p.id, recipes) ? ` (${baseUnitOf(p.id, recipes)})` : ""}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other products (sub-recipes)">
                  {options.filter((p) => !isIngredient(p)).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="text-[11px] font-bold text-[#666A65]">
              Quantity
              <input
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none"
              />
            </label>
            <label className="text-[11px] font-bold text-[#666A65]">
              Unit
              <input
                value={unit}
                maxLength={20}
                placeholder="g, ml, piece"
                onChange={(event) => setUnit(event.target.value)}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none"
              />
            </label>
            <label className="text-[11px] font-bold text-[#666A65]">
              Notes (optional)
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none"
              />
            </label>
            <div className="flex gap-2">
              {editingId !== null && (
                <button
                  onClick={resetForm}
                  className="rounded border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-bold text-[#666A65]"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={save}
                disabled={busy}
                className="rounded bg-[#28695E] px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                {busy ? "Saving…" : editingId !== null ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Margin outcome */}
      <div className="border-t border-[#E4E5E0] p-6">
        {error && status === "below" && (
          <p className="mb-4 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{error}</p>
        )}
        {status === "met" && margin !== null && (
          <div className="rounded border-l-2 border-[#4F8A62] bg-[#EEF5F0] p-4 text-xs leading-relaxed text-[#45604D]">
            <strong>Target maintained.</strong> {pct(margin)} is at or above the{" "}
            {pct(target)} target. Ingredient cost could rise by up to {money(maxCost - cost)} per
            unit, or the price could drop to {money(Math.ceil((cost / (1 - target)) * 100 - 1e-9) / 100)},
            before the margin falls below target.
          </div>
        )}
        {status === "below" && (
          <>
            <div className="rounded border-l-2 border-[#C46A5C] bg-[#FBF0ED] p-4 text-xs leading-relaxed text-[#8A4A40]">
              <strong>Target not met.</strong> Margin is {pct(margin ?? 0)}, below the {pct(target)}{" "}
              target. Ingredient cost must fall by {money(gap)} per unit (to {money(maxCost)}), or the
              price must rise. Each suggestion below would reach the target on its own, unless
              it says otherwise:
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {suggestions.map((s) => (
                <article key={s.kind} className="flex flex-col rounded border border-[#DEDFDA] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#28695E]">
                    {s.kind}
                  </p>
                  <h4 className="mt-1.5 text-sm font-bold">{s.title}</h4>
                  <p className="mt-1.5 flex-1 text-xs leading-relaxed text-[#6F746E]">{s.detail}</p>
                  {s.apply && (
                    <button
                      onClick={s.apply}
                      disabled={busy}
                      className="mt-3 self-start rounded border border-[#28695E] px-3 py-1.5 text-xs font-bold text-[#28695E] hover:bg-[#EAF1EF]"
                    >
                      {s.applyLabel}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {status === "incomplete" && (
          <p className="text-xs text-[#7A6A3A]">
            The margin can't be checked until every ingredient has a purchase cost.
          </p>
        )}
        {status === "none" && (
          <p className="text-xs text-[#7E827C]">Add ingredients above to calculate the margin.</p>
        )}
      </div>
    </section>
  )
}

function Inventory({
  products,
  recipes,
  movements,
  onAdjust,
}: {
  products: Product[]
  recipes: RecipeLine[]
  movements: Movement[]
  onAdjust: (productId: number, change: number, reason: string) => Promise<void>
}) {
  // Ingredients are counted in their recipe base unit (g, ml, piece).
  const unitOf = (p: Product) =>
    (isIngredient(p) && baseUnitOf(p.id, recipes)) || "units"
  // "Updated" = time of the product's latest stock movement (list is newest first).
  const lastMoved = (id: number) => {
    const latest = movements.find((m) => m.productId === id)
    return latest ? myStamp(latest.created) : "—"
  }
  const tracked = products.filter((p) => p.isActive)
  const rows = tracked.map((p) => [
    p.sku,
    p.name,
    `${p.stock} ${unitOf(p)}`,
    `${p.reorder} ${unitOf(p)}`,
    p.stock === 0 ? "Out of stock" : p.stock <= p.reorder ? "Low" : "In stock",
    lastMoved(p.id),
  ])
  // Grams and pieces can't be added together, so this counts sellable products only.
  const unitsOnHand = tracked
    .filter((p) => !isIngredient(p))
    .reduce((sum, p) => sum + p.stock, 0)
  const lowCount = tracked.filter((p) => p.stock <= p.reorder).length
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [productId, setProductId] = useState(tracked[0]?.id ?? 0)
  const [adjustment, setAdjustment] = useState(0)
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const product = tracked.find((item) => item.id === productId)
  const openAdjust = () => {
    if (!product) setProductId(tracked[0]?.id ?? 0)
    setAdjustment(0)
    setReason("")
    setError("")
    setAdjustOpen(true)
  }
  const apply = async () => {
    if (!product) return
    if (adjustment === 0) return setError("Enter a non-zero adjustment.")
    if (product.stock + adjustment < 0)
      return setError(
        `Only ${product.stock} units on hand; stock cannot go below zero.`,
      )
    if (!reason.trim()) return setError("A reason is required for the audit trail.")
    setBusy(true)
    setError("")
    try {
      await onAdjust(product.id, adjustment, reason.trim())
      setAdjustOpen(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="p-8">
      <Heading
        title="Inventory"
        subtitle="One current whole-unit balance per active product at the Main Store."
      />
      <div className="mt-6 grid grid-cols-3 gap-4">
        {[
          [String(unitsOnHand), "Sellable units on hand"],
          [String(lowCount), "At or below reorder level"],
          [String(tracked.length), "Products tracked"],
        ].map(([value, label]) => (
          <div
            key={label}
            className="rounded border border-[#DEDFDA] bg-white p-5"
          >
            <p className="font-display text-2xl font-bold">{value}</p>
            <p className="mt-1 text-xs text-[#7E827C]">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          className="rounded bg-[#24302C] px-4 py-2.5 text-xs font-bold text-white"
          onClick={openAdjust}
        >
          Record adjustment
        </button>
      </div>
      <Table
        headers={[
          "SKU",
          "Product",
          "On hand",
          "Reorder level",
          "Status",
          "Updated",
        ]}
        rows={rows}
      />
      {adjustOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
          <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
            <h2 className="mt-4 font-display text-xl font-bold">
              Record adjustment
            </h2>
            {error && (
              <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
                {error}
              </p>
            )}
            <label className="mt-4 block text-left text-xs font-bold">
              Product
              <select
                value={productId}
                onChange={(event) => setProductId(Number(event.target.value))}
                className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
              >
                {tracked.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.stock} {unitOf(item)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-left text-xs font-bold">
              Adjustment (units, negative for loss)
              <input
                type="number"
                step={1}
                value={adjustment}
                onChange={(event) =>
                  setAdjustment(Math.trunc(Number(event.target.value)) || 0)
                }
                className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
              />
            </label>
            <label className="mt-3 block text-left text-xs font-bold">
              Reason
              <input
                value={reason}
                maxLength={100}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Damaged unit, stock count correction"
                className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
              />
            </label>
            <button
              onClick={apply}
              disabled={busy}
              className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? "Saving…" : "Apply adjustment"}
            </button>
            <button
              onClick={() => setAdjustOpen(false)}
              className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StockMovements({ movements }: { movements: Movement[] }) {
  const rows = movements.map((m) => [
    m.id,
    m.product,
    m.type,
    m.change > 0 ? `+${m.change}` : `−${Math.abs(m.change)}`,
    m.source,
    m.by,
    myStamp(m.created),
  ])
  return (
    <div className="p-8">
      <Heading
        title="Stock movements"
        subtitle="Append-only inventory history. Every posted transaction line creates at most one movement."
      />
      <div className="mt-5 rounded border-l-2 border-[#28695E] bg-[#EAF1EF] p-4 text-xs text-[#5E6863]">
        <strong>Audit rule:</strong> Movement records are not edited or deleted.
        Corrections are posted as new adjustments with a reason.
      </div>
      <Table
        headers={[
          "Movement",
          "Product",
          "Type",
          "Change",
          "Source",
          "Recorded by",
          "Created",
        ]}
        rows={rows}
        empty="No stock movements yet."
      />
    </div>
  )
}

function Forecasts({ catalogue, forecasts }: { catalogue: Product[]; forecasts: Forecast[] }) {
  const [reviewed, setReviewed] = useState(false)
  // Predicted demand comes from forecast_results (newest run per product). On-hand and
  // the recommendation use live stock, so they stay right after sales and purchases.
  const items = forecasts
    .map((forecast) => ({ forecast, product: catalogue.find((p) => p.id === forecast.productId) }))
    .filter((item): item is { forecast: Forecast; product: Product } => Boolean(item.product))
  const demand = items.map(({ forecast, product }) => {
    // When forecast demand exceeds stock, order enough to cover it and
    // restore the reorder level as safety stock.
    const order = Math.ceil(forecast.predicted + product.reorder - product.stock)
    return [
      product.name,
      String(product.stock),
      forecast.predicted.toFixed(1),
      String(product.reorder),
      forecast.predicted > product.stock ? `Order ${order} units` : "Stock sufficient",
    ]
  })
  const total = items.reduce((sum, { forecast }) => sum + forecast.predicted, 0)
  const atRisk = items.filter(({ forecast, product }) => forecast.predicted > product.stock).length
  const latest = forecasts.reduce<Forecast | null>(
    (best, f) => (!best || f.generatedAt > best.generatedAt ? f : best),
    null,
  )
  const horizon = latest?.horizonDays ?? 7
  // One shared scale for demand and stock, so the bar and the stock marker compare directly.
  const scale = Math.max(1, ...items.map(({ forecast, product }) => Math.max(forecast.predicted, product.stock)))
  return (
    <div className="p-8">
      <Heading
        title="Demand forecasts"
        subtitle={
          latest
            ? `Latest results from ${latest.model}${latest.modelVersion ? ` v${latest.modelVersion}` : ""} · generated ${myDateTime(latest.generatedAt)} MYT.`
            : "No forecast results yet."
        }
      />
      {items.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-[#D8D9D4] bg-white p-8 text-center text-xs text-[#8B8F89]">
          No forecasts have been generated yet. When the forecast job writes to
          forecast_results, the results appear here.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-[1fr_280px] gap-5">
            <figure className="rounded border border-[#DEDFDA] bg-white p-5">
              <div className="flex justify-between">
                <figcaption>
                  <p className="text-xs font-bold">Predicted demand · next {horizon} days</p>
                  <p className="mt-1 text-[11px] text-[#858983]">
                    Bar = predicted units · marker = units on hand now
                  </p>
                </figcaption>
                <span className="text-xs font-bold text-[#28695E]">
                  {total.toFixed(1)} units
                </span>
              </div>
              <div className="mt-5 space-y-2.5">
                {items.map(({ forecast, product }) => {
                  const short = forecast.predicted > product.stock
                  return (
                    <div
                      key={product.id}
                      className="group grid grid-cols-[150px_1fr_52px] items-center gap-3 text-[11px]"
                      title={`${product.name}: ${forecast.predicted.toFixed(1)} predicted, ${product.stock} on hand`}
                    >
                      <span className="truncate text-[#5E6863]">{product.name}</span>
                      <div className="relative h-4">
                        <div
                          className="h-full rounded-r bg-[#73958D] group-hover:bg-[#28695E]"
                          style={{ width: `${(forecast.predicted / scale) * 100}%` }}
                        />
                        <div
                          className="absolute -top-0.5 h-5 w-0.5 bg-[#24302C]"
                          style={{ left: `${(product.stock / scale) * 100}%` }}
                        />
                      </div>
                      <span className="text-right tabular-nums text-[#24302C]">
                        {forecast.predicted.toFixed(1)}
                        {short && <span className="sr-only"> (more than stock)</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </figure>
            <div className="rounded border border-[#CAD7D3] bg-[#EAF1EF] p-5">
              <Icon name="trend" size={20} />
              <p className="mt-5 text-xs font-bold uppercase tracking-[.12em] text-[#28695E]">
                Forecast note
              </p>
              <h2 className="mt-3 font-display text-xl font-bold">
                {atRisk > 0 ? "Stock needs attention." : "Stock covers demand."}
              </h2>
              <p className="mt-3 text-xs leading-relaxed text-[#606A65]">
                {atRisk > 0
                  ? `Predicted demand exceeds available stock for ${atRisk} product${atRisk === 1 ? "" : "s"} during the next ${horizon}-day period.`
                  : `Available stock covers predicted demand for the next ${horizon}-day period.`}
              </p>
              <button
                className="mt-5 text-xs font-bold text-[#28695E]"
                onClick={() => setReviewed(true)}
              >
                {reviewed
                  ? "Recommendations reviewed ✓"
                  : "Review recommendations →"}
              </button>
            </div>
          </div>
          <Table
            headers={[
              "Product",
              "On hand",
              "Predicted demand",
              "Reorder level",
              "Recommendation",
            ]}
            rows={demand}
          />
        </>
      )}
    </div>
  )
}

function Users({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [resetFor, setResetFor] = useState<StaffUser | null>(null)

  useEffect(() => {
    api<{ users: StaffUser[] }>("/users")
      .then(({ users }) => setUsers(users))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const replace = (user: StaffUser) =>
    setUsers((current) => current.map((u) => (u.id === user.id ? user : u)))

  const toggleActive = async (user: StaffUser) => {
    setError("")
    try {
      const { user: updated } = await api<{ user: StaffUser }>(`/users/${user.id}`, {
        method: "PATCH",
        body: { isActive: !user.isActive },
      })
      replace(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const rows = users.map((u) => [
    u.code,
    u.name,
    u.email,
    u.role,
    u.isActive ? "Active" : "Inactive",
    myDate(new Date(u.createdAt)),
  ])

  return (
    <div className="p-8">
      <Heading
        title="Users"
        subtitle="Staff accounts and application roles. Deactivate accounts to preserve audit history."
      />
      <div className="mt-6 flex justify-end">
        <button
          className="rounded bg-[#24302C] px-4 py-2.5 text-xs font-bold text-white"
          onClick={() => setAddOpen(true)}
        >
          + Add staff user
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">
          {error}
        </p>
      )}
      <Table
        headers={["User ID", "Full name", "Email", "Role", "Status", "Created"]}
        rows={rows}
        empty={loading ? "Loading users…" : "No users found."}
        actionWidth={150}
        action={(index) => {
          const user = users[index]
          const self = user.id === currentUserId
          return (
            <div className="flex gap-1">
              <button
                onClick={() => setResetFor(user)}
                className="rounded border border-[#D9DAD5] px-2 py-1 text-[10px] font-bold text-[#666A65]"
                title="Set a new password"
              >
                Password
              </button>
              <button
                disabled={self}
                onClick={() => toggleActive(user)}
                className="rounded border border-[#D9DAD5] px-2 py-1 text-[10px] font-bold text-[#666A65] disabled:opacity-30"
                title={self ? "You cannot deactivate your own account" : undefined}
              >
                {user.isActive ? "Disable" : "Enable"}
              </button>
            </div>
          )
        }}
      />
      {addOpen && (
        <AddUserModal
          onClose={() => setAddOpen(false)}
          onAdded={(user) => {
            setUsers((current) => [...current, user])
            setAddOpen(false)
          }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={(user) => {
            replace(user)
            setResetFor(null)
          }}
        />
      )}
    </div>
  )
}

// Same rule as the server (server/src/routes/admin.js), checked here for a quicker message.
const passwordProblem = (password: string) =>
  password.length < 10
    ? "Password must be at least 10 characters."
    : !/[A-Za-z]/.test(password) || !/\d/.test(password)
      ? "Password needs letters and numbers."
      : ""

const fieldClass =
  "mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none focus:border-[#28695E]"

function PasswordFields({
  label,
  password,
  setPassword,
  confirm,
  setConfirm,
}: {
  label: string
  password: string
  setPassword: (value: string) => void
  confirm: string
  setConfirm: (value: string) => void
}) {
  return (
    <>
      <label className="mt-3 block text-left text-xs font-bold">
        {label}
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={fieldClass}
        />
        <span className="mt-1 block text-[10px] font-normal text-[#858983]">
          At least 10 characters, with letters and numbers.
        </span>
      </label>
      <label className="mt-3 block text-left text-xs font-bold">
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={fieldClass}
        />
      </label>
    </>
  )
}

function ModalButtons({ busy, label, busyLabel, onClose }: { busy: boolean; label: string; busyLabel: string; onClose: () => void }) {
  return (
    <>
      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-60"
      >
        {busy ? busyLabel : label}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
      >
        Cancel
      </button>
    </>
  )
}

function AddUserModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: (user: StaffUser) => void
}) {
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("STAFF")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const add = async (event: FormEvent) => {
    event.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    if (!fullName.trim() || !cleanEmail) return setError("Full name and email are required.")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      return setError("Enter a valid email address.")
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError("Passwords do not match.")
    setBusy(true)
    setError("")
    try {
      const { user } = await api<{ user: StaffUser }>("/users", {
        method: "POST",
        body: { name: fullName.trim(), email: cleanEmail, role, password },
      })
      onAdded(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
      <form
        onSubmit={add}
        noValidate
        className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl"
      >
        <h2 className="mt-4 font-display text-xl font-bold">Add staff user</h2>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <label className="mt-4 block text-left text-xs font-bold">
          Full name
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Email
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className={fieldClass}
          >
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <PasswordFields
          label="Password"
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
        />
        <ModalButtons busy={busy} label="Add user" busyLabel="Adding…" onClose={onClose} />
      </form>
    </div>
  )
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: StaffUser
  onClose: () => void
  onDone: (user: StaffUser) => void
}) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError("Passwords do not match.")
    setBusy(true)
    setError("")
    try {
      const { user: updated } = await api<{ user: StaffUser }>(`/users/${user.id}`, {
        method: "PATCH",
        body: { password },
      })
      onDone(updated)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
      <form
        onSubmit={save}
        noValidate
        className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl"
      >
        <h2 className="mt-4 font-display text-xl font-bold">Set new password</h2>
        <p className="mt-1 text-xs text-[#757973]">
          {user.name} · {user.email}
        </p>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <PasswordFields
          label="New password"
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
        />
        <ModalButtons busy={busy} label="Save password" busyLabel="Saving…" onClose={onClose} />
      </form>
    </div>
  )
}

/** Live header clock, always in Malaysia Time. */
function MalaysiaClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  const p = malaysiaParts(now)
  return (
    <span title="Malaysia Time (UTC+8)">
      {p.day} {p.month} {p.year} · {p.hour}:{p.minute} MYT
    </span>
  )
}

/** UUID for a sale's requestId. randomUUID needs HTTPS (or localhost); fall back otherwise. */
const newRequestId = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null)
  // True until we know whether a session cookie from an earlier visit is still valid.
  const [checkingSession, setCheckingSession] = useState(true)

  // Restore the session on page load: the cookie is httpOnly, so ask the server who we are.
  useEffect(() => {
    api<{ user: SessionUser }>("/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false))
  }, [])

  // Any request that comes back 401 (session expired, account disabled) returns to sign-in.
  useEffect(() => {
    onSessionLost = () => setUser(null)
    return () => {
      onSessionLost = () => {}
    }
  }, [])

  if (checkingSession)
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F4F0] text-xs text-[#858983]">
        Loading…
      </main>
    )
  if (!user) return <Login onLogin={setUser} />
  const signOut = async () => {
    // Clear the screen even if the request fails; the cookie expires on its own.
    await api("/auth/logout", { method: "POST" }).catch(() => {})
    setUser(null)
  }
  // Keyed by user, so signing out throws away everything the last person loaded.
  return <Workspace key={user.id} user={user} onSignOut={signOut} />
}

type Settings = Rates & { targetMargin: number }

/** The signed-in app. Every screen reads from and writes to the API; nothing is kept only in the browser. */
function Workspace({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const isAdmin = user.role === "ADMIN"
  const [view, setView] = useState<View>("New sale")
  const [catalogue, setCatalogue] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_RATES, targetMargin: 0.6 })
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [recipes, setRecipes] = useState<RecipeLine[]>([])
  const [forecasts, setForecasts] = useState<Forecast[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [cart, setCart] = useState<CartLine[]>([])
  const [payment, setPayment] = useState<Payment>("Cash")
  const [posting, setPosting] = useState(false)
  const [saleError, setSaleError] = useState("")
  // Kept until the sale is saved: a retry after a lost reply sends the same id, so the
  // server returns the first sale instead of charging twice.
  const [saleRequestId, setSaleRequestId] = useState<string | null>(null)
  const [posted, setPosted] = useState<Transaction | null>(null)

  // Only the newest load may write its results, so a slow older reply can't overwrite newer data.
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const [p, c, s, t, adminData] = await Promise.all([
        api<{ products: Product[] }>(isAdmin ? "/products?all=1" : "/products"),
        api<{ categories: Category[] }>("/categories"),
        api<{ settings: Settings }>("/settings"),
        api<{ transactions: Wire<Transaction, "at">[] }>("/transactions"),
        isAdmin
          ? Promise.all([
              api<{ recipes: Wire<RecipeLine, "createdAt" | "updatedAt">[] }>("/recipes"),
              api<{ movements: Wire<Movement, "created">[] }>("/stock-movements"),
              api<{ forecasts: Wire<Forecast, "generatedAt">[] }>("/forecasts"),
            ])
          : Promise.resolve(null),
      ])
      if (seq !== loadSeq.current) return
      setCatalogue(p.products)
      setCategories(c.categories.map((category) => category.name))
      setSettings(s.settings)
      setTransactions(t.transactions.map(toTransaction))
      if (adminData) {
        const [r, m, f] = adminData
        setRecipes(r.recipes.map(toRecipe))
        setMovements(m.movements.map(toMovement))
        setForecasts(f.forecasts.map(toForecast))
      }
      setLoadError("")
    } catch (err) {
      if (seq === loadSeq.current) setLoadError((err as Error).message)
    } finally {
      if (seq === loadSeq.current) setLoaded(true)
    }
  }, [isAdmin])

  // Load on sign-in and again on every screen change, so each till sees other tills' sales.
  useEffect(() => {
    load()
  }, [load, view])

  // Drop cart lines whose product was deactivated or removed since it was added.
  useEffect(() => {
    setCart((current) => {
      const kept = current.filter((line) =>
        catalogue.some((p) => p.id === line.productId && p.isActive && !isIngredient(p)),
      )
      return kept.length === current.length ? current : kept
    })
  }, [catalogue])

  const replaceProduct = (product: Product) =>
    setCatalogue((current) =>
      current.some((p) => p.id === product.id)
        ? current.map((p) => (p.id === product.id ? product : p))
        : [...current, product],
    )

  const postSale = async () => {
    const requestId = saleRequestId ?? newRequestId()
    setSaleRequestId(requestId)
    setPosting(true)
    setSaleError("")
    try {
      const { sale } = await api<{ sale: Wire<Transaction, "at"> }>("/sales", {
        method: "POST",
        body: {
          requestId,
          payment,
          lines: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        },
      })
      setSaleRequestId(null)
      setPosted(toTransaction(sale))
    } catch (err) {
      setSaleError((err as Error).message)
    } finally {
      setPosting(false)
      load() // fresh stock either way
    }
  }

  const postPurchase = async (productId: number, quantity: number, unitCost: number) => {
    await api("/purchases", { method: "POST", body: { productId, quantity, unitCost } })
    await load()
  }

  const adjustStock = async (productId: number, change: number, reason: string) => {
    await api("/inventory/adjustments", { method: "POST", body: { productId, change, reason } })
    await load()
  }

  const applyPrice = async (productId: number, price: number) => {
    const { product } = await api<{ product: Product }>(`/products/${productId}`, {
      method: "PATCH",
      body: { price },
    })
    replaceProduct(product)
  }

  const saveTargetMargin = async (value: number) => {
    const { settings: saved } = await api<{ settings: Settings }>("/settings/target-margin", {
      method: "PUT",
      body: { value },
    })
    setSettings(saved)
  }

  const allowed = (item: NavigationItem) => !item.admin || isAdmin
  const lowStockCount = catalogue.filter((p) => p.isActive && p.stock <= p.reorder).length

  return (
    <main className="flex h-screen min-w-[1100px] flex-col overflow-hidden bg-[#F3F3F1] text-[#24302C]">
      <header className="flex h-16 shrink-0 items-center border-b border-[#E2E3DF] bg-white px-6">
        <div className="w-[205px] font-display text-base font-bold text-[#28695E]">
          Juniper Cafe
        </div>
        <div className="flex-1 text-center text-[10px] text-[#858984]">
          Main Store · MYR
        </div>
        <div className="flex w-[340px] items-center justify-end gap-3 text-[10px]">
          <MalaysiaClock />
          <span>
            {user.name} · {user.role}
          </span>
          <button onClick={onSignOut} title="Sign out" aria-label="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[205px] shrink-0 flex-col border-r border-[#E0E1DD] bg-white py-7">
          <nav className="flex flex-col">
            {navigation.map((item) => (
              <button
                key={item.label}
                disabled={!allowed(item)}
                onClick={() => allowed(item) && setView(item.label)}
                className={`relative flex items-center px-5 py-3 text-left text-xs ${
                  view === item.label
                    ? "font-bold text-[#28695E] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-[#28695E]"
                    : "text-[#777D78] hover:bg-[#F7F7F5]"
                } disabled:cursor-not-allowed disabled:opacity-30`}
              >
                <span>{item.label}</span>
                {!allowed(item) && (
                  <span className="ml-auto">
                    <Icon name="lock" size={11} />
                  </span>
                )}
                {item.label === "Inventory" && isAdmin && lowStockCount > 0 && (
                  <span
                    className="ml-auto rounded-full bg-[#F5E7E3] px-1.5 py-0.5 text-[9px] text-[#A34E42]"
                    title={`${lowStockCount} products at or below reorder level`}
                  >
                    {lowStockCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto bg-[#F5F4F0]">
          {loadError && (
            <div
              role="alert"
              className="mx-8 mt-6 flex items-center justify-between rounded bg-[#F5E7E3] px-4 py-3 text-xs text-[#A34E42]"
            >
              <span>
                {loaded && catalogue.length ? "Could not refresh data: " : "Could not load data: "}
                {loadError}
              </span>
              <button onClick={() => load()} className="font-bold underline">
                Retry
              </button>
            </div>
          )}
          {!loaded ? (
            <p className="p-8 text-xs text-[#858983]">Loading workspace…</p>
          ) : (
            <>
              {view === "New sale" && (
                <NewSale
                  catalogue={catalogue}
                  categories={categories.filter((name) => name !== INGREDIENTS)}
                  cart={cart}
                  setCart={setCart}
                  rates={settings}
                  payment={payment}
                  onPaymentChange={setPayment}
                  onPost={postSale}
                  posting={posting}
                  error={saleError}
                />
              )}
              {view === "Transactions" && (
                <Transactions
                  transactions={transactions}
                  catalogue={catalogue}
                  rates={settings}
                  isAdmin={isAdmin}
                  onPostPurchase={postPurchase}
                />
              )}
              {view === "Products" && (
                <Products
                  products={catalogue}
                  categories={categories}
                  isAdmin={isAdmin}
                  onSaved={replaceProduct}
                />
              )}
              {view === "Recipes" && (
                <Recipes
                  catalogue={catalogue}
                  recipes={recipes}
                  setRecipes={setRecipes}
                  target={settings.targetMargin}
                  onTargetChange={saveTargetMargin}
                  onApplyPrice={applyPrice}
                />
              )}
              {view === "Inventory" && (
                <Inventory
                  products={catalogue}
                  recipes={recipes}
                  movements={movements}
                  onAdjust={adjustStock}
                />
              )}
              {view === "Stock movements" && <StockMovements movements={movements} />}
              {view === "Forecasts" && <Forecasts catalogue={catalogue} forecasts={forecasts} />}
              {view === "Users" && <Users currentUserId={user.id} />}
            </>
          )}
        </section>
      </div>
      {posted && (
        <ReceiptDialog
          tx={posted}
          rates={settings}
          success
          closeLabel="Start another sale"
          onClose={() => {
            setPosted(null)
            setCart([])
            setSaleError("")
          }}
        />
      )}
    </main>
  )
}
