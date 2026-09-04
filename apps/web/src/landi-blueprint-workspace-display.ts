import type { BlueprintItineraryBlock, BlueprintPlaceRelationship, BlueprintSchedulingEligibility, ItineraryDay, Plan, PlanPlace, PlanPresentation, PlanPresentationEvent, PlanRouteSegment, SourceReference, Task } from "@c-assistant/core";
import { groupPreparationItems } from "./plan-preparation-display.js";
import { displayTripTitle } from "./trip-title.js";

export type BlueprintWorkspaceArea = "itinerary" | "preparation" | "tips" | "sources";
export type GuideFilter = "all" | "attraction" | "dining" | "shopping" | "experience";
export type GuideState = "scheduled" | "unscheduled" | "informational";
export type GuideStateFilter = "all" | GuideState;

const blueprintWorkspaceAreas = ["itinerary", "preparation", "tips", "sources"] as const satisfies readonly BlueprintWorkspaceArea[];
const blueprintGuideFilters = ["attraction", "dining", "shopping", "experience"] as const satisfies readonly Exclude<GuideFilter, "all">[];

export type BlueprintWorkspaceDisplay = {
  title: string;
  dateLabel: string;
  initialDayId: string;
  initialPlaceId: string;
  areas: readonly BlueprintWorkspaceArea[];
  days: BlueprintDayTabDisplay[];
  places: BlueprintPlaceDisplay[];
  itineraries: ItineraryDayDisplay[];
  guideFilters: readonly Exclude<GuideFilter, "all">[];
  guideCards: GuideCardDisplay[];
  details: DetailPlaceDisplay[];
  preparationGroups: PreparationGroupDisplay[];
  tipGroups: TipGroupDisplay[];
  sources: SourceMarkerDisplay[];
};

export type BlueprintDayTabDisplay = {
  id: string;
  label: string;
  date?: string;
  shortLabel?: string;
  city?: string;
  title?: string;
};

export type BlueprintPlaceDisplay = {
  id: string;
  title: string;
  locationLabel: string;
  coordinates?: [number, number];
  markerType: GuideFilter;
  city?: string;
  area?: string;
  durationLabel?: string;
  schedulingEligibility?: BlueprintSchedulingEligibility;
  placementSignals: {
    reservation: "required" | "recommended" | "none";
    needsRecheck: boolean;
    longStop: boolean;
  };
};

type TimelineBlock = {
  day: BlueprintDayTabDisplay;
  place?: PlanPlace;
  block?: BlueprintItineraryBlock;
  order: number;
  timeLabel: string;
  type: GuideFilter;
  title?: string;
  meta?: string;
  reorderable?: boolean;
  status?: string;
  routeAfter?: PlanRouteSegment;
};

export type ItineraryCardDisplay = {
  kind: "block" | "pending";
  key: string;
  placeId: string;
  title: string;
  timeLabel: string;
  meta?: string;
  statusLabel?: string;
  reorderable?: boolean;
  editState?: "moved";
};

export type BlueprintMapPointDisplay = Pick<BlueprintPlaceDisplay, "id" | "title" | "coordinates"> & {
  placeId: string;
};

export type BlueprintRouteSegmentDisplay = {
  id: string;
  originPlaceId: string;
  destinationPlaceId: string;
  label: string;
  verification: PlanRouteSegment["verification"];
  durationLabel?: string;
  detail?: string;
  sources: SourceMarkerDisplay[];
};

export type BlueprintMapMarkerDisplay = {
  placeId: string;
  title: string;
  type: GuideFilter;
  coordinates?: [number, number];
  markerState: "context" | "on-day" | "pending";
};

export type ItineraryDayDisplay = {
  dayId: string;
  day: BlueprintDayTabDisplay;
  items: ItineraryCardDisplay[];
  placementOptions: ItineraryPlacementOption[];
  routePlaces: BlueprintMapPointDisplay[];
  routeSegments: BlueprintRouteSegmentDisplay[];
  markers: BlueprintMapMarkerDisplay[];
};

export type GuideCardDisplay = {
  placeId: string;
  title: string;
  type: GuideFilter;
  state: GuideState;
  summary: string;
  tags: string[];
  footerNote?: string;
  actionLabel?: string;
  canAdd: boolean;
  addBlockedReason?: string;
  timeline?: { dayId: string; label: string; timeLabel: string };
};

export type SourceMarkerDisplay = {
  label: string;
  summary: string;
  url?: string;
};

export type ComparisonRow = {
  id: string;
  name: string;
  area: string;
  routeFit: string;
  timing: string;
  effort: string;
  sourceState: string;
};

export type DetailLinkDisplay = {
  label: string;
  url: string;
};

export type DetailSectionDisplay = {
  title: string;
  body?: string;
  items?: string[];
};

export type DetailEventDisplay = {
  id: string;
  title: string;
  description: string;
  dateLabel?: string;
  locationLabel?: string;
  sources: SourceMarkerDisplay[];
};

export type DetailPlaceDisplay = {
  placeId: string;
  title: string;
  leadTitle: string;
  leadBody: string;
  planTitle?: string;
  planBody?: string;
  reservationNote?: string;
  detailSections: DetailSectionDisplay[];
  relatedEvents: DetailEventDisplay[];
  sources: SourceMarkerDisplay[];
  comparisonTitle?: string;
  comparisonRows: ComparisonRow[];
  primaryActionLabel: string;
  scheduled: boolean;
  canAdd: boolean;
  links: DetailLinkDisplay[];
};

export type TipDisplay = {
  id: string;
  title: string;
  body: string;
  context: string;
};

export type TipGroupDisplay = {
  theme: string;
  tips: TipDisplay[];
};

export type PreparationChecklistItemDisplay = {
  id: string;
  title: string;
  description?: string;
  checked: boolean;
};

export type PreparationGroupDisplay = {
  title: string;
  items: PreparationChecklistItemDisplay[];
};

export type ItineraryPlacementOption = {
  id: string;
  label: string;
  kind: "start" | "after" | "end";
  afterPlaceId?: string;
};

export type PendingItineraryEditPosition =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "after"; afterPlaceId: string };

export type PlacementAdvisory = {
  tone: "neutral" | "attention";
  text: string;
};

export type PendingItineraryEditDisplay = {
  kind: "add_place_to_day" | "move_place_within_day";
  placeId: string;
  placeName: string;
  dayId: string;
  dayLabel: string;
  positionId: string;
  positionLabel: string;
  position: PendingItineraryEditPosition;
  advisories: PlacementAdvisory[];
};

