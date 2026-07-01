import { supabase } from "./supabaseClient"

export const API_URL =
  (typeof window !== "undefined" && window.MEDIFLOW_API_URL) ||
  import.meta.env?.VITE_MEDIFLOW_API_URL ||
  "http://localhost:8000"

export async function callApi(path, options = {}) {
  if (!supabase) {
    throw new Error("Chưa cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY ở frontend.")
  }

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const session = data?.session
  if (!session?.access_token) {
    const authError = new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
    authError.code = "AUTH_REQUIRED"
    throw authError
  }

  const headers = new Headers(options.headers || {})
  headers.set("Authorization", `Bearer ${session.access_token}`)

  // Không tự đặt Content-Type cho FormData vì trình duyệt phải tự thêm boundary.
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers })

  if (response.status === 401) {
    await supabase.auth.signOut()
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mp-auth-expired"))
    }
  }

  return response
}

export async function callJson(path, { method = "GET", body, ...options } = {}) {
  const response = await callApi(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options,
  })

  let data = null
  try {
    data = await response.json()
  } catch {
    // Giữ null để báo lỗi có ý nghĩa phía dưới.
  }

  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `API ${response.status}`)
  }

  return data
}
