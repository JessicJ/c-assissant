import assert from "node:assert/strict";
import test from "node:test";

import { assertWebAgentPlanUnchanged, formatWebAgentPlanReply, parseWebAgentTurn } from "./web-agent.js";

test("Web Agent accepts only bounded Plan-turn requests", () => {
  const created = parseWebAgentTurn({ mode: "new_plan", intake: { destination: "Shanghai", arrivalDate: "2026-09-01", departureDate: "2026-09-05", openEnded: false, purpose: "Attend an exhibition", partySize: 1, luggage: "standard", accommodation: "needs_recommendation", transportPreference: "plan_recommended", priority: "balanced" } });
  assert.equal(created.mode, "new_plan");
  assert.equal(created.intake?.destination, "Shanghai");
  assert.match(created.message, /Arrival date: 2026-09-01/);
  assert.deepEqual(parseWebAgentTurn({ message: "Change the hotel", mode: "revise_plan" }), { message: "Change the hotel", mode: "revise_plan" });
  assert.throws(() => parseWebAgentTurn({ message: "Attend an exhibition", mode: "new_plan" }), /Plan basics/);
  assert.throws(() => parseWebAgentTurn({ mode: "new_plan", intake: { destination: "Shanghai" } }), /arrivalDate/);
  assert.throws(() => parseWebAgentTurn({ mode: "new_plan", intake: { destination: "Shanghai", arrivalDate: "2026-02-31", departureDate: "2026-03-05", openEnded: false, purpose: "Exhibition", partySize: 1, luggage: "standard", accommodation: "not_set", transportPreference: "plan_recommended", priority: "balanced" } }), /valid arrival date/);
  assert.throws(() => parseWebAgentTurn({ mode: "new_plan", intake: { destination: "Shanghai", arrivalDate: "2026-09-01", departureDate: "2026-09-05", openEnded: false, purpose: "Exhibition", arrivalTime: "25:90", partySize: 1, luggage: "standard", accommodation: "not_set", transportPreference: "plan_recommended", priority: "balanced" } }), /valid arrival time/);
  assert.throws(() => parseWebAgentTurn({ message: "Hello", mode: "general_chat" }), /Choose whether/);
  assert.throws(() => parseWebAgentTurn({ message: "x".repeat(1_501), mode: "revise_plan" }), /under 1,500/);
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
