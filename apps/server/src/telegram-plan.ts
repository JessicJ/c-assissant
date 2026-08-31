import type { GeneratedPlanDraft, Plan, WorkspaceSnapshot } from "@c-assistant/core";
import { planRefinementState } from "./plan-refinement.js";

export type TelegramPlanConfirmationDecision = "confirm" | "already_active" | "stale" | "not_confirmation";
export type TelegramPlanConfirmationMarkup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
export type TelegramPlanRequestMode = "create" | "revise";
export type TelegramPlanChangeAction = { action: "confirm" | "cancel"; proposalId: string } | { action: "not_change" };

export function planDraftForRevision(plan: Plan): GeneratedPlanDraft {
  return {
    title: plan.title,
    location: plan.location,
    dates: plan.dates,
    knownInformation: [...plan.knownInformation],
    assumptions: [...plan.assumptions],
    nextAction: plan.nextAction,
    ...(plan.presentation ? { presentation: structuredClone(plan.presentation) } : {}),
    stages: plan.stages.map((stage) => ({
      title: stage.title,
      description: stage.description,
      tasks: stage.tasks.map((task) => ({
        title: task.title,
        ...(task.description ? { description: task.description } : {}),
        owner: task.owner,
        dueLabel: task.dueLabel,
        ...(task.activationTrigger ? { activationTrigger: task.activationTrigger } : {}),
        ...(task.reminder ? { reminder: task.reminder } : {})
      }))
    }))
  };
}

export function telegramPlanChangeMarkup(proposalId: string): TelegramPlanConfirmationMarkup {
  return { inline_keyboard: [[
    { text: "Preview replacement Plan", callback_data: `confirm_change:${proposalId}` },
    { text: "Keep current Plan", callback_data: `cancel_change:${proposalId}` }
  ]] };
}

export function parseTelegramPlanChangeAction(callbackData: string | undefined): TelegramPlanChangeAction {
  const match = callbackData?.match(/^(confirm|cancel)_change:(tg-change-[0-9a-f-]{36})$/);
  if (!match) return { action: "not_change" };
  return { action: match[1] as "confirm" | "cancel", proposalId: match[2]! };
}

export function formatTelegramPlanChangeProposal(request: string, impact: Pick<import("@c-assistant/core").PlanChangeImpactPreview, "impact" | "summary" | "reasons" | "affectedAreas">): string {
  const areas = impact.affectedAreas.join(", ");
  const reasons = impact.reasons.length ? `\n${impact.reasons.map((reason) => `• ${reason}`).join("\n")}` : "";
  return `Proposed Plan change\n\n“${oneLine(request, 600)}”\n\nImpact: ${impact.impact}\nAffected: ${areas}\n${impact.summary}${reasons}\n\nThe current Plan has not changed. Choose whether Landi should generate a complete replacement draft for review.`;
}

/** Exposes only user-confirmed completion facts needed for safe Plan revision decisions. */
export function completedTasksForRevision(plan: Plan): Array<{ stageTitle: string; title: string; dueLabel: string }> {
  return plan.stages.flatMap((stage) => stage.tasks
    .filter((task) => task.status === "completed")
    .map((task) => ({ stageTitle: stage.title, title: task.title, dueLabel: task.dueLabel })));
}

export function telegramPlanRequestMode(workspace: WorkspaceSnapshot, explicitNew: boolean): TelegramPlanRequestMode {
  if (explicitNew || workspace.activePlan.status !== "draft") return "create";
  const id = workspace.activePlan.id;
  const currentDraftWasUserCreated = workspace.inbox.some((item) => item.id === `plan-generated-${id}` || item.id === `plan-created-${id}` || item.id === `plan-revised-${id}`);
  return currentDraftWasUserCreated ? "revise" : "create";
}

/** Explains the review/execution split without presenting inferred state as fact. */
export function telegramExecutionContinuityNotice(workspace: WorkspaceSnapshot): string | undefined {
  if (!workspace.executionPlan || workspace.activePlan.status !== "draft") return undefined;
  return `The existing Plan “${workspace.executionPlan.title}” is still active. Its approved reminders and timeline continue while you review this complete replacement draft. Landi switches execution only after you confirm the replacement.`;
}

/** A readable mobile copy of the complete Plan, bounded by Telegram's message limit. */
export function formatTelegramPlan(plan: Plan): string {
  return truncateTelegramText(telegramPlanText(plan));
}

export function formatTelegramPlanPages(plan: Plan): string[] {
  return paginateTelegramText(telegramPlanText(plan));
}

