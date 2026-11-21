import { Router } from "express"
import { z } from "zod"
import { pool, withTransaction } from "../db.js"
import { badRequest, conflict, notFound, parse } from "../errors.js"
import { isDuplicate } from "../ledger.js"

// Admin only (mounted behind requireAdmin in app.js). Rules match RecipeDetail.save in App.tsx.
export const recipesRouter = Router()

const toRecipe = (r) => ({
  recipeId: r.id,
  productId: r.product_id,
  ingredientId: r.ingredient_id,
  quantityRequired: r.quantity_required,
  unit: r.unit,
  notes: r.notes,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
})

recipesRouter.get("/recipes", async (_req, res) => {
  const [rows] = await pool.query("SELECT * FROM recipes ORDER BY product_id, id")
  res.json({ recipes: rows.map(toRecipe) })
})

const threeDecimals = (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6
const quantity = z
  .number()
  .positive("Quantity required must be greater than 0.")
  .max(999_999_999)
  .refine(threeDecimals, "Quantity can have at most 3 decimal places.")
const unit = z.string().trim().min(1, "Unit is required.").max(20, "Unit can be at most 20 characters.")
const notes = z.string().trim().max(500).nullable().optional().transform((n) => n || null)

/** True when `from`'s recipe (directly or deeper) already uses `target`, i.e. adding target <- from would loop. */
async function reaches(conn, from, target) {
  const [rows] = await conn.query("SELECT product_id, ingredient_id FROM recipes")
  const seen = new Set()
  const stack = [from]
  while (stack.length) {
    const node = stack.pop()
    if (node === target) return true
    if (seen.has(node)) continue
    seen.add(node)
    for (const r of rows) if (r.product_id === node) stack.push(r.ingredient_id)
  }
  return false
}

/** One consistent base unit per ingredient across all recipes. */
async function checkUnit(conn, ingredientId, cleanUnit, exceptId = 0) {
  const [rows] = await conn.query(
    "SELECT unit FROM recipes WHERE ingredient_id = ? AND id <> ? LIMIT 1",
    [ingredientId, exceptId],
  )
  if (rows[0] && rows[0].unit !== cleanUnit)
    throw badRequest(`Use the same base unit as other recipes for this ingredient: "${rows[0].unit}".`)
}

const CreateBody = z.object({
  productId: z.number().int().positive(),
  ingredientId: z.number().int().positive("Choose an ingredient."),
  quantityRequired: quantity,
  unit,
  notes,
})

recipesRouter.post("/recipes", async (req, res) => {
  const body = parse(CreateBody, req.body)
  if (body.productId === body.ingredientId) throw badRequest("A product cannot be an ingredient of itself.")
  const recipe = await withTransaction(async (conn) => {
    const [found] = await conn.query("SELECT id FROM products WHERE id IN (?, ?)", [body.productId, body.ingredientId])
    if (found.length !== 2) throw badRequest("Product or ingredient not found")
    if (await reaches(conn, body.ingredientId, body.productId)) throw badRequest("This would create a circular recipe.")
    await checkUnit(conn, body.ingredientId, body.unit)
    try {
      const [result] = await conn.query(
        "INSERT INTO recipes (product_id, ingredient_id, quantity_required, unit, notes) VALUES (?, ?, ?, ?, ?)",
        [body.productId, body.ingredientId, body.quantityRequired, body.unit, body.notes],
      )
      const [rows] = await conn.query("SELECT * FROM recipes WHERE id = ?", [result.insertId])
      return toRecipe(rows[0])
    } catch (error) {
      if (isDuplicate(error)) throw conflict("This ingredient is already in the recipe. Edit that line instead.")
      throw error
    }
  })
  res.status(201).json({ recipe })
})

const PatchBody = z
  .object({ quantityRequired: quantity, unit, notes })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update")

recipesRouter.patch("/recipes/:id", async (req, res) => {
  const id = Number(req.params.id)
  const body = parse(PatchBody, req.body)
  const recipe = await withTransaction(async (conn) => {
    const [rows] = await conn.query("SELECT * FROM recipes WHERE id = ? FOR UPDATE", [id])
    if (!rows[0]) throw notFound("Recipe line not found")
    if (body.unit !== undefined) await checkUnit(conn, rows[0].ingredient_id, body.unit, id)
    const columns = { quantityRequired: "quantity_required", unit: "unit", notes: "notes" }
    const keys = Object.keys(body)
    await conn.query(`UPDATE recipes SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ?`, [
      ...keys.map((k) => body[k]),
      id,
    ])
    const [after] = await conn.query("SELECT * FROM recipes WHERE id = ?", [id])
    return toRecipe(after[0])
  })
  res.json({ recipe })
})

recipesRouter.delete("/recipes/:id", async (req, res) => {
  const [result] = await pool.query("DELETE FROM recipes WHERE id = ?", [Number(req.params.id)])
  if (!result.affectedRows) throw notFound("Recipe line not found")
  res.status(204).end()
})
