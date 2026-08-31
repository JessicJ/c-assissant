import assert from "node:assert/strict";
import test from "node:test";

import { createInitialWorkspace, createPlanFromDraft } from "@c-assistant/core";
import { completedTasksForRevision, formatTelegramPlan, formatTelegramPlanChangeProposal, formatTelegramPlanPages, formatTelegramWorkspacePlanPages, parseTelegramPlanChangeAction, planDraftForRevision, telegramExecutionContinuityNotice, telegramPlanChangeMarkup, telegramPlanConfirmationDecision, telegramPlanConfirmationMarkup, telegramPlanRequestMode } from "./telegram-plan.js";

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

test("Telegram explains that an existing Plan continues while a replacement draft is reviewed", () => {
  const workspace = createInitialWorkspace();
  const executing = { ...workspace.activePlan, status: "active" as const, title: "Current Shanghai Plan" };
  const replacement = createPlanFromDraft({ ...generated, title: "Replacement Shanghai Plan" });
  const replacementWorkspace = { ...workspace, activePlan: replacement, executionPlan: executing };

  const notice = telegramExecutionContinuityNotice(replacementWorkspace);
  const pages = formatTelegramWorkspacePlanPages(replacementWorkspace);

  assert.match(notice ?? "", /Current Shanghai Plan.*still active/i);
  assert.match(pages.join("\n"), /approved reminders and timeline continue/i);
  assert.match(pages.join("\n"), /switches execution only after you confirm/i);
  assert.match(formatTelegramWorkspacePlanPages(replacementWorkspace).join("\n"), /Current Shanghai Plan.*still active/i);
  const { executionPlan: _executionPlan, ...workspaceWithoutExecution } = replacementWorkspace;
  assert.equal(telegramExecutionContinuityNotice(workspaceWithoutExecution), undefined);
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
  plan.assumptions = [];
  plan.nextAction = "Review and confirm the complete Plan.";
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

test("Telegram keeps complete confirmation available when only an optional refinement remains", () => {
  const plan = createInitialWorkspace().activePlan;
  plan.assumptions = ["The exact arrival date is unknown."];
  plan.nextAction = "What date will you arrive?";
  assert.ok(telegramPlanConfirmationMarkup(plan));
});

test("Telegram revision context strips Core state while retaining the complete draft", () => {
  const plan = createInitialWorkspace().activePlan;
  plan.presentation = { kind: "timeline", summary: "A preserved interactive timeline.", days: [], places: [], routeSegments: [] };
  plan.sources = [{ title: "Source", authority: "Authority", url: "https://example.com", retrievedAt: "2026-08-01T00:00:00.000Z", contentHash: "a".repeat(64) }];
  const context = planDraftForRevision(plan);

  assert.equal(context.title, plan.title);
  assert.equal(context.stages.length, plan.stages.length);
  assert.equal(context.stages[2]?.tasks[0]?.activationTrigger, "arrival");
  assert.deepEqual(context.presentation, plan.presentation);
  assert.notEqual(context.presentation, plan.presentation);
  assert.doesNotMatch(JSON.stringify({ ...context, presentation: undefined }), /plan-|stage-|task-|contentHash|configuration|sources/);
});

test("Telegram Plan change controls stay callback-safe and parse confirmation or cancellation", () => {
  const proposalId = "tg-change-123e4567-e89b-12d3-a456-426614174000";
  const markup = telegramPlanChangeMarkup(proposalId);
  const confirm = markup.inline_keyboard[0]![0]!.callback_data;
  const cancel = markup.inline_keyboard[0]![1]!.callback_data;
  assert.ok(confirm.length <= 64);
  assert.ok(cancel.length <= 64);
  assert.deepEqual(parseTelegramPlanChangeAction(confirm), { action: "confirm", proposalId });
  assert.deepEqual(parseTelegramPlanChangeAction(cancel), { action: "cancel", proposalId });
  assert.deepEqual(parseTelegramPlanChangeAction("confirm_plan:nope"), { action: "not_change" });
  assert.match(formatTelegramPlanChangeProposal("I want Italian food", { impact: "low", summary: "Review it.", reasons: [], affectedAreas: ["itinerary"] }), /current Plan has not changed/i);
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
