import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { normalizeReport, toNumber } from "../reportSchema.js"
import { MOCK_REPORT_EN } from "../demoData.en.js"

test("valid report passes through unchanged and is idempotent", () => {
  const n = normalizeReport(structuredClone(MOCK_REPORT_EN))
  assert.deepEqual(n, MOCK_REPORT_EN)
  assert.deepEqual(normalizeReport(n), n)
})

test("numbers are parsed like the backend", () => {
  for (const [raw, exp] of [[2, 2], ["2.5 mg/L", 2.5], ["1,5", 1.5], ["N/A", null], [true, null], [NaN, null]]) assert.equal(toNumber(raw), exp)
})

test("malformed fields are repaired, never left as objects where text is rendered", () => {
  const r = normalizeReport({ thong_tin_benh_nhan: null, chan_doan_chinh: [null, "A"], tien_su_benh: { x: 1 },
    sieu_am_tim: { lan_kham: ["note", 3, { ef: "50%" }] }, canh_bao_nguy_co: "alert", problem_status: "x" })
  assert.deepEqual(r.thong_tin_benh_nhan, {})
  assert.equal(r.chan_doan_chinh, "A")
  assert.equal(r.tien_su_benh, "x: 1")
  assert.deepEqual(r.sieu_am_tim.lan_kham, [{ ghi_chu: "note" }, { ef: 50 }])
  assert.deepEqual(r.canh_bao_nguy_co, [{ mo_ta: "alert" }])
  assert.deepEqual(r.problem_status, { hien_tai: [], da_qua: [] })
})

test("field lists match the Python normalizer", () => {
  const py = readFileSync(new URL("../report_schema.py", import.meta.url), "utf8")
  const js = readFileSync(new URL("../reportSchema.js", import.meta.url), "utf8")
  const setOf = (src, name) => {
    const m = src.match(new RegExp(name + String.raw`\s*=\s*(?:new Set\()?[\[{(]([^\])}]*)[\])}]`))
    return new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]))
  }
  for (const name of ["NUMERIC", "BOOLEAN", "SCALAR_ANY", "TEXT_FIELDS", "DICT_FIELDS", "LIST_OF_DICTS"])
    assert.deepEqual(setOf(js, name), setOf(py, name), name)
})
