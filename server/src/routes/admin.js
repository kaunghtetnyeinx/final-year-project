import { Router } from "express"
import { z } from "zod"
import { hashPassword } from "../auth.js"
import { pool } from "../db.js"
import { badRequest, conflict, notFound, parse } from "../errors.js"
import { isDuplicate } from "../ledger.js"
import { getSettings } from "../settings.js"

// Admin only (mounted behind requireAdmin in app.js): users, target margin, forecasts.
export const adminRouter = Router()

// ---------------------------------------------------------------- users
const toUser = (r) => ({
  id: r.id,
  code: `USR-${String(r.id).padStart(3, "0")}`,
  name: r.name,
  email: r.email,
  role: r.role,
  isActive: Boolean(r.is_active),
  createdAt: r.created_at.toISOString(),
})
const USERS_SQL = `SELECT u.id, u.name, u.email, u.is_active, u.created_at, r.name AS role
                   FROM users u JOIN roles r ON r.id = u.role_id`

adminRouter.get("/users", async (_req, res) => {
  const [rows] = await pool.query(`${USERS_SQL} ORDER BY u.id`)
  res.json({ users: rows.map(toUser) })
})

const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Password needs letters and numbers")

const CreateUser = z.object({
  name: z.string().trim().min(1, "Full name is required.").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")).pipe(z.string().max(254)),
  role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
  // Temporary password the admin gives the new staff member.
  password,
})

adminRouter.post("/users", async (req, res) => {
  const body = parse(CreateUser, req.body)
  try {
    const [result] = await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id)
       VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = ?))`,
      [body.name, body.email, await hashPassword(body.password), body.role],
    )
    const [rows] = await pool.query(`${USERS_SQL} WHERE u.id = ?`, [result.insertId])
    res.status(201).json({ user: toUser(rows[0]) })
  } catch (error) {
    if (isDuplicate(error)) throw conflict("A user with this email already exists.")
    throw error
  }
})

const PatchUser = z
  .object({ role: z.enum(["ADMIN", "STAFF"]), isActive: z.boolean(), password })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update")

adminRouter.patch("/users/:id", async (req, res) => {
  const id = Number(req.params.id)
  const body = parse(PatchUser, req.body)
  // An admin cannot lock themselves out.
  if (id === req.user.id && (body.isActive === false || body.role === "STAFF"))
    throw badRequest("You cannot deactivate or demote your own account.")
  const sets = []
  const params = []
  if (body.role) sets.push("role_id = (SELECT id FROM roles WHERE name = ?)"), params.push(body.role)
  if (body.isActive !== undefined) sets.push("is_active = ?"), params.push(body.isActive)
  if (body.password) sets.push("password_hash = ?"), params.push(await hashPassword(body.password))
  const [result] = await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...params, id])
  if (!result.affectedRows) throw notFound("User not found")
  const [rows] = await pool.query(`${USERS_SQL} WHERE u.id = ?`, [id])
  res.json({ user: toUser(rows[0]) })
})

// ---------------------------------------------------------------- recipe target margin
const MarginBody = z.object({ value: z.number().min(0).max(0.95) })

adminRouter.put("/settings/target-margin", async (req, res) => {
  const { value } = parse(MarginBody, req.body)
  await pool.query(
    `INSERT INTO settings (setting_key, setting_value, description) VALUES ('recipe_target_margin', ?, 'Target profit margin used by the Recipes screen')
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [value.toFixed(2)],
  )
  res.json({ settings: await getSettings() })
})

// ---------------------------------------------------------------- forecasts
// Latest forecast per product. Today these are the seeded demo values; later the forecast
// job writes new rows into forecast_results and this endpoint returns them unchanged.
adminRouter.get("/forecasts", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT f.product_id, p.sku, p.name, p.stock_quantity, p.reorder_level, f.forecast_date, f.horizon_days,
            f.predicted_quantity, f.model_name, f.model_version, f.generated_at
     FROM forecast_results f JOIN products p ON p.id = f.product_id
     WHERE f.id = (SELECT f2.id FROM forecast_results f2 WHERE f2.product_id = f.product_id
                   ORDER BY f2.generated_at DESC, f2.id DESC LIMIT 1)
     ORDER BY p.id`,
  )
  res.json({
    forecasts: rows.map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      stock: r.stock_quantity,
      reorder: r.reorder_level,
      forecastDate: r.forecast_date instanceof Date ? r.forecast_date.toISOString().slice(0, 10) : r.forecast_date,
      horizonDays: r.horizon_days,
      predicted: r.predicted_quantity,
      model: r.model_name,
      modelVersion: r.model_version,
      generatedAt: r.generated_at.toISOString(),
    })),
  })
})
