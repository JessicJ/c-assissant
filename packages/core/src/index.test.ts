import assert from "node:assert/strict";
import test from "node:test";

import { confirmPlan, createInitialWorkspace, createPlanFromDraft, createPlanFromRequest, recommendPlanTransport } from "./index.js";

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