export function pendingItineraryEditRequest(edit: PendingItineraryEditDisplay): string {
  if (edit.kind === "move_place_within_day") return [
    "Apply this confirmed itinerary edit directly to the plan.",
    `Move ${edit.placeName} within ${edit.dayLabel}.`,
    `Placement: ${edit.positionLabel}.`,
    "Keep the place catalog unchanged and refresh affected route checks before execution."
  ].join(" ");
  return [
    "Apply this confirmed itinerary edit directly to the plan.",
    `Add ${edit.placeName} to ${edit.dayLabel}.`,
    `Placement: ${edit.positionLabel}.`,
    "Keep the existing day order unless route validation shows this placement should become flexible or move elsewhere.",
    "Check travel time, opening or booking constraints, and any source recheck notes before returning the updated complete plan."
  ].join(" ");
}

export function pendingItineraryEditBatchRequest(edits: PendingItineraryEditDisplay[]): string {
  if (edits.length === 1) return pendingItineraryEditRequest(edits[0]!);
  return [
    `Apply these ${edits.length} confirmed itinerary edits directly to the plan in one update.`,
    ...edits.map((edit, index) => `${index + 1}. ${edit.kind === "move_place_within_day" ? "Move" : "Add"} ${edit.placeName} ${edit.kind === "move_place_within_day" ? `within ${edit.dayLabel}` : `to ${edit.dayLabel}`}. Placement: ${edit.positionLabel}.`),
    "Keep existing day order unless route validation shows a placement should become flexible or move elsewhere.",
    "Check travel time, opening or booking constraints, city compatibility, and source recheck notes before returning the updated complete plan."
  ].join(" ");
}

export function buildBlueprintWorkspaceDisplay(plan: Plan, presentation: PlanPresentation): BlueprintWorkspaceDisplay {
  const tips = localTipsForPlan(plan);
  const itineraries = presentation.days.map((day) => itineraryDisplayForDay(presentation, day, plan.sources));
  return {
    title: displayTripTitle(presentation, plan.title),
    dateLabel: blueprintDateLabel(plan, presentation),
    initialDayId: presentation.days[0]?.id ?? "",
    initialPlaceId: presentation.days[0]?.placeIds[0] ?? presentation.places[0]?.id ?? "",
    areas: workspaceAreasForPresentation(presentation),
    days: presentation.days.map(dayTabForDay),
    places: presentation.places.map(placeDisplayForPlace),
    itineraries,
    guideFilters: blueprintGuideFilters,
    guideCards: guideCardsForPresentation(presentation, plan.sources),
    details: presentation.places.map((place) => detailDisplayForPlace(presentation, plan.sources, place)),
    preparationGroups: preparationGroupsForPlan(plan),
    tipGroups: groupTipsByTheme(tips),
    sources: sourceMarkersForPlan(plan)
  };
}

function placeDisplayForPlace(place: PlanPlace): BlueprintPlaceDisplay {
  return {
    id: place.id,
    title: displayPlaceName(place),
    locationLabel: place.locationLabel,
    ...(place.coordinates ? { coordinates: place.coordinates } : {}),
    markerType: markerTypeForPlace(place),
    ...(place.city ? { city: place.city } : {}),
    ...(place.area ? { area: place.area } : {}),
    ...(place.durationMinutes ? { durationLabel: `${place.durationMinutes} min` } : {}),
    ...(place.schedulingEligibility ? { schedulingEligibility: place.schedulingEligibility } : {}),
    placementSignals: {
      reservation: place.reservation?.requirement === "required" ? "required" : place.reservation?.requirement === "recommended" ? "recommended" : "none",
      needsRecheck: place.priority === "recheck" || place.reservation?.verification === "needs_recheck" || Boolean(place.evidenceSources?.some((source) => source.status && source.status !== "verified")),
      longStop: Boolean(place.durationMinutes && place.durationMinutes >= 180)
    }
  };
}

function mapPointForPlace(place: PlanPlace | BlueprintPlaceDisplay): BlueprintMapPointDisplay {
  return {
    id: place.id,
    placeId: place.id,
    title: "title" in place ? place.title : displayPlaceName(place),
    ...(place.coordinates ? { coordinates: place.coordinates } : {})
  };
}

function routeSegmentDisplayForSegment(segment: PlanRouteSegment, planSources: SourceReference[]): BlueprintRouteSegmentDisplay {
  return {
    id: segment.id,
    originPlaceId: segment.originPlaceId,
    destinationPlaceId: segment.destinationPlaceId,
    label: segment.label ?? "Movement",
    verification: segment.verification,
    ...(segment.durationMinutes ? { durationLabel: `${segment.durationMinutes} min` } : {}),
    ...(segment.detail ? { detail: segment.detail } : {}),
    sources: sourceSummariesForRefs(segment.sourceRefs, planSources)
  };
}

function dayTabForDay(day: ItineraryDay): BlueprintDayTabDisplay {
  return {
    id: day.id,
    label: day.label,
    ...(day.date ? { date: day.date } : {}),
    ...(day.shortLabel ? { shortLabel: day.shortLabel } : {}),
    ...(day.city ? { city: day.city } : {}),
    ...(day.title ? { title: day.title } : {})
  };
}

function guideTypeForPlace(place: Pick<PlanPlace, "category" | "visitRole" | "name" | "display">): GuideFilter {
  const explicit = place.display?.type;
  if (explicit) return explicit;
  const text = `${place.category} ${place.visitRole ?? ""} ${place.name}`.toLocaleLowerCase();
  if (/\b(experience|workshop|class|tour|show|performance|theatre|theater|festival|ceremony|onsen|spa|cruise|ride)\b/.test(text)) return "experience";
  if (/\b(restaurant|dining|food|meal|breakfast|lunch|dinner|cafe|coffee|tea|dessert|bar|market|izakaya|ramen|sushi|noodle|bakery)\b/.test(text)) return "dining";
  if (/\b(shopping|shop|store|mall|market|craft|souvenir|product|design|boutique|bookstore|department)\b/.test(text)) return "shopping";
  return "attraction";
}

function markerTypeForPlace(place: Pick<PlanPlace, "category" | "visitRole" | "name" | "display">): GuideFilter {
  return place.display?.markerKind ?? guideTypeForPlace(place);
}

