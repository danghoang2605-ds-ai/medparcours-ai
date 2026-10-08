// Bilingual UI (Vietnamese / English) without touching component logic.
//
// The app was written in Vietnamese. Instead of wrapping ~1,100 strings in t()
// calls (and risking logic that compares strings), a MutationObserver swaps
// rendered Vietnamese text nodes and a few attributes for their English
// equivalents from i18n/en.json. Switching back restores the originals.
//
// Patient data from documents is NOT translated: clinical content stays in
// the language of the source record (avoids silent mistranslation of drug
// names, values and diagnoses). The chat assistant answers in the UI language.

import EN from "./i18n/en.json"
import GENERATED_PATTERNS from "./i18n/patterns.json"  // from rule-engine f-strings

const STORAGE_KEY = "mp_lang"
const ATTRS = ["title", "placeholder", "aria-label"]
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE"])

// Dynamic strings built from templates (numbers/names inside).
const PATTERNS = [
  [/^Đang đọc (\d+)\/(\d+) trang$/, "Reading page $1/$2"],
  [/^Đã cập nhật hồ sơ — lần cập nhật thứ (\d+)$/, "Record updated: update #$1"],
  [/^Bản demo công khai đang giới hạn lượt dùng\. Thử lại sau (\d+) giây\.$/, "The public demo is rate-limited. Try again in $1 seconds."],
  [/^(\d+) tuổi$/, "$1 y/o"],
  [/^(\d+) ngày$/, "$1 days"],
  [/^(\d+) lần$/, "$1 times"],
  [/^Giai đoạn (\d)$/, "Phase $1"],
  [/^Lấy mẫu: (.+)$/, "Sampled: $1"],
  [/^Bình thường (.+)$/, "Normal $1"],
  [/^Mục tiêu (.+)$/, "Target $1"],
  [/^ra viện: (.+)$/, "discharge: $1"],
  [/^Hậu phẫu ngày (\d+)$/, "Post-op day $1"],
  [/^Sau mổ (\d+) ngày$/, "Post-op day $1"],
  [/^Tái khám (\d+) tuần$/, "Follow-up at $1 weeks"],
  [/^Tuổi (\d+)$/, "Age $1"],
  [/^Tuổi (\d+) \(dưới 65\)$/, "Age $1 (under 65)"],
  [/^eGFR ([\d.]+) mL\/phút\/1\.73m2 \(CKD-EPI 2021\)$/, "eGFR $1 mL/min/1.73m2 (CKD-EPI 2021)"],
  [/^Phẫu thuật lúc (.+)$/, "Surgery at $1"],
  [/^(\d+) tuần \/ (\d+) tháng$/, "$1 weeks / $2 months"],
  [/^Máy chủ trả lỗi \(mã (\d+)\)\. Hãy thử lại\.$/, "Server error (code $1). Please try again."],
  ...GENERATED_PATTERNS.map(([re, rep]) => [new RegExp(re), rep]),
]

