import type { BlueprintEvidenceRef, BlueprintItineraryBlock, BlueprintPlaceRelationship, BlueprintPreparationGroup, BlueprintSchedulingEligibility, BlueprintSource, BlueprintTravelTipTheme, DirectBlueprintRevisionBatchMetadata, ItineraryDay, Plan, PlanPlace, PlanPlacePriority, PlanPresentation, PlanPresentationEvent, PlanRouteSegment, SourceReference, Task } from "@c-assistant/core";
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
  priority: PlanPlacePriority;
  priorityLabel: string;
  schedulingEligibility?: BlueprintSchedulingEligibility;
  placementSignals: {
    reservation: "required" | "recommended" | "none";
    needsRecheck: boolean;
    longStop: boolean;
  };
  contextualTip?: string;
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
  routeAnchor?: boolean;
  reorderable?: boolean;
  status?: string;
  routeAfter?: PlanRouteSegment;
  contextualTip?: string;
};

export type ItineraryCardDisplay = {
  kind: "block" | "pending";
  key: string;
  placeId: string;
  title: string;
  timeLabel: string;
  meta?: string;
  statusLabel?: string;
  routeStatusLabel?: string;
  routeAnchor?: boolean;
  reorderable?: boolean;
  editState?: "moved";
  draftActionLabel?: string;
  contextualTip?: string;
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
  needsRefresh: boolean;
  mapLineState: "formal" | "needs_refresh" | "reference";
  refreshReason?: string;
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
  priority: PlanPlacePriority;
};

export type ItineraryDayDisplay = {
  dayId: string;
  day: BlueprintDayTabDisplay;
  items: ItineraryCardDisplay[];
  placementOptions: ItineraryPlacementOption[];
  routePlaces: BlueprintMapPointDisplay[];
  routeSegments: BlueprintRouteSegmentDisplay[];
  routeRefresh?: ItineraryRouteRefreshDisplay;
  markers: BlueprintMapMarkerDisplay[];
};

export type ItineraryRouteRefreshDisplay = {
  segmentCount: number;
  segmentIds: string[];
  dayLabel: string;
  summary: string;
  impactNotes?: string[];
  request: string;
  actionable?: boolean;
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
  draftActionLabel?: string;
  priorityLabel: string;
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
  priority: PlanPlacePriority;
  priorityLabel: string;
  priorityActions: PlacePriorityActionDisplay[];
  priorityBlockedNote?: string;
  leadTitle: string;
  leadBody: string;
  planTitle?: string;
  planBody?: string;
  reservationNote?: string;
  detailSections: DetailSectionDisplay[];
  relatedEvents: DetailEventDisplay[];
  sources: SourceMarkerDisplay[];
  sourceTitle?: string;
  comparisonTitle?: string;
  comparisonRows: ComparisonRow[];
  primaryActionLabel: string;
  scheduled: boolean;
  canAdd: boolean;
  canRemoveFromDay: boolean;
  itineraryDraftNote?: string;
  draftActionLabel?: string;
  removeActionLabel?: string;
  removeBlockedReason?: string;
  links: DetailLinkDisplay[];
};

