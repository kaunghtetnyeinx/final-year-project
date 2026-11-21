import { Router } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import {
  COOKIE_NAME,
  checkPassword,
  cookieOptions,
  hashPassword,
  passwordSchema,
  publicUser,
  requireAuth,
  signSession,
  verifyLogin,
} from "../auth.js"
import { pool } from "../db.js"
import { ApiError, badRequest, parse } from "../errors.js"

export const authRouter = Router()

// Slow down password guessing: 10 attempts per IP every 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
})

const LoginBody = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
})

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = parse(LoginBody, req.body)
  const user = await verifyLogin(email, password)
  if (!user) throw new ApiError(401, "Wrong email or password")
  res.cookie(COOKIE_NAME, signSession(user), cookieOptions())
  res.json({ user: publicUser(user) })
})

authRouter.post("/logout", (_req, res) => {
  const { maxAge, ...options } = cookieOptions()
  res.clearCookie(COOKIE_NAME, options)
  res.status(204).end()
})

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user })
})

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: passwordSchema,
})

// Password changes test the current password too, so they are rate limited per account.
const changeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
})

// Any signed-in user changes their own password (also clears "must change password").
authRouter.post("/change-password", requireAuth, changeLimiter, async (req, res) => {
  const { currentPassword, newPassword } = parse(ChangePasswordBody, req.body)
  if (!(await checkPassword(req.user.id, currentPassword))) throw new ApiError(401, "Current password is wrong")
  if (currentPassword === newPassword) throw badRequest("Choose a password different from the current one")
  await pool.query("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [
    await hashPassword(newPassword),
    req.user.id,
  ])
  res.json({ user: { ...req.user, mustChangePassword: false } })
})