// Fragment substitutions for sentences assembled at runtime by the client-side
// rule engine (numbers and dates interpolated). Applied in order; the result is
// used ONLY if no Vietnamese is left, so a node is never half-translated.
const FRAGMENTS = [
  [/NT-proBNP ([\d.]+) pg\/mL đo ở giai đoạn hậu phẫu\. Tăng NT-proBNP ngay sau mổ tim lớn là phổ biến, có thể không phản ánh suy tim mạn, cần đối chiếu lâm sàng\./g, "NT-proBNP $1 pg/mL measured post-op. Elevated NT-proBNP right after major cardiac surgery is common and may not reflect chronic heart failure; correlate clinically."],
  [/Bệnh nhân hiện ở giai đoạn ngoại trú nhưng chưa có NT-proBNP đo lại sau xuất viện để đánh giá suy tim hiện tại\./g, "The patient is now outpatient but has no repeat NT-proBNP after discharge to assess current heart failure."],
  [/Chênh áp qua van giảm từ ([\d.]+) xuống ([\d.]+) mmHg \(van hoạt động tốt sau thay\)\./g, "Transvalvular gradient fell from $1 to $2 mmHg (prosthetic valve functioning well)."],
  [/EF tụt thấp nhất còn ([\d.]+)% \(([^,]+), bất thường\), sau đó hồi phục lên ([\d.]+)%\./g, "EF dropped to a low of $1% ($2, abnormal), then recovered to $3%."],
  [/Cần xử trí theo bệnh cảnh tổng thể thay vì từng chỉ số riêng lẻ, đối chiếu lâm sàng\./g, "Manage according to the overall clinical picture rather than individual values; correlate clinically."],
  [/Hỗ trợ quyết định, không tự kê đơn hoặc chỉnh liều chống đông\. Mọi điểm số cần bác sĩ xác nhận trước khi áp dụng\./g, "Decision support only; does not prescribe or adjust anticoagulation. All scores require physician confirmation before use."],
  [/Cùng thời điểm \(theo dõi ngoại trú\) ghi nhận:/g, "At the same time point (outpatient follow-up):"],
  [/Cùng thời điểm \(([^)]*)\) ghi nhận:/g, "At the same time point ($1):"],
  [/gánh nặng suy tim \(NT-proBNP tăng\)/g, "heart failure burden (elevated NT-proBNP)"],
  [/hạ natri máu/g, "hyponatremia"], [/tăng kali máu/g, "hyperkalemia"], [/suy giảm chức năng thận/g, "impaired renal function"],
  [/phản ứng viêm mạnh/g, "strong inflammatory response"], [/dấu hiệu sinh tồn bất thường/g, "abnormal vital signs"],
  [/tháng thứ (\d+) \(khoảng (\d+) ngày\) sau ra viện/g, "month $1 (about $2 days) after discharge"],
  [/^Từ (.+) đến nay \((\d+) ngày\)$/g, "From $1 to date ($2 days)"],
  [/^Ra viện: /g, "Discharged: "], [/^Vào viện: /g, "Admitted: "], [/^Trước /g, "Before "], [/^đến /g, "to "],
  [/chênh áp ([\d./]+) mmHg - Van tốt/g, "gradient $1 mmHg - valve OK"],
  [/chênh áp/g, "gradient"],
  [/Trong mục tiêu điều trị \(Van ĐMC cơ học (.+?) — (.+?) \(nguy cơ thấp\)\)/g, "Within therapeutic target (mechanical aortic valve $1, $2 (low risk))"],
  [/Trong mục tiêu điều trị/g, "Within therapeutic target"], [/Trên mục tiêu/g, "Above target"], [/Dưới mục tiêu/g, "Below target"],
  [/\(dưới ([\d.]+)\)/g, "(below $1)"], [/\(trên ([\d.]+)\)/g, "(above $1)"], [/\(chưa về dưới ([\d.]+)\)/g, "(not yet below $1)"],
  [/nhịp thở ([\d.]+) lần\/phút/g, "respiratory rate $1/min"],
  [/^Huyết áp ([\d/]+), lactate ([\d.]+) mmol\/L, nhiệt độ ([\d.]+) độ$/g, "BP $1, lactate $2 mmol/L, temperature $3 °C"],
  [/^Giới tính ghi nhận: /g, "Recorded sex: "], [/^Huyết áp tâm thu ghi nhận gần nhất: /g, "Latest recorded systolic BP: "],
  [/^Dải INR ghi nhận: ([\d.]+) đến ([\d.]+) \(chênh ([\d.]+)\)$/g, "Recorded INR range: $1 to $2 (spread $3)"],
  [/Đã chuyển sang chế độ: /g, "Switched to mode: "],
  [/Học vụ \(Giảng dạy\)/g, "Teaching"], [/Hội chẩn AI/g, "AI case conference"], [/Bác sĩ \(Lâm sàng\)/g, "Doctor (Clinical)"],
  [/ đang trình bày nhận định\.\.\./g, " is presenting an assessment..."],
  [/Phẫu thuật Tim/g, "Cardiac surgery"], [/Hồi sức tích cực/g, "Intensive care"], [/Truyền nhiễm/g, "Infectious diseases"],
  [/Huyết học - Đông máu/g, "Hematology - Coagulation"], [/Thận - Tiết niệu/g, "Nephrology - Urology"],
  [/Dinh dưỡng lâm sàng/g, "Clinical nutrition"], [/Tim mạch/g, "Cardiology"],
  [/, (\d+) tuổi, /g, ", $1 y/o, "], [/Địa chỉ:/g, "Address:"], [/Vào viện:/g, "Admitted:"], [/Số bệnh án:/g, "Record no.:"],
  [/Dấu hiệu sinh tồn/g, "Vital signs"], [/(^|[\s:(])HA (?=\d)/g, "$1BP "], [/mạch (\d+) l\/ph/g, "pulse $1 bpm"],
  [/nhiệt độ/g, "temperature"], [/nhịp thở/g, "respiratory rate"],
  [/^Ngoại khoa \(([^)]*)\):/g, "Surgery ($1):"], [/^Nội khoa:/g, "Medical:"],
  [/ đến /g, " to "],
]
const HAS_VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i

