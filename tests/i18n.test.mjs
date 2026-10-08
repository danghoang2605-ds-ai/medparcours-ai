// Bundles i18n.js (it imports JSON) with esbuild, then tests translate().
import { test, before } from "node:test"
import assert from "node:assert/strict"
import * as esbuild from "esbuild"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

let translate
before(async () => {
  const out = join(mkdtempSync(join(tmpdir(), "i18n-")), "i18n.mjs")
  await esbuild.build({ entryPoints: ["i18n.js"], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error" })
  ;({ translate } = await import(pathToFileURL(out).href))
})

test("exact UI strings translate and keep surrounding whitespace", () => {
  assert.equal(translate("Lịch sử bệnh án"), "Record history")
  assert.equal(translate("  Lưu hồ sơ "), "  Save record ")
})

test("templated strings use patterns", () => {
  assert.equal(translate("Đang đọc 3/10 trang"), "Reading page 3/10")
  assert.equal(translate("Hậu phẫu ngày 4"), "Post-op day 4")
})

test("runtime sentences are translated by fragments only when nothing Vietnamese is left", () => {
  assert.equal(translate("Na 131 mmol/L (dưới 135)"), "Na 131 mmol/L (below 135)")
  assert.equal(translate("Giới tính ghi nhận: Male"), "Recorded sex: Male")
  // Unknown clinical text stays untouched rather than half-translated.
  assert.equal(translate("Bệnh nhân khó thở tăng dần (dưới 135)"), null)
})

test("rule-engine messages use generated patterns, including translated values", () => {
  assert.equal(translate("TTR 45% dưới ngưỡng 60% — chống đông chưa ổn định, cần xem lại liều/tuân thủ điều trị."),
    "TTR 45% below the 60% threshold; anticoagulation is not stable, review dose/adherence.")
  assert.equal(translate("Van nguy cơ thấp (On-X/ATS/Medtronic Open Pivot/St Jude), van hai lá, có yếu tố nguy cơ"),
    "Low-risk valve (On-X/ATS/Medtronic Open Pivot/St Jude), mitral valve, with risk factors")
})

test("English and non-Vietnamese text is left alone", () => {
  assert.equal(translate("EF 71%"), null)
  assert.equal(translate("Already English"), null)
})