export type PlacePriorityActionDisplay = {
  priority: PlanPlacePriority;
  label: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

export type TipDisplay = {
  id: string;
  title: string;
  body: string;
  context: string;
  theme?: BlueprintTravelTipTheme;
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
  kind: "add_place_to_day" | "move_place_within_day" | "remove_place_from_day";
  placeId: string;
  placeName: string;
  dayId: string;
  dayLabel: string;
  positionId?: string;
  positionLabel?: string;
  position?: PendingItineraryEditPosition;
  advisories: PlacementAdvisory[];
};

export type PendingItineraryDraftSummary = {
  changeLabel: string;
  affectedDayLabel: string;
};

export type AppliedItineraryRevisionSummary = {
  updateLabel: string;
  affectedDayLabel: string;
  routeRefreshLabel: string;
  statusText: string;
};

export function mergePendingItineraryEdit(current: PendingItineraryEditDisplay[], edit: PendingItineraryEditDisplay): PendingItineraryEditDisplay[] {
  const existingIndex = current.findIndex((candidate) => samePendingItineraryEditTarget(candidate, edit));
  if (existingIndex === -1) return [...current, edit];
  return current.map((candidate, index) => index === existingIndex ? edit : candidate);
}

export function compactPendingItineraryEdits(edits: PendingItineraryEditDisplay[]): PendingItineraryEditDisplay[] {
  return edits.reduce<PendingItineraryEditDisplay[]>((next, edit) => mergePendingItineraryEdit(next, edit), []);
}

export function guideCardsForWorkspace(workspace: BlueprintWorkspaceDisplay, pendingEdits: PendingItineraryEditDisplay[] = []): GuideCardDisplay[] {
  if (!pendingEdits.length) return workspace.guideCards;
  return workspace.guideCards.map((card) => guideCardWithPendingItineraryEdit(card, pendingItineraryEditForPlace(pendingEdits, card.placeId)));
}

export function detailDisplayForWorkspacePlace(workspace: BlueprintWorkspaceDisplay, placeId: string, pendingEdits: PendingItineraryEditDisplay[] = []): DetailPlaceDisplay | undefined {
  const detail = workspace.details.find((candidate) => candidate.placeId === placeId);
  if (!detail) return undefined;
  return detailWithPendingItineraryEdit(detail, pendingItineraryEditForPlace(pendingEdits, placeId));
}

export function pendingItineraryDraftSummary(edits: PendingItineraryEditDisplay[]): PendingItineraryDraftSummary {
  const compactEdits = compactPendingItineraryEdits(edits);
  const affectedDays = [...new Map(compactEdits.map((edit) => [edit.dayId, edit.dayLabel])).values()];
  const changeLabel = `${compactEdits.length} unsaved change${compactEdits.length === 1 ? "" : "s"}`;
  const affectedDayLabel = affectedDays.length ? affectedDays.join(", ") : "No affected days";
  return { changeLabel, affectedDayLabel };
}

export function appliedItineraryRevisionSummary(revision: DirectBlueprintRevisionBatchMetadata, presentation?: PlanPresentation): AppliedItineraryRevisionSummary {
  const dayById = new Map((presentation?.days ?? []).map((day) => [day.id, day.shortLabel ?? day.date ?? day.label ?? day.id]));
  const affectedDayLabels = revision.affectedDayIds.map((dayId) => dayById.get(dayId) ?? dayId);
  const affectedDayLabel = affectedDayLabels.length ? affectedDayLabels.join(", ") : "No affected days";
  const updateLabel = `${revision.revisionCount} itinerary update${revision.revisionCount === 1 ? "" : "s"}`;
  const routeCount = new Set(revision.routeRefresh.movementIds).size;
  const routeRefreshLabel = routeCount
    ? `${routeCount} route leg${routeCount === 1 ? "" : "s"} need${routeCount === 1 ? "s" : ""} refresh`
    : "No route legs need refresh";
  const impactReviewLabel = appliedItineraryImpactReviewLabel(revision);
  return {
    updateLabel,
    affectedDayLabel,
    routeRefreshLabel,
    statusText: `Applied ${updateLabel} for ${affectedDayLabel}. ${routeRefreshLabel}${impactReviewLabel ? `; ${impactReviewLabel}` : ""}.`
  };
}

function appliedItineraryImpactReviewLabel(revision: DirectBlueprintRevisionBatchMetadata): string {
  const impactDays = revision.routeImpact?.days ?? [];
  if (!impactDays.length) return "";
  if (revision.replanReadiness?.status === "assisted_replanning_required") return "assisted replanning is required before execution";
  const reviewLabels = [
    impactDays.some((day) => day.requiresTimingReview) ? "timing" : "",
    impactDays.some((day) => day.requiresMealRestSpacingReview) ? "meal/rest spacing" : "",
    impactDays.some((day) => day.capacityRisk) ? "day pacing" : "",
    impactDays.some((day) => day.backtrackingRisk) ? "backtracking" : "",
    impactDays.some((day) => day.fixedTimeRisk) ? "fixed time slots" : ""
  ].filter(Boolean);
  if (!reviewLabels.length) return "";
  return `review ${reviewLabels.join(", ")} before execution`;
}

export function pendingItineraryEditRequest(edit: PendingItineraryEditDisplay): string {
  if (edit.kind === "remove_place_from_day") return [
    "Apply this confirmed itinerary edit directly to the plan.",
    `Remove ${edit.placeName} from ${edit.dayLabel}.`,
    "Keep the place available in the guide for later planning.",
    "Refresh affected route, timing, meal, and opening constraints before execution."
  ].join(" ");
  if (edit.kind === "move_place_within_day") return [
    "Apply this confirmed itinerary edit directly to the plan.",
    `Move ${edit.placeName} within ${edit.dayLabel}.`,
    `Placement: ${edit.positionLabel ?? "Updated day order"}.`,
    "Keep the place catalog unchanged and refresh affected route checks before execution."
  ].join(" ");
  return [
    "Apply this confirmed itinerary edit directly to the plan.",
    `Add ${edit.placeName} to ${edit.dayLabel}.`,
    `Placement: ${edit.positionLabel ?? "At the end of the day"}.`,
    "Keep the existing day order unless route validation shows this placement should become flexible or move elsewhere.",
    "Check travel time, opening or booking constraints, and any source recheck notes before returning the updated complete plan."
  ].join(" ");
}

export function pendingItineraryEditBatchRequest(edits: PendingItineraryEditDisplay[]): string {
  const compactEdits = compactPendingItineraryEdits(edits);
  if (compactEdits.length === 1) return pendingItineraryEditRequest(compactEdits[0]!);
  return [
    `Apply these ${compactEdits.length} confirmed itinerary edits directly to the plan in one update.`,
    ...compactEdits.map((edit, index) => {
      if (edit.kind === "remove_place_from_day") return `${index + 1}. Remove ${edit.placeName} from ${edit.dayLabel}.`;
      return `${index + 1}. ${edit.kind === "move_place_within_day" ? "Move" : "Add"} ${edit.placeName} ${edit.kind === "move_place_within_day" ? `within ${edit.dayLabel}` : `to ${edit.dayLabel}`}. Placement: ${edit.positionLabel ?? "At the end of the day"}.`;
    }),
    "Keep existing day order unless route validation shows a placement should become flexible or move elsewhere.",
    "Check travel time, opening or booking constraints, city compatibility, and source recheck notes before returning the updated complete plan."
  ].join(" ");
}

export function buildBlueprintWorkspaceDisplay(plan: Plan, presentation: PlanPresentation): BlueprintWorkspaceDisplay {
  const tips = tipsForPresentation(plan, presentation);
  const itineraries = presentation.days.map((day) => itineraryDisplayForDay(presentation, day, plan.sources));
  return {
    title: displayTripTitle(presentation, plan.title),
    dateLabel: blueprintDateLabel(plan, presentation),
    initialDayId: presentation.days[0]?.id ?? "",
    initialPlaceId: presentation.days[0]?.placeIds[0] ?? presentation.places[0]?.id ?? "",
    areas: workspaceAreasForPresentation(presentation),
    days: presentation.days.map(dayTabForDay),
    places: presentation.places.map((place) => placeDisplayForPlace(place, presentation.travelTips)),
    itineraries,
    guideFilters: blueprintGuideFilters,
    guideCards: guideCardsForPresentation(presentation, plan.sources),
    details: presentation.places.map((place) => detailDisplayForPlace(presentation, plan.sources, place)),
    preparationGroups: preparationGroupsForPresentation(plan, presentation),
    tipGroups: groupTipsByTheme(tips),
    sources: sourceMarkersForPlan(plan, presentation)
  };
}

function placeDisplayForPlace(place: PlanPlace, travelTips: PlanPresentation["travelTips"] = []): BlueprintPlaceDisplay {
  const signals = workspaceSignalsForPlace(place);
  const contextualTip = contextualTipForPlace(place, travelTips);
  return {
    id: place.id,
    title: displayPlaceName(place),
    locationLabel: place.locationLabel,
    ...(place.coordinates ? { coordinates: place.coordinates } : {}),
    markerType: markerTypeForPlace(place),
    ...(place.city ? { city: place.city } : {}),
    ...(place.area ? { area: place.area } : {}),
    ...(place.durationMinutes ? { durationLabel: `${place.durationMinutes} min` } : {}),
    priority: place.priority,
    priorityLabel: placePriorityLabel(place.priority),
    ...(place.schedulingEligibility ? { schedulingEligibility: place.schedulingEligibility } : {}),
    placementSignals: signals,
    ...(contextualTip ? { contextualTip } : {})
  };
}

function workspaceSignalsForPlace(place: PlanPlace): BlueprintPlaceDisplay["placementSignals"] {
  const explicit = place.display?.workspaceSignals;
  if (explicit) {
    return {
      reservation: explicit.reservation,
      needsRecheck: explicit.needsRecheck,
      longStop: explicit.longStop
    };
  }
  return {
    reservation: place.reservation?.requirement === "required" ? "required" : place.reservation?.requirement === "recommended" ? "recommended" : "none",
    needsRecheck: place.priority === "recheck" || place.reservation?.verification === "needs_recheck" || Boolean(place.evidenceSources?.some((source) => source.status && source.status !== "verified")),
    longStop: Boolean(place.durationMinutes && place.durationMinutes >= 180)
  };
}

function contextualTipForPlace(place: PlanPlace, travelTips: PlanPresentation["travelTips"] = [], context: { dayId?: string; blockId?: string } = {}): string | undefined {
  const placeTips = travelTips.filter((tip) => tip.placeId === place.id || (context.blockId && tip.blockId === context.blockId));
  const matchingTip = placeTips.find((tip) => context.blockId && tip.blockId === context.blockId)
    ?? placeTips.find((tip) => context.dayId && tip.dayId === context.dayId)
    ?? placeTips.find((tip) => !tip.dayId && !tip.blockId)
    ?? placeTips[0];
  const tipText = matchingTip?.body || place.tip || place.reservation?.note || workspaceSignalTip(workspaceSignalsForPlace(place));
  const sentence = tipText ? firstUsefulSentence(tipText) || tipText.trim() : "";
  return sentence ? shorten(sentence, 118) : undefined;
}

function workspaceSignalTip(signals: BlueprintPlaceDisplay["placementSignals"]): string | undefined {
  if (signals.reservation === "required") return "Reservation or timed entry should be checked before this stop.";
  if (signals.needsRecheck) return "Some details need recheck before this stop is execution-ready.";
  if (signals.longStop) return "This is a long stop, so keep the surrounding day lighter.";
  if (signals.reservation === "recommended") return "Reservation may reduce friction for this stop.";
  return undefined;
}

function mapPointForPlace(place: PlanPlace | BlueprintPlaceDisplay): BlueprintMapPointDisplay {
  return {
    id: place.id,
    placeId: place.id,
    title: "title" in place ? place.title : displayPlaceName(place),
    ...(place.coordinates ? { coordinates: place.coordinates } : {})
  };
}

function routeSegmentDisplayForSegment(segment: PlanRouteSegment, planSources: SourceReference[], sourceCatalog: BlueprintSource[] = []): BlueprintRouteSegmentDisplay | undefined {
  if (!routeSegmentShowsAsFormalRoute(segment)) return undefined;
  const needsRefresh = routeSegmentNeedsRefresh(segment);
  const refreshReason = routeRefreshReason(segment);
  return {
    id: segment.id,
    originPlaceId: segment.originPlaceId,
    destinationPlaceId: segment.destinationPlaceId,
    label: segment.display?.routeLabel?.trim() || segment.label || "Movement",
    verification: segment.verification,
    needsRefresh,
    mapLineState: segment.verification === "verified" ? "formal" : segment.display?.mapLineState ?? (needsRefresh ? "needs_refresh" : "formal"),
    ...(refreshReason ? { refreshReason } : {}),
    ...(segment.durationMinutes ? { durationLabel: `${segment.durationMinutes} min` } : {}),
    ...(segment.detail ? { detail: segment.detail } : {}),
    sources: sourceSummariesForRefs(segment.sourceRefs, planSources, sourceCatalog)
  };
}

function routeSegmentNeedsRefresh(segment: PlanRouteSegment): boolean {
  if (segment.verification === "verified") return false;
  if (segment.display?.refreshScope) return true;
  if (segment.display?.mapLineState === "needs_refresh") return true;
  if (segment.display?.refreshReason?.trim()) return true;
  return directEditRouteNeedsRefresh(segment);
}

function routeSegmentShowsAsFormalRoute(segment: PlanRouteSegment): boolean {
  return segment.display?.showAsFormalRoute !== false;
}

function routeRefreshReason(segment: PlanRouteSegment): string | undefined {
  if (segment.verification === "verified") return undefined;
  if (segment.display?.refreshReason?.trim()) return segment.display.refreshReason.trim();
  return directEditRouteNeedsRefresh(segment) ? "Route after needs refresh" : undefined;
}

function directEditRouteNeedsRefresh(segment: PlanRouteSegment): boolean {
  if (segment.verification !== "needs_verification") return false;
  const text = `${segment.label ?? ""} ${segment.detail ?? ""}`.toLocaleLowerCase();
  return text.includes("route needs refresh") || text.includes("edited directly");
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
  if (place.guideDisplay?.showInGuide !== undefined) return place.guideDisplay.showInGuide;
  if (place.display) return true;
  const text = `${place.category} ${place.visitRole ?? ""} ${place.name}`.toLocaleLowerCase();
  return !/hotel|accommodation|lodg|\bairport\b|\bstation\b|\bflight\b|\brail\b|\btransfer\b|\btransport\b/.test(text);
}

function guideStateForPlace(place: PlanPlace, scheduledPlaceIds: Set<string>): GuideState {
  if (scheduledPlaceIds.has(place.id)) return "scheduled";
  if (place.guideDisplay?.state === "informational") return "informational";
  if (place.guideDisplay?.state === "unscheduled") return "unscheduled";
  if (place.schedulingEligibility?.decision === "informational") return "informational";
  const text = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/informational|theme|local food|local product|background|context/.test(text)) return "informational";
  return "unscheduled";
}

