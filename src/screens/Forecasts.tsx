import { useState } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import Table from "../components/Table"
import { myDateTime } from "../lib/format"
import { Forecast, Product } from "../lib/types"

export default function Forecasts({
  catalogue,
  forecasts,
  onRun,
}: {
  catalogue: Product[]
  forecasts: Forecast[]
  /** Runs the forecast job now and reloads. */
  onRun: () => Promise<void>
}) {
  const [reviewed, setReviewed] = useState(false)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState("")
  const run = async () => {
    setRunning(true)
    setRunError("")
    try {
      await onRun()
    } catch (err) {
      setRunError((err as Error).message)
    } finally {
      setRunning(false)
    }
  }
  // Predicted demand comes from forecast_results (newest run per product). On-hand and
  // the recommendation use live stock, so they stay right after sales and purchases.
  const items = forecasts
    .map((forecast) => ({ forecast, product: catalogue.find((p) => p.id === forecast.productId) }))
    .filter((item): item is { forecast: Forecast; product: Product } => Boolean(item.product))
  const demand = items.map(({ forecast, product }) => {
    // When forecast demand exceeds stock, order enough to cover it and
    // restore the reorder level as safety stock.
    const order = Math.ceil(forecast.predicted + product.reorder - product.stock)
    return [
      product.name,
      String(product.stock),
      forecast.predicted.toFixed(1),
      String(product.reorder),
      forecast.predicted > product.stock ? `Order ${order} units` : "Stock sufficient",
    ]
  })
  const total = items.reduce((sum, { forecast }) => sum + forecast.predicted, 0)
  const atRisk = items.filter(({ forecast, product }) => forecast.predicted > product.stock).length
  const latest = forecasts.reduce<Forecast | null>(
    (best, f) => (!best || f.generatedAt > best.generatedAt ? f : best),
    null,
  )
  const horizon = latest?.horizonDays ?? 7
  // One shared scale for demand and stock, so the bar and the stock marker compare directly.
  const scale = Math.max(1, ...items.map(({ forecast, product }) => Math.max(forecast.predicted, product.stock)))
  return (
    <div className="p-4 sm:p-8">
      <Heading
        title="Demand forecasts"
        subtitle={
          latest
            ? `Latest results from ${latest.model}${latest.modelVersion ? ` v${latest.modelVersion}` : ""} · generated ${myDateTime(latest.generatedAt)} MYT.`
            : "No forecast results yet."
        }
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#7E827C]">
        <span>
          Moving average: units sold per day over the last 28 days × 7. Runs automatically once a day.
        </span>
        <button
          onClick={run}
          disabled={running}
          className="rounded border border-[#28695E] bg-white px-3 py-2 text-xs font-bold text-[#28695E] disabled:opacity-50"
        >
          {running ? "Running…" : "Run forecast now"}
        </button>
      </div>
      {runError && <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{runError}</p>}
      {items.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-[#D8D9D4] bg-white p-8 text-center text-xs text-[#8B8F89]">
          No forecasts have been generated yet. When the forecast job writes to
          forecast_results, the results appear here.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_280px]">
            <figure className="rounded border border-[#DEDFDA] bg-white p-5">
              <div className="flex justify-between">
                <figcaption>
                  <p className="text-xs font-bold">Predicted demand · next {horizon} days</p>
                  <p className="mt-1 text-[11px] text-[#858983]">
                    Bar = predicted units · marker = units on hand now
                  </p>
                </figcaption>
                <span className="text-xs font-bold text-[#28695E]">
                  {total.toFixed(1)} units
                </span>
              </div>
              <div className="mt-5 space-y-2.5">
                {items.map(({ forecast, product }) => {
                  const short = forecast.predicted > product.stock
                  return (
                    <div
                      key={product.id}
                      className="group grid grid-cols-[150px_1fr_52px] items-center gap-3 text-[11px]"
                      title={`${product.name}: ${forecast.predicted.toFixed(1)} predicted, ${product.stock} on hand`}
                    >
                      <span className="truncate text-[#5E6863]">{product.name}</span>
                      <div className="relative h-4">
                        <div
                          className="h-full rounded-r bg-[#73958D] group-hover:bg-[#28695E]"
                          style={{ width: `${(forecast.predicted / scale) * 100}%` }}
                        />
                        <div
                          className="absolute -top-0.5 h-5 w-0.5 bg-[#24302C]"
                          style={{ left: `${(product.stock / scale) * 100}%` }}
                        />
                      </div>
                      <span className="text-right tabular-nums text-[#24302C]">
                        {forecast.predicted.toFixed(1)}
                        {short && <span className="sr-only"> (more than stock)</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </figure>
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
                  ? `Predicted demand exceeds available stock for ${atRisk} product${atRisk === 1 ? "" : "s"} during the next ${horizon}-day period.`
                  : `Available stock covers predicted demand for the next ${horizon}-day period.`}
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
        </>
      )}
    </div>
  )
}
