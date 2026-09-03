import type { ClaudeCodeRuntimeAdapter, CodexRuntimeAdapter, RuntimeKind } from "@c-assistant/agent-adapters";
import type { AgentRuntimeKind } from "@c-assistant/core";
import type { PlanningGenerationService } from "./planning-generation-service.js";

export type RuntimeAdapter = CodexRuntimeAdapter | ClaudeCodeRuntimeAdapter;

export interface RuntimeServices {
  runtimes: Record<RuntimeKind, RuntimeAdapter>;
  planningGeneration: PlanningGenerationService;
  getGeneratingPlan(): boolean;
  setGeneratingPlan(running: boolean): void;
  selectedRuntimeAdapter(kind: AgentRuntimeKind): RuntimeAdapter;
  abortGenerationJobs(): void;
}
