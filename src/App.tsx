import { useCallback, useEffect, useRef, useState } from "react"
import ChangePasswordDialog from "./components/ChangePasswordDialog"
import Icon from "./components/Icon"
import MalaysiaClock from "./components/MalaysiaClock"
import ReceiptDialog from "./components/ReceiptDialog"
import { api, newRequestId, setSessionLostHandler } from "./lib/api"
import { DEFAULT_RATES } from "./lib/billing"
import {
  INGREDIENTS,
  isIngredient,
  toForecast,
  toMovement,
  toRecipe,
  toTransaction,
  type CartLine,
  type Category,
  type Forecast,
  type Movement,
  type Payment,
  type Product,
  type RecipeLine,
  type SessionUser,
  type Settings,
  type Transaction,
  type TransactionWire,
  type View,
  type Wire,
} from "./lib/types"
import Forecasts from "./screens/Forecasts"
import Inventory from "./screens/Inventory"
import Login from "./screens/Login"
import NewSale, { emptyCheckout, type Checkout } from "./screens/NewSale"
import Products from "./screens/Products"
import Recipes from "./screens/Recipes"
import Reports from "./screens/Reports"
import StockMovements from "./screens/StockMovements"
import Transactions from "./screens/Transactions"
import Users from "./screens/Users"

export type NavigationItem = {
  label: View
  admin?: boolean
}

export const navigation: NavigationItem[] = [
  { label: "New sale" },
  { label: "Transactions" },
  { label: "Reports" },
  { label: "Products" },
  { label: "Recipes", admin: true },
  { label: "Inventory", admin: true },
  { label: "Stock movements", admin: true },
  { label: "Forecasts", admin: true },
  { label: "Users", admin: true },
]

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
  useEffect(() => setSessionLostHandler(() => setUser(null)), [])

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
  // Seeded or admin-set temporary password: the user must choose their own first.
  if (user.mustChangePassword)
    return (
      <main className="min-h-screen bg-[#F5F4F0]">
        <ChangePasswordDialog user={user} forced onDone={setUser} onCancel={signOut} />
      </main>
    )
  // Keyed by user, so signing out throws away everything the last person loaded.
  return <Workspace key={user.id} user={user} onSignOut={signOut} />
}

