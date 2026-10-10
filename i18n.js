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
  // Sentences React assembles from several text nodes (see processRun).
  [/^Phân tích 1 tài liệu$/, "Analyze 1 document"],
  [/^Phân tích (\d+) tài liệu$/, "Analyze $1 documents"],
  [/^1 tài liệu đã chọn$/, "1 document selected"],
  [/^(\d+) tài liệu đã chọn$/, "$1 documents selected"],
  [/^(\d+) từ · lời dặn kèm hồ sơ$/, "$1 words · attached to the record as instructions"],
  [/^Chi tiết (\d+) lượt siêu âm$/, "All $1 echo studies"],
  [/^1 cảnh báo cao$/, "1 high-priority alert"], [/^(\d+) cảnh báo cao$/, "$1 high-priority alerts"],
  [/^1 biến cố$/, "1 event"], [/^(\d+) biến cố$/, "$1 events"],
  [/^(\d+) cần xử lý$/, "$1 need action"], [/^(\d+) theo dõi$/, "$1 to monitor"],
  [/^Giai đoạn (\d): (.+)$/, "Phase $1: $2"],
  [/^Kết luận Giai đoạn (\d):$/, "Phase $1 conclusion:"],
  [/^Xóa (\d+) mục đã chọn$/, "Delete $1 selected"],
  [/^Đã cập nhật 1 lần$/, "1 update"], [/^Đã cập nhật (\d+) lần$/, "$1 updates"],
  [/^Cập nhật gần nhất: (.+)$/, "Last updated $1"],
  [/^Vào viện (\S+)$/, "Admitted $1"],
  [/^Xóa 1 mục đã chọn$/, "Delete 1 selected"],
  [/^Phân tích hồ sơ mới$/, "Analyze a new record"],
  [/^(\d+) tuổi, (.+) · BA (.+)$/, "$1 y/o, $2 · MRN $3"],
  [/^Vào viện (.+) · (.+)$/, "Admitted $1 · $2"],
  [/^(\d+) ký tự · tự lưu$/, "$1 characters · saved automatically"], [/^(\d+) ký tự$/, "$1 characters"],
  [/^Đích điều trị: (.+) — (\d+) lần trong đích$/, "Target $1 · $2 readings in range"],
  [/^Từ (.+) đến nay \((\d+) ngày\)$/, "Since $1 ($2 days)"],
  [/^Từ (.+?) đến (.+)$/, "From $1 to $2"], [/^Từ (.+)$/, "Since $1"],
  [/^Hiện tại: (.+)$/, "Now: $1"],
  [/^Trước: (.+)$/, "Before: $1"],
  [/^Tin cậy (\d+)%$/, "Confidence $1%"], [/^Ưu tiên (\d+)$/, "Priority $1"], [/^Bước (\d+)$/, "Step $1"],
  [/^Điều phối viên · Mức đồng thuận: (.+)$/, "Moderator · Level of agreement: $1"],
  [/^(\d+) tuổi • (.+?) • (.+)$/, "$1 y/o • $2 • $3"], [/^(\d+) tuổi, (.+)$/, "$1 y/o, $2"],
  [/^Ngày sinh: (.+)$/, "Date of birth: $1"], [/^Số bệnh án: (.+)$/, "MRN: $1"],
  [/^Lần đo đầu \((.+)\)$/, "First reading ($1)"], [/^Gần nhất \((.+)\)$/, "Latest ($1)"],
  [/^Tương tác thuốc \((\d+)\)$/, "Drug interactions ($1)"],
  [/^Chỉnh liều theo chức năng thận \((\d+)\)$/, "Renal dose adjustments ($1)"],
  [/^Trùng nhóm thuốc \((\d+)\)$/, "Duplicate drug classes ($1)"],
  [/^Phù hợp khuyến cáo \((\d+)\)$/, "Guideline-aligned ($1)"],
  [/^(.+) \(eGFR hiện tại: (.+)\)$/, "$1 (current eGFR: $2)"],
  [/^Ngày (\d.+)$/, "Date $1"],
  [/^(\d+)\/(\d+) khoa$/, "$1/$2 specialties"],
  [/^Kali (.+)$/, "Potassium $1"],
  [/^Không có hồ sơ đã lưu với số (.+)\.$/, "No saved record with MRN $1."],
  [/^Hồ sơ (.+) đã được lưu\. Dùng "Cập nhật hồ sơ" để thêm tài liệu\.$/, "Record $1 is already saved. Use \"Update record\" to add documents."],
  [/^Đồng bộ đám mây thất bại \(mã (\d+)\)$/, "Cloud sync failed (code $1)"],
  [/^Định dạng (.+) chưa được hỗ trợ\. Hỗ trợ: PDF, Word \(\.docx\), Excel \(\.xlsx\), PowerPoint \(\.pptx\), ảnh \(\.png\/\.jpg\)\.$/, "The $1 format isn't supported. Supported: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), images (.png/.jpg)."],
  [/^Máy chủ phân tích gặp lỗi \(mã (\d+)\)\. Hãy thử lại sau giây lát\.$/, "The analysis server returned an error (code $1). Please try again in a moment."],
  [/^Máy chủ phân tích gặp lỗi \(mã (\d+)\)\. File có thể quá lớn để tải lên trực tiếp; nếu là PDF scan, hãy dùng bản PDF có chữ\.$/, "The analysis server returned an error (code $1). The file may be too large to upload directly; if it's a scanned PDF, use one with selectable text."],
  [/^Chỉ xem mức (.+)$/, "Show only: $1"],
  [/^Siêu âm tim (.+)$/, "Echocardiogram ($1)"],
  [/^(.+) - (.+) \((\d+) ngày\)$/, "$1 - $2 ($3 days)"],
  [/^([+-]?[\d.]+%?) tăng$/, "$1 increase"], [/^([+-]?[\d.]+%?) giảm$/, "$1 decrease"],
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
  [/ — Nguồn: /g, " — Source: "], [/^Nguồn: /g, "Source: "], [/ESC suy tim/g, "ESC Heart Failure"], [/^Căn cứ: /g, "Basis: "], [/ \| Thận trọng: /g, " | Caution: "],
  [/: tổng (\d+)\/(\d+) điểm/g, ": total $1/$2 points"],
  [/Đây là vấn đề đã được hệ thống đánh giá là cần chú ý — nên xử trí theo đúng hướng ưu tiên đã nêu, không trì hoãn hoặc bỏ qua\./g, "The system flagged this as a problem that needs attention; act on the stated priority rather than delaying or skipping it."],
  [/Học vụ \(Giảng dạy\)/g, "Teaching"], [/Hội chẩn AI/g, "AI case conference"], [/Bác sĩ \(Lâm sàng\)/g, "Clinician"],
  [/ đang trình bày nhận định\.\.\./g, " is presenting an assessment..."],
  [/Phẫu thuật Tim/g, "Cardiac surgery"], [/Hồi sức tích cực/g, "Intensive care"], [/Truyền nhiễm/g, "Infectious diseases"],
  [/Huyết học - Đông máu/g, "Hematology - Coagulation"], [/Thận - Tiết niệu/g, "Nephrology - Urology"],
  [/Dinh dưỡng lâm sàng/g, "Clinical nutrition"], [/Tim mạch/g, "Cardiology"],
  [/, (\d+) tuổi, /g, ", $1 y/o, "], [/Địa chỉ:/g, "Address:"], [/Vào viện:/g, "Admitted:"], [/Số bệnh án:/g, "MRN:"],
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
const originalAttr = new WeakMap()   // Element -> { attr: Vietnamese source }

