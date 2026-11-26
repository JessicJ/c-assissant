import { requireExactPlanConfirmation, type ExactPlanConfirmation } from "./travel-adjustment-application.js";
import { enqueueConfirmedReview } from "./email-plan-review.js";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { compileExecutionItinerary } from "./execution-itinerary.js";
import { reviewItineraryForPublication } from "./itinerary-publication-review.js";

import { WorkspaceMutationError, type WorkspaceMutationErrorCode } from "@c-assistant/core";
export class PlanActivationError extends WorkspaceMutationError {
  constructor(message: string, code: WorkspaceMutationErrorCode = "activation_review_required") { super(message, code); }
}
/** The desktop and mobile review share these activation checks and the same Core transaction. */
export function activateReviewedPlan(store: SqliteWorkspaceStore,input:{planId:string;expectedVersion:number;expectedBase?:{id:string;version:number};expectedBlueprintVersion?:number;expectedRecipientRevision?:number;exactConfirmation?:ExactPlanConfirmation}, now=new Date(), logWarning: (details: Record<string, unknown>, message: string) => void = (details, message) => console.warn(message, details)) {
  const workspace=store.getWorkspace();
  if(workspace.activePlan.id!==input.planId || workspace.activePlan.version!==input.expectedVersion)throw new PlanActivationError("The itinerary changed. Review the latest draft before confirming.", "version_conflict");
  const executing=store.getExecutionPlan();const audit=workspace.latestPlanReplacement;
  if(audit && executing && executing.id!==input.planId && (audit.sourcePlanId!==executing.id || audit.sourcePlanVersion!==executing.version))throw new PlanActivationError("The original itinerary changed. Prepare and review a new replacement draft.", "version_conflict");
  if(workspace.activePlan.status!=="draft")throw new PlanActivationError("This itinerary is no longer waiting for confirmation.", "confirmation_unavailable");
  if(workspace.activePlan.presentation?.kind==="itinerary"){
    const compiled=compileExecutionItinerary(workspace.activePlan);
    if(compiled.gaps.length || !compiled.activities.length)throw new PlanActivationError("Add valid dates, cities, activity times and destinations before starting this itinerary.");
  }
  if(workspace.activeBlueprint){
    const session=store.getPlanningSessionById(workspace.activeBlueprint.proposalRef.sessionId);
    if(session){
      const findings=reviewItineraryForPublication(workspace.activeBlueprint,session).filter(finding=>["missing_confirmed_gateway","departure_returns_to_lodging","overnight_anchor_mismatch","invalid_flight_leg","time_sequence_conflict","missing_overnight_base"].includes(finding.code));
      if(findings.length)throw new PlanActivationError(`This draft needs a route correction before activation: ${findings.map(finding=>finding.explanation).join(" ")}`);
    }
  }
  if(executing && executing.id!==input.planId)requireExactPlanConfirmation(store,input.exactConfirmation);
  const expectedBase = input.expectedBase ?? (audit && executing ? {id:audit.sourcePlanId,version:audit.sourcePlanVersion} : undefined);
  const confirmed=store.confirmPlan(input.planId,input.expectedVersion,{
    ...(expectedBase ? {expectedBase} : {}),
    ...(input.expectedBlueprintVersion!==undefined ? {expectedBlueprintVersion:input.expectedBlueprintVersion} : {}),
    ...(input.expectedRecipientRevision!==undefined ? {expectedRecipientRevision:input.expectedRecipientRevision} : {}),
    ...(input.exactConfirmation?{adjustmentContext:input.exactConfirmation.context,proposalDigest:input.exactConfirmation.proposalDigest}:{}),
    confirmedAt:now.toISOString()
  });
  try { enqueueConfirmedReview(store,now); }
  catch {
    // Activation has committed. Notification failure must not report it as rejected.
    logWarning({ code: "plan_confirmation_notification_unavailable", planId: input.planId, version: confirmed.activePlan.version }, "Plan activated, but confirmation notification could not be queued");
  }
  return confirmed;
}
