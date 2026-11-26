import { assertBookingRelationshipSourceContext, bookingRelationshipAssessmentIssues, bookingRelationshipAssessmentStructureIssues, bookingRelationshipDigest, bookingRelationshipFixedProtection, bookingRelationshipImpact, bookingRelationshipSourceUnits, reconcileBookingRelationshipAssessment, stampReviewedBookingRelationshipAssessment, type BookingRelationshipAssessment, type BookingRelationshipImpact, type BookingRelationshipSourceContext } from "./booking-relationship.js";
import { WorkspaceMutationError } from "./workspace-mutation-error.js";
import { blueprintImpactProjection } from "./blueprint-impact-projection.js";
import {validateBookingSourceSelection,type BookingSourceLegacyBinding,type BookingSourceSelectionDecision,type BookingSourceSelectionAudit} from "./booking-source-selection.js";
import { assertTripBlueprintIntegrity, effectiveBlueprintSchedulingDecision, type BlueprintBookingConstraint, type BlueprintPreparationOrigin, type BlueprintItineraryBlock, type BlueprintItineraryDay, type BlueprintMovement, type BlueprintMovementMode, type BlueprintPlace, type BlueprintPlacePriority, type BlueprintStop, type TripBlueprint } from "./trip-blueprint.js";

const DIRECT_EDIT_ROUTE_REFRESH_REASON = "Refresh this route leg after direct itinerary edits.";

export type DirectBlueprintRevision =
  | { kind: "select_booking_sources"; sourceBookingIds:string[]; expectedSourceSetDigest:string; legacyBindings?:BookingSourceLegacyBinding[]; createdAt:string }
  | { kind: "review_booking_relationships"; assessment: BookingRelationshipAssessment; expectedSourceSetDigest?:string; sourceBookingIds?:string[]; createdAt: string }
  | { kind: "set_tip_state"; tipId: string; pinned?: boolean; hidden?: boolean; createdAt: string }
  | { kind: "create_preparation"; origin: BlueprintPreparationOrigin; createdAt: string }
  | { kind: "set_preparation_completed"; preparationId: string; completed: boolean; createdAt: string }
  | {
    kind: "add_place_to_day";
    placeId: string;
    dayId: string;
    position: { kind: "start" } | { kind: "end" } | { kind: "after"; afterPlaceId: string };
    createdAt: string;
  }
  | {
    kind: "move_place_within_day";
    placeId: string;
    dayId: string;
    position: { kind: "start" } | { kind: "end" } | { kind: "after"; afterPlaceId: string };
    createdAt: string;
  }
  | {
    kind: "remove_place_from_day";
    placeId: string;
    dayId: string;
    createdAt: string;
    highImpactConfirmation?: string;
  }
  | {
    kind: "update_place_priority";
    placeId: string;
    priority: BlueprintPlacePriority;
    createdAt: string;
  };

type DirectBlueprintPlaceRevision = Extract<DirectBlueprintRevision, { placeId: string }>;

type DirectBlueprintItineraryRevision = Extract<DirectBlueprintRevision, { kind: "add_place_to_day" | "move_place_within_day" }>;
type DirectBlueprintDayRevision = Extract<DirectBlueprintRevision, { kind: "add_place_to_day" | "move_place_within_day" | "remove_place_from_day" }>;

export type DirectBlueprintReplanReadinessStatus = "no_replan_needed" | "ready_for_route_refresh" | "assisted_replanning_required";

export interface DirectBlueprintRouteImpactDay {
  dayId: string;
  addedPlaceIds: string[];
  removedPlaceIds: string[];
  movedPlaceIds: string[];
  movementIds: string[];
  requiresRouteRefresh: boolean;
  requiresTimingReview: boolean;
  requiresMealRestSpacingReview: boolean;
  capacityRisk: boolean;
  backtrackingRisk: boolean;
  fixedTimeRisk: boolean;
  readiness: DirectBlueprintReplanReadinessStatus;
  reasons: string[];
}

export interface DirectBlueprintReplanReadiness {
  status: DirectBlueprintReplanReadinessStatus;
  dayIds: string[];
  reason: string;
}

export type DirectBlueprintReplanRequirementReasonCode =
  | "blocked_place"
  | "fixed_booking"
  | "high_impact_place"
  | "informational_place"
  | "scheduled_archive"
  | "unsuitable_day";

export interface DirectBlueprintReplanRequirement {
  status: "assisted_replanning_required";
  editKind: DirectBlueprintRevision["kind"];
  placeId: string;
  dayId?: string;
  reasonCode: DirectBlueprintReplanRequirementReasonCode;
  affectedDayIds: string[];
  affectedPlaceIds: string[];
  explanation: string;
  suggestedRequest: string;
}

export class DirectBlueprintReplanRequirementError extends Error {
  readonly code = "assisted_replanning_required";
  readonly replanRequirement: DirectBlueprintReplanRequirement;

  constructor(replanRequirement: DirectBlueprintReplanRequirement) {
    super(replanRequirement.explanation);
    this.name = "DirectBlueprintReplanRequirementError";
    this.replanRequirement = replanRequirement;
  }
}

export interface DirectBlueprintRevisionMetadata {
  sourceSelectionAudit?:BookingSourceSelectionAudit;
  id: string;
  kind: DirectBlueprintRevision["kind"];
  baseBlueprintVersion: number;
  appliedBlueprintVersion: number;
  createdAt: string;
  affectedDayIds: string[];
  affectedPlaceIds: string[];
  routeRefresh: {
    dayIds: string[];
    movementIds: string[];
    reason: string;
  };
  routeImpact?: {
    days: DirectBlueprintRouteImpactDay[];
  };
  replanReadiness?: DirectBlueprintReplanReadiness;
  undo: {
    dayId?: string;
    previousDay?: BlueprintItineraryDay;
    previousMovements: BlueprintMovement[];
    previousPlace?: BlueprintPlace;
  };
}

export interface DirectBlueprintRevisionResult {
  blueprint: TripBlueprint;
  metadata: DirectBlueprintRevisionMetadata;
}

export interface DirectBlueprintRevisionBatchMetadata {
  /** 从独立来源选择修订派生，不能独立编辑。 */
  sourceSelectionAudit?:BookingSourceSelectionAudit;
  id: string;
  baseBlueprintVersion: number;
  appliedBlueprintVersion: number;
  createdAt: string;
  revisionCount: number;
  kinds: DirectBlueprintRevision["kind"][];
  affectedDayIds: string[];
  affectedPlaceIds: string[];
  routeRefresh: {
    dayIds: string[];
    movementIds: string[];
    reason: string;
  };
  routeImpact?: {
    days: DirectBlueprintRouteImpactDay[];
  };
  replanReadiness?: DirectBlueprintReplanReadiness;
  undo: {
    previousBlueprintVersion: number;
    previousDays: BlueprintItineraryDay[];
    previousMovements: BlueprintMovement[];
    previousPlaces: BlueprintPlace[];
  };
  revisions: DirectBlueprintRevisionMetadata[];
}

export interface DirectBlueprintRevisionBatchResult {
  blueprint: TripBlueprint;
  metadata: DirectBlueprintRevisionBatchMetadata;
}

export interface DirectBlueprintAssistedReplanningHandoff {
  status: "ready_for_assisted_replanning";
  baseBlueprintId: string;
  baseBlueprintVersion: number;
  replanRequirement: DirectBlueprintReplanRequirement;
  revisions: DirectBlueprintRevision[];
  affectedDayIds: string[];
  affectedPlaceIds: string[];
  request: string;
}

export interface DirectBlueprintRevisionOptions {
  highImpactConfirmation?:string;
  resolvedBookingConstraints?:BlueprintBookingConstraint[];
  sourceSelectionDecision?:BookingSourceSelectionDecision;
  sourceContext?:BookingRelationshipSourceContext;
}
/** 无 sourceContext 时仅评价离线 Blueprint 快照。真实工作区必须提供可信 context。 */
export function applyDirectBlueprintRevision(blueprint: TripBlueprint, revision: DirectBlueprintRevision, options:DirectBlueprintRevisionOptions={}): TripBlueprint {
  return applyDirectBlueprintRevisionWithMetadata(blueprint, revision,options).blueprint;
}

export function applyDirectBlueprintRevisionWithMetadata(blueprint: TripBlueprint, revision: DirectBlueprintRevision, options:DirectBlueprintRevisionOptions={}): DirectBlueprintRevisionResult {
  if (revision.kind === "remove_place_from_day") {
    if (revision.highImpactConfirmation !== undefined && options.highImpactConfirmation !== undefined && revision.highImpactConfirmation !== options.highImpactConfirmation) throw new WorkspaceMutationError("删除确认不一致，请重新审阅影响并确认。");
    const confirmation = revision.highImpactConfirmation ?? options.highImpactConfirmation;
    if (confirmation !== undefined) revision = { ...revision, highImpactConfirmation: confirmation };
  }
  return applyRevisionWithRelationshipBaseline(blueprint,revision,blueprint,options.resolvedBookingConstraints,options.highImpactConfirmation,options.sourceSelectionDecision,options.sourceContext);
}

