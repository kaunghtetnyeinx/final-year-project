import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { config } from "./config.js"
import { pool } from "./db.js"
import { ApiError } from "./errors.js"

export const COOKIE_NAME = "pos_session"
// Compared against when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12)

export const cookieOptions = () => ({
  httpOnly: true, // JavaScript in the page cannot read the session
  secure: config.cookieSecure, // only sent over HTTPS in production
  sameSite: "strict",
  path: "/",
  maxAge: config.sessionHours * 60 * 60 * 1000,
})

const USER_SQL = `
  SELECT u.id, u.name, u.email, u.password_hash, u.is_active, r.name AS role
  FROM users u JOIN roles r ON r.id = u.role_id`

export const publicUser = (row) => ({ id: row.id, name: row.name, email: row.email, role: row.role })

/** Returns the user when email + password are right and the account is active, else null. */
export async function verifyLogin(email, password) {
  const [rows] = await pool.query(`${USER_SQL} WHERE u.email = ?`, [email.trim().toLowerCase()])
  const user = rows[0]
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)
  if (!user || !ok || !user.is_active) return null
  return user
}

export const signSession = (user) =>
  jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
    algorithm: "HS256",
  })

/** Every protected route: valid session cookie AND the user is still active in the database. */
export async function requireAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) throw new ApiError(401, "Please sign in")
  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] })
  } catch {
    throw new ApiError(401, "Session expired, please sign in again")
  }
  // Re-read the role on every request, so a deactivated or demoted user loses access at once.
  const [rows] = await pool.query(`${USER_SQL} WHERE u.id = ?`, [Number(payload.sub)])
  const user = rows[0]
  if (!user || !user.is_active) throw new ApiError(401, "Account is not active")
  req.user = publicUser(user)
  next()
}

/** Admin-only routes. The front end also hides these screens, but this is the real check. */
export function requireAdmin(req, _res, next) {
  if (req.user?.role !== "ADMIN") throw new ApiError(403, "Admin access required")
  next()
}

export const hashPassword = (password) => bcrypt.hash(password, 12)
