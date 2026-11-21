import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import Table from "../components/Table"
import { api } from "../lib/api"
import { money, myDate, myDateTime, qty, signedMoney } from "../lib/format"
import type { DailyReport } from "../lib/types"
import { todayInMalaysia } from "./Transactions"

const dayLabel = (date: string) => myDate(new Date(`${date}T12:00:00+08:00`))

/** End-of-day summary for one Malaysian day: what to count in the drawer and what sold. */
export default function Reports({ isAdmin }: { isAdmin: boolean }) {
  const [date, setDate] = useState(todayInMalaysia())
  const [report, setReport] = useState<DailyReport | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let current = true
    setLoading(true)
    api<{ report: DailyReport }>(`/reports/daily?date=${date}`)
      .then(({ report }) => current && (setReport(report), setError("")))
      .catch((err) => current && setError((err as Error).message))
      .finally(() => current && setLoading(false))
    return () => {
      current = false
    }
  }, [date])

  // Print only the summary slip (same print rules as receipts, see index.css).
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener("afterprint", done)
    window.print()
    const fallback = setTimeout(done, 1000)
    return () => {
      window.removeEventListener("afterprint", done)
      clearTimeout(fallback)
    }
  }, [printing])

  const s = report?.sales
  return (
    <div className="p-4 sm:p-8">
      <Heading title="Daily report" subtitle="Sales, payments and voids for one day (Malaysia time). Use it to close the till." />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(shiftDay(date, -1))}
            aria-label="Previous day"
            className="rounded border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-bold"
          >
            ←
          </button>
          <input
            type="date"
            value={date}
            max={todayInMalaysia()}
            onChange={(event) => event.target.value && setDate(event.target.value)}
            aria-label="Report date"
            className="rounded border border-[#D9DAD5] bg-white px-3 py-2 text-xs outline-none"
          />
          <button
            onClick={() => setDate(shiftDay(date, 1))}
            disabled={date >= todayInMalaysia()}
            aria-label="Next day"
            className="rounded border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-bold disabled:opacity-30"
          >
            →
          </button>
        </div>
        <button
          onClick={() => setPrinting(true)}
          disabled={!report}
          className="flex items-center gap-2 rounded border border-[#28695E] bg-white px-4 py-2 text-xs font-bold text-[#28695E] disabled:opacity-40"
        >
          <Icon name="printer" size={14} />
          Print summary
        </button>
      </div>
      {error && <p className="mt-4 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{error}</p>}
      {loading && !report && <p className="mt-6 text-xs text-[#858983]">Loading report…</p>}
      {report && s && (
        <div className={loading ? "opacity-60" : ""}>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              [money(s.total), "Total sales"],
              [String(s.count), "Sales"],
              [money(s.averageSale), "Average sale"],
              [String(report.voided.count), `Voided (${money(report.voided.total)})`],
            ].map(([value, label]) => (
              <div key={label} className="rounded border border-[#DEDFDA] bg-white p-5">
                <p className="font-display text-2xl font-bold">{value}</p>
                <p className="mt-1 text-xs text-[#7E827C]">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="rounded border border-[#DEDFDA] bg-white p-5">
              <h2 className="text-xs font-bold">By payment method</h2>
              <p className="mt-1 text-[11px] text-[#858983]">Cash is what should be in the drawer (plus your float).</p>
              <dl className="mt-4 space-y-2 text-sm">
                {report.byPayment.map((p) => (
                  <div key={p.payment} className="flex justify-between border-b border-[#ECEDE9] pb-2">
                    <dt>
                      {p.payment} <span className="text-xs text-[#858983]">· {p.count} sales</span>
                    </dt>
                    <dd className="font-bold tabular-nums">{money(p.total)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="rounded border border-[#DEDFDA] bg-white p-5">
              <h2 className="text-xs font-bold">Bill breakdown</h2>
              <dl className="mt-4 space-y-2 text-sm">
                {(
                  [
                    ["Item subtotal", money(s.subtotal)],
                    ["Discounts", s.discount ? `-${money(s.discount)}` : money(0)],
                    ["Service charge", money(s.serviceCharge)],
                    ["SST", money(s.tax)],
                    ["Rounding", signedMoney(s.rounding)],
                    ["Total", money(s.total)],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between border-b border-[#ECEDE9] pb-2 last:font-bold">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              {isAdmin && (
                <p className="mt-3 text-[11px] text-[#858983]">
                  Supplier purchases posted this day: {report.purchases.count} · {money(report.purchases.total)}
                </p>
              )}
            </section>
          </div>
          <h2 className="mt-6 text-xs font-bold">Top items</h2>
          <Table
            headers={["Product", "Units sold", "Revenue (before charges)"]}
            rows={report.topItems.map((t) => [t.name, qty(t.quantity), money(t.revenue)])}
            empty="Nothing sold on this day."
          />
          <p className="mt-3 text-[10px] text-[#969A94]">Generated {myDateTime(new Date(report.generatedAt))} MYT</p>
        </div>
      )}
      {printing &&
        report &&
        createPortal(
          <div className="print-root">
            <SummarySlip report={report} />
          </div>,
          document.body,
        )}
    </div>
  )
}

/** YYYY-MM-DD plus or minus whole days. */
const shiftDay = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400_000).toISOString().slice(0, 10)

/** 80 mm end-of-day slip for the receipt printer. */
function SummarySlip({ report }: { report: DailyReport }) {
  const s = report.sales
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
  const Rule = () => <div className="my-2 border-t border-dashed border-[#A4A9A3]" />
  return (
    <div className="receipt bg-white font-mono text-[11px] leading-[1.6] text-[#1F2421]">
      <p className="text-center font-bold">Juniper Cafe · Main Store</p>
      <p className="text-center font-bold uppercase tracking-[.2em]">Daily summary</p>
      <p className="text-center">{dayLabel(report.date)}</p>
      <Rule />
      <Row label="Sales" value={String(s.count)} />
      <Row label="Item subtotal" value={money(s.subtotal)} />
      <Row label="Discounts" value={`-${money(s.discount)}`} />
      <Row label="Service charge" value={money(s.serviceCharge)} />
      <Row label="SST" value={money(s.tax)} />
      <Row label="Rounding" value={signedMoney(s.rounding)} />
      <div className="flex justify-between font-bold">
        <span>TOTAL</span>
        <span>{money(s.total)}</span>
      </div>
      <Rule />
      {report.byPayment.map((p) => (
        <Row key={p.payment} label={`${p.payment} (${p.count})`} value={money(p.total)} />
      ))}
      <Row label={`Voided (${report.voided.count})`} value={money(report.voided.total)} />
      <Rule />
      {report.topItems.slice(0, 5).map((t) => (
        <Row key={t.productId} label={`${qty(t.quantity)} × ${t.name}`} value={money(t.revenue)} />
      ))}
      <Rule />
      <p className="text-center text-[10px]">Printed {myDateTime(new Date())} MYT</p>
    </div>
  )
}
