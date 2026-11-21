import { round2 } from "./format.ts"
import type { CartLine, Product } from "./types.ts"

/** Same product + same options = same cart line. */
export const lineKey = (productId: number, optionIds: number[]) =>
  `${productId}:${[...optionIds].sort((a, b) => a - b).join(",")}`

/** Selling price of one unit with the chosen options (the server works it out the same way). */
export const unitPriceOf = (product: Product, optionIds: number[]) =>
  round2(
    product.price +
      optionIds.reduce((sum, id) => sum + (product.options.find((o) => o.id === id)?.priceDelta ?? 0), 0),
  )

/** Most of this product that can still go into the cart (made-to-order items have no shelf limit). */
export const MAX_PER_LINE = 999
export const roomFor = (product: Product, cart: CartLine[]) => {
  const inCart = cart.filter((l) => l.productId === product.id).reduce((sum, l) => sum + l.quantity, 0)
  return product.trackStock ? Math.max(0, product.stock - inCart) : MAX_PER_LINE - inCart
}

/** Adds `quantity` of a product with these options, merging into an existing line. */
export function addToCart(cart: CartLine[], product: Product, optionIds: number[], quantity = 1): CartLine[] {
  const add = Math.min(quantity, roomFor(product, cart))
  if (add <= 0) return cart
  const key = lineKey(product.id, optionIds)
  const existing = cart.find((l) => lineKey(l.productId, l.optionIds) === key)
  if (existing)
    return cart.map((l) => (l === existing ? { ...l, quantity: l.quantity + add } : l))
  return [...cart, { productId: product.id, optionIds: [...optionIds].sort((a, b) => a - b), quantity: add }]
}
