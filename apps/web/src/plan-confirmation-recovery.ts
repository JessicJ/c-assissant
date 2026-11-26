import { isDefiniteMutationRejection, safePlanError } from "./api-client.js";
import type { WorkspaceSnapshot } from "@c-assistant/core";

export type ReviewedPlanConfirmation = {
  exactConfirmation?: import("./api-client.js").ExactPlanConfirmation;
  planId: string;
  version: number;
  blueprint?: { id: string; version: number };
  base?: { id: string; version: number };
};

export function reviewedPlanConfirmation(workspace: WorkspaceSnapshot): ReviewedPlanConfirmation {
  return {
    planId: workspace.activePlan.id,
    version: workspace.activePlan.version,
    ...(workspace.activeBlueprint ? { blueprint: { id: workspace.activeBlueprint.id, version: workspace.activeBlueprint.version } } : {}),
    ...(workspace.executionPlan ? { base: { id: workspace.executionPlan.id, version: workspace.executionPlan.version } } : {})
  };
}

export class PlanConfirmationReadbackError extends Error {
  constructor(message: string, readonly uncertain: boolean, readonly workspace?: WorkspaceSnapshot) { super(message); }
}

const unknownResult = "The confirmation result is still unknown. Landi has not submitted another confirmation. Check the current itinerary before retrying.";

function sameReviewedVersion(review: ReviewedPlanConfirmation, workspace: WorkspaceSnapshot): boolean {
  return workspace?.activePlan?.id === review.planId && workspace.activePlan.version === review.version
    && workspace.activeBlueprint?.id === review.blueprint?.id
    && workspace.activeBlueprint?.version === review.blueprint?.version;
}

/** Reconcile current state, not attribution to a particular HTTP request. Never auto-resubmit. */
export async function confirmWithReadback(review: ReviewedPlanConfirmation, dependencies: {
  submit: () => Promise<WorkspaceSnapshot>;
  read: () => Promise<WorkspaceSnapshot>;
}, retry = false): Promise<WorkspaceSnapshot> {
  async function readState(): Promise<WorkspaceSnapshot> {
    try { return await dependencies.read(); }
    catch { throw new PlanConfirmationReadbackError(unknownResult, true); }
  }
  function isActive(workspace: WorkspaceSnapshot): boolean {
    return sameReviewedVersion(review, workspace) && workspace.activePlan.status === "active" && !workspace.executionPlan;
  }
  function requireReviewedDraft(workspace: WorkspaceSnapshot): void {
    if (!sameReviewedVersion(review, workspace) || workspace.activePlan.status !== "draft"
      || workspace.executionPlan?.id !== review.base?.id || workspace.executionPlan?.version !== review.base?.version) {
      throw new PlanConfirmationReadbackError("The itinerary or its executing base changed. Review the latest plan before confirming.", false, workspace);
    }
  }
  if (retry) {
    const current = await readState();
    if (isActive(current)) return current;
    requireReviewedDraft(current);
    // Only this explicit user retry may submit, after a fresh read of the same draft.
  }
  let confirmed: WorkspaceSnapshot;
  try { confirmed = await dependencies.submit(); }
  catch (caught) {
    const current = await readState();
    if (isActive(current)) return current;
    requireReviewedDraft(current);
    if(isDefiniteMutationRejection(caught))throw new PlanConfirmationReadbackError(safePlanError(caught),false,current);
    // A draft read cannot prove an earlier request will not commit later.
    throw new PlanConfirmationReadbackError(`${unknownResult} ${safePlanError(caught)}`, true, current);
  }
  if (isActive(confirmed)) return confirmed;
  // Even an HTTP success with an incomplete/mismatched body needs an authoritative read.
  const current = await readState();
  if (isActive(current)) return current;
  requireReviewedDraft(current);
  throw new PlanConfirmationReadbackError(unknownResult, true, current);
}
