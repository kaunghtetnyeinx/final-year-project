import { Router } from "express"
import { z } from "zod"
import { requireAdmin } from "../auth.js"
import { purchaseBill, round2, saleBill } from "../billing.js"
import { withTransaction } from "../db.js"
import { badRequest, conflict, notFound, parse } from "../errors.js"
import { expandRecipe, isDuplicate, loadTransactions, nextNumber, recordMovements, round3 } from "../ledger.js"
import { getSettings } from "../settings.js"
import { dayRange, isoDate } from "../time.js"

export const transactionsRouter = Router()
const INGREDIENTS = "Ingredients"
const qty = (n) => String(round3(n))

// ---------------------------------------------------------------- list / detail
const ListQuery = z.object({
  type: z.enum(["SALE", "PURCHASE"]).optional(),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED"]).optional(),
  // One day in Malaysia time, e.g. 2026-11-21
  date: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

transactionsRouter.get("/transactions", async (req, res) => {
  const q = parse(ListQuery, req.query)
  const where = ["1=1"]
  const params = []
  if (q.type) where.push("t.transaction_type = ?"), params.push(q.type)
  if (q.status) where.push("t.status = ?"), params.push(q.status)
  if (q.date) where.push("t.created_at >= ? AND t.created_at < ?"), params.push(...dayRange(q.date))
  res.json({ transactions: await loadTransactions({ where: where.join(" AND "), params, limit: q.limit }) })
})

transactionsRouter.get("/transactions/:number", async (req, res) => {
  const [tx] = await loadTransactions({ where: "t.transaction_number = ?", params: [req.params.number], limit: 1 })
  if (!tx) throw notFound("Transaction not found")
  res.json({ transaction: tx })
})

const loadOne = async (conn, id) => (await loadTransactions({ conn, where: "t.id = ?", params: [id], limit: 1 }))[0]

// ---------------------------------------------------------------- new sale
const money = z.number().finite().min(0).max(100_000)
const SaleBody = z.object({
  // Made by the till once per Confirm. Sending the same id again returns the first sale
  // instead of charging and deducting stock twice.
  requestId: z.uuid(),
  payment: z.enum(["Cash", "Card", "QR"]),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(999),
        optionIds: z.array(z.number().int().positive()).max(10).default([]),
      }),
    )
    .min(1, "The cart is empty")
    .max(100),
  // Bill discount in RM, taken off the subtotal before service charge and SST.
  discount: money.default(0),
  discountReason: z.string().trim().max(100).optional(),
  // Cash handed over by the customer (Cash only), to work out the change.
  cashReceived: money.optional(),
})

const findByRequestId = async (conn, requestId) =>
  (await loadTransactions({ conn, where: "t.client_request_id = ?", params: [requestId], limit: 1 }))[0]