export const getLang = () => lang
export const onLangChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

// Coarse separators first (keeps whole sentences together), then fine ones.
const SEPARATORS = [
  /(\s[—–-]\s|\s\|\s)/,
  /(\s[—–-]\s|\[|\]\s?)/,
  /(\s[—–-]\s|\[|\]\s?|:\s)/,
  /(\s[—–-]\s|\[|\]\s?|:\s|;\s|\.\s|,\s|\s\(|\)\s?)/,
]

// Apply known sentences and fragment rules. Either order can be the one that
// works (a fragment may break a known sentence, or vice versa), so try both.
function substitute(text) {
  const sentences = s => { for (const [vi, en] of Object.entries(EN_SENTENCES)) if (s.includes(vi)) s = s.split(vi).join(en); return s }
  const fragments = s => { for (const [re, rep] of FRAGMENTS) s = s.replace(re, rep); return s }
  const a = fragments(sentences(text))
  if (!HAS_VI.test(a)) return a
  const b = sentences(fragments(text))
  return HAS_VI.test(b) ? a : b
}

function translatePiece(p) {
  if (!p || !HAS_VI.test(p)) return p
  const t = p.trim()
  const hit = EN[t] ?? EN[t.charAt(0).toUpperCase() + t.slice(1)]
  if (hit !== undefined) return p.replace(t, /^[a-zà-ỹđ]/.test(t) ? hit.charAt(0).toLowerCase() + hit.slice(1) : hit)
  let f = t
  for (const [re, rep] of PATTERNS) if (re.test(f)) { f = f.replace(re, rep); break }
  if (HAS_VI.test(f)) f = substitute(f)
  return p.replace(t, f)
}

