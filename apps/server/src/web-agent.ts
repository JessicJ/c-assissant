import type { Plan } from "@c-assistant/core";

export type WebAgentMode = "new_plan" | "revise_plan";

export function parseWebAgentTurn(value: unknown): { message: string; mode: WebAgentMode } {
  if (!value || typeof value !== "object") throw new Error("Tell the Agent what you need first.");
  const body = value as { message?: unknown; mode?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new Error("Tell the Agent what you need first.");
  if (message.length > 1_500) throw new Error("Keep the message under 1,500 characters.");
  const mode = body.mode ?? "new_plan";
  if (mode !== "new_plan" && mode !== "revise_plan") throw new Error("Choose whether to create a new Plan or revise the current draft.");
  return { message, mode };
}

export function assertWebAgentPlanUnchanged(expected: Pick<Plan, "id" | "version">, current: Pick<Plan, "id" | "version">): void {
  if (expected.id !== current.id || expected.version !== current.version) {
    throw new Error("The Plan changed while the Agent was working. Your newer changes were preserved; send the request again if it is still needed.");
  }
}

export function formatWebAgentPlanReply(input: { runtimeName: string; mode: WebAgentMode; plan: Pick<Plan, "title" | "nextAction"> }): string {
  const action = input.mode === "revise_plan" ? "updated the current draft" : "prepared a new draft";
  return `${input.runtimeName} ${action}: “${input.plan.title}”. It remains a draft so you can review the complete assumptions, stages, tasks, reminders, and sources before activating it. Next: ${input.plan.nextAction}`;
}
