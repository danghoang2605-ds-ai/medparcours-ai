import { getLang } from "./i18n"

// Backend base URL. Single source of truth for the whole frontend.
// Override at runtime with window.MEDIFLOW_API_URL (set in index.html / env.js),
// e.g. "http://localhost:8000" for local development or Docker.
const DEFAULT_API_URL = "https://danghoang2605-mediflow-ai.hf.space"

export const API_URL =
  (typeof window !== "undefined" && window.MEDIFLOW_API_URL) || DEFAULT_API_URL

// The backend is public and stateless: no login, no tokens.
export async function callApi(path, options = {}) {
  const headers = new Headers(options.headers || {})
  headers.set("X-Lang", getLang())  // the assistant answers in the UI language
  // Never set Content-Type for FormData; the browser adds the multipart boundary.
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (response.status === 429 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("mp-rate-limited", {
      detail: { retryAfter: Number(response.headers.get("Retry-After")) || 60 },
    }))
  }
  return response
}
