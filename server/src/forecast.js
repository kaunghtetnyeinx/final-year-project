// Demand forecast job: a moving average of each product's real sales.
// predicted units for the next HORIZON days = average units sold per day over the last
// WINDOW days x HORIZON. Writes one forecast_results row per sellable product; the
// Forecasts screen always shows the newest row per product.
import { pool as defaultPool } from "./db.js"

export const MODEL = { name: "moving_average", version: "1", windowDays: 28, horizonDays: 7 }
const INGREDIENTS = "Ingredients"
const DAY = 24 * 60 * 60 * 1000
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** Tomorrow's date in Malaysia (UTC+8), e.g. "2026-11-22": the first day being forecast. */
const tomorrowInMalaysia = (now) => new Date(now.getTime() + 8 * 60 * 60 * 1000 + DAY).toISOString().slice(0, 10)

export async function runForecast({ pool = defaultPool, now = new Date() } = {}) {
  const since = new Date(now.getTime() - MODEL.windowDays * DAY)
  const [rows] = await pool.query(
    `SELECT p.id, p.category_id,
            COALESCE((SELECT SUM(i.quantity) FROM transaction_items i
                      JOIN transactions t ON t.id = i.transaction_id
                      WHERE i.product_id = p.id AND t.transaction_type = 'SALE' AND t.status = 'POSTED'
                        AND t.created_at >= ? AND t.created_at < ?), 0) AS sold
     FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = 1 AND c.name <> ?`,
    [since, now, INGREDIENTS],
  )
  if (!rows.length) return { generated: 0 }
  const forecastDate = tomorrowInMalaysia(now)
  await pool.query(
    `INSERT INTO forecast_results (product_id, category_id, forecast_date, horizon_days, predicted_quantity,
       model_name, model_version, generated_at) VALUES ?`,
    [
      rows.map((r) => [
        r.id,
        r.category_id,
        forecastDate,
        MODEL.horizonDays,
        round2((Number(r.sold) / MODEL.windowDays) * MODEL.horizonDays),
        MODEL.name,
        MODEL.version,
        now,
      ]),
    ],
  )
  return { generated: rows.length, forecastDate }
}

/** True when the newest moving-average run is older than `hours` (or there is none). */
export async function forecastIsStale({ pool = defaultPool, hours = 20 } = {}) {
  const [[row]] = await pool.query(
    "SELECT MAX(generated_at) AS latest FROM forecast_results WHERE model_name = ?",
    [MODEL.name],
  )
  return !row.latest || Date.now() - new Date(row.latest).getTime() > hours * 60 * 60 * 1000
}