function applyRevisionWithRelationshipBaseline(blueprint:TripBlueprint,revision:DirectBlueprintRevision,relationshipBaseline:TripBlueprint,resolvedBookingConstraints?:BlueprintBookingConstraint[],confirmedRelationshipImpact?:string,sourceSelectionDecision?:BookingSourceSelectionDecision,sourceContext?:BookingRelationshipSourceContext):DirectBlueprintRevisionResult {
  if(sourceContext) assertBookingRelationshipSourceContext(relationshipBaseline,sourceContext);
  const structural=bookingRelationshipAssessmentStructureIssues(blueprint);if(structural.length) throw new WorkspaceMutationError(structural.join("；"));
  blueprint=reconcileBookingRelationshipAssessment(structuredClone(blueprint));
  assertTripBlueprintIntegrity(blueprint);
  if (revision.kind !== "review_booking_relationships" && "placeId" in revision && revision.kind !== "remove_place_from_day") {
    const preview=previewDirectBlueprintRevisionImpact(relationshipBaseline,[revision],sourceContext);
    const protectedPlace=relationshipBaseline.places.find(place=>place.id===revision.placeId);
    if(preview&&protectedPlace?.priority!=="booked"&&!hasReservationRequirement(relationshipBaseline,revision.placeId)&&!bookingRelationshipFixedProtection(relationshipBaseline,revision,sourceContext)&&(!preview.bookingImpact.canConfirm||confirmedRelationshipImpact!==preview.id)) throw new DirectBlueprintHighImpactError(preview);
  }
  if (!Number.isFinite(Date.parse(revision.createdAt))) throw new WorkspaceMutationError("Blueprint Revision needs a valid creation time.");
  if (revision.kind === "add_place_to_day") return addPlaceToDay(blueprint, revision,relationshipBaseline,sourceContext);
  if (revision.kind === "move_place_within_day") return movePlaceWithinDay(blueprint, revision,relationshipBaseline,sourceContext);
  if (revision.kind === "remove_place_from_day") return removePlaceFromDay(blueprint, revision,relationshipBaseline,sourceContext);
  if (revision.kind === "update_place_priority") return updatePlacePriority(blueprint, revision,relationshipBaseline,sourceContext);
  return updateSupportingContent(blueprint, revision,resolvedBookingConstraints,sourceSelectionDecision,sourceContext);
}

export function applyDirectBlueprintRevisionBatchWithMetadata(blueprint: TripBlueprint, revisions: DirectBlueprintRevision[], options: DirectBlueprintRevisionOptions = {}): DirectBlueprintRevisionBatchResult {
  if(options.sourceContext) assertBookingRelationshipSourceContext(blueprint,options.sourceContext);
  const structural=bookingRelationshipAssessmentStructureIssues(blueprint);if(structural.length) throw new WorkspaceMutationError(structural.join("；"));
  blueprint=reconcileBookingRelationshipAssessment(structuredClone(blueprint));
  assertTripBlueprintIntegrity(blueprint);
  if (revisions.some(revision=>revision.kind === "review_booking_relationships"||revision.kind === "select_booking_sources") && revisions.length !== 1) throw new WorkspaceMutationError("请单独保存预订来源或关联审阅，再重新审阅待确认编辑。");
  if (!revisions.length) throw new WorkspaceMutationError("A Direct Blueprint Revision batch needs at least one edit.");
  for(const revision of revisions) if("placeId" in revision) {
    const place=blueprint.places.find(place=>place.id===revision.placeId);
    if(place&&(place.priority==="booked"||hasReservationRequirement(blueprint,place.id)||bookingRelationshipFixedProtection(blueprint,revision,options.sourceContext))&&!(revision.kind==="update_place_priority"&&revision.priority===place.priority)) throw directReplanRequirementError(blueprint,revision,"fixed_booking","此处涉及已预订或固定承诺，请先审阅预订关联或使用辅助重规划。");
  }
  const impact = previewDirectBlueprintRevisionImpact(blueprint, revisions,options.sourceContext);
  if (impact && (!impact.bookingImpact.canConfirm || options.highImpactConfirmation !== impact.id)) throw new DirectBlueprintHighImpactError(impact);
  const original = structuredClone(blueprint);
  let current = structuredClone(blueprint) as TripBlueprint;
  const revisionMetadataItems: DirectBlueprintRevisionMetadata[] = [];

  for (const revision of revisions) {
    current.version = original.version;
    const singleImpact = previewDirectBlueprintRevisionImpact(original, [revision],options.sourceContext);
    const confirmedRevision = revision.kind === "remove_place_from_day" && impact && singleImpact ? { ...revision, highImpactConfirmation: singleImpact.id } : revision;
    const result = applyRevisionWithRelationshipBaseline(current, confirmedRevision,original,options.resolvedBookingConstraints,impact?singleImpact?.id:undefined,options.sourceSelectionDecision,options.sourceContext);
    current = result.blueprint;
    revisionMetadataItems.push(result.metadata);
  }

  current.version = blueprint.version + 1;
  for (const item of revisionMetadataItems) { item.baseBlueprintVersion = blueprint.version; item.appliedBlueprintVersion = current.version; }
  const affectedDayIds = uniqueStrings(revisionMetadataItems.flatMap((item) => item.affectedDayIds));
  const previousDays = affectedDayIds.flatMap((dayId) => {
    const day = original.days.find((candidate) => candidate.id === dayId);
    return day ? [structuredClone(day)] : [];
  });
  const previousMovements = structuredClone(original.movements.filter((movement) => affectedDayIds.includes(movement.dayId)));
  const previousPlaceIds = uniqueStrings(revisionMetadataItems.flatMap((item) => item.undo.previousPlace ? [item.undo.previousPlace.id] : []));
  const previousPlaces = previousPlaceIds.flatMap((placeId) => {
    const place = original.places.find((candidate) => candidate.id === placeId);
    return place ? [structuredClone(place)] : [];
  });
  const routeRefreshDayIds = uniqueStrings(revisionMetadataItems.flatMap((item) => item.routeRefresh.dayIds));
  const routeRefreshMovementIds = uniqueStrings(revisionMetadataItems.flatMap((item) => item.routeRefresh.movementIds));
  const routeImpactDays = mergeRouteImpactDays(revisionMetadataItems.flatMap((item) => item.routeImpact?.days ?? []));
  const hasItineraryEdit = revisionMetadataItems.some((item) => item.kind === "add_place_to_day" || item.kind === "move_place_within_day" || item.kind === "remove_place_from_day");
  const routeRefreshReason = hasItineraryEdit
    ? "These itinerary days were edited directly, so affected route, timing, meal, and opening constraints need refresh before execution."
    : "These place status updates do not change route order.";
  const createdAt = revisions[revisions.length - 1]!.createdAt;

  return {
    blueprint: current,
    metadata: {
      ...(revisionMetadataItems[0]?.sourceSelectionAudit?{sourceSelectionAudit:structuredClone(revisionMetadataItems[0].sourceSelectionAudit)}:{}),
      id: `direct-revision-batch-${blueprint.id}-v${blueprint.version}-to-v${current.version}`,
      baseBlueprintVersion: blueprint.version,
      appliedBlueprintVersion: current.version,
      createdAt,
      revisionCount: revisions.length,
      kinds: uniqueRevisionKinds(revisionMetadataItems.map((item) => item.kind)),
      affectedDayIds,
      affectedPlaceIds: uniqueStrings(revisionMetadataItems.flatMap((item) => item.affectedPlaceIds)),
      routeRefresh: {
        dayIds: routeRefreshDayIds,
        movementIds: routeRefreshMovementIds,
        reason: routeRefreshReason
      },
      routeImpact: {
        days: routeImpactDays
      },
      replanReadiness: replanReadinessForImpacts(routeImpactDays),
      undo: {
        previousBlueprintVersion: original.version,
        previousDays,
        previousMovements,
        previousPlaces
      },
      revisions: revisionMetadataItems
    }
  };
}

export function prepareDirectBlueprintAssistedReplanningHandoff(
  blueprint: TripBlueprint,
  input: { replanRequirement: DirectBlueprintReplanRequirement; revisions: DirectBlueprintRevision[] }
): DirectBlueprintAssistedReplanningHandoff {
  assertTripBlueprintIntegrity(blueprint);
  assertDirectBlueprintReplanRequirement(input.replanRequirement);
  if (!input.revisions.length) throw new WorkspaceMutationError("Assisted replanning needs at least one pending itinerary edit.");
  for (const revision of input.revisions) {
    if (!("placeId" in revision)) continue;
    if (!Number.isFinite(Date.parse(revision.createdAt))) throw new WorkspaceMutationError("Assisted replanning needs valid edit creation times.");
    if (!blueprint.places.some((place) => place.id === revision.placeId)) throw new WorkspaceMutationError(`Assisted replanning references unknown place ${revision.placeId}.`);
    if ("dayId" in revision && !blueprint.days.some((day) => day.id === revision.dayId)) throw new WorkspaceMutationError(`Assisted replanning references unknown day ${revision.dayId}.`);
  }
  const requirement = input.replanRequirement;
  const requirementPlace = blueprint.places.find((place) => place.id === requirement.placeId);
  if (!requirementPlace) throw new WorkspaceMutationError(`Assisted replanning requirement references unknown place ${requirement.placeId}.`);
  if (requirement.dayId && !blueprint.days.some((day) => day.id === requirement.dayId)) throw new WorkspaceMutationError(`Assisted replanning requirement references unknown day ${requirement.dayId}.`);
  const blueprintDayIds = new Set(blueprint.days.map((day) => day.id));
  const blueprintPlaceIds = new Set(blueprint.places.map((place) => place.id));
  const unknownAffectedDay = requirement.affectedDayIds.find((dayId) => !blueprintDayIds.has(dayId));
  if (unknownAffectedDay) throw new WorkspaceMutationError(`Assisted replanning requirement references unknown affected day ${unknownAffectedDay}.`);
  const unknownAffectedPlace = requirement.affectedPlaceIds.find((placeId) => !blueprintPlaceIds.has(placeId));
  if (unknownAffectedPlace) throw new WorkspaceMutationError(`Assisted replanning requirement references unknown affected place ${unknownAffectedPlace}.`);
  if (requirement.dayId && !requirement.affectedDayIds.includes(requirement.dayId)) throw new WorkspaceMutationError("Assisted replanning requirement must include its target day in affectedDayIds.");
  if (!requirement.affectedPlaceIds.includes(requirement.placeId)) throw new WorkspaceMutationError("Assisted replanning requirement must include its target place in affectedPlaceIds.");
  if (!input.revisions.some((revision) => revisionMatchesRequirement(revision, requirement))) throw new WorkspaceMutationError("Assisted replanning needs a pending edit that matches the replanning requirement.");
  const affectedDayIds = uniqueStrings([
    ...requirement.affectedDayIds,
    ...input.revisions.flatMap((revision) => "dayId" in revision ? [revision.dayId] : [])
  ]);
  const affectedPlaceIds = uniqueStrings([
    ...requirement.affectedPlaceIds,
    ...input.revisions.flatMap((revision) => "placeId" in revision ? [revision.placeId] : []),
    ...affectedDayIds.flatMap((dayId) => blueprint.days.find((day) => day.id === dayId)?.stops.map((stop) => stop.placeId) ?? [])
  ]);
  return {
    status: "ready_for_assisted_replanning",
    baseBlueprintId: blueprint.id,
    baseBlueprintVersion: blueprint.version,
    replanRequirement: structuredClone(requirement),
    revisions: structuredClone(input.revisions),
    affectedDayIds,
    affectedPlaceIds,
    request: assistedReplanningHandoffRequest(blueprint, requirement, input.revisions, affectedDayIds, affectedPlaceIds)
  };
}

function addPlaceToDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "add_place_to_day" }>,relationshipBaseline=blueprint,sourceContext?:BookingRelationshipSourceContext): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new WorkspaceMutationError(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new WorkspaceMutationError(`Blueprint Revision references unknown day ${revision.dayId}.`);
  if (day.stops.some((stop) => stop.placeId === revision.placeId)) throw new WorkspaceMutationError(`Place ${revision.placeId} is already scheduled on day ${revision.dayId}.`, "already_scheduled");
  if (place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId) || bookingRelationshipFixedProtection(relationshipBaseline, revision,sourceContext)) throw directReplanRequirementError(blueprint, revision, "fixed_booking", `${place.name} is tied to a fixed booking, so Landi needs to place it with the right timing.`);
  const decision = effectiveBlueprintSchedulingDecision(place);
  const eligibility = place.schedulingEligibility;
  if (decision === "informational") throw directReplanRequirementError(blueprint, revision, "informational_place", `${place.name} is background information, so Landi needs to replan before placing it into ${dayLabel(day, revision.dayId)}.`);
  if (decision === "blocked") throw directReplanRequirementError(blueprint, revision, "blocked_place", `${place.name} is blocked for direct scheduling, so Landi needs to replan before it can be added to ${dayLabel(day, revision.dayId)}.`);
  if (decision === "high_impact") throw directReplanRequirementError(blueprint, revision, "high_impact_place", `${place.name} changes the shape of ${dayLabel(day, revision.dayId)}, so Landi needs to replan that day before saving it.`);
  if (eligibility?.suitableDayIds?.length && !eligibility.suitableDayIds.includes(revision.dayId)) throw directReplanRequirementError(blueprint, revision, "unsuitable_day", `${place.name} is not eligible for ${dayLabel(day, revision.dayId)}, so Landi needs to replan before saving this placement.`);

  const previousDay = structuredClone(day);
  const previousMovements = movementsForDay(blueprint, day.id);
  const nextStops = insertStop(day.stops, revision);
  const nextBlocks = blocksForDirectRevision(day.id, day.blocks, day.stops, nextStops, revision);
  const nextDays = blueprint.days.map((candidate) => candidate.id === day.id
    ? {
      ...candidate,
      stops: nextStops,
      blocks: nextBlocks,
      candidatePlaceIds: candidate.candidatePlaceIds.filter((id) => id !== revision.placeId)
    }
    : candidate);
  const nextMovements = [
    ...blueprint.movements.filter((movement) => movement.dayId !== day.id),
    ...movementsForStops(day.id, nextStops, blueprint.places)
  ];
  const next: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    days: nextDays,
    movements: nextMovements,
    createdAt: revision.createdAt
  };
  reconcileBookingRelationshipAssessment(next);
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return {
    blueprint: next,
    metadata: revisionMetadata(blueprint, next, revision, previousDay, previousMovements)
  };
}

function movePlaceWithinDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "move_place_within_day" }>,relationshipBaseline=blueprint,sourceContext?:BookingRelationshipSourceContext): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new WorkspaceMutationError(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new WorkspaceMutationError(`Blueprint Revision references unknown day ${revision.dayId}.`);
  const stop = day.stops.find((candidate) => candidate.placeId === revision.placeId);
  if (!stop) throw new WorkspaceMutationError(`Place ${revision.placeId} is not scheduled on day ${revision.dayId}.`);
  if (place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId) || bookingRelationshipFixedProtection(relationshipBaseline, revision,sourceContext)) throw directReplanRequirementError(blueprint, revision, "fixed_booking", `${place.name} is tied to a booking or reservation, so Landi needs to replan before moving it.`);
  const decision = effectiveBlueprintSchedulingDecision(place);
  if (decision === "informational") throw directReplanRequirementError(blueprint, revision, "informational_place", `${place.name} is background information, so Landi needs to replan before moving it inside ${dayLabel(day, revision.dayId)}.`);
  if (decision === "blocked") throw directReplanRequirementError(blueprint, revision, "blocked_place", `${place.name} is blocked for direct scheduling, so Landi needs to replan before moving it.`);
  if (decision === "high_impact") throw directReplanRequirementError(blueprint, revision, "high_impact_place", `${place.name} changes the shape of ${dayLabel(day, revision.dayId)}, so Landi needs to replan that day before moving it.`);
  if (revision.position.kind === "after" && revision.position.afterPlaceId === revision.placeId) throw new WorkspaceMutationError("Blueprint Revision cannot move a place after itself.");

  const previousDay = structuredClone(day);
  const previousMovements = movementsForDay(blueprint, day.id);
  const nextStops = moveStop(day.stops, revision);
  const nextBlocks = blocksForDirectRevision(day.id, day.blocks, day.stops, nextStops, revision);
  const nextDays = blueprint.days.map((candidate) => candidate.id === day.id
    ? {
      ...candidate,
      stops: nextStops,
      blocks: nextBlocks
    }
    : candidate);
  const nextMovements = [
    ...blueprint.movements.filter((movement) => movement.dayId !== day.id),
    ...movementsForStops(day.id, nextStops, blueprint.places)
  ];
  const next: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    days: nextDays,
    movements: nextMovements,
    createdAt: revision.createdAt
  };
  reconcileBookingRelationshipAssessment(next);
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return {
    blueprint: next,
    metadata: revisionMetadata(blueprint, next, revision, previousDay, previousMovements)
  };
}

function removePlaceFromDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "remove_place_from_day" }>,relationshipBaseline=blueprint,sourceContext?:BookingRelationshipSourceContext): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new WorkspaceMutationError(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new WorkspaceMutationError(`Blueprint Revision references unknown day ${revision.dayId}.`);
  if (!day.stops.some((stop) => stop.placeId === revision.placeId)) throw new WorkspaceMutationError(`Place ${revision.placeId} is not scheduled on day ${revision.dayId}.`);
  if (place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId) || bookingRelationshipFixedProtection(relationshipBaseline, revision,sourceContext)) throw directReplanRequirementError(blueprint, revision, "fixed_booking", `${place.name} is tied to a booking or reservation, so Landi needs to replan before removing it.`);
  const decision = effectiveBlueprintSchedulingDecision(place);
  if (decision === "informational") throw directReplanRequirementError(blueprint, revision, "informational_place", `${place.name} is background information, so Landi needs to replan before removing it from ${dayLabel(day, revision.dayId)}.`);
  if (decision === "blocked") throw directReplanRequirementError(blueprint, revision, "blocked_place", `${place.name} is blocked for direct scheduling, so Landi needs to replan before removing it.`);
  if (decision === "high_impact") throw directReplanRequirementError(blueprint, revision, "high_impact_place", `${place.name} changes the shape of ${dayLabel(day, revision.dayId)}, so Landi needs to replan that day before removing it.`);

  const impact = previewDirectBlueprintRevisionImpact(relationshipBaseline, [revision],sourceContext);
  if (impact && (!impact.bookingImpact.canConfirm || revision.highImpactConfirmation !== impact.id)) throw new DirectBlueprintHighImpactError(impact);
  const previousDay = structuredClone(day);
  const previousMovements = movementsForDay(blueprint, day.id);
  const nextStops = removeStop(day.stops, revision);
  const nextBlocks = blocksForRemovedStop(day.id, day.blocks, day.stops, nextStops, revision.placeId);
  const nextDays = blueprint.days.map((candidate) => candidate.id === day.id
    ? {
      ...candidate,
      kind: nextStops.length === 0 && candidate.kind === "scheduled" ? "free_time" as const : candidate.kind,
      stops: nextStops,
      blocks: nextBlocks,
      candidatePlaceIds: uniqueStrings([...candidate.candidatePlaceIds, revision.placeId])
    }
    : candidate);
  const nextMovements = [
    ...blueprint.movements.filter((movement) => movement.dayId !== day.id),
    ...movementsForStops(day.id, nextStops, blueprint.places)
  ];
  const next: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    days: nextDays,
    ...(blueprint.travelTips ? {travelTips: blueprint.travelTips.map(tip => {
      if (!tip.blockId || !day.blocks?.some(block => block.id === tip.blockId) || nextBlocks.some(block => block.id === tip.blockId)) return structuredClone(tip);
      const {blockId, ...retained} = tip; return retained;
    })} : {}),
    movements: nextMovements,
    createdAt: revision.createdAt
  };
  reconcileBookingRelationshipAssessment(next);
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return {
    blueprint: next,
    metadata: revisionMetadata(blueprint, next, revision, previousDay, previousMovements)
  };
}

