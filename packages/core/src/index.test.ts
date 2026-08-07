import assert from "node:assert/strict";
import test from "node:test";

import { confirmPlan, createInitialWorkspace, createPlanFromDraft, createPlanFromRequest } from "./index.js";

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
  assert.equal(plan.configuration.transport.preference, "plan_recommended");
  assert.equal(plan.configuration.travelContext.luggage, "unknown");
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