transactionsRouter.post("/sales", async (req, res) => {
  const body = parse(SaleBody, req.body)
  if (body.discount > 0 && !body.discountReason) throw badRequest("Give a reason for the discount.")
  // The same product with the same options is one line; different options are separate lines.
  const merged = new Map()
  for (const l of body.lines) {
    const optionIds = [...new Set(l.optionIds)].sort((a, b) => a - b)
    const key = `${l.productId}:${optionIds.join(",")}`
    const line = merged.get(key) ?? { productId: l.productId, optionIds, quantity: 0 }
    line.quantity += l.quantity
    merged.set(key, line)
  }
  const wanted = [...merged.values()]

  try {
    const result = await withTransaction(async (conn) => {
      const existing = await findByRequestId(conn, body.requestId)
      if (existing) return { sale: existing, replayed: true }

      // 1. Work out every stock item this sale uses: the products themselves (when they
      //    keep stock) or, for made-to-order products, their recipe's ingredients.
      const [all] = await conn.query(
        `SELECT p.id, p.name, p.is_active, p.track_stock, c.name AS category
         FROM products p JOIN categories c ON c.id = p.category_id`,
      )
      const products = new Map(all.map((p) => [p.id, p]))
      const [recipes] = await conn.query("SELECT product_id, ingredient_id, quantity_required, unit FROM recipes")
      const perProduct = new Map()
      for (const l of wanted) perProduct.set(l.productId, (perProduct.get(l.productId) ?? 0) + l.quantity)
      const needs = new Map() // stock item id -> { amount, unit, sold }
      for (const [id, quantity] of perProduct) {
        const p = products.get(id)
        if (!p || !p.is_active) throw badRequest(`Product ${id} is not available for sale`)
        if (p.category === INGREDIENTS) throw badRequest(`${p.name} is an ingredient and cannot be sold`)
        if (p.track_stock) {
          const before = needs.get(id)?.amount ?? 0
          needs.set(id, { amount: before + quantity, unit: "units", sold: true })
        } else {
          for (const [ingredientId, need] of expandRecipe(id, quantity, recipes, products)) {
            const before = needs.get(ingredientId)
            needs.set(ingredientId, { amount: round3((before?.amount ?? 0) + need.amount), unit: need.unit, sold: before?.sold })
          }
        }
      }

      // 2. Lock those rows (in id order, so two tills never deadlock) and check stock.
      //    Nothing else can sell the same last item until this sale is saved.
      const lockIds = [...new Set([...perProduct.keys(), ...needs.keys()])].sort((a, b) => a - b)
      const [locked] = await conn.query(
        "SELECT id, name, price, stock_quantity FROM products WHERE id IN (?) ORDER BY id FOR UPDATE",
        [lockIds],
      )
      const live = new Map(locked.map((p) => [p.id, p]))
      for (const [id, need] of needs) {
        const p = live.get(id)
        if (p.stock_quantity + 1e-9 < need.amount)
          throw conflict(
            need.sold
              ? `Only ${qty(p.stock_quantity)} × ${p.name} in stock`
              : `Not enough ${p.name} for this sale (need ${qty(need.amount)} ${need.unit}, have ${qty(p.stock_quantity)})`,
          )
      }

      // 3. Prices come from the database (with option surcharges), never from the browser.
      const optionIds = [...new Set(wanted.flatMap((l) => l.optionIds))]
      const [optionRows] = optionIds.length
        ? await conn.query("SELECT id, product_id, name, price_delta, is_active FROM product_options WHERE id IN (?)", [optionIds])
        : [[]]
      const options = new Map(optionRows.map((o) => [o.id, o]))
      const lines = wanted.map((l) => {
        const chosen = l.optionIds.map((id) => {
          const o = options.get(id)
          if (!o || !o.is_active || o.product_id !== l.productId)
            throw badRequest(`Option ${id} is not available for ${live.get(l.productId).name}`)
          return o
        })
        const unitPrice = round2(live.get(l.productId).price + chosen.reduce((s, o) => s + o.price_delta, 0))
        return { ...l, unitPrice, chosen }
      })

      const bill = saleBill(lines, await getSettings(conn), body.discount)
      const cashReceived = body.payment === "Cash" && body.cashReceived !== undefined ? round2(body.cashReceived) : null
      if (cashReceived !== null && cashReceived < bill.total)
        throw badRequest(`Cash received (RM ${cashReceived.toFixed(2)}) is less than the total (RM ${bill.total.toFixed(2)}).`)

      const number = await nextNumber(conn, "SL", 4)
      const [inserted] = await conn.query(
        `INSERT INTO transactions (user_id, transaction_number, client_request_id, transaction_type, status,
           subtotal, service_charge, tax, discount, discount_reason, rounding_adjustment, total, payment_method, cash_received)
         VALUES (?, ?, ?, 'SALE', 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id, number, body.requestId, bill.subtotal, bill.serviceCharge, bill.tax, bill.discount,
          bill.discount > 0 ? body.discountReason : null, bill.rounding, bill.total, body.payment, cashReceived,
        ],
      )
      for (const l of lines) {
        const [item] = await conn.query(
          "INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)",
          [inserted.insertId, l.productId, l.quantity, l.unitPrice, round2(l.unitPrice * l.quantity)],
        )
        for (const o of l.chosen)
          await conn.query(
            "INSERT INTO transaction_item_options (transaction_item_id, option_id, name, price_delta) VALUES (?, ?, ?, ?)",
            [item.insertId, o.id, o.name, o.price_delta],
          )
      }
      await recordMovements(
        conn,
        [...needs].sort(([a], [b]) => a - b).map(([productId, need]) => ({ productId, change: -need.amount })),
        "SALE",
        number,
        req.user.id,
      )
      return { sale: await loadOne(conn, inserted.insertId), replayed: false }
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

// ---------------------------------------------------------------- void a sale (admin)
const VoidBody = z.object({ reason: z.string().trim().min(1, "A reason is required to void a sale.").max(200) })

// Posted sales are never edited or deleted. Voiding marks the sale CANCELLED (kept for the
// audit trail and reports) and puts back exactly the stock it took, as VOID movements.
transactionsRouter.post("/sales/:number/void", requireAdmin, async (req, res) => {
  const { reason } = parse(VoidBody, req.body)
  const sale = await withTransaction(async (conn) => {
    const [[tx]] = await conn.query(
      "SELECT id, transaction_type, status FROM transactions WHERE transaction_number = ? FOR UPDATE",
      [req.params.number],
    )
    if (!tx || tx.transaction_type !== "SALE") throw notFound("Sale not found")
    if (tx.status !== "POSTED") throw conflict(`Only a posted sale can be voided (this one is ${tx.status}).`)
    const [moves] = await conn.query(
      "SELECT product_id, quantity_change FROM stock_movements WHERE reference = ? AND movement_type = 'SALE' ORDER BY product_id",
      [req.params.number],
    )
    await recordMovements(
      conn,
      moves.map((m) => ({ productId: m.product_id, change: -m.quantity_change })),
      "VOID",
      req.params.number,
      req.user.id,
    )
    await conn.query(
      "UPDATE transactions SET status = 'CANCELLED', voided_by = ?, voided_at = NOW(), void_reason = ? WHERE id = ?",
      [req.user.id, reason, tx.id],
    )
    return loadOne(conn, tx.id)
  })
  res.json({ transaction: sale })
})

// ---------------------------------------------------------------- supplier purchase (admin)
const fourDecimals = (n) => Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-6
const PurchaseBody = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(1_000_000),
  unitCost: z.number().positive().max(100_000).refine(fourDecimals, "Unit cost can have at most 4 decimal places"),
  status: z.enum(["DRAFT", "POSTED"]).default("POSTED"),
})

/** Adds a posted purchase line's stock and makes its cost the product's latest cost. */
async function receive(conn, item, reference, userId) {
  await recordMovements(conn, [{ productId: item.productId, change: item.quantity }], "PURCHASE", reference, userId)
  // Recipe costing uses the latest posted purchase cost.
  await conn.query("UPDATE products SET cost_price = ? WHERE id = ?", [item.unitCost, item.productId])
}

async function checkPurchasable(conn, productId) {
  const [rows] = await conn.query("SELECT id, name, is_active, track_stock FROM products WHERE id = ? FOR UPDATE", [productId])
  const p = rows[0]
  if (!p || !p.is_active) throw badRequest("Product not found or inactive")
  if (!p.track_stock) throw badRequest(`${p.name} is made to order and keeps no stock. Buy its ingredients instead.`)
}

transactionsRouter.post("/purchases", requireAdmin, async (req, res) => {
  const body = parse(PurchaseBody, req.body)
  const purchase = await withTransaction(async (conn) => {
    await checkPurchasable(conn, body.productId)
    const bill = purchaseBill([{ quantity: body.quantity, unitPrice: body.unitCost }])
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
    if (body.status === "POSTED") await receive(conn, body, number, req.user.id)
    return loadOne(conn, inserted.insertId)
  })
  res.status(201).json({ transaction: purchase })
})

/** Locks a DRAFT purchase by number, or explains why it can't be changed. */
async function lockDraft(conn, number) {
  const [[tx]] = await conn.query(
    "SELECT id, transaction_type, status FROM transactions WHERE transaction_number = ? FOR UPDATE",
    [number],
  )
  if (!tx || tx.transaction_type !== "PURCHASE") throw notFound("Purchase not found")
  if (tx.status !== "DRAFT") throw conflict(`Only a draft purchase can be changed (this one is ${tx.status}).`)
  return tx
}

// Post a draft: the delivery has arrived, so its stock is added now.
transactionsRouter.post("/purchases/:number/post", requireAdmin, async (req, res) => {
  const purchase = await withTransaction(async (conn) => {
    const tx = await lockDraft(conn, req.params.number)
    const [items] = await conn.query(
      "SELECT product_id AS productId, quantity, unit_price AS unitCost FROM transaction_items WHERE transaction_id = ?",
      [tx.id],
    )
    for (const item of items) {
      await checkPurchasable(conn, item.productId)
      await receive(conn, item, req.params.number, req.user.id)
    }
    await conn.query("UPDATE transactions SET status = 'POSTED' WHERE id = ?", [tx.id])
    return loadOne(conn, tx.id)
  })
  res.json({ transaction: purchase })
})

const CancelBody = z.object({ reason: z.string().trim().max(200).optional() })

// Cancel a draft that will never arrive. No stock was added, so none is taken away.
transactionsRouter.post("/purchases/:number/cancel", requireAdmin, async (req, res) => {
  const { reason } = parse(CancelBody, req.body ?? {})
  const purchase = await withTransaction(async (conn) => {
    const tx = await lockDraft(conn, req.params.number)
    await conn.query(
      "UPDATE transactions SET status = 'CANCELLED', voided_by = ?, voided_at = NOW(), void_reason = ? WHERE id = ?",
      [req.user.id, reason || "Draft cancelled", tx.id],
    )
    return loadOne(conn, tx.id)
  })
  res.json({ transaction: purchase })
})
