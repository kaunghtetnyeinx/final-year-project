import { useEffect, useState } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import ReceiptDialog from "../components/ReceiptDialog"
import Table from "../components/Table"
import { api } from "../lib/api"
import type { Rates } from "../lib/billing"
import { money, myDate, myStamp, round2 } from "../lib/format"
import { toTransaction, type Product, type Transaction, type TransactionWire } from "../lib/types"

/** Today in Malaysia as YYYY-MM-DD (for the date picker). */
export const todayInMalaysia = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

export default function Transactions({
  transactions,
  catalogue,
  rates,
  isAdmin,
  onChanged,
}: {
  /** The latest transactions (loaded by the workspace). */
  transactions: Transaction[]
  catalogue: Product[]
  rates: Rates
  isAdmin: boolean
  /** Reload shared data after a change (stock, lists). */
  onChanged: () => Promise<void>
}) {
  const [filter, setFilter] = useState("All")
  const [date, setDate] = useState("")
  const [dayRows, setDayRows] = useState<Transaction[] | null>(null)
  const [error, setError] = useState("")
  const [viewing, setViewing] = useState<Transaction | null>(null)
  const [voiding, setVoiding] = useState<Transaction | null>(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [busy, setBusy] = useState("")

  // A chosen day is loaded from the server (the workspace only holds the latest 200).
  const loadDay = async (day: string) => {
    if (!day) return setDayRows(null)
    try {
      const { transactions: rows } = await api<{ transactions: TransactionWire[] }>(`/transactions?date=${day}&limit=500`)
      setDayRows(rows.map(toTransaction))
      setError("")
    } catch (err) {
      setError((err as Error).message)
    }
  }
  useEffect(() => {
    loadDay(date)
  }, [date, transactions])

  const source = dayRows ?? transactions
  const filters = ["All", "Sales", "Purchases", "Drafts", "Voided"]
  const shown = source.filter((tx) => {
    if (filter === "Sales") return tx.type === "SALE"
    if (filter === "Purchases") return tx.type === "PURCHASE"
    if (filter === "Drafts") return tx.status === "DRAFT"
    if (filter === "Voided") return tx.status === "CANCELLED"
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

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setError("")
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="p-4 sm:p-8">
      <Heading
        title="Transactions"
        subtitle="Sales and purchases with posting status. Voided sales stay listed for the audit trail."
      />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded border px-4 py-2 text-xs font-bold ${
                filter === item ? "border-[#28695E] bg-[#28695E] text-white" : "border-[#D9DAD5] bg-white"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-bold">
            Day
            <input
              type="date"
              value={date}
              max={todayInMalaysia()}
              onChange={(event) => setDate(event.target.value)}
              className="rounded border border-[#D9DAD5] bg-white px-2 py-1.5 text-xs font-normal outline-none"
            />
          </label>
          {date && (
            <button onClick={() => setDate("")} className="text-xs font-bold text-[#28695E]">
              Show latest
            </button>
          )}
          {isAdmin && (
            <button
              className="rounded bg-[#24302C] px-4 py-2 text-xs font-bold text-white"
              onClick={() => setPurchaseOpen(true)}
            >
              + New purchase
            </button>
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[#7E827C]">
        {date ? `Showing ${myDate(new Date(`${date}T12:00:00+08:00`))} (Malaysia time).` : "Showing the latest 200."}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">
          {error}
        </p>
      )}
      <Table
        headers={["Number", "Type", "Status", "Date", "Created by", "Payment", "Total"]}
        rows={rows}
        empty="No transactions match this filter."
        actionWidth={isAdmin ? 170 : 76}
        action={(index) => {
          const tx = shown[index]
          const draft = tx.type === "PURCHASE" && tx.status === "DRAFT"
          return (
            <div className="flex gap-1.5">
              {isAdmin && draft && (
                <>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => run(tx.number, () => api(`/purchases/${tx.number}/post`, { method: "POST" }))}
                    className="rounded border border-[#28695E] px-2 py-1.5 text-[11px] font-bold text-[#28695E] disabled:opacity-40"
                    title="The delivery arrived: add its stock now"
                  >
                    {busy === tx.number ? "…" : "Post"}
                  </button>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      window.confirm(`Cancel draft ${tx.number}? No stock was added, so none is removed.`) &&
                      run(tx.number, () => api(`/purchases/${tx.number}/cancel`, { method: "POST", body: {} }))
                    }
                    className="rounded border border-[#D9DAD5] px-2 py-1.5 text-[11px] font-bold text-[#A34E42] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </>
              )}
              {isAdmin && tx.type === "SALE" && tx.status === "POSTED" && (
                <button
                  onClick={() => setVoiding(tx)}
                  className="rounded border border-[#D9DAD5] px-2 py-1.5 text-[11px] font-bold text-[#A34E42]"
                >
                  Void
                </button>
              )}
              <button
                onClick={() => setViewing(tx)}
                aria-label={`Print ${tx.number}`}
                className="flex items-center gap-1.5 rounded border border-[#D9DAD5] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#28695E] hover:border-[#28695E]"
              >
                <Icon name="printer" size={13} />
                Print
              </button>
            </div>
          )
        }}
      />
      {viewing && <ReceiptDialog tx={viewing} rates={rates} onClose={() => setViewing(null)} />}
      {voiding && (
        <VoidModal
          tx={voiding}
          onClose={() => setVoiding(null)}
          onVoid={async (reason) => {
            await api(`/sales/${voiding.number}/void`, { method: "POST", body: { reason } })
            await onChanged()
            setVoiding(null)
          }}
        />
      )}
      {purchaseOpen && (
        <NewPurchaseModal
          catalogue={catalogue.filter((p) => p.isActive && p.trackStock)}
          onClose={() => setPurchaseOpen(false)}
          onPost={async (body) => {
            await api("/purchases", { method: "POST", body })
            await onChanged()
            setPurchaseOpen(false)
          }}
        />
      )}
    </div>
  )
}

function VoidModal({
  tx,
  onClose,
  onVoid,
}: {
  tx: Transaction
  onClose: () => void
  onVoid: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!reason.trim()) return setError("A reason is required to void a sale.")
    setBusy(true)
    setError("")
    try {
      await onVoid(reason.trim())
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-4">
      <div className="w-full max-w-sm rounded-md bg-white p-7 shadow-xl">
        <h2 className="font-display text-xl font-bold">Void {tx.number}?</h2>
        <p className="mt-2 text-xs leading-relaxed text-[#767A74]">
          {money(tx.total)} paid by {tx.payment}. The stock it used is put back and the sale is kept
          as CANCELLED for the audit trail. Refund the customer separately.
        </p>
        {error && <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{error}</p>}
        <label className="mt-4 block text-xs font-bold">
          Reason
          <input
            value={reason}
            maxLength={200}
            autoFocus
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Wrong order keyed in"
            className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 w-full rounded bg-[#A34E42] py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? "Voiding…" : "Void sale"}
        </button>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
        >
          Keep sale
        </button>
      </div>
    </div>
  )
}

/** Suggested unit cost for a delivery: the last purchase cost, else the selling price. */
export const defaultCost = (product?: Product) =>
  product ? (product.costPrice > 0 ? product.costPrice : product.price) : 0

type PurchaseBody = { productId: number; quantity: number; unitCost: number; status: "POSTED" | "DRAFT" }

export function NewPurchaseModal({
  catalogue,
  onClose,
  onPost,
}: {
  catalogue: Product[]
  onClose: () => void
  onPost: (body: PurchaseBody) => Promise<void>
}) {
  const [productId, setProductId] = useState(catalogue[0]?.id ?? 0)
  const [quantity, setQuantity] = useState(1)
  const product = catalogue.find((item) => item.id === productId)
  const [unitCost, setUnitCost] = useState(defaultCost(product))
  const [status, setStatus] = useState<PurchaseBody["status"]>("POSTED")
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
      await onPost({ productId: product.id, quantity, unitCost, status })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  const field = "mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none"
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-4">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-4 font-display text-xl font-bold">New purchase</h2>
        <p className="mt-2 text-sm text-[#767A74]">Record a supplier delivery.</p>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">{error}</p>
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
            className={field}
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
            onChange={(event) => setQuantity(Math.max(1, Math.floor(Number(event.target.value)) || 1))}
            className={field}
          />
        </label>
        <label className="mt-4 block text-left text-xs font-bold">
          Unit cost (MYR per unit, e.g. per g for ingredients)
          <input
            type="number"
            min={0}
            step="any"
            value={unitCost}
            onChange={(event) => setUnitCost(Math.max(0, Number(event.target.value) || 0))}
            className={field}
          />
        </label>
        <fieldset className="mt-4 text-left text-xs">
          <legend className="font-bold">When</legend>
          <label className="mt-2 flex items-center gap-2">
            <input type="radio" checked={status === "POSTED"} onChange={() => setStatus("POSTED")} />
            Delivered now: add the stock straight away
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="radio" checked={status === "DRAFT"} onChange={() => setStatus("DRAFT")} />
            Ordered, not delivered yet: save as a draft
          </label>
        </fieldset>
        <div className="mt-5 flex justify-between text-sm font-bold">
          <span>Total</span>
          <span>{money(total)}</span>
        </div>
        <button
          onClick={post}
          disabled={!product || unitCost <= 0 || busy}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-35"
        >
          {busy ? "Saving…" : status === "POSTED" ? "Post purchase" : "Save draft"}
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
