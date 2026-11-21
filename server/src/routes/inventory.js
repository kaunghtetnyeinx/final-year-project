import { Router } from "express"
import { z } from "zod"
import { pool, withTransaction } from "../db.js"
import { badRequest, conflict, parse } from "../errors.js"
import { recordMovements } from "../ledger.js"

// Admin only (mounted behind requireAdmin in app.js).
export const inventoryRouter = Router()

const AdjustBody = z.object({
  productId: z.number().int().positive(),
  change: z.number().int().refine((n) => n !== 0, "Enter a non-zero adjustment."),
  reason: z.string().trim().min(1, "A reason is required for the audit trail.").max(100),
})

inventoryRouter.post("/inventory/adjustments", async (req, res) => {
  const body = parse(AdjustBody, req.body)
  const product = await withTransaction(async (conn) => {
    const [rows] = await conn.query("SELECT id, stock_quantity FROM products WHERE id = ? FOR UPDATE", [body.productId])
    if (!rows[0]) throw badRequest("Product not found")
    if (rows[0].stock_quantity + body.change < 0)
      throw conflict(`Only ${rows[0].stock_quantity} units on hand; stock cannot go below zero.`)
    await recordMovements(conn, [{ productId: body.productId, change: body.change }], "ADJUSTMENT", body.reason, req.user.id)
    const [after] = await conn.query("SELECT id, stock_quantity AS stock FROM products WHERE id = ?", [body.productId])
    return after[0]
  })
  res.status(201).json({ product })
})

const MovementQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(300) })

// Same shape as Movement in App.tsx (id "MV-2081", signed change, source, by).
inventoryRouter.get("/stock-movements", async (req, res) => {
  const { limit } = parse(MovementQuery, req.query)
  const [rows] = await pool.query(
    `SELECT m.id, p.id AS product_id, p.name AS product, m.movement_type, m.quantity_change, m.reference,
            u.name AS by_name, m.created_at
     FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.performed_by
     ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
    [limit],
  )
  res.json({
    movements: rows.map((r) => ({
      id: `MV-${r.id}`,
      productId: r.product_id,
      product: r.product,
      type: r.movement_type,
      change: r.quantity_change,
      source: r.reference,
      by: r.by_name,
      created: r.created_at.toISOString(),
    })),
  })
})
