// Browser twin of report_schema.py: repair the shape of a report before the UI
// renders it. Needed for records saved by older versions (browser or cloud)
// that never went through the backend normalizer. Pure and idempotent; valid
// reports pass through unchanged. Keep the field lists in sync with Python.

const NUMERIC = new Set(["rawVal", "ef", "grad_max", "grad_tb", "crp", "wbc", "so_luong", "vien_moi_ngay", "uu_tien",
  "tuoi", "ha_tt", "ha_ttr", "mach", "nhiet_do", "nhip_tho", "spo2", "lactate"])
const BOOLEAN = new Set(["canh_bao", "latest", "keo_dai"])
const SCALAR_ANY = new Set(["phase", "id"])
const NUM_LIST = new Set(["trend"])
const STR_LIST = new Set(["trendDates"])
const TEXT_FIELDS = ["chan_doan_chinh", "ly_do_vao_vien", "tien_su_benh", "tom_tat_toan_canh"]
const DICT_FIELDS = ["thong_tin_benh_nhan", "phau_thuat", "dau_hieu_sinh_ton", "xet_nghiem_truoc_mo", "ket_luan_giai_doan"]
const LIST_OF_DICTS = ["dien_bien_lam_sang", "vital_signs", "xet_nghiem_meta", "xet_nghiem_key", "canh_bao_nguy_co",
  "clinical_takeaway", "ly_luan_lam_sang", "hanh_dong_uu_tien", "thuoc_cuoi_ky"]
const TEXT_KEY = { clinical_takeaway: "txt", hanh_dong_uu_tien: "viec", thuoc_cuoi_ky: "ten_thuoc", ly_luan_lam_sang: "noi_dung" }

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v)

export function toNumber(v) {
  if (typeof v === "boolean") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string") {
    const m = v.match(/[-+]?\d+(?:[.,]\d+)?/)
    return m ? Number(m[0].replace(",", ".")) : null
  }
  return null
}

export function toText(v) {
  if (v === null || v === undefined || typeof v === "string") return v
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join("; ")
  if (isObj(v)) return Object.entries(v).map(([k, x]) => [k, toText(x)]).filter(([, t]) => t).map(([k, t]) => `${k}: ${t}`).join("; ")
  return String(v)
}

function value(key, v) {
  if (NUMERIC.has(key)) return toNumber(v)
  if (BOOLEAN.has(key)) return typeof v === "boolean" ? v : typeof v === "number" ? Boolean(v) : ["true", "1", "yes", "co", "có"].includes(String(v).trim().toLowerCase())
  if (NUM_LIST.has(key)) return (Array.isArray(v) ? v : [v]).map(toNumber).filter(n => n !== null)
  if (STR_LIST.has(key)) return (Array.isArray(v) ? v : v == null ? [] : [v]).filter(x => x != null).map(toText)
  if (SCALAR_ANY.has(key)) return typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) ? v : toText(v)
  return toText(v)
}

const dict = v => isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(k, x)])) : {}

function listOfDicts(v, textKey = "mo_ta") {
  if (isObj(v)) v = [v]
  if (!Array.isArray(v)) v = (v == null || v === "") ? [] : [v]
  const out = []
  for (const item of v) {
    if (isObj(item)) out.push(dict(item))
    else if (typeof item === "string" && item.trim()) out.push({ [textKey]: item })
  }
  return out
}

export function normalizeReport(report) {
  if (!isObj(report)) return {}
  const r = { ...report }
  for (const k of TEXT_FIELDS) if (k in r) r[k] = toText(r[k]) || ""
  for (const k of DICT_FIELDS) if (k in r) r[k] = dict(r[k])
  for (const k of LIST_OF_DICTS) if (k in r) r[k] = listOfDicts(r[k], TEXT_KEY[k] || "mo_ta")
  if ("sieu_am_tim" in r) {
    const raw = isObj(r.sieu_am_tim) ? r.sieu_am_tim : {}
    const { lan_kham, ...rest } = raw
    r.sieu_am_tim = { ...dict(rest), lan_kham: listOfDicts(lan_kham, "ghi_chu") }
  }
  if ("problem_status" in r) {
    const ps = isObj(r.problem_status) ? r.problem_status : {}
    r.problem_status = { hien_tai: listOfDicts(ps.hien_tai, "ten"), da_qua: listOfDicts(ps.da_qua, "ten") }
  }
  // Lab rows: the UI parses "val" (e.g. "116 g/L") and keys rows by "key".
  // The model sometimes returns only rawVal/unit; rebuild what is missing.
  for (const k of ["xet_nghiem_key", "xet_nghiem_meta"]) for (const lab of r[k] || []) {
    if (!lab.val && lab.rawVal != null) lab.val = `${lab.rawVal} ${lab.unit || ""}`.trim()
    if (!lab.key) lab.key = lab.desc || "?"
  }
  // The UI always reads patient info; guarantee the object and text fields exist.
  const info = isObj(r.thong_tin_benh_nhan) ? r.thong_tin_benh_nhan : {}
  if (info.so_benh_an != null) info.so_benh_an = String(toText(info.so_benh_an)).trim()
  r.thong_tin_benh_nhan = info
  return r
}
