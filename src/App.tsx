import {
  useEffect,
  useState,
  type Dispatch,
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
const SERVICE_CHARGE_RATE = 0.1
const SST_RATE = 0.06
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
const saleBill = (lines: { quantity: number; unitPrice: number }[]): Bill => {
  const subtotal = round2(
    lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  )
  const serviceCharge = round2(subtotal * SERVICE_CHARGE_RATE)
  const tax = round2(subtotal * SST_RATE)
  const exact = round2(subtotal + serviceCharge + tax)
  const total = roundTo5Sen(exact)
  return { subtotal, serviceCharge, tax, rounding: round2(total - exact), total }
}
/** "+RM 0.01" / "-RM 0.02" / "RM 0.00" */
const signedMoney = (value: number) =>
  value === 0 ? money(0) : `${value > 0 ? "+" : "-"}${money(Math.abs(value))}`
// Supplier purchases are recorded at cost, with no service charge or SST.
const purchaseBill = (lines: { quantity: number; unitPrice: number }[]): Bill => {
  const subtotal = round2(
    lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  )
  return { subtotal, serviceCharge: 0, tax: 0, rounding: 0, total: subtotal }
}

const userName = (role: Role) =>
  role === "ADMIN" ? "Kaung Htet Nyein" : "Yadanar Theint"
const userEmail = (role: Role) =>
  role === "ADMIN" ? "kaunghtet@juniper.store" : "yadanar@juniper.store"

type Role = "ADMIN" | "STAFF"
type View = "New sale" | "Transactions" | "Products" | "Recipes" | "Inventory" | "Stock movements" | "Forecasts" | "Users"
type Product = {
  id: number
  sku: string
  name: string
  category: string
  price: number
  stock: number
  reorder: number
  image: string
  updated?: string
}
type CartLine = Product & { quantity: number }
type Payment = "Cash" | "Card" | "QR"
const payments: Payment[] = ["Cash", "Card", "QR"]
type Movement = {
  id: string
  product: string
  type: "SALE" | "PURCHASE" | "ADJUSTMENT"
  change: number
  source: string
  by: string
  created: string
}
type TransactionLine = {
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

const products: Product[] = [
  {
    id: 1,
    sku: "CAF-001",
    name: "House Roast Beans",
    category: "Coffee",
    price: 18,
    stock: 24,
    reorder: 10,
    image: image.coffee,
  },
  {
    id: 2,
    sku: "BAK-014",
    name: "Butter Croissant",
    category: "Bakery",
    price: 4.5,
    stock: 8,
    reorder: 10,
    image: image.bakery,
  },
  {
    id: 3,
    sku: "MEA-008",
    name: "Chicken Grain Bowl",
    category: "Ready meals",
    price: 13.5,
    stock: 12,
    reorder: 6,
    image: image.meal,
  },
  {
    id: 4,
    sku: "PAN-021",
    name: "Juniper Granola",
    category: "Pantry",
    price: 11,
    stock: 19,
    reorder: 8,
    image: image.pantry,
  },
  {
    id: 5,
    sku: "BAK-019",
    name: "Blueberry Loaf",
    category: "Bakery",
    price: 6.5,
    stock: 6,
    reorder: 8,
    image: image.cake,
  },
  {
    id: 6,
    sku: "MEA-012",
    name: "Focaccia Sandwich",
    category: "Ready meals",
    price: 12,
    stock: 15,
    reorder: 7,
    image: image.meal,
  },
  {
    id: 7,
    sku: "DRK-033",
    name: "Cold Brew Bottle",
    category: "Drinks",
    price: 6,
    stock: 31,
    reorder: 12,
    image: image.coffee,
  },
  {
    id: 8,
    sku: "PAN-025",
    name: "Matcha Tin",
    category: "Pantry",
    price: 22,
    stock: 5,
    reorder: 6,
    image: image.pantry,
  },
  // Ingredients live in `products` too (ERD: recipe.ingredient_id -> products).
  // Stock is a whole number in each ingredient's base unit (g, ml or piece).
  ...(
    [
      [101, "ING-001", "Arabica Coffee Beans", 4000, 1500],
      [102, "ING-002", "Butter", 3000, 1000],
      [103, "ING-003", "Plain Flour", 10000, 3000],
      [104, "ING-004", "Caster Sugar", 5000, 1500],
      [105, "ING-005", "Eggs", 60, 24],
      [106, "ING-006", "Blueberries", 1500, 500],
      [107, "ING-007", "Chicken Breast", 4000, 1500],
      [108, "ING-008", "Quinoa", 3000, 1000],
      [109, "ING-009", "Mixed Greens", 1200, 500],
      [110, "ING-010", "Focaccia Loaf", 20, 8],
      [111, "ING-011", "Cheddar Cheese", 1500, 500],
      [112, "ING-012", "Glass Bottle & Cap", 80, 30],
    ] as const
  ).map(
    ([id, sku, name, stock, reorder]): Product => ({
      id,
      sku,
      name,
      category: "Ingredients",
      price: 0,
      stock,
      reorder,
      image: image.pantry,
    }),
  ),
]

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

const recipeSeedDate = new Date("2026-06-10T09:00:00+08:00")
const initialRecipes: RecipeLine[] = (
  [
    // [product, ingredient, quantity, unit, notes]
    [7, 101, 30, "g", "Coarse grind, 18 h steep"],
    [7, 112, 1, "piece", null],
    [2, 103, 60, "g", null],
    [2, 102, 30, "g", "Laminated"],
    [2, 104, 8, "g", null],
    [2, 105, 0.2, "piece", "Egg wash"],
    [5, 103, 50, "g", null],
    [5, 102, 20, "g", null],
    [5, 104, 25, "g", null],
    [5, 105, 0.5, "piece", null],
    [5, 106, 25, "g", "Per slice"],
    [3, 107, 120, "g", "Grilled"],
    [3, 108, 80, "g", "Cooked weight"],
    [3, 109, 40, "g", null],
    [6, 110, 1, "piece", null],
    [6, 111, 25, "g", null],
    [6, 109, 20, "g", null],
    [6, 107, 40, "g", null],
  ] as [number, number, number, string, string | null][]
).map(([productId, ingredientId, quantityRequired, unit, notes], index) => ({
  recipeId: index + 1,
  productId,
  ingredientId,
  quantityRequired,
  unit,
  notes,
  createdAt: recipeSeedDate,
  updatedAt: recipeSeedDate,
}))

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

function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  const [role, setRole] = useState<Role>("ADMIN")
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
        <div className="w-full max-w-sm">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[#28695E]">
            FYP prototype
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold">
            Sign in to workspace
          </h2>
          <p className="mt-2 text-sm text-[#757973]">
            Select an account type to test permissions.
          </p>
          <div className="mt-7 grid grid-cols-2 gap-3">
            {(["ADMIN", "STAFF"] as Role[]).map((item) => (
              <button
                key={item}
                onClick={() => setRole(item)}
                className={`border p-4 text-left ${
                  role === item
                    ? "border-[#28695E] bg-[#EAF1EF]"
                    : "border-[#D9DAD5] bg-white"
                }`}
              >
                <span className="text-sm font-bold">
                  {item === "ADMIN" ? "Admin" : "Staff"}
                </span>
                <span className="mt-1 block text-[11px] text-[#7C807A]">
                  {item === "ADMIN"
                    ? "Full inventory access"
                    : "Sales workspace"}
                </span>
              </button>
            ))}
          </div>
          <label className="mt-5 block text-xs font-bold">
            Email
            <input
              readOnly
              value={userEmail(role)}
              className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3.5 text-sm outline-none"
            />
          </label>
          <label className="mt-4 block text-xs font-bold">
            Password
            <input
              readOnly
              value="••••••••••"
              className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3.5 text-sm outline-none"
            />
          </label>
          <button
            onClick={() => onLogin(role)}
            className="mt-6 flex w-full items-center justify-between bg-[#28695E] px-5 py-4 text-sm font-bold text-white"
          >
            <span>Continue as {role === "ADMIN" ? "Admin" : "Staff"}</span>
            <Icon name="arrow" />
          </button>
          <p className="mt-4 flex items-center gap-2 text-[11px] text-[#858983]">
            <Icon name="lock" size={13} />
            Demo only · Passwords are never stored in plaintext
          </p>
        </div>
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

const categories = ["Coffee", "Bakery", "Ready meals", "Pantry", "Drinks"]

function NewSale({
  catalogue,
  cart,
  setCart,
  saleNumber,
  payment,
  onPaymentChange,
  onPost,
}: {
  catalogue: Product[]
  cart: CartLine[]
  setCart: Dispatch<SetStateAction<CartLine[]>>
  saleNumber: string
  payment: Payment
  onPaymentChange: (payment: Payment) => void
  onPost: () => void
}) {
  const [category, setCategory] = useState("All items")
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  // Ingredients are stock items only; they are not sold at the counter.
  const shown = catalogue.filter(
    (product) =>
      !isIngredient(product) &&
      (category === "All items" || product.category === category) &&
      `${product.name} ${product.sku}`.toLowerCase().includes(query),
  )
  // Always check against live stock, not the snapshot copied into the cart line.
  const stockOf = (id: number) =>
    catalogue.find((product) => product.id === id)?.stock ?? 0
  const inCart = (id: number) =>
    cart.find((item) => item.id === id)?.quantity ?? 0
  const add = (product: Product) =>
    setCart((current) => {
      const line = current.find((item) => item.id === product.id)
      if (!line) return product.stock > 0 ? [...current, { ...product, quantity: 1 }] : current
      return current.map((item) =>
        item.id === product.id
          ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) }
          : item,
      )
    })
  const change = (id: number, by: number) =>
    setCart((current) =>
      current
        .map((item) =>
          item.id === id
            ? {
                ...item,
                quantity: Math.min(item.quantity + by, stockOf(id)),
              }
            : item,
        )
        .filter((item) => item.quantity > 0),
    )
  const bill = saleBill(
    cart.map((item) => ({ quantity: item.quantity, unitPrice: item.price })),
  )
  return (
    <div className="grid min-h-full grid-cols-[minmax(520px,1fr)_330px] gap-5 p-7">
      <section>
        <Heading
          title="New sale"
          subtitle="Create a draft sale, add whole-unit products, then post it to update stock."
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
              No products match this search.
            </p>
          )}
          {shown.map((product) => (
            <button
              key={product.id}
              onClick={() => add(product)}
              disabled={inCart(product.id) >= product.stock}
              className="group rounded-md border border-[#DEDFDA] bg-white p-3 text-left transition hover:border-[#91A59F] disabled:opacity-50"
            >
              <img
                src={product.image}
                alt=""
                className="h-20 w-full rounded object-cover saturate-[.72]"
              />
              <div className="pt-3">
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
          <strong>Posting rule:</strong> Stock is reduced only after the draft
          sale is posted. Every line creates one append-only stock movement.
        </div>
      </section>
      <aside className="mt-[68px] flex h-fit min-h-[520px] flex-col rounded-md border border-[#DEDFDA] bg-white">
        <div className="flex items-start justify-between border-b border-[#E4E5E0] p-5">
          <div>
            <h2 className="font-display text-lg font-bold">Sale #{saleNumber}</h2>
            <p className="mt-1 text-[11px] text-[#888C86]">
              DRAFT · Created by current user
            </p>
          </div>
          <button
            onClick={() => setCart([])}
            disabled={!cart.length}
            aria-label="Clear sale"
            title="Clear sale"
            className="p-1 text-[#777C76] disabled:opacity-35"
          >
            <Icon name="trash" />
          </button>
        </div>
        <div className="min-h-64 flex-1 p-3">
          {cart.length === 0 ? (
            <div className="grid h-52 place-items-center text-center">
              <div>
                <p className="text-sm font-bold">No products added</p>
                <p className="mt-1 text-xs text-[#8B8F89]">
                  Select a product to start this sale.
                </p>
              </div>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b border-[#ECEDE9] py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{item.name}</p>
                  <p className="mt-1 text-[11px] text-[#888C86]">
                    {item.sku} · {money(item.price)}
                  </p>
                </div>
                <div className="flex items-center border border-[#DCDDD8]">
                  <button
                    onClick={() => change(item.id, -1)}
                    aria-label={`Remove one ${item.name}`}
                    className="p-1.5"
                  >
                    <Icon name="minus" size={11} />
                  </button>
                  <span className="w-6 text-center text-xs font-bold">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => change(item.id, 1)}
                    disabled={item.quantity >= stockOf(item.id)}
                    aria-label={`Add one ${item.name}`}
                    className="p-1.5 disabled:opacity-30"
                  >
                    <Icon name="plus" size={11} />
                  </button>
                </div>
                <strong className="w-16 text-right text-xs">
                  {money(item.price * item.quantity)}
                </strong>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-[#E4E5E0] p-5">
          <dl className="space-y-1.5 text-xs text-[#6F746E]">
            {(
              [
                [`Subtotal (${cart.reduce((s, i) => s + i.quantity, 0)} units)`, money(bill.subtotal)],
                [`Service charge (${SERVICE_CHARGE_RATE * 100}%)`, money(bill.serviceCharge)],
                [`SST (${SST_RATE * 100}%)`, money(bill.tax)],
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
              {payments.map(
                (method) => (
                  <button
                    key={method}
                    onClick={() => onPaymentChange(method)}
                    className={`rounded border px-3 py-2 text-xs font-bold ${
                      payment === method
                        ? "border-[#28695E] bg-[#28695E] text-white"
                        : "border-[#DCDAD4] bg-white text-[#666A65]"
                    }`}
                  >
                    {method}
                  </button>
                ),
              )}
            </div>
          </div>
          <button
            onClick={onPost}
            disabled={!cart.length}
            className="mt-4 w-full rounded bg-[#28695E] py-3.5 text-sm font-bold text-white disabled:opacity-35"
          >
            Confirm
          </button>
          <p className="mt-3 text-center text-[10px] text-[#969A94]">
            Posted transactions cannot be edited or cancelled.
          </p>
        </div>
      </aside>
    </div>
  )
}

const ingredientIndex = (id: number) => products.findIndex((p) => p.id === id)
// Seed lines: [product index in `products`, quantity, unit price/cost override]
const seedLines = (items: [number, number, number?][]): TransactionLine[] =>
  items.map(([index, quantity, unitPrice]) => ({
    name: products[index].name,
    sku: products[index].sku,
    quantity,
    unitPrice: unitPrice ?? products[index].price,
  }))
const seedSale = (
  number: string,
  status: Transaction["status"],
  at: string,
  by: string,
  payment: Payment,
  items: [number, number][],
): Transaction => {
  const lines = seedLines(items)
  return { number, type: "SALE", status, at: new Date(at), by, payment, lines, ...saleBill(lines) }
}
const seedPurchase = (
  number: string,
  status: Transaction["status"],
  at: string,
  by: string,
  items: [number, number, number][],
): Transaction => {
  const lines = seedLines(items)
  return { number, type: "PURCHASE", status, at: new Date(at), by, payment: null, lines, ...purchaseBill(lines) }
}

// Timestamps are Malaysia Time (+08:00).
const initialTransactions: Transaction[] = [
  seedSale("SL-1047", "POSTED", "2026-06-18T10:31:00+08:00", "Yadanar Theint", "Cash", [[0, 2], [6, 1]]),
  seedSale("SL-1046", "POSTED", "2026-06-18T10:08:00+08:00", "Yadanar Theint", "Card", [[1, 2], [2, 1]]),
  seedPurchase("PO-0038", "POSTED", "2026-06-18T08:42:00+08:00", "Kaung Htet Nyein", [[1, 20, 2.4], [7, 8, 15]]),
  seedSale("SL-1045", "POSTED", "2026-06-17T16:55:00+08:00", "Zin Ko Oo", "QR", [[5, 2], [3, 1], [4, 2]]),
  seedPurchase("PO-0039", "DRAFT", "2026-06-17T15:20:00+08:00", "Kaung Htet Nyein", [[0, 12, 11]]),
  seedSale("SL-1044", "CANCELLED", "2026-06-17T14:12:00+08:00", "Yadanar Theint", "Cash", [[4, 1], [6, 1]]),
  // Ingredient deliveries: unit cost is per base unit (g / piece). Recipe costing
  // uses each ingredient's latest posted purchase cost.
  seedPurchase("PO-0037", "POSTED", "2026-06-16T09:15:00+08:00", "Kaung Htet Nyein", [
    [ingredientIndex(107), 5000, 0.025],
    [ingredientIndex(108), 3000, 0.012],
    [ingredientIndex(109), 2000, 0.03],
    [ingredientIndex(110), 30, 2.2],
    [ingredientIndex(111), 2000, 0.06],
    [ingredientIndex(112), 100, 0.8],
  ]),
  seedPurchase("PO-0036", "POSTED", "2026-06-15T09:05:00+08:00", "Kaung Htet Nyein", [
    [ingredientIndex(101), 5000, 0.065],
    [ingredientIndex(102), 3000, 0.045],
    [ingredientIndex(103), 10000, 0.004],
    [ingredientIndex(104), 5000, 0.0035],
    [ingredientIndex(105), 90, 0.55],
    [ingredientIndex(106), 2000, 0.06],
  ]),
]

/** Thermal-style receipt. Used for the on-screen preview and for printing. */
function Receipt({ tx }: { tx: Transaction }) {
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
          <Row label={`Service charge ${SERVICE_CHARGE_RATE * 100}%`} value={money(tx.serviceCharge)} />
          <Row label={`SST ${SST_RATE * 100}%`} value={money(tx.tax)} />
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
  onClose,
  success = false,
  closeLabel = "Close",
}: {
  tx: Transaction
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
            <Receipt tx={tx} />
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
          <Receipt tx={tx} />
        </div>,
        document.body,
      )}
    </div>
  )
}

function Transactions({
  transactions,
  catalogue,
  onPostPurchase,
}: {
  transactions: Transaction[]
  catalogue: Product[]
  onPostPurchase: (product: Product, quantity: number, unitCost: number) => void
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
        <button
          className="rounded bg-[#24302C] px-4 py-2 text-xs font-bold text-white"
          onClick={() => setPurchaseOpen(true)}
        >
          + New purchase
        </button>
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
        <ReceiptDialog tx={viewing} onClose={() => setViewing(null)} />
      )}
      {purchaseOpen && (
        <NewPurchaseModal
          catalogue={catalogue}
          onClose={() => setPurchaseOpen(false)}
          onPost={(product, quantity, unitCost) => {
            onPostPurchase(product, quantity, unitCost)
            setPurchaseOpen(false)
          }}
        />
      )}
    </div>
  )
}

function NewPurchaseModal({
  catalogue,
  onClose,
  onPost,
}: {
  catalogue: Product[]
  onClose: () => void
  onPost: (product: Product, quantity: number, unitCost: number) => void
}) {
  const [productId, setProductId] = useState(catalogue[0]?.id ?? 0)
  const [quantity, setQuantity] = useState(1)
  const product = catalogue.find((item) => item.id === productId)
  const [unitCost, setUnitCost] = useState(product?.price ?? 0)
  const total = unitCost * quantity
  const post = () => {
    if (!product || quantity < 1 || unitCost <= 0) return
    onPost(product, quantity, unitCost)
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-4 font-display text-xl font-bold">New purchase</h2>
        <p className="mt-2 text-sm text-[#767A74]">
          Record a supplier delivery.
        </p>
        <label className="mt-5 block text-left text-xs font-bold">
          Product
          <select
            value={productId}
            onChange={(event) => {
              const id = Number(event.target.value)
              setProductId(id)
              setUnitCost(catalogue.find((item) => item.id === id)?.price ?? 0)
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
          disabled={!product || unitCost <= 0}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-35"
        >
          Post purchase
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
}

function Table({ headers, rows, empty = "No records found.", action }: TableProps) {
  const gridTemplateColumns = `repeat(${headers.length}, minmax(0, 1fr))${action ? " 76px" : ""}`
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
  setProducts,
}: {
  products: Product[]
  setProducts: Dispatch<SetStateAction<Product[]>>
}) {
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  const rows = products
    .filter((p) =>
      `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query),
    )
    .map((p) => [
      p.sku,
      p.name,
      p.category,
      isIngredient(p) ? "—" : money(p.price),
      "Active",
      p.updated ?? "18 Jun 2026",
    ])
  const [addOpen, setAddOpen] = useState(false)
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
        <button
          className="rounded bg-[#24302C] px-4 text-xs font-bold text-white"
          onClick={() => setAddOpen(true)}
        >
          + Add product
        </button>
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
      />
      {addOpen && (
        <AddProductModal
          existingSkus={products.map((p) => p.sku.toUpperCase())}
          onClose={() => setAddOpen(false)}
          onAdd={(product) => {
            setProducts((current) => [...current, product])
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

function AddProductModal({
  existingSkus,
  onClose,
  onAdd,
}: {
  existingSkus: string[]
  onClose: () => void
  onAdd: (product: Product) => void
}) {
  const [name, setName] = useState("")
  const [sku, setSku] = useState("")
  const [category, setCategory] = useState("Coffee")
  const [price, setPrice] = useState(0)
  const [stock, setStock] = useState(0)
  const [reorder, setReorder] = useState(0)
  const [imageKey, setImageKey] = useState<keyof typeof image>("coffee")
  const [error, setError] = useState("")
  const add = () => {
    const cleanSku = sku.trim().toUpperCase()
    if (!name.trim() || !cleanSku) return setError("Name and SKU are required.")
    if (existingSkus.includes(cleanSku))
      return setError(`SKU ${cleanSku} already exists.`)
    if (price <= 0 && category !== INGREDIENTS)
      return setError("Selling price must be greater than 0.")
    onAdd({
      id: Date.now(),
      sku: cleanSku,
      name: name.trim(),
      category,
      price,
      stock,
      reorder,
      image: image[imageKey],
      updated: myDate(),
    })
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-6">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-4 font-display text-xl font-bold">Add product</h2>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <label className="mt-5 block text-left text-xs font-bold">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          SKU
          <input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          >
            {[...categories, INGREDIENTS].map((item) => (
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
            onChange={(event) =>
              setPrice(Math.max(0, Number(event.target.value) || 0))
            }
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
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
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
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
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Image
          <select
            value={imageKey}
            onChange={(event) =>
              setImageKey(event.target.value as keyof typeof image)
            }
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          >
            {Object.keys(image).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={add}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white"
        >
          Add product
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

/** Latest posted purchase unit cost per SKU (transactions are stored newest first). */
const latestPurchaseCosts = (transactions: Transaction[]) => {
  const costs = new Map<string, number>()
  for (const tx of transactions) {
    if (tx.type !== "PURCHASE" || tx.status !== "POSTED") continue
    for (const line of tx.lines) {
      if (!costs.has(line.sku)) costs.set(line.sku, line.unitPrice)
    }
  }
  return costs
}

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
  transactions,
  target,
  setTarget,
  onApplyPrice,
}: {
  catalogue: Product[]
  recipes: RecipeLine[]
  setRecipes: Dispatch<SetStateAction<RecipeLine[]>>
  transactions: Transaction[]
  target: number
  setTarget: (target: number) => void
  onApplyPrice: (productId: number, price: number) => void
}) {
  const costs = latestPurchaseCosts(transactions)
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
              value={Math.round(target * 100)}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value))
                if (value >= 1 && value <= 95) setTarget(value / 100)
              }}
              aria-label="Target profit margin percent"
              className="w-20 border border-[#B9CEC8] bg-white px-2 py-1 font-display text-2xl font-bold text-[#24302C] outline-none"
            />
            <span className="font-display text-2xl text-[#24302C]">%</span>
          </div>
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
  onApplyPrice: (productId: number, price: number) => void
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
  const options = catalogue.filter((p) => p.id !== product.id)
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
    const now = new Date()
    if (editingId !== null) {
      setRecipes((current) =>
        current.map((r) =>
          r.recipeId === editingId
            ? { ...r, quantityRequired: amount, unit: cleanUnit, notes: notes.trim() || null, updatedAt: now }
            : r,
        ),
      )
    } else {
      setRecipes((current) => [
        ...current,
        {
          recipeId: Math.max(0, ...current.map((r) => r.recipeId)) + 1,
          productId: product.id,
          ingredientId,
          quantityRequired: amount,
          unit: cleanUnit,
          notes: notes.trim() || null,
          createdAt: now,
          updatedAt: now,
        },
      ])
    }
    resetForm()
  }
  const remove = (recipeId: number) => {
    setRecipes((current) => current.filter((r) => r.recipeId !== recipeId))
    if (editingId === recipeId) resetForm()
  }
  const setLineQuantity = (recipeId: number, amount: number) =>
    setRecipes((current) =>
      current.map((r) =>
        r.recipeId === recipeId ? { ...r, quantityRequired: amount, updatedAt: new Date() } : r,
      ),
    )

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
      apply: () => onApplyPrice(product.id, newPrice),
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
                className="rounded bg-[#28695E] px-4 py-2 text-xs font-bold text-white"
              >
                {editingId !== null ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Margin outcome */}
      <div className="border-t border-[#E4E5E0] p-6">
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
  onAdjust: (product: Product, change: number, reason: string) => void
}) {
  // Ingredients are counted in their recipe base unit (g, ml, piece).
  const unitOf = (p: Product) =>
    (isIngredient(p) && baseUnitOf(p.id, recipes)) || "units"
  // "Updated" = time of the product's latest stock movement (list is newest first).
  const lastMoved = (name: string) =>
    movements.find((m) => m.product === name)?.created ?? "18 Jun · 08:00"
  const rows = products.map((p) => [
    p.sku,
    p.name,
    `${p.stock} ${unitOf(p)}`,
    `${p.reorder} ${unitOf(p)}`,
    p.stock === 0 ? "Out of stock" : p.stock <= p.reorder ? "Low" : "In stock",
    lastMoved(p.name),
  ])
  // Grams and pieces can't be added together, so this counts sellable products only.
  const unitsOnHand = products
    .filter((p) => !isIngredient(p))
    .reduce((sum, p) => sum + p.stock, 0)
  const lowCount = products.filter((p) => p.stock <= p.reorder).length
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [productId, setProductId] = useState(products[0]?.id ?? 0)
  const [adjustment, setAdjustment] = useState(0)
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const product = products.find((item) => item.id === productId)
  const openAdjust = () => {
    setAdjustment(0)
    setReason("")
    setError("")
    setAdjustOpen(true)
  }
  const apply = () => {
    if (!product) return
    if (adjustment === 0) return setError("Enter a non-zero adjustment.")
    if (product.stock + adjustment < 0)
      return setError(
        `Only ${product.stock} units on hand; stock cannot go below zero.`,
      )
    if (!reason.trim()) return setError("A reason is required for the audit trail.")
    onAdjust(product, adjustment, reason.trim())
    setAdjustOpen(false)
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
          [String(products.length), "Products tracked"],
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
                {products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.stock} units
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
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Damaged unit, stock count correction"
                className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
              />
            </label>
            <button
              onClick={apply}
              className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white"
            >
              Apply adjustment
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

const initialMovements: Movement[] = [
  { id: "MV-2081", product: "House Roast Beans", type: "SALE", change: -2, source: "SL-1047", by: "Yadanar Theint", created: "18 Jun · 10:31" },
  { id: "MV-2080", product: "Cold Brew Bottle", type: "SALE", change: -1, source: "SL-1047", by: "Yadanar Theint", created: "18 Jun · 10:31" },
  { id: "MV-2079", product: "Butter Croissant", type: "PURCHASE", change: 20, source: "PO-0038", by: "Kaung Htet Nyein", created: "18 Jun · 08:42" },
  { id: "MV-2078", product: "Matcha Tin", type: "PURCHASE", change: 8, source: "PO-0038", by: "Kaung Htet Nyein", created: "18 Jun · 08:42" },
  { id: "MV-2077", product: "Blueberry Loaf", type: "ADJUSTMENT", change: -1, source: "Damaged unit", by: "Kaung Htet Nyein", created: "17 Jun · 17:10" },
]

function StockMovements({ movements }: { movements: Movement[] }) {
  const rows = movements.map((m) => [
    m.id,
    m.product,
    m.type,
    m.change > 0 ? `+${m.change}` : `−${Math.abs(m.change)}`,
    m.source,
    m.by,
    m.created,
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
      />
    </div>
  )
}

function Forecasts({ catalogue }: { catalogue: Product[] }) {
  const [reviewed, setReviewed] = useState(false)
  // Predicted 7-day demand per SKU (from the forecast run). On-hand and the
  // recommendation are derived from live stock so they stay consistent after sales/purchases.
  const predicted: Record<string, number> = {
    "CAF-001": 31.4,
    "BAK-014": 23.2,
    "MEA-008": 10.8,
    "BAK-019": 13.6,
    "DRK-033": 27.1,
  }
  const demand = catalogue
    .filter((p) => p.sku in predicted)
    .map((p) => {
      const forecast = predicted[p.sku]
      // When forecast demand exceeds stock, order enough to cover it and
      // restore the reorder level as safety stock.
      const order = Math.ceil(forecast + p.reorder - p.stock)
      return [
        p.name,
        String(p.stock),
        forecast.toFixed(1),
        String(p.reorder),
        forecast > p.stock ? `Order ${order} units` : "Stock sufficient",
      ]
    })
  const total = Object.values(predicted).reduce((sum, value) => sum + value, 0)
  const atRisk = catalogue.filter(
    (p) => p.sku in predicted && predicted[p.sku] > p.stock,
  ).length
  return (
    <div className="p-8">
      <Heading
        title="Demand forecasts"
        subtitle="Latest product-level results from forecast run 7e1c…42f · moving_average_v1."
      />
      <div className="mt-6 grid grid-cols-[1fr_280px] gap-5">
        <div className="rounded border border-[#DEDFDA] bg-white p-5">
          <div className="flex justify-between">
            <div>
              <p className="text-xs font-bold">Forecast demand · next 7 days</p>
              <p className="mt-1 text-[11px] text-[#858983]">
                Training window: 18 Mar – 17 Jun 2026
              </p>
            </div>
            <span className="text-xs font-bold text-[#28695E]">
              {total.toFixed(1)} units
            </span>
          </div>
          <div className="mt-8 flex h-44 items-end gap-3 border-b border-[#D7D9D4]">
            {[46, 58, 52, 66, 81, 94, 72].map((height, index) => (
              <div key={index} className="flex h-full flex-1 items-end">
                <div
                  className="w-full bg-[#73958D]"
                  style={{ height: `${height}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-[10px] text-[#858983]">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>
        </div>
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
              ? `Predicted demand exceeds available stock for ${atRisk} product${atRisk === 1 ? "" : "s"} during the next seven-day period.`
              : "Available stock covers predicted demand for the next seven-day period."}
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
    </div>
  )
}

const initialUsers: string[][] = [
  // User ID, Full name, Email, Role, Status, Created
  ["USR-001", "Kaung Htet Nyein", "kaunghtet@juniper.store", "ADMIN", "Active", "12 Jan 2026"],
  ["USR-002", "Yadanar Theint", "yadanar@juniper.store", "STAFF", "Active", "03 Feb 2026"],
  ["USR-003", "Zin Ko Oo", "zinkooo@juniper.store", "STAFF", "Active", "19 Mar 2026"],
  ["USR-004", "Peh Yan Bin", "yanbin@juniper.store", "STAFF", "Active", "07 Apr 2026"],
  ["USR-005", "Tan Yaw Pin", "yawpin@juniper.store", "STAFF", "Active", "21 Apr 2026"],
  ["USR-006", "Khong Cheng Hao", "chenghao@juniper.store", "STAFF", "Active", "05 May 2026"],
]

function Users({
  rows,
  setRows,
}: {
  rows: string[][]
  setRows: Dispatch<SetStateAction<string[][]>>
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addUser = (row: string[]) => {
    setRows((current) => [row, ...current])
    setAddOpen(false)
  }
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
      <Table
        headers={["User ID", "Full name", "Email", "Role", "Status", "Created"]}
        rows={rows}
      />
      {addOpen && (
        <AddUserModal
          nextId={`USR-${String(rows.length + 1).padStart(3, "0")}`}
          existingEmails={rows.map((row) => row[2].toLowerCase())}
          onClose={() => setAddOpen(false)}
          onAdd={addUser}
        />
      )}
    </div>
  )
}

function AddUserModal({
  onClose,
  onAdd,
  nextId,
  existingEmails,
}: {
  onClose: () => void
  onAdd: (row: string[]) => void
  nextId: string
  existingEmails: string[]
}) {
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("STAFF")
  const [error, setError] = useState("")
  const add = () => {
    const cleanEmail = email.trim().toLowerCase()
    if (!fullName.trim() || !cleanEmail)
      return setError("Full name and email are required.")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      return setError("Enter a valid email address.")
    if (existingEmails.includes(cleanEmail))
      return setError("A user with this email already exists.")
    onAdd([
      nextId,
      fullName.trim(),
      cleanEmail,
      role,
      "Active",
      myDate(),
    ])
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
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
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          >
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <button
          onClick={add}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white"
        >
          Add user
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

export default function App() {
  const [role, setRole] = useState<Role | null>(null)
  const [view, setView] = useState<View>("New sale")
  const [cart, setCart] = useState<CartLine[]>([
    { ...products[1], quantity: 2 },
    { ...products[6], quantity: 1 },
  ])
  const [posted, setPosted] = useState<Transaction | null>(null)
  const [payment, setPayment] = useState<Payment>("Cash")
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions)
  const [catalogue, setCatalogue] = useState<Product[]>(products)
  const [movements, setMovements] = useState<Movement[]>(initialMovements)
  const [users, setUsers] = useState<string[][]>(initialUsers)
  const [recipes, setRecipes] = useState<RecipeLine[]>(initialRecipes)
  const [targetMargin, setTargetMargin] = useState(0.6)
  const [nextSale, setNextSale] = useState(1048)
  const [nextPurchase, setNextPurchase] = useState(40)
  const [nextMovement, setNextMovement] = useState(2082)
  const lowStockCount = catalogue.filter((p) => p.stock <= p.reorder).length

  // Applies stock deltas to the catalogue and appends one movement per line.
  const recordMovements = (
    lines: { product: Product; change: number }[],
    type: Movement["type"],
    source: string,
    by: string,
  ) => {
    setCatalogue((current) =>
      current.map((product) => {
        const line = lines.find((l) => l.product.id === product.id)
        return line ? { ...product, stock: product.stock + line.change } : product
      }),
    )
    setMovements((current) => [
      ...lines.map((line, index) => ({
        id: `MV-${nextMovement + lines.length - 1 - index}`,
        product: line.product.name,
        type,
        change: line.change,
        source,
        by,
        created: myStamp(),
      })),
      ...current,
    ])
    setNextMovement((n) => n + lines.length)
  }

  if (!role)
    return (
      <Login
        onLogin={(nextRole) => {
          setRole(nextRole)
          setView("New sale")
        }}
      />
    )
  const allowed = (item: NavigationItem) => !item.admin || role === "ADMIN"
  const currentUser = userName(role)
  const saleNumber = `SL-${nextSale}`

  const postSale = () => {
    // Re-validate against live stock in case it changed since items were added.
    const short = cart.find((item) => {
      const live = catalogue.find((p) => p.id === item.id)
      return !live || live.stock < item.quantity
    })
    if (!cart.length || short) return
    recordMovements(
      cart.map((item) => ({ product: item, change: -item.quantity })),
      "SALE",
      saleNumber,
      currentUser,
    )
    const lines: TransactionLine[] = cart.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.price,
    }))
    const sale: Transaction = {
      number: saleNumber,
      type: "SALE",
      status: "POSTED",
      at: new Date(),
      by: currentUser,
      payment,
      lines,
      ...saleBill(lines),
    }
    setTransactions((current) => [sale, ...current])
    // The sale number advances when the cashier starts the next sale (onDone),
    // so the cart behind the confirmation still shows the sale just posted.
    setPosted(sale)
  }

  const postPurchase = (product: Product, quantity: number, unitCost: number) => {
    const number = `PO-${String(nextPurchase).padStart(4, "0")}`
    recordMovements([{ product, change: quantity }], "PURCHASE", number, currentUser)
    const lines: TransactionLine[] = [
      { name: product.name, sku: product.sku, quantity, unitPrice: unitCost },
    ]
    const purchase: Transaction = {
      number,
      type: "PURCHASE",
      status: "POSTED",
      at: new Date(),
      by: currentUser,
      payment: null,
      lines,
      ...purchaseBill(lines),
    }
    setTransactions((current) => [purchase, ...current])
    setNextPurchase((n) => n + 1)
  }
  return (
    <main className="flex h-screen min-w-[1100px] flex-col overflow-hidden bg-[#F3F3F1] text-[#24302C]">
      <header className="flex h-16 shrink-0 items-center border-b border-[#E2E3DF] bg-white px-6">
        <div className="w-[205px] font-display text-base font-bold text-[#28695E]">
          Juniper Cafe
        </div>
        <div className="flex-1 text-center text-[10px] text-[#858984]">
          Main Store · MYR · DEMO WORKSPACE
        </div>
        <div className="flex w-[340px] items-center justify-end gap-3 text-[10px]">
          <MalaysiaClock />
          <span>
            {currentUser} · {role}
          </span>
          <button
            onClick={() => setRole(null)}
            title="Sign out"
            aria-label="Sign out"
          >
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
                {item.label === "Inventory" &&
                  role === "ADMIN" &&
                  lowStockCount > 0 && (
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
          {view === "New sale" && (
            <NewSale
              catalogue={catalogue}
              cart={cart}
              setCart={setCart}
              saleNumber={saleNumber}
              payment={payment}
              onPaymentChange={setPayment}
              onPost={postSale}
            />
          )}
          {view === "Transactions" && (
            <Transactions
              transactions={transactions}
              catalogue={catalogue}
              onPostPurchase={postPurchase}
            />
          )}
          {view === "Products" && (
            <Products products={catalogue} setProducts={setCatalogue} />
          )}
          {view === "Recipes" && (
            <Recipes
              catalogue={catalogue}
              recipes={recipes}
              setRecipes={setRecipes}
              transactions={transactions}
              target={targetMargin}
              setTarget={setTargetMargin}
              onApplyPrice={(productId, price) =>
                setCatalogue((current) =>
                  current.map((p) =>
                    p.id === productId ? { ...p, price, updated: myDate() } : p,
                  ),
                )
              }
            />
          )}
          {view === "Inventory" && (
            <Inventory
              products={catalogue}
              recipes={recipes}
              movements={movements}
              onAdjust={(product, change, reason) =>
                recordMovements([{ product, change }], "ADJUSTMENT", reason, currentUser)
              }
            />
          )}
          {view === "Stock movements" && <StockMovements movements={movements} />}
          {view === "Forecasts" && <Forecasts catalogue={catalogue} />}
          {view === "Users" && <Users rows={users} setRows={setUsers} />}
        </section>
      </div>
      {posted && (
        <ReceiptDialog
          tx={posted}
          success
          closeLabel="Start another sale"
          onClose={() => {
            setPosted(null)
            setCart([])
            setNextSale((n) => n + 1)
          }}
        />
      )}
    </main>
  )
}
