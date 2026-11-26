import assert from "node:assert/strict";
import test from "node:test";
import type { TravelBooking, WorkspaceSnapshot } from "@c-assistant/core";
import { bookingRelationshipDigest } from "@c-assistant/core/booking-relationship";
import { checkedBookingImportReceipt, frozenBookingImport, persistBookingImportRecovery, readBookingImportRecovery, bookingImportRecoveryKey } from "./booking-import-recovery.js";
import { getBookingImportBaseline, confirmBookingImport, readBookingImportReceipt, type BookingImportBaseline } from "./api-client.js";

const workspace = { profile: {}, runtime: {}, system: {}, destinationArrivals: [], inbox: [], sourceSnapshots: [], activePlan: { id: "计划", version: 4, status: "draft", configuration: {}, stages: [], knownInformation: [], assumptions: [], sources: [] } } as unknown as WorkspaceSnapshot;
const booking = { id: "预订", title: "合成预订", confirmationCode: "仅测试的私密值", travelerNames: ["合成旅客"], segments: [{ id: "分段" }] } as unknown as TravelBooking;
function memory() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
test("Plan和指定会话冻结完整基准及record CAS，内存payload不随新编辑变化", () => {
  for (const baseline of [
    { scope: { type: "plan", planId: "计划" }, expectedVersion: 4, expectedBlueprintVersion: 3, expectedSourceSetDigest: "a".repeat(64), records: [{ bookingId: "预订", recordDigest: "b".repeat(64) }], bookings: [] },
    { scope: { type: "planning", sessionId: "会话" }, expectedRevision: 7, records: [{ bookingId: "预订", recordDigest: "b".repeat(64) }], bookings: [] }
  ] as BookingImportBaseline[]) {
    const source = structuredClone(booking), frozen = frozenBookingImport(baseline, source, "合成原文");
    source.title = "后续编辑"; baseline.records.length = 0;
    assert.equal(frozen.body.booking.title, "合成预订"); assert.equal(frozen.body.expectedRecordDigest, "b".repeat(64));
    assert.equal(frozen.recovery.requestDigest, bookingRelationshipDigest({ scope: frozen.recovery.identity.targetId, body: frozen.body }));
    const storage = memory(); persistBookingImportRecovery(storage, frozen.recovery);
    const raw = storage.getItem(bookingImportRecoveryKey)!;
    for (const secret of ["合成原文", "合成旅客", "仅测试的私密值", "sourceContent", "travelerNames", "confirmationCode"]) assert.equal(raw.includes(secret), false);
    assert.deepEqual(readBookingImportRecovery(storage), frozen.recovery);
  }
});
test("无会话预览冻结明确不存在的CAS，回执核原scope及结果而非当前workspace", () => {
  const frozen = frozenBookingImport({ scope: { type: "planning" }, expectedSessionId: null, expectedRevision: 0, records: [], bookings: [] }, booking, "合成输入");
  assert.equal(frozen.recovery.identity.expectedSessionId, null);
  assert.equal(frozen.recovery.requestDigest, bookingRelationshipDigest(frozen.body));
  const receipt = { ...frozen.recovery, status: "committed", originalRequest: frozen.recovery.identity, originalResult: { originalRequest: frozen.recovery.identity, bookingId: booking.id, sessionId: "已创建会话", revision: 1 }, workspace };
  assert.ok(checkedBookingImportReceipt(receipt, frozen.recovery));
  assert.equal(checkedBookingImportReceipt({ ...receipt, originalRequest: { ...receipt.originalRequest, expectedSessionId: "并发会话" } }, frozen.recovery), null);
  assert.equal(checkedBookingImportReceipt({ ...receipt, originalResult: { ...receipt.originalResult, revision: 2 } }, frozen.recovery), null);
  assert.ok(checkedBookingImportReceipt({ requestId: frozen.recovery.requestId, requestDigest: frozen.recovery.requestDigest, status: "not_found" }, frozen.recovery));
});
test("刷新只查询原回执，not_found不发送；显式重试使用完全相同原body", async () => {
  const originalFetch = globalThis.fetch, calls: { method: string; body?: string }[] = [];
  const frozen = frozenBookingImport({ scope: { type: "planning", sessionId: "会话" }, expectedRevision: 2, records: [], bookings: [] }, booking, "合成原文");
  const storage = memory(); persistBookingImportRecovery(storage, frozen.recovery);
  globalThis.fetch = async (_url, init) => { calls.push({ method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) }); return new Response(JSON.stringify(init?.method === "POST" ? { workspace } : { requestId: frozen.recovery.requestId, requestDigest: frozen.recovery.requestDigest, status: "not_found" })); };
  try {
    await readBookingImportReceipt(readBookingImportRecovery(storage)!); assert.deepEqual(calls.map((call) => call.method), ["GET"]);
    await confirmBookingImport(frozen.recovery.scope, frozen.body); await confirmBookingImport(frozen.recovery.scope, frozen.body);
    assert.equal(calls[1]!.body, calls[2]!.body);
  } finally { globalThis.fetch = originalFetch; }
});
test("基准从预览前读取的无会话context冻结，缺失存在性拒绝", async () => {
  const originalFetch = globalThis.fetch; let missing = false; const calls: string[] = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ ...(missing ? {} : { expectedSessionId: null }), revision: 0, bookings: [], records: [] })); };
  try { const baseline = await getBookingImportBaseline({ type: "planning" }); assert.equal(baseline.expectedSessionId, null); assert.equal(baseline.expectedRevision, 0); assert.deepEqual(calls, ["/api/planning-sessions/bookings/context"]); missing = true; await assert.rejects(getBookingImportBaseline({ type: "planning" })); }
  finally { globalThis.fetch = originalFetch; }
});
test("恢复存储写失败阻止获得已持久身份，不泄露原文", () => {
  const frozen = frozenBookingImport({ scope: { type: "planning", sessionId: "会话" }, expectedRevision: 2, records: [], bookings: [] }, booking, "合成原文");
  assert.throws(() => persistBookingImportRecovery({ getItem: () => null, setItem: () => { throw new Error("合成存储故障"); }, removeItem() {} }, frozen.recovery));
});

test("无蓝图旧Plan仍在预览时冻结源集合CAS，缺基准拒绝", async () => {
  const originalFetch = globalThis.fetch; let missing = false;
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("/bookings") ? { expectedVersion: 4, bookings: [], records: [], ...(missing ? {} : { sourceSetDigest: "a".repeat(64) }) } : workspace));
  try { const baseline = await getBookingImportBaseline({ type: "plan", planId: "计划" }, 4); assert.equal(baseline.expectedSourceSetDigest, "a".repeat(64)); assert.equal(baseline.expectedBlueprintVersion, undefined); missing = true; await assert.rejects(getBookingImportBaseline({ type: "plan", planId: "计划" }, 4)); }
  finally { globalThis.fetch = originalFetch; }
});
