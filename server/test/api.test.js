// Integration tests. Needs a FRESHLY seeded database (import project_poin_seeded.sql first)
// and .env.test pointing at it. Run: npm test
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, test } from "node:test"
import { createApp } from "../src/app.js"
import { saleBill } from "../src/billing.js"
import { pool } from "../src/db.js"
import { migrate } from "../src/migrate.js"

let server
let admin, staff
let base
const PASSWORD = "Juniper@2026"

before(async () => {
  // The seed SQL is the starting point; migrations bring it to the current schema.
  await migrate(pool, () => {})
  server = createApp().listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  base = `http://127.0.0.1:${server.address().port}/api`
  admin = await login("kaunghtet@juniper.store")
  staff = await login("yadanar@juniper.store")
})
after(async () => {
  server.close()
  await pool.end()
})

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") }
}

async function login(email, password = PASSWORD) {
  const res = await call("POST", "/auth/login", { body: { email, password } })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.setCookie.split(";")[0]
}

const stockOf = async (id) => (await pool.query("SELECT stock_quantity FROM products WHERE id = ?", [id]))[0][0].stock_quantity


describe("billing maths (same as the prototype)", () => {
  const rates = { serviceChargeRate: 0.1, sstRate: 0.06 }
  test("seeded sales reproduce", () => {
    assert.deepEqual(saleBill([{ unitPrice: 18, quantity: 2 }, { unitPrice: 6, quantity: 1 }], rates),
      { subtotal: 42, discount: 0, serviceCharge: 4.2, tax: 2.52, rounding: -0.02, total: 48.7 })
    assert.deepEqual(saleBill([{ unitPrice: 12, quantity: 2 }, { unitPrice: 11, quantity: 1 }, { unitPrice: 6.5, quantity: 2 }], rates),
      { subtotal: 48, discount: 0, serviceCharge: 4.8, tax: 2.88, rounding: 0.02, total: 55.7 })
  })
})

describe("auth and roles", () => {
  test("health is public", async () => {
    assert.deepEqual((await call("GET", "/health")).body, { ok: true })
  })
  test("wrong password and unknown email look the same", async () => {
    const a = await call("POST", "/auth/login", { body: { email: "kaunghtet@juniper.store", password: "nope" } })
    const b = await call("POST", "/auth/login", { body: { email: "nobody@x.com", password: "nope" } })
    assert.equal(a.status, 401)
    assert.deepEqual(a.body, b.body)
  })
  test("session cookie is httpOnly + SameSite=Strict", async () => {
    const res = await call("POST", "/auth/login", { body: { email: "zinkooo@juniper.store", password: PASSWORD } })
    assert.match(res.setCookie, /HttpOnly/)
    assert.match(res.setCookie, /SameSite=Strict/)
  })
  test("no cookie -> 401", async () => {
    assert.equal((await call("GET", "/products")).status, 401)
  })
  test("staff cannot reach admin routes", async () => {
    for (const [m, p] of [["GET", "/recipes"], ["GET", "/users"], ["GET", "/stock-movements"], ["GET", "/forecasts"],
      ["POST", "/purchases"], ["POST", "/inventory/adjustments"], ["PATCH", "/products/1"], ["POST", "/products"]]) {
      assert.equal((await call(m, p, { cookie: staff, body: m === "GET" ? undefined : {} })).status, 403, `${m} ${p}`)
    }
  })
  test("me returns the signed-in user", async () => {
    assert.equal((await call("GET", "/auth/me", { cookie: staff })).body.user.role, "STAFF")
  })
})

