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

function boot({ lang = "en", analyzeResponse } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true })
  const w = dom.window
  w.localStorage.setItem("mp_lang", lang)
  w.indexedDB = new IDBFactory(); w.IDBKeyRange = IDBKeyRange
  w.fetch = async (u) => ({ ok: true, status: 200, headers: new Map(),
    json: async () => String(u).endsWith("/analyze") && analyzeResponse ? analyzeResponse : (String(u).endsWith("/cloud/status") ? { enabled: false } : {}) })
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {}
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
