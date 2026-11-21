import { createApp } from "./app.js"
import { config } from "./config.js"
import { pool } from "./db.js"
import { forecastIsStale, runForecast } from "./forecast.js"
import { migrations } from "./migrate.js"

// The API's database user cannot change the schema, so migrations run first in their own
// container (pos-migrate). Refuse to start on an out-of-date schema instead of failing later.
async function checkSchema() {
  let applied
  try {
    const [rows] = await pool.query("SELECT name FROM schema_migrations")
    applied = new Set(rows.map((r) => r.name))
  } catch {
    applied = new Set()
  }
  const missing = migrations.filter((m) => !applied.has(m.name)).map((m) => m.name)
  if (missing.length) {
    console.error(`Database schema is out of date (missing: ${missing.join(", ")}). Run: npm run migrate`)
    process.exit(1)
  }
}

// Daily demand forecast: run when the newest one is older than 20 hours. Checked at start-up
// and every hour, so a restart never skips a day and never runs it twice in a day.
async function forecastTick() {
  try {
    if (await forecastIsStale()) {
      const result = await runForecast()
      console.log(`forecast generated for ${result.generated} products`)
    }
  } catch (error) {
    console.error("forecast job failed:", error)
  }
}

await checkSchema()
const server = createApp().listen(config.port, () => {
  console.log(`Juniper POS API listening on port ${config.port} (${config.nodeEnv})`)
})
forecastTick()
const forecastTimer = setInterval(forecastTick, 60 * 60 * 1000)

// Docker sends SIGTERM on stop/redeploy: finish open requests, then close DB connections.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    clearInterval(forecastTimer)
    server.close(async () => {
      await pool.end()
      process.exit(0)
    })
  })
}
