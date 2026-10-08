// Patient records are stored ONLY in this browser (IndexedDB).
// The backend never persists patient data. Clearing site data deletes them.
//
// Record shape:
// { so_benh_an, ho_ten, ten_hien_thi, nhom_benh, report, analysis,
//   so_lan_cap_nhat, tao_luc, cap_nhat_luc,
//   history: [{ report, nguon, thoi_diem }],   // snapshots BEFORE each merge
//   chat:    [{ role, content, thoi_diem }] }

const DB_NAME = "medparcours"
const STORE = "patients"
const MAX_HISTORY = 10
const MAX_CHAT = 200

let dbPromise = null
function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available in this browser."))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "so_benh_an" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    let result
    Promise.resolve(fn(store, v => { result = v })).catch(reject)
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const now = () => new Date().toISOString()
const notFound = (id) => Object.assign(new Error(`No saved record for ${id}.`), { status: 404 })

function keyOf(report) {
  return String(report?.thong_tin_benh_nhan?.so_benh_an || "").trim()
}
function groupLabel(analysis) {
  const ps = analysis?.active_profiles || []
  const names = ps.map(p => (typeof p === "string" ? p : p?.ten_hien_thi)).filter(Boolean)
  return [...new Set(names)].join(", ")
}

async function get(id) {
  return tx("readonly", async (s, done) => done(await reqP(s.get(id))))
}
async function put(rec) {
  return tx("readwrite", async (s, done) => { await reqP(s.put(rec)); done(rec) })
}

export const localStore = {
  async save(report, analysis) {
    const id = keyOf(report)
    if (!id) throw Object.assign(new Error("This record has no record number (so_benh_an), so it cannot be saved."), { status: 400 })
    if (await get(id)) throw Object.assign(new Error(`Record ${id} is already saved. Use "Update record" to add documents.`), { status: 409 })
    const t = now()
    const rec = {
      so_benh_an: id, ho_ten: report?.thong_tin_benh_nhan?.ho_ten || "", ten_hien_thi: null,
      nhom_benh: groupLabel(analysis), report, analysis: analysis || null,
      so_lan_cap_nhat: 1, tao_luc: t, cap_nhat_luc: t, history: [], chat: [],
    }
    await put(rec)
    return { success: true, so_benh_an: id, so_lan_cap_nhat: 1, cap_nhat_luc: t, storage: "browser" }
  },

  async get(id) {
    const rec = await get(id)
    if (!rec) throw notFound(id)
    return { success: true, storage: "browser", ...rec }
  },

  async list(limit = 100) {
    const all = await tx("readonly", async (s, done) => done(await reqP(s.getAll())))
    const patients = (all || [])
      .sort((a, b) => String(b.cap_nhat_luc).localeCompare(String(a.cap_nhat_luc)))
      .slice(0, limit)
      .map(r => ({
        so_benh_an: r.so_benh_an, ho_ten: r.ten_hien_thi || r.ho_ten, ho_ten_goc: r.ho_ten,
        ten_hien_thi: r.ten_hien_thi, so_lan_cap_nhat: r.so_lan_cap_nhat,
        tao_luc: r.tao_luc, cap_nhat_luc: r.cap_nhat_luc, nhom_benh: r.nhom_benh || "",
      }))
    return { success: true, patients, storage_available: true, storage: "browser" }
  },

  async remove(id) {
    if (!(await get(id))) throw notFound(id)
    await tx("readwrite", async (s, done) => { await reqP(s.delete(id)); done() })
    return { success: true, so_benh_an: id }
  },

  async rename(id, name) {
    const rec = await get(id)
    if (!rec) throw notFound(id)
    rec.ten_hien_thi = (name || "").trim() || null
    await put(rec)
    return { success: true, so_benh_an: id, ten_hien_thi: rec.ten_hien_thi }
  },

  // Apply a server-side merge result: snapshot the old report, store the new one.
  async applyMerge(id, merged, source) {
    const rec = await get(id)
    if (!rec) throw notFound(id)
    rec.history = [{ report: rec.report, nguon: source || "", thoi_diem: now() }, ...(rec.history || [])].slice(0, MAX_HISTORY)
    rec.report = merged.report
    rec.analysis = merged.analysis || null
    rec.nhom_benh = groupLabel(merged.analysis) || rec.nhom_benh
    rec.ho_ten = merged.report?.thong_tin_benh_nhan?.ho_ten || rec.ho_ten
    rec.so_lan_cap_nhat = (rec.so_lan_cap_nhat || 1) + 1
    rec.cap_nhat_luc = now()
    await put(rec)
    return { success: true, so_benh_an: id, so_lan_cap_nhat: rec.so_lan_cap_nhat, report: rec.report, analysis: rec.analysis }
  },

  async history(id, limit = 5) {
    const rec = await get(id)
    return { success: true, history: (rec?.history || []).slice(0, limit) }
  },

  async addChat(id, role, content) {
    const rec = await get(id)
    if (!rec) return { success: true } // unsaved record: chat is kept in memory only
    rec.chat = [...(rec.chat || []), { role, content, thoi_diem: now() }].slice(-MAX_CHAT)
    await put(rec)
    return { success: true }
  },

  async chat(id, limit = 100) {
    const rec = await get(id)
    return { success: true, messages: (rec?.chat || []).slice(-limit) }
  },

  async exportAll() {
    return tx("readonly", async (s, done) => done(await reqP(s.getAll())))
  },
}