function timelineBlocksForDay(presentation: PlanPresentation, day: ItineraryDay): TimelineBlock[] {
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  const displayDay = dayTabForDay(day);
  if (day.blocks?.length) {
    const scheduledPlaceIds = new Set(day.placeIds);
    return [...day.blocks].sort((left, right) => left.order - right.order).flatMap((block, index) => {
      const place = block.placeId ? placeById.get(block.placeId) : undefined;
      if (block.placeId && !place) return [];
      const routeAnchor = block.display?.routeAnchor ?? Boolean(place && scheduledPlaceIds.has(place.id) && block.kind !== "event");
      const reorderable = Boolean(routeAnchor && place && (block.display?.reorderable ?? directMoveAllowed(place)));
      const routeAfter = routeAnchor && place ? presentation.routeSegments.find((segment) => segment.dayId === day.id && segment.originPlaceId === place.id) : undefined;
      const status = place ? itineraryBlockStatus(place) : undefined;
      const contextualTip = place ? contextualTipForPlace(place, presentation.travelTips, { dayId: day.id, blockId: block.id }) : undefined;
      return [{
        day: displayDay,
        ...(place ? { place } : {}),
        block,
        order: block.order,
        timeLabel: block.display?.timeLabel?.trim() || roughBlockTimeLabel(block, place, index),
        type: place ? guideTypeForPlace(place) : blockGuideType(block),
        ...(blockTitle(block, place) ? { title: blockTitle(block, place)! } : {}),
        ...(blockMeta(block) ? { meta: blockMeta(block)! } : {}),
        ...(routeAnchor ? { routeAnchor: true } : {}),
        ...(reorderable ? { reorderable: true } : {}),
        ...(status ? { status } : {}),
        ...(contextualTip ? { contextualTip } : {}),
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
    const contextualTip = contextualTipForPlace(place, presentation.travelTips, { dayId: day.id });
    return [{
      day: displayDay,
      place,
      order: stop.order,
      timeLabel: roughTimeLabel(stop.time, stop.role, place, index),
      type: guideTypeForPlace(place),
      routeAnchor: true,
      ...(directMoveAllowed(place) ? { reorderable: true } : {}),
      ...(status ? { status } : {}),
      ...(contextualTip ? { contextualTip } : {}),
      ...(routeAfter ? { routeAfter } : {})
    }];
  });
}

function itineraryDisplayForDay(presentation: PlanPresentation, day: ItineraryDay, planSources: SourceReference[] = [], pendingEdit?: PendingItineraryEditDisplay | null): ItineraryDayDisplay {
  const blocks = timelineBlocksForDay(presentation, day);
  return itineraryDisplayFromBlocks(dayTabForDay(day), blocks, presentation.places, planSources, presentation.sourceCatalog, presentation.travelTips, pendingEdit);
}

export function itineraryDisplayForWorkspace(workspace: BlueprintWorkspaceDisplay, dayId: string, pendingEdit?: PendingItineraryEditDisplay | PendingItineraryEditDisplay[] | null): ItineraryDayDisplay {
  const base = workspace.itineraries.find((candidate) => candidate.dayId === dayId) ?? workspace.itineraries[0];
  if (!base) return emptyItineraryDayDisplay();
  return itineraryDisplayWithPending(base, workspace.places, pendingEdit);
}

function itineraryDisplayFromBlocks(day: BlueprintDayTabDisplay, blocks: TimelineBlock[], places: PlanPlace[], planSources: SourceReference[], sourceCatalog: BlueprintSource[] = [], travelTips: PlanPresentation["travelTips"] = [], pendingEdit?: PendingItineraryEditDisplay | null): ItineraryDayDisplay {
  const routeSegments = blocks.slice(0, -1).flatMap((block) => {
    const routeSegment = block.routeAfter ? routeSegmentDisplayForSegment(block.routeAfter, planSources, sourceCatalog) : undefined;
    return routeSegment ? [routeSegment] : [];
  });
  const routeRefresh = routeRefreshDisplayForDay(day, routeSegments);
  const base = {
    dayId: day.id,
    day,
    items: blocks.map((block) => itineraryCardForBlock(block)),
    placementOptions: itineraryPlacementOptions(blocks),
    routePlaces: blocks.flatMap((block) => block.place && block.routeAnchor ? [mapPointForPlace(block.place)] : []),
    routeSegments,
    ...(routeRefresh ? { routeRefresh } : {}),
    markers: blocks.flatMap((block) => {
      const place = block.place;
      if (!place || !block.routeAnchor) return [];
      return {
        placeId: place.id,
        title: displayPlaceName(place),
        type: markerTypeForPlace(place),
        ...(place.coordinates ? { coordinates: place.coordinates } : {}),
        markerState: "on-day" as const,
        priority: place.priority
      };
    })
  };
  return itineraryDisplayWithPending(base, places.map((place) => placeDisplayForPlace(place, travelTips)), pendingEdit);
}

function itineraryDisplayWithPending(base: ItineraryDayDisplay, places: BlueprintPlaceDisplay[], pendingEdit?: PendingItineraryEditDisplay | PendingItineraryEditDisplay[] | null): ItineraryDayDisplay {
  const edits = compactPendingItineraryEdits(Array.isArray(pendingEdit) ? pendingEdit : pendingEdit ? [pendingEdit] : []).filter((edit) => edit.dayId === base.dayId);
  if (!edits.length) return base;
  let items = base.items;
  let routePlaces = base.routePlaces;
  let routeSegments = base.routeSegments;
  const markers = [...base.markers];
  for (const edit of edits) {
    if (edit.kind === "move_place_within_day") {
      items = movePendingCard(items, edit);
      continue;
    }
    if (edit.kind === "remove_place_from_day") {
      items = removePendingCard(items, edit);
      routePlaces = routePlaces.filter((place) => place.placeId !== edit.placeId);
      routeSegments = routeSegments.filter((segment) => segment.originPlaceId !== edit.placeId && segment.destinationPlaceId !== edit.placeId);
      const markerIndex = markers.findIndex((marker) => marker.placeId === edit.placeId);
      if (markerIndex !== -1) markers.splice(markerIndex, 1);
      continue;
    }
    const pendingPlace = places.find((place) => place.id === edit.placeId);
    if (!pendingPlace) continue;
    items = insertPendingCard(items, itineraryCardForPendingPlace(pendingPlace, edit), edit.positionId ?? "end");
    if (pendingPlace.coordinates && !markers.some((marker) => marker.placeId === pendingPlace.id)) {
      markers.push({
        placeId: pendingPlace.id,
        title: pendingPlace.title,
        type: pendingPlace.markerType,
        coordinates: pendingPlace.coordinates,
        markerState: "pending",
        priority: pendingPlace.priority
      });
    }
  }
  return {
    ...base,
    items,
    routePlaces,
    routeSegments,
    markers,
    routeRefresh: draftRouteRefreshDisplayForPendingEdits(base, items, places, edits)
  };
}

function samePendingItineraryEditTarget(left: PendingItineraryEditDisplay, right: PendingItineraryEditDisplay): boolean {
  if (left.kind !== right.kind || left.placeId !== right.placeId) return false;
  return left.kind === "add_place_to_day" || left.dayId === right.dayId;
}

function pendingItineraryEditForPlace(edits: PendingItineraryEditDisplay[], placeId: string): PendingItineraryEditDisplay | undefined {
  return compactPendingItineraryEdits(edits).filter((edit) => edit.placeId === placeId).at(-1);
}

function guideCardWithPendingItineraryEdit(card: GuideCardDisplay, edit: PendingItineraryEditDisplay | undefined): GuideCardDisplay {
  if (!edit) return card;
  if (edit.kind === "remove_place_from_day") {
    const { timeline: _timeline, ...rest } = card;
    return {
      ...rest,
      state: "unscheduled",
      canAdd: true,
      actionLabel: card.actionLabel ?? "Add",
      draftActionLabel: "Undo draft",
      footerNote: `Removed from ${edit.dayLabel} (not saved)`
    };
  }
  const { actionLabel: _actionLabel, addBlockedReason: _addBlockedReason, ...rest } = card;
  return {
    ...rest,
    state: "scheduled",
    canAdd: false,
    draftActionLabel: "Undo draft",
    footerNote: edit.kind === "move_place_within_day" ? `Moved within ${edit.dayLabel} (not saved)` : `Added to ${edit.dayLabel} (not saved)`,
    timeline: { dayId: edit.dayId, label: edit.dayLabel, timeLabel: edit.kind === "add_place_to_day" ? "Draft" : "Not saved" }
  };
}

function detailWithPendingItineraryEdit(detail: DetailPlaceDisplay, edit: PendingItineraryEditDisplay | undefined): DetailPlaceDisplay {
  if (!edit) return detail;
  if (edit.kind === "remove_place_from_day") {
    const { priorityBlockedNote: _priorityBlockedNote, removeActionLabel: _removeActionLabel, removeBlockedReason: _removeBlockedReason, ...rest } = detail;
    return {
      ...rest,
      scheduled: false,
      canAdd: true,
      canRemoveFromDay: false,
      primaryActionLabel: "Add to itinerary",
      priorityActions: placePriorityActions({ priority: detail.priority }, false),
      itineraryDraftNote: `Removed from ${edit.dayLabel} (not saved).`,
      draftActionLabel: "Undo draft"
    };
  }
  const { removeActionLabel: _removeActionLabel, removeBlockedReason: _removeBlockedReason, ...rest } = detail;
  return {
    ...rest,
    scheduled: true,
    canAdd: false,
    canRemoveFromDay: false,
    primaryActionLabel: "Show in itinerary",
    itineraryDraftNote: edit.kind === "move_place_within_day" ? `Moved within ${edit.dayLabel} (not saved).` : `Added to ${edit.dayLabel} (not saved).`,
    draftActionLabel: "Undo draft"
  };
}

export function scheduledDayIdForPlace(workspace: BlueprintWorkspaceDisplay, placeId: string): string | undefined {
  return workspace.itineraries.find((itinerary) => itinerary.items.some((item) => item.kind === "block" && item.placeId === placeId && item.routeAnchor))?.dayId;
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
        tags: guideTags(presentation, place),
        priorityLabel: placePriorityLabel(place.priority),
        ...guideCardAction(place, state, firstTimelineByPlace.get(place.id)),
        ...(firstTimelineByPlace.get(place.id) ? { timeline: firstTimelineByPlace.get(place.id)! } : {})
      };
    });
}

