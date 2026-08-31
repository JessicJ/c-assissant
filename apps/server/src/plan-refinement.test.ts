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
  assert.equal(result.followUpQuestion, "What date do you expect to arrive, and when will you leave? Approximate dates are fine.");
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

test("official institutional facts are researched instead of asked of the user", () => {
  const result = planRefinementState({
    title: "Fudan study plan",
    location: "Shanghai",
    dates: "September 2026",
    assumptions: ["The official registration date must be verified from Fudan University's academic calendar."],
    nextAction: "What is the program’s official student registration date at Fudan University Handan Campus?"
  });
  assert.equal(result.readyForReview, true);
  assert.equal(result.followUpQuestion, undefined);
  assert.equal(result.unresolvedCount, 0);
});

test("does not ask the user to transcribe an institution name that is already established", () => {
  const result = planRefinementState({
    title: "Fudan University Handan Campus study plan",
    location: "Yangpu District, Shanghai",
    dates: "August 2026",
    knownInformation: ["The destination is Fudan University Handan Campus."],
    assumptions: ["The admission letter should be carried for registration."],
    sources: [{ title: "Handan Campus", authority: "Fudan University", url: "https://www.fudan.edu.cn/", retrievedAt: "2026-08-11" }],
    nextAction: "What exact institution name is printed on your admission letter?"
  });
  assert.equal(result.followUpQuestion, undefined);
});

test("a user-owned branch decision remains a useful follow-up", () => {
  const result = planRefinementState({
    title: "复旦留学计划",
    location: "上海",
    dates: "2026 年秋季",
    assumptions: ["项目类型尚未确认。"],
    nextAction: "继续完善计划。"
  });
  assert.equal(result.followUpQuestion, "Is this an undergraduate, master's, doctoral, language, or exchange program?");
});

test("a missing fixed travel node takes priority over lower-value profile detail", () => {
  const result = planRefinementState({
    title: "上海出行计划",
    location: "上海",
    dates: "2026 年 9 月 1 日至 10 日",
    assumptions: ["固定事项的地点和时间尚未确认。", "同行人数尚未确认。"],
    nextAction: "继续完善计划。"
  });
  assert.equal(result.followUpQuestion, "What must you attend at a fixed time? Share its place and date or time, or say there is no fixed event.");
});
