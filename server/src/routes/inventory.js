import { Router } from "express"
import { z } from "zod"
import { pool, withTransaction } from "../db.js"
import { badRequest, conflict, parse } from "../errors.js"
import { expandRecipe, recordMovements, round3 } from "../ledger.js"

// Admin only (mounted behind requireAdmin in app.js).
export const inventoryRouter = Router()
const qty = (n) => String(round3(n))
const threeDecimals = (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6

const AdjustBody = z.object({
  productId: z.number().int().positive(),
  // Ingredients are counted in g / ml / piece, so a correction can be e.g. -12.5 g.
  change: z
    .number()
    .finite()
    .refine((n) => n !== 0, "Enter a non-zero adjustment.")
    .refine(threeDecimals, "An adjustment can have at most 3 decimal places."),
  reason: z.string().trim().min(1, "A reason is required for the audit trail.").max(100),
})

inventoryRouter.post("/inventory/adjustments", async (req, res) => {
  const body = parse(AdjustBody, req.body)
  const product = await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      "SELECT id, name, stock_quantity, track_stock FROM products WHERE id = ? FOR UPDATE",
      [body.productId],
    )
    const p = rows[0]
    if (!p) throw badRequest("Product not found")
    if (!p.track_stock) throw badRequest(`${p.name} is made to order and keeps no stock.`)
    if (p.stock_quantity + body.change < -1e-9)
      throw conflict(`Only ${qty(p.stock_quantity)} on hand; stock cannot go below zero.`)
    await recordMovements(conn, [{ productId: body.productId, change: body.change }], "ADJUSTMENT", body.reason, req.user.id)
    const [after] = await conn.query("SELECT id, stock_quantity AS stock FROM products WHERE id = ?", [body.productId])
    return after[0]
  })
  res.status(201).json({ product })
})

const ProductionBody = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(10_000),
  note: z.string().trim().max(60).optional(),
})

// Record a batch made in the kitchen (e.g. 24 croissants): the finished product's stock
// goes up and its recipe's ingredients go down, both as PRODUCTION movements. This is
// where batch-made items use up ingredients; made-to-order items do it when sold.
inventoryRouter.post("/inventory/production", async (req, res) => {
  const body = parse(ProductionBody, req.body)
  const result = await withTransaction(async (conn) => {
    const [all] = await conn.query("SELECT id, name, track_stock, is_active FROM products")
    const products = new Map(all.map((p) => [p.id, p]))
    const product = products.get(body.productId)
    if (!product || !product.is_active) throw badRequest("Product not found or inactive")
    if (!product.track_stock)
      throw badRequest(`${product.name} is made to order: its ingredients are used up when it is sold.`)
    const [recipes] = await conn.query("SELECT product_id, ingredient_id, quantity_required, unit FROM recipes")
    const needs = expandRecipe(body.productId, body.quantity, recipes, products)
    if (!needs.size) throw badRequest(`${product.name} has no recipe yet. Add its ingredients in Recipes first.`)
    const ids = [...new Set([body.productId, ...needs.keys()])].sort((a, b) => a - b)
    const [locked] = await conn.query("SELECT id, name, stock_quantity FROM products WHERE id IN (?) ORDER BY id FOR UPDATE", [ids])
    const live = new Map(locked.map((p) => [p.id, p]))
    for (const [id, need] of needs) {
      const p = live.get(id)
      if (p.stock_quantity + 1e-9 < need.amount)
        throw conflict(`Not enough ${p.name} (need ${qty(need.amount)} ${need.unit}, have ${qty(p.stock_quantity)})`)
    }
    const reference = `Production: ${body.quantity} × ${product.name}${body.note ? ` (${body.note})` : ""}`.slice(0, 100)
    await recordMovements(
      conn,
      [
        ...[...needs].sort(([a], [b]) => a - b).map(([productId, need]) => ({ productId, change: -need.amount })),
        { productId: body.productId, change: body.quantity },
      ],
      "PRODUCTION",
      reference,
      req.user.id,
    )
    const [[after]] = await conn.query("SELECT id, stock_quantity AS stock FROM products WHERE id = ?", [body.productId])
    return { product: after, used: [...needs].map(([productId, need]) => ({ productId, ...need })) }
  })
  res.status(201).json(result)
})

const MovementQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(300) })

// Same shape as Movement in src/lib/types.ts (id "MV-2081", signed change, source, by).
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
