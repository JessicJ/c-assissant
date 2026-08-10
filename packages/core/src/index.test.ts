import assert from "node:assert/strict";
import test from "node:test";

import { assessPolicyPreparation, compilePlanProposal, confirmPlan, createInitialWorkspace, createPlanFromDraft, createPlanFromRequest, recommendPlanTransport, type PlanCompilationProposal } from "./index.js";

function compilationProposal(planId: string, planVersion: number): PlanCompilationProposal {
  return {
    planRef: { id: planId, version: planVersion },
    countryPack: { id: "china", version: "0.0.0", name: "China Country Pack" },
    composition: { skillId: "china-arrival-plan", version: "0.1.0", status: "degraded" },
    compilationKey: "china-arrival-preparation",
    stage: { title: "China arrival preparation", description: "Source-backed preparation proposed by the China Country Pack." },
    tasks: [{
      proposalId: "arrival-preparation:carry-entry-documents",
      title: "Carry entry documents",
      description: "Keep the reviewed documents accessible.",
      owner: "user",
      dueLabel: "Before departure",
      sourceSkills: [{ id: "policy-applicability", version: "0.1.0" }, { id: "arrival-preparation", version: "0.1.0" }],
      reminder: { dueAt: "2026-08-31T21:00:00.000Z", timeZone: "Asia/Shanghai", purpose: "Carry entry documents", refreshFacts: [] }
    }],
    knownInformation: ["Local food orientation: Learn about 葱油拌面 (scallion oil noodles)."],
    assumptions: ["The exact document set still requires source-backed review."],
    limitations: ["No entry eligibility conclusion has been made."]
  };
}

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
    stages: [{ title: "Before departure", description: "Prepare essentials.", tasks: [{ title: "Check documents", owner: "user", dueLabel: "Two hours before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check passport and essential items.", refreshFacts: ["weather"] } }] }]
  });

  assert.equal(plan.status, "draft");
  assert.equal(plan.stages[0]?.tasks[0]?.status, "waiting_user");
  assert.equal(plan.stages[0]?.tasks[0]?.reminder?.timeZone, "Asia/Shanghai");
  assert.deepEqual(plan.stages[0]?.tasks[0]?.reminder?.refreshFacts, ["weather"]);
});

test("an arrival-triggered user Task waits for the arrival event before becoming user-ready", () => {
  const plan = createPlanFromDraft({
    title: "Arrive in Shanghai",
    location: "Shanghai, China",
    dates: "September 2026",
    knownInformation: ["Arrival airport: PVG"],
    assumptions: ["The exact terminal is unknown."],
    nextAction: "Review the complete Plan.",
    stages: [{ title: "Arrival", description: "Complete arrival steps.", tasks: [{ title: "Collect baggage", owner: "user", dueLabel: "At arrival", activationTrigger: "arrival" }] }]
  });

  assert.equal(plan.stages[0]?.tasks[0]?.status, "scheduled");
  assert.equal(plan.stages[0]?.tasks[0]?.activationTrigger, "arrival");
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

test("the shortest timed route can preliminarily favour walking without a fixed distance threshold", () => {
  const recommendation = recommendPlanTransport({
    preference: "plan_recommended",
    luggage: "light",
    routeFacts: [{ mode: "walking", distanceMeters: 2_100, durationSeconds: 16 * 60 }, { mode: "transit", distanceMeters: 1_400, durationSeconds: 22 * 60 }]
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

test("Core compiles a version-bound Country Pack proposal into a new draft Plan", () => {
  const plan = createPlanFromRequest({ request: "I will attend an exhibition in Shanghai in September 2026." });
  const result = compilePlanProposal(plan, compilationProposal(plan.id, plan.version), new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(result.status, "compiled");
  if (result.status !== "compiled") return;
  assert.equal(result.plan.version, plan.version + 1);
  assert.equal(result.plan.status, "draft");
  assert.equal(plan.version, 1);
  const stage = result.plan.stages.at(-1)!;
  assert.equal(stage.origin?.compilationKey, "china-arrival-preparation");
  assert.equal(stage.tasks[0]?.description, "Keep the reviewed documents accessible.");
  assert.equal(stage.tasks[0]?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.equal(stage.tasks[0]?.status, "waiting_user");
  assert.deepEqual(stage.tasks[0]?.origin?.sourceSkills.map((source) => source.id), ["policy-applicability", "arrival-preparation"]);
  assert.ok(result.plan.knownInformation.includes("Local food orientation: Learn about 葱油拌面 (scallion oil noodles)."));
  assert.equal(result.audit.sourcePlanVersion, 1);
  assert.equal(result.audit.compiledPlanVersion, 2);
  assert.match(result.plan.nextAction, /Review the complete compiled Plan/);
});

test("Core rejects stale Plan references and non-draft mutation", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  const staleRef = compilePlanProposal(plan, compilationProposal(plan.id, plan.version + 1));
  assert.equal(staleRef.status, "blocked");
  if (staleRef.status === "blocked") assert.equal(staleRef.reasonCode, "plan_reference_mismatch");
  const active = { ...plan, status: "active" as const };
  const activeResult = compilePlanProposal(active, compilationProposal(active.id, active.version));
  assert.equal(activeResult.status, "blocked");
  if (activeResult.status === "blocked") assert.equal(activeResult.reasonCode, "plan_not_draft");
});

test("Core fails closed on duplicate proposal ids and stale reminders", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  const duplicate = compilationProposal(plan.id, plan.version);
  duplicate.tasks.push({ ...duplicate.tasks[0]! });
  const duplicateResult = compilePlanProposal(plan, duplicate, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(duplicateResult.status, "blocked");
  if (duplicateResult.status === "blocked") assert.equal(duplicateResult.reasonCode, "invalid_proposal");
  const stale = compilationProposal(plan.id, plan.version);
  stale.tasks[0]!.reminder!.dueAt = "2026-01-01T00:00:00.000Z";
  const staleResult = compilePlanProposal(plan, stale, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(staleResult.status, "blocked");
  if (staleResult.status === "blocked") assert.equal(staleResult.reasonCode, "stale_reminder");
});

test("Core requires an explicit limitation before compiling a degraded composition", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  const proposal = compilationProposal(plan.id, plan.version);
  proposal.limitations = [];
  const result = compilePlanProposal(plan, proposal, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.equal(result.reasonCode, "invalid_proposal");
  const malformed = compilePlanProposal(plan, undefined as never, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(malformed.status, "blocked");
  if (malformed.status === "blocked") assert.equal(malformed.reasonCode, "invalid_proposal");
});