/** The signed-in app. Every screen reads from and writes to the API; nothing is kept only in the browser. */
export function Workspace({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const isAdmin = user.role === "ADMIN"
  const [view, setView] = useState<View>("New sale")
  const [catalogue, setCatalogue] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_RATES, targetMargin: 0.6 })
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [recipes, setRecipes] = useState<RecipeLine[]>([])
  const [forecasts, setForecasts] = useState<Forecast[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [passwordOpen, setPasswordOpen] = useState(false)

  const [cart, setCart] = useState<CartLine[]>([])
  const [checkout, setCheckout] = useState<Checkout>(emptyCheckout)
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
        api<{ transactions: TransactionWire[] }>("/transactions"),
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
      setCategories(c.categories)
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

  // Drop cart lines whose product (or option) was switched off since it was added.
  useEffect(() => {
    setCart((current) => {
      const kept = current.filter((line) => {
        const p = catalogue.find((x) => x.id === line.productId)
        return (
          p && p.isActive && !isIngredient(p) && line.optionIds.every((id) => p.options.some((o) => o.id === id))
        )
      })
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
    const discount = Number(checkout.discount) || 0
    const cash = checkout.cashReceived.trim() === "" ? undefined : Number(checkout.cashReceived)
    try {
      const { sale } = await api<{ sale: TransactionWire }>("/sales", {
        method: "POST",
        body: {
          requestId,
          payment,
          lines: cart.map((line) => ({ productId: line.productId, quantity: line.quantity, optionIds: line.optionIds })),
          ...(discount > 0 ? { discount, discountReason: checkout.discountReason.trim() } : {}),
          ...(payment === "Cash" && cash !== undefined && Number.isFinite(cash) ? { cashReceived: cash } : {}),
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

  const runForecast = async () => {
    await api("/forecasts/run", { method: "POST" })
    await load()
  }

  const allowed = (item: NavigationItem) => !item.admin || isAdmin
  const lowStockCount = catalogue.filter((p) => p.isActive && p.trackStock && p.stock <= p.reorder).length

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#F3F3F1] text-[#24302C]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#E2E3DF] bg-white px-4 lg:h-16 lg:px-6">
        <div className="font-display text-base font-bold text-[#28695E] lg:w-[205px]">Juniper Cafe</div>
        <div className="hidden flex-1 text-center text-[10px] text-[#858984] md:block">Main Store · MYR</div>
        <div className="ml-auto flex min-w-0 items-center justify-end gap-3 text-[10px]">
          <span className="hidden sm:inline">
            <MalaysiaClock />
          </span>
          <span className="truncate">
            {user.name} · {user.role}
          </span>
          <button
            onClick={() => setPasswordOpen(true)}
            className="shrink-0 rounded border border-[#D9DAD5] px-2 py-1 font-bold text-[#28695E]"
          >
            Password
          </button>
          <button onClick={onSignOut} title="Sign out" aria-label="Sign out" className="shrink-0 p-1">
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Side menu on wide screens; a scrolling bar under the header on tablets. */}
        <aside className="shrink-0 overflow-x-auto border-b border-[#E0E1DD] bg-white lg:w-[205px] lg:overflow-visible lg:border-b-0 lg:border-r lg:py-7">
          <nav className="flex lg:flex-col">
            {navigation.filter(allowed).map((item) => (
              <button
                key={item.label}
                onClick={() => setView(item.label)}
                aria-current={view === item.label ? "page" : undefined}
                className={`relative flex shrink-0 items-center whitespace-nowrap px-4 py-3 text-left text-xs lg:px-5 ${
                  view === item.label
                    ? "font-bold text-[#28695E] before:absolute before:inset-x-3 before:bottom-0 before:h-0.5 before:bg-[#28695E] lg:before:inset-x-auto lg:before:inset-y-2 lg:before:left-0 lg:before:h-auto lg:before:w-0.5"
                    : "text-[#777D78] hover:bg-[#F7F7F5]"
                }`}
              >
                <span>{item.label}</span>
                {item.label === "Inventory" && lowStockCount > 0 && (
                  <span
                    className="ml-2 rounded-full bg-[#F5E7E3] px-1.5 py-0.5 text-[9px] text-[#A34E42] lg:ml-auto"
                    title={`${lowStockCount} items at or below reorder level`}
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
              className="mx-4 mt-6 flex items-center justify-between gap-3 rounded bg-[#F5E7E3] px-4 py-3 text-xs text-[#A34E42] sm:mx-8"
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
                  categories={categories.map((c) => c.name).filter((name) => name !== INGREDIENTS)}
                  cart={cart}
                  setCart={setCart}
                  checkout={checkout}
                  setCheckout={setCheckout}
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
                  onChanged={load}
                />
              )}
              {view === "Reports" && <Reports isAdmin={isAdmin} />}
              {view === "Products" && (
                <Products
                  products={catalogue}
                  categories={categories}
                  isAdmin={isAdmin}
                  onSaved={replaceProduct}
                  onCategoriesChanged={load}
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
                <Inventory products={catalogue} recipes={recipes} movements={movements} onChanged={load} />
              )}
              {view === "Stock movements" && <StockMovements movements={movements} />}
              {view === "Forecasts" && (
                <Forecasts catalogue={catalogue} forecasts={forecasts} onRun={runForecast} />
              )}
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
            setCheckout(emptyCheckout)
            setSaleError("")
          }}
        />
      )}
      {passwordOpen && (
        <ChangePasswordDialog
          user={user}
          onDone={() => setPasswordOpen(false)}
          onCancel={() => setPasswordOpen(false)}
        />
      )}
    </main>
  )
}