function updatePlacePriority(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "update_place_priority" }>,relationshipBaseline=blueprint,sourceContext?:BookingRelationshipSourceContext): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new WorkspaceMutationError(`Blueprint Revision references unknown place ${revision.placeId}.`);
  if ((place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId) || bookingRelationshipFixedProtection(relationshipBaseline,revision,sourceContext)) && revision.priority !== place.priority) throw directReplanRequirementError(blueprint, revision, "fixed_booking", "该地点属于已预订行程，请通过辅助重规划修改预订约束。");
  if (place.priority === revision.priority) throw new WorkspaceMutationError(`Place ${revision.placeId} already has priority ${revision.priority}.`, "unchanged_edit");
  const scheduledDay = blueprint.days.find((day) => day.stops.some((stop) => stop.placeId === revision.placeId) || day.blocks?.some((block) => block.placeId === revision.placeId));
  if (scheduledDay && revision.priority === "archive") throw directReplanRequirementError(blueprint, revision, "scheduled_archive", `${place.name} is already scheduled on ${dayLabel(scheduledDay, scheduledDay.id)}, so Landi needs to replan before keeping it for later.`);

  const previousDay = scheduledDay ? structuredClone(scheduledDay) : undefined;
  const previousMovements = scheduledDay ? movementsForDay(blueprint, scheduledDay.id) : [];
  const next: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    places: blueprint.places.map((candidate) => candidate.id === revision.placeId ? { ...candidate, priority: revision.priority } : structuredClone(candidate)),
    createdAt: revision.createdAt
  };
  reconcileBookingRelationshipAssessment(next);
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return {
    blueprint: next,
    metadata: placePriorityRevisionMetadata(blueprint, next, revision, place, previousDay, previousMovements)
  };
}

function insertStop(stops: BlueprintStop[], revision: Extract<DirectBlueprintRevision, { kind: "add_place_to_day" }>): BlueprintStop[] {
  const ordered = [...stops].sort((left, right) => left.order - right.order).map((stop) => ({ ...stop }));
  const { position } = revision;
  let insertionIndex = 0;
  if (position.kind === "end") insertionIndex = ordered.length;
  if (position.kind === "after") {
    const afterIndex = ordered.findIndex((stop) => stop.placeId === position.afterPlaceId);
    if (afterIndex === -1) throw new WorkspaceMutationError(`Blueprint Revision cannot insert after unknown place ${position.afterPlaceId}.`);
    insertionIndex = afterIndex + 1;
  }
  ordered.splice(insertionIndex, 0, { placeId: revision.placeId, order: insertionIndex + 1, role: "direct_addition" });
  return ordered.map((stop, index) => ({ ...stop, order: index + 1 }));
}

function moveStop(stops: BlueprintStop[], revision: Extract<DirectBlueprintRevision, { kind: "move_place_within_day" }>): BlueprintStop[] {
  const ordered = [...stops].sort((left, right) => left.order - right.order).map((stop) => ({ ...stop }));
  const slots = ordered.map((stop) => ({ time: stop.time, role: stop.role }));
  const movingIndex = ordered.findIndex((stop) => stop.placeId === revision.placeId);
  if (movingIndex === -1) throw new WorkspaceMutationError(`Place ${revision.placeId} is not scheduled on day ${revision.dayId}.`);
  const [moving] = ordered.splice(movingIndex, 1);
  const { position } = revision;
  let insertionIndex = 0;
  if (position.kind === "end") insertionIndex = ordered.length;
  if (position.kind === "after") {
    const afterIndex = ordered.findIndex((stop) => stop.placeId === position.afterPlaceId);
    if (afterIndex === -1) throw new WorkspaceMutationError(`Blueprint Revision cannot insert after unknown place ${position.afterPlaceId}.`);
    insertionIndex = afterIndex + 1;
  }
  ordered.splice(insertionIndex, 0, moving!);
  return ordered.map((stop, index) => {
    const { time: _time, role: _role, ...base } = stop;
    const slot = slots[index];
    return {
      ...base,
      order: index + 1,
      ...(slot?.time ? { time: slot.time } : {}),
      ...(slot?.role ? { role: slot.role } : {})
    };
  });
}

function removeStop(stops: BlueprintStop[], revision: Extract<DirectBlueprintRevision, { kind: "remove_place_from_day" }>): BlueprintStop[] {
  const next = [...stops].sort((left, right) => left.order - right.order).filter((stop) => stop.placeId !== revision.placeId);
  return next.map((stop, index) => ({ ...stop, order: index + 1 }));
}

function hasReservationRequirement(blueprint: TripBlueprint, placeId: string): boolean {
  return blueprint.actionRequirements.some((requirement) => requirement.placeId === placeId && requirement.kind === "reservation");
}

function directReplanRequirementError(
  blueprint: TripBlueprint,
  revision: DirectBlueprintPlaceRevision,
  reasonCode: DirectBlueprintReplanRequirementReasonCode,
  explanation: string
): DirectBlueprintReplanRequirementError {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  const day = "dayId" in revision
    ? blueprint.days.find((candidate) => candidate.id === revision.dayId)
    : blueprint.days.find((candidate) => candidate.stops.some((stop) => stop.placeId === revision.placeId));
  const dayId = "dayId" in revision ? revision.dayId : day?.id;
  const affectedDayIds = dayId ? [dayId] : [];
  const affectedPlaceIds = uniqueStrings([
    revision.placeId,
    ...(day?.stops.map((stop) => stop.placeId) ?? [])
  ]);
  return new DirectBlueprintReplanRequirementError({
    status: "assisted_replanning_required",
    editKind: revision.kind,
    placeId: revision.placeId,
    ...(dayId ? { dayId } : {}),
    reasonCode,
    affectedDayIds,
    affectedPlaceIds,
    explanation,
    suggestedRequest: assistedReplanningRequest({
      editKind: revision.kind,
      placeName: place?.name ?? revision.placeId,
      ...(day ? { dayName: dayLabel(day, day.id) } : {}),
      reasonCode
    })
  });
}

function assistedReplanningRequest(input: { editKind: DirectBlueprintRevision["kind"]; placeName: string; dayName?: string; reasonCode: DirectBlueprintReplanRequirementReasonCode }): string {
  const action = input.editKind === "add_place_to_day"
    ? "add"
    : input.editKind === "move_place_within_day"
      ? "move"
      : input.editKind === "remove_place_from_day"
        ? "remove"
        : "update";
  const target = input.dayName ? `${input.placeName} on ${input.dayName}` : input.placeName;
  const fixedGuard = input.reasonCode === "fixed_booking" || input.reasonCode === "scheduled_archive"
    ? " Preserve fixed bookings and reservations."
    : "";
  return `Replan the affected itinerary day so it can ${action} ${target}. Keep unaffected days and places unchanged.${fixedGuard} Recheck route order, timing, meal and rest spacing, opening constraints, and publish a new Trip Blueprint version only when the affected day is coherent.`;
}

function assistedReplanningHandoffRequest(
  blueprint: TripBlueprint,
  requirement: DirectBlueprintReplanRequirement,
  revisions: DirectBlueprintRevision[],
  affectedDayIds: string[],
  affectedPlaceIds: string[]
): string {
  const dayById = new Map(blueprint.days.map((day) => [day.id, day] as const));
  const placeById = new Map(blueprint.places.map((place) => [place.id, place] as const));
  const affectedDays = affectedDayIds.map((dayId) => {
    const day = dayById.get(dayId);
    return day ? dayLabel(day, dayId) : dayId;
  }).join(", ");
  const affectedPlaces = affectedPlaceIds.map((placeId) => placeById.get(placeId)?.name ?? placeId).join(", ");
  const editLines = revisions.map((revision, index) => `${index + 1}. ${revisionRequestLine(revision, dayById, placeById)}`);
  const fixedPlaces = affectedPlaceIds.flatMap((placeId) => {
    const place = placeById.get(placeId);
    if (!place) return [];
    return place.priority === "booked" || hasReservationRequirement(blueprint, placeId) ? [place.name] : [];
  });
  return [
    `Replan the affected itinerary day for ${blueprint.title}.`,
    `Base Trip Blueprint: ${blueprint.id} v${blueprint.version}.`,
    `Why this needs Landi: ${requirement.explanation}`,
    `Confirmed traveler edits:`,
    ...editLines,
    `Affected day${affectedDayIds.length === 1 ? "" : "s"}: ${affectedDays}.`,
    `Affected places: ${affectedPlaces}.`,
    `Keep every unlisted day and unaffected place unchanged.`,
    ...(fixedPlaces.length ? [`Preserve fixed bookings and reservations: ${uniqueStrings(fixedPlaces).join(", ")}.`] : []),
    `Recheck route order, timing, meal and rest spacing, opening constraints, and the route impact before publishing a new Trip Blueprint version.`
  ].join("\n");
}

function revisionRequestLine(
  revision: DirectBlueprintRevision,
  dayById: Map<string, BlueprintItineraryDay>,
  placeById: Map<string, BlueprintPlace>
): string {
  if (!("placeId" in revision)) return "Update travel tips or preparation items.";
  const placeName = placeById.get(revision.placeId)?.name ?? revision.placeId;
  if (revision.kind === "update_place_priority") return `Set ${placeName} to ${revision.priority}.`;
  if (!("dayId" in revision)) return "Update travel tips or preparation items.";
  const day = dayById.get(revision.dayId);
  const dayName = day ? dayLabel(day, revision.dayId) : revision.dayId;
  if (revision.kind === "remove_place_from_day") return `Remove ${placeName} from ${dayName}.`;
  const placement = revision.position.kind === "start"
    ? "at the start of the day"
    : revision.position.kind === "end"
      ? "at the end of the day"
      : `after ${placeById.get(revision.position.afterPlaceId)?.name ?? revision.position.afterPlaceId}`;
  return `${revision.kind === "add_place_to_day" ? "Add" : "Move"} ${placeName} ${placement} on ${dayName}.`;
}

function revisionMatchesRequirement(revision: DirectBlueprintRevision, requirement: DirectBlueprintReplanRequirement): boolean {
  if (!("placeId" in revision) || revision.kind !== requirement.editKind || revision.placeId !== requirement.placeId) return false;
  if (!("dayId" in revision) || !requirement.dayId) return !("dayId" in revision) && !requirement.dayId;
  return revision.dayId === requirement.dayId;
}