// Split on the coarsest separator first; only pieces that are still
// untranslated are split further, so whole sentences stay intact.
function translateSegments(key, level = 0) {
  if (level >= SEPARATORS.length) return null
  const parts = key.split(SEPARATORS[level])
  if (parts.length < 2) return translateSegments(key, level + 1)
  const out = parts.map(p => {
    const t = translatePiece(p)
    if (!HAS_VI.test(t)) return t
    // Recurse on the partially translated piece so whole sentences already
    // replaced are not split apart again.
    return translateSegments(t, level + 1) ?? translateSegments(p, level + 1) ?? t
  }).join("")
  return HAS_VI.test(out) ? null : out
}

export function translate(text) {
  if (!text) return null
  const key = text.trim()
  if (!key) return null
  const hit = EN[key]
  if (hit !== undefined) return text.replace(key, hit)
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
  if (out === key && !HAS_VI.test(key)) return null   // nothing Vietnamese to translate
  if (HAS_VI.test(out)) out = substitute(out)
  // Last resort: sentences glued from parts ("[Monitor] Low sodium — Source: Labs").
  if (HAS_VI.test(out)) out = translateSegments(out) ?? translateSegments(key) ?? out
  // Never show a half-translated node: if anything Vietnamese is left, keep the original.
  return HAS_VI.test(out) ? null : text.replace(key, out)
}

function skip(el) {
  for (let n = el; n && n.tagName !== "BODY"; n = n.parentElement) {
    if (SKIP_TAGS.has(n.tagName) || n.isContentEditable || n.hasAttribute?.("data-no-i18n")) return true
  }
  return false
}

// React renders "Analyze {n} documents" as several adjacent text nodes. Each
// run of adjacent text nodes is translated as ONE string first (so word order
// can change), then node by node as a fallback. SRC keeps the Vietnamese
// source of every node we changed; WROTE remembers what we wrote, so a later
// React update can be told apart from our own write.
const SRC = new WeakMap()
const WROTE = new WeakMap()

function srcOf(n) { return SRC.has(n) ? SRC.get(n) : n.nodeValue }

function write(n, value, source) {
  SRC.set(n, source)
  WROTE.set(n, value)
  if (n.nodeValue !== value) n.nodeValue = value
}

function restore(n) {
  if (!SRC.has(n)) return
  const v = SRC.get(n)
  SRC.delete(n); WROTE.delete(n)
  if (n.nodeValue !== v) n.nodeValue = v
}

function processRun(nodes) {
  const srcs = nodes.map(srcOf)
  if (lang !== "en") { nodes.forEach(restore); return }
  if (nodes.length > 1) {
    const joined = srcs.join("")
    {
      const tr = translate(joined)
      if (tr !== null) { nodes.forEach((n, i) => write(n, i === 0 ? tr : "", srcs[i])); return }
    }
  }
  nodes.forEach((n, i) => {
    const tr = translate(srcs[i])
    if (tr !== null) write(n, tr, srcs[i])
    else restore(n)
  })
}

function applyParent(parent) {
  if (!parent || skip(parent)) return
  let run = []
  const flush = () => { if (run.length) processRun(run); run = [] }
  for (const k of parent.childNodes) { if (k.nodeType === 3) run.push(k); else flush() }
  flush()
}

function onTextMutation(node) {
  // React replaced the text: the new value is the new Vietnamese source.
  if (SRC.has(node) && node.nodeValue !== WROTE.get(node)) { SRC.delete(node); WROTE.delete(node) }
  applyParent(node.parentElement)
}

function handleAttrs(el) {
  // Placeholders live on <input>/<textarea>, so only opt-outs and editable regions block attributes.
  for (let n = el; n && n.tagName !== "BODY"; n = n.parentElement) {
    if (n.isContentEditable || n.hasAttribute?.("data-no-i18n")) return
  }
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
  if (root.nodeType === 3) return applyParent(root.parentElement)   // TEXT_NODE
  if (root.nodeType !== 1) return                                     // ELEMENT_NODE
  handleAttrs(root)
  applyParent(root)
  const doc = root.ownerDocument || document
  const tw = doc.createTreeWalker(root, 1)                             // SHOW_ELEMENT
  let n
  while ((n = tw.nextNode())) { handleAttrs(n); applyParent(n) }
}

let observer = null
export function startI18n() {
  if (observer || typeof document === "undefined") return
  document.documentElement.lang = lang
  observer = new MutationObserver((records) => {
    if (lang !== "en") return
    for (const r of records) {
      if (r.type === "characterData") onTextMutation(r.target)
      else if (r.type === "attributes") handleAttrs(r.target)
      else { r.addedNodes.forEach(walk); if (r.target.nodeType === 1) applyParent(r.target) }
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
