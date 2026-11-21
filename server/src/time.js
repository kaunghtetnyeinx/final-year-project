import { z } from "zod"

// The cafe works in Malaysia time (UTC+8, no daylight saving); the database stores UTC.
const MYT_OFFSET = "+08:00"

/** A calendar date such as 2026-11-21. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-21")
  .refine((d) => !Number.isNaN(new Date(`${d}T00:00:00${MYT_OFFSET}`).getTime()), "Not a real date")

/** [start, end) of one Malaysian calendar day, as UTC Dates for SQL. */
export function dayRange(date) {
  const start = new Date(`${date}T00:00:00${MYT_OFFSET}`)
  return [start, new Date(start.getTime() + 24 * 60 * 60 * 1000)]
}

/** Today's date in Malaysia, e.g. "2026-11-21". */
export const todayInMalaysia = (now = new Date()) =>
  new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
