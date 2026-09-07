import { assertTripBlueprintIntegrity, type BlueprintItineraryBlock, type BlueprintItineraryDay, type BlueprintMovement, type BlueprintMovementMode, type BlueprintPlace, type BlueprintStop, type TripBlueprint } from "./trip-blueprint.js";

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
  };

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
  undo: {
    dayId: string;
    previousDay: BlueprintItineraryDay;
    previousMovements: BlueprintMovement[];
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
  undo: {
    previousBlueprintVersion: number;
    previousDays: BlueprintItineraryDay[];
    previousMovements: BlueprintMovement[];
  };
  revisions: DirectBlueprintRevisionMetadata[];
}

export interface DirectBlueprintRevisionBatchResult {
  blueprint: TripBlueprint;
  metadata: DirectBlueprintRevisionBatchMetadata;
}

export function applyDirectBlueprintRevision(blueprint: TripBlueprint, revision: DirectBlueprintRevision): TripBlueprint {
  return applyDirectBlueprintRevisionWithMetadata(blueprint, revision).blueprint;
}

export function applyDirectBlueprintRevisionWithMetadata(blueprint: TripBlueprint, revision: DirectBlueprintRevision): DirectBlueprintRevisionResult {
  assertTripBlueprintIntegrity(blueprint);
  if (!Number.isFinite(Date.parse(revision.createdAt))) throw new Error("Blueprint Revision needs a valid creation time.");
  if (revision.kind === "add_place_to_day") return addPlaceToDay(blueprint, revision);
  if (revision.kind === "move_place_within_day") return movePlaceWithinDay(blueprint, revision);
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
  const currentMovements = current.movements.filter((movement) => affectedDayIds.includes(movement.dayId));
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
        dayIds: affectedDayIds,
        movementIds: currentMovements.map((movement) => movement.id),
        reason: "These itinerary days were edited directly, so affected route, timing, meal, and opening constraints need refresh before execution."
      },
      undo: {
        previousBlueprintVersion: original.version,
        previousDays,
        previousMovements
      },
      revisions: revisionMetadataItems
    }
  };
}

function addPlaceToDay(blueprint: TripBlueprint, revision: Extract<DirectBlueprintRevision, { kind: "add_place_to_day" }>): DirectBlueprintRevisionResult {
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
  if (place.priority === "booked" || hasReservationRequirement(blueprint, revision.placeId)) throw new Error(`Place ${revision.placeId} is fixed by a booking and cannot be moved directly.`);
  const eligibility = place.schedulingEligibility;
  if (eligibility?.decision === "informational" || eligibility?.decision === "blocked" || eligibility?.decision === "high_impact") throw new Error(`Place ${revision.placeId} needs assisted replanning before moving.`);
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

function blocksForDirectRevision(
  dayId: string,
  previousBlocks: BlueprintItineraryBlock[] | undefined,
  previousStops: BlueprintStop[],
  nextStops: BlueprintStop[],
  revision: DirectBlueprintRevision
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

function isRouteBlockForStops(block: BlueprintItineraryBlock, stopIds: Set<string>): boolean {
  return Boolean(block.placeId && stopIds.has(block.placeId) && block.kind !== "event");
}

function shouldDropNewlyScheduledNonRouteBlock(block: BlueprintItineraryBlock, previousStopIds: Set<string>, nextStopIds: Set<string>, revisedPlaceId: string): boolean {
  return Boolean(block.placeId && block.placeId === revisedPlaceId && !previousStopIds.has(block.placeId) && nextStopIds.has(block.placeId));
}

function isDirectRouteSlotTemplate(block: BlueprintItineraryBlock, previousStopIds: Set<string>): boolean {
  return isRouteBlockForStops(block, previousStopIds) || block.id.startsWith("__direct-route-slot-");
}

function insertRouteSlotTemplate(
  dayId: string,
  blocks: BlueprintItineraryBlock[],
  previousStopIds: Set<string>,
  revision: DirectBlueprintRevision
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
  revision: DirectBlueprintRevision,
  previousDay: BlueprintItineraryDay,
  previousMovements: BlueprintMovement[]
): DirectBlueprintRevisionMetadata {
  const nextDay = after.days.find((day) => day.id === revision.dayId);
  const nextMovements = after.movements.filter((movement) => movement.dayId === revision.dayId);
  const affectedPlaceIds = uniqueStrings([
    revision.placeId,
    ...(revision.position.kind === "after" ? [revision.position.afterPlaceId] : []),
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
    undo: {
      dayId: revision.dayId,
      previousDay,
      previousMovements
    }
  };
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
