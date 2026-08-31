import type { Plan } from "@c-assistant/core";

export type WebAgentMode = "new_plan" | "revise_plan";

export function parseWebAgentTurn(value: unknown): { message: string; mode: WebAgentMode; impactConfirmed?: boolean; expectedPlanId?: string; expectedVersion?: number } {
  if (!value || typeof value !== "object") throw new Error("Tell the Agent what you need first.");
  const body = value as { message?: unknown; mode?: unknown; impactConfirmed?: unknown; expectedPlanId?: unknown; expectedVersion?: unknown };
  const mode = body.mode ?? "new_plan";
  if (mode !== "new_plan" && mode !== "revise_plan") throw new Error("Choose whether to create a new Plan or revise the current draft.");
  if (mode === "new_plan") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new Error("Tell the Agent what you need first.");
    if (message.length > 1_500) throw new Error("Keep the message under 1,500 characters.");
    return { message, mode };
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new Error("Tell the Agent what you need first.");
  if (message.length > 1_500) throw new Error("Keep the message under 1,500 characters.");
  if (body.impactConfirmed !== undefined && typeof body.impactConfirmed !== "boolean") throw new Error("Impact confirmation must be a boolean.");
  if (body.expectedPlanId !== undefined && (typeof body.expectedPlanId !== "string" || !body.expectedPlanId.trim())) throw new Error("Expected Plan id must be a non-empty string.");
  if (body.expectedVersion !== undefined && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)) throw new Error("Expected Plan version must be a positive integer.");
  return { message, mode, ...(body.impactConfirmed === true ? { impactConfirmed: true } : {}), ...(typeof body.expectedPlanId === "string" ? { expectedPlanId: body.expectedPlanId } : {}), ...(typeof body.expectedVersion === "number" ? { expectedVersion: body.expectedVersion } : {}) };
}

export function assertWebAgentPlanUnchanged(expected: Pick<Plan, "id" | "version">, current: Pick<Plan, "id" | "version">): void {
  if (expected.id !== current.id || expected.version !== current.version) {
    throw new Error("The Plan changed while the Agent was working. Your newer changes were preserved; send the request again if it is still needed.");
  }
}

export function formatWebAgentPlanReply(input: { runtimeName: string; mode: WebAgentMode; plan: Pick<Plan, "title" | "nextAction">; followUpQuestion?: string }): string {
  const action = input.mode === "revise_plan" ? "updated the current draft" : "prepared a new draft";
  if (input.followUpQuestion) {
    return `${input.runtimeName} ${action}: “${input.plan.title}”. You can review or stop now; unanswered details will remain visible as pending confirmation items. If you want to improve one important detail, answer this: ${input.followUpQuestion}`;
  }
  return `${input.runtimeName} ${action}: “${input.plan.title}”. The Plan is ready to review. Check its facts and pending confirmation items, then confirm it when you are ready to activate eligible reminders and execution.`;
}
