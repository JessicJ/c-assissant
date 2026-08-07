import type { AgentRuntimeKind, GeneratedPlanDraft, Plan, WorkspaceSnapshot } from "@c-assistant/core";

export interface TelegramPlanCreation {
  source: "runtime" | "template";
  runtime: AgentRuntimeKind;
  workspace: WorkspaceSnapshot;
}

/** Uses the local runtime when available, but always leaves a reviewable draft. */
export async function createTelegramPlan(input: {
  request: string;
  runtime: AgentRuntimeKind;
  generate: () => Promise<GeneratedPlanDraft>;
  saveGenerated: (draft: GeneratedPlanDraft) => WorkspaceSnapshot;
  saveTemplate: () => WorkspaceSnapshot;
}): Promise<TelegramPlanCreation> {
  let draft: GeneratedPlanDraft;
  try {
    draft = await input.generate();
  } catch {
    return { source: "template", runtime: input.runtime, workspace: input.saveTemplate() };
  }
  return { source: "runtime", runtime: input.runtime, workspace: input.saveGenerated(draft) };
}

export function formatTelegramPlanCreation(result: TelegramPlanCreation): string {
  const plan = result.workspace.activePlan;
  const runtime = result.runtime === "claude-code" ? "Claude Code" : "Codex";
  const origin = result.source === "runtime" ? `${runtime} created a complete Plan draft` : `${runtime} is unavailable, so C-assistant created a local template draft`;
  return `${origin}:\n${plan.title}\n${plan.location} · ${plan.dates}\n\nReview the complete Plan in the Web workspace before confirmation or any future automation.`;
}

/** A readable mobile summary; the Web workspace remains the canonical complete Plan view. */
export function formatTelegramPlan(plan: Plan): string {
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
      if (task.reminder) lines.push(`      Proposed reminder: ${task.reminder.scheduledAtLocal.replace("T", " ")} (${task.reminder.timeZone}) — ${oneLine(task.reminder.purpose, 180)}`);
    });
  });
  lines.push("", `Next: ${oneLine(plan.nextAction)}`, "", "Use the Web workspace to review every field and confirm or revise this Plan.");
  return truncateTelegramText(lines.join("\n"));
}

function oneLine(value: string, maxLength = 220): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function truncateTelegramText(value: string): string {
  const maxLength = 3_800;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 110).trimEnd()}\n\n[Plan preview shortened for Telegram. Open the Web workspace for the complete Plan.]`;
}
