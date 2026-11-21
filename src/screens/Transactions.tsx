import { useState } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import ReceiptDialog from "../components/ReceiptDialog"
import Table from "../components/Table"
import { Rates } from "../lib/billing"
import { money, myStamp, round2 } from "../lib/format"
import { Product, Transaction } from "../lib/types"

export default function Transactions({
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
export const defaultCost = (product?: Product) =>
  product ? (product.costPrice > 0 ? product.costPrice : product.price) : 0

export function NewPurchaseModal({
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
