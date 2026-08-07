import assert from "node:assert/strict";
import test from "node:test";

import { createInitialWorkspace, createPlanFromDraft } from "@c-assistant/core";
import { createTelegramPlan, formatTelegramPlan, formatTelegramPlanCreation, formatTelegramPlanPages, telegramPlanConfirmationDecision, telegramPlanConfirmationMarkup } from "./telegram-plan.js";

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
  assert.match(formatTelegramPlanCreation(result), /Known information/);
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
  const pages = formatTelegramPlanPages(workspace.activePlan);
  assert.match(summary, /Plan preview shortened/);
  assert.ok(summary.length <= 3_800);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= 3_800));
  assert.match(pages.at(-1) ?? "", /Confirm only if this complete Plan is correct/);
  assert.doesNotMatch(pages.join("\n"), /Plan preview shortened/);
});

test("Telegram Plan summary shows a proposed structured reminder", () => {
  const workspace = createInitialWorkspace();
  workspace.activePlan.stages[0]!.tasks[0]!.reminder = {
    scheduledAtLocal: "2026-09-01T05:00",
    timeZone: "Asia/Shanghai",
    purpose: "Check your passport and essential items.",
    refreshFacts: ["weather"]
  };

  const summary = formatTelegramPlan(workspace.activePlan);

  assert.match(summary, /Proposed reminder: 2026-09-01 05:00 \(Asia\/Shanghai\)/);
  assert.match(summary, /Check your passport and essential items/);
  assert.match(summary, /refresh at delivery: destination weather/);
});

test("Telegram confirmation is bound to the current draft Plan version", () => {
  const plan = createInitialWorkspace().activePlan;
  const markup = telegramPlanConfirmationMarkup(plan);
  const callbackData = markup?.inline_keyboard[0]?.[0]?.callback_data;

  assert.ok(callbackData);
  assert.ok(callbackData.length <= 64);
  assert.equal(telegramPlanConfirmationDecision(plan, callbackData), "confirm");
  assert.equal(telegramPlanConfirmationDecision({ ...plan, version: plan.version + 1 }, callbackData), "stale");
  assert.equal(telegramPlanConfirmationDecision({ ...plan, status: "active" }, callbackData), "already_active");
  assert.equal(telegramPlanConfirmationMarkup({ ...plan, status: "active" }), undefined);
  assert.equal(telegramPlanConfirmationDecision(plan, "arrival_not_here"), "not_confirmation");
});
