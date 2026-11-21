import { Router } from "express"
import { z } from "zod"
import { requireAdmin } from "../auth.js"
import { purchaseBill, round2, saleBill } from "../billing.js"
import { withTransaction } from "../db.js"
import { badRequest, conflict, notFound, parse } from "../errors.js"
import { isDuplicate, loadTransactions, nextNumber, recordMovements } from "../ledger.js"
import { getSettings } from "../settings.js"

export const transactionsRouter = Router()
const INGREDIENTS = "Ingredients"

// ---------------------------------------------------------------- list / detail
const ListQuery = z.object({
  type: z.enum(["SALE", "PURCHASE"]).optional(),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

transactionsRouter.get("/transactions", async (req, res) => {
  const q = parse(ListQuery, req.query)
  const where = ["1=1"]
  const params = []
  if (q.type) where.push("t.transaction_type = ?"), params.push(q.type)
  if (q.status) where.push("t.status = ?"), params.push(q.status)
  res.json({ transactions: await loadTransactions({ where: where.join(" AND "), params, limit: q.limit }) })
})

transactionsRouter.get("/transactions/:number", async (req, res) => {
  const [tx] = await loadTransactions({ where: "t.transaction_number = ?", params: [req.params.number], limit: 1 })
  if (!tx) throw notFound("Transaction not found")
  res.json({ transaction: tx })
})

// ---------------------------------------------------------------- new sale
const SaleBody = z.object({
  // Made by the till once per Confirm (crypto.randomUUID()). Sending the same id again
  // returns the first sale instead of charging and deducting stock twice.
  requestId: z.uuid(),
  payment: z.enum(["Cash", "Card", "QR"]),
  lines: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(999) }))
    .min(1, "The cart is empty")
    .max(100),
})

const findByRequestId = async (conn, requestId) =>
  (await loadTransactions({ conn, where: "t.client_request_id = ?", params: [requestId], limit: 1 }))[0]

transactionsRouter.post("/sales", async (req, res) => {
  const body = parse(SaleBody, req.body)
  // Merge repeated products into one line.
  const quantities = new Map()
  for (const l of body.lines) quantities.set(l.productId, (quantities.get(l.productId) ?? 0) + l.quantity)

  try {
    const result = await withTransaction(async (conn) => {
      const existing = await findByRequestId(conn, body.requestId)
      if (existing) return { sale: existing, replayed: true }

      // Lock the products being sold until this sale is saved, so two tills cannot oversell.
      const ids = [...quantities.keys()].sort((a, b) => a - b)
      const [products] = await conn.query(
        `SELECT p.id, p.name, p.price, p.stock_quantity, p.is_active, c.name AS category
         FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id IN (?) ORDER BY p.id FOR UPDATE`,
        [ids],
      )
      const byId = new Map(products.map((p) => [p.id, p]))
      const lines = ids.map((id) => {
        const p = byId.get(id)
        const quantity = quantities.get(id)
        if (!p || !p.is_active) throw badRequest(`Product ${id} is not available for sale`)
        if (p.category === INGREDIENTS) throw badRequest(`${p.name} is an ingredient and cannot be sold`)
        if (p.stock_quantity < quantity) throw conflict(`Only ${p.stock_quantity} × ${p.name} in stock`)
        return { productId: id, quantity, unitPrice: p.price } // price from the database, not the browser
      })

      const bill = saleBill(lines, await getSettings(conn))
      const number = await nextNumber(conn, "SL", 4)
      const [inserted] = await conn.query(
        `INSERT INTO transactions (user_id, transaction_number, client_request_id, transaction_type, status,
           subtotal, service_charge, tax, discount, rounding_adjustment, total, payment_method)
         VALUES (?, ?, ?, 'SALE', 'POSTED', ?, ?, ?, 0, ?, ?, ?)`,
        [req.user.id, number, body.requestId, bill.subtotal, bill.serviceCharge, bill.tax, bill.rounding, bill.total, body.payment],
      )
      for (const l of lines) {
        await conn.query(
          "INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)",
          [inserted.insertId, l.productId, l.quantity, l.unitPrice, round2(l.unitPrice * l.quantity)],
        )
      }
      await recordMovements(conn, lines.map((l) => ({ productId: l.productId, change: -l.quantity })), "SALE", number, req.user.id)
      return { sale: (await loadTransactions({ conn, where: "t.id = ?", params: [inserted.insertId], limit: 1 }))[0], replayed: false }
    })
    res.status(result.replayed ? 200 : 201).json(result)
  } catch (error) {
    // Two identical requests at the same instant: the second one returns the first sale.
    if (isDuplicate(error) && String(error.message).includes("uq_tx_client_request")) {
      const [sale] = await loadTransactions({ where: "t.client_request_id = ?", params: [body.requestId], limit: 1 })
      return res.status(200).json({ sale, replayed: true })
    }
    throw error
  }
})

// ---------------------------------------------------------------- supplier purchase (admin)
const fourDecimals = (n) => Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-6
const PurchaseBody = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(1_000_000),
  unitCost: z.number().positive().max(100_000).refine(fourDecimals, "Unit cost can have at most 4 decimal places"),
  status: z.enum(["DRAFT", "POSTED"]).default("POSTED"),
})

transactionsRouter.post("/purchases", requireAdmin, async (req, res) => {
  const body = parse(PurchaseBody, req.body)
  const purchase = await withTransaction(async (conn) => {
    const [rows] = await conn.query("SELECT id, is_active FROM products WHERE id = ? FOR UPDATE", [body.productId])
    if (!rows[0] || !rows[0].is_active) throw badRequest("Product not found or inactive")
    const lines = [{ quantity: body.quantity, unitPrice: body.unitCost }]
    const bill = purchaseBill(lines)
    const number = await nextNumber(conn, "PO", 4)
    const [inserted] = await conn.query(
      `INSERT INTO transactions (user_id, transaction_number, transaction_type, status, subtotal, service_charge,
         tax, discount, rounding_adjustment, total, payment_method)
       VALUES (?, ?, 'PURCHASE', ?, ?, 0, 0, 0, 0, ?, NULL)`,
      [req.user.id, number, body.status, bill.subtotal, bill.total],
    )
    await conn.query(
      "INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)",
      [inserted.insertId, body.productId, body.quantity, body.unitCost, round2(body.quantity * body.unitCost)],
    )
    if (body.status === "POSTED") {
      await recordMovements(conn, [{ productId: body.productId, change: body.quantity }], "PURCHASE", number, req.user.id)
      // Recipe costing uses the latest posted purchase cost.
      await conn.query("UPDATE products SET cost_price = ? WHERE id = ?", [body.unitCost, body.productId])
    }
    return (await loadTransactions({ conn, where: "t.id = ?", params: [inserted.insertId], limit: 1 }))[0]
  })
  res.status(201).json({ transaction: purchase })
})