function detectDefault() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "vi" || saved === "en") return saved
  } catch {}
  return "en" // English first; Vietnamese is one click away
}

const EN_SENTENCES = Object.fromEntries(
  Object.entries(EN).filter(([k]) => k.length > 25 && /[.!?]$/.test(k)).sort((a, b) => b[0].length - a[0].length)
)

let lang = typeof window !== "undefined" ? detectDefault() : "en"
const listeners = new Set()
const originalText = new WeakMap()   // Text node -> Vietnamese source
const originalAttr = new WeakMap()   // Element -> { attr: Vietnamese source }

export const getLang = () => lang
export const onLangChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

export function translate(text) {
  if (!text) return null
  const key = text.trim()
  if (!key) return null
  const hit = EN[key]
  if (hit !== undefined) return text.replace(key, hit)
  if (!HAS_VI.test(key)) return null
  let out = key
  for (const [re, rep] of PATTERNS) {
    if (!re.test(out)) continue
    // Interpolated values (e.g. a valve position) are translated via the dictionary too.
    out = out.replace(re, (...m) => rep.replace(/\$(\d)/g, (_, n) => {
      const g = m[Number(n)] ?? ""
      return EN[g.trim()] ?? g
    }))
    break
  }
  if (HAS_VI.test(out)) {
    for (const [re, rep] of FRAGMENTS) out = out.replace(re, rep)
    for (const [vi, en] of Object.entries(EN_SENTENCES)) if (out.includes(vi)) out = out.split(vi).join(en)
  }
  // Never show a half-translated node: if anything Vietnamese is left, keep the original.
  return HAS_VI.test(out) ? null : text.replace(key, out)
}

function skip(el) {
  for (let n = el; n && n.tagName !== "BODY"; n = n.parentElement) {
    if (SKIP_TAGS.has(n.tagName) || n.isContentEditable || n.hasAttribute?.("data-no-i18n")) return true
  }
  return false
}

function handleText(node) {
  const parent = node.parentElement
  if (!parent || skip(parent)) return
  if (lang === "en") {
    const tr = translate(node.nodeValue)
    if (tr !== null && tr !== node.nodeValue) {
      originalText.set(node, node.nodeValue)
      node.nodeValue = tr
    }
  } else if (originalText.has(node)) {
    node.nodeValue = originalText.get(node)
    originalText.delete(node)
  }
}

function handleAttrs(el) {
  if (skip(el)) return
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue
    const store = originalAttr.get(el) || {}
    if (lang === "en") {
      const tr = translate(el.getAttribute(a))
      if (tr !== null && tr !== el.getAttribute(a)) {
        store[a] = el.getAttribute(a)
        originalAttr.set(el, store)
        el.setAttribute(a, tr)
      }
    } else if (store[a] !== undefined) {
      el.setAttribute(a, store[a])
      delete store[a]
    }
  }
}

function walk(root) {
  if (root.nodeType === 3) return handleText(root)          // TEXT_NODE
  if (root.nodeType !== 1) return                           // ELEMENT_NODE
  handleAttrs(root)
  const doc = root.ownerDocument || document
  const tw = doc.createTreeWalker(root, 1 | 4)               // SHOW_ELEMENT | SHOW_TEXT
  let n
  while ((n = tw.nextNode())) n.nodeType === 3 ? handleText(n) : handleAttrs(n)
}

let observer = null
export function startI18n() {
  if (observer || typeof document === "undefined") return
  document.documentElement.lang = lang
  observer = new MutationObserver((records) => {
    if (lang !== "en") return
    for (const r of records) {
      if (r.type === "characterData") handleText(r.target)
      else if (r.type === "attributes") handleAttrs(r.target)
      else r.addedNodes.forEach(walk)
    }
  })
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ATTRS,
  })
  if (lang === "en") walk(document.body)
}

export function setLang(next) {
  if (next !== "vi" && next !== "en") return
  lang = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  document.documentElement.lang = next
  walk(document.body)
  listeners.forEach(fn => fn(next))
}

// Translate a separate document once (e.g. a print/export window).
export function translateDocument(doc) {
  if (lang !== "en" || !doc?.body) return
  doc.documentElement.lang = "en"
  walk(doc.body)
  if (doc.title) doc.title = translate(doc.title) || doc.title
}
