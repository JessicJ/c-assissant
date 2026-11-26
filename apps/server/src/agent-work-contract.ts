import type { RuntimeCheck } from "@c-assistant/agent-adapters";
export type { AgentWork, AgentWorkScope, AgentWorkStatus } from "@c-assistant/storage";

export type { BlueprintRuntime, PlanningRuntime, EmailRuntime, BusinessRuntime } from "@c-assistant/agent-adapters";
export interface LocalRuntimeDiagnostics { check(): Promise<RuntimeCheck> }

export class AgentExecutionBlocked extends Error {
  readonly code = "public_mah_contract_missing";
  constructor() { super("MAH integration is not ready. Your saved requirements and current plan are preserved."); }
}
export function blockedBusinessOperation(): never { throw new AgentExecutionBlocked(); }
