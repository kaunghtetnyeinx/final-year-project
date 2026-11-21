import { Router } from "express"
import { z } from "zod"
import { requireAdmin } from "../auth.js"
import { pool } from "../db.js"
import { badRequest, conflict, notFound, parse } from "../errors.js"
import { isDuplicate } from "../ledger.js"
import { getSettings } from "../settings.js"

export const catalogueRouter = Router()
const INGREDIENTS = "Ingredients"

const PRODUCT_SQL = `
  SELECT p.id, p.sku, p.name, c.name AS category, p.price, p.cost_price, p.stock_quantity,
         p.reorder_level, p.image_url, p.is_active, p.updated_at
  FROM products p JOIN categories c ON c.id = p.category_id`

// Same shape as Product in App.tsx.
const toProduct = (r) => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  category: r.category,
  price: r.price,
  costPrice: r.cost_price,
  stock: r.stock_quantity,
  reorder: r.reorder_level,
  image: r.image_url,
  isActive: Boolean(r.is_active),
  updated: r.updated_at.toISOString(),
})

async function getProduct(id) {
  const [rows] = await pool.query(`${PRODUCT_SQL} WHERE p.id = ?`, [id])
  if (!rows[0]) throw notFound("Product not found")
  return toProduct(rows[0])
}

// Everyone signed in: products, categories and billing settings for the sale screen.
catalogueRouter.get("/products", async (req, res) => {
  const includeInactive = req.query.all === "1" && req.user.role === "ADMIN"
  const [rows] = await pool.query(
    `${PRODUCT_SQL} ${includeInactive ? "" : "WHERE p.is_active = 1"} ORDER BY p.id`,
  )
  res.json({ products: rows.map(toProduct) })
})

catalogueRouter.get("/categories", async (_req, res) => {
  const [rows] = await pool.query("SELECT id, name, description FROM categories ORDER BY id")
  res.json({ categories: rows })
})

catalogueRouter.get("/settings", async (_req, res) => {
  res.json({ settings: await getSettings() })
})

const money = z.number().finite().min(0).max(1_000_000)
const ProductBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  sku: z.string().trim().min(1, "SKU is required").max(80).transform((s) => s.toUpperCase()),
  category: z.string().trim().min(1),
  price: money,
  stock: z.number().int().min(0).default(0),
  reorder: z.number().int().min(0).default(0),
  image: z.url().max(500).nullable().optional(),
})

// Admin: add a product (Products screen "Add product").
catalogueRouter.post("/products", requireAdmin, async (req, res) => {
  const body = parse(ProductBody, req.body)
  if (body.price <= 0 && body.category !== INGREDIENTS)
    throw badRequest("Selling price must be greater than 0.")
  const [cats] = await pool.query("SELECT id FROM categories WHERE name = ?", [body.category])
  if (!cats[0]) throw badRequest(`Unknown category "${body.category}"`)
  try {
    const [result] = await pool.query(
      `INSERT INTO products (sku, name, category_id, price, stock_quantity, reorder_level, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [body.sku, body.name, cats[0].id, body.price, body.stock, body.reorder, body.image ?? null],
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
    price: money,
    reorder: z.number().int().min(0),
    image: z.url().max(500).nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update")

// Admin: edit a product, e.g. Recipes "Set price to RM x" or deactivating an item.
// Stock is NOT editable here: it changes only through sales, purchases and adjustments.
catalogueRouter.patch("/products/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const body = parse(ProductPatch, req.body)
  const current = await getProduct(id)
  if (body.price !== undefined && body.price <= 0 && current.category !== INGREDIENTS)
    throw badRequest("Selling price must be greater than 0.")
  const columns = { name: "name", price: "price", reorder: "reorder_level", image: "image_url", isActive: "is_active" }
  const keys = Object.keys(body)
  await pool.query(
    `UPDATE products SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ?`,
    [...keys.map((k) => body[k]), id],
  )
  res.json({ product: await getProduct(id) })
})
