import { round2 } from "./format.ts"

// Every sale bill carries a service charge and SST, both calculated on the item
// subtotal after any discount. Each amount is rounded to the sen so the receipt adds up.
// The rates come from the `settings` table (GET /api/settings); the server recalculates
// every bill itself (server/src/billing.js), so this copy is only for the on-screen preview.
export type Rates = { serviceChargeRate: number; sstRate: number }

export const DEFAULT_RATES: Rates = { serviceChargeRate: 0.1, sstRate: 0.06 }

export type Bill = {
  subtotal: number
  /** Bill discount in RM, taken off the subtotal before service charge and SST. */
  discount: number
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

export const saleBill = (
  lines: { quantity: number; unitPrice: number }[],
  rates: Rates,
  discountAmount = 0,
): Bill => {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
  const discount = round2(Math.min(Math.max(discountAmount, 0), subtotal))
  const net = round2(subtotal - discount)
  const serviceCharge = round2(net * rates.serviceChargeRate)
  const tax = round2(net * rates.sstRate)
  const exact = round2(net + serviceCharge + tax)
  const total = roundTo5Sen(exact)
  return { subtotal, discount, serviceCharge, tax, rounding: round2(total - exact), total }
}

/** Change to give back for a cash payment, or null when not enough cash was entered. */
export const changeDue = (total: number, cashReceived: number) =>
  cashReceived + 1e-9 >= total ? round2(cashReceived - total) : null
