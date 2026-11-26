import { WorkspaceMutationError } from "@c-assistant/core";
import { resolveAssistantPersonality, type PersonalityContext } from "@c-assistant/core";
import type { DirectBlueprintAssistedReplanningHandoff, Plan } from "@c-assistant/core";

export type WebAgentMode = "new_plan" | "revise_plan";

export function parseWebAgentTurn(value: unknown): { message: string; mode: WebAgentMode; impactConfirmed?: boolean; expectedPlanId?: string; expectedVersion?: number; assistedReplanning?: DirectBlueprintAssistedReplanningHandoff } {
  if (!value || typeof value !== "object") throw new WorkspaceMutationError("Tell the Agent what you need first.");
  const body = value as { message?: unknown; mode?: unknown; impactConfirmed?: unknown; expectedPlanId?: unknown; expectedVersion?: unknown; assistedReplanning?: unknown };
  const mode = body.mode ?? "new_plan";
  if (mode !== "new_plan" && mode !== "revise_plan") throw new WorkspaceMutationError("Choose whether to create a new Plan or revise the current draft.");
  if (mode === "new_plan") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new WorkspaceMutationError("Tell the Agent what you need first.");
    if (message.length > 1_500) throw new WorkspaceMutationError("Keep the message under 1,500 characters.");
    return { message, mode };
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new WorkspaceMutationError("Tell the Agent what you need first.");
  const assistedReplanning = parseAssistedReplanningHandoff(body.assistedReplanning);
  if (message.length > (assistedReplanning ? 8_000 : 1_500)) throw new WorkspaceMutationError(assistedReplanning ? "Keep the assisted replanning request under 8,000 characters." : "Keep the message under 1,500 characters.");
  if (body.impactConfirmed !== undefined && typeof body.impactConfirmed !== "boolean") throw new WorkspaceMutationError("Impact confirmation must be a boolean.");
  if (body.expectedPlanId !== undefined && (typeof body.expectedPlanId !== "string" || !body.expectedPlanId.trim())) throw new WorkspaceMutationError("Expected Plan id must be a non-empty string.");
  if (body.expectedVersion !== undefined && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)) throw new WorkspaceMutationError("Expected Plan version must be a positive integer.");
  return { message, mode, ...(body.impactConfirmed === true ? { impactConfirmed: true } : {}), ...(typeof body.expectedPlanId === "string" ? { expectedPlanId: body.expectedPlanId } : {}), ...(typeof body.expectedVersion === "number" ? { expectedVersion: body.expectedVersion } : {}), ...(assistedReplanning ? { assistedReplanning } : {}) };
}

function parseAssistedReplanningHandoff(value: unknown): DirectBlueprintAssistedReplanningHandoff | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceMutationError("Assisted replanning needs a structured handoff.");
  const handoff = value as { status?: unknown; baseBlueprintId?: unknown; baseBlueprintVersion?: unknown; request?: unknown; affectedDayIds?: unknown; affectedPlaceIds?: unknown; replanRequirement?: unknown; revisions?: unknown };
  if (handoff.status !== "ready_for_assisted_replanning") throw new WorkspaceMutationError("Assisted replanning needs a prepared handoff.");
  if (typeof handoff.baseBlueprintId !== "string" || !handoff.baseBlueprintId.trim()) throw new WorkspaceMutationError("Assisted replanning needs a base Trip Blueprint.");
  if (!Number.isInteger(handoff.baseBlueprintVersion) || Number(handoff.baseBlueprintVersion) < 1) throw new WorkspaceMutationError("Assisted replanning needs a base Trip Blueprint version.");
  if (typeof handoff.request !== "string" || !handoff.request.trim()) throw new WorkspaceMutationError("Assisted replanning needs a request.");
  if (!Array.isArray(handoff.affectedDayIds) || !Array.isArray(handoff.affectedPlaceIds) || !Array.isArray(handoff.revisions)) throw new WorkspaceMutationError("Assisted replanning needs affected scope and pending edits.");
  if (!handoff.replanRequirement || typeof handoff.replanRequirement !== "object" || Array.isArray(handoff.replanRequirement)) throw new WorkspaceMutationError("Assisted replanning needs its requirement.");
  return value as DirectBlueprintAssistedReplanningHandoff;
}

export function assertWebAgentPlanUnchanged(expected: Pick<Plan, "id" | "version">, current: Pick<Plan, "id" | "version">): void {
  if (expected.id !== current.id || expected.version !== current.version) {
    throw new WorkspaceMutationError("The Plan changed while the Agent was working. Your newer changes were preserved; send the request again if it is still needed.", "version_conflict");
  }
}

export function formatWebAgentPlanReply(input: { profile?: PersonalityContext; runtimeName: string; mode: WebAgentMode; plan: Pick<Plan, "title" | "nextAction">; followUpQuestion?: string }): string {
  const action = input.mode === "revise_plan" ? "updated the current draft" : "prepared a new draft";
  if (input.profile) {
    const persona = resolveAssistantPersonality(input.profile.assistantPersonality);
    const opening = persona.id === "travel_buddy" ? `Your ${input.mode === "revise_plan" ? "updated" : "new"} draft is ready (˶ᵔᵕᵔ˶)` : persona.id === "miles" ? `Alright, ${input.mode === "revise_plan" ? "the revised" : "your new"} draft is ready` : `I’ve ${input.mode === "revise_plan" ? "updated" : "prepared"} your draft`;
    return `${opening}: “${input.plan.title}”. ${input.followUpQuestion ? `One detail to consider: ${input.followUpQuestion} You can answer it or review the draft now; anything still unknown stays marked for confirmation.` : 'Review the details and anything still marked for confirmation. Confirm when you’re ready to activate the eligible reminders.'}`;
  }
  if (input.followUpQuestion) {
    return `${input.runtimeName} ${action}: “${input.plan.title}”. You can review or stop now; unanswered details will remain visible as pending confirmation items. If you want to improve one important detail, answer this: ${input.followUpQuestion}`;
  }
  return `${input.runtimeName} ${action}: “${input.plan.title}”. The Plan is ready to review. Check its facts and pending confirmation items, then confirm it when you are ready to activate eligible reminders and execution.`;
}
