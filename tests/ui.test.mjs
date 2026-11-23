// UI smoke tests: render the real bundle in jsdom and check behavior a user would see.
import { test, before } from "node:test"
import assert from "node:assert/strict"
import * as esbuild from "esbuild"
import { JSDOM } from "jsdom"
import "fake-indexeddb/auto"
import { IDBFactory, IDBKeyRange } from "fake-indexeddb"
import { mkdirSync, copyFileSync, cpSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MOCK_REPORT_EN } from "../demoData.en.js"

const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i
const sleep = ms => new Promise(r => setTimeout(r, ms))
let bundle

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-ui-"))
  for (const f of ["App.jsx", "api.js", "localStore.js", "i18n.js", "demoData.en.js", "cloudSync.js", "reportSchema.js"]) copyFileSync(f, join(dir, f))
  copyFileSync("docker_setup/mount.jsx", join(dir, "mount.jsx"))
  cpSync("i18n", join(dir, "i18n"), { recursive: true })
  const out = await esbuild.build({ entryPoints: [join(dir, "mount.jsx")], bundle: true, write: false, format: "iife",
    loader: { ".jsx": "jsx" }, jsx: "automatic", define: { __BUILD_ID__: '"test"' }, logLevel: "error", nodePaths: [join(process.cwd(), "node_modules")] })
  bundle = out.outputFiles[0].text
})

function boot({ lang = "en", analyzeResponse, analyzeDelay = 0 } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true })
  const w = dom.window
  w.localStorage.setItem("mp_lang", lang)
  w.indexedDB = new IDBFactory(); w.IDBKeyRange = IDBKeyRange
  w.calls = []
  w.fetch = async (u) => (w.calls.push(String(u)), String(u).endsWith("/analyze") && analyzeDelay && await sleep(analyzeDelay), { ok: true, status: 200, headers: new Map(),
    json: async () => String(u).endsWith("/analyze") && analyzeResponse ? analyzeResponse : (String(u).endsWith("/cloud/status") ? { enabled: false } : {}) })
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  w.blobs = []; w.URL.createObjectURL = b => (w.blobs.push(b), "blob:x"); w.URL.revokeObjectURL = () => {}
  w.HTMLAnchorElement.prototype.click = function () {}
  w.errs = []; w.console.error = (...a) => w.errs.push(a.join(" ")); w.console.info = () => {}
  w.popups = []; w.open = () => { const d = new JSDOM("").window.document; const p = { document: d }; w.popups.push(p); return p }
  w.eval(bundle)
  return w
}
const viNodes = doc => { const out = []; const tw = doc.createTreeWalker(doc.body, 4); let n
  while ((n = tw.nextNode())) if (!n.parentElement.closest("style,script,[data-no-i18n]") && VI.test(n.nodeValue)) out.push(n.nodeValue.trim()); return out }
const button = (w, re) => [...w.document.querySelectorAll("button,span,div")].reverse().find(e => re.test(e.textContent.trim()) && e.textContent.length < 80)

async function upload(w) {
  const input = w.document.querySelector("input[type=file]")
  Object.defineProperty(input, "files", { value: [new w.File(["x"], "record.docx")] })
  input.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(300)
  button(w, /^Analyze/).click(); await sleep(1500)
}

test("opens in English with no login and no Vietnamese text", async () => {
  const w = boot(); await sleep(600)
  assert.doesNotMatch(w.document.body.textContent, /password|sign in/i)
  assert.deepEqual(viNodes(w.document), [])
})

test("English demo report renders without Vietnamese or errors", async () => {
  const w = boot(); await sleep(500)
  button(w, /^View demo/).click(); await sleep(1200)
  assert.match(w.document.body.textContent, /PATIENT A \(DEMO\)/)
  assert.deepEqual(viNodes(w.document), [])
  assert.deepEqual(w.errs, [])
})

test("report without a patient name still renders", async () => {
  const report = structuredClone(MOCK_REPORT_EN); report.thong_tin_benh_nhan.ho_ten = null
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  assert.ok(w.document.querySelector(".patient-avatar"), "report page shown")
  assert.deepEqual(w.errs, [])
})

test("malformed report from an older saved version does not crash the page", async () => {
  const report = { ...structuredClone(MOCK_REPORT_EN), thong_tin_benh_nhan: [null], chan_doan_chinh: [null, "A"], tien_su_benh: { x: 1 } }
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  assert.ok(w.document.querySelector(".patient-avatar"), "report page shown")
  assert.deepEqual(w.errs, [])
})

test("printed report escapes record text", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  report.chan_doan_chinh = '<img src=x onerror="alert(1)">EVIL'
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  button(w, /^Sign & export|^Sign off/).click(); await sleep(300)
  const doc = w.popups.at(-1).document
  assert.equal(doc.querySelector("img[onerror]"), null)
  assert.match(doc.body.textContent, /EVIL/)
})

test("rapid repeated clicks on Analyze start only one paid analysis", async () => {
  const w = boot({ analyzeResponse: { success: true, report: structuredClone(MOCK_REPORT_EN), analysis: null }, analyzeDelay: 600 })
  await sleep(500)
  const input = w.document.querySelector("input[type=file]")
  Object.defineProperty(input, "files", { value: [new w.File(["x"], "record.docx")] })
  input.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(300)
  const btn = button(w, /^Analyze/)
  btn.click(); btn.click(); btn.click()
  await sleep(1500)
  assert.equal(w.calls.filter(u => u.endsWith("/analyze")).length, 1)
})

