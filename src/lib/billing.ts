import { round2 } from "./format"

// Every sale bill carries a service charge and SST, both calculated on the
// item subtotal. Each amount is rounded to the sen so the receipt adds up exactly.
// The rates come from the `settings` table (GET /api/settings); the server
// recalculates every bill itself, so this copy is only for the on-screen preview.
export type Rates = { serviceChargeRate: number; sstRate: number }

export const DEFAULT_RATES: Rates = { serviceChargeRate: 0.1, sstRate: 0.06 }

export type Bill = {
  subtotal: number
  serviceCharge: number
  tax: number
  /** Rounding adjustment to the nearest 5 sen (e.g. -0.02 or +0.01). */
  rounding: number
  /** Amount payable, after rounding. */
  total: number
}

// Every sale bill (Cash, Card and QR) is rounded to the nearest 5 sen, following
// Malaysia's rounding mechanism:
// x.x1/x.x2 -> x.x0, x.x3/x.x4 -> x.x5, x.x6/x.x7 -> x.x5, x.x8/x.x9 -> next x.x0.
export const roundTo5Sen = (value: number) => round2(Math.round(round2(value) * 20) / 20)

export const saleBill = (lines: { quantity: number; unitPrice: number }[], rates: Rates): Bill => {
  const subtotal = round2(
    lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  )
  const serviceCharge = round2(subtotal * rates.serviceChargeRate)
  const tax = round2(subtotal * rates.sstRate)
  const exact = round2(subtotal + serviceCharge + tax)
  const total = roundTo5Sen(exact)
  return { subtotal, serviceCharge, tax, rounding: round2(total - exact), total }
}
