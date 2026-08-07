import assert from "node:assert/strict";
import test from "node:test";

import { createInitialWorkspace } from "@c-assistant/core";

import { createChinaPlanWorkflow } from "./china-plan-workflow.js";

const workspace = createInitialWorkspace();
const sourceReady = { sourceId: "nia-english", status: "ready" as const, origin: "cache" as const, linkedToPlan: true };

test("China Plan workflow prepares sources before compiling and returns the saved draft", async () => {
  const calls: string[] = [];
  const workflow = createChinaPlanWorkflow({
    sourcePreparation: { prepareCurrentPlan: async () => { calls.push("sources"); return { status: "ready", workspace, sources: [sourceReady] }; } },
    compilation: { compileCurrentPlan: async () => { calls.push("compile"); return { status: "saved", planId: workspace.activePlan.id, sourcePlanVersion: 1, compiledPlanVersion: 2, taskCount: 4, reminderCount: 0, workspace }; } }
  });
  const result = await workflow.prepareCurrentPlan({ planId: workspace.activePlan.id, now: "2026-08-07T12:00:00.000Z" });
  assert.equal(result.status, "saved");
  assert.deepEqual(calls, ["sources", "compile"]);
});

test("China Plan workflow does not compile after critical source preparation blocks", async () => {
  let compiled = false;
  const workflow = createChinaPlanWorkflow({
    sourcePreparation: { prepareCurrentPlan: async () => ({ status: "blocked", reasonCode: "critical_source_unavailable", message: "Current evidence unavailable.", sources: [] }) },
    compilation: { compileCurrentPlan: async () => { compiled = true; throw new Error("must not compile"); } }
  });
  const result = await workflow.prepareCurrentPlan({ planId: workspace.activePlan.id });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.equal(result.stage, "source_preparation");
  assert.equal(compiled, false);
});

test("China Plan workflow preserves structured compilation needs-input details", async () => {
  const blockedCompilation = { status: "blocked" as const, stage: "orchestration" as const, reasonCode: "composition_not_ready", message: "A supporting Skill needs input." };
  const workflow = createChinaPlanWorkflow({
    sourcePreparation: { prepareCurrentPlan: async () => ({ status: "ready", workspace, sources: [sourceReady] }) },
    compilation: { compileCurrentPlan: async () => blockedCompilation }
  });
  const result = await workflow.prepareCurrentPlan({ planId: workspace.activePlan.id });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "compilation");
    assert.equal(result.compilation?.reasonCode, "composition_not_ready");
  }
});
