import { assertTripBlueprintIntegrity, type BlueprintItineraryBlock, type BlueprintItineraryDay, type BlueprintMovement, type BlueprintMovementMode, type BlueprintPlace, type BlueprintPlacePriority, type BlueprintStop, type TripBlueprint } from "./trip-blueprint.js";

const DIRECT_EDIT_ROUTE_REFRESH_REASON = "Refresh this route leg after direct itinerary edits.";

export type DirectBlueprintRevision =
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
  }
  | {
    kind: "update_place_priority";
    placeId: string;
    priority: BlueprintPlacePriority;
    createdAt: string;
  };

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

export function applyDirectBlueprintRevision(blueprint: TripBlueprint, revision: DirectBlueprintRevision): TripBlueprint {
  return applyDirectBlueprintRevisionWithMetadata(blueprint, revision).blueprint;
}

export function applyDirectBlueprintRevisionWithMetadata(blueprint: TripBlueprint, revision: DirectBlueprintRevision): DirectBlueprintRevisionResult {
  assertTripBlueprintIntegrity(blueprint);
  if (!Number.isFinite(Date.parse(revision.createdAt))) throw new Error("Blueprint Revision needs a valid creation time.");
  if (revision.kind === "add_place_to_day") return addPlaceToDay(blueprint, revision);
  if (revision.kind === "move_place_within_day") return movePlaceWithinDay(blueprint, revision);
  if (revision.kind === "remove_place_from_day") return removePlaceFromDay(blueprint, revision);
  if (revision.kind === "update_place_priority") return updatePlacePriority(blueprint, revision);
  throw new Error("Unsupported Blueprint Revision.");
}