function assertDirectBlueprintReplanRequirement(value: DirectBlueprintReplanRequirement): void {
  if (!value || typeof value !== "object") throw new WorkspaceMutationError("Assisted replanning needs a structured requirement.");
  if (value.status !== "assisted_replanning_required") throw new WorkspaceMutationError("Assisted replanning needs an assisted requirement.");
  if (!isDirectRevisionKind(value.editKind)) throw new WorkspaceMutationError("Assisted replanning requirement needs a supported edit kind.");
  if (typeof value.placeId !== "string" || !value.placeId.trim()) throw new WorkspaceMutationError("Assisted replanning requirement needs a place.");
  if (value.dayId !== undefined && (typeof value.dayId !== "string" || !value.dayId.trim())) throw new WorkspaceMutationError("Assisted replanning requirement needs a valid day.");
  if (!isDirectReplanRequirementReasonCode(value.reasonCode)) throw new WorkspaceMutationError("Assisted replanning requirement needs a supported reason.");
  if (!Array.isArray(value.affectedDayIds) || !Array.isArray(value.affectedPlaceIds)) throw new WorkspaceMutationError("Assisted replanning requirement needs affected days and places.");
  if (!value.affectedPlaceIds.length) throw new WorkspaceMutationError("Assisted replanning requirement needs at least one affected place.");
  if (value.affectedDayIds.some((dayId) => typeof dayId !== "string" || !dayId.trim())) throw new WorkspaceMutationError("Assisted replanning requirement has an invalid affected day.");
  if (value.affectedPlaceIds.some((placeId) => typeof placeId !== "string" || !placeId.trim())) throw new WorkspaceMutationError("Assisted replanning requirement has an invalid affected place.");
  if (typeof value.explanation !== "string" || !value.explanation.trim()) throw new WorkspaceMutationError("Assisted replanning requirement needs an explanation.");
  if (typeof value.suggestedRequest !== "string" || !value.suggestedRequest.trim()) throw new WorkspaceMutationError("Assisted replanning requirement needs a suggested request.");
}

function isDirectRevisionKind(value: unknown): value is DirectBlueprintRevision["kind"] {
  return value === "add_place_to_day" || value === "move_place_within_day" || value === "remove_place_from_day" || value === "update_place_priority";
}

function isDirectReplanRequirementReasonCode(value: unknown): value is DirectBlueprintReplanRequirementReasonCode {
  return value === "blocked_place"
    || value === "fixed_booking"
    || value === "high_impact_place"
    || value === "informational_place"
    || value === "scheduled_archive"
    || value === "unsuitable_day";
}

function dayLabel(day: BlueprintItineraryDay, fallbackId: string): string {
  return day.date || day.title || fallbackId;
}

function blocksForStops(dayId: string, stops: BlueprintStop[]): BlueprintItineraryBlock[] {
  return stops.map((stop, index) => ({
    id: `block-${dayId}-${index + 1}`,
    kind: "stop",
    order: index + 1,
    placeId: stop.placeId,
    ...(stop.time ? { startTime: stop.time } : {}),
    ...(stop.role ? { role: stop.role } : {}),
    evidence: []
  }));
}

function blocksForDirectRevision(
  dayId: string,
  previousBlocks: BlueprintItineraryBlock[] | undefined,
  previousStops: BlueprintStop[],
  nextStops: BlueprintStop[],
  revision: DirectBlueprintItineraryRevision
): BlueprintItineraryBlock[] {
  if (!previousBlocks?.length) return blocksForStops(dayId, nextStops);

  const previousStopIds = new Set(previousStops.map((stop) => stop.placeId));
  const nextStopIds = new Set(nextStops.map((stop) => stop.placeId));
  const sortedBlocks = [...previousBlocks].sort((left, right) => left.order - right.order).map((block) => ({ ...block, evidence: [...block.evidence] }));
  const routeSourceByPlaceId = new Map<string, BlueprintItineraryBlock>();
  for (const block of sortedBlocks) {
    if (!isRouteBlockForStops(block, previousStopIds) || routeSourceByPlaceId.has(block.placeId!)) continue;
    routeSourceByPlaceId.set(block.placeId!, block);
  }

  let template = sortedBlocks.filter((block) => !shouldDropNewlyScheduledNonRouteBlock(block, previousStopIds, nextStopIds, revision.placeId));
  if (nextStops.length > previousStops.length) {
    template = insertRouteSlotTemplate(dayId, template, previousStopIds, revision);
  }

  const usedIds = new Set<string>();
  const result: BlueprintItineraryBlock[] = [];
  let routeSlotIndex = 0;
  for (const block of template) {
    if (isDirectRouteSlotTemplate(block, previousStopIds)) {
      const stop = nextStops[routeSlotIndex];
      routeSlotIndex += 1;
      if (!stop) continue;
      const sourceBlock = routeSourceByPlaceId.get(stop.placeId);
      result.push(blockForStopInSlot(dayId, stop, sourceBlock, block, usedIds));
      continue;
    }
    const cloned = { ...block, evidence: [...block.evidence] };
    cloned.id = uniqueBlockId(cloned.id, usedIds);
    result.push(cloned);
  }

  while (routeSlotIndex < nextStops.length) {
    const stop = nextStops[routeSlotIndex]!;
    routeSlotIndex += 1;
    result.push(blockForStopInSlot(dayId, stop, routeSourceByPlaceId.get(stop.placeId), undefined, usedIds));
  }

  return result.map((block, index) => ({ ...block, order: index + 1 }));
}

function blocksForRemovedStop(
  dayId: string,
  previousBlocks: BlueprintItineraryBlock[] | undefined,
  previousStops: BlueprintStop[],
  nextStops: BlueprintStop[],
  removedPlaceId: string
): BlueprintItineraryBlock[] {
  if (!previousBlocks?.length) return blocksForStops(dayId, nextStops);

  const previousStopIds = new Set(previousStops.map((stop) => stop.placeId));
  const nextStopIds = new Set(nextStops.map((stop) => stop.placeId));
  const sortedBlocks = [...previousBlocks].sort((left, right) => left.order - right.order).map((block) => ({ ...block, evidence: [...block.evidence] }));
  const routeSourceByPlaceId = new Map<string, BlueprintItineraryBlock>();
  for (const block of sortedBlocks) {
    if (!isRouteBlockForStops(block, previousStopIds) || routeSourceByPlaceId.has(block.placeId!)) continue;
    routeSourceByPlaceId.set(block.placeId!, block);
  }

  const template = sortedBlocks.filter((block) => !shouldDropRemovedPlaceBlock(block, previousStopIds, nextStopIds, removedPlaceId));
  const usedIds = new Set<string>();
  const result: BlueprintItineraryBlock[] = [];
  let routeSlotIndex = 0;
  for (const block of template) {
    if (isDirectRouteSlotTemplate(block, previousStopIds)) {
      const stop = nextStops[routeSlotIndex];
      routeSlotIndex += 1;
      if (!stop) continue;
      result.push(blockForStopInSlot(dayId, stop, routeSourceByPlaceId.get(stop.placeId), undefined, usedIds));
      continue;
    }
    const cloned = { ...block, evidence: [...block.evidence] };
    cloned.id = uniqueBlockId(cloned.id, usedIds);
    result.push(cloned);
  }

  while (routeSlotIndex < nextStops.length) {
    const stop = nextStops[routeSlotIndex]!;
    routeSlotIndex += 1;
    result.push(blockForStopInSlot(dayId, stop, routeSourceByPlaceId.get(stop.placeId), undefined, usedIds));
  }

  return result.map((block, index) => ({ ...block, order: index + 1 }));
}

function isRouteBlockForStops(block: BlueprintItineraryBlock, stopIds: Set<string>): boolean {
  return Boolean(block.placeId && stopIds.has(block.placeId) && block.kind !== "event");
}

function shouldDropNewlyScheduledNonRouteBlock(block: BlueprintItineraryBlock, previousStopIds: Set<string>, nextStopIds: Set<string>, revisedPlaceId: string): boolean {
  return Boolean(block.placeId && block.placeId === revisedPlaceId && !previousStopIds.has(block.placeId) && nextStopIds.has(block.placeId));
}

function shouldDropRemovedPlaceBlock(block: BlueprintItineraryBlock, previousStopIds: Set<string>, nextStopIds: Set<string>, removedPlaceId: string): boolean {
  return Boolean(block.placeId === removedPlaceId && previousStopIds.has(removedPlaceId) && !nextStopIds.has(removedPlaceId) && !isRouteBlockForStops(block, previousStopIds));
}

function isDirectRouteSlotTemplate(block: BlueprintItineraryBlock, previousStopIds: Set<string>): boolean {
  return isRouteBlockForStops(block, previousStopIds) || block.id.startsWith("__direct-route-slot-");
}

function insertRouteSlotTemplate(
  dayId: string,
  blocks: BlueprintItineraryBlock[],
  previousStopIds: Set<string>,
  revision: DirectBlueprintItineraryRevision
): BlueprintItineraryBlock[] {
  const slot: BlueprintItineraryBlock = {
    id: `__direct-route-slot-${dayId}-${revision.placeId}`,
    kind: "stop",
    order: 0,
    placeId: revision.placeId,
    role: "direct_addition",
    evidence: []
  };
  const next = [...blocks];
  const { position } = revision;
  if (position.kind === "start") {
    const firstRouteIndex = next.findIndex((block) => isRouteBlockForStops(block, previousStopIds));
    next.splice(firstRouteIndex === -1 ? 0 : firstRouteIndex, 0, slot);
    return next;
  }
  if (position.kind === "end") {
    next.push(slot);
    return next;
  }
  const anchorIndex = next.findIndex((block) => block.placeId === position.afterPlaceId && isRouteBlockForStops(block, previousStopIds));
  next.splice(anchorIndex === -1 ? next.length : anchorIndex + 1, 0, slot);
  return next;
}

