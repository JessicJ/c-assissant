import assert from "node:assert/strict";
import test from "node:test";
import type { DirectBlueprintReceipt } from "./api-client.js";
import type { BookingRelationshipReviewContext } from "./booking-relationship-review.js";
import { blueprintOperationDigest, pendingBlueprintOperationKey, persistPendingBlueprintOperation, readPendingBlueprintOperation, rebaseReviewedBlueprintDraft, reviewRecoveryBinding, validatePendingBlueprintOperation, type PendingBlueprintOperation } from "./direct-blueprint-recovery.js";

function memory() {
  const values = new Map<string, string>(); let fail = "";
  return { values, failOn: (key: string) => { fail = key; }, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (key === fail) throw new Error("合成写入故障"); values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
async function fixture() {
  const storage = memory(), draftKey = "landi:pending-blueprint:blueprint:蓝图";
  const signature = JSON.stringify({ binding: { planId: "原计划", planVersion: 2, blueprintId: "蓝图", blueprintVersion: 3 }, draft: { planId: "原计划", version: 2, edits: [{ kind: "remove_place_from_day", dayId: "日一", placeId: "地点" }] }, extra: [] });
  const seed = { draft: { key: draftKey, signature }, blueprintId: "蓝图", sourceSetDigest: "a".repeat(64), targetDigests: { 目标: "b".repeat(64) } };
  const body = { requestId: "原请求", expectedVersion: 2, expectedBlueprintVersion: 3, revisions: [{ kind: "review_booking_relationships" }], recoveryBinding: await reviewRecoveryBinding(seed) } as unknown as Extract<PendingBlueprintOperation["body"], { revisions: unknown }>;
  const identity = { operation: "save" as const, requestId: "原请求", expectedPlanId: "原计划", expectedVersion: 2, expectedBlueprintVersion: 3, requestDigest: await blueprintOperationDigest("save", "原计划", body) };
  const operation: PendingBlueprintOperation = { identity, body, reviewRebase: seed };
  const originalResult = { planId: "新计划", planVersion: 1, blueprintId: "蓝图", blueprintVersion: 4, sourceSetDigest: seed.sourceSetDigest, targetDigests: seed.targetDigests, revisionKinds: ["review_booking_relationships"], recoveryBinding: body.recoveryBinding };
  const receipt = { ...identity, status: "committed", originalResult, revision: { id: "原修订", kinds: ["review_booking_relationships"], baseBlueprintVersion: 3, appliedBlueprintVersion: 4 }, workspace: { activePlan: { id: "新计划", version: 1 }, activeBlueprint: { id: "蓝图", version: 4, days: [{ id: "日一" }], places: [{ id: "地点" }] } } } as unknown as Extract<DirectBlueprintReceipt, { status: "committed" }>;
  const context = { expectedPlanId: "新计划", expectedVersion: 1, blueprintId: "蓝图", blueprintVersion: 4, sourceIssues: [], sourceSetDigest: seed.sourceSetDigest, targetDigests: seed.targetDigests } as unknown as BookingRelationshipReviewContext;
  storage.setItem(draftKey, signature); persistPendingBlueprintOperation(storage, operation);
  return { storage, operation, receipt, context, signature, draftKey };
}
test("精确回执先保存提交标记再重绑，草稿写后刷新可幂等恢复", async () => {
  const f = await fixture(); await validatePendingBlueprintOperation(f.operation);
  const first = rebaseReviewedBlueprintDraft(f.storage, f.operation, f.receipt, f.context); assert.ok(first);
  const recovered = readPendingBlueprintOperation(f.storage)!; assert.equal(recovered.committedRebase?.revisionId, "原修订");
  assert.deepEqual(rebaseReviewedBlueprintDraft(f.storage, recovered, f.receipt, f.context), first);
  assert.equal(JSON.parse(first.signature).binding.blueprintVersion, 4);
});
test("标记写失败或草稿写失败均保留原请求，重入后恢复", async () => {
  for (const phase of ["标记", "草稿"]) {
    const f = await fixture(); f.storage.failOn(phase === "标记" ? pendingBlueprintOperationKey : f.draftKey);
    assert.throws(() => rebaseReviewedBlueprintDraft(f.storage, f.operation, f.receipt, f.context));
    assert.equal(f.storage.getItem(f.draftKey), f.signature); assert.ok(f.storage.getItem(pendingBlueprintOperationKey));
    f.storage.failOn(""); assert.ok(rebaseReviewedBlueprintDraft(f.storage, readPendingBlueprintOperation(f.storage)!, f.receipt, f.context));
  }
});
test("错误身份、并发版本、源目标变化、新编辑和错误修订不重绑不清稿", async () => {
  const changes: ((f: Awaited<ReturnType<typeof fixture>>) => void)[] = [
    (f) => { f.receipt.requestId = "其他请求"; }, (f) => { f.receipt.originalResult!.blueprintVersion = 5; },
    (f) => { f.receipt.workspace.activePlan.id = "并发的新计划"; }, (f) => { f.receipt.workspace.activeBlueprint!.version = 5; },
    (f) => { f.context.sourceSetDigest = "c".repeat(64); }, (f) => { f.context.targetDigests = {}; },
    (f) => { f.storage.setItem(f.draftKey, "后续本地编辑"); }, (f) => { f.receipt.revision!.appliedBlueprintVersion = 8; },
    (f) => { f.receipt.originalResult!.recoveryBinding = { schemaVersion: 1, draftDigest: "d".repeat(64), seedDigest: "e".repeat(64) }; }
  ];
  for (const change of changes) { const f = await fixture(); change(f); const before = f.storage.getItem(f.draftKey); assert.equal(rebaseReviewedBlueprintDraft(f.storage, f.operation, f.receipt, f.context), null); assert.equal(f.storage.getItem(f.draftKey), before); assert.ok(f.storage.getItem(pendingBlueprintOperationKey)); }
});
test("seed或原批次被篡改不能通过服务端请求摘要绑定", async () => {
  for (const mutate of [(f: Awaited<ReturnType<typeof fixture>>) => { f.operation.reviewRebase!.sourceSetDigest = "c".repeat(64); }, (f: Awaited<ReturnType<typeof fixture>>) => { f.operation.reviewRebase!.draft.signature = f.signature.replace("地点", "其他地点"); }]) { const f = await fixture(); mutate(f); await assert.rejects(validatePendingBlueprintOperation(f.operation)); }
  const f = await fixture(); f.storage.setItem(pendingBlueprintOperationKey, JSON.stringify({ ...f.operation, reviewRebase: { draft: {} } })); assert.throws(() => readPendingBlueprintOperation(f.storage));
  assert.equal(rebaseReviewedBlueprintDraft(f.storage, f.operation, { ...f.operation.identity, status: "not_found" }, f.context), null);
});