describe("sales", () => {
  test("posts a sale with server-side totals, deducts stock, writes movements", async () => {
    const before1 = await stockOf(1)
    const before7 = await stockOf(7)
    const res = await call("POST", "/sales", {
      cookie: staff,
      // unitPrice/total sent by the browser must be ignored
      body: { requestId: randomUUID(), payment: "Cash", total: 0.01, lines: [{ productId: 1, quantity: 2, unitPrice: 0.01 }, { productId: 7, quantity: 1 }] },
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const sale = res.body.sale
    assert.equal(sale.number, "SL-1048")
    assert.equal(sale.total, 48.7)
    assert.equal(sale.rounding, -0.02)
    assert.equal(sale.by, "Yadanar Theint")
    assert.equal(await stockOf(1), before1 - 2)
    assert.equal(await stockOf(7), before7 - 1)
    const [moves] = await pool.query("SELECT product_id, quantity_change FROM stock_movements WHERE reference = 'SL-1048' ORDER BY product_id")
    assert.deepEqual(moves.map((m) => [m.product_id, m.quantity_change]), [[1, -2], [7, -1]])
  })

  test("same requestId twice (double-tap) = one sale, stock deducted once", async () => {
    const requestId = randomUUID()
    const body = { requestId, payment: "Card", lines: [{ productId: 3, quantity: 1 }] }
    const start = await stockOf(3)
    const [a, b] = await Promise.all([call("POST", "/sales", { cookie: staff, body }), call("POST", "/sales", { cookie: staff, body })])
    assert.deepEqual([a.status, b.status].sort(), [200, 201])
    assert.equal(a.body.sale.number, b.body.sale.number)
    const again = await call("POST", "/sales", { cookie: staff, body })
    assert.equal(again.status, 200)
    assert.equal(again.body.replayed, true)
    assert.equal(await stockOf(3), start - 1)
  })

  test("concurrent tills cannot oversell", async () => {
    // Matcha Tin (id 8) has 5 in stock. Three tills each sell 2 at the same time.
    const sells = Array.from({ length: 3 }, () =>
      call("POST", "/sales", { cookie: staff, body: { requestId: randomUUID(), payment: "QR", lines: [{ productId: 8, quantity: 2 }] } }))
    const results = await Promise.all(sells)
    const ok = results.filter((r) => r.status === 201)
    assert.equal(ok.length, 2)
    assert.equal(results.filter((r) => r.status === 409).length, 1)
    assert.equal(new Set(ok.map((r) => r.body.sale.number)).size, 2, "sale numbers are unique")
    assert.equal(await stockOf(8), 1)
  })

  test("cannot sell more than stock, or sell an ingredient", async () => {
    const tooMany = await call("POST", "/sales", { cookie: staff, body: { requestId: randomUUID(), payment: "Cash", lines: [{ productId: 5, quantity: 999 }] } })
    assert.equal(tooMany.status, 409)
    const ingredient = await call("POST", "/sales", { cookie: staff, body: { requestId: randomUUID(), payment: "Cash", lines: [{ productId: 101, quantity: 1 }] } })
    assert.equal(ingredient.status, 400)
    const empty = await call("POST", "/sales", { cookie: staff, body: { requestId: randomUUID(), payment: "Cash", lines: [] } })
    assert.equal(empty.status, 400)
  })

  test("transactions list includes the new sale first", async () => {
    const res = await call("GET", "/transactions?type=SALE&limit=1", { cookie: staff })
    assert.match(res.body.transactions[0].number, /^SL-10\d\d$/)
  })
})

describe("purchases and inventory (admin)", () => {
  test("posted purchase adds stock, updates cost, numbers PO-0040", async () => {
    const start = await stockOf(103)
    const res = await call("POST", "/purchases", { cookie: admin, body: { productId: 103, quantity: 5000, unitCost: 0.0042 } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.transaction.number, "PO-0040")
    assert.equal(res.body.transaction.total, 21)
    assert.equal(await stockOf(103), start + 5000)
    const [[p]] = await pool.query("SELECT cost_price FROM products WHERE id = 103")
    assert.equal(p.cost_price, 0.0042)
  })
  test("draft purchase does not touch stock", async () => {
    const start = await stockOf(4)
    const res = await call("POST", "/purchases", { cookie: admin, body: { productId: 4, quantity: 10, unitCost: 6, status: "DRAFT" } })
    assert.equal(res.body.transaction.status, "DRAFT")
    assert.equal(await stockOf(4), start)
  })
  test("adjustment needs a reason and cannot go below zero", async () => {
    assert.equal((await call("POST", "/inventory/adjustments", { cookie: admin, body: { productId: 5, change: -1, reason: "" } })).status, 400)
    assert.equal((await call("POST", "/inventory/adjustments", { cookie: admin, body: { productId: 5, change: -999, reason: "x" } })).status, 409)
    const start = await stockOf(5)
    const ok = await call("POST", "/inventory/adjustments", { cookie: admin, body: { productId: 5, change: -1, reason: "Damaged unit" } })
    assert.equal(ok.status, 201)
    assert.equal(await stockOf(5), start - 1)
    const moves = await call("GET", "/stock-movements?limit=1", { cookie: admin })
    assert.equal(moves.body.movements[0].source, "Damaged unit")
  })
  test("admin can change a price; staff product list hides inactive items", async () => {
    assert.equal((await call("PATCH", "/products/5", { cookie: admin, body: { price: 7.2 } })).body.product.price, 7.2)
    await call("PATCH", "/products/6", { cookie: admin, body: { isActive: false } })
    const list = await call("GET", "/products", { cookie: staff })
    assert.ok(!list.body.products.some((p) => p.id === 6))
    await call("PATCH", "/products/6", { cookie: admin, body: { isActive: true } })
  })
  test("duplicate SKU rejected", async () => {
    const res = await call("POST", "/products", { cookie: admin, body: { name: "Copy", sku: "caf-001", category: "Coffee", price: 5 } })
    assert.equal(res.status, 409)
  })
})

describe("recipes (admin)", () => {
  test("rules: self, circular, unit, duplicate, decimals", async () => {
    const post = (body) => call("POST", "/recipes", { cookie: admin, body })
    assert.equal((await post({ productId: 2, ingredientId: 2, quantityRequired: 1, unit: "piece" })).status, 400)
    // Croissant (2) already uses flour (103): flour cannot use croissant.
    assert.match((await post({ productId: 103, ingredientId: 2, quantityRequired: 1, unit: "piece" })).body.error, /circular/)
    assert.match((await post({ productId: 4, ingredientId: 103, quantityRequired: 1, unit: "kg" })).body.error, /same base unit/)
    assert.equal((await post({ productId: 2, ingredientId: 103, quantityRequired: 1, unit: "g" })).status, 409)
    assert.equal((await post({ productId: 4, ingredientId: 104, quantityRequired: 1.2345, unit: "g" })).status, 400)
  })
  test("create, edit, delete a recipe line", async () => {
    const created = await call("POST", "/recipes", { cookie: admin, body: { productId: 4, ingredientId: 104, quantityRequired: 15, unit: "g", notes: "Honey sub" } })
    assert.equal(created.status, 201)
    const id = created.body.recipe.recipeId
    const edited = await call("PATCH", `/recipes/${id}`, { cookie: admin, body: { quantityRequired: 12.5 } })
    assert.equal(edited.body.recipe.quantityRequired, 12.5)
    assert.equal((await call("DELETE", `/recipes/${id}`, { cookie: admin })).status, 204)
  })
  test("target margin setting", async () => {
    const res = await call("PUT", "/settings/target-margin", { cookie: admin, body: { value: 0.65 } })
    assert.equal(res.body.settings.targetMargin, 0.65)
    await call("PUT", "/settings/target-margin", { cookie: admin, body: { value: 0.6 } })
  })
  test("forecasts return the seeded 7-day demand", async () => {
    const res = await call("GET", "/forecasts", { cookie: admin })
    assert.equal(res.body.forecasts.length, 5)
    assert.equal(res.body.forecasts.find((f) => f.sku === "CAF-001").predicted, 31.4)
  })
})

describe("users (admin)", () => {
  test("create user, sign in, deactivate -> access revoked immediately", async () => {
    const created = await call("POST", "/users", { cookie: admin, body: { name: "New Barista", email: "Barista@Juniper.store", password: "TempPass2026" } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.user.email, "barista@juniper.store")
    assert.equal((await call("POST", "/users", { cookie: admin, body: { name: "x", email: "barista@juniper.store", password: "TempPass2026" } })).status, 409)
    const cookie = await login("barista@juniper.store", "TempPass2026")
    assert.equal((await call("GET", "/products", { cookie })).status, 200)
    await call("PATCH", `/users/${created.body.user.id}`, { cookie: admin, body: { isActive: false } })
    assert.equal((await call("GET", "/products", { cookie })).status, 401)
  })
  test("weak password rejected; admin cannot deactivate self", async () => {
    assert.equal((await call("POST", "/users", { cookie: admin, body: { name: "x", email: "y@z.com", password: "short" } })).status, 400)
    assert.equal((await call("PATCH", "/users/1", { cookie: admin, body: { isActive: false } })).status, 400)
  })
})

describe("passwords", () => {
  test("seeded accounts must choose a new password", async () => {
    assert.equal((await call("GET", "/auth/me", { cookie: admin })).body.user.mustChangePassword, true)
  })
  test("admin-set password is temporary; user changes their own", async () => {
    const created = await call("POST", "/users", { cookie: admin, body: { name: "Temp User", email: "pw@juniper.store", password: "TempPass2026" } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.user.mustChangePassword, true)
    const signIn = await call("POST", "/auth/login", { body: { email: "pw@juniper.store", password: "TempPass2026" } })
    assert.equal(signIn.body.user.mustChangePassword, true)
    const cookie = signIn.setCookie.split(";")[0]
    const change = (body) => call("POST", "/auth/change-password", { cookie, body })
    assert.equal((await change({ currentPassword: "wrong-one-1", newPassword: "MyOwnPass2026" })).status, 401)
    assert.equal((await change({ currentPassword: "TempPass2026", newPassword: "short" })).status, 400)
    assert.equal((await change({ currentPassword: "TempPass2026", newPassword: "TempPass2026" })).status, 400)
    const ok = await change({ currentPassword: "TempPass2026", newPassword: "MyOwnPass2026" })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.user.mustChangePassword, false)
    assert.equal((await call("GET", "/auth/me", { cookie })).body.user.mustChangePassword, false)
    await login("pw@juniper.store", "MyOwnPass2026")
  })
})

describe("discounts, cash and options", () => {
  test("discount comes off before service charge and SST; cash change recorded", async () => {
    const res = await call("POST", "/sales", {
      cookie: staff,
      body: { requestId: randomUUID(), payment: "Cash", discount: 1, discountReason: "Loyalty", cashReceived: 20, lines: [{ productId: 4, quantity: 1 }] },
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const sale = res.body.sale
    assert.deepEqual([sale.subtotal, sale.discount, sale.serviceCharge, sale.tax, sale.total], [11, 1, 1, 0.6, 11.6])
    assert.equal(sale.discountReason, "Loyalty")
    assert.equal(sale.cashReceived, 20)
  })
  test("discount needs a reason; cash cannot be short", async () => {
    const sell = (extra) => call("POST", "/sales", { cookie: staff, body: { requestId: randomUUID(), payment: "Cash", lines: [{ productId: 4, quantity: 1 }], ...extra } })
    assert.equal((await sell({ discount: 2 })).status, 400)
    assert.match((await sell({ cashReceived: 1 })).body.error, /less than the total/)
  })
})

describe("made-to-order products, recipes and voids", () => {
  let latte, large
  test("admin adds a made-to-order drink with options", async () => {
    const created = await call("POST", "/products", { cookie: admin, body: { name: "Cafe Latte", sku: "CAF-101", category: "Coffee", price: 9.5, trackStock: false } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    latte = created.body.product
    assert.equal(latte.trackStock, false)
    const withOptions = await call("PUT", `/products/${latte.id}/options`, {
      cookie: admin,
      body: { options: [{ name: "Large", priceDelta: 2 }, { name: "Oat milk", priceDelta: 1.5 }] },
    })
    assert.equal(withOptions.status, 200, JSON.stringify(withOptions.body))
    large = withOptions.body.product.options.find((o) => o.name === "Large")
    assert.equal(withOptions.body.product.options.length, 2)
    const recipe = await call("POST", "/recipes", { cookie: admin, body: { productId: latte.id, ingredientId: 101, quantityRequired: 18, unit: "g" } })
    assert.equal(recipe.status, 201, JSON.stringify(recipe.body))
  })

  let saleNumber
  test("selling it uses up ingredients, not its own stock; options add to the price", async () => {
    const beans = await stockOf(101)
    const res = await call("POST", "/sales", {
      cookie: staff,
      body: { requestId: randomUUID(), payment: "Card", lines: [{ productId: latte.id, quantity: 2, optionIds: [large.id] }, { productId: latte.id, quantity: 1 }] },
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    saleNumber = res.body.sale.number
    const lines = res.body.sale.lines
    assert.equal(lines.length, 2, "different options are separate lines")
    assert.equal(lines.find((l) => l.options.length).unitPrice, 11.5)
    assert.deepEqual(lines.find((l) => l.options.length).options, [{ name: "Large", priceDelta: 2 }])
    assert.equal(res.body.sale.subtotal, 32.5)
    assert.equal(await stockOf(101), beans - 54)
    assert.equal(await stockOf(latte.id), 0)
    const [moves] = await pool.query("SELECT product_id, quantity_change FROM stock_movements WHERE reference = ?", [saleNumber])
    assert.deepEqual(moves.map((m) => [m.product_id, m.quantity_change]), [[101, -54]])
  })

  test("not enough of an ingredient blocks the sale; wrong option is rejected", async () => {
    const big = await call("POST", "/sales", { cookie: staff, body: { requestId: randomUUID(), payment: "Cash", lines: [{ productId: latte.id, quantity: 999 }] } })
    assert.equal(big.status, 409)
    assert.match(big.body.error, /Not enough Arabica Coffee Beans/)
    const wrong = await call("POST", "/sales", { cookie: staff, body: { requestId: randomUUID(), payment: "Cash", lines: [{ productId: 1, quantity: 1, optionIds: [large.id] }] } })
    assert.equal(wrong.status, 400)
  })

  test("made-to-order items cannot be purchased or adjusted", async () => {
    assert.equal((await call("POST", "/purchases", { cookie: admin, body: { productId: latte.id, quantity: 1, unitCost: 1 } })).status, 400)
    assert.equal((await call("POST", "/inventory/adjustments", { cookie: admin, body: { productId: latte.id, change: 1, reason: "x" } })).status, 400)
  })

  test("voiding a sale puts the stock back and keeps the record", async () => {
    assert.equal((await call("POST", `/sales/${saleNumber}/void`, { cookie: staff, body: { reason: "Wrong order" } })).status, 403)
    assert.equal((await call("POST", `/sales/${saleNumber}/void`, { cookie: admin, body: { reason: "" } })).status, 400)
    const beans = await stockOf(101)
    const res = await call("POST", `/sales/${saleNumber}/void`, { cookie: admin, body: { reason: "Wrong order" } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.transaction.status, "CANCELLED")
    assert.equal(res.body.transaction.voidReason, "Wrong order")
    assert.equal(res.body.transaction.voidedBy, "Kaung Htet Nyein")
    assert.equal(await stockOf(101), beans + 54)
    const [moves] = await pool.query("SELECT movement_type, quantity_change FROM stock_movements WHERE reference = ? AND movement_type = 'VOID'", [saleNumber])
    assert.deepEqual(moves.map((m) => m.quantity_change), [54])
    assert.equal((await call("POST", `/sales/${saleNumber}/void`, { cookie: admin, body: { reason: "again" } })).status, 409)
  })
})

describe("production, drafts and decimals (admin)", () => {
  test("a batch adds finished stock and uses up the recipe", async () => {
    const [croissant, flour, eggs] = [await stockOf(2), await stockOf(103), await stockOf(105)]
    const res = await call("POST", "/inventory/production", { cookie: admin, body: { productId: 2, quantity: 10 } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(await stockOf(2), croissant + 10)
    assert.equal(await stockOf(103), flour - 600)
    assert.equal(await stockOf(105), eggs - 2)
    assert.equal((await call("POST", "/inventory/production", { cookie: admin, body: { productId: 4, quantity: 1 } })).status, 400, "no recipe")
  })
  test("ingredient adjustments can use decimals", async () => {
    const start = await stockOf(103)
    const res = await call("POST", "/inventory/adjustments", { cookie: admin, body: { productId: 103, change: -12.5, reason: "Spilled" } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(await stockOf(103), start - 12.5)
  })
  test("post a draft purchase; cancel another", async () => {
    const start = await stockOf(1)
    const posted = await call("POST", "/purchases/PO-0039/post", { cookie: admin })
    assert.equal(posted.status, 200, JSON.stringify(posted.body))
    assert.equal(posted.body.transaction.status, "POSTED")
    assert.equal(await stockOf(1), start + 12)
    assert.equal((await call("POST", "/purchases/PO-0039/post", { cookie: admin })).status, 409)
    const draft = await call("POST", "/purchases", { cookie: admin, body: { productId: 4, quantity: 3, unitCost: 5, status: "DRAFT" } })
    const cancelled = await call("POST", `/purchases/${draft.body.transaction.number}/cancel`, { cookie: admin, body: { reason: "Supplier out of stock" } })
    assert.equal(cancelled.body.transaction.status, "CANCELLED")
    assert.equal((await call("POST", "/purchases/SL-1045/cancel", { cookie: admin })).status, 404)
  })
})

describe("categories, photos, reports, forecasts", () => {
  test("admin adds and renames a category; Ingredients is protected", async () => {
    const created = await call("POST", "/categories", { cookie: admin, body: { name: "Desserts" } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal((await call("POST", "/categories", { cookie: admin, body: { name: "desserts" } })).status, 409)
    assert.equal((await call("PATCH", `/categories/${created.body.category.id}`, { cookie: admin, body: { name: "Sweets" } })).status, 200)
    const [[ingredients]] = await pool.query("SELECT id FROM categories WHERE name = 'Ingredients'")
    assert.equal((await call("PATCH", `/categories/${ingredients.id}`, { cookie: admin, body: { name: "Raw" } })).status, 400)
    assert.equal((await call("POST", "/categories", { cookie: staff, body: { name: "X" } })).status, 403)
  })
  test("photo upload checks the file type and serves the image", async () => {
    const upload = (bytes) =>
      fetch(`${base}/products/1/image`, { method: "POST", headers: { cookie: admin, "content-type": "image/png" }, body: bytes })
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
    const res = await upload(png)
    assert.equal(res.status, 201)
    const { product } = await res.json()
    assert.match(product.image, /^\/api\/uploads\/[a-f0-9]{32}\.png$/)
    const served = await fetch(base.replace(/\/api$/, "") + product.image)
    assert.equal(served.status, 200)
    assert.equal((await upload(Buffer.from("not an image at all"))).status, 400)
  })
  test("transactions can be filtered to one Malaysian day", async () => {
    const res = await call("GET", "/transactions?date=2026-06-18", { cookie: staff })
    assert.deepEqual(res.body.transactions.map((t) => t.number).sort(), ["PO-0038", "SL-1046", "SL-1047"])
  })
  test("daily report adds up today's posted sales", async () => {
    const res = await call("GET", "/reports/daily", { cookie: staff })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const { report } = res.body
    assert.ok(report.sales.count >= 3)
    assert.equal(report.byPayment.length, 3)
    assert.equal(round(report.byPayment.reduce((s, p) => s + p.total, 0)), round(report.sales.total))
    assert.ok(report.voided.count >= 1)
    const june = await call("GET", "/reports/daily?date=2026-06-18", { cookie: staff })
    assert.equal(june.body.report.sales.total, 74.8)
  })
  test("forecast job writes a moving average per product", async () => {
    const run = await call("POST", "/forecasts/run", { cookie: admin })
    assert.equal(run.status, 201, JSON.stringify(run.body))
    assert.ok(run.body.generated > 0)
    const res = await call("GET", "/forecasts", { cookie: admin })
    const beans = res.body.forecasts.find((f) => f.sku === "CAF-001")
    assert.equal(beans.model, "moving_average")
    assert.equal(beans.horizonDays, 7)
  })
})

const round = (n) => Math.round(n * 100) / 100

describe("reserved for later", () => {
  test("payment webhook is off", async () => {
    assert.equal((await call("POST", "/payments/webhook", { body: { any: 1 } })).status, 404)
  })
})
