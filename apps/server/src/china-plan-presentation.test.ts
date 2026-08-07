import assert from "node:assert/strict";
import test from "node:test";
import { presentChinaPlanPreparation } from "./china-plan-presentation.js";

test("presentation returns the saved workspace without internal orchestration output", () => {
  const workspace = { activePlan: { id: "plan-1" } } as never;
  const result = presentChinaPlanPreparation({
    status: "saved",
    sources: [],
    compilation: { status: "saved", planId: "plan-1", sourcePlanVersion: 1, compiledPlanVersion: 2, taskCount: 4, reminderCount: 1, workspace }
  });
  assert.equal(result.status, "saved");
  if (result.status === "saved") assert.deepEqual({ workspace: result.workspace, tasks: result.taskCount, reminders: result.reminderCount }, { workspace, tasks: 4, reminders: 1 });
  assert.equal("compilation" in result, false);
});

test("presentation extracts concise missing inputs from supporting Skills", () => {
  const result = presentChinaPlanPreparation({
    status: "blocked",
    stage: "compilation",
    reasonCode: "composition_not_ready",
    message: "More input is needed.",
    sources: [],
    compilation: {
      status: "blocked",
      stage: "orchestration",
      reasonCode: "composition_not_ready",
      message: "More input is needed.",
      orchestration: { supportingResults: [{ needsInput: { field: "routeFacts", reason: "A current route is required." } }] } as never
    }
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.deepEqual(result.actionItems, ["Accommodation and route: A current route is required."]);
});

test("presentation gives a safe official-source recovery action", () => {
  const result = presentChinaPlanPreparation({ status: "blocked", stage: "source_preparation", reasonCode: "critical_source_unavailable", message: "Source unavailable.", sources: [] });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.match(result.actionItems[0]!, /National Immigration Administration/);
});