function detailDisplayForPlace(presentation: PlanPresentation, planSources: SourceReference[], place: PlanPlace): DetailPlaceDisplay {
  const type = guideTypeForPlace(place);
  const scheduledDay = presentation.days.find((day) => day.placeIds.includes(place.id));
  const comparisonRows = comparisonRowsForPlace(presentation, place);
  const comparisonHeading = comparisonRows.length ? place.guideDisplay?.comparisonTitle ?? comparisonTitle(type) : undefined;
  const canAdd = !scheduledDay && directAddAllowed(place);
  const canRemoveFromDay = Boolean(scheduledDay && directRemoveAllowed(place));
  const removeBlockedReason = scheduledDay && !canRemoveFromDay ? directRemoveBlockedLabel(place) : undefined;
  return {
    placeId: place.id,
    title: displayPlaceName(place),
    priority: place.priority,
    priorityLabel: placePriorityLabel(place.priority),
    priorityActions: placePriorityActions(place, Boolean(scheduledDay)),
    ...(placePriorityBlockedNote(place, Boolean(scheduledDay)) ? { priorityBlockedNote: placePriorityBlockedNote(place, Boolean(scheduledDay))! } : {}),
    leadTitle: place.guideDisplay?.detailLeadTitle ?? detailLeadTitle(type),
    leadBody: place.whyWorthIt || place.plan,
    ...(place.plan ? { planTitle: place.guideDisplay?.detailPlanTitle ?? detailPlanTitle(type), planBody: place.plan } : {}),
    ...(place.reservation?.note ? { reservationNote: place.reservation.note } : {}),
    detailSections: place.detailSections,
    relatedEvents: relatedEventsForPlace(presentation, planSources, place.id),
    sources: sourceSummariesForPlace(place, planSources),
    ...(place.guideDisplay?.detailSourceTitle?.trim() ? { sourceTitle: place.guideDisplay.detailSourceTitle.trim() } : {}),
    ...(comparisonHeading ? { comparisonTitle: comparisonHeading } : {}),
    comparisonRows: comparisonHeading ? comparisonRows : [],
    primaryActionLabel: detailPrimaryActionLabel(place, Boolean(scheduledDay), canAdd),
    scheduled: Boolean(scheduledDay),
    canAdd,
    canRemoveFromDay,
    ...(canRemoveFromDay ? { removeActionLabel: "Remove from day" } : {}),
    ...(removeBlockedReason ? { removeBlockedReason } : {}),
    links: detailLinks(place)
  };
}