export function applyDirectBlueprintRevisionBatchWithMetadata(blueprint: TripBlueprint, revisions: DirectBlueprintRevision[]): DirectBlueprintRevisionBatchResult {
  assertTripBlueprintIntegrity(blueprint);
  if (!revisions.length) throw new Error("A Direct Blueprint Revision batch needs at least one edit.");
  const original = structuredClone(blueprint);
  let current = structuredClone(blueprint) as TripBlueprint;
  const revisionMetadataItems: DirectBlueprintRevisionMetadata[] = [];

  for (const revision of revisions) {
    const result = applyDirectBlueprintRevisionWithMetadata(current, revision);
    current = result.blueprint;
    revisionMetadataItems.push(result.metadata);
  }

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
  const hasItineraryEdit = revisionMetadataItems.some((item) => item.kind !== "update_place_priority");
  const routeRefreshReason = hasItineraryEdit
    ? "These itinerary days were edited directly, so affected route, timing, meal, and opening constraints need refresh before execution."
    : "These place status updates do not change route order.";
  const createdAt = revisions[revisions.length - 1]!.createdAt;

  return {
    blueprint: current,
    metadata: {
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
  if (!input.revisions.length) throw new Error("Assisted replanning needs at least one pending itinerary edit.");
  for (const revision of input.revisions) {
    if (!Number.isFinite(Date.parse(revision.createdAt))) throw new Error("Assisted replanning needs valid edit creation times.");
    if (!blueprint.places.some((place) => place.id === revision.placeId)) throw new Error(`Assisted replanning references unknown place ${revision.placeId}.`);
    if ("dayId" in revision && !blueprint.days.some((day) => day.id === revision.dayId)) throw new Error(`Assisted replanning references unknown day ${revision.dayId}.`);
  }
  const requirement = input.replanRequirement;
  const requirementPlace = blueprint.places.find((place) => place.id === requirement.placeId);
  if (!requirementPlace) throw new Error(`Assisted replanning requirement references unknown place ${requirement.placeId}.`);
  if (requirement.dayId && !blueprint.days.some((day) => day.id === requirement.dayId)) throw new Error(`Assisted replanning requirement references unknown day ${requirement.dayId}.`);
  const blueprintDayIds = new Set(blueprint.days.map((day) => day.id));
  const blueprintPlaceIds = new Set(blueprint.places.map((place) => place.id));
  const unknownAffectedDay = requirement.affectedDayIds.find((dayId) => !blueprintDayIds.has(dayId));
  if (unknownAffectedDay) throw new Error(`Assisted replanning requirement references unknown affected day ${unknownAffectedDay}.`);
  const unknownAffectedPlace = requirement.affectedPlaceIds.find((placeId) => !blueprintPlaceIds.has(placeId));
  if (unknownAffectedPlace) throw new Error(`Assisted replanning requirement references unknown affected place ${unknownAffectedPlace}.`);
  if (requirement.dayId && !requirement.affectedDayIds.includes(requirement.dayId)) throw new Error("Assisted replanning requirement must include its target day in affectedDayIds.");
  if (!requirement.affectedPlaceIds.includes(requirement.placeId)) throw new Error("Assisted replanning requirement must include its target place in affectedPlaceIds.");
  if (!input.revisions.some((revision) => revisionMatchesRequirement(revision, requirement))) throw new Error("Assisted replanning needs a pending edit that matches the replanning requirement.");
  const affectedDayIds = uniqueStrings([
    ...requirement.affectedDayIds,
    ...input.revisions.flatMap((revision) => "dayId" in revision ? [revision.dayId] : [])
  ]);
  const affectedPlaceIds = uniqueStrings([
    ...requirement.affectedPlaceIds,
    ...input.revisions.map((revision) => revision.placeId),
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

function addPlaceToDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "add_place_to_day" }>): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new Error(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new Error(`Blueprint Revision references unknown day ${revision.dayId}.`);
  if (day.stops.some((stop) => stop.placeId === revision.placeId)) throw new Error(`Place ${revision.placeId} is already scheduled on day ${revision.dayId}.`);
  if (hasFixedBookingConstraint(blueprint, place)) throw directReplanRequirementError(blueprint, revision, "fixed_booking", `${place.name} is tied to a fixed booking, so Landi needs to place it with the right timing.`);
  const eligibility = place.schedulingEligibility;
  if (eligibility?.decision === "informational") throw directReplanRequirementError(blueprint, revision, "informational_place", `${place.name} is background information, so Landi needs to replan before placing it into ${dayLabel(day, revision.dayId)}.`);
  if (eligibility?.decision === "blocked") throw directReplanRequirementError(blueprint, revision, "blocked_place", `${place.name} is blocked for direct scheduling, so Landi needs to replan before it can be added to ${dayLabel(day, revision.dayId)}.`);
  if (eligibility?.decision === "high_impact") throw directReplanRequirementError(blueprint, revision, "high_impact_place", `${place.name} changes the shape of ${dayLabel(day, revision.dayId)}, so Landi needs to replan that day before saving it.`);
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
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return {
    blueprint: next,
    metadata: revisionMetadata(blueprint, next, revision, previousDay, previousMovements)
  };
}

function movePlaceWithinDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "move_place_within_day" }>): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new Error(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new Error(`Blueprint Revision references unknown day ${revision.dayId}.`);
  const stop = day.stops.find((candidate) => candidate.placeId === revision.placeId);
  if (!stop) throw new Error(`Place ${revision.placeId} is not scheduled on day ${revision.dayId}.`);
  if (place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId) || hasFixedBookingConstraint(blueprint, place)) throw directReplanRequirementError(blueprint, revision, "fixed_booking", `${place.name} is tied to a booking or reservation, so Landi needs to replan before moving it.`);
  const eligibility = place.schedulingEligibility;
  if (eligibility?.decision === "informational") throw directReplanRequirementError(blueprint, revision, "informational_place", `${place.name} is background information, so Landi needs to replan before moving it inside ${dayLabel(day, revision.dayId)}.`);
  if (eligibility?.decision === "blocked") throw directReplanRequirementError(blueprint, revision, "blocked_place", `${place.name} is blocked for direct scheduling, so Landi needs to replan before moving it.`);
  if (eligibility?.decision === "high_impact") throw directReplanRequirementError(blueprint, revision, "high_impact_place", `${place.name} changes the shape of ${dayLabel(day, revision.dayId)}, so Landi needs to replan that day before moving it.`);
  if (revision.position.kind === "after" && revision.position.afterPlaceId === revision.placeId) throw new Error("Blueprint Revision cannot move a place after itself.");

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
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return {
    blueprint: next,
    metadata: revisionMetadata(blueprint, next, revision, previousDay, previousMovements)
  };
}

function removePlaceFromDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "remove_place_from_day" }>): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new Error(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new Error(`Blueprint Revision references unknown day ${revision.dayId}.`);
  if (!day.stops.some((stop) => stop.placeId === revision.placeId)) throw new Error(`Place ${revision.placeId} is not scheduled on day ${revision.dayId}.`);
  if (place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId) || hasFixedBookingConstraint(blueprint, place)) throw directReplanRequirementError(blueprint, revision, "fixed_booking", `${place.name} is tied to a booking or reservation, so Landi needs to replan before removing it.`);
  const eligibility = place.schedulingEligibility;
  if (eligibility?.decision === "informational") throw directReplanRequirementError(blueprint, revision, "informational_place", `${place.name} is background information, so Landi needs to replan before removing it from ${dayLabel(day, revision.dayId)}.`);
  if (eligibility?.decision === "blocked") throw directReplanRequirementError(blueprint, revision, "blocked_place", `${place.name} is blocked for direct scheduling, so Landi needs to replan before removing it.`);
  if (eligibility?.decision === "high_impact") throw directReplanRequirementError(blueprint, revision, "high_impact_place", `${place.name} changes the shape of ${dayLabel(day, revision.dayId)}, so Landi needs to replan that day before removing it.`);

  const previousDay = structuredClone(day);
  const previousMovements = movementsForDay(blueprint, day.id);
  const nextStops = removeStop(day.stops, revision);
  const nextBlocks = blocksForRemovedStop(day.id, day.blocks, day.stops, nextStops, revision.placeId);
  const nextDays = blueprint.days.map((candidate) => candidate.id === day.id
    ? {
      ...candidate,
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
    movements: nextMovements,
    createdAt: revision.createdAt
  };
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return {
    blueprint: next,
    metadata: revisionMetadata(blueprint, next, revision, previousDay, previousMovements)
  };
}

function updatePlacePriority(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "update_place_priority" }>): DirectBlueprintRevisionResult {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new Error(`Blueprint Revision references unknown place ${revision.placeId}.`);
  if (place.priority === revision.priority) throw new Error(`Place ${revision.placeId} already has priority ${revision.priority}.`);
  const scheduledDay = blueprint.days.find((day) => day.stops.some((stop) => stop.placeId === revision.placeId));
  if (scheduledDay && revision.priority === "archive") throw directReplanRequirementError(blueprint, revision, "scheduled_archive", `${place.name} is already scheduled on ${dayLabel(scheduledDay, scheduledDay.id)}, so Landi needs to replan before keeping it for later.`);

  const previousDay = scheduledDay ? structuredClone(scheduledDay) : undefined;
  const previousMovements = scheduledDay ? movementsForDay(blueprint, scheduledDay.id) : [];
  const next: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    places: blueprint.places.map((candidate) => candidate.id === revision.placeId ? { ...candidate, priority: revision.priority } : structuredClone(candidate)),
    createdAt: revision.createdAt
  };
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
    if (afterIndex === -1) throw new Error(`Blueprint Revision cannot insert after unknown place ${position.afterPlaceId}.`);
    insertionIndex = afterIndex + 1;
  }
  ordered.splice(insertionIndex, 0, { placeId: revision.placeId, order: insertionIndex + 1, role: "direct_addition" });
  return ordered.map((stop, index) => ({ ...stop, order: index + 1 }));
}

