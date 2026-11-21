import { Router } from "express"
import { config } from "../config.js"
import { ApiError } from "../errors.js"

// Reserved for the payment gateway (later). While PAYMENTS_GATEWAY_ENABLED is false the
// route answers 404, so nothing can mark a sale as paid from outside.
// To connect a gateway later:
//   1. verify the gateway's signature header on every call (never trust the body alone)
//   2. look up the sale by the gateway's reference and set its payment status to PAID
//   3. make it idempotent: the gateway may send the same event more than once
export const paymentsRouter = Router()

paymentsRouter.post("/payments/webhook", (_req, _res) => {
  if (!config.paymentsGatewayEnabled) throw new ApiError(404, "Not found")
  throw new ApiError(501, "Payment gateway not connected yet")
})
