import { useState, type Dispatch, type SetStateAction } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import { changeDue, saleBill, type Rates } from "../lib/billing"
import { addToCart, lineKey, MAX_PER_LINE, roomFor, unitPriceOf } from "../lib/cart"
import { money, qty, ratePct, signedMoney } from "../lib/format"
import { photoOf } from "../lib/images"
import { isIngredient, payments, type CartLine, type Payment, type Product } from "../lib/types"

/** Discount and cash typed at the till (kept as text while being typed). */
export type Checkout = { discount: string; discountReason: string; cashReceived: string }
export const emptyCheckout: Checkout = { discount: "", discountReason: "", cashReceived: "" }
const amount = (text: string) => {
  const n = Number(text)
  return text.trim() === "" || !Number.isFinite(n) || n < 0 ? 0 : n
}

export default function NewSale({
  catalogue,
  categories,
  cart,
  setCart,
  checkout,
  setCheckout,
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
  checkout: Checkout
  setCheckout: Dispatch<SetStateAction<Checkout>>
  rates: Rates
  payment: Payment
  onPaymentChange: (payment: Payment) => void
  onPost: () => void
  posting: boolean
  error: string
}) {
  const [category, setCategory] = useState("All items")
  const [search, setSearch] = useState("")
  const [choosing, setChoosing] = useState<Product | null>(null)
  const [showDiscount, setShowDiscount] = useState(checkout.discount !== "")
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
    .map((line) => ({
      ...line,
      key: lineKey(line.productId, line.optionIds),
      unitPrice: unitPriceOf(line.product, line.optionIds),
      optionNames: line.optionIds
        .map((id) => line.product.options.find((o) => o.id === id)?.name)
        .filter(Boolean)
        .join(", "),
    }))
  // A stocked product's lines together may not exceed its stock.
  const short = lines.find(
    (line) =>
      line.product.trackStock &&
      lines.filter((l) => l.productId === line.productId).reduce((s, l) => s + l.quantity, 0) > line.product.stock,
  )
  const pick = (product: Product) =>
    product.options.length ? setChoosing(product) : setCart((current) => addToCart(current, product, []))
  const change = (key: string, by: number) =>
    setCart((current) =>
      current
        .map((item) => {
          if (lineKey(item.productId, item.optionIds) !== key) return item
          const product = catalogue.find((p) => p.id === item.productId)
          if (by > 0 && product && roomFor(product, current) <= 0) return item
          return { ...item, quantity: item.quantity + by }
        })
        .filter((item) => item.quantity > 0),
    )
  const discount = amount(checkout.discount)
  const bill = saleBill(
    lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice })),
    rates,
    discount,
  )
  const cash = amount(checkout.cashReceived)
  const change$ = payment === "Cash" && checkout.cashReceived.trim() !== "" ? changeDue(bill.total, cash) : undefined
  const problem =
    discount > 0 && !checkout.discountReason.trim()
      ? "Give a reason for the discount."
      : discount > bill.subtotal + 1e-9
        ? "The discount is more than the subtotal."
        : change$ === null
          ? "Cash received is less than the total."
          : ""
  const field = "w-full rounded border border-[#DCDDD8] bg-white px-3 py-2 text-xs outline-none focus:border-[#28695E]"
  return (
    <div className="grid min-h-full gap-5 p-4 sm:p-7 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section>
        <Heading
          title="New sale"
          subtitle="Add products, then confirm to save the sale and update stock."
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
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {shown.length === 0 && (
            <p className="col-span-full rounded-md border border-dashed border-[#D8D9D4] p-6 text-center text-xs text-[#8B8F89]">
              {sellable.length === 0 ? "No products yet." : "No products match this search."}
            </p>
          )}
          {shown.map((product) => {
            const full = roomFor(product, cart) <= 0
            return (
              <button
                key={product.id}
                onClick={() => pick(product)}
                disabled={full}
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
                    <strong className="shrink-0 text-sm">{money(product.price)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-2 text-[11px]">
                    <span className="truncate text-[#92948E]">
                      {product.options.length ? `${product.options.length} options` : product.sku}
                    </span>
                    {product.trackStock ? (
                      <span
                        className={product.stock <= product.reorder ? "text-[#A75347]" : "text-[#747A75]"}
                      >
                        {qty(product.stock)} units
                      </span>
                    ) : (
                      <span className="text-[#747A75]">Made to order</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="mt-4 border-l-2 border-[#28695E] bg-[#EAF1EF] p-3 text-xs text-[#5E6863]">
          <strong>Posting rule:</strong> Stock is reduced only when the sale is confirmed.
          Made-to-order items use up their recipe's ingredients instead.
        </div>
      </section>
      <aside className="flex h-fit flex-col rounded-md border border-[#DEDFDA] bg-white lg:sticky lg:top-4 lg:mt-[68px]">
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
        <div className="min-h-40 flex-1 p-3">
          {lines.length === 0 ? (
            <div className="grid h-36 place-items-center text-center">
              <div>
                <p className="text-sm font-bold">No products added</p>
                <p className="mt-1 text-xs text-[#8B8F89]">Select a product to start this sale.</p>
              </div>
            </div>
          ) : (
            lines.map((line) => (
              <div key={line.key} className="flex items-center gap-3 border-b border-[#ECEDE9] py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{line.product.name}</p>
                  {line.optionNames && (
                    <p className="truncate text-[11px] text-[#28695E]">{line.optionNames}</p>
                  )}
                  <p
                    className={`mt-0.5 text-[11px] ${short?.productId === line.productId ? "text-[#A34E42]" : "text-[#888C86]"}`}
                  >
                    {short?.productId === line.productId
                      ? `Only ${qty(line.product.stock)} left`
                      : `${line.product.sku} · ${money(line.unitPrice)}`}
                  </p>
                </div>
                <div className="flex items-center border border-[#DCDDD8]">
                  <button
                    onClick={() => change(line.key, -1)}
                    disabled={posting}
                    aria-label={`Remove one ${line.product.name}`}
                    className="p-2"
                  >
                    <Icon name="minus" size={11} />
                  </button>
                  <span className="w-6 text-center text-xs font-bold">{line.quantity}</span>
                  <button
                    onClick={() => change(line.key, 1)}
                    disabled={posting || roomFor(line.product, cart) <= 0}
                    aria-label={`Add one ${line.product.name}`}
                    className="p-2 disabled:opacity-30"
                  >
                    <Icon name="plus" size={11} />
                  </button>
                </div>
                <strong className="w-16 text-right text-xs">{money(line.unitPrice * line.quantity)}</strong>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-[#E4E5E0] p-5">
          <dl className="space-y-1.5 text-xs text-[#6F746E]">
            {(
              [
                [`Subtotal (${lines.reduce((s, i) => s + i.quantity, 0)} units)`, money(bill.subtotal)],
                ...(bill.discount > 0 ? [["Discount", `-${money(bill.discount)}`]] : []),
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
          {showDiscount ? (
            <div className="mt-3 grid grid-cols-[90px_1fr] gap-2">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={checkout.discount}
                onChange={(event) => setCheckout((c) => ({ ...c, discount: event.target.value }))}
                placeholder="RM 0.00"
                aria-label="Discount in RM"
                className={field}
              />
              <input
                value={checkout.discountReason}
                maxLength={100}
                onChange={(event) => setCheckout((c) => ({ ...c, discountReason: event.target.value }))}
                placeholder="Reason, e.g. staff meal"
                aria-label="Discount reason"
                className={field}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowDiscount(true)}
              disabled={!lines.length}
              className="mt-3 text-[11px] font-bold text-[#28695E] disabled:opacity-35"
            >
              + Add discount
            </button>
          )}
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#858983]">Payment method</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {payments.map((method) => (
                <button
                  key={method}
                  onClick={() => onPaymentChange(method)}
                  disabled={posting}
                  className={`rounded border px-3 py-2.5 text-xs font-bold ${
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
          {payment === "Cash" && (
            <div className="mt-3 grid grid-cols-2 items-center gap-2 text-xs">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={checkout.cashReceived}
                onChange={(event) => setCheckout((c) => ({ ...c, cashReceived: event.target.value }))}
                placeholder="Cash received"
                aria-label="Cash received in RM"
                className={field}
              />
              <span className="text-right">
                {change$ === undefined ? (
                  <span className="text-[#969A94]">Change: —</span>
                ) : change$ === null ? (
                  <span className="font-bold text-[#A34E42]">Not enough</span>
                ) : (
                  <>
                    Change <strong className="font-display text-base">{money(change$)}</strong>
                  </>
                )}
              </span>
            </div>
          )}
          {(error || problem) && (
            <p role="alert" className="mt-4 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">
              {problem || error}
            </p>
          )}
          <button
            onClick={onPost}
            disabled={!lines.length || posting || Boolean(short) || Boolean(problem)}
            className="mt-4 w-full rounded bg-[#28695E] py-3.5 text-sm font-bold text-white disabled:opacity-35"
          >
            {posting ? "Saving sale…" : "Confirm"}
          </button>
          <p className="mt-3 text-center text-[10px] text-[#969A94]">
            Posted sales cannot be edited. An admin can void a sale with a reason.
          </p>
        </div>
      </aside>
      {choosing && (
        <OptionPicker
          product={choosing}
          room={roomFor(choosing, cart)}
          onClose={() => setChoosing(null)}
          onAdd={(optionIds, quantity) => {
            setCart((current) => addToCart(current, choosing, optionIds, quantity))
            setChoosing(null)
          }}
        />
      )}
    </div>
  )
}

/** Choose options (and how many) before adding a product that has options. */
function OptionPicker({
  product,
  room,
  onClose,
  onAdd,
}: {
  product: Product
  room: number
  onClose: () => void
  onAdd: (optionIds: number[], quantity: number) => void
}) {
  const [chosen, setChosen] = useState<number[]>([])
  const [quantity, setQuantity] = useState(1)
  const toggle = (id: number) =>
    setChosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  const price = unitPriceOf(product, chosen)
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Options for ${product.name}`}
    >
      <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold">{product.name}</h2>
            <p className="mt-1 text-xs text-[#767A74]">{money(product.price)} · choose any options</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-[#777C76]">
            <Icon name="close" />
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {product.options.map((option) => (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center gap-3 rounded border px-3 py-3 text-sm ${
                chosen.includes(option.id) ? "border-[#28695E] bg-[#EAF1EF]" : "border-[#DCDDD8]"
              }`}
            >
              <input type="checkbox" checked={chosen.includes(option.id)} onChange={() => toggle(option.id)} />
              <span className="flex-1 font-bold">{option.name}</span>
              <span className="text-xs text-[#767A74]">
                {option.priceDelta > 0 ? `+${money(option.priceDelta)}` : "No charge"}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center border border-[#DCDDD8]">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="One fewer"
              className="p-2.5"
            >
              <Icon name="minus" size={12} />
            </button>
            <span className="w-8 text-center text-sm font-bold">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => Math.min(Math.min(room, MAX_PER_LINE), q + 1))}
              disabled={quantity >= room}
              aria-label="One more"
              className="p-2.5 disabled:opacity-30"
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
          <strong className="font-display text-lg">{money(price * quantity)}</strong>
        </div>
        <button
          onClick={() => onAdd(chosen, quantity)}
          disabled={room <= 0}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-35"
        >
          Add to sale
        </button>
      </div>
    </div>
  )
}