function moveStop(stops: BlueprintStop[], revision: Extract<DirectBlueprintRevision, { kind: "move_place_within_day" }>): BlueprintStop[] {
  const ordered = [...stops].sort((left, right) => left.order - right.order).map((stop) => ({ ...stop }));
  const slots = ordered.map((stop) => ({ time: stop.time, role: stop.role }));
  const movingIndex = ordered.findIndex((stop) => stop.placeId === revision.placeId);
  if (movingIndex === -1) throw new Error(`Place ${revision.placeId} is not scheduled on day ${revision.dayId}.`);
  const [moving] = ordered.splice(movingIndex, 1);
  const { position } = revision;
  let insertionIndex = 0;
  if (position.kind === "end") insertionIndex = ordered.length;
  if (position.kind === "after") {
    const afterIndex = ordered.findIndex((stop) => stop.placeId === position.afterPlaceId);
    if (afterIndex === -1) throw new Error(`Blueprint Revision cannot insert after unknown place ${position.afterPlaceId}.`);
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

function hasFixedBookingConstraint(blueprint: TripBlueprint, place: Pick<BlueprintPlace, "name" | "localizedName" | "locationLabel">): boolean {
  const nameKeys = bookingMatchKeys([place.name, place.localizedName]);
  const locationKeys = bookingMatchKeys([place.locationLabel]).filter((key) => key.length >= 8);
  if (!nameKeys.length && !locationKeys.length) return false;
  return (blueprint.bookingConstraints ?? []).some((constraint) => {
    if (constraint.status === "cancelled" || constraint.constraintStrength === "ignored") return false;
    const constraintTexts = bookingMatchTexts([constraint.title]);
    const nameMatched = nameKeys.some((key) => constraintTexts.some((text) => bookingTextMatches(text, key)));
    if (nameMatched && constraint.segments.some((segment) => segment.fixedCommitment && segment.constraintStrength === "hard")) return true;
    return constraint.segments.some((segment) => {
      if (!segment.fixedCommitment || segment.constraintStrength !== "hard") return false;
      const segmentTexts = bookingMatchTexts([segment.title, segment.location]);
      return nameKeys.some((key) => segmentTexts.some((text) => bookingTextMatches(text, key)))
        || locationKeys.some((key) => segmentTexts.some((text) => bookingTextMatches(text, key)));
    });
  });
}

function bookingMatchKeys(values: Array<string | undefined>): string[] {
  return uniqueStrings(values.flatMap((value) => {
    const text = normalizeBookingText(value);
    return text && text.length >= 3 ? [text] : [];
  }));
}

function bookingMatchTexts(values: Array<string | undefined>): string[] {
  return values.flatMap((value) => {
    const text = normalizeBookingText(value);
    return text ? [text] : [];
  });
}

function normalizeBookingText(value: string | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase();
}

function bookingTextMatches(text: string, key: string): boolean {
  return text === key || (key.length >= 8 && text.length >= 8 && (text.includes(key) || key.includes(text)));
}

function directReplanRequirementError(
  blueprint: TripBlueprint,
  revision: DirectBlueprintRevision,
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
  const placeName = placeById.get(revision.placeId)?.name ?? revision.placeId;
  if (revision.kind === "update_place_priority") return `Set ${placeName} to ${revision.priority}.`;
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
  if (revision.kind !== requirement.editKind || revision.placeId !== requirement.placeId) return false;
  if (!("dayId" in revision) || !requirement.dayId) return !("dayId" in revision) && !requirement.dayId;
  return revision.dayId === requirement.dayId;
}

function assertDirectBlueprintReplanRequirement(value: DirectBlueprintReplanRequirement): void {
  if (!value || typeof value !== "object") throw new Error("Assisted replanning needs a structured requirement.");
  if (value.status !== "assisted_replanning_required") throw new Error("Assisted replanning needs an assisted requirement.");
  if (!isDirectRevisionKind(value.editKind)) throw new Error("Assisted replanning requirement needs a supported edit kind.");
  if (typeof value.placeId !== "string" || !value.placeId.trim()) throw new Error("Assisted replanning requirement needs a place.");
  if (value.dayId !== undefined && (typeof value.dayId !== "string" || !value.dayId.trim())) throw new Error("Assisted replanning requirement needs a valid day.");
  if (!isDirectReplanRequirementReasonCode(value.reasonCode)) throw new Error("Assisted replanning requirement needs a supported reason.");
  if (!Array.isArray(value.affectedDayIds) || !Array.isArray(value.affectedPlaceIds)) throw new Error("Assisted replanning requirement needs affected days and places.");
  if (!value.affectedPlaceIds.length) throw new Error("Assisted replanning requirement needs at least one affected place.");
  if (value.affectedDayIds.some((dayId) => typeof dayId !== "string" || !dayId.trim())) throw new Error("Assisted replanning requirement has an invalid affected day.");
  if (value.affectedPlaceIds.some((placeId) => typeof placeId !== "string" || !placeId.trim())) throw new Error("Assisted replanning requirement has an invalid affected place.");
  if (typeof value.explanation !== "string" || !value.explanation.trim()) throw new Error("Assisted replanning requirement needs an explanation.");
  if (typeof value.suggestedRequest !== "string" || !value.suggestedRequest.trim()) throw new Error("Assisted replanning requirement needs a suggested request.");
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
  return {
    id: uniqueBlockId(baseId, usedIds),
    kind: sourceBlock?.kind && sourceBlock.kind !== "event" ? sourceBlock.kind : "stop",
    order: 0,
    placeId: stop.placeId,
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(sourceBlock?.title ? { title: sourceBlock.title } : {}),
    ...(sourceBlock?.summary ? { summary: sourceBlock.summary } : {}),
    ...(sourceBlock?.durationMinutes ? { durationMinutes: sourceBlock.durationMinutes } : {}),
    ...(role ? { role } : {}),
    evidence: sourceBlock ? [...sourceBlock.evidence] : []
  };
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
  const affectedDayIds = previousDay ? [previousDay.id] : [];
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
