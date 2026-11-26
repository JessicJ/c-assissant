import type { RuntimeServices } from './runtime-services-contract.js';
import type { BlueprintRuntime } from './agent-work-contract.js';
import { blockedBusinessOperation } from './agent-work-contract.js';
import { blueprintGenerationKey, publicGenerationJob, publicPersistedGeneration, updateGenerationJob, planGenerationFailureCode } from './planning-generation-state.js';
export function createGuardedRuntimeServices(): RuntimeServices {
  const blocked = async () => blockedBusinessOperation();
  const blueprint: BlueprintRuntime = { generateSkillResearchBatch: blocked, generateSkillItinerary: blocked, reviewSkillItinerary: blocked, generatePlannedPlaceImageEnrichment: blocked, generateSemanticTravelPlan: blocked, generateSemanticTravelPlanRepair: blocked };
  return {
    runtimes: { codex: { check: async () => ({ kind: 'codex', installed: false, authenticated: false }) }, 'claude-code': { check: async () => ({ kind: 'claude-code', installed: false, authenticated: false }) } },
    business: { ...blueprint, continuePlanningConversation: blocked, generateEmailResearch: blocked, generateEmailTiming: blocked },
    planningGeneration: { jobs: new Map(), imageContinuations: new Map(), blueprintGenerationKey, publicGenerationJob, publicPersistedGeneration, updateGenerationJob, planGenerationFailureCode,
      enqueuePlanningSessionGeneration: () => blockedBusinessOperation(), markPersistedGenerationCancelled: () => blockedBusinessOperation(), cancelGeneration: blocked, stopGenerationSupervision: async () => {} },
    getGeneratingPlan: () => false, setGeneratingPlan: () => {}, recoverMahGenerations: async () => {}, abortGenerationJobs: async () => {}
  };
}