function blockForStopInSlot(
  dayId: string,
  stop: BlueprintStop,
  sourceBlock: BlueprintItineraryBlock | undefined,
  slotBlock: BlueprintItineraryBlock | undefined,
  usedIds: Set<string>
): BlueprintItineraryBlock {
  const baseId = sourceBlock?.id ?? `block-${dayId}-${stop.placeId}-direct`;
  const startTime = slotBlock?.startTime ?? stop.time;
  const endTime = slotBlock?.endTime;
  const role = stop.role ?? slotBlock?.role ?? sourceBlock?.role;
  const sourceContent = sourceBlock ? blockContentForDirectRevision(sourceBlock) : {};
  return {
    ...sourceContent,
    id: uniqueBlockId(baseId, usedIds),
    kind: sourceBlock?.kind && sourceBlock.kind !== "event" ? sourceBlock.kind : "stop",
    order: 0,
    placeId: stop.placeId,
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(role ? { role } : {}),
    evidence: sourceBlock ? [...sourceBlock.evidence] : []
  };
}

function blockContentForDirectRevision(block: BlueprintItineraryBlock): Omit<Partial<BlueprintItineraryBlock>, "id" | "kind" | "order" | "placeId" | "startTime" | "endTime" | "role" | "evidence"> {
  const {
    id: _id,
    kind: _kind,
    order: _order,
    placeId: _placeId,
    startTime: _startTime,
    endTime: _endTime,
    role: _role,
    evidence: _evidence,
    ...content
  } = structuredClone(block);
  return content;
}

function uniqueBlockId(baseId: string, usedIds: Set<string>): string {
  let candidate = baseId || "block";
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId || "block"}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function movementsForStops(dayId: string, stops: BlueprintStop[], places: BlueprintPlace[]): BlueprintMovement[] {
  const placeById = new Map(places.map((place) => [place.id, place] as const));
  return stops.slice(0, -1).map((stop, index) => ({
    id: `movement-${dayId}-${index + 1}`,
    dayId,
    originPlaceId: stop.placeId,
    destinationPlaceId: stops[index + 1]!.placeId,
    mode: directEditMovementMode(placeById.get(stop.placeId), placeById.get(stops[index + 1]!.placeId)),
    status: "recheck",
    label: "Route needs refresh",
    detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.",
    display: {
      routeLabel: "Route needs refresh",
      refreshReason: DIRECT_EDIT_ROUTE_REFRESH_REASON,
      refreshScope: {
        dayId,
        originPlaceId: stop.placeId,
        destinationPlaceId: stops[index + 1]!.placeId,
        reason: "direct_itinerary_edit"
      },
      showAsFormalRoute: true,
      mapLineState: "needs_refresh"
    },
    evidence: []
  }));
}

function directEditMovementMode(origin: BlueprintPlace | undefined, destination: BlueprintPlace | undefined): BlueprintMovementMode {
  if (!origin || !destination) return "walking";
  if (placeImpliesTransit(origin) || placeImpliesTransit(destination)) return "transit";
  if (origin.city && destination.city && normalizedText(origin.city) !== normalizedText(destination.city)) return "transit";
  const distance = coordinateDistanceMeters(origin.coordinates, destination.coordinates);
  if (distance !== undefined && distance > 3000) return "transit";
  return "walking";
}

function placeImpliesTransit(place: Pick<BlueprintPlace, "category" | "name" | "locationLabel">): boolean {
  const text = normalizedText(`${place.category} ${place.name} ${place.locationLabel}`);
  return /\b(?:airport|station|rail|train|terminal|ferry|bus|transport|transfer)\b/.test(text);
}