function isGuidePlace(place: PlanPlace): boolean {
  const text = `${place.category} ${place.visitRole ?? ""} ${place.name}`.toLocaleLowerCase();
  return !/hotel|accommodation|lodg|\bairport\b|\bstation\b|\bflight\b|\brail\b|\btransfer\b|\btransport\b/.test(text);
}

function guideStateForPlace(place: PlanPlace, scheduledPlaceIds: Set<string>): GuideState {
  if (scheduledPlaceIds.has(place.id)) return "scheduled";
  if (place.schedulingEligibility?.decision === "informational") return "informational";
  const text = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/informational|theme|local food|local product|background|context/.test(text)) return "informational";
  return "unscheduled";
}

function timelineBlocksForDay(presentation: PlanPresentation, day: ItineraryDay): TimelineBlock[] {
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  const displayDay = dayTabForDay(day);
  if (day.blocks?.length) {
    return [...day.blocks].sort((left, right) => left.order - right.order).flatMap((block, index) => {
      const place = block.placeId ? placeById.get(block.placeId) : undefined;
      if (block.placeId && !place) return [];
      const routeAfter = place ? presentation.routeSegments.find((segment) => segment.dayId === day.id && segment.originPlaceId === place.id) : undefined;
      const status = place ? itineraryBlockStatus(place) : undefined;
      return [{
        day: displayDay,
        ...(place ? { place } : {}),
        block,
        order: block.order,
        timeLabel: roughBlockTimeLabel(block, place, index),
        type: place ? guideTypeForPlace(place) : blockGuideType(block),
        ...(blockTitle(block, place) ? { title: blockTitle(block, place)! } : {}),
        ...(blockMeta(block) ? { meta: blockMeta(block)! } : {}),
        ...(place && directMoveAllowed(place) ? { reorderable: true } : {}),
        ...(status ? { status } : {}),
        ...(routeAfter ? { routeAfter } : {})
      }];
    });
  }
  const stops: Array<{ placeId: string; order: number; time?: string; role?: string }> = day.stops?.length
    ? [...day.stops].sort((left, right) => left.order - right.order)
    : day.placeIds.map((placeId, index) => ({ placeId, order: index + 1 }));
  return stops.flatMap((stop, index) => {
    const place = placeById.get(stop.placeId);
    if (!place) return [];
    const routeAfter = presentation.routeSegments.find((segment) => segment.dayId === day.id && segment.originPlaceId === place.id);
    const status = itineraryBlockStatus(place);
    return [{
      day: displayDay,
      place,
      order: stop.order,
      timeLabel: roughTimeLabel(stop.time, stop.role, place, index),
      type: guideTypeForPlace(place),
      ...(directMoveAllowed(place) ? { reorderable: true } : {}),
      ...(status ? { status } : {}),
      ...(routeAfter ? { routeAfter } : {})
    }];
  });
}

function itineraryDisplayForDay(presentation: PlanPresentation, day: ItineraryDay, planSources: SourceReference[] = [], pendingEdit?: PendingItineraryEditDisplay | null): ItineraryDayDisplay {
  const blocks = timelineBlocksForDay(presentation, day);
  return itineraryDisplayFromBlocks(dayTabForDay(day), blocks, presentation.places, planSources, pendingEdit);
}

export function itineraryDisplayForWorkspace(workspace: BlueprintWorkspaceDisplay, dayId: string, pendingEdit?: PendingItineraryEditDisplay | PendingItineraryEditDisplay[] | null): ItineraryDayDisplay {
  const base = workspace.itineraries.find((candidate) => candidate.dayId === dayId) ?? workspace.itineraries[0];
  if (!base) return emptyItineraryDayDisplay();
  return itineraryDisplayWithPending(base, workspace.places, pendingEdit);
}

function itineraryDisplayFromBlocks(day: BlueprintDayTabDisplay, blocks: TimelineBlock[], places: PlanPlace[], planSources: SourceReference[], pendingEdit?: PendingItineraryEditDisplay | null): ItineraryDayDisplay {
  const base = {
    dayId: day.id,
    day,
    items: blocks.map((block) => itineraryCardForBlock(block)),
    placementOptions: itineraryPlacementOptions(blocks),
    routePlaces: blocks.flatMap((block) => block.place ? [mapPointForPlace(block.place)] : []),
    routeSegments: blocks.slice(0, -1).flatMap((block) => block.routeAfter ? [routeSegmentDisplayForSegment(block.routeAfter, planSources)] : []),
    markers: blocks.flatMap((block) => {
      const place = block.place;
      if (!place) return [];
      return {
        placeId: place.id,
        title: displayPlaceName(place),
        type: markerTypeForPlace(place),
        ...(place.coordinates ? { coordinates: place.coordinates } : {}),
        markerState: "on-day" as const
      };
    })
  };
  return itineraryDisplayWithPending(base, places.map(placeDisplayForPlace), pendingEdit);
}

function itineraryDisplayWithPending(base: ItineraryDayDisplay, places: BlueprintPlaceDisplay[], pendingEdit?: PendingItineraryEditDisplay | PendingItineraryEditDisplay[] | null): ItineraryDayDisplay {
  const edits = (Array.isArray(pendingEdit) ? pendingEdit : pendingEdit ? [pendingEdit] : []).filter((edit) => edit.dayId === base.dayId);
  if (!edits.length) return base;
  let items = base.items;
  const markers = [...base.markers];
  for (const edit of edits) {
    if (edit.kind === "move_place_within_day") {
      items = movePendingCard(items, edit);
      continue;
    }
    const pendingPlace = places.find((place) => place.id === edit.placeId);
    if (!pendingPlace) continue;
    items = insertPendingCard(items, itineraryCardForPendingPlace(pendingPlace, edit), edit.positionId);
    if (pendingPlace.coordinates && !markers.some((marker) => marker.placeId === pendingPlace.id)) {
      markers.push({
        placeId: pendingPlace.id,
        title: pendingPlace.title,
        type: pendingPlace.markerType,
        coordinates: pendingPlace.coordinates,
        markerState: "pending"
      });
    }
  }
  return { ...base, items, markers };
}

export function detailDisplayForWorkspacePlace(workspace: BlueprintWorkspaceDisplay, placeId: string): DetailPlaceDisplay | undefined {
  return workspace.details.find((detail) => detail.placeId === placeId);
}

