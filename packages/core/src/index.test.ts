import assert from "node:assert/strict";
import test from "node:test";

import { assessPolicyPreparation, confirmPlan, createInitialWorkspace, createPlanFromDraft, createPlanFromRequest, recommendPlanTransport } from "./index.js";

test("a confirmed demo Plan becomes active and leaves an inbox receipt", () => {
  const workspace = createInitialWorkspace();
  const confirmed = confirmPlan(workspace, workspace.activePlan.id);

  assert.equal(confirmed.activePlan.status, "active");
  assert.equal(confirmed.inbox[0]?.tone, "ready");
});

test("a natural-language request creates a draft Plan with transparent assumptions", () => {
  const plan = createPlanFromRequest({ request: "I am going to Shanghai in September 2026 for an exhibition." });

  assert.equal(plan.status, "draft");
  assert.equal(plan.location, "Shanghai, China");
  assert.equal(plan.configuration.accommodation.status, "not_set");
  assert.equal(plan.configuration.arrival.expectedAtLocal, undefined);
  assert.equal(plan.configuration.transport.preference, "plan_recommended");
  assert.equal(plan.configuration.travelContext.luggage, "unknown");
  assert.equal(plan.stages[2]?.tasks[0]?.activationTrigger, "arrival");
  assert.match(plan.assumptions[0] ?? "", /does not yet use Codex/i);
});

test("a validated Agent draft becomes a draft Plan with user-owned follow-up Tasks", () => {
  const plan = createPlanFromDraft({
    title: "Settle into Shanghai",
    location: "Shanghai, China",
    dates: "September 2026",
    knownInformation: ["Purpose: study"],
    assumptions: ["Accommodation is not confirmed."],
    nextAction: "Review the complete Plan.",
    stages: [{ title: "Before departure", description: "Prepare essentials.", tasks: [{ title: "Confirm accommodation", owner: "user", dueLabel: "Before departure" }] }]
  });

  assert.equal(plan.status, "draft");
  assert.equal(plan.stages[0]?.tasks[0]?.status, "waiting_user");
});

test("a Plan preference takes precedence in an explainable transport suggestion", () => {
  const recommendation = recommendPlanTransport({
    preference: "public_transit",
    luggage: "heavy",
    routeFacts: [{ mode: "driving", distanceMeters: 4_000 }, { mode: "transit", distanceMeters: 3_600 }]
  });

  assert.equal(recommendation.mode, "transit");
  assert.match(recommendation.reasons[0] ?? "", /explicitly prefers/i);
});

test("heavy luggage makes an available driving route the preliminary choice", () => {
  const recommendation = recommendPlanTransport({
    preference: "plan_recommended",
    luggage: "heavy",
    routeFacts: [{ mode: "driving", distanceMeters: 4_000 }, { mode: "transit", distanceMeters: 3_600 }]
  });

  assert.equal(recommendation.mode, "driving");
  assert.match(recommendation.limitations[0] ?? "", /No weather fact matched/i);
});

test("a short route can preliminarily favour walking without heavy luggage", () => {
  const recommendation = recommendPlanTransport({
    preference: "plan_recommended",
    luggage: "light",
    routeFacts: [{ mode: "walking", distanceMeters: 1_100, durationSeconds: 16 * 60 }, { mode: "transit", distanceMeters: 1_400 }]
  });

  assert.equal(recommendation.mode, "walking");
});

test("a matching rainy arrival forecast avoids automatic walking when transit is available", () => {
  const recommendation = recommendPlanTransport({
    preference: "plan_recommended",
    luggage: "light",
    weather: { condition: "Light rain", precipitationMm: 1.2 },
    routeFacts: [{ mode: "walking", distanceMeters: 1_100, durationSeconds: 16 * 60 }, { mode: "transit", distanceMeters: 1_400 }]
  });

  assert.equal(recommendation.mode, "transit");
  assert.match(recommendation.reasons.join(" "), /Rain or snow/i);
  assert.match(recommendation.limitations[0] ?? "", /matched to the expected arrival date/i);
});

test("an explicit walking preference remains user-owned in a rainy forecast", () => {
  const recommendation = recommendPlanTransport({
    preference: "walking",
    luggage: "light",
    weather: { condition: "Rain", precipitationMm: 0 },
    routeFacts: [{ mode: "walking", distanceMeters: 1_100, durationSeconds: 16 * 60 }, { mode: "transit", distanceMeters: 1_400 }]
  });

  assert.equal(recommendation.mode, "walking");
  assert.match(recommendation.reasons.join(" "), /explicit Plan preference is retained/i);
});

test("policy preparation asks for personal facts before it can be reviewed", () => {
  const assessment = assessPolicyPreparation({
    profile: createInitialWorkspace().profile,
    plan: createInitialWorkspace().activePlan,
    sourceSnapshots: [],
    now: new Date("2026-08-07T00:00:00.000Z")
  });

  assert.equal(assessment.status, "needs_input");
  assert.deepEqual(assessment.missingInformation.map((item) => item.field), [
    "profile.nationality",
    "profile.immigrationStatus",
    "official_source.nia-english"
  ]);
  assert.match(assessment.warning, /does not determine/i);
});

test("policy preparation is ready only when confirmed facts have fresh official evidence", () => {
  const workspace = createInitialWorkspace();
  workspace.profile = { ...workspace.profile, nationality: "Canada", immigrationStatus: "tourist_visa", status: "ready" };
  workspace.sourceSnapshots = [{
    id: "source-1",
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidance",
    url: "https://en.nia.gov.cn/",
    retrievedAt: "2026-08-06T12:00:00.000Z",
    contentHash: "a".repeat(64),
    excerpt: "Official evidence only."
  }];

  const assessment = assessPolicyPreparation({ profile: workspace.profile, plan: workspace.activePlan, sourceSnapshots: workspace.sourceSnapshots, now: new Date("2026-08-07T00:00:00.000Z") });

  assert.equal(assessment.status, "ready_for_review");
  assert.equal(assessment.evidence[0]?.sourceId, "nia-english");
  assert.equal(assessment.missingInformation.length, 0);
});

test("stale official evidence requires an explicit refresh before review", () => {
  const workspace = createInitialWorkspace();
  workspace.profile = { ...workspace.profile, nationality: "Canada", immigrationStatus: "tourist_visa", status: "ready" };
  workspace.sourceSnapshots = [{
    id: "source-1",
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidance",
    url: "https://en.nia.gov.cn/",
    retrievedAt: "2026-07-01T00:00:00.000Z",
    contentHash: "a".repeat(64),
    excerpt: "Official evidence only."
  }];

  const assessment = assessPolicyPreparation({ profile: workspace.profile, plan: workspace.activePlan, sourceSnapshots: workspace.sourceSnapshots, now: new Date("2026-08-07T00:00:00.000Z") });
  assert.equal(assessment.status, "needs_evidence");
  assert.equal(assessment.missingInformation[0]?.field, "official_source.nia-english");
});
