import { createApp } from "./app.js"
import { config } from "./config.js"
import { pool } from "./db.js"

const server = createApp().listen(config.port, () => {
  console.log(`Juniper POS API listening on port ${config.port} (${config.nodeEnv})`)
})

// Docker sends SIGTERM on stop/redeploy: finish open requests, then close DB connections.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end()
      process.exit(0)
    })
  })
}