export function scheduledDayIdForPlace(workspace: BlueprintWorkspaceDisplay, placeId: string): string | undefined {
  return workspace.itineraries.find((itinerary) => itinerary.items.some((item) => item.kind === "block" && item.placeId === placeId))?.dayId;
}

function guideCardsForPresentation(presentation: PlanPresentation, planSources: SourceReference[] = []): GuideCardDisplay[] {
  const scheduledPlaceIds = new Set(presentation.days.flatMap((day) => day.placeIds));
  const firstTimelineByPlace = new Map<string, GuideCardDisplay["timeline"]>();
  for (const day of presentation.days) {
    for (const block of timelineBlocksForDay(presentation, day)) {
      const place = block.place;
      if (!place || firstTimelineByPlace.has(place.id)) continue;
      firstTimelineByPlace.set(place.id, { dayId: day.id, label: day.shortLabel ?? day.date ?? day.label, timeLabel: block.timeLabel });
    }
  }
  return presentation.places
    .filter(isGuidePlace)
    .map((place) => {
      const state = guideStateForPlace(place, scheduledPlaceIds);
      return {
        placeId: place.id,
        title: displayPlaceName(place),
        type: guideTypeForPlace(place),
        state,
        summary: shortGuideSummary(place),
        tags: guideTags(place),
        ...guideCardAction(place, state, firstTimelineByPlace.get(place.id)),
        ...(firstTimelineByPlace.get(place.id) ? { timeline: firstTimelineByPlace.get(place.id)! } : {})
      };
    });
}

function detailDisplayForPlace(presentation: PlanPresentation, planSources: SourceReference[], place: PlanPlace): DetailPlaceDisplay {
  const type = guideTypeForPlace(place);
  const scheduledDay = presentation.days.find((day) => day.placeIds.includes(place.id));
  const comparisonRows = comparisonRowsForPlace(presentation, place);
  const comparisonHeading = comparisonRows.length && type !== "attraction" ? comparisonTitle(type) : undefined;
  const canAdd = !scheduledDay && directAddAllowed(place);
  return {
    placeId: place.id,
    title: displayPlaceName(place),
    leadTitle: detailLeadTitle(type),
    leadBody: place.whyWorthIt || place.plan,
    ...(place.plan ? { planTitle: detailPlanTitle(type), planBody: place.plan } : {}),
    ...(place.reservation?.note ? { reservationNote: place.reservation.note } : {}),
    detailSections: place.detailSections,
    relatedEvents: relatedEventsForPlace(presentation, planSources, place.id),
    sources: sourceSummariesForPlace(place, planSources),
    ...(comparisonHeading ? { comparisonTitle: comparisonHeading } : {}),
    comparisonRows: comparisonHeading ? comparisonRows : [],
    primaryActionLabel: scheduledDay ? "Show in itinerary" : canAdd ? "Add to itinerary" : addBlockedLabel(place),
    scheduled: Boolean(scheduledDay),
    canAdd,
    links: detailLinks(place)
  };
}

function comparisonRowsForPlace(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const graphRows = comparisonRowsFromRelationshipGraph(presentation, selectedPlace);
  if (graphRows.length) return graphRows;
  const selectedType = guideTypeForPlace(selectedPlace);
  return presentation.places
    .filter((place) => place.id !== selectedPlace.id && isGuidePlace(place) && guideTypeForPlace(place) === selectedType)
    .slice(0, 5)
    .map((place) => ({
      id: place.id,
      name: displayPlaceName(place),
      area: place.area ?? place.locationLabel,
      routeFit: routeFitLabel(place, selectedPlace),
      timing: timingLabel(place),
      effort: effortLabel(place),
      sourceState: sourceStateLabel(place)
    }));
}

function comparisonRowsFromRelationshipGraph(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const relationships = presentation.guideRelationshipGraph?.relationships ?? [];
  if (!relationships.length) return [];
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  return relationships
    .flatMap((relationship) => relatedPlaceForRelationship(relationship, selectedPlace.id))
    .flatMap(({ relationship, placeId }) => {
      const place = placeById.get(placeId);
      if (!place || !isGuidePlace(place)) return [];
      return [{
        id: place.id,
        name: displayPlaceName(place),
        area: place.area ?? place.locationLabel,
        routeFit: relationshipKindLabel(relationship.kind),
        timing: relationship.dayIds?.length ? relationship.dayIds.map((dayId) => dayLabelForId(presentation, dayId)).join(", ") : timingLabel(place),
        effort: relationship.rationale,
        sourceState: relationship.evidence.some((ref) => ref.status === "verified") ? "Verified relationship" : sourceStateLabel(place)
      }];
    })
    .slice(0, 5);
}

function relatedPlaceForRelationship(relationship: BlueprintPlaceRelationship, selectedPlaceId: string): Array<{ relationship: BlueprintPlaceRelationship; placeId: string }> {
  if (relationship.fromPlaceId === selectedPlaceId) return [{ relationship, placeId: relationship.toPlaceId }];
  if (relationship.toPlaceId === selectedPlaceId) return [{ relationship, placeId: relationship.fromPlaceId }];
  return [];
}

export function filterGuideCards(cards: GuideCardDisplay[], options: { type: GuideFilter; state?: GuideStateFilter }): GuideCardDisplay[] {
  return cards.filter((card) => {
    if (options.type !== "all" && card.type !== options.type) return false;
    if (options.state && options.state !== "all" && card.state !== options.state) return false;
    return true;
  });
}

function itineraryPlacementOptions(blocks: TimelineBlock[]): ItineraryPlacementOption[] {
  const placeBlocks = blocks.filter((block): block is TimelineBlock & { place: PlanPlace } => Boolean(block.place));
  return [
    { id: "start", label: "At the start of the day", kind: "start" },
    ...placeBlocks.map((block) => ({ id: `after-${block.place.id}`, label: `After ${displayPlaceName(block.place)}`, kind: "after" as const, afterPlaceId: block.place.id })),
    { id: "end", label: "At the end of the day", kind: "end" }
  ];
}

