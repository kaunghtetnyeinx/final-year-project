import type { Bill, Rates } from "./billing.ts"

/** The signed-in account, as returned by the API (see server/src/auth.js publicUser). */
export type SessionUser = {
  id: number
  name: string
  email: string
  role: Role
  /** Still on the seeded or an admin-set temporary password: must choose a new one first. */
  mustChangePassword: boolean
}

/** A user row from GET /api/users (see server/src/routes/admin.js toUser). */
export type StaffUser = {
  id: number
  code: string
  name: string
  email: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
}

export type Role = "ADMIN" | "STAFF"

export type View =
  | "New sale"
  | "Transactions"
  | "Reports"
  | "Products"
  | "Recipes"
  | "Inventory"
  | "Stock movements"
  | "Forecasts"
  | "Users"

/** An option such as "Large +RM 2.00" (GET /api/products, `options`). */
export type ProductOption = { id: number; name: string; priceDelta: number }

/** A row of `products` (GET /api/products). Ingredients are products too. */
export type Product = {
  id: number
  sku: string
  name: string
  category: string
  price: number
  /** Latest posted purchase cost per unit (4 decimals); 0 = never purchased. */
  costPrice: number
  stock: number
  reorder: number
  /** false = made to order: no shelf count; selling it uses up its recipe's ingredients. */
  trackStock: boolean
  image: string | null
  isActive: boolean
  /** ISO timestamp */
  updated: string
  options: ProductOption[]
}

/** One cart line: the same product with different options is a separate line. */
export type CartLine = { productId: number; optionIds: number[]; quantity: number }

export type Payment = "Cash" | "Card" | "QR"

export const payments: Payment[] = ["Cash", "Card", "QR"]

export type Movement = {
  id: string
  productId: number
  product: string
  type: "SALE" | "PURCHASE" | "ADJUSTMENT" | "PRODUCTION" | "VOID"
  change: number
  source: string
  by: string
  created: Date
}

export type TransactionLine = {
  productId: number
  name: string
  sku: string
  quantity: number
  /** Includes the option surcharges. */
  unitPrice: number
  options: { name: string; priceDelta: number }[]
}

export type Transaction = Bill & {
  number: string
  type: "SALE" | "PURCHASE"
  status: "POSTED" | "DRAFT" | "CANCELLED"
  at: Date
  by: string
  payment: Payment | null
  lines: TransactionLine[]
  discountReason: string | null
  cashReceived: number | null
  voidedAt: Date | null
  voidedBy: string | null
  voidReason: string | null
}

export type Category = { id: number; name: string; description: string | null }

export type Forecast = {
  productId: number
  predicted: number
  horizonDays: number
  forecastDate: string
  model: string
  modelVersion: string | null
  generatedAt: Date
}

/** GET /api/reports/daily */
export type DailyReport = {
  date: string
  sales: {
    count: number
    subtotal: number
    discount: number
    serviceCharge: number
    tax: number
    rounding: number
    total: number
    averageSale: number
  }
  byPayment: { payment: Payment; count: number; total: number }[]
  voided: { count: number; total: number }
  topItems: { productId: number; name: string; quantity: number; revenue: number }[]
  purchases: { count: number; total: number }
  generatedAt: string
}

// The API sends timestamps as ISO strings; these turn them into Dates.
export type Wire<T, K extends keyof T> = Omit<T, K> & { [P in K]: null extends T[P] ? string | null : string }
/** A transaction as the API sends it. */
export type TransactionWire = Wire<Transaction, "at" | "voidedAt">

export const toTransaction = (tx: TransactionWire): Transaction => ({
  ...tx,
  at: new Date(tx.at),
  voidedAt: tx.voidedAt ? new Date(tx.voidedAt) : null,
})

export const toMovement = (m: Wire<Movement, "created">): Movement => ({ ...m, created: new Date(m.created) })

export const toRecipe = (r: Wire<RecipeLine, "createdAt" | "updatedAt">): RecipeLine => ({
  ...r,
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
})

export const toForecast = (f: Wire<Forecast, "generatedAt">): Forecast => ({
  ...f,
  generatedAt: new Date(f.generatedAt),
})

export const INGREDIENTS = "Ingredients"

export const isIngredient = (product: Product) => product.category === INGREDIENTS

/** One row of the ERD `recipe` table (columns in camelCase). */
export type RecipeLine = {
  recipeId: number
  /** Finished product made by this recipe (FK products). */
  productId: number
  /** Ingredient or component, also a product (FK products). */
  ingredientId: number
  /** Amount of the ingredient needed for ONE unit of the product; decimal(12,3), > 0. */
  quantityRequired: number
  /** Base unit, e.g. g, ml or piece; varchar(20), not blank. */
  unit: string
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export type Settings = Rates & { targetMargin: number }