function comparisonRowsForPlace(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const displayRows = comparisonRowsFromGuideDisplay(presentation, selectedPlace);
  if (displayRows.length) return displayRows;
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

function comparisonRowsFromGuideDisplay(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const rows = selectedPlace.guideDisplay?.comparisonRows ?? [];
  if (!rows.length) return [];
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  return rows.map((row) => {
    const related = row.relatedPlaceId ? placeById.get(row.relatedPlaceId) : undefined;
    return {
      id: row.relatedPlaceId ?? row.id,
      name: row.name?.trim() || (related ? displayPlaceName(related) : row.id),
      area: row.area,
      routeFit: row.routeFit,
      timing: row.timing,
      effort: row.effort,
      sourceState: row.sourceState
    };
  }).slice(0, 5);
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
  const placeBlocks = blocks.filter((block): block is TimelineBlock & { place: PlanPlace } => Boolean(block.place && block.routeAnchor));
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
  const currentOrder = itinerary.items.filter((item) => item.routeAnchor).map((item) => item.placeId).filter(Boolean);
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

export function buildPendingItineraryRemoveForWorkspace(workspace: BlueprintWorkspaceDisplay, input: { dayId: string; placeId: string }): PendingItineraryEditDisplay | undefined {
  const itinerary = workspace.itineraries.find((candidate) => candidate.dayId === input.dayId);
  const place = workspace.places.find((candidate) => candidate.id === input.placeId);
  const detail = workspace.details.find((candidate) => candidate.placeId === input.placeId);
  if (!itinerary || !place || !detail?.scheduled || !detail.canRemoveFromDay) return undefined;
  if (!itinerary.items.some((item) => item.kind === "block" && item.placeId === input.placeId && item.routeAnchor)) return undefined;
  const dayLabel = itinerary.day.shortLabel ?? itinerary.day.date ?? itinerary.day.label;
  return {
    kind: "remove_place_from_day",
    placeId: place.id,
    placeName: place.title,
    dayId: itinerary.dayId,
    dayLabel,
    advisories: [{ tone: "neutral", text: "This day will need route and timing refresh after removing this stop." }]
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

function routeRefreshDisplayForDay(day: BlueprintDayTabDisplay, routeSegments: BlueprintRouteSegmentDisplay[]): ItineraryRouteRefreshDisplay | undefined {
  const refreshSegments = routeSegments.filter((segment) => segment.needsRefresh);
  if (!refreshSegments.length) return undefined;
  const dayLabel = day.shortLabel ?? day.date ?? day.label;
  const segmentCount = refreshSegments.length;
  return {
    segmentCount,
    segmentIds: refreshSegments.map((segment) => segment.id),
    dayLabel,
    summary: segmentCount === 1 ? `1 route leg on ${dayLabel} needs refresh.` : `${segmentCount} route legs on ${dayLabel} need refresh.`,
    request: `Refresh routes for ${dayLabel}. Recheck the affected route leg${segmentCount === 1 ? "" : "s"}, timing, meal spacing, and opening constraints before marking this itinerary ready.`
  };
}

function draftRouteRefreshDisplayForPendingEdits(base: ItineraryDayDisplay, previewItems: ItineraryCardDisplay[], places: BlueprintPlaceDisplay[], edits: PendingItineraryEditDisplay[]): ItineraryRouteRefreshDisplay {
  const dayLabel = base.day.shortLabel ?? base.day.date ?? base.day.label;
  const changeCount = edits.length;
  const impactNotes = pendingEditImpactNotes(base, previewItems, places, edits);
  return {
    segmentCount: Math.max(1, base.routeSegments.length, changeCount),
    segmentIds: [],
    dayLabel,
    summary: `${changeCount} unsaved itinerary change${changeCount === 1 ? "" : "s"} will need route refresh after you confirm.`,
    ...(impactNotes.length ? { impactNotes } : {}),
    request: `After you confirm the itinerary draft for ${dayLabel}, refresh routing, timing, meal spacing, and opening constraints before marking this day ready.`,
    actionable: false
  };
}

function pendingEditImpactNotes(base: ItineraryDayDisplay, previewItems: ItineraryCardDisplay[], places: BlueprintPlaceDisplay[], edits: PendingItineraryEditDisplay[]): string[] {
  const placesById = new Map(places.map((place) => [place.id, place] as const));
  const routePlaceIds = previewItineraryPlaceIds(previewItems);
  const routePlaces = routePlaceIds.flatMap((placeId) => {
    const place = placesById.get(placeId);
    return place ? [place] : [];
  });
  const notes: string[] = ["Route and timing will be rechecked after confirmation."];
  if (edits.some((edit) => edit.kind === "add_place_to_day")) {
    notes.push(addImpactNote(routePlaces));
  }
  notes.push(...spatialImpactNotes(base, previewItems, placesById, edits));
  if (edits.some((edit) => edit.kind === "remove_place_from_day")) {
    notes.push(removeImpactNote(routePlaces, placesById, edits));
  }
  if (edits.some((edit) => edit.kind === "move_place_within_day")) {
    notes.push("Moved stops keep their current time labels until timing is refreshed.");
  }
  notes.push(...edits.flatMap((edit) => edit.advisories.map((advisory) => advisory.text)));
  return uniqueStrings(notes).slice(0, 5);
}

function previewItineraryPlaceIds(items: ItineraryCardDisplay[]): string[] {
  return items.filter((item) => item.placeId && (item.routeAnchor || item.kind === "pending")).map((item) => item.placeId);
}

function addImpactNote(routePlaces: BlueprintPlaceDisplay[]): string {
  return routePlaces.length >= 5
    ? `This preview has ${routePlaces.length} planned stops, so pacing may be tight.`
    : "Added places may affect meal spacing, opening windows, and route order.";
}

function removeImpactNote(routePlaces: BlueprintPlaceDisplay[], placesById: Map<string, BlueprintPlaceDisplay>, edits: PendingItineraryEditDisplay[]): string {
  const removeEdits = edits.filter((edit) => edit.kind === "remove_place_from_day");
  const removedPlaces = removeEdits.flatMap((edit) => {
    const place = placesById.get(edit.placeId);
    return place ? [place] : [];
  });
  if ((removedPlaces.some((place) => place.markerType === "dining") || removeEdits.some((edit) => mealOrRestText(edit.placeName))) && !routePlaces.some((place) => place.markerType === "dining" || mealOrRestText(place.title))) {
    return "Removing this stop leaves the day without a clear meal or rest anchor.";
  }
  return "Removed stops stay in Explore and may leave a gap in the day.";
}

function mealOrRestText(text: string): boolean {
  return /\b(restaurant|market|lunch|dinner|breakfast|coffee|cafe|tea|dessert|bakery|bar)\b/i.test(text);
}

function spatialImpactNotes(base: ItineraryDayDisplay, previewItems: ItineraryCardDisplay[], placesById: Map<string, BlueprintPlaceDisplay>, edits: PendingItineraryEditDisplay[]): string[] {
  const notes: string[] = [];
  const changedPlaces = edits.flatMap((edit) => {
    const place = placesById.get(edit.placeId);
    return place ? [place] : [];
  });
  const crossCity = changedPlaces.find((place) => base.day.city && place.city && !sameText(base.day.city, place.city));
  if (crossCity && base.day.city) {
    notes.push(`This edit reaches ${crossCity.city}, while ${base.day.city} is the day base.`);
  }
  const originalAreas = new Set(previewItineraryPlaceIds(base.items).flatMap((placeId) => {
    const area = placesById.get(placeId)?.area?.trim();
    return area ? [area.toLocaleLowerCase()] : [];
  }));
  const changedArea = changedPlaces.find((place) => place.area?.trim() && !originalAreas.has(place.area.trim().toLocaleLowerCase()));
  if (changedArea && !crossCity) {
    notes.push("This edit adds another area to the day, so route fit needs a closer check.");
  }
  if (previewOrderRevisitsArea(previewItems, placesById)) {
    notes.push("The previewed order revisits an area, so it may create backtracking.");
  }
  return notes;
}

function previewOrderRevisitsArea(items: ItineraryCardDisplay[], placesById: Map<string, BlueprintPlaceDisplay>): boolean {
  const areas = previewItineraryPlaceIds(items).flatMap((placeId) => {
    const area = placesById.get(placeId)?.area?.trim().toLocaleLowerCase();
    return area ? [area] : [];
  });
  const seen = new Set<string>();
  let previous = "";
  for (const area of areas) {
    if (area === previous) continue;
    if (seen.has(area)) return true;
    seen.add(area);
    previous = area;
  }
  return false;
}

function itineraryCardForPendingPlace(place: BlueprintPlaceDisplay, edit: PendingItineraryEditDisplay): ItineraryCardDisplay {
  return {
    kind: "pending",
    key: `pending-${edit.dayId}-${edit.placeId}-${edit.positionId ?? "end"}`,
    placeId: place.id,
    title: place.title,
    timeLabel: "Draft",
    ...(edit.positionLabel ? { meta: edit.positionLabel } : {}),
    statusLabel: "Not saved",
    draftActionLabel: "Undo draft",
    ...(place.contextualTip ? { contextualTip: place.contextualTip } : {})
  };
}

function itineraryCardForBlock(block: TimelineBlock): ItineraryCardDisplay {
  const routeStatusLabel = block.routeAfter && routeSegmentShowsAsFormalRoute(block.routeAfter) && routeSegmentNeedsRefresh(block.routeAfter) ? routeRefreshReason(block.routeAfter) ?? "Route after needs refresh" : undefined;
  return {
    kind: "block",
    key: `${block.day.id}-${block.place?.id ?? block.block?.id ?? block.order}-${block.order}`,
    placeId: block.place?.id ?? "",
    title: block.title ?? (block.place ? displayPlaceName(block.place) : "Flexible time"),
    timeLabel: block.timeLabel,
    ...(block.meta ? { meta: block.meta } : {}),
    ...(block.status ? { statusLabel: block.status } : {}),
    ...(routeStatusLabel ? { routeStatusLabel } : {}),
    ...(block.routeAnchor ? { routeAnchor: true } : {}),
    ...(block.place && block.reorderable ? { reorderable: true } : {}),
    ...(block.contextualTip ? { contextualTip: block.contextualTip } : {})
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
  if (!edit.position) return items;
  const currentIndex = items.findIndex((item) => item.placeId === edit.placeId && item.kind === "block" && item.routeAnchor);
  if (currentIndex === -1) return items;
  const slotTimeLabels = items.map((item) => item.timeLabel);
  const moving = { ...items[currentIndex]!, statusLabel: "Not saved", editState: "moved" as const, draftActionLabel: "Undo draft" };
  const next = items.filter((_, index) => index !== currentIndex);
  const { position } = edit;
  let insertionIndex = 0;
  if (position.kind === "end") insertionIndex = next.length;
  if (position.kind === "after") {
    const afterIndex = next.findIndex((item) => item.placeId === position.afterPlaceId && item.routeAnchor);
    insertionIndex = afterIndex === -1 ? next.length : afterIndex + 1;
  }
  return [...next.slice(0, insertionIndex), moving, ...next.slice(insertionIndex)]
    .map((item, index) => ({ ...item, timeLabel: slotTimeLabels[index] ?? item.timeLabel }));
}

function removePendingCard(items: ItineraryCardDisplay[], edit: PendingItineraryEditDisplay): ItineraryCardDisplay[] {
  return items.filter((item) => !(item.kind === "block" && item.routeAnchor && item.placeId === edit.placeId));
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
    const theme = tip.theme ? travelTipThemeLabel(tip.theme) : tipTheme(tip);
    groups.set(theme, [...(groups.get(theme) ?? []), tip]);
  }
  return [...groups].map(([theme, values]) => ({ theme, tips: values }));
}

function tipsForPresentation(plan: Plan, presentation: PlanPresentation): TipDisplay[] {
  if (presentation.travelTips === undefined) return localTipsForPlan(plan);
  return presentation.travelTips.map((tip) => ({
    id: tip.id,
    title: tip.title,
    body: tip.body,
    context: tip.context,
    theme: tip.theme
  }));
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

function preparationGroupsForPresentation(plan: Plan, presentation: PlanPresentation): PreparationGroupDisplay[] {
  if (presentation.preparationChecklist === undefined) return preparationGroupsForPlan(plan);
  const canonical = presentation.preparationChecklist;
  const completedTaskIds = new Set(plan.stages.flatMap((stage) => stage.tasks.filter((task) => task.status === "completed").map((task) => task.id)));
  const completedRequirementIds = new Set(plan.stages.flatMap((stage) => stage.tasks.flatMap((task) => task.status === "completed" && task.requirementId ? [task.requirementId] : [])));
  const groups = new Map<BlueprintPreparationGroup, PreparationChecklistItemDisplay[]>();
  for (const item of canonical) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), {
      id: item.id,
      title: item.title,
      ...(item.description ? { description: item.description } : item.completionCondition ? { description: item.completionCondition } : {}),
      checked: completedTaskIds.has(item.id) || Boolean(item.requirementId && completedRequirementIds.has(item.requirementId))
    }]);
  }
  return preparationGroupOrder.flatMap((group) => {
    const items = groups.get(group) ?? [];
    return items.length ? [{ title: preparationGroupLabel(group), items }] : [];
  });
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
  if (block.title?.trim()) return block.title;
  if (place) return displayPlaceName(place);
  if (block.kind === "meal") return "Meal window";
  if (block.kind === "rest") return "Rest";
  if (block.kind === "transfer") return "Transfer";
  if (block.kind === "lodging") return "Hotel time";
  if (block.kind === "event") return "Timed event";
  if (block.kind === "flexible") return "Flexible time";
  return undefined;
}

function blockMeta(block: BlueprintItineraryBlock): string | undefined {
  if (block.display?.meta?.trim()) return block.display.meta.trim();
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

function sourceSummariesForRefs(sourceRefs: string[] | undefined, planSources: SourceReference[], sourceCatalog: BlueprintSource[] = []): SourceMarkerDisplay[] {
  return (sourceRefs ?? []).flatMap((sourceRef) => {
    const source = planSources.find((candidate) => candidate.url === sourceRef) ?? sourceCatalog.find((candidate) => candidate.url === sourceRef || candidate.id === sourceRef);
    const url = source?.url ?? (sourceRef.startsWith("http") ? sourceRef : undefined);
    return [{ label: "Source", summary: source ? sourceReferenceSummary(source) : sourceRef, ...(url ? { url } : {}) }];
  });
}

function sourceSummariesForEvidenceRefs(evidence: BlueprintEvidenceRef[] | undefined, sourceCatalog: BlueprintSource[]): SourceMarkerDisplay[] {
  return (evidence ?? []).flatMap((ref) => {
    const source = sourceCatalog.find((candidate) => candidate.id === ref.sourceId);
    if (!source) return [];
    const refSummary = [sourceReferenceSummary(source), ref.supports?.slice(0, 2).join("; "), ref.status !== "verified" ? "needs recheck" : undefined, ref.checkedAt ? `checked ${ref.checkedAt}` : undefined].filter(Boolean).join(" · ");
    return [{ label: "Source", summary: refSummary, url: source.url }];
  });
}

function sourceMarkersForPlan(plan: Plan, presentation: PlanPresentation): SourceMarkerDisplay[] {
  const sourceCatalog = presentation.sourceCatalog ?? [];
  const fromPlan = plan.sources.map((source) => ({ label: "Source", summary: sourceReferenceSummary(source), url: source.url }));
  const fromPlaces = presentation.places.flatMap((place) => place.evidenceSources?.map((source) => ({ label: "Source", summary: [source.title, source.role, source.status && source.status !== "verified" ? "needs recheck" : undefined, source.checkedAt ? `checked ${source.checkedAt}` : undefined].filter(Boolean).join(" · "), url: source.url })) ?? []);
  const fromEvents = (presentation.events ?? []).flatMap((event) => sourceSummariesForRefs(event.sourceRefs, plan.sources, sourceCatalog));
  const fromPresentation = [
    ...sourceCatalog.map((source) => ({ label: "Source", summary: sourceReferenceSummary(source), url: source.url })),
    ...sourceSummariesForFieldEvidence(presentation.fieldEvidence, sourceCatalog),
    ...(presentation.places ?? []).flatMap((place) => sourceSummariesForFieldEvidence(place.fieldEvidence, sourceCatalog)),
    ...(presentation.travelTips ?? []).flatMap((tip) => sourceSummariesForEvidenceRefs(tip.evidence, sourceCatalog)),
    ...(presentation.preparationChecklist ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog)),
    ...(presentation.localFoods ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog)),
    ...(presentation.localProducts ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog)),
    ...(presentation.experienceThemes ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog)),
    ...(presentation.guideRelationshipGraph?.relationships ?? []).flatMap((relationship) => sourceSummariesForEvidenceRefs(relationship.evidence, sourceCatalog))
  ];
  return uniqueSourceMarkers([...fromPlan, ...fromPresentation, ...fromPlaces, ...fromEvents]);
}

