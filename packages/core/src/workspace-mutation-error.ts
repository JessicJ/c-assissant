/** 只允许领域拒绝使用此类型；底层异常不得据文本转换为领域错误。 */
export type WorkspaceMutationErrorCode = "invalid_edit" | "assisted_replanning_required" | "booking_source_review_required" | "version_conflict" | "request_identity_conflict" | "blueprint_required" | "edit_unavailable" | "history_plan_protected" | "unconfirmed_draft_required" | "active_plan_required" | "operation_not_found" | "already_scheduled" | "unchanged_edit" | "draft_required" | "task_at_boundary" | "empty_edits" | "too_many_edits" | "invalid_placement" | "activation_review_required" | "confirmation_unavailable" | "generation_busy" | "profile_required" | "route_refresh_unavailable" | "empty_route_selection" | "too_many_route_legs" | "address_unresolved";

export class WorkspaceMutationError extends Error {
  constructor(message: string, readonly code: WorkspaceMutationErrorCode = "invalid_edit") {
    super(message);
    this.name = "WorkspaceMutationError";
  }
}

export const workspaceMutationMessages: Record<WorkspaceMutationErrorCode | "internal_error", string> = {
  booking_source_review_required: "Some saved booking information has not been included or verified. Check the sources, then review the booking links.",
  assisted_replanning_required: "The selected sources change or omit a fixed commitment. Check the booking information or ask Landi to replan.",
  confirmation_unavailable: "This itinerary is no longer awaiting confirmation. Check the current execution status.",
  generation_busy: "Your travel plan is being generated. Please try again later.",
  profile_required: "Complete your profile before adjusting the itinerary.",
  route_refresh_unavailable: "Routes could not be updated. Your itinerary is unchanged. Try again later or check the routes.",
  empty_route_selection: "Select at least one route leg to update.",
  too_many_route_legs: "You can update up to 36 route legs at a time. Select fewer legs.",
  address_unresolved: "The accommodation address could not be verified. Add its name and area, then try again.",
  already_scheduled: "This place is already in the day’s itinerary. Choose another place or change its order.",
  unchanged_edit: "This item is already in the selected state. No changes were saved.",
  draft_required: "Create a replacement draft before adjusting the approved itinerary.",
  task_at_boundary: "This item is already at the edge of its section and cannot move further in that direction.",
  empty_edits: "Choose at least one change to save.",
  too_many_edits: "You can save up to 36 changes at a time. Reduce this batch.",
  invalid_placement: "Choose a valid date and position, then try again.",
  activation_review_required: "Check and resolve the itinerary dates, routes and fixed commitments before approving it.",
  invalid_edit: "This change is not valid. Check your selection and try again.",
  version_conflict: "The plan has changed. Refresh and review the latest version. Your pending edits have been kept.",
  request_identity_conflict: "This request does not match the original change. Check the original result before editing again.",
  blueprint_required: "This itinerary has no editable travel blueprint. Complete itinerary generation first.",
  edit_unavailable: "This edit can no longer be undone directly. Review the current itinerary before making further changes.",
  history_plan_protected: "The current or executing itinerary cannot be deleted from history. Choose an archived itinerary.",
  unconfirmed_draft_required: "Only unconfirmed drafts can be discarded. Use End trip for an approved itinerary.",
  active_plan_required: "Only the executing itinerary can be ended. Return to the current itinerary and check its status.",
  operation_not_found: "This item is no longer available. Refresh and select it again.",
  internal_error: "The operation could not be completed. Check its result before trying again. Your pending edits have been kept."
};

/** 回执摘要与既有存储 fingerprint 共用业务投影，不改变既有审计格式。 */
export function workspaceMutationDigestInput(operation: "save" | "undo", expectedPlanId: string, body: Record<string, unknown>): string {
  const payload = {
    operation, expectedPlanId,
    expectedVersion: body.expectedVersion,
    expectedBlueprintVersion: body.expectedBlueprintVersion,
    ...(operation === "save" ? {
      revisions: Array.isArray(body.revisions) ? body.revisions.map((revision: Record<string, unknown>) => {
        const { createdAt: _createdAt, ...content } = revision;
        return content;
      }) : body.revisions,
      ...(body.recoveryBinding !== undefined ? {recoveryBinding:body.recoveryBinding} : {}),
      ...(body.highImpactConfirmation !== undefined ? { highImpactConfirmation: body.highImpactConfirmation } : {})
    } : { revisionId: body.revisionId })
  };
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
    return value;
  }
  return JSON.stringify(canonical(payload));
}
