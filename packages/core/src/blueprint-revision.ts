import { assertTripBlueprintIntegrity, type BlueprintItineraryBlock, type BlueprintMovement, type BlueprintStop, type TripBlueprint } from "./trip-blueprint.js";

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
  };

export function applyDirectBlueprintRevision(blueprint: TripBlueprint, revision: DirectBlueprintRevision): TripBlueprint {
  assertTripBlueprintIntegrity(blueprint);
  if (!Number.isFinite(Date.parse(revision.createdAt))) throw new Error("Blueprint Revision needs a valid creation time.");
  if (revision.kind === "add_place_to_day") return addPlaceToDay(blueprint, revision);
  if (revision.kind === "move_place_within_day") return movePlaceWithinDay(blueprint, revision);
  throw new Error("Unsupported Blueprint Revision.");
}

function addPlaceToDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "add_place_to_day" }>): TripBlueprint {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new Error(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new Error(`Blueprint Revision references unknown day ${revision.dayId}.`);
  if (day.stops.some((stop) => stop.placeId === revision.placeId)) throw new Error(`Place ${revision.placeId} is already scheduled on day ${revision.dayId}.`);
  const eligibility = place.schedulingEligibility;
  if (eligibility?.decision === "informational") throw new Error(`Place ${revision.placeId} is informational and cannot be inserted directly.`);
  if (eligibility?.decision === "blocked") throw new Error(`Place ${revision.placeId} is blocked for direct scheduling.`);
  if (eligibility?.decision === "high_impact") throw new Error(`Place ${revision.placeId} needs assisted replanning before scheduling.`);
  if (eligibility?.suitableDayIds?.length && !eligibility.suitableDayIds.includes(revision.dayId)) throw new Error(`Place ${revision.placeId} is not eligible for day ${revision.dayId}.`);

  const nextStops = insertStop(day.stops, revision);
  const nextDays = blueprint.days.map((candidate) => candidate.id === day.id
    ? {
      ...candidate,
      stops: nextStops,
      blocks: blocksForStops(candidate.id, nextStops),
      candidatePlaceIds: candidate.candidatePlaceIds.filter((id) => id !== revision.placeId)
    }
    : candidate);
  const nextMovements = [
    ...blueprint.movements.filter((movement) => movement.dayId !== day.id),
    ...movementsForStops(day.id, nextStops)
  ];
  const next: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    days: nextDays,
    movements: nextMovements,
    createdAt: revision.createdAt
  };
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return next;
}

function movePlaceWithinDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "move_place_within_day" }>): TripBlueprint {
  const place = blueprint.places.find((candidate) => candidate.id === revision.placeId);
  if (!place) throw new Error(`Blueprint Revision references unknown place ${revision.placeId}.`);
  const day = blueprint.days.find((candidate) => candidate.id === revision.dayId);
  if (!day) throw new Error(`Blueprint Revision references unknown day ${revision.dayId}.`);
  const stop = day.stops.find((candidate) => candidate.placeId === revision.placeId);
  if (!stop) throw new Error(`Place ${revision.placeId} is not scheduled on day ${revision.dayId}.`);
  if (place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId)) throw new Error(`Place ${revision.placeId} is fixed by a booking and cannot be moved directly.`);
  const eligibility = place.schedulingEligibility;
  if (eligibility?.decision === "informational" || eligibility?.decision === "blocked" || eligibility?.decision === "high_impact") throw new Error(`Place ${revision.placeId} needs assisted replanning before moving.`);
  if (revision.position.kind === "after" && revision.position.afterPlaceId === revision.placeId) throw new Error("Blueprint Revision cannot move a place after itself.");

  const nextStops = moveStop(day.stops, revision);
  const nextDays = blueprint.days.map((candidate) => candidate.id === day.id
    ? {
      ...candidate,
      stops: nextStops,
      blocks: blocksForStops(candidate.id, nextStops)
    }
    : candidate);
  const nextMovements = [
    ...blueprint.movements.filter((movement) => movement.dayId !== day.id),
    ...movementsForStops(day.id, nextStops)
  ];
  const next: TripBlueprint = {
    ...structuredClone(blueprint),
    version: blueprint.version + 1,
    days: nextDays,
    movements: nextMovements,
    createdAt: revision.createdAt
  };
  assertTripBlueprintIntegrity(next, { expectedResearchPlaceIds: blueprint.places.map((candidate) => candidate.id) });
  return next;
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

function hasReservationRequirement(blueprint: TripBlueprint, placeId: string): boolean {
  return blueprint.actionRequirements.some((requirement) => requirement.placeId === placeId && requirement.kind === "reservation");
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

function movementsForStops(dayId: string, stops: BlueprintStop[]): BlueprintMovement[] {
  return stops.slice(0, -1).map((stop, index) => ({
    id: `movement-${dayId}-${index + 1}`,
    dayId,
    originPlaceId: stop.placeId,
    destinationPlaceId: stops[index + 1]!.placeId,
    mode: "unknown",
    status: "recheck",
    label: "Route needs refresh",
    detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.",
    evidence: []
  }));
}
