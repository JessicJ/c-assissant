import type { PlanningSession, WorkspaceSnapshot } from "@c-assistant/core";
import type {
  blueprintGenerationKey,
  planGenerationFailureCode,
  publicGenerationJob,
  publicPersistedGeneration,
  updateGenerationJob,
  PlanGenerationJob
} from "./planning-generation-state.js";

export interface PlanningGenerationService {
  jobs: Map<string, PlanGenerationJob>;
  blueprintGenerationKey: typeof blueprintGenerationKey;
  enqueuePlanningSessionGeneration(session: PlanningSession, workspace: WorkspaceSnapshot): PlanGenerationJob;
  publicGenerationJob: typeof publicGenerationJob;
  publicPersistedGeneration: typeof publicPersistedGeneration;
  updateGenerationJob: typeof updateGenerationJob;
  markPersistedGenerationCancelled(generationKey: string, message: string): void;
  planGenerationFailureCode: typeof planGenerationFailureCode;
}
