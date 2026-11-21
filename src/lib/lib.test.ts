// Front-end unit tests (no extra packages): `npm test` runs them with Node's built-in
// test runner, which can load TypeScript directly.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { changeDue, saleBill } from "./billing.ts"
import { addToCart, lineKey, roomFor, unitPriceOf } from "./cart.ts"
import { myDateTime, qty, ratePct, signedMoney, unitMoney } from "./format.ts"
import type { Product } from "./types.ts"

const rates = { serviceChargeRate: 0.1, sstRate: 0.06 }

describe("saleBill (must match server/src/billing.js)", () => {
  test("seeded receipts reproduce", () => {
    assert.deepEqual(saleBill([{ unitPrice: 18, quantity: 2 }, { unitPrice: 6, quantity: 1 }], rates), {
      subtotal: 42, discount: 0, serviceCharge: 4.2, tax: 2.52, rounding: -0.02, total: 48.7,
    })
  })
  test("discount comes off before service charge and SST, and is capped at the subtotal", () => {
    assert.deepEqual(saleBill([{ unitPrice: 11, quantity: 1 }], rates, 1), {
      subtotal: 11, discount: 1, serviceCharge: 1, tax: 0.6, rounding: 0, total: 11.6,
    })
    assert.equal(saleBill([{ unitPrice: 5, quantity: 1 }], rates, 50).total, 0)
  })
  test("cash change", () => {
    assert.equal(changeDue(11.6, 20), 8.4)
    assert.equal(changeDue(11.6, 11.6), 0)
    assert.equal(changeDue(11.6, 10), null)
  })
})

const latte: Product = {
  id: 1, sku: "CAF-101", name: "Cafe Latte", category: "Coffee", price: 9.5, costPrice: 0, stock: 0, reorder: 0,
  trackStock: false, image: null, isActive: true, updated: "", options: [{ id: 7, name: "Large", priceDelta: 2 }, { id: 8, name: "Oat", priceDelta: 1.5 }],
}
const loaf: Product = { ...latte, id: 2, name: "Loaf", trackStock: true, stock: 3, options: [] }

describe("cart", () => {
  test("options make separate lines and add to the price", () => {
    let cart = addToCart([], latte, [8, 7])
    cart = addToCart(cart, latte, [7, 8])
    cart = addToCart(cart, latte, [])
    assert.equal(cart.length, 2)
    assert.equal(cart[0].quantity, 2)
    assert.equal(lineKey(1, [8, 7]), "1:7,8")
    assert.equal(unitPriceOf(latte, [7, 8]), 13)
  })
  test("stocked items stop at the shelf count; made-to-order items do not", () => {
    let cart = addToCart([], loaf, [], 5)
    assert.equal(cart[0].quantity, 3)
    assert.equal(roomFor(loaf, cart), 0)
    cart = addToCart(cart, loaf, [])
    assert.equal(cart[0].quantity, 3)
    assert.equal(roomFor(latte, []), 999)
  })
})

describe("formatting", () => {
  test("numbers and money", () => {
    assert.equal(qty(18.5), "18.5")
    assert.equal(qty(0.2 + 0.1), "0.3")
    assert.equal(unitMoney(0.065), "RM 0.065")
    assert.equal(signedMoney(-0.02), "-RM 0.02")
    assert.equal(ratePct(0.06), "6")
  })
  test("times are shown in Malaysia time whatever the device timezone", () => {
    assert.equal(myDateTime(new Date("2026-06-18T02:31:00Z")), "18 Jun 2026, 10:31")
  })
})