test("lab CSV export neutralizes spreadsheet formulas from the record", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  report.xet_nghiem_meta = [{ key: '=HYPERLINK("http://evil","x")', desc: "+cmd", unit: "@SUM(1)", ngay: "01/01", rawVal: -1.5, normal: "-5", status: "normal" }]
  report.thong_tin_benh_nhan.so_benh_an = "25/01 x"
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  const menu = w.document.querySelector(".nav-burger")
  if (menu) { menu.click(); await sleep(200) }
  button(w, /Export labs \(CSV\)|Xuất xét nghiệm/).click(); await sleep(200)
  const csv = await new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(w.blobs.at(-1)) })
  const row = csv.split("\r\n")[1]
  assert.match(row, /^"'=HYPERLINK/)
  assert.match(row, /,'\+cmd,'@SUM\(1\),/)
  assert.match(row, /,-1\.5,-5,/)          // real negative numbers are left alone
})

test("records with undated echo studies, unnamed drugs or labs without a display value still render", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  delete report.sieu_am_tim.lan_kham[2].ngay
  report.thuoc_cuoi_ky[0].ten_thuoc = null
  delete report.xet_nghiem_meta[0].val
  delete report.canh_bao_nguy_co[0].mo_ta
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  assert.ok(w.document.querySelector(".patient-avatar"), "report page shown")
  assert.deepEqual(w.errs, [])
})

test("a latest echo study without EF draws no NaN and prints no 'undefined'", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  const lk = report.sieu_am_tim.lan_kham
  const latest = lk.find(s => s.latest) || lk[lk.length - 1]
  latest.latest = true
  delete latest.ef
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  assert.ok(w.document.querySelector(".patient-avatar"), "report page shown")
  assert.ok(!/undefined%|NaN/.test(w.document.body.textContent), "no undefined/NaN text")
  assert.deepEqual(w.errs, [])
})

test("echo insight never prints 'undefined' when the lowest-EF study has no date", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  const lk = report.sieu_am_tim.lan_kham.filter(s => s.ef != null)
  const low = lk.reduce((m, s) => s.ef < m.ef ? s : m, lk[0])
  delete low.ngay
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  assert.ok(w.document.querySelector(".patient-avatar"), "report page shown")
  assert.ok(!/\bundefined\b|\bNaN\b/.test(w.document.body.textContent), "no undefined/NaN text")
  assert.deepEqual(w.errs, [])
})

test("a record without age, sex, admission date or MRN shows no dangling labels in any view", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  for (const k of ["tuoi", "gioi_tinh", "ngay_vao_vien", "so_benh_an"]) delete report.thong_tin_benh_nhan[k]
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  const meta = w.document.querySelector(".patient-meta")
  assert.ok(meta, "header shown")
  assert.equal(meta.textContent.trim(), "", "no orphan 'y/o,' in the header")
  for (const key of ["2", "3"]) {
    w.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true })); await sleep(700)
    assert.ok(!/\bundefined\b|\bNaN\b/.test(w.document.body.textContent), `view ${key}: no undefined/NaN`)
  }
  assert.deepEqual(w.errs, [])
})

test("a record without an MRN can still be saved with a typed or generated ID", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  delete report.thong_tin_benh_nhan.so_benh_an
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  const save = w.document.querySelector(".nav-id-wrap .nav-save-btn")
  assert.ok(save && !save.disabled, "save button is enabled")
  save.click(); await sleep(200)
  const input = w.document.querySelector("#nav-id-input")
  assert.ok(input, "MRN prompt opened")
  assert.match(input.value, /^LOCAL-\d{6}-[A-Z0-9]{4}$/, "prefilled with a local ID")
  assert.doesNotMatch(w.document.querySelector(".nav-id-pop").textContent, VI, "prompt is in English")
  const setVal = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set
  setVal.call(input, "MRN-4471"); input.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(50)
  w.document.querySelector(".nav-id-pop").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await sleep(800)
  assert.ok(w.document.querySelector(".nav-save-btn.saved"), "now shows as saved")
  assert.ok(!w.document.querySelector(".nav-id-pop"), "prompt closed")
  w.document.querySelector(".nav-hist-btn").click(); await sleep(800)
  assert.match(w.document.body.textContent, /MRN-4471/, "listed in Record history under the typed ID")
  assert.deepEqual(w.errs, [])
})

test("the printed report never shows undefined, null or bare labels for missing fields", async () => {
  const report = structuredClone(MOCK_REPORT_EN)
  delete report.thong_tin_benh_nhan.ngay_sinh
  delete report.xet_nghiem_meta[0].desc
  report.xet_nghiem_meta[1].desc = null
  report.phau_thuat = {}
  delete report.dien_bien_lam_sang[0].ngay
  const w = boot({ analyzeResponse: { success: true, report, analysis: null } }); await sleep(500)
  await upload(w)
  w.document.querySelector(".nav-burger").click(); await sleep(250)
  ;[...w.document.querySelectorAll("button")].find(b => /Full export/.test(b.textContent)).click(); await sleep(500)
  const pdoc = w.popups.at(-1).document
  pdoc.querySelectorAll("script,style").forEach(e => e.remove())
  const txt = pdoc.body.textContent
  assert.ok(txt.length > 2000, "print window has content")
  assert.doesNotMatch(txt, /\bundefined\b|\bnull\b|\bNaN\b/)
  assert.doesNotMatch(txt, /Date of birth:/, "no bare label")
  const empty = txt.match(/.{0,60}\(\s*\).{0,30}/)
  assert.equal(empty, null, "no empty parentheses: " + (empty && empty[0]))
  assert.deepEqual(w.errs, [])
})
