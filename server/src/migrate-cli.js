// Run the schema migrations once and exit: `node src/migrate-cli.js`.
// Uses its own connection settings (MIGRATE_DB_USER / MIGRATE_DB_PASSWORD, falling back to
// DB_USER / DB_PASSWORD), because the API's own user is not allowed to change the schema.
import mysql from "mysql2/promise"
import { migrate } from "./migrate.js"

const env = process.env
const required = (name) => {
  if (!env[name]) throw new Error(`Missing required environment variable ${name}`)
  return env[name]
}

const pool = mysql.createPool({
  host: required("DB_HOST"),
  port: Number(env.DB_PORT ?? 3306),
  user: env.MIGRATE_DB_USER || required("DB_USER"),
  password: env.MIGRATE_DB_USER ? (env.MIGRATE_DB_PASSWORD ?? "") : (env.DB_PASSWORD ?? ""),
  database: required("DB_NAME"),
  ssl: ["1", "true", "yes"].includes(String(env.DB_SSL).toLowerCase()) ? { rejectUnauthorized: true } : undefined,
  timezone: "Z",
  connectionLimit: 2,
})

try {
  await migrate(pool)
  await pool.end()
} catch (error) {
  console.error("migration failed:", error)
  await pool.end().catch(() => {})
  process.exit(1)
}
