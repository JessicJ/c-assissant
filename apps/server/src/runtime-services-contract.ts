import type { GenerationAdmission } from './generation-admission.js';
import type { RuntimeKind } from "@c-assistant/agent-adapters";
import type { BlueprintRuntime, BusinessRuntime, LocalRuntimeDiagnostics } from "./agent-work-contract.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import type { MahPlanningConversationService } from "./mah-planning-conversation.js";



export interface RuntimeServices {
  runtimes: Record<RuntimeKind, LocalRuntimeDiagnostics>;
  business: BusinessRuntime;
  planningConversation?: MahPlanningConversationService;
  planningGeneration: PlanningGenerationService;
  generationAdmission?: GenerationAdmission;
  getGeneratingPlan(): boolean;
  setGeneratingPlan(running: boolean): void;
  itineraryContentReview?: BlueprintRuntime["reviewSkillItinerary"];
  recoverMahGenerations(): Promise<void>;
  abortGenerationJobs(): Promise<void>;
}