export function buildPendingItineraryEditForWorkspace(workspace: BlueprintWorkspaceDisplay, placeId: string, input: { dayId: string; positionId: string }): PendingItineraryEditDisplay {
  const place = workspace.places.find((candidate) => candidate.id === placeId);
  const requestedItinerary = workspace.itineraries.find((candidate) => candidate.dayId === input.dayId);
  const itinerary = place
    ? eligibleItineraryForPlace(workspace, place, requestedItinerary)
    : requestedItinerary ?? workspace.itineraries[0];
  const options = itinerary?.placementOptions ?? [];
  const position = options.find((option) => option.id === input.positionId) ?? options[options.length - 1];
  const dayLabel = itinerary ? itinerary.day.shortLabel ?? itinerary.day.date ?? itinerary.day.label : "the selected day";
  return {
    placeId: place?.id ?? placeId,
    kind: "add_place_to_day",
    placeName: place?.title ?? placeId,
    dayId: itinerary?.dayId ?? input.dayId,
    dayLabel,
    positionId: position?.id ?? input.positionId,
    positionLabel: position?.label ?? "At the end of the day",
    position: pendingEditPosition(position),
    advisories: place ? placementAdvisoriesForWorkspace(workspace, place, itinerary, position) : []
  };
}

export function buildPendingItineraryMoveForWorkspace(workspace: BlueprintWorkspaceDisplay, input: { dayId: string; placeId: string; position: PendingItineraryEditPosition }): PendingItineraryEditDisplay | undefined {
  const itinerary = workspace.itineraries.find((candidate) => candidate.dayId === input.dayId);
  const place = workspace.places.find((candidate) => candidate.id === input.placeId);
  if (!itinerary || !place || !itinerary.items.some((item) => item.placeId === input.placeId && item.reorderable)) return undefined;
  if (input.position.kind === "after" && input.position.afterPlaceId === input.placeId) return undefined;
  const currentOrder = itinerary.items.map((item) => item.placeId).filter(Boolean);
  const nextOrder = movePlaceOrder(currentOrder, input.placeId, input.position);
  if (nextOrder.join("\0") === currentOrder.join("\0")) return undefined;
  const dayLabel = itinerary.day.shortLabel ?? itinerary.day.date ?? itinerary.day.label;
  return {
    kind: "move_place_within_day",
    placeId: place.id,
    placeName: place.title,
    dayId: itinerary.dayId,
    dayLabel,
    positionId: positionIdForPendingPosition(input.position),
    positionLabel: positionLabelForPendingPosition(workspace, input.position),
    position: input.position,
    advisories: [{ tone: "neutral", text: "This day will need route and timing refresh after reordering." }]
  };
}

function eligibleItineraryForPlace(workspace: BlueprintWorkspaceDisplay, place: BlueprintPlaceDisplay, requested: ItineraryDayDisplay | undefined): ItineraryDayDisplay | undefined {
  if (requested && itineraryAllowsPlace(place, requested.dayId)) return requested;
  return workspace.itineraries.find((itinerary) => itineraryAllowsPlace(place, itinerary.dayId)) ?? workspace.itineraries[0];
}

function itineraryAllowsPlace(place: BlueprintPlaceDisplay, dayId: string): boolean {
  const eligibility = place.schedulingEligibility;
  if (!eligibility) return true;
  if (eligibility.blockedDayIds?.includes(dayId)) return false;
  return !eligibility.suitableDayIds?.length || eligibility.suitableDayIds.includes(dayId);
}

function pendingEditPosition(position: ItineraryPlacementOption | undefined): PendingItineraryEditPosition {
  if (position?.kind === "start") return { kind: "start" };
  if (position?.kind === "after" && position.afterPlaceId) return { kind: "after", afterPlaceId: position.afterPlaceId };
  return { kind: "end" };
}

function emptyItineraryDayDisplay(): ItineraryDayDisplay {
  return { dayId: "", day: { id: "", label: "" }, items: [], placementOptions: [], routePlaces: [], routeSegments: [], markers: [] };
}

function itineraryCardForPendingPlace(place: BlueprintPlaceDisplay, edit: PendingItineraryEditDisplay): ItineraryCardDisplay {
  return {
    kind: "pending",
    key: `pending-${edit.dayId}-${edit.placeId}-${edit.positionId}`,
    placeId: place.id,
    title: place.title,
    timeLabel: "Draft",
    meta: edit.positionLabel,
    statusLabel: "Not saved"
  };
}

function itineraryCardForBlock(block: TimelineBlock): ItineraryCardDisplay {
  return {
    kind: "block",
    key: `${block.day.id}-${block.place?.id ?? block.block?.id ?? block.order}-${block.order}`,
    placeId: block.place?.id ?? "",
    title: block.title ?? (block.place ? displayPlaceName(block.place) : "Flexible time"),
    timeLabel: block.timeLabel,
    ...(block.meta ? { meta: block.meta } : {}),
    ...(block.status ? { statusLabel: block.status } : {}),
    ...(block.place && block.reorderable ? { reorderable: true } : {})
  };
}

function insertPendingCard(items: ItineraryCardDisplay[], pending: ItineraryCardDisplay, positionId: string): ItineraryCardDisplay[] {
  if (positionId === "start") return [pending, ...items];
  const targetPlaceId = positionId.startsWith("after-") ? positionId.slice("after-".length) : "";
  const next: ItineraryCardDisplay[] = [];
  let inserted = false;
  for (const item of items) {
    next.push(item);
    if (targetPlaceId && item.placeId === targetPlaceId) {
      next.push(pending);
      inserted = true;
    }
  }
  if (!inserted) next.push(pending);
  return next;
}

function movePendingCard(items: ItineraryCardDisplay[], edit: PendingItineraryEditDisplay): ItineraryCardDisplay[] {
  const currentIndex = items.findIndex((item) => item.placeId === edit.placeId && item.kind === "block");
  if (currentIndex === -1) return items;
  const slotTimeLabels = items.map((item) => item.timeLabel);
  const moving = { ...items[currentIndex]!, statusLabel: "Not saved", editState: "moved" as const };
  const next = items.filter((_, index) => index !== currentIndex);
  const { position } = edit;
  let insertionIndex = 0;
  if (position.kind === "end") insertionIndex = next.length;
  if (position.kind === "after") {
    const afterIndex = next.findIndex((item) => item.placeId === position.afterPlaceId);
    insertionIndex = afterIndex === -1 ? next.length : afterIndex + 1;
  }
  return [...next.slice(0, insertionIndex), moving, ...next.slice(insertionIndex)]
    .map((item, index) => ({ ...item, timeLabel: slotTimeLabels[index] ?? item.timeLabel }));
}

