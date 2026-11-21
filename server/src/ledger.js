// Shared helpers for anything that changes stock or reads transactions.
import { pool } from "./db.js"
import { conflict } from "./errors.js"

/**
 * Apply stock changes and write one stock_movements row per line, inside the caller's
 * database transaction. Stock can never go below zero.
 * @param {{productId:number, change:number}[]} lines
 */
export async function recordMovements(conn, lines, type, reference, userId) {
  for (const { productId, change } of lines) {
    const [result] = await conn.query(
      "UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND stock_quantity + ? >= 0",
      [change, productId, change],
    )
    if (result.affectedRows !== 1) throw conflict(`Not enough stock for product ${productId}`)
    await conn.query(
      "INSERT INTO stock_movements (product_id, movement_type, quantity_change, reference, performed_by) VALUES (?, ?, ?, ?, ?)",
      [productId, type, change, reference, userId],
    )
  }
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

/** Transactions in the same shape the front end already uses (Transaction in App.tsx). */
export async function loadTransactions({ where = "1=1", params = [], limit = 200, conn = pool } = {}) {
  const [headers] = await conn.query(
    `SELECT t.id, t.transaction_number, t.transaction_type, t.status, t.created_at, t.payment_method,
            t.subtotal, t.service_charge, t.tax, t.rounding_adjustment, t.total, u.name AS by_name
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
    [...params, limit],
  )
  if (!headers.length) return []
  const [items] = await conn.query(
    `SELECT i.transaction_id, i.quantity, i.unit_price, p.id AS product_id, p.name, p.sku
     FROM transaction_items i JOIN products p ON p.id = i.product_id
     WHERE i.transaction_id IN (?) ORDER BY i.id`,
    [headers.map((h) => h.id)],
  )
  return headers.map((h) => ({
    number: h.transaction_number,
    type: h.transaction_type,
    status: h.status,
    at: h.created_at.toISOString(),
    by: h.by_name,
    payment: h.payment_method,
    lines: items
      .filter((i) => i.transaction_id === h.id)
      .map((i) => ({ productId: i.product_id, name: i.name, sku: i.sku, quantity: i.quantity, unitPrice: i.unit_price })),
    subtotal: h.subtotal,
    serviceCharge: h.service_charge,
    tax: h.tax,
    rounding: h.rounding_adjustment,
    total: h.total,
  }))
}

export const isDuplicate = (error) => error?.code === "ER_DUP_ENTRY"
