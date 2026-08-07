import assert from "node:assert/strict";
import test from "node:test";

import { assertWebAgentPlanUnchanged, formatWebAgentPlanReply, parseWebAgentTurn } from "./web-agent.js";

test("Web Agent accepts only bounded Plan-turn requests", () => {
  assert.deepEqual(parseWebAgentTurn({ message: "  Attend an exhibition  " }), { message: "Attend an exhibition", mode: "new_plan" });
  assert.deepEqual(parseWebAgentTurn({ message: "Change the hotel", mode: "revise_plan" }), { message: "Change the hotel", mode: "revise_plan" });
  assert.throws(() => parseWebAgentTurn({ message: "Hello", mode: "general_chat" }), /Choose whether/);
  assert.throws(() => parseWebAgentTurn({ message: "x".repeat(1_501) }), /under 1,500/);
});

test("Web Agent refuses to overwrite Plan changes made during a Runtime turn", () => {
  const expected = { id: "plan-a", version: 3 };
  assert.doesNotThrow(() => assertWebAgentPlanUnchanged(expected, { id: "plan-a", version: 3 }));
  assert.throws(() => assertWebAgentPlanUnchanged(expected, { id: "plan-a", version: 4 }), /newer changes were preserved/);
  assert.throws(() => assertWebAgentPlanUnchanged(expected, { id: "plan-b", version: 1 }), /newer changes were preserved/);
});

test("Web Agent reply keeps complete Plan review explicit", () => {
  const reply = formatWebAgentPlanReply({ runtimeName: "Codex", mode: "new_plan", plan: { title: "China work setup", nextAction: "Review assumptions." } });
  assert.match(reply, /remains a draft/);
  assert.match(reply, /complete assumptions, stages, tasks, reminders, and sources/);
  assert.match(reply, /Review assumptions/);
});
