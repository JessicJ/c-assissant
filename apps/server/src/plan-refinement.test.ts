import assert from "node:assert/strict";
import test from "node:test";

import { planRefinementState } from "./plan-refinement.js";

test("progressive refinement asks exactly one highest-value user question", () => {
  const result = planRefinementState({
    title: "上海展会计划",
    location: "上海",
    dates: "九月，具体日期待确认",
    assumptions: ["抵达和返程日期尚未确认。", "展会场馆尚未确认。", "住宿尚未预订。"],
    nextAction: "继续完善计划。"
  });
  assert.equal(result.readyForReview, true);
  assert.equal(result.followUpQuestion, "你预计哪一天抵达，哪一天离开？大致日期也可以。");
  assert.equal(result.unresolvedCount, 3);
});

test("an explicit single question from the Plan takes precedence", () => {
  const result = planRefinementState({
    title: "Shanghai exhibition",
    location: "Shanghai",
    dates: "September 10-15",
    assumptions: ["The venue address is unknown."],
    nextAction: "Which exhibition venue will you attend?"
  });
  assert.equal(result.followUpQuestion, "Which exhibition venue will you attend?");
});

test("source-backed unknowns do not force another user question", () => {
  const result = planRefinementState({
    title: "China arrival",
    location: "Shanghai",
    dates: "September 10-15",
    assumptions: ["Visa eligibility has not been verified against the latest official source."],
    nextAction: "Review and confirm the complete Plan."
  });
  assert.equal(result.readyForReview, true);
  assert.equal(result.followUpQuestion, undefined);
});