function sourceSummariesForFieldEvidence(fieldEvidence: Array<{ evidence: BlueprintEvidenceRef[] }> | undefined, sourceCatalog: BlueprintSource[]): SourceMarkerDisplay[] {
  return (fieldEvidence ?? []).flatMap((field) => sourceSummariesForEvidenceRefs(field.evidence, sourceCatalog));
}

function uniqueSourceMarkers(sources: SourceMarkerDisplay[]): SourceMarkerDisplay[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
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

export function placePriorityLabel(priority: PlanPlacePriority): string {
  if (priority === "must") return "Must go";
  if (priority === "preferred") return "Prefer";
  if (priority === "nearby") return "Nearby";
  if (priority === "archive") return "Keep for later";
  if (priority === "recheck") return "Needs check";
  if (priority === "booked") return "Booked";
  return "Pending";
}

const directPlacePriorityOptions: Array<{ priority: PlanPlacePriority; label: string }> = [
  { priority: "must", label: "Must go" },
  { priority: "preferred", label: "Prefer" },
  { priority: "nearby", label: "Nearby" },
  { priority: "archive", label: "Keep for later" },
  { priority: "recheck", label: "Needs check" }
];

function placePriorityActions(place: Pick<PlanPlace, "priority">, scheduled: boolean): PlacePriorityActionDisplay[] {
  return directPlacePriorityOptions.map((option) => {
    const active = place.priority === option.priority;
    const scheduledArchive = scheduled && option.priority === "archive";
    return {
      priority: option.priority,
      label: option.label,
      active,
      ...(active || scheduledArchive ? { disabled: true } : {}),
      ...(scheduledArchive ? { disabledReason: "Remove this place from the day before keeping it for later." } : {})
    };
  });
}

function placePriorityBlockedNote(place: Pick<PlanPlace, "priority">, scheduled: boolean): string | undefined {
  if (scheduled && place.priority !== "archive") return "Keep for later would change the day route, so it needs a remove action first.";
  return undefined;
}

function workspaceAreasForPresentation(presentation: PlanPresentation): readonly BlueprintWorkspaceArea[] {
  const explicit = presentation.moduleIdentity?.enabledModules.map((module) => module.id).filter((id) => blueprintWorkspaceAreas.includes(id));
  return explicit?.length ? [...new Set(explicit)] : blueprintWorkspaceAreas;
}

function shortGuideSummary(place: PlanPlace): string {
  if (place.guideDisplay?.cardSummary?.trim()) return place.guideDisplay.cardSummary.trim();
  return shorten(firstUsefulSentence(place.whyWorthIt) || firstTravelerFacingPlanSentence(place.plan) || `${place.area ?? place.locationLabel}.`, 125);
}

function firstUsefulSentence(value: string): string {
  return value.split(/(?<=[.!?。！？])\s+/)[0]?.trim() ?? "";
}

function firstTravelerFacingPlanSentence(value: string): string {
  return value.split(/(?<=[.!?。！？])\s+/).map((sentence) => sentence.trim()).find((sentence) => sentence && !looksLikeSchedulingConstraint(sentence)) ?? "";
}

function looksLikeSchedulingConstraint(value: string): boolean {
  const normalized = value.toLowerCase();
  return [
    /\bdo not schedule\b/,
    /\bdon't schedule\b/,
    /\bavoid scheduling\b/,
    /\bnot schedule (?:it|this)\b/,
    /\bcross-city day\b/,
    /\btiring\b/,
    /\broute order\b/,
    /\bneeds? replanning\b/,
    /\breplan(?:ning)?\b/
  ].some((pattern) => pattern.test(normalized));
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function guideTags(presentation: PlanPresentation, place: PlanPlace): string[] {
  const catalogTags = catalogTagsForPlace(presentation, place.id);
  const baseTags = place.guideDisplay?.tags?.length
    ? place.guideDisplay.tags
    : [place.durationMinutes ? `${place.durationMinutes} min` : undefined, place.reservation?.requirement === "required" ? "Reservation" : undefined].filter(Boolean) as string[];
  return uniqueStrings([...baseTags, ...catalogTags]).slice(0, 4);
}

function guideCardAction(place: PlanPlace, state: GuideState, timeline: GuideCardDisplay["timeline"]): Pick<GuideCardDisplay, "canAdd" | "actionLabel" | "footerNote" | "addBlockedReason"> {
  if (state === "unscheduled" && directAddAllowed(place)) return { canAdd: true, actionLabel: place.guideDisplay?.addActionLabel ?? place.guideDisplay?.primaryActionLabel ?? "Add", ...(place.guideDisplay?.footerNote ? { footerNote: place.guideDisplay.footerNote } : {}) };
  if (state === "unscheduled") {
    const label = place.guideDisplay?.addBlockedLabel ?? place.guideDisplay?.blockedActionLabel ?? addBlockedLabel(place);
    return { canAdd: false, footerNote: label, addBlockedReason: label };
  }
  if (state === "scheduled") return { canAdd: false, ...(timeline ? { footerNote: `${timeline.label} ${timeline.timeLabel}` } : {}) };
  return { canAdd: false, ...(place.guideDisplay?.footerNote ? { footerNote: place.guideDisplay.footerNote } : {}) };
}

function detailPrimaryActionLabel(place: PlanPlace, scheduled: boolean, canAdd: boolean): string {
  if (scheduled) return place.guideDisplay?.scheduledActionLabel ?? "Show in itinerary";
  if (canAdd) return place.guideDisplay?.primaryActionLabel ?? "Add to itinerary";
  const decision = place.schedulingEligibility?.decision;
  if (decision === "informational") return place.guideDisplay?.informationalActionLabel ?? place.guideDisplay?.addBlockedLabel ?? "Background note";
  return place.guideDisplay?.blockedActionLabel ?? place.guideDisplay?.addBlockedLabel ?? addBlockedLabel(place);
}

function directAddAllowed(place: Pick<PlanPlace, "schedulingEligibility">): boolean {
  const decision = place.schedulingEligibility?.decision;
  return decision === undefined || decision === "schedulable";
}

function directMoveAllowed(place: Pick<PlanPlace, "priority" | "schedulingEligibility" | "reservation" | "display">): boolean {
  const reservationSignal = place.display?.workspaceSignals?.reservation;
  if (place.priority === "booked" || reservationSignal === "required" || (!reservationSignal && place.reservation?.requirement === "required")) return false;
  const decision = place.schedulingEligibility?.decision;
  return decision === undefined || decision === "schedulable";
}

function directRemoveAllowed(place: Pick<PlanPlace, "priority" | "schedulingEligibility" | "reservation" | "display">): boolean {
  return directMoveAllowed(place);
}

function directRemoveBlockedLabel(place: Pick<PlanPlace, "priority" | "schedulingEligibility" | "reservation" | "display">): string {
  const reservationSignal = place.display?.workspaceSignals?.reservation;
  if (place.priority === "booked" || reservationSignal === "required" || (!reservationSignal && place.reservation?.requirement === "required")) return "Fixed booking";
  return addBlockedLabel(place);
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
  const explicit = place.display?.workspaceSignals?.itineraryStatusLabel?.trim();
  if (explicit) return explicit;
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

function catalogTagsForPlace(presentation: PlanPresentation, placeId: string): string[] {
  return [
    ...(presentation.localFoods ?? []).flatMap((item) => item.diningPlaceIds.includes(placeId) ? [item.title] : []),
    ...(presentation.localProducts ?? []).flatMap((item) => item.purchasePlaceIds.includes(placeId) ? [item.title] : []),
    ...(presentation.experienceThemes ?? []).flatMap((item) => item.offeringPlaceIds.includes(placeId) ? [item.title] : [])
  ];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

const preparationGroupOrder: BlueprintPreparationGroup[] = ["documents", "phone_payments", "bookings_departure", "packing", "other"];

function preparationGroupLabel(group: BlueprintPreparationGroup): string {
  switch (group) {
    case "documents": return "Documents";
    case "phone_payments": return "Phone & payments";
    case "bookings_departure": return "Bookings & departure";
    case "packing": return "Packing";
    case "other": return "Other prep";
  }
}

function travelTipThemeLabel(theme: BlueprintTravelTipTheme): string {
  switch (theme) {
    case "payment": return "Payment";
    case "transport": return "Transport";
    case "etiquette": return "Etiquette";
    case "safety": return "Safety";
    case "weather": return "Weather";
    case "timing": return "Timing";
    case "language": return "Language";
    case "local_norms": return "Local norms";
  }
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
  return type === "dining" ? "Compare dining nearby" : type === "shopping" ? "Compare shopping options" : type === "experience" ? "Compare experience options" : "Compare nearby options";
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
      sources: sourceSummariesForRefs(event.sourceRefs, planSources, presentation.sourceCatalog)
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