/** Formats the current review Plan together with any distinct Plan still executing. */
export function formatTelegramWorkspacePlanPages(workspace: WorkspaceSnapshot): string[] {
  const continuity = telegramExecutionContinuityNotice(workspace);
  return paginateTelegramText(`${continuity ? `${continuity}\n\n` : ""}${telegramPlanText(workspace.activePlan)}`);
}

function telegramPlanText(plan: Plan): string {
  const sourceNumbers = new Map(plan.sources.map((source, index) => [sourceEvidenceKey(source.sourceSnapshotId, source.contentHash), index + 1]));
  const lines = [
    "Current Plan",
    plan.title,
    `${plan.location} · ${plan.dates}`,
    `Status: ${plan.status}`,
    "",
    "Known information",
    ...plan.knownInformation.map((item) => `• ${oneLine(item)}`),
    "",
    "Assumptions to correct",
    ...(plan.assumptions.length ? plan.assumptions.map((item) => `• ${oneLine(item)}`) : ["• None recorded."]),
    "",
    "Stages"
  ];
  plan.stages.forEach((stage, index) => {
    lines.push(`${index + 1}. ${oneLine(stage.title)}`);
    stage.tasks.forEach((task) => {
      lines.push(`   [${task.status.replaceAll("_", " ")}] ${oneLine(task.title)} — ${oneLine(task.dueLabel, 100)}`);
      if (task.reminder) {
        const refresh = task.reminder.refreshFacts?.includes("weather") ? " · refresh at delivery: destination weather" : " · dynamic facts: none";
        lines.push(`      Proposed reminder: ${task.reminder.scheduledAtLocal.replace("T", " ")} (${task.reminder.timeZone}) — ${oneLine(task.reminder.purpose, 180)}${refresh}`);
      }
      const taskSourceNumbers = [...new Set((task.origin?.sourceEvidence ?? []).flatMap((evidence) => {
        const number = sourceNumbers.get(sourceEvidenceKey(evidence.sourceSnapshotId, evidence.contentHash));
        return number ? [number] : [];
      }))];
      if (taskSourceNumbers.length) lines.push(`      Official basis: ${taskSourceNumbers.map((number) => `[${number}]`).join(" ")}`);
    });
  });
  if (plan.sources.length) {
    lines.push("", "Official sources");
    plan.sources.forEach((source, index) => {
      lines.push(`[${index + 1}] ${oneLine(source.title, 160)} — ${oneLine(source.authority, 120)}`);
      lines.push(`    ${oneLine(source.url, 500)}`);
      lines.push(`    Retrieved: ${oneLine(source.retrievedAt, 80)}`);
    });
  }
  const closing = plan.status === "draft"
    ? "Review every field above. Confirm only if this complete Plan is correct; otherwise send your correction or create a revised Plan."
    : "This Plan is active. Send a correction to create a new draft before changing its automation scope.";
  lines.push("", `Next: ${oneLine(plan.nextAction)}`, "", closing);
  return lines.join("\n");
}

function sourceEvidenceKey(sourceSnapshotId: string | undefined, contentHash: string | undefined): string {
  return sourceSnapshotId && contentHash ? `${sourceSnapshotId}:${contentHash}` : "";
}

export function telegramPlanConfirmationMarkup(plan: Plan): TelegramPlanConfirmationMarkup | undefined {
  if (plan.status !== "draft" || !planRefinementState(plan).readyForReview) return undefined;
  return { inline_keyboard: [[{ text: "Confirm complete Plan", callback_data: `confirm_plan:${plan.id}:${plan.version}` }]] };
}

export function telegramPlanConfirmationDecision(plan: Plan, callbackData: string | undefined): TelegramPlanConfirmationDecision {
  const match = callbackData?.match(/^confirm_plan:(plan-[0-9a-f-]{36}):(\d+)$/);
  if (!match) return "not_confirmation";
  const [, planId, rawVersion] = match;
  if (plan.id !== planId || plan.version !== Number(rawVersion)) return "stale";
  return plan.status === "active" ? "already_active" : "confirm";
}

function oneLine(value: string, maxLength = 220): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function truncateTelegramText(value: string): string {
  const maxLength = 3_800;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 110).trimEnd()}\n\n[Plan preview shortened. Use the paginated Telegram Plan or Web workspace for the complete version.]`;
}

function paginateTelegramText(value: string): string[] {
  const maxBodyLength = 3_650;
  if (value.length <= maxBodyLength) return [value];
  const pages: string[] = [];
  let current = "";
  for (const line of value.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxBodyLength) {
      current = candidate;
      continue;
    }
    if (current) pages.push(current);
    current = line;
  }
  if (current) pages.push(current);
  return pages.map((page, index) => `[Plan ${index + 1}/${pages.length}]\n${page}`);
}
