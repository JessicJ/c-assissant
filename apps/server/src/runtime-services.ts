import { ClaudeCodeRuntimeAdapter, CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import type { AgentRuntimeKind } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createPlanningGenerationService } from "./planning-generation.js";
import type { RuntimeServices } from "./runtime-services-contract.js";
import type { SemanticShadowConfig } from "./semantic-shadow.js";
import type { SemanticDraftCanaryConfig } from "./semantic-draft-canary.js";

export function createRuntimeServices(dependencies: {
  store: SqliteWorkspaceStore;
  semanticShadow: SemanticShadowConfig;
  semanticDraftCanary: SemanticDraftCanaryConfig;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
}): RuntimeServices {
  const { store, semanticShadow, semanticDraftCanary, logGenerationFailure } = dependencies;
  const codex = new CodexRuntimeAdapter();
  const claudeCode = new ClaudeCodeRuntimeAdapter();
  let generatingPlan = false;
  const planningGeneration = createPlanningGenerationService({
    store,
    codex,
    semanticShadow,
    semanticDraftCanary,
    plannedPlaceImageEnrichment: true,
    setGeneratingPlan: (running) => { generatingPlan = running; },
    logGenerationFailure
  });

  function selectedRuntimeAdapter(kind: AgentRuntimeKind): CodexRuntimeAdapter | ClaudeCodeRuntimeAdapter {
    return kind === "claude-code" ? claudeCode : codex;
  }

  function abortGenerationJobs(): void {
    for (const job of planningGeneration.jobs.values()) if (job.status === "running") job.controller.abort();
  }

  return {
    runtimes: { codex, "claude-code": claudeCode },
    planningGeneration,
    getGeneratingPlan: () => generatingPlan,
    setGeneratingPlan: (running: boolean) => { generatingPlan = running; },
    selectedRuntimeAdapter,
    abortGenerationJobs
  };
}
