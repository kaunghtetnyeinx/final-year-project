export const money = (value: number) => `RM ${value.toFixed(2)}`

/** Unit costs can be fractions of a sen (e.g. RM 0.065 per g): up to 4 decimals, at least 2. */
export const unitMoney = (value: number) => `RM ${value.toFixed(4).replace(/0{1,2}$/, "")}`

export const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`

/** Quantities are decimal(12,3): show up to 3 decimals without trailing zeros. */
export const qty = (value: number) => String(Number(value.toFixed(3)))

// All dates and times are shown in Malaysia Time (UTC+8), whatever the device's timezone.
export const MY_TIMEZONE = "Asia/Kuala_Lumpur"

export const malaysiaParts = (date: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: MY_TIMEZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>

/** e.g. "03 Nov 2026" */
export const myDate = (date = new Date()) => {
  const p = malaysiaParts(date)
  return `${p.day} ${p.month} ${p.year}`
}

/** e.g. "3 Nov · 21:45" */
export const myStamp = (date = new Date()) => {
  const p = malaysiaParts(date)
  return `${Number(p.day)} ${p.month} · ${p.hour}:${p.minute}`
}

/** e.g. "03 Nov 2026, 21:45" */
export const myDateTime = (date: Date) => {
  const p = malaysiaParts(date)
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`
}

/** 0.1 -> "10", 0.06 -> "6" */
export const ratePct = (rate: number) => String(Number((rate * 100).toFixed(2)))

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** "+RM 0.01" / "-RM 0.02" / "RM 0.00" */
export const signedMoney = (value: number) =>
  value === 0 ? money(0) : `${value > 0 ? "+" : "-"}${money(Math.abs(value))}`

export const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000
