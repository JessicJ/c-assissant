import assert from "node:assert/strict";
import test from "node:test";

import { createInitialWorkspace, createPlanFromDraft } from "@c-assistant/core";
import { createTelegramPlan, formatTelegramPlanCreation } from "./telegram-plan.js";

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
    generate: async () => generated,
    saveGenerated: (draft) => ({ ...createInitialWorkspace(), activePlan: createPlanFromDraft(draft) }),
    saveTemplate: () => {
      templateSaved = true;
      return createInitialWorkspace();
    }
  });
  assert.equal(result.source, "codex");
  assert.equal(templateSaved, false);
  assert.match(formatTelegramPlanCreation(result), /Codex created/i);
});

test("Telegram Plan creation transparently falls back to a local draft when Codex fails", async () => {
  const result = await createTelegramPlan({
    request: "Attend an exhibition in Shanghai.",
    generate: async () => { throw new Error("Codex unavailable"); },
    saveGenerated: () => createInitialWorkspace(),
    saveTemplate: () => createInitialWorkspace()
  });
  assert.equal(result.source, "template");
  assert.match(formatTelegramPlanCreation(result), /unavailable/i);
});
