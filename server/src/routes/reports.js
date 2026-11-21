import { Router } from "express"
import { z } from "zod"
import { round2 } from "../billing.js"
import { pool } from "../db.js"
import { parse } from "../errors.js"
import { dayRange, isoDate, todayInMalaysia } from "../time.js"

// Signed-in users (staff close the till too): end-of-day summary for one Malaysian day.
export const reportsRouter = Router()

const DailyQuery = z.object({ date: isoDate.optional() })

reportsRouter.get("/reports/daily", async (req, res) => {
  const date = parse(DailyQuery, req.query).date ?? todayInMalaysia()
  const [start, end] = dayRange(date)
  const range = "t.created_at >= ? AND t.created_at < ?"

  const [groups] = await pool.query(
    `SELECT t.status, t.payment_method AS payment, COUNT(*) AS count, SUM(t.subtotal) AS subtotal,
            SUM(t.discount) AS discount, SUM(t.service_charge) AS serviceCharge, SUM(t.tax) AS tax,
            SUM(t.rounding_adjustment) AS rounding, SUM(t.total) AS total
     FROM transactions t WHERE t.transaction_type = 'SALE' AND ${range}
     GROUP BY t.status, t.payment_method`,
    [start, end],
  )
  const posted = groups.filter((g) => g.status === "POSTED")
  const sum = (rows, key) => round2(rows.reduce((s, r) => s + Number(r[key] ?? 0), 0))
  const count = posted.reduce((s, r) => s + Number(r.count), 0)
  const total = sum(posted, "total")

  const [topItems] = await pool.query(
    `SELECT p.id AS productId, p.name, SUM(i.quantity) AS quantity, SUM(i.line_total) AS revenue
     FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id JOIN products p ON p.id = i.product_id
     WHERE t.transaction_type = 'SALE' AND t.status = 'POSTED' AND ${range}
     GROUP BY p.id, p.name ORDER BY quantity DESC, revenue DESC LIMIT 10`,
    [start, end],
  )
  const [[purchases]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(t.total), 0) AS total
     FROM transactions t WHERE t.transaction_type = 'PURCHASE' AND t.status = 'POSTED' AND ${range}`,
    [start, end],
  )
  const voided = groups.filter((g) => g.status === "CANCELLED")

  res.json({
    report: {
      date,
      sales: {
        count,
        subtotal: sum(posted, "subtotal"),
        discount: sum(posted, "discount"),
        serviceCharge: sum(posted, "serviceCharge"),
        tax: sum(posted, "tax"),
        rounding: sum(posted, "rounding"),
        total,
        averageSale: count ? round2(total / count) : 0,
      },
      byPayment: ["Cash", "Card", "QR"].map((payment) => {
        const rows = posted.filter((g) => g.payment === payment)
        return { payment, count: rows.reduce((s, r) => s + Number(r.count), 0), total: sum(rows, "total") }
      }),
      voided: { count: voided.reduce((s, r) => s + Number(r.count), 0), total: sum(voided, "total") },
      topItems: topItems.map((r) => ({ ...r, quantity: Number(r.quantity), revenue: round2(Number(r.revenue)) })),
      purchases: { count: Number(purchases.count), total: round2(Number(purchases.total)) },
      generatedAt: new Date().toISOString(),
    },
  })
})
