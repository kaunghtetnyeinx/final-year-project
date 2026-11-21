import { randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import express, { Router } from "express"
import { z } from "zod"
import { requireAdmin } from "../auth.js"
import { config } from "../config.js"
import { pool, withTransaction } from "../db.js"
import { badRequest, conflict, notFound, parse } from "../errors.js"
import { isDuplicate } from "../ledger.js"
import { getSettings } from "../settings.js"

export const catalogueRouter = Router()
const INGREDIENTS = "Ingredients"

const PRODUCT_SQL = `
  SELECT p.id, p.sku, p.name, c.name AS category, p.price, p.cost_price, p.stock_quantity,
         p.reorder_level, p.track_stock, p.image_url, p.is_active, p.updated_at
  FROM products p JOIN categories c ON c.id = p.category_id`

// Same shape as Product in src/lib/types.ts.
const toProduct = (r, options = []) => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  category: r.category,
  price: r.price,
  costPrice: r.cost_price,
  stock: r.stock_quantity,
  reorder: r.reorder_level,
  // false = made to order: no shelf count; selling it uses up its recipe's ingredients.
  trackStock: Boolean(r.track_stock),
  image: r.image_url,
  isActive: Boolean(r.is_active),
  updated: r.updated_at.toISOString(),
  options,
})
const toOption = (o) => ({ id: o.id, name: o.name, priceDelta: o.price_delta })

async function optionsFor(ids, conn = pool) {
  if (!ids.length) return new Map()
  const [rows] = await conn.query(
    "SELECT id, product_id, name, price_delta FROM product_options WHERE is_active = 1 AND product_id IN (?) ORDER BY sort_order, id",
    [ids],
  )
  const map = new Map()
  for (const o of rows) map.set(o.product_id, [...(map.get(o.product_id) ?? []), toOption(o)])
  return map
}

async function getProduct(id, conn = pool) {
  const [rows] = await conn.query(`${PRODUCT_SQL} WHERE p.id = ?`, [id])
  if (!rows[0]) throw notFound("Product not found")
  return toProduct(rows[0], (await optionsFor([id], conn)).get(id))
}

// Everyone signed in: products, categories and billing settings for the sale screen.
catalogueRouter.get("/products", async (req, res) => {
  const includeInactive = req.query.all === "1" && req.user.role === "ADMIN"
  const [rows] = await pool.query(
    `${PRODUCT_SQL} ${includeInactive ? "" : "WHERE p.is_active = 1"} ORDER BY p.id`,
  )
  const options = await optionsFor(rows.map((r) => r.id))
  res.json({ products: rows.map((r) => toProduct(r, options.get(r.id))) })
})

catalogueRouter.get("/categories", async (_req, res) => {
  const [rows] = await pool.query("SELECT id, name, description FROM categories ORDER BY id")
  res.json({ categories: rows })
})

catalogueRouter.get("/settings", async (_req, res) => {
  res.json({ settings: await getSettings() })
})

// ---------------------------------------------------------------- categories (admin)
const CategoryBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(500).nullable().optional(),
})

catalogueRouter.post("/categories", requireAdmin, async (req, res) => {
  const body = parse(CategoryBody, req.body)
  try {
    const [result] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", [
      body.name,
      body.description || null,
    ])
    res.status(201).json({ category: { id: result.insertId, name: body.name, description: body.description || null } })
  } catch (error) {
    if (isDuplicate(error)) throw conflict(`A category called "${body.name}" already exists.`)
    throw error
  }
})

catalogueRouter.patch("/categories/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const body = parse(CategoryBody, req.body)
  const [[current]] = await pool.query("SELECT name FROM categories WHERE id = ?", [id])
  if (!current) throw notFound("Category not found")
  // The app recognises stock-only items by this category's name.
  if (current.name === INGREDIENTS || body.name === INGREDIENTS)
    throw badRequest(`The "${INGREDIENTS}" category cannot be renamed.`)
  try {
    await pool.query("UPDATE categories SET name = ?, description = ? WHERE id = ?", [
      body.name,
      body.description || null,
      id,
    ])
  } catch (error) {
    if (isDuplicate(error)) throw conflict(`A category called "${body.name}" already exists.`)
    throw error
  }
  res.json({ category: { id, name: body.name, description: body.description || null } })
})

// ---------------------------------------------------------------- products (admin)
const money = z.number().finite().min(0).max(1_000_000)
// A web address, or a photo uploaded through POST /products/:id/image.
const UPLOAD_PATH = /^\/api\/uploads\/[a-f0-9]{32}\.(png|jpg|webp)$/
const imageUrl = z.union([z.url().max(500), z.string().regex(UPLOAD_PATH)])
const ProductBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  sku: z.string().trim().min(1, "SKU is required").max(80).transform((s) => s.toUpperCase()),
  category: z.string().trim().min(1),
  price: money,
  stock: z.number().int().min(0).default(0),
  reorder: z.number().int().min(0).default(0),
  trackStock: z.boolean().default(true),
  image: imageUrl.nullable().optional(),
})

