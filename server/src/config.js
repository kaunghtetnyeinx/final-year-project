// All settings come from environment variables (see .env.example).
import path from "node:path"
const env = process.env

function required(name) {
  const value = env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

const bool = (value, fallback = false) =>
  value === undefined ? fallback : ["1", "true", "yes"].includes(String(value).toLowerCase())

export const config = {
  port: Number(env.PORT ?? 3000),
  nodeEnv: env.NODE_ENV ?? "development",
  db: {
    host: required("DB_HOST"),
    port: Number(env.DB_PORT ?? 3306),
    user: required("DB_USER"),
    password: env.DB_PASSWORD ?? "",
    database: required("DB_NAME"),
    // RDS: set DB_SSL=true so traffic to the database is encrypted.
    ssl: bool(env.DB_SSL),
  },
  jwtSecret: required("JWT_SECRET"),
  sessionHours: Number(env.SESSION_HOURS ?? 12),
  // true behind HTTPS (production). false only for local http testing.
  cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === "production"),
  // Behind Caddy, trust one proxy hop so rate limiting sees the real client IP.
  trustProxy: bool(env.TRUST_PROXY, true),
  // Uploaded product photos (a Docker volume in production).
  uploadDir: path.resolve(env.UPLOAD_DIR ?? "uploads"),
  // Reserved for later: payment gateway webhook stays off until this is true.
  paymentsGatewayEnabled: bool(env.PAYMENTS_GATEWAY_ENABLED),
}

if (config.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters (use: openssl rand -hex 32)")
}
