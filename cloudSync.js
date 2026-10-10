// Optional cloud copy of the browser's records (Turso, via the backend).
//
// There are no accounts. This browser generates a random sync key; the server
// stores records under a hash of it. Paste the same key on another device to
// see the same records. Anyone with the key can read the records, so treat it
// like a password.

import { callApi } from "./api"

const KEY = "mp_workspace"
const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/

function generateKey() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function getSyncKey() {
  let k = null
  try { k = localStorage.getItem(KEY) } catch {}
  if (!k || !KEY_RE.test(k)) {
    k = generateKey()
    try { localStorage.setItem(KEY, k) } catch {}
  }
  return k
}

export function setSyncKey(k) {
  const v = (k || "").trim()
  if (!KEY_RE.test(v)) throw new Error("Khóa đồng bộ không hợp lệ")
  localStorage.setItem(KEY, v)
  return v
}

let statusPromise = null
export function cloudStatus(force = false) {
  if (force || !statusPromise) {
    statusPromise = callApi("/cloud/status")
      .then(r => (r.ok ? r.json() : { enabled: false }))
      .catch(() => ({ enabled: false }))
  }
  return statusPromise
}

async function request(path, options = {}) {
  const st = await cloudStatus()
  if (!st.enabled) return null
  const res = await callApi(path, { ...options, headers: { ...(options.headers || {}), "X-Workspace": getSyncKey() } })
  if (res.status === 404) return { notFound: true }
  if (!res.ok) {
    let msg = `Đồng bộ đám mây thất bại (mã ${res.status})`
    try { msg = (await res.json()).detail || msg } catch {}
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return res.json()
}

const enc = encodeURIComponent

export const cloud = {
  list: () => request("/cloud/records"),
  get: (id) => request(`/cloud/records/${enc(id)}`),
  put: (rec) => request(`/cloud/records/${enc(rec.so_benh_an)}`, { method: "PUT", body: JSON.stringify(rec) }),
  remove: (id) => request(`/cloud/records/${enc(id)}`, { method: "DELETE" }),
}
