// Same maths as the front end (src/App.tsx saleBill / purchaseBill), so the receipt the
// cashier sees and the amount saved in the database are always identical.
// The SERVER always recomputes totals from database prices; it never trusts the browser.

export const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100
export const round4 = (value) => Math.round((value + Number.EPSILON) * 10000) / 10000

// Malaysia's rounding mechanism: total bill to the nearest 5 sen.
export const roundTo5Sen = (value) => round2(Math.round(round2(value) * 20) / 20)

/**
 * A bill discount (RM) comes off the item subtotal first; service charge and SST are then
 * charged on what is left. It can never exceed the subtotal.
 * @param {{quantity:number, unitPrice:number}[]} lines
 */
export function saleBill(lines, { serviceChargeRate, sstRate }, discountAmount = 0) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0))
  const discount = round2(Math.min(Math.max(discountAmount, 0), subtotal))
  const net = round2(subtotal - discount)
  const serviceCharge = round2(net * serviceChargeRate)
  // SST is charged on the (discounted) subtotal, excluding the service charge.
  const tax = round2(net * sstRate)
  const exact = round2(net + serviceCharge + tax)
  const total = roundTo5Sen(exact)
  return { subtotal, discount, serviceCharge, tax, rounding: round2(total - exact), total }
}

// Supplier purchases are recorded at cost: no service charge, SST or rounding.
export function purchaseBill(lines) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0))
  return { subtotal, discount: 0, serviceCharge: 0, tax: 0, rounding: 0, total: subtotal }
}
