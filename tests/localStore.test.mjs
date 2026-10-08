// Run: npm test   (uses fake-indexeddb so it runs in Node without a browser)
import "fake-indexeddb/auto"
import { test } from "node:test"
import assert from "node:assert/strict"
import { localStore } from "../localStore.js"

const report = (id, extra = {}) => ({ thong_tin_benh_nhan: { so_benh_an: id, ho_ten: "Patient " + id }, ...extra })

test("save then get round-trips report and analysis", async () => {
  await localStore.save(report("A1"), { active_profiles: [{ ten_hien_thi: "AF" }] })
  const rec = await localStore.get("A1")
  assert.equal(rec.report.thong_tin_benh_nhan.ho_ten, "Patient A1")
  assert.equal(rec.nhom_benh, "AF")
  assert.equal(rec.so_lan_cap_nhat, 1)
})

test("saving the same record twice is rejected with 409", async () => {
  await localStore.save(report("A2"))
  await assert.rejects(localStore.save(report("A2")), e => e.status === 409)
})

test("record without so_benh_an cannot be saved", async () => {
  await assert.rejects(localStore.save({ thong_tin_benh_nhan: {} }), e => e.status === 400)
})

test("missing record returns 404", async () => {
  await assert.rejects(localStore.get("nope"), e => e.status === 404)
})

test("applyMerge snapshots the previous report and bumps the counter", async () => {
  await localStore.save(report("A3", { chan_doan_chinh: "old" }))
  const out = await localStore.applyMerge("A3", { report: report("A3", { chan_doan_chinh: "new" }), analysis: null }, "visit2.pdf")
  assert.equal(out.so_lan_cap_nhat, 2)
  const { history } = await localStore.history("A3")
  assert.equal(history[0].report.chan_doan_chinh, "old")
  assert.equal(history[0].nguon, "visit2.pdf")
})

test("list is newest-first and honors custom display names", async () => {
  await localStore.save(report("B1"))
  await new Promise(r => setTimeout(r, 5))
  await localStore.save(report("B2"))
  await localStore.rename("B1", "Room 302")
  const { patients } = await localStore.list()
  const ids = patients.map(p => p.so_benh_an)
  assert.ok(ids.indexOf("B2") < ids.indexOf("B1"))
  assert.equal(patients.find(p => p.so_benh_an === "B1").ho_ten, "Room 302")
})

test("chat is stored per record; unsaved records are ignored", async () => {
  await localStore.save(report("C1"))
  await localStore.addChat("C1", "user", "hi")
  await localStore.addChat("unsaved", "user", "hi")
  assert.equal((await localStore.chat("C1")).messages.length, 1)
  assert.equal((await localStore.chat("unsaved")).messages.length, 0)
})

test("remove deletes the record", async () => {
  await localStore.save(report("D1"))
  await localStore.remove("D1")
  await assert.rejects(localStore.get("D1"), e => e.status === 404)
})
