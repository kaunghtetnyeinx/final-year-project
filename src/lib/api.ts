
/** Called when a request gets 401 (session expired or account disabled). */
let onSessionLost = () => {}
/** App registers what to do when the session is lost; returns an unregister function. */
export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler
  return () => {
    onSessionLost = () => {}
  }
}

/**
 * Calls the POS API. The session lives in an httpOnly cookie, so the browser
 * sends it automatically; the page never sees or stores the token.
 * Throws an Error carrying the server's message on any non-2xx reply.
 */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.")
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // A wrong password on the login form is also a 401, but that is not a lost session.
    if (response.status === 401 && !path.startsWith("/auth/")) onSessionLost()
    // Validation errors carry field messages in details; show the first one.
    const detail = Array.isArray(data.details) ? data.details[0]?.message : undefined
    throw new Error(
      detail ||
        data.error ||
        (response.status >= 500
          ? "The server is not responding. Please try again shortly."
          : `Request failed (${response.status})`),
    )
  }
  return data as T
}

/** UUID for a sale's requestId. randomUUID needs HTTPS (or localhost); fall back otherwise. */
export const newRequestId = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
