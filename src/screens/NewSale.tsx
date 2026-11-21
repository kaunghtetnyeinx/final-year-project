import { useState, type Dispatch, type SetStateAction } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import { Rates, saleBill } from "../lib/billing"
import { money, ratePct, signedMoney } from "../lib/format"
import { photoOf } from "../lib/images"
import { CartLine, Payment, Product, isIngredient, payments } from "../lib/types"

export default function NewSale({
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