function movePlaceOrder(placeIds: string[], placeId: string, position: PendingItineraryEditPosition): string[] {
  const next = placeIds.filter((candidate) => candidate !== placeId);
  let insertionIndex = 0;
  if (position.kind === "end") insertionIndex = next.length;
  if (position.kind === "after") {
    const afterIndex = next.indexOf(position.afterPlaceId);
    insertionIndex = afterIndex === -1 ? next.length : afterIndex + 1;
  }
  return [...next.slice(0, insertionIndex), placeId, ...next.slice(insertionIndex)];
}

function positionIdForPendingPosition(position: PendingItineraryEditPosition): string {
  if (position.kind === "start") return "start";
  if (position.kind === "end") return "end";
  return `after-${position.afterPlaceId}`;
}

function positionLabelForPendingPosition(workspace: BlueprintWorkspaceDisplay, position: PendingItineraryEditPosition): string {
  if (position.kind === "start") return "At the start of the day";
  if (position.kind === "end") return "At the end of the day";
  const place = workspace.places.find((candidate) => candidate.id === position.afterPlaceId);
  return `After ${place?.title ?? position.afterPlaceId}`;
}

function groupTipsByTheme(tips: TipDisplay[]): TipGroupDisplay[] {
  const groups = new Map<string, TipDisplay[]>();
  for (const tip of tips) {
    const theme = tipTheme(tip);
    groups.set(theme, [...(groups.get(theme) ?? []), tip]);
  }
  return [...groups].map(([theme, values]) => ({ theme, tips: values }));
}

function localTipsForPlan(plan: Pick<Plan, "stages" | "presentation" | "location">): TipDisplay[] {
  const placeTips = (plan.presentation?.places ?? []).flatMap((place) => {
    const body = place.tip?.trim();
    if (!body || !isDestinationRelevantTip(body)) return [];
    return [{
      id: `place-${place.id}`,
      title: tipTitle(body),
      body,
      context: [place.area, place.city, place.name].filter(Boolean).join(" · ")
    }];
  });
  const taskTips = plan.stages.flatMap((stage) => stage.tasks.flatMap((task) => {
    const text = `${task.title}. ${task.description ?? ""}`.trim();
    if (task.owner !== "assistant" || !/tip|custom|safety|payment|transport|etiquette|local|礼仪|安全|支付|交通|风俗/.test(`${stage.title} ${task.title}`.toLocaleLowerCase()) || !isDestinationRelevantTip(text)) return [];
    return [{ id: `task-${task.id}`, title: task.title, body: task.description ?? task.title, context: stage.title }];
  }));
  return uniqueTips([...placeTips, ...taskTips]).slice(0, 12);
}

function preparationItemsForPlan(plan: Plan): Array<{ task: Task; stageTitle: string }> {
  return plan.stages.flatMap((stage) => stage.tasks
    .filter((task) => task.owner === "user" && task.preparationCategory !== undefined && task.preparationCategory !== "not_applicable")
    .map((task) => ({ task, stageTitle: stage.title })));
}

function preparationGroupsForPlan(plan: Plan): PreparationGroupDisplay[] {
  return groupPreparationItems(preparationItemsForPlan(plan)).map((group) => ({
    title: group.title,
    items: group.items.map(({ task }) => ({
      id: task.id,
      title: task.title,
      ...(task.description ? { description: task.description } : {}),
      checked: task.status === "completed"
    }))
  }));
}

function roughTimeLabel(time: string | undefined, role: string | undefined, place: Pick<PlanPlace, "category" | "name" | "visitRole">, index: number): string {
  if (time && /^\d{2}:\d{2}$/.test(time)) return time;
  const text = `${role ?? ""} ${place.visitRole ?? ""} ${place.category} ${place.name}`.toLocaleLowerCase();
  if (/breakfast|morning meal/.test(text)) return "Breakfast window";
  if (/lunch|midday|noon/.test(text)) return "Around lunch";
  if (/dinner|supper/.test(text)) return "Dinner window";
  if (/night|evening|bar|show|performance/.test(text)) return "Optional evening";
  if (/shopping|shop|market|souvenir|product/.test(text)) return index < 2 ? "Late morning option" : "Flexible afternoon";
  if (/rest|buffer|free|flex/.test(text)) return index >= 3 ? "Flexible afternoon" : "Flexible time";
  if (index === 0) return "Morning";
  if (index === 1) return "Late morning";
  if (index === 2) return "Afternoon";
  return "Flexible afternoon";
}

function roughBlockTimeLabel(block: BlueprintItineraryBlock, place: PlanPlace | undefined, index: number): string {
  if (block.startTime && /^\d{2}:\d{2}$/.test(block.startTime)) return block.startTime;
  if (block.kind === "meal") return /dinner|evening/i.test(`${block.role ?? ""} ${block.title ?? ""}`) ? "Dinner window" : "Around lunch";
  if (block.kind === "rest") return "Rest window";
  if (block.kind === "transfer") return "Transfer";
  if (block.kind === "lodging") return "Hotel time";
  if (block.kind === "event") return "Event window";
  if (block.kind === "flexible") return index >= 3 ? "Flexible afternoon" : "Flexible time";
  return roughTimeLabel(block.startTime, block.role, place ?? { category: block.kind, name: block.title ?? block.kind }, index);
}

function blockGuideType(block: BlueprintItineraryBlock): GuideFilter {
  if (block.kind === "meal") return "dining";
  if (block.kind === "event") return "experience";
  return "attraction";
}

function blockTitle(block: BlueprintItineraryBlock, place: PlanPlace | undefined): string | undefined {
  if (place) return displayPlaceName(place);
  if (block.title?.trim()) return block.title;
  if (block.kind === "meal") return "Meal window";
  if (block.kind === "rest") return "Rest";
  if (block.kind === "transfer") return "Transfer";
  if (block.kind === "lodging") return "Hotel time";
  if (block.kind === "event") return "Timed event";
  if (block.kind === "flexible") return "Flexible time";
  return undefined;
}

function blockMeta(block: BlueprintItineraryBlock): string | undefined {
  return block.summary ?? block.role ?? (block.durationMinutes ? `${block.durationMinutes} min` : undefined);
}

