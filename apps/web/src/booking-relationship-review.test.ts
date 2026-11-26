import assert from "node:assert/strict";
import test from "node:test";
import type { TripBlueprint } from "@c-assistant/core";
import { bookingRelationshipReviewContext, type BookingRelationship } from "@c-assistant/core/booking-relationship";
import { checkedBookingReviewContext, bookingTargetLabel, invalidRelationTargets, readableBookingEvidence } from "./booking-relationship-review.js";

const blueprint = { id: "蓝图", version: 3, places: [{ id: "酒店", name: "合成酒店" }], days: [{ id: "日一", date: "2026-12-01", stops: [{ placeId: "酒店" }], blocks: [{ id: "入住", placeId: "酒店", startTime: "15:30" }, { id: "取行李", placeId: "酒店" }] }, { id: "日二", date: "2026-12-02", stops: [{ placeId: "酒店" }] }], movements: [{ id: "交通", dayId: "日一", originPlaceId: "酒店", destinationPlaceId: "酒店" }], bookingConstraints: [], sources: [{ id: "内部来源", title: "旅客提供的住宿资料" }] } as unknown as TripBlueprint;
function context() { return { expectedPlanId: "计划", expectedVersion: 2, ...bookingRelationshipReviewContext(blueprint), sourceSetDigest: "a".repeat(64),pendingSourceBookingIds:[], sourceIssues: [], constraints: [], sourceConstraints: [], sourceRecords: [], sourceCandidates: [] }; }
test("审阅上下文要求全量目标、单元与摘要，畸形嵌套安全拒绝", () => {
  assert.ok(checkedBookingReviewContext(context(), { id: "计划", version: 2 }, blueprint));
  for (const patch of [{ targets: [] }, { units: [null] }, { targetDigests: {} }, { expectedVersion: 1 }, { universeDigest: "a".repeat(64) }, { sourceCandidates: [null] }, { assessment: { status: "invalidated", units: [{ relations: null }] } }]) assert.equal(checkedBookingReviewContext({ ...context(), ...patch }, { id: "计划", version: 2 }, blueprint), null);
});
test("同日多次出现、跨日和交通标签可辨，本地日期时间无内部身份", () => {
  const first = bookingTargetLabel({ kind: "occurrence", dayId: "日一", placeId: "酒店", blockId: "入住" }, blueprint);
  const second = bookingTargetLabel({ kind: "occurrence", dayId: "日一", placeId: "酒店", blockId: "取行李" }, blueprint);
  assert.notEqual(first, second); assert.ok(first.includes(new Date("2000-01-01T15:30").toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })));
  assert.ok(first.includes(new Date("2026-12-01T12:00:00").toLocaleDateString()));
  assert.ok(bookingTargetLabel({ kind: "movement", movementId: "交通" }, blueprint).includes("→"));
  assert.deepEqual(readableBookingEvidence(["内部来源", "未知内部来源"], blueprint), ["旅客提供的住宿资料", "Traveler statement: check the original booking and itinerary again"]);
});
test("已移除的关联目标保留待更正，不能静默变为合法空集合", () => {
  const targets = context().targets;
  const relation = { targets: [{ kind: "occurrence", dayId: "日一", placeId: "酒店", blockId: "已移除" }] } as BookingRelationship;
  assert.equal(invalidRelationTargets(relation, targets).length, 1);
  assert.equal(relation.targets.length, 1);
});
