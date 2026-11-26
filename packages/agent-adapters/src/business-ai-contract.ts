/** Business operations only. MAH owns Agent/model selection; these interfaces expose no provider. */
import type { SkillItineraryArtifact, SkillResearchBatchArtifact } from "@c-assistant/core";
import type {
  PlanningConversationRequest, PlanningConversationTurn, SkillResearchBatchRequest,
  SkillItineraryRequest, SkillItineraryReviewRequest, SkillItineraryReviewFinding,
  PlannedPlaceImageEnrichmentRequest, SkillImageEnrichmentArtifact,
  SemanticTravelPlanRequest, SemanticTravelPlanResult, SemanticTravelPlanRepairGenerationRequest
} from "./index.js";
import type { EmailResearchRequest, EmailResearchResult } from "./email-research.js";
import type { EmailTimingRequest, EmailTimingResult } from "./email-timing.js";

export interface BlueprintRuntime {
  generateSkillResearchBatch(request: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact>;
  generateSkillItinerary(request: SkillItineraryRequest): Promise<SkillItineraryArtifact>;
  reviewSkillItinerary(request: SkillItineraryReviewRequest): Promise<SkillItineraryReviewFinding[]>;
  generatePlannedPlaceImageEnrichment(request: PlannedPlaceImageEnrichmentRequest): Promise<SkillImageEnrichmentArtifact>;
  generateSemanticTravelPlan(request: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult>;
  generateSemanticTravelPlanRepair(request: SemanticTravelPlanRepairGenerationRequest): Promise<SemanticTravelPlanResult>;
}
export interface PlanningRuntime {
  continuePlanningConversation(request: PlanningConversationRequest): Promise<PlanningConversationTurn>;
}
export interface EmailRuntime {
  generateEmailResearch(request: EmailResearchRequest): Promise<EmailResearchResult>;
  generateEmailTiming(request: EmailTimingRequest): Promise<EmailTimingResult>;
}
export interface BusinessRuntime extends BlueprintRuntime, PlanningRuntime, EmailRuntime {}
