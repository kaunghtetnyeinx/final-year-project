import { useEffect } from "react"
import { createPortal } from "react-dom"
import Icon from "./Icon"
import { Rates } from "../lib/billing"
import { money, myDateTime, ratePct, signedMoney, unitMoney } from "../lib/format"
import { Transaction } from "../lib/types"

/** Thermal-style receipt. Used for the on-screen preview and for printing. */
export function Receipt({ tx, rates }: { tx: Transaction; rates: Rates }) {
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
export default function ReceiptDialog({
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