function coordinateDistanceMeters(origin: [number, number] | undefined, destination: [number, number] | undefined): number | undefined {
  if (!origin || !destination) return undefined;
  const [originLatitude, originLongitude] = origin;
  const [destinationLatitude, destinationLongitude] = destination;
  if (![originLatitude, originLongitude, destinationLatitude, destinationLongitude].every(Number.isFinite)) return undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(destinationLatitude - originLatitude);
  const deltaLongitude = radians(destinationLongitude - originLongitude);
  const startLatitude = radians(originLatitude);
  const endLatitude = radians(destinationLatitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function revisionMetadata(
  before: TripBlueprint,
  after: TripBlueprint,
  revision: DirectBlueprintDayRevision,
  previousDay: BlueprintItineraryDay,
  previousMovements: BlueprintMovement[]
): DirectBlueprintRevisionMetadata {
  const nextDay = after.days.find((day) => day.id === revision.dayId);
  const nextMovements = after.movements.filter((movement) => movement.dayId === revision.dayId);
  const impactDay = routeImpactDay(before, after, revision, previousDay, nextMovements);
  const affectedPlaceIds = uniqueStrings([
    revision.placeId,
    ...(revision.kind !== "remove_place_from_day" && revision.position.kind === "after" ? [revision.position.afterPlaceId] : []),
    ...(nextDay?.stops.map((stop) => stop.placeId) ?? []),
    ...previousDay.stops.map((stop) => stop.placeId)
  ]);
  return {
    id: `direct-revision-${before.id}-v${before.version}-to-v${after.version}`,
    kind: revision.kind,
    baseBlueprintVersion: before.version,
    appliedBlueprintVersion: after.version,
    createdAt: revision.createdAt,
    affectedDayIds: [revision.dayId],
    affectedPlaceIds,
    routeRefresh: {
      dayIds: [revision.dayId],
      movementIds: nextMovements.map((movement) => movement.id),
      reason: "This itinerary day was edited directly, so adjacent route, timing, meal, and opening constraints need refresh before execution."
    },
    routeImpact: {
      days: [impactDay]
    },
    replanReadiness: replanReadinessForImpacts([impactDay]),
    undo: {
      dayId: revision.dayId,
      previousDay,
      previousMovements
    }
  };
}

function placePriorityRevisionMetadata(
  before: TripBlueprint,
  after: TripBlueprint,
  revision: Extract<DirectBlueprintRevision, { kind: "update_place_priority" }>,
  previousPlace: BlueprintPlace,
  previousDay: BlueprintItineraryDay | undefined,
  previousMovements: BlueprintMovement[]
): DirectBlueprintRevisionMetadata {
  const affectedDayIds = blueprintImpactProjection(before, [revision]).dayIds;
  return {
    id: `direct-revision-${before.id}-v${before.version}-to-v${after.version}`,
    kind: revision.kind,
    baseBlueprintVersion: before.version,
    appliedBlueprintVersion: after.version,
    createdAt: revision.createdAt,
    affectedDayIds,
    affectedPlaceIds: [revision.placeId],
    routeRefresh: {
      dayIds: [],
      movementIds: [],
      reason: "This place status update does not change the route order."
    },
    routeImpact: {
      days: []
    },
    replanReadiness: {
      status: "no_replan_needed",
      dayIds: [],
      reason: "This place status update does not change route order or timing."
    },
    undo: {
      ...(previousDay ? { dayId: previousDay.id, previousDay } : {}),
      previousMovements,
      previousPlace: structuredClone(previousPlace)
    }
  };
}

function routeImpactDay(
  before: TripBlueprint,
  after: TripBlueprint,
  revision: DirectBlueprintDayRevision,
  previousDay: BlueprintItineraryDay,
  nextMovements: BlueprintMovement[]
): DirectBlueprintRouteImpactDay {
  const nextDay = after.days.find((day) => day.id === revision.dayId);
  const movementIds = uniqueStrings(nextMovements.map((movement) => movement.id));
  const addedPlaceIds = revision.kind === "add_place_to_day" ? [revision.placeId] : [];
  const removedPlaceIds = revision.kind === "remove_place_from_day" ? [revision.placeId] : [];
  const movedPlaceIds = revision.kind === "move_place_within_day" ? [revision.placeId] : [];
  const requiresTimingReview = Boolean(movementIds.length);
  const requiresMealRestSpacingReview = revision.kind === "add_place_to_day"
    || revision.kind === "remove_place_from_day"
    || movedPlaceIds.some((placeId) => placeAffectsMealRestSpacing(before, placeId));
  const capacityRisk = (nextDay?.stops.length ?? 0) >= 5;
  const backtrackingRisk = Boolean(nextDay && dayHasAreaBacktracking(after, nextDay));
  const fixedTimeRisk = fixedTimeStopCount(previousDay) >= 2 || fixedTimeStopCount(nextDay) >= 2;
  const readiness: DirectBlueprintReplanReadinessStatus = movementIds.length ? "ready_for_route_refresh" : "no_replan_needed";
  return {
    dayId: revision.dayId,
    addedPlaceIds,
    removedPlaceIds,
    movedPlaceIds,
    movementIds,
    requiresRouteRefresh: Boolean(movementIds.length),
    requiresTimingReview,
    requiresMealRestSpacingReview,
    capacityRisk,
    backtrackingRisk,
    fixedTimeRisk,
    readiness,
    reasons: routeImpactReasons({ revision, requiresTimingReview, requiresMealRestSpacingReview, capacityRisk, backtrackingRisk, fixedTimeRisk })
  };
}

function routeImpactReasons(input: { revision: DirectBlueprintDayRevision; requiresTimingReview: boolean; requiresMealRestSpacingReview: boolean; capacityRisk: boolean; backtrackingRisk: boolean; fixedTimeRisk: boolean }): string[] {
  const reasons = [`${input.revision.kind} changed the saved itinerary order for this day.`];
  if (input.requiresTimingReview) reasons.push("Adjacent movement timing should be reviewed before execution.");
  if (input.requiresMealRestSpacingReview) reasons.push("Meal and rest spacing should be checked after this edit.");
  if (input.capacityRisk) reasons.push("The edited day has five or more planned stops.");
  if (input.backtrackingRisk) reasons.push("The edited sequence revisits an area and may create backtracking.");
  if (input.fixedTimeRisk) reasons.push("The edited day includes multiple fixed time labels.");
  return uniqueStrings(reasons);
}

function mergeRouteImpactDays(days: DirectBlueprintRouteImpactDay[]): DirectBlueprintRouteImpactDay[] {
  const byDay = new Map<string, DirectBlueprintRouteImpactDay>();
  for (const day of days) {
    const existing = byDay.get(day.dayId);
    if (!existing) {
      byDay.set(day.dayId, structuredClone(day));
      continue;
    }
    byDay.set(day.dayId, {
      dayId: day.dayId,
      addedPlaceIds: uniqueStrings([...existing.addedPlaceIds, ...day.addedPlaceIds]),
      removedPlaceIds: uniqueStrings([...existing.removedPlaceIds, ...day.removedPlaceIds]),
      movedPlaceIds: uniqueStrings([...existing.movedPlaceIds, ...day.movedPlaceIds]),
      movementIds: uniqueStrings([...existing.movementIds, ...day.movementIds]),
      requiresRouteRefresh: existing.requiresRouteRefresh || day.requiresRouteRefresh,
      requiresTimingReview: existing.requiresTimingReview || day.requiresTimingReview,
      requiresMealRestSpacingReview: existing.requiresMealRestSpacingReview || day.requiresMealRestSpacingReview,
      capacityRisk: existing.capacityRisk || day.capacityRisk,
      backtrackingRisk: existing.backtrackingRisk || day.backtrackingRisk,
      fixedTimeRisk: existing.fixedTimeRisk || day.fixedTimeRisk,
      readiness: strongerReadiness(existing.readiness, day.readiness),
      reasons: uniqueStrings([...existing.reasons, ...day.reasons])
    });
  }
  return [...byDay.values()];
}

function replanReadinessForImpacts(days: DirectBlueprintRouteImpactDay[]): DirectBlueprintReplanReadiness {
  const assistedDayIds = days.filter((day) => day.readiness === "assisted_replanning_required").map((day) => day.dayId);
  if (assistedDayIds.length) {
    return {
      status: "assisted_replanning_required",
      dayIds: assistedDayIds,
      reason: "At least one edited day needs assisted replanning before it can be treated as execution-ready."
    };
  }
  const routeDayIds = days.filter((day) => day.requiresRouteRefresh).map((day) => day.dayId);
  if (routeDayIds.length) {
    return {
      status: "ready_for_route_refresh",
      dayIds: routeDayIds,
      reason: "These direct itinerary edits are saved, but affected routes and timing still need refresh before execution."
    };
  }
  return {
    status: "no_replan_needed",
    dayIds: [],
    reason: "This direct edit does not change route order or timing."
  };
}

function strongerReadiness(left: DirectBlueprintReplanReadinessStatus, right: DirectBlueprintReplanReadinessStatus): DirectBlueprintReplanReadinessStatus {
  const rank: Record<DirectBlueprintReplanReadinessStatus, number> = {
    no_replan_needed: 0,
    ready_for_route_refresh: 1,
    assisted_replanning_required: 2
  };
  return rank[right] > rank[left] ? right : left;
}

function placeAffectsMealRestSpacing(blueprint: TripBlueprint, placeId: string): boolean {
  const place = blueprint.places.find((candidate) => candidate.id === placeId);
  const text = normalizedText(`${place?.category ?? ""} ${place?.visitRole ?? ""} ${place?.name ?? ""}`);
  return /\b(lunch|dinner|breakfast|meal|restaurant|food|market|coffee|cafe|café|tea|dessert|bakery|bar|rest|break|hotel|lodging)\b/.test(text);
}

function dayHasAreaBacktracking(blueprint: TripBlueprint, day: BlueprintItineraryDay): boolean {
  const placeById = new Map(blueprint.places.map((place) => [place.id, place] as const));
  const areas = day.stops.map((stop) => normalizedText(placeById.get(stop.placeId)?.area ?? placeById.get(stop.placeId)?.locationLabel ?? "")).filter(Boolean);
  const lastIndexByArea = new Map<string, number>();
  for (const [index, area] of areas.entries()) {
    const lastIndex = lastIndexByArea.get(area);
    if (lastIndex !== undefined && index - lastIndex > 1) return true;
    lastIndexByArea.set(area, index);
  }
  return false;
}

function fixedTimeStopCount(day: BlueprintItineraryDay | undefined): number {
  return day?.stops.filter((stop) => Boolean(stop.time)).length ?? 0;
}

function movementsForDay(blueprint: TripBlueprint, dayId: string): BlueprintMovement[] {
  return structuredClone(blueprint.movements.filter((movement) => movement.dayId === dayId));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function uniqueRevisionKinds(values: DirectBlueprintRevision["kind"][]): DirectBlueprintRevision["kind"][] {
  const seen = new Set<DirectBlueprintRevision["kind"]>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function updateSupportingContent(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "set_tip_state" | "create_preparation" | "set_preparation_completed" | "review_booking_relationships" | "select_booking_sources" }>,resolvedBookingConstraints?:BlueprintBookingConstraint[],sourceSelectionDecision?:BookingSourceSelectionDecision,sourceContext?:BookingRelationshipSourceContext): DirectBlueprintRevisionResult {
  const next = structuredClone(blueprint);
  let sourceSelectionAudit:BookingSourceSelectionAudit|undefined;
  if(revision.kind === "select_booking_sources") {
    if(!resolvedBookingConstraints||!Array.isArray(revision.sourceBookingIds)||!revision.expectedSourceSetDigest||revision.sourceBookingIds.some(id=>typeof id!=="string"||!id.trim())||new Set(revision.sourceBookingIds).size!==revision.sourceBookingIds.length) throw new WorkspaceMutationError("请先选择并核对合法预订来源。");
    const resolvedIds=resolvedBookingConstraints.map(booking=>booking.sourceBookingId);
    if(resolvedIds.some(id=>!id)||new Set(resolvedIds).size!==resolvedIds.length||resolvedIds.length!==revision.sourceBookingIds.length||resolvedIds.some(id=>!revision.sourceBookingIds.includes(id!))) throw new WorkspaceMutationError("预订来源与所审阅选择不一致。");
    sourceSelectionAudit=validateBookingSourceSelection(blueprint.bookingConstraints??[],resolvedBookingConstraints,revision.legacyBindings,sourceSelectionDecision);
    reconcileBookingRelationshipAssessment(next,resolvedBookingConstraints);
    if(next.bookingRelationshipAssessment) next.bookingRelationshipAssessment.status="invalidated";
  } else if (revision.kind === "review_booking_relationships") {
    if(sourceContext) {
      const snapshotUnits=bookingRelationshipSourceUnits(blueprint.bookingConstraints??[]);
      if(sourceContext.pendingSources.length||sourceContext.resolutionIssues.length||sourceContext.adoptedUnits.length!==snapshotUnits.length||snapshotUnits.some(unit=>!sourceContext.adoptedUnits.some(current=>current.bookingConstraintId===unit.bookingConstraintId&&current.segmentId===unit.segmentId&&current.sourceDigest===unit.sourceDigest))) throw new WorkspaceMutationError("请先核对并纳入当前预订来源，再独立审阅关联。","booking_source_review_required");
    }
    const issues=bookingRelationshipAssessmentIssues(blueprint,revision.assessment,true);
    if(issues.length || revision.assessment.status!=="reviewed") throw new WorkspaceMutationError(issues[0]??"请明确接受预订关联审阅。", "invalid_edit");
    next.bookingRelationshipAssessment=stampReviewedBookingRelationshipAssessment(blueprint,revision.assessment);
  } else if (revision.kind === "set_tip_state") {
    const tip = next.travelTips?.find((item) => item.id === revision.tipId);
    if (!tip || (revision.pinned === undefined && revision.hidden === undefined)) throw new WorkspaceMutationError("请选择有效提示及置顶或隐藏状态。");
    if (revision.pinned !== undefined) { if (typeof revision.pinned !== "boolean") throw new WorkspaceMutationError("提示置顶状态无效。"); tip.pinned = revision.pinned; }
    if (revision.hidden !== undefined) { if (typeof revision.hidden !== "boolean") throw new WorkspaceMutationError("提示隐藏状态无效。"); tip.hidden = revision.hidden; }
  } else if (revision.kind === "set_preparation_completed") {
    const item = next.preparationChecklist?.find((item) => item.id === revision.preparationId);
    if (!item || typeof revision.completed !== "boolean") throw new WorkspaceMutationError("请选择有效准备项及完成状态。");
    if (item.requirementId !== undefined) throw new WorkspaceMutationError("此准备项关联执行任务，请通过任务清单更新完成状态。", "invalid_edit");
    item.completed = revision.completed;
  } else {
    const origin = revision.origin;
    if (origin.blueprintId !== blueprint.id || origin.blueprintVersion !== blueprint.version) throw new WorkspaceMutationError("准备项来源版本已变化，请刷新后重试。", "version_conflict");
    const collection = origin.kind === "tip" ? blueprint.travelTips : origin.kind === "place" ? blueprint.places : origin.kind === "local_food" ? blueprint.localFoods : origin.kind === "local_product" ? blueprint.localProducts : origin.kind === "experience_theme" ? blueprint.experienceThemes : undefined;
    const source = collection?.find((item) => item.id === origin.id);
    if (!source) throw new WorkspaceMutationError("准备项来源不存在。");
    next.preparationChecklist ??= [];
    if (!next.preparationChecklist.some((item) => item.origin?.kind === origin.kind && item.origin.id === origin.id && item.origin.blueprintId === origin.blueprintId)) {
      const title = "title" in source ? source.title : source.name;
      next.preparationChecklist.push({ id: `preparation-${origin.kind}-${origin.id}`, title, ...("body" in source ? {description: source.body} : "description" in source ? {description: source.description} : {}), group: "other", completionCondition: "The traveler confirms that preparation is complete.", origin: structuredClone(origin), completed: false, ...(origin.kind === "place" ? { placeId: origin.id } : "placeId" in source && source.placeId ? {placeId: source.placeId} : {}), evidence: structuredClone(source.evidence) });
    }
  }
  next.version = blueprint.version + 1;
  next.createdAt = revision.createdAt;
  reconcileBookingRelationshipAssessment(next);
  assertTripBlueprintIntegrity(next);
  return { blueprint: next, metadata: { ...(sourceSelectionAudit?{sourceSelectionAudit}:{}), id: `direct-revision-${blueprint.id}-v${blueprint.version}-to-v${next.version}`, kind: revision.kind, baseBlueprintVersion: blueprint.version, appliedBlueprintVersion: next.version, createdAt: revision.createdAt, affectedDayIds: [], affectedPlaceIds: [], routeRefresh: { dayIds: [], movementIds: [], reason: "Travel tips and preparation changes did not alter the route." }, undo: { previousMovements: [] } } };
}

export interface DirectBlueprintHighImpactPreview {
  sourceContext?: BookingRelationshipSourceContext;
  id: string;
  blueprintId: string;
  blueprintVersion: number;
  dayIds: string[];
  dates: string[];
  placeIds: string[];
  movementIds: string[];
  reminderRequirementIds: string[];
  bookingConstraintIds: string[];
  bookingImpact: BookingRelationshipImpact;
  evidence: import("./trip-blueprint.js").BlueprintEvidenceRef[];
  nextActions: Array<"confirm_removal" | "cancel" | "assisted_replanning" | "review_booking_relationships">;
}
export class DirectBlueprintHighImpactError extends Error {
  readonly code = "high_impact_confirmation_required";
  constructor(readonly impact: DirectBlueprintHighImpactPreview) { super("删除必访地点前，请审阅日期、路线、提醒、预订及来源影响并确认。"); }
}
/** 无 context 时仅评价快照；Storage 的真实读写路径必须传入当前来源事实。 */
export function previewDirectBlueprintRevisionImpact(blueprint: TripBlueprint, revisions: DirectBlueprintRevision[],sourceContext?:BookingRelationshipSourceContext): DirectBlueprintHighImpactPreview | undefined {
  const removed = revisions.filter((revision): revision is Extract<DirectBlueprintRevision, {kind: "remove_place_from_day"}> => revision.kind === "remove_place_from_day");
  const relationEdits=revisions.filter(revision=>"placeId" in revision);
  const bookingImpact=bookingRelationshipImpact(blueprint,relationEdits,sourceContext);
  if (!relationEdits.length || (!removed.some(revision=>blueprint.places.some(place=>place.id===revision.placeId&&place.priority==="must")) && !bookingImpact.unknown.length && !bookingImpact.affected.length)) return undefined;
  const { dayIds, placeIds } = blueprintImpactProjection(blueprint, revisions);
  const places = blueprint.places.filter((place) => placeIds.includes(place.id));
  const requirements = blueprint.actionRequirements.filter((requirement) => requirement.placeId && placeIds.includes(requirement.placeId));
  return { ...(sourceContext ? { sourceContext: structuredClone(sourceContext) } : {}), id: bookingRelationshipDigest({ assessmentDigest:bookingImpact.assessmentDigest, blueprintId: blueprint.id, version: blueprint.version, revisions: revisions.map(({ createdAt, ...revision }) => { if ("highImpactConfirmation" in revision) delete revision.highImpactConfirmation; return revision; }) }), blueprintId: blueprint.id, blueprintVersion: blueprint.version, dayIds, dates: blueprint.days.filter((day) => dayIds.includes(day.id)).map((day) => day.date), placeIds, movementIds: blueprint.movements.filter((movement) => dayIds.includes(movement.dayId)).map((movement) => movement.id), reminderRequirementIds: requirements.map((requirement) => requirement.id), bookingConstraintIds: [...new Set(bookingImpact.affected.map((booking) => booking.bookingConstraintId))], bookingImpact, evidence: places.flatMap((place) => structuredClone(place.evidence)), nextActions: bookingImpact.canConfirm ? ["confirm_removal", "cancel", "assisted_replanning"] : ["review_booking_relationships", "cancel", "assisted_replanning"] };
}
export function undoDirectBlueprintRevision(current: TripBlueprint, before: TripBlueprint, after: TripBlueprint, createdAt: string, sourceContext?:BookingRelationshipSourceContext): TripBlueprint {
  if (current.id !== after.id || current.version !== after.version || before.id !== current.id || before.version + 1 !== after.version) throw new WorkspaceMutationError("当前旅行蓝图已变化，无法撤销该编辑。", "version_conflict");
  if(sourceContext) assertBookingRelationshipSourceContext(current,sourceContext);
  const next = structuredClone(current);
  for (const key of ["days", "movements", "places", "travelTips", "preparationChecklist", "bookingRelationshipAssessment", "bookingConstraints"] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      const restored = restoreDirectEditValue(before[key], after[key], current[key]);
      if (restored === undefined) delete next[key]; else Object.assign(next, { [key]: restored });
    }
  }
  const inverseEdits=inverseRelationshipEdits(current,next);
  for(const edit of inverseEdits) {
    const place=current.places.find(place=>place.id===edit.placeId);
    if(place?.priority==='booked'||hasReservationRequirement(current,edit.placeId)||bookingRelationshipFixedProtection(next,edit,sourceContext)) throw new WorkspaceMutationError("当前固定承诺不能直接撤销，请核对预订或使用辅助重规划。","assisted_replanning_required");
  }
  if(inverseEdits.length) {
    // 原审阅证明可以解释精确恢复后的目标；当前真实源摘要仍必须一致。
    const impact=bookingRelationshipImpact(next,inverseEdits,sourceContext);
    if(!impact.canConfirm) throw new WorkspaceMutationError("当前预订关联尚不能证明此次撤销安全，请先审阅来源与关联，再重新编辑。","booking_source_review_required");
  }
  if(sourceContext&&next.bookingRelationshipAssessment) {
    const restoredUnits=bookingRelationshipSourceUnits(next.bookingConstraints??[]);
    if(sourceContext.pendingSources.length||sourceContext.resolutionIssues.length||restoredUnits.length!==sourceContext.adoptedUnits.length||restoredUnits.some(unit=>!sourceContext.adoptedUnits.some(actual=>actual.bookingConstraintId===unit.bookingConstraintId&&actual.segmentId===unit.segmentId&&actual.sourceDigest===unit.sourceDigest))) next.bookingRelationshipAssessment.status='invalidated';
  }
  next.version = current.version + 1; next.createdAt = createdAt;
  reconcileBookingRelationshipAssessment(next);
  assertTripBlueprintIntegrity(next);
  return next;
}

/** 比较真正要恢复的目标语义；提示文案、准备项和关系自身不伪装为日程操作。 */
function inverseRelationshipEdits(current:TripBlueprint, restored:TripBlueprint):Array<{kind:string;placeId:string;dayId?:string}> {
  const edits:Array<{kind:string;placeId:string;dayId?:string}>=[];
  const occurrence=(blueprint:TripBlueprint,dayId:string,placeId:string)=>{
    const day=blueprint.days.find(day=>day.id===dayId);
    return {date:day?.date,stops:day?.stops.flatMap((stop,index)=>stop.placeId===placeId?[{index,stop}]:[]),blocks:day?.blocks?.flatMap((block,index)=>block.placeId===placeId?[{index,block}]:[])};
  };
  for(const dayId of new Set([...current.days,...restored.days].map(day=>day.id))) {
    const places=(blueprint:TripBlueprint)=>{const day=blueprint.days.find(day=>day.id===dayId);return new Set([...(day?.stops.map(stop=>stop.placeId)??[]),...(day?.blocks?.flatMap(block=>block.placeId?[block.placeId]:[])??[])]);};
    const oldPlaces=places(current),newPlaces=places(restored);
    for(const placeId of new Set([...oldPlaces,...newPlaces])) if(bookingRelationshipDigest(occurrence(current,dayId,placeId))!==bookingRelationshipDigest(occurrence(restored,dayId,placeId))) edits.push({kind:!newPlaces.has(placeId)?'remove_place_from_day':!oldPlaces.has(placeId)?'add_place_to_day':'move_place_within_day',placeId,dayId});
  }
  for(const place of current.places) {
    const next=restored.places.find(candidate=>candidate.id===place.id);
    if(next&&next.priority!==place.priority) edits.push({kind:'update_place_priority',placeId:place.id});
  }
  for(const movementId of new Set([...current.movements,...restored.movements].map(movement=>movement.id))) {
    const old=current.movements.find(movement=>movement.id===movementId),next=restored.movements.find(movement=>movement.id===movementId);
    if(bookingRelationshipDigest(old??null)!==bookingRelationshipDigest(next??null)) for(const movement of [old,next]) if(movement) for(const placeId of [movement.originPlaceId,movement.destinationPlaceId]) edits.push({kind:'move_place_within_day',placeId,dayId:movement.dayId});
  }
  return edits;
}

function restoreDirectEditValue(before: unknown, after: unknown, current: unknown, field?: string): unknown {
  if (field === "completed" || JSON.stringify(before) === JSON.stringify(after)) return structuredClone(current);
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current) && [...before, ...after, ...current].every(item => item && typeof item === "object" && typeof item.id === "string")) {
    const result = current.filter(item => before.some(previous => previous.id === item.id) || !after.some(saved => saved.id === item.id)).map(item => {
      const previous=before.find(previous=>previous.id===item.id); const saved=after.find(saved=>saved.id===item.id);
      return previous && saved ? restoreDirectEditValue(previous,saved,item) : structuredClone(item);
    });
    for(const previous of before) if(!after.some(saved=>saved.id===previous.id) && !result.some(item=>(item as {id:string}).id===previous.id)) result.push(structuredClone(previous));
    result.sort((left,right) => { const a=before.findIndex(item=>item.id===(left as {id:string}).id), b=before.findIndex(item=>item.id===(right as {id:string}).id); return (a<0?before.length:a)-(b<0?before.length:b); });
    return result;
  }
  if (before && after && current && typeof before === "object" && typeof after === "object" && typeof current === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const previous=before as Record<string,unknown>, saved=after as Record<string,unknown>, result=structuredClone(current) as Record<string,unknown>;
    for(const key of new Set([...Object.keys(previous),...Object.keys(saved)])) if(JSON.stringify(previous[key])!==JSON.stringify(saved[key])) { const value=restoreDirectEditValue(previous[key],saved[key],result[key],key); if(value===undefined)delete result[key];else result[key]=value; }
    return result;
  }
  return structuredClone(before);
}