// Admin: add a product (Products screen "Add product").
catalogueRouter.post("/products", requireAdmin, async (req, res) => {
  const body = parse(ProductBody, req.body)
  if (body.price <= 0 && body.category !== INGREDIENTS)
    throw badRequest("Selling price must be greater than 0.")
  if (!body.trackStock && body.category === INGREDIENTS)
    throw badRequest("Ingredients always keep a stock count.")
  const [cats] = await pool.query("SELECT id FROM categories WHERE name = ?", [body.category])
  if (!cats[0]) throw badRequest(`Unknown category "${body.category}"`)
  try {
    const [result] = await pool.query(
      `INSERT INTO products (sku, name, category_id, price, stock_quantity, reorder_level, track_stock, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.sku, body.name, cats[0].id, body.price, body.trackStock ? body.stock : 0,
        body.trackStock ? body.reorder : 0, body.trackStock, body.image ?? null,
      ],
    )
    res.status(201).json({ product: await getProduct(result.insertId) })
  } catch (error) {
    if (isDuplicate(error)) throw conflict(`SKU ${body.sku} already exists.`)
    throw error
  }
})

const ProductPatch = z
  .object({
    name: z.string().trim().min(1).max(150),
    category: z.string().trim().min(1),
    price: money,
    reorder: z.number().int().min(0),
    trackStock: z.boolean(),
    image: imageUrl.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update")

// Admin: edit a product, e.g. Recipes "Set price to RM x" or deactivating an item.
// Stock is NOT editable here: it changes only through sales, purchases, production and adjustments.
catalogueRouter.patch("/products/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const body = parse(ProductPatch, req.body)
  const current = await getProduct(id)
  const category = body.category ?? current.category
  if ((current.category === INGREDIENTS) !== (category === INGREDIENTS))
    throw badRequest("A product cannot move into or out of Ingredients.")
  const price = body.price ?? current.price
  if (price <= 0 && category !== INGREDIENTS) throw badRequest("Selling price must be greater than 0.")
  if (body.trackStock === false && category === INGREDIENTS) throw badRequest("Ingredients always keep a stock count.")
  if (body.trackStock === false && current.trackStock && current.stock > 0)
    throw badRequest(
      `${current.name} still has ${current.stock} in stock. Adjust it to 0 in Inventory before making it made to order.`,
    )
  const sets = []
  const params = []
  if (body.category !== undefined) {
    const [cats] = await pool.query("SELECT id FROM categories WHERE name = ?", [body.category])
    if (!cats[0]) throw badRequest(`Unknown category "${body.category}"`)
    sets.push("category_id = ?"), params.push(cats[0].id)
  }
  const columns = { name: "name", price: "price", reorder: "reorder_level", trackStock: "track_stock", image: "image_url", isActive: "is_active" }
  for (const key of Object.keys(columns)) {
    if (body[key] !== undefined) sets.push(`${columns[key]} = ?`), params.push(body[key])
  }
  await pool.query(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, [...params, id])
  if (body.image !== undefined && body.image !== current.image) await removeUpload(current.image)
  res.json({ product: await getProduct(id) })
})

// ---------------------------------------------------------------- options (admin)
const OptionsBody = z.object({
  options: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(1, "Option name is required").max(60),
        priceDelta: z.number().finite().min(0).max(1000),
      }),
    )
    .max(20),
})

// Replaces a product's option list. Removed options are switched off (old receipts keep
// their own copy of the name and price), edited ones keep their id.
catalogueRouter.put("/products/:id/options", requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const { options } = parse(OptionsBody, req.body)
  const product = await getProduct(id)
  if (product.category === INGREDIENTS && options.length) throw badRequest("Ingredients cannot have options.")
  const names = options.map((o) => o.name.toLowerCase())
  if (new Set(names).size !== names.length) throw badRequest("Two options have the same name.")
  await withTransaction(async (conn) => {
    const [existing] = await conn.query("SELECT id FROM product_options WHERE product_id = ? FOR UPDATE", [id])
    const known = new Set(existing.map((o) => o.id))
    const keep = new Set()
    for (const [index, o] of options.entries()) {
      if (o.id !== undefined && known.has(o.id)) {
        await conn.query(
          "UPDATE product_options SET name = ?, price_delta = ?, sort_order = ?, is_active = 1 WHERE id = ?",
          [o.name, o.priceDelta, index, o.id],
        )
        keep.add(o.id)
      } else {
        await conn.query(
          "INSERT INTO product_options (product_id, name, price_delta, sort_order) VALUES (?, ?, ?, ?)",
          [id, o.name, o.priceDelta, index],
        )
      }
    }
    for (const oldId of known)
      if (!keep.has(oldId)) await conn.query("UPDATE product_options SET is_active = 0 WHERE id = ?", [oldId])
  })
  res.json({ product: await getProduct(id) })
})

// ---------------------------------------------------------------- photo upload (admin)
// The browser sends the image file as the request body (no multipart parser needed).
// The real file type is checked from its first bytes, not from what the browser claims.
function imageType(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg"
  if (buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp"
  return null
}

async function removeUpload(url) {
  if (!url || !UPLOAD_PATH.test(url)) return
  await unlink(path.join(config.uploadDir, path.basename(url))).catch(() => {})
}

catalogueRouter.post(
  "/products/:id/image",
  requireAdmin,
  express.raw({ type: () => true, limit: "2mb" }),
  async (req, res) => {
    const id = Number(req.params.id)
    const current = await getProduct(id)
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    const type = imageType(buffer)
    if (!type) throw badRequest("Upload a PNG, JPEG or WebP image (2 MB at most).")
    const file = `${randomBytes(16).toString("hex")}.${type}`
    await writeFile(path.join(config.uploadDir, file), buffer)
    await pool.query("UPDATE products SET image_url = ? WHERE id = ?", [`/api/uploads/${file}`, id])
    await removeUpload(current.image)
    res.status(201).json({ product: await getProduct(id) })
  },
)
