import assert from "node:assert/strict";
import test from "node:test";

import { createInitialWorkspace, createPlanFromDraft } from "@c-assistant/core";
import { createTelegramPlan, formatTelegramPlan, formatTelegramPlanCreation } from "./telegram-plan.js";

const generated = {
  title: "Attend an exhibition in Shanghai",
  location: "Shanghai, China",
  dates: "September 2026",
  knownInformation: ["Purpose: exhibition"],
  assumptions: ["Accommodation is not confirmed."],
  nextAction: "Review the Plan.",
  stages: [{ title: "Before departure", description: "Prepare essentials.", tasks: [{ title: "Confirm accommodation", owner: "user" as const, dueLabel: "Before departure" }]
  }]
};

test("Telegram Plan creation saves a Codex draft when the local runtime succeeds", async () => {
  let templateSaved = false;
  const result = await createTelegramPlan({
    request: "Attend an exhibition in Shanghai.",
    runtime: "codex",
    generate: async () => generated,
    saveGenerated: (draft) => ({ ...createInitialWorkspace(), activePlan: createPlanFromDraft(draft) }),
    saveTemplate: () => {
      templateSaved = true;
      return createInitialWorkspace();
    }
  });
  assert.equal(result.source, "runtime");
  assert.equal(templateSaved, false);
  assert.match(formatTelegramPlanCreation(result), /Codex created/i);
});

test("Telegram Plan creation transparently falls back to a local draft when Codex fails", async () => {
  const result = await createTelegramPlan({
    request: "Attend an exhibition in Shanghai.",
    runtime: "codex",
    generate: async () => { throw new Error("Codex unavailable"); },
    saveGenerated: () => createInitialWorkspace(),
    saveTemplate: () => createInitialWorkspace()
  });
  assert.equal(result.source, "template");
  assert.match(formatTelegramPlanCreation(result), /unavailable/i);
});

test("Telegram Plan summary includes task state and safely shortens an oversized mobile preview", () => {
  const workspace = createInitialWorkspace();
  const completeSummary = formatTelegramPlan(workspace.activePlan);
  assert.match(completeSummary, /\[scheduled\] Open the arrival route in Amap/);
  workspace.activePlan.knownInformation = Array.from({ length: 8 }, () => "A verified Plan fact ".repeat(30));
  workspace.activePlan.assumptions = Array.from({ length: 8 }, () => "An assumption to correct ".repeat(30));
  const summary = formatTelegramPlan(workspace.activePlan);
  assert.match(summary, /Plan preview shortened for Telegram/);
  assert.ok(summary.length <= 3_800);
});
