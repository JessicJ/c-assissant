import assert from "node:assert/strict";
import test from "node:test";

import { assertWebAgentPlanUnchanged, formatWebAgentPlanReply, parseWebAgentTurn } from "./web-agent.js";

test("Web Agent accepts only bounded Plan-turn requests", () => {
  assert.deepEqual(parseWebAgentTurn({ message: "Change the hotel", mode: "revise_plan" }), { message: "Change the hotel", mode: "revise_plan" });
  assert.deepEqual(parseWebAgentTurn({ message: "Change the hotel", mode: "revise_plan", impactConfirmed: true }), { message: "Change the hotel", mode: "revise_plan", impactConfirmed: true });
  assert.deepEqual(parseWebAgentTurn({ message: "Change the hotel", mode: "revise_plan", expectedPlanId: "plan-1", expectedVersion: 3 }), { message: "Change the hotel", mode: "revise_plan", expectedPlanId: "plan-1", expectedVersion: 3 });
  assert.deepEqual(parseWebAgentTurn({ message: "Attend an exhibition in Shanghai in September", mode: "new_plan" }), { message: "Attend an exhibition in Shanghai in September", mode: "new_plan" });
  assert.throws(() => parseWebAgentTurn({ mode: "new_plan", intake: { destination: "Shanghai" } }), /Tell the Agent/);
  assert.throws(() => parseWebAgentTurn({ message: "Hello", mode: "general_chat" }), /Choose whether/);
  assert.throws(() => parseWebAgentTurn({ message: "x".repeat(1_501), mode: "revise_plan" }), /under 1,500/);
  assert.throws(() => parseWebAgentTurn({ message: "Change the hotel", mode: "revise_plan", impactConfirmed: "yes" }), /boolean/);
  assert.throws(() => parseWebAgentTurn({ message: "Change the hotel", mode: "revise_plan", expectedPlanId: "", expectedVersion: 0 }), /Plan id/);
});

test("Web Agent refuses to overwrite Plan changes made during a Runtime turn", () => {
  const expected = { id: "plan-a", version: 3 };
  assert.doesNotThrow(() => assertWebAgentPlanUnchanged(expected, { id: "plan-a", version: 3 }));
  assert.throws(() => assertWebAgentPlanUnchanged(expected, { id: "plan-a", version: 4 }), /newer changes were preserved/);
  assert.throws(() => assertWebAgentPlanUnchanged(expected, { id: "plan-b", version: 1 }), /newer changes were preserved/);
});

test("Web Agent reply asks only one progressive refinement question", () => {
  const reply = formatWebAgentPlanReply({ runtimeName: "Codex", mode: "new_plan", plan: { title: "China work setup", nextAction: "Share the venue." }, followUpQuestion: "Which venue will you attend?" });
  assert.match(reply, /review or stop now/i);
  assert.match(reply, /Which venue will you attend\?/);
  assert.doesNotMatch(reply, /complete assumptions, stages, tasks, reminders, and sources/);
});

test("Web Agent reply always keeps the Plan reviewable", () => {
  const reply = formatWebAgentPlanReply({ runtimeName: "Codex", mode: "new_plan", plan: { title: "China work setup", nextAction: "Review assumptions." } });
  assert.match(reply, /ready to review/i);
  assert.match(reply, /confirm it when you are ready/i);
});
