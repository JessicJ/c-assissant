import assert from "node:assert/strict";
import test from "node:test";

import { previewPlanChange } from "./plan-change-impact.js";

const plan = { id: "plan-1", version: 4 };

test("ordinary Plan refinements remain low impact", () => {
  const preview = previewPlanChange(plan, "Please add a vegetarian lunch option near the museum.");
  assert.equal(preview.impact, "low");
  assert.equal(preview.requiresConfirmation, false);
  assert.deepEqual(preview.affectedAreas, ["itinerary"]);
  assert.equal(preview.baseVersion, 4);
});

test("date, base, and fixed-booking changes require an impact confirmation", () => {
  const preview = previewPlanChange(plan, "Change the departure date, switch hotels, and move the train reservation.");
  assert.equal(preview.impact, "high");
  assert.equal(preview.requiresConfirmation, true);
  assert.deepEqual(preview.affectedAreas, ["dates", "accommodation", "fixed_commitments"]);
  assert.equal(preview.reasons.length, 3);
});

test("Chinese reminder and party changes are classified as high impact", () => {
  const preview = previewPlanChange(plan, "同行人数改成三个人，并取消出发提醒");
  assert.equal(preview.impact, "high");
  assert.deepEqual(preview.affectedAreas, ["party", "reminders"]);
});

test("impact preview rejects empty and oversized messages", () => {
  assert.throws(() => previewPlanChange(plan, "  "), /between 1 and 1500/i);
  assert.throws(() => previewPlanChange(plan, "x".repeat(1501)), /between 1 and 1500/i);
});
