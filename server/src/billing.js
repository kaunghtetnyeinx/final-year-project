// Same maths as the front end (src/App.tsx saleBill / purchaseBill), so the receipt the
// cashier sees and the amount saved in the database are always identical.
// The SERVER always recomputes totals from database prices; it never trusts the browser.

export const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100
export const round4 = (value) => Math.round((value + Number.EPSILON) * 10000) / 10000

// Malaysia's rounding mechanism: total bill to the nearest 5 sen.
export const roundTo5Sen = (value) => round2(Math.round(round2(value) * 20) / 20)

/** @param {{quantity:number, unitPrice:number}[]} lines */
export function saleBill(lines, { serviceChargeRate, sstRate }) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0))
  const serviceCharge = round2(subtotal * serviceChargeRate)
  // SST is charged on the subtotal, excluding the service charge.
  const tax = round2(subtotal * sstRate)
  const exact = round2(subtotal + serviceCharge + tax)
  const total = roundTo5Sen(exact)
  return { subtotal, serviceCharge, tax, rounding: round2(total - exact), total }
}

// Supplier purchases are recorded at cost: no service charge, SST or rounding.
export function purchaseBill(lines) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0))
  return { subtotal, serviceCharge: 0, tax: 0, rounding: 0, total: subtotal }
}
