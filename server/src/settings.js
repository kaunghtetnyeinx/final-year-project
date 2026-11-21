import { pool } from "./db.js"

const DEFAULTS = {
  service_charge_rate: "0.10",
  sst_rate: "0.06",
  recipe_target_margin: "0.60",
}

/** Billing rates and the recipe target margin, read from the `settings` table. */
export async function getSettings(conn = pool) {
  const [rows] = await conn.query("SELECT setting_key, setting_value FROM settings")
  const map = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])) }
  return {
    serviceChargeRate: Number(map.service_charge_rate),
    sstRate: Number(map.sst_rate),
    targetMargin: Number(map.recipe_target_margin),
    timezone: map.timezone ?? "Asia/Kuala_Lumpur",
  }
}
