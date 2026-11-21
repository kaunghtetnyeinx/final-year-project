import mysql from "mysql2/promise"
import { config } from "./config.js"

// Times are stored in UTC; the front end shows them in Malaysia Time (UTC+8).
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
  timezone: "Z",
  decimalNumbers: true,
  connectionLimit: 10,
  waitForConnections: true,
})

pool.pool.on("connection", (conn) => {
  conn.query("SET time_zone = '+00:00'")
})

/** Run fn(conn) inside one database transaction: all of it is saved, or none of it. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}
