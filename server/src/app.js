import { mkdirSync } from "node:fs"
import cookieParser from "cookie-parser"
import express from "express"
import helmet from "helmet"
import { requireAdmin, requireAuth } from "./auth.js"
import { config } from "./config.js"
import { pool } from "./db.js"
import { ApiError, errorHandler } from "./errors.js"
import { adminRouter } from "./routes/admin.js"
import { authRouter } from "./routes/auth.js"
import { catalogueRouter } from "./routes/catalogue.js"
import { inventoryRouter } from "./routes/inventory.js"
import { paymentsRouter } from "./routes/payments.js"
import { recipesRouter } from "./routes/recipes.js"
import { reportsRouter } from "./routes/reports.js"
import { transactionsRouter } from "./routes/transactions.js"

export function createApp() {
  const app = express()
  app.disable("x-powered-by")
  if (config.trustProxy) app.set("trust proxy", 1)
  app.use(helmet())
  app.use(express.json({ limit: "100kb" }))
  app.use(cookieParser())

  const api = express.Router()

  // Public
  api.get("/health", async (_req, res) => {
    await pool.query("SELECT 1")
    res.json({ ok: true })
  })
  api.use("/auth", authRouter)
  // Product photos are public (they are only product pictures) and never change once written.
  mkdirSync(config.uploadDir, { recursive: true })
  api.use(
    "/uploads",
    express.static(config.uploadDir, { immutable: true, maxAge: "365d", index: false, dotfiles: "deny", fallthrough: false }),
  )
  api.use(paymentsRouter)

  // Signed in: Admin and Staff (sale screen, transactions, product list)
  api.use(requireAuth)
  api.use(catalogueRouter)
  api.use(transactionsRouter)
  api.use(reportsRouter)

  // Admin only: everything below this line
  api.use(requireAdmin)
  api.use(inventoryRouter)
  api.use(recipesRouter)
  api.use(adminRouter)

  api.use(() => {
    throw new ApiError(404, "Not found")
  })

  app.use("/api", api)
  app.use(errorHandler)
  return app
}
