import { useState } from "react"
import Heading from "../components/Heading"
import Table from "../components/Table"
import { myStamp } from "../lib/format"
import { baseUnitOf } from "../lib/recipes"
import { Movement, Product, RecipeLine, isIngredient } from "../lib/types"

export default function Inventory({
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