function sourceSummariesForPlace(place: Pick<PlanPlace, "evidenceSources" | "sourceRefs">, planSources: SourceReference[]): SourceMarkerDisplay[] {
  const sources = [
    ...(place.evidenceSources?.map((evidence) => {
      return {
        label: "Source",
        summary: [evidence.title, evidence.role, evidence.supports?.slice(0, 2).join("; "), evidence.status && evidence.status !== "verified" ? "needs recheck" : undefined, evidence.checkedAt ? `checked ${evidence.checkedAt}` : undefined].filter(Boolean).join(" · "),
        url: evidence.url
      };
    }) ?? []),
    ...place.sourceRefs.flatMap((sourceUrl) => {
      const source = planSources.find((candidate) => candidate.url === sourceUrl);
      return [{ label: "Source", summary: source ? sourceReferenceSummary(source) : sourceUrl, url: sourceUrl }];
    })
  ];
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url ?? source.summary;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceSummariesForRefs(sourceRefs: string[] | undefined, planSources: SourceReference[]): SourceMarkerDisplay[] {
  return (sourceRefs ?? []).flatMap((sourceUrl) => {
    const source = planSources.find((candidate) => candidate.url === sourceUrl);
    return [{ label: "Source", summary: source ? sourceReferenceSummary(source) : sourceUrl, url: sourceUrl }];
  });
}

function sourceMarkersForPlan(plan: Plan): SourceMarkerDisplay[] {
  const fromPlan = plan.sources.map((source) => ({ label: "Source", summary: sourceReferenceSummary(source), url: source.url }));
  const fromPlaces = (plan.presentation?.places ?? []).flatMap((place) => place.evidenceSources?.map((source) => ({ label: "Source", summary: [source.title, source.role, source.status && source.status !== "verified" ? "needs recheck" : undefined, source.checkedAt ? `checked ${source.checkedAt}` : undefined].filter(Boolean).join(" · "), url: source.url })) ?? []);
  const fromEvents = (plan.presentation?.events ?? []).flatMap((event) => sourceSummariesForRefs(event.sourceRefs, plan.sources));
  const seen = new Set<string>();
  return [...fromPlan, ...fromPlaces, ...fromEvents].filter((source) => {
    const key = source.url ?? source.summary;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function displayPlaceName(place: Pick<PlanPlace, "name" | "localizedName">): string {
  return place.localizedName && place.localizedName !== place.name ? `${place.name} · ${place.localizedName}` : place.name;
}

function blueprintDateLabel(plan: Pick<Plan, "dates">, presentation: Pick<PlanPresentation, "startDate" | "endDate">): string {
  return presentation.startDate && presentation.endDate ? `${presentation.startDate} - ${presentation.endDate}` : plan.dates;
}

export function guideFilterLabel(filter: GuideFilter): string {
  return filter === "all" ? "All" : filter === "attraction" ? "Attractions" : filter === "dining" ? "Dining" : filter === "shopping" ? "Shopping" : "Experiences";
}

function workspaceAreasForPresentation(presentation: PlanPresentation): readonly BlueprintWorkspaceArea[] {
  const explicit = presentation.moduleIdentity?.enabledModules.map((module) => module.id).filter((id) => blueprintWorkspaceAreas.includes(id));
  return explicit?.length ? [...new Set(explicit)] : blueprintWorkspaceAreas;
}

function shortGuideSummary(place: PlanPlace): string {
  return shorten(firstUsefulSentence(place.plan) || firstUsefulSentence(place.whyWorthIt) || `${place.area ?? place.locationLabel}.`, 125);
}

function firstUsefulSentence(value: string): string {
  return value.split(/(?<=[.!?。！？])\s+/)[0]?.trim() ?? "";
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function guideTags(place: PlanPlace): string[] {
  return [place.durationMinutes ? `${place.durationMinutes} min` : undefined, place.reservation?.requirement === "required" ? "Reservation" : undefined].filter(Boolean) as string[];
}

function guideCardAction(place: PlanPlace, state: GuideState, timeline: GuideCardDisplay["timeline"]): Pick<GuideCardDisplay, "canAdd" | "actionLabel" | "footerNote" | "addBlockedReason"> {
  if (state === "unscheduled" && directAddAllowed(place)) return { canAdd: true, actionLabel: "Add" };
  if (state === "unscheduled") return { canAdd: false, footerNote: addBlockedLabel(place), addBlockedReason: addBlockedLabel(place) };
  if (state === "scheduled") return { canAdd: false, ...(timeline ? { footerNote: `${timeline.label} ${timeline.timeLabel}` } : {}) };
  return { canAdd: false };
}

function directAddAllowed(place: Pick<PlanPlace, "schedulingEligibility">): boolean {
  const decision = place.schedulingEligibility?.decision;
  return decision === undefined || decision === "schedulable";
}

function directMoveAllowed(place: Pick<PlanPlace, "priority" | "schedulingEligibility" | "reservation">): boolean {
  if (place.priority === "booked" || place.reservation?.requirement === "required") return false;
  const decision = place.schedulingEligibility?.decision;
  return decision === undefined || decision === "schedulable";
}

function addBlockedLabel(place: Pick<PlanPlace, "schedulingEligibility">): string {
  const decision = place.schedulingEligibility?.decision;
  if (decision === "high_impact") return "Needs replanning";
  if (decision === "blocked") return "Not for this plan";
  if (decision === "informational") return "Background note";
  return "Needs review";
}

function placementAdvisoriesForWorkspace(workspace: BlueprintWorkspaceDisplay, place: BlueprintPlaceDisplay, itinerary: ItineraryDayDisplay | undefined, position: ItineraryPlacementOption | undefined): PlacementAdvisory[] {
  const advisories: PlacementAdvisory[] = [];
  if (itinerary?.day.city && place.city && !sameText(itinerary.day.city, place.city)) {
    advisories.push({ tone: "attention", text: `This is in ${place.city}, while the selected day is centered on ${itinerary.day.city}.` });
  }
  if (place.placementSignals.reservation === "required") {
    advisories.push({ tone: "attention", text: "Reservation or timed entry should be checked before saving this placement." });
  } else if (place.placementSignals.reservation === "recommended") {
    advisories.push({ tone: "neutral", text: "Reservation may reduce friction for this stop." });
  }
  if (place.placementSignals.needsRecheck) {
    advisories.push({ tone: "attention", text: "Some details need recheck before this becomes execution-ready." });
  }
  if (place.placementSignals.longStop) {
    advisories.push({ tone: "attention", text: "This is a long stop, so day pacing may need adjustment." });
  }
  const routeAfter = position?.afterPlaceId ? itinerary?.routeSegments.find((segment) => segment.originPlaceId === position.afterPlaceId) : undefined;
  if (routeAfter?.verification === "stale" || routeAfter?.verification === "needs_verification") {
    advisories.push({ tone: "attention", text: "The nearby route context needs verification after placement changes." });
  }
  if (!advisories.length && workspace.days.length) advisories.push({ tone: "neutral", text: "Landi will check route fit and timing before saving this edit." });
  return advisories;
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function itineraryBlockStatus(place: PlanPlace): string | undefined {
  if (place.reservation?.requirement === "required") return "Reservation required";
  if (place.priority === "recheck" || place.reservation?.verification === "needs_recheck") return "Needs recheck";
  if (place.priority === "booked") return "Booked";
  return undefined;
}

function routeFitLabel(place: PlanPlace, selectedPlace: PlanPlace): string {
  if (place.area && selectedPlace.area && place.area === selectedPlace.area) return "Same area";
  if (place.city && selectedPlace.city && place.city === selectedPlace.city) return "Same city";
  return place.locationLabel;
}

function timingLabel(place: PlanPlace): string {
  if (place.reservation?.requirement === "required") return "Reserve ahead";
  if (place.reservation?.requirement === "recommended") return "Reservation useful";
  return place.durationMinutes ? `${place.durationMinutes} min` : "Flexible timing";
}

function effortLabel(place: PlanPlace): string {
  if (place.priority === "recheck") return "Recheck before use";
  if (place.bookingUrl || place.officialUrl) return "Official link saved";
  if (place.mapUrl) return "Map link saved";
  return place.area ?? "Review details";
}

function sourceStateLabel(place: PlanPlace): string {
  if (place.evidenceSources?.some((source) => source.status === "verified")) return "Verified source";
  if (place.evidenceSources?.length || place.sourceRefs.length) return "Referenced";
  return "No source listed";
}

function relationshipKindLabel(kind: BlueprintPlaceRelationship["kind"]): string {
  switch (kind) {
    case "same_area": return "Same area";
    case "same_direction": return "Same direction";
    case "alternative": return "Alternative";
    case "supports_anchor": return "Supports main stop";
    case "meal_support": return "Meal support";
    case "rainy_day_alternative": return "Rain option";
    case "low_energy_alternative": return "Low-energy option";
    case "event_link": return "Event link";
    case "similar": return "Similar fit";
  }
}

function dayLabelForId(presentation: PlanPresentation, dayId: string): string {
  const day = presentation.days.find((candidate) => candidate.id === dayId);
  return day?.shortLabel ?? day?.date ?? day?.label ?? dayId;
}

function sourceReferenceSummary(source: SourceReference): string {
  return [source.title, source.authority, source.retrievedAt].filter(Boolean).join(" · ") || source.url;
}

function tipTheme(tip: Pick<TipDisplay, "title" | "body">): string {
  const text = `${tip.title} ${tip.body}`.toLocaleLowerCase();
  if (/payment|cash|card|tax|支付|现金/.test(text)) return "Payment";
  if (/transport|taxi|metro|train|bus|交通|地铁|电车/.test(text)) return "Transport";
  if (/temple|shrine|etiquette|custom|礼仪|风俗|寺|神社/.test(text)) return "Etiquette";
  if (/safety|safe|scam|risk|安全|诈骗/.test(text)) return "Safety";
  if (/weather|dress|rain|heat|cold|天气|穿|雨/.test(text)) return "Weather";
  if (/reservation|queue|opening|hours|预约|排队|营业/.test(text)) return "Timing";
  if (/language|phrase|translation|语言/.test(text)) return "Language";
  return "Local norms";
}

function isDestinationRelevantTip(value: string): boolean {
  const text = value.toLocaleLowerCase();
  if (/rest early|stay positive|enjoy the journey|take photos|have fun|relax and enjoy/.test(text)) return false;
  return /local|custom|etiquette|safety|safe|scam|payment|cash|card|transport|taxi|metro|train|bus|weather|dress|temple|shrine|market|queue|reservation|opening|hours|passport|visa|entry|neighborhood|area|language|tip|礼仪|安全|支付|现金|交通|天气|寺|神社|市场|排队|预约|营业|签证|入境/.test(text);
}

function tipTitle(value: string): string {
  const first = firstUsefulSentence(value).replace(/[:：].*$/, "").trim();
  return shorten(first || "Local tip", 54);
}

function detailLeadTitle(type: GuideFilter): string {
  return type === "dining" ? "What to eat" : type === "shopping" ? "What to buy" : type === "experience" ? "Experience fit" : "Why it matters";
}

function detailPlanTitle(type: GuideFilter): string {
  return type === "dining" ? "Meal context" : type === "shopping" ? "Purchase context" : type === "experience" ? "How it works" : "Visit style";
}

function comparisonTitle(type: GuideFilter): string {
  return type === "dining" ? "Compare dining nearby" : type === "shopping" ? "Compare shopping options" : "Compare experience options";
}

function relatedEventsForPlace(presentation: PlanPresentation, planSources: SourceReference[], placeId: string): DetailEventDisplay[] {
  return (presentation.events ?? [])
    .filter((event) => event.placeId === placeId)
    .map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      ...(eventDateLabel(event) ? { dateLabel: eventDateLabel(event)! } : {}),
      ...(event.locationLabel ? { locationLabel: event.locationLabel } : {}),
      sources: sourceSummariesForRefs(event.sourceRefs, planSources)
    }));
}

function eventDateLabel(event: Pick<PlanPresentationEvent, "startDate" | "endDate">): string | undefined {
  if (event.startDate && event.endDate && event.startDate !== event.endDate) return `${event.startDate} - ${event.endDate}`;
  return event.startDate ?? event.endDate;
}

function detailLinks(place: Pick<PlanPlace, "bookingUrl" | "experienceUrl" | "mapUrl" | "officialUrl">): DetailLinkDisplay[] {
  return [
    place.officialUrl ? { label: "Official site", url: place.officialUrl } : undefined,
    place.mapUrl ? { label: "Map link", url: place.mapUrl } : undefined,
    place.bookingUrl ? { label: "Booking link", url: place.bookingUrl } : undefined,
    place.experienceUrl ? { label: "Experience link", url: place.experienceUrl } : undefined
  ].filter(Boolean) as DetailLinkDisplay[];
}

function uniqueTips(tips: TipDisplay[]): TipDisplay[] {
  const seen = new Set<string>();
  return tips.filter((tip) => {
    const key = tip.body.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
