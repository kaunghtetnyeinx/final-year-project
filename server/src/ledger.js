// Shared helpers for anything that changes stock or reads transactions.
import { pool } from "./db.js"
import { conflict } from "./errors.js"

export const round3 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000
/** "18.5" / "2" – quantities without trailing zeros. */
const qty = (value) => String(round3(value))

/**
 * Apply stock changes and write one stock_movements row per line, inside the caller's
 * database transaction. Stock can never go below zero.
 * @param {{productId:number, change:number}[]} lines
 */
export async function recordMovements(conn, lines, type, reference, userId) {
  for (const { productId, change } of lines) {
    const amount = round3(change)
    if (amount === 0) continue
    const [result] = await conn.query(
      "UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND stock_quantity + ? >= 0",
      [amount, productId, amount],
    )
    if (result.affectedRows !== 1) {
      const [[p]] = await conn.query("SELECT name, stock_quantity FROM products WHERE id = ?", [productId])
      throw conflict(
        p ? `Not enough ${p.name} in stock (need ${qty(-amount)}, have ${qty(p.stock_quantity)})` : `Product ${productId} not found`,
      )
    }
    await conn.query(
      "INSERT INTO stock_movements (product_id, movement_type, quantity_change, reference, performed_by) VALUES (?, ?, ?, ?, ?)",
      [productId, type, amount, reference, userId],
    )
  }
}

/**
 * Stock items used up to make `quantity` of `productId`, from its recipe.
 * A component that is itself made to order (no stock of its own) is expanded through its
 * own recipe. Returns Map(ingredientId -> { amount, unit }).
 * @param recipes rows of `recipes` (product_id, ingredient_id, quantity_required, unit)
 * @param productsById Map(id -> { id, track_stock })
 */
export function expandRecipe(productId, quantity, recipes, productsById, needs = new Map(), path = []) {
  if (path.includes(productId)) return needs // circular recipes are rejected on save; be safe anyway
  for (const r of recipes) {
    if (r.product_id !== productId) continue
    const ingredient = productsById.get(r.ingredient_id)
    if (!ingredient) continue
    const amount = quantity * r.quantity_required
    if (ingredient.track_stock) {
      const before = needs.get(ingredient.id)?.amount ?? 0
      needs.set(ingredient.id, { amount: round3(before + amount), unit: r.unit })
    } else {
      expandRecipe(ingredient.id, amount, recipes, productsById, needs, [...path, productId])
    }
  }
  return needs
}

/** Next document number: SL-1048, PO-0040 ... Locks the latest row so two tills never get the same number. */
export async function nextNumber(conn, prefix, pad) {
  const [rows] = await conn.query(
    `SELECT transaction_number FROM transactions WHERE transaction_number LIKE ?
     ORDER BY CAST(SUBSTRING(transaction_number, ?) AS UNSIGNED) DESC LIMIT 1 FOR UPDATE`,
    [`${prefix}-%`, prefix.length + 2],
  )
  const last = rows[0] ? Number(rows[0].transaction_number.slice(prefix.length + 1)) : 0
  return `${prefix}-${String(last + 1).padStart(pad, "0")}`
}

/** Transactions in the same shape the front end uses (Transaction in src/lib/types.ts). */
export async function loadTransactions({ where = "1=1", params = [], limit = 200, conn = pool } = {}) {
  const [headers] = await conn.query(
    `SELECT t.id, t.transaction_number, t.transaction_type, t.status, t.created_at, t.payment_method,
            t.subtotal, t.discount, t.discount_reason, t.service_charge, t.tax, t.rounding_adjustment, t.total,
            t.cash_received, t.voided_at, t.void_reason, u.name AS by_name, v.name AS voided_by_name
     FROM transactions t JOIN users u ON u.id = t.user_id LEFT JOIN users v ON v.id = t.voided_by
     WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
    [...params, limit],
  )
  if (!headers.length) return []
  const [items] = await conn.query(
    `SELECT i.id, i.transaction_id, i.quantity, i.unit_price, p.id AS product_id, p.name, p.sku
     FROM transaction_items i JOIN products p ON p.id = i.product_id
     WHERE i.transaction_id IN (?) ORDER BY i.id`,
    [headers.map((h) => h.id)],
  )
  const [options] = items.length
    ? await conn.query(
        "SELECT transaction_item_id, name, price_delta FROM transaction_item_options WHERE transaction_item_id IN (?) ORDER BY id",
        [items.map((i) => i.id)],
      )
    : [[]]
  return headers.map((h) => ({
    number: h.transaction_number,
    type: h.transaction_type,
    status: h.status,
    at: h.created_at.toISOString(),
    by: h.by_name,
    payment: h.payment_method,
    lines: items
      .filter((i) => i.transaction_id === h.id)
      .map((i) => ({
        productId: i.product_id,
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        options: options
          .filter((o) => o.transaction_item_id === i.id)
          .map((o) => ({ name: o.name, priceDelta: o.price_delta })),
      })),
    subtotal: h.subtotal,
    discount: h.discount,
    discountReason: h.discount_reason,
    serviceCharge: h.service_charge,
    tax: h.tax,
    rounding: h.rounding_adjustment,
    total: h.total,
    cashReceived: h.cash_received,
    voidedAt: h.voided_at ? h.voided_at.toISOString() : null,
    voidedBy: h.voided_by_name,
    voidReason: h.void_reason,
  }))
}

export const isDuplicate = (error) => error?.code === "ER_DUP_ENTRY"
