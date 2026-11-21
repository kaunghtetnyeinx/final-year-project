import { ZodError } from "zod"

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details)
export const notFound = (message = "Not found") => new ApiError(404, message)
export const conflict = (message) => new ApiError(409, message)

/** Parse req.body / req.query with a zod schema; a bad request gets a 400 with field messages. */
export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw badRequest(
      "Invalid request",
      result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
    )
  }
  return result.data
}

// Express error handler: known errors keep their message; anything else is logged and hidden.
export function errorHandler(error, req, res, _next) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message, details: error.details })
  }
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", details: error.issues })
  }
  // Errors from Express itself (e.g. 404 for a missing uploaded file) carry their own status.
  if (error?.status === 404) return res.status(404).json({ error: "Not found" })
  if (error?.expose && error.status >= 400 && error.status < 500 && error.type !== "entity.too.large") {
    return res.status(error.status).json({ error: error.message })
  }
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "That file or request is too large." })
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON" })
  }
  console.error(`[${req.method} ${req.originalUrl}]`, error)
  res.status(500).json({ error: "Internal server error" })
}
