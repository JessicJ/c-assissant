import assert from "node:assert/strict";
import test from "node:test";

import { createInitialWorkspace, createPlanFromDraft } from "@c-assistant/core";
import { completedTasksForRevision, createTelegramPlan, formatTelegramPlan, formatTelegramPlanCreation, formatTelegramPlanPages, planDraftForRevision, telegramPlanConfirmationDecision, telegramPlanConfirmationMarkup, telegramPlanRequestMode } from "./telegram-plan.js";

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

test("Telegram Plan summary maps Task evidence to readable official source links", () => {
  const workspace = createInitialWorkspace();
  const sourceSnapshotId = "source-11111111-1111-1111-1111-111111111111";
  const contentHash = "b".repeat(64);
  workspace.activePlan.sources = [{ title: "Official entry guidance", authority: "National Immigration Administration", url: "https://en.nia.gov.cn/", retrievedAt: "2026-08-10T00:00:00.000Z", sourceSnapshotId, contentHash }];
  workspace.activePlan.stages[0]!.tasks[0]!.origin = {
    kind: "country_pack_compilation",
    countryPackId: "china",
    countryPackVersion: "0.1.0",
    compositionSkillId: "china-arrival-plan",
    compositionSkillVersion: "0.1.0",
    compilationKey: "china-arrival-preparation",
    sourcePlanVersion: workspace.activePlan.version,
    sourceSkills: [{ id: "policy-applicability", version: "0.1.0" }],
    sourceEvidence: [{ sourceSnapshotId, contentHash }]
  };

  const summary = formatTelegramPlanPages(workspace.activePlan).join("\n");

  assert.match(summary, /Official basis: \[1\]/);
  assert.match(summary, /\[1\] Official entry guidance — National Immigration Administration/);
  assert.match(summary, /https:\/\/en\.nia\.gov\.cn\//);
  assert.doesNotMatch(summary, /source-11111111|bbbbbbbbbbbb/);
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

test("Telegram revision context strips Core state while retaining the complete draft", () => {
  const plan = createInitialWorkspace().activePlan;
  plan.sources = [{ title: "Source", authority: "Authority", url: "https://example.com", retrievedAt: "2026-08-01T00:00:00.000Z", contentHash: "a".repeat(64) }];
  const context = planDraftForRevision(plan);

  assert.equal(context.title, plan.title);
  assert.equal(context.stages.length, plan.stages.length);
  assert.equal(context.stages[2]?.tasks[0]?.activationTrigger, "arrival");
  assert.doesNotMatch(JSON.stringify(context), /plan-|stage-|task-|contentHash|configuration|sources/);
});

test("Telegram revision context carries only completed Task facts separately", () => {
  const plan = createInitialWorkspace().activePlan;
  const task = plan.stages[0]!.tasks[0]!;
  task.status = "completed";

  assert.deepEqual(completedTasksForRevision(plan), [{
    stageTitle: plan.stages[0]!.title,
    title: task.title,
    dueLabel: task.dueLabel
  }]);
});

test("plain text revises only a user-created draft while /new always creates", () => {
  const workspace = createInitialWorkspace();
  assert.equal(telegramPlanRequestMode(workspace, false), "create");

  workspace.inbox.unshift({ id: `plan-generated-${workspace.activePlan.id}`, tone: "notice", title: "Draft", body: "Draft", timestamp: "Now" });
  assert.equal(telegramPlanRequestMode(workspace, false), "revise");
  assert.equal(telegramPlanRequestMode(workspace, true), "create");
  workspace.activePlan.status = "active";
  assert.equal(telegramPlanRequestMode(workspace, false), "create");
});
