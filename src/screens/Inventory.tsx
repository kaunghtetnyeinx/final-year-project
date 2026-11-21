import { useState } from "react"
import Heading from "../components/Heading"
import Table from "../components/Table"
import { api } from "../lib/api"
import { myStamp, qty } from "../lib/format"
import { baseUnitOf } from "../lib/recipes"
import { isIngredient, type Movement, type Product, type RecipeLine } from "../lib/types"

const field = "mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"

export default function Inventory({
  products,
  recipes,
  movements,
  onChanged,
}: {
  products: Product[]
  recipes: RecipeLine[]
  movements: Movement[]
  onChanged: () => Promise<void>
}) {
  // Ingredients are counted in their recipe base unit (g, ml, piece).
  const unitOf = (p: Product) => (isIngredient(p) && baseUnitOf(p.id, recipes)) || "units"
  // "Updated" = time of the product's latest stock movement (list is newest first).
  const lastMoved = (id: number) => {
    const latest = movements.find((m) => m.productId === id)
    return latest ? myStamp(latest.created) : "—"
  }
  // Made-to-order items have no shelf count, so they are not stock lines.
  const tracked = products.filter((p) => p.isActive && p.trackStock)
  const rows = tracked.map((p) => [
    p.sku,
    p.name,
    `${qty(p.stock)} ${unitOf(p)}`,
    `${p.reorder} ${unitOf(p)}`,
    p.stock === 0 ? "Out of stock" : p.stock <= p.reorder ? "Low" : "In stock",
    lastMoved(p.id),
  ])
  // Grams and pieces can't be added together, so this counts sellable products only.
  const unitsOnHand = tracked.filter((p) => !isIngredient(p)).reduce((sum, p) => sum + p.stock, 0)
  const lowCount = tracked.filter((p) => p.stock <= p.reorder).length
  // Batch-made products: stocked, with a recipe.
  const producible = tracked.filter((p) => !isIngredient(p) && recipes.some((r) => r.productId === p.id))
  const [open, setOpen] = useState<"adjust" | "produce" | null>(null)
  return (
    <div className="p-4 sm:p-8">
      <Heading
        title="Inventory"
        subtitle="Current balance per stocked product and ingredient at the Main Store."
      />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          [qty(unitsOnHand), "Sellable units on hand"],
          [String(lowCount), "At or below reorder level"],
          [String(tracked.length), "Stock items tracked"],
        ].map(([value, label]) => (
          <div key={label} className="rounded border border-[#DEDFDA] bg-white p-5">
            <p className="font-display text-2xl font-bold">{value}</p>
            <p className="mt-1 text-xs text-[#7E827C]">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          className="rounded border border-[#24302C] bg-white px-4 py-2.5 text-xs font-bold text-[#24302C] disabled:opacity-40"
          onClick={() => setOpen("produce")}
          disabled={!producible.length}
          title={producible.length ? "Record a batch made in the kitchen" : "Give a stocked product a recipe first"}
        >
          Record production
        </button>
        <button
          className="rounded bg-[#24302C] px-4 py-2.5 text-xs font-bold text-white"
          onClick={() => setOpen("adjust")}
        >
          Record adjustment
        </button>
      </div>
      <Table headers={["SKU", "Product", "On hand", "Reorder level", "Status", "Updated"]} rows={rows} />
      {open === "adjust" && (
        <AdjustModal
          products={tracked}
          unitOf={unitOf}
          onClose={() => setOpen(null)}
          onDone={async () => {
            await onChanged()
            setOpen(null)
          }}
        />
      )}
      {open === "produce" && (
        <ProductionModal
          products={producible}
          catalogue={products}
          recipes={recipes}
          onClose={() => setOpen(null)}
          onDone={async () => {
            await onChanged()
            setOpen(null)
          }}
        />
      )}
    </div>
  )
}

function useSubmit(onDone: () => Promise<void>) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    try {
      await action()
      await onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return { error, setError, busy, submit }
}

function AdjustModal({
  products,
  unitOf,
  onClose,
  onDone,
}: {
  products: Product[]
  unitOf: (p: Product) => string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? 0)
  const [adjustment, setAdjustment] = useState("")
  const [reason, setReason] = useState("")
  const { error, setError, busy, submit } = useSubmit(onDone)
  const product = products.find((item) => item.id === productId)
  const apply = () => {
    if (!product) return
    const change = Number(adjustment)
    if (!Number.isFinite(change) || change === 0) return setError("Enter a non-zero adjustment.")
    // Sellable products are whole units; ingredients may use up to 3 decimals (e.g. 12.5 g).
    if (!isIngredient(product) && !Number.isInteger(change)) return setError("Use whole units for this product.")
    if (Math.abs(change * 1000 - Math.round(change * 1000)) > 1e-6)
      return setError("Use at most 3 decimal places.")
    if (product.stock + change < -1e-9)
      return setError(`Only ${qty(product.stock)} ${unitOf(product)} on hand; stock cannot go below zero.`)
    if (!reason.trim()) return setError("A reason is required for the audit trail.")
    submit(() =>
      api("/inventory/adjustments", { method: "POST", body: { productId: product.id, change, reason: reason.trim() } }),
    )
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-4">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-2 font-display text-xl font-bold">Record adjustment</h2>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">{error}</p>
        )}
        <label className="mt-4 block text-left text-xs font-bold">
          Product
          <select value={productId} onChange={(event) => setProductId(Number(event.target.value))} className={field}>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {qty(item.stock)} {unitOf(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Adjustment ({product ? unitOf(product) : "units"}, negative for a loss)
          <input
            type="number"
            step="any"
            value={adjustment}
            onChange={(event) => setAdjustment(event.target.value)}
            placeholder="e.g. -2"
            className={field}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Reason
          <input
            value={reason}
            maxLength={100}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Damaged unit, stock count correction"
            className={field}
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
          onClick={onClose}
          className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ProductionModal({
  products,
  catalogue,
  recipes,
  onClose,
  onDone,
}: {
  products: Product[]
  catalogue: Product[]
  recipes: RecipeLine[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? 0)
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState("")
  const { error, busy, submit } = useSubmit(onDone)
  const lines = recipes.filter((r) => r.productId === productId)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-4">
      <div className="my-6 w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-2 font-display text-xl font-bold">Record production</h2>
        <p className="mt-2 text-xs text-[#767A74]">
          A batch made in the kitchen: adds the finished items and uses up their ingredients.
        </p>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">{error}</p>
        )}
        <label className="mt-4 block text-left text-xs font-bold">
          Product
          <select value={productId} onChange={(event) => setProductId(Number(event.target.value))} className={field}>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {qty(item.stock)} on hand
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Quantity made
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Math.floor(Number(event.target.value)) || 1))}
            className={field}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Note (optional)
          <input
            value={note}
            maxLength={60}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Morning bake"
            className={field}
          />
        </label>
        <div className="mt-4 rounded bg-[#F3F3F1] p-3 text-left text-[11px]">
          <p className="font-bold">Uses</p>
          {lines.map((r) => {
            const ingredient = catalogue.find((p) => p.id === r.ingredientId)
            const need = r.quantityRequired * quantity
            const short = ingredient && ingredient.trackStock && ingredient.stock + 1e-9 < need
            return (
              <p key={r.recipeId} className={`mt-1 flex justify-between ${short ? "text-[#A34E42]" : ""}`}>
                <span>{ingredient?.name ?? `#${r.ingredientId}`}</span>
                <span className="tabular-nums">
                  {qty(need)} {r.unit}
                  {ingredient?.trackStock ? ` of ${qty(ingredient.stock)}` : ""}
                </span>
              </p>
            )
          })}
        </div>
        <button
          onClick={() =>
            submit(() =>
              api("/inventory/production", {
                method: "POST",
                body: { productId, quantity, ...(note.trim() ? { note: note.trim() } : {}) },
              }),
            )
          }
          disabled={busy || !productId}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Record production"}
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
