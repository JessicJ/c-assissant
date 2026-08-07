import type { GeneratedPlanDraft, WorkspaceSnapshot } from "@c-assistant/core";

export interface TelegramPlanCreation {
  source: "codex" | "template";
  workspace: WorkspaceSnapshot;
}

/** Uses the local runtime when available, but always leaves a reviewable draft. */
export async function createTelegramPlan(input: {
  request: string;
  generate: () => Promise<GeneratedPlanDraft>;
  saveGenerated: (draft: GeneratedPlanDraft) => WorkspaceSnapshot;
  saveTemplate: () => WorkspaceSnapshot;
}): Promise<TelegramPlanCreation> {
  let draft: GeneratedPlanDraft;
  try {
    draft = await input.generate();
  } catch {
    return { source: "template", workspace: input.saveTemplate() };
  }
  return { source: "codex", workspace: input.saveGenerated(draft) };
}

export function formatTelegramPlanCreation(result: TelegramPlanCreation): string {
  const plan = result.workspace.activePlan;
  const origin = result.source === "codex" ? "Codex created a complete Plan draft" : "Codex is unavailable, so C-assistant created a local template draft";
  return `${origin}:\n${plan.title}\n${plan.location} · ${plan.dates}\n\nReview the complete Plan in the Web workspace before confirmation or any future automation.`;
}
