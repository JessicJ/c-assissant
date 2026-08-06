import assert from "node:assert/strict";
import test from "node:test";

import { confirmPlan, createInitialWorkspace, createPlanFromRequest } from "./index.js";

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
  assert.match(plan.assumptions[0] ?? "", /does not yet use Codex/i);
});
