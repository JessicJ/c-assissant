import type { TripBlueprint, BlueprintActionRequirement, BlueprintEvidenceRef, BlueprintItineraryBlock, BlueprintPlaceRelationship, BlueprintPlanAlternative, BlueprintPreparationChecklistItem, BlueprintPreparationGroup, BlueprintSchedulingEligibility, BlueprintSource, BlueprintTravelTipTheme, DirectBlueprintRevisionBatchMetadata, ItineraryDay, Plan, PlanPlace, PlanPlacePriority, PlanPresentation, PlanPresentationEvent, PlanRouteSegment, SourceReference, Task } from "@c-assistant/core";
import { bookingRelationshipProtection,type BookingRelationshipEdit } from "@c-assistant/core/booking-relationship";
import { groupPreparationItems } from "./plan-preparation-display.js";
import { displayTripTitle } from "./trip-title.js";

export type BlueprintWorkspaceArea = "itinerary" | "preparation" | "tips" | "sources";
export type GuideFilter = "all" | "attraction" | "dining" | "shopping" | "experience" | "stay" | "transport";
export type ItineraryTimelineRole = "place" | "transport" | "activity" | "rest" | "pending_place";
export type TimelineVisualPrimitive = "place" | "movement" | "action";
export type TimelineDisplayTimeMode = "point" | "range" | "none";
export type GuideState = "scheduled" | "unscheduled" | "optional" | "replacement" | "informational";
export type GuideStateFilter = "all" | GuideState;

const blueprintWorkspaceAreas = ["itinerary", "preparation", "tips", "sources"] as const satisfies readonly BlueprintWorkspaceArea[];
const blueprintGuideFilters = ["attraction", "dining", "shopping", "experience"] as const satisfies readonly Exclude<GuideFilter, "all">[];

export type BookingSnapshotAction = { knownFixed: boolean; unknown: boolean };
export type BookingSnapshotActionReader = (edit:BookingRelationshipEdit) => BookingSnapshotAction;
export type BlueprintWorkspaceDisplay = {
  bookingAction?: BookingSnapshotActionReader;
  bookingDayByItem?: Record<string,string>;
  bookingDayForBlock?: (tabId:string,placeId:string,blockId?:string)=>string|undefined;
  detailForPlace?: (placeId: string, dayId?: string) => DetailPlaceDisplay | undefined;
  title: string;
  dateLabel: string;
  initialDayId: string;
  initialPlaceId: string;
  mapFallback: BlueprintMapViewportDisplay;
  areas: readonly BlueprintWorkspaceArea[];
  days: BlueprintDayTabDisplay[];
  placementDays: BlueprintDayTabDisplay[];
  places: BlueprintPlaceDisplay[];
  itineraries: ItineraryDayDisplay[];
  guideFilters: readonly Exclude<GuideFilter, "all">[];
  guideCards: GuideCardDisplay[];
  details: DetailPlaceDisplay[];
  preparationGroups: PreparationGroupDisplay[];
  tipGroups: TipGroupDisplay[];
  sources: SourceMarkerDisplay[];
  sourceGroups: SourceGroupDisplay[];
  relationships?: BlueprintPlaceRelationship[];
  alternatives: PlanPresentation["alternatives"];
  planAlternatives: AlternativeDisplay[];
  researchGrounding: PlanPresentation["researchGrounding"];
};

export type BlueprintMapViewportDisplay = {
  center: [number, number];
  zoom: number;
  label: string;
};

export type BlueprintDayTabDisplay = {
  id: string;
  label: string;
  tabLabel?: string;
  date?: string;
  shortLabel?: string;
  city?: string;
  title?: string;
  summary?: string;
  dayIds?: string[];
  defaultDayId?: string;
  startContext?: NonNullable<PlanPresentation["days"][number]["startContext"]>;
  endContext?: NonNullable<PlanPresentation["days"][number]["endContext"]>;
};

export type DayContextDisplay = {
  startLabel?: string;
  endLabel?: string;
  summary?: string;
};

export type AlternativeDisplay = {
  key: string;
  kind: BlueprintPlanAlternative["kind"];
  label: string;
  title: string;
  summary: string;
  replacementFor?: string;
  condition?: string;
};

export type BlueprintPlaceDisplay = {
  id: string;
  title: string;
  locationLabel: string;
  image?: GuideCardImageDisplay;
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
  independentFixed?: boolean;
  placementNote?: string;
  contextualTip?: string;
};

type TimelineBlock = {
  day: BlueprintDayTabDisplay;
  place?: PlanPlace;
  block?: BlueprintItineraryBlock;
  order: number;
  timeLabel: string;
  type: GuideFilter;
  timelineRole: ItineraryTimelineRole;
  title?: string;
  meta?: string;
  routeAnchor?: boolean;
  reorderable?: boolean;
  status?: string;
  routeAfter?: PlanRouteSegment;
  contextualTip?: string;
};

export type ItineraryCardDisplay = {
  blockId?: string;
  kind: "block" | "pending";
  key: string;
  placeId: string;
  title: string;
  timeLabel: string;
  type: GuideFilter;
  timelineRole: ItineraryTimelineRole;
  image?: GuideCardImageDisplay;
  imageCandidates?: GuideCardImageDisplay[];
  illustrationKind?: "rest" | "lunch";
  compactStep?: boolean;
  featurePlaceCard?: TimelineFeaturePlaceCardModel;
  placeMeta?: string;
  purpose?: string;
  emphasis?: "primary" | "secondary";
  meta?: string;
  statusLabel?: string;
  routeAfterLabel?: string;
  routeAfterStatusLabel?: string;
  routeAfterMode?: PlanRouteSegment["mode"];
  routeAfterDestinationPlaceId?: string;
  routeAfterDurationLabel?: string;
  routeAfterDetail?: string;
  routeAnchor?: boolean;
  reorderable?: boolean;
  draftActionLabel?: string;
  contextualTip?: string;
  externalAction?: { label: "Book" | "Check availability" | "View hotel" | "View booking"; url: string };
};

export type TimelineFeaturePlaceCardModel = {
  title: string;
  typeLabel: string;
  areaLabel?: string;
  summary: string;
  chips: { label: string; kind?: "type" | "attribute" }[];
  image?: GuideCardImageDisplay;
  imageCandidates: GuideCardImageDisplay[];
  imageAvailable: boolean;
  clickable: boolean;
};

export type ItineraryTimelineRenderNode =
  | { kind: "item"; key: string; item: ItineraryCardDisplay }
  | { kind: "movement"; key: string; item: ItineraryCardDisplay; label: string; state: "confirmed" | "pending" | "checking" };

export function timelineVisualPrimitiveForItem(item: Pick<ItineraryCardDisplay, "timelineRole">): TimelineVisualPrimitive {
  if (item.timelineRole === "transport") return "movement";
  if (item.timelineRole === "activity" || item.timelineRole === "rest") return "action";
  return "place";
}

export function itineraryTimelineNodesForItems(items: ItineraryCardDisplay[], routeRefreshBusy = false): ItineraryTimelineRenderNode[] {
  const nodes: ItineraryTimelineRenderNode[] = [];
  const pendingMovementByDestination = new Map<string, ItineraryTimelineRenderNode & { kind: "movement" }>();
  const appendMovementForItem = (item: ItineraryCardDisplay) => {
    const movement = movementRenderNodeForRouteAfter(item, routeRefreshBusy);
    if (!movement) return;
    if (item.routeAfterDestinationPlaceId) {
      pendingMovementByDestination.set(item.routeAfterDestinationPlaceId, movement);
      return;
    }
    nodes.push(movement);
  };
  for (const item of items) {
    if (item.placeId) {
      const pendingMovement = pendingMovementByDestination.get(item.placeId);
      if (pendingMovement) {
        nodes.push(pendingMovement);
        pendingMovementByDestination.delete(item.placeId);
      }
    }
    nodes.push({ kind: "item", key: `item-${item.key}`, item });
    appendMovementForItem(item);
  }
  nodes.push(...pendingMovementByDestination.values());
  return nodes;
}

function movementRenderNodeForRouteAfter(item: ItineraryCardDisplay, routeRefreshBusy: boolean): (ItineraryTimelineRenderNode & { kind: "movement" }) | undefined {
  if (!item.routeAfterLabel && !item.routeAfterStatusLabel) return undefined;
  const state = item.routeAfterStatusLabel ? (routeRefreshBusy ? "checking" : "pending") : "confirmed";
  const label = item.routeAfterStatusLabel && routeRefreshBusy
    ? "Checking travel time..."
    : item.routeAfterLabel ?? item.routeAfterStatusLabel ?? "";
  if (!label) return undefined;
  return {
    kind: "movement",
    key: `movement-after-${item.key}`,
    item,
    label,
    state
  };
}

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
  dayContext?: DayContextDisplay;
  dayAlternatives: AlternativeDisplay[];
  items: ItineraryCardDisplay[];
  sections?: ItineraryDateSectionDisplay[];
  placementOptions: ItineraryPlacementOption[];
  routePlaces: BlueprintMapPointDisplay[];
  routeSegments: BlueprintRouteSegmentDisplay[];
  routeRefresh?: ItineraryRouteRefreshDisplay;
  markers: BlueprintMapMarkerDisplay[];
};

export type ItineraryDateSectionDisplay = {
  key: string;
  heading: string;
  dayId: string;
  day: BlueprintDayTabDisplay;
  dayContext?: DayContextDisplay;
  dayAlternatives: AlternativeDisplay[];
  items: ItineraryCardDisplay[];
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
  locationLabel: string;
  typeLabel: string;
  planFitLabel?: string;
  practicalSignal?: string;
  image?: GuideCardImageDisplay;
  tags: string[];
  footerNote?: string;
  actionLabel?: string;
  canAdd: boolean;
  addBlockedReason?: string;
  draftActionLabel?: string;
  priorityLabel: string;
  timeline?: { dayId: string; label: string; timeLabel: string };
  sources?: SourceMarkerDisplay[] | undefined;
  imageSource?: SourceMarkerDisplay;
  relatedPlaceIds?: string[];
  fitDayIds?: string[];
  suitableDayIds?: string[];
  replacementFor?: string;
};

export type GuideCardImageDisplay = {
  url: string;
  alt: string;
};

export type SourceMarkerDisplay = {
  label: string;
  summary: string;
  url?: string;
  contexts?: string[];
  title?: string;
  publisher?: string;
  purpose?: "evidence" | "inspiration" | undefined;
  status?: "verified" | "recheck" | "stale" | "unknown" | undefined;
  documentStatus?: "verified" | "recheck" | "stale" | "unknown";
  retrievedAt?: string | undefined;
};

export type SourceGroupDisplay = {
  id: "needs_recheck" | "verified_with_recheck" | "verified" | "other";
  title: string;
  description: string;
  sources: SourceMarkerDisplay[];
};

export type ComparisonRow = {
  id: string;
  name: string;
  area: string;
  routeFit: string;
  timing: string;
  effort: string;
  sourceState: string;
  relatedPlaceId?: string;
  canAdd?: boolean;
  facts?: { label: string; value: string; sources: SourceMarkerDisplay[] }[];
  sources?: SourceMarkerDisplay[] | undefined;
};

export type DetailLinkDisplay = {
  label: string;
  url: string;
};

export type DetailSectionDisplay = {
  title: string;
  body?: string;
  items?: string[];
  sources?: SourceMarkerDisplay[];
};

export type DetailImageDisplay = {
  url: string;
  alt: string;
  caption?: string;
  source: SourceMarkerDisplay;
};

export type DetailEventDisplay = {
  id: string;
  title: string;
  description: string;
  dateLabel?: string;
  locationLabel?: string;
  sources: SourceMarkerDisplay[];
};

export type DetailGuideContextDisplay = {
  id: string;
  kind: "food" | "product" | "experience";
  label: string;
  title: string;
  description: string;
  context?: string;
  sources: SourceMarkerDisplay[];
};

type InformationalGuideTopic = {
  id: string;
  kind: "food" | "product" | "experience";
  type: Exclude<GuideFilter, "all">;
  label: string;
  title: string;
  summary: string;
  context?: string;
  evidence: BlueprintEvidenceRef[];
  relatedPlaceIds: string[];
};

export type DetailPlaceDisplay = {
  placeId: string;
  title: string;
  heroMeta: string[];
  priority: PlanPlacePriority;
  priorityLabel: string;
  priorityActions: PlacePriorityActionDisplay[];
  priorityBlockedNote?: string;
  bookingRelationshipNote?: string;
  leadTitle: string;
  leadBody: string;
  visitFacts: string[];
  image?: DetailImageDisplay;
  imageCandidates?: DetailImageDisplay[];
  planTitle?: string;
  planBody?: string;
  reservationNote?: string;
  visitNotes: DetailRequirementNoteDisplay[];
  detailSections: DetailSectionDisplay[];
  guideContext: DetailGuideContextDisplay[];
  relatedEvents: DetailEventDisplay[];
  sources: SourceMarkerDisplay[];
  sourceTitle?: string;
  itineraryContext?: DetailSectionDisplay;
  comparisonTitle?: string;
  comparisonRows: ComparisonRow[];
  primaryActionLabel: string;
  scheduled: boolean;
  scheduledDayId?: string;
  canAdd: boolean;
  canRemoveFromDay: boolean;
  itineraryDraftNote?: string;
  draftActionLabel?: string;
  removeActionLabel?: string;
  removeBlockedReason?: string;
  links: DetailLinkDisplay[];
};

export type DetailRequirementNoteDisplay = {
  id: string;
  title: string;
  body: string;
  completion?: string;
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
  sources?: SourceMarkerDisplay[] | undefined;
  dayId?: string | undefined;
  blockId?: string | undefined;
  placeId?: string | undefined;
  pinned?: boolean | undefined;
  hidden?: boolean | undefined;
};

export type TipGroupDisplay = {
  theme: string;
  tips: TipDisplay[];
};

export type PreparationChecklistItemDisplay = {
  id: string;
  taskId?: string;
  requirementId?: string;
  checklistItemId?: string;
  title: string;
  description?: string;
  completion?: string;
  context?: string;
  role: "action" | "general";
  checked: boolean;
  checkable: boolean;
  sources?: SourceMarkerDisplay[] | undefined;
  links?: DetailLinkDisplay[];
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

export function guideCardsForWorkspace(workspace: BlueprintWorkspaceDisplay, pendingEdits: PendingItineraryEditDisplay[] = [], selectedDayId?: string, selectedPlaceId?: string): GuideCardDisplay[] {
  const cards = pendingEdits.length
    ? workspace.guideCards.map((card) => guideCardWithPendingItineraryEdit(card, pendingItineraryEditForPlace(pendingEdits, card.placeId)))
    : workspace.guideCards;
  const selectedItinerary = workspace.itineraries.find((itinerary) => itinerary.dayId === selectedDayId);
  const selectedDayPlaceIds = new Set(selectedItinerary ? itineraryDisplayWithPending(selectedItinerary, workspace.places, pendingEdits).items.map((item) => item.placeId) : []);
  const fitsSelectedDay = (card: GuideCardDisplay) => Boolean(selectedDayId && ((selectedItinerary ? selectedDayPlaceIds.has(card.placeId) : card.timeline?.dayId === selectedDayId) || card.fitDayIds?.includes(selectedDayId) || card.suitableDayIds?.includes(selectedDayId)));
  const context = (card: GuideCardDisplay) => {
    const ids = card.relatedPlaceIds ?? [card.placeId];
    if (selectedPlaceId && ids.includes(selectedPlaceId)) return 0;
    if (selectedPlaceId && (workspace.relationships ?? []).some((relation) => (!relation.dayIds?.length || !selectedDayId || relation.dayIds.includes(selectedDayId)) && ((relation.fromPlaceId === selectedPlaceId && ids.includes(relation.toPlaceId)) || (relation.toPlaceId === selectedPlaceId && ids.includes(relation.fromPlaceId))))) return 1;
    if (fitsSelectedDay(card) || card.relatedPlaceIds?.some((id) => cards.some((place) => place.placeId === id && fitsSelectedDay(place)))) return 2;
    return 3;
  };
  const state = (card: GuideCardDisplay) => {
    if (card.state === "unscheduled" && card.canAdd) return 0;
    if (card.state === "optional" || card.state === "replacement") return 1;
    if (card.state === "unscheduled") return 2;
    if (card.state === "scheduled") return 3;
    return 4;
  };
  const secondary = (card: GuideCardDisplay) => {
    const sources = card.sources ?? [];
    const freshness = sources.some((source) => source.status === "stale") ? 2 : sources.some((source) => source.status === "recheck") ? 1 : sources.some((source) => source.status === "verified") ? 0 : 3;
    const latestRetrieval = Math.max(0, ...sources.map((source) => source.retrievedAt ? Date.parse(source.retrievedAt) || 0 : 0));
    const detail = workspace.details.find((item) => item.placeId === card.placeId);
    const richness = (detail?.detailSections.length ?? 0) + (detail?.guideContext.length ?? 0) + (detail?.relatedEvents.length ?? 0) + sources.length;
    return { freshness, latestRetrieval, richness, image: card.image ? 1 : 0 };
  };
  const sorted = cards.map((card, index) => ({ card, index, context: context(card), state: state(card), ...secondary(card) })).sort((a, b) =>
    a.context - b.context || a.state - b.state || a.freshness - b.freshness || b.latestRetrieval - a.latestRetrieval || b.richness - a.richness || b.image - a.image || a.index - b.index
  );
  // 同级主题放在自身最靠前的具体选项之前，不提升无关主题或跨越上下文等级。
  return sorted.map((item, index) => {
    const firstOption = sorted.findIndex((option) => option.context === item.context && item.card.relatedPlaceIds?.includes(option.card.placeId));
    return { ...item, order: index, position: firstOption < 0 ? index : Math.min(index, firstOption) };
  }).sort((a, b) => a.position - b.position || Number(Boolean(b.card.relatedPlaceIds)) - Number(Boolean(a.card.relatedPlaceIds)) || a.order - b.order).map(({ card }) => card);
}

export function detailDisplayForWorkspacePlace(workspace: BlueprintWorkspaceDisplay, placeId: string, pendingEdits: PendingItineraryEditDisplay[] = [], dayId?: string): DetailPlaceDisplay | undefined {
  const detail = workspace.detailForPlace?.(placeId,dayId) ?? workspace.details.find((candidate) => candidate.placeId === placeId);
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
    ? `${routeCount} travel leg${routeCount === 1 ? " needs" : "s need"} checking`
    : "No travel legs need checking";
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
  if (revision.replanReadiness?.status === "assisted_replanning_required") return "Landi needs to review the affected day before the itinerary is finalized";
  const reviewLabels = [
    impactDays.some((day) => day.requiresTimingReview) ? "timing" : "",
    impactDays.some((day) => day.requiresMealRestSpacingReview) ? "meal/rest spacing" : "",
    impactDays.some((day) => day.capacityRisk) ? "day pacing" : "",
    impactDays.some((day) => day.backtrackingRisk) ? "backtracking" : "",
    impactDays.some((day) => day.fixedTimeRisk) ? "fixed time slots" : ""
  ].filter(Boolean);
  if (!reviewLabels.length) return "";
  return `review ${reviewLabels.join(", ")} before the itinerary is finalized`;
}

export function pendingItineraryEditRequest(edit: PendingItineraryEditDisplay): string {
  if (edit.kind === "remove_place_from_day") return [
    "Apply this confirmed itinerary edit directly to the plan.",
    `Remove ${edit.placeName} from ${edit.dayLabel}.`,
    "Keep the place available in the guide for later planning.",
    "Check affected travel time, timing, meal, and opening constraints before finalizing the itinerary."
  ].join(" ");
  if (edit.kind === "move_place_within_day") return [
    "Apply this confirmed itinerary edit directly to the plan.",
    `Move ${edit.placeName} within ${edit.dayLabel}.`,
    `Placement: ${edit.positionLabel ?? "Updated day order"}.`,
    "Keep the place catalog unchanged and check affected travel legs before finalizing the itinerary."
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

export function buildBlueprintWorkspaceDisplay(plan: Plan, presentation: PlanPresentation, snapshot?: { blueprint: TripBlueprint; identity: {id:string;version:number} }): BlueprintWorkspaceDisplay {
  const bookingAction = snapshotBookingActionReader(snapshot);
  const tips = tipsForPresentation(plan, presentation);
  const dayTabs = groupedDayTabsForPresentation(presentation);
  const realDayTabs = presentation.days.map(dayTabForDay);
  const itineraries = uniqueByKey([
    ...dayTabs.map((day) => itineraryDisplayForTab(presentation, day, plan.sources)),
    ...presentation.days.map((day) => itineraryDisplayForDay(presentation, day, plan.sources))
  ], (itinerary) => itinerary.dayId);
  const informationalTopics = informationalGuideTopics(presentation);
  const workspace: BlueprintWorkspaceDisplay = {
    bookingAction,
    title: displayTripTitle(presentation, plan.title),
    dateLabel: blueprintDateLabel(plan, presentation),
    initialDayId: dayTabs[0]?.id ?? "",
    initialPlaceId: presentation.days[0]?.placeIds[0] ?? presentation.places[0]?.id ?? informationalTopics[0]?.id ?? "",
    mapFallback: mapFallbackForPlan(plan, presentation),
    areas: workspaceAreasForPresentation(presentation),
    days: dayTabs,
    placementDays: realDayTabs,
    places: presentation.places.map((place) => placeDisplayForPlace(place, presentation.travelTips, requirementsForPlace(presentation, place.id))),
    itineraries,
    guideFilters: blueprintGuideFilters,
    relationships: presentation.guideRelationshipGraph?.relationships ?? [],
    guideCards: guideCardsForPresentation(presentation, plan.sources, informationalTopics),
    details: [
      ...presentation.places.map((place) => detailDisplayForPlace(presentation, plan.sources, place)),
      ...informationalTopics.map((topic) => detailDisplayForInformationalTopic(presentation, topic))
    ],
    preparationGroups: preparationGroupsForPresentation(plan, presentation),
    tipGroups: groupTipsByTheme(tips),
    sources: sourceMarkersForPlan(plan, presentation),
    sourceGroups: sourceGroupsForPlan(plan, presentation),
    alternatives: structuredClone(presentation.alternatives ?? []),
    planAlternatives: planLevelAlternativesForPresentation(presentation),
    researchGrounding: structuredClone(presentation.researchGrounding ?? [])
  };
  return protectWorkspaceBookingActions(workspace, presentation, plan.sources, bookingAction);
}

/** 只读快照提示，不证明当前真实来源完整，也不授予保存或确认。 */
function snapshotBookingActionReader(snapshot?:{blueprint:TripBlueprint;identity:{id:string;version:number}}):BookingSnapshotActionReader {
  const blueprint=snapshot?.blueprint&&snapshot?.identity&&snapshot.blueprint.id===snapshot.identity.id&&snapshot.blueprint.version===snapshot.identity.version?snapshot.blueprint:undefined;
  const cache=new Map<string,BookingSnapshotAction>();
  return edit=>{
    const {kind,placeId,dayId,position}=edit;
    const key=JSON.stringify([kind,placeId,dayId,position?.kind,position?.kind==="after"?position.afterPlaceId:undefined]);const saved=cache.get(key);if(saved)return saved;
    let result:BookingSnapshotAction={knownFixed:false,unknown:true};
    if(blueprint&&(kind==="update_place_priority"||(Array.isArray(blueprint.days)&&blueprint.days.some(day=>day.id===dayId))))try{const protection=bookingRelationshipProtection(blueprint,edit);result={knownFixed:protection.knownFixed,unknown:protection.impact.unknown.length>0};}catch{/* 损坏或过期快照保持未知，交由真实审阅与预览恢复。 */}
    cache.set(key,result);return result;
  };
}
function independentFixedBooking(place:Pick<PlanPlace,'priority'|'reservation'|'display'>,requirements:BlueprintActionRequirement[]):boolean {
  return place.priority==='booked'||Boolean(reservationRequirementForPlace(requirements));
}
function protectWorkspaceBookingActions(workspace:BlueprintWorkspaceDisplay,presentation:PlanPresentation,planSources:SourceReference[],reader:BookingSnapshotActionReader):BlueprintWorkspaceDisplay {
  const independent=(id:string)=>{const place=presentation.places.find(place=>place.id===id);return Boolean(place&&independentFixedBooking(place,requirementsForPlace(presentation,id)));};
  const addAllowed=(id:string)=>!independent(id);
  const protectRows=(detail:DetailPlaceDisplay)=>({...detail,canAdd:detail.canAdd&&addAllowed(detail.placeId),comparisonRows:detail.comparisonRows.map(row=>row.relatedPlaceId&&row.canAdd?{...row,canAdd:addAllowed(row.relatedPlaceId)}:row)});
  workspace.detailForPlace=(id,dayId)=>{const place=presentation.places.find(place=>place.id===id);const detail=place?detailDisplayForPlace(presentation,planSources,place,reader,dayId):workspace.details.find(detail=>detail.placeId===id);return detail?protectRows(detail):undefined;};
  workspace.details=workspace.details.map(detail=>workspace.detailForPlace!(detail.placeId)!);
  workspace.places=workspace.places.map(place=>({...place,independentFixed:independent(place.id)}));
  workspace.guideCards=workspace.guideCards.map(card=>card.canAdd&&!addAllowed(card.placeId)?{...card,canAdd:false,addBlockedReason:'This arrangement involves a fixed booking.',footerNote:'Review the booking first or ask Landi to replan.'}:card);
  workspace.bookingDayForBlock=(tabId,placeId,blockId)=>{const tab=workspace.days.find(day=>day.id===tabId);const ids=tab?.dayIds?.length?tab.dayIds:[tabId];const matches=presentation.days.filter(day=>ids.includes(day.id)&&day.blocks?.some(block=>block.id===blockId&&block.placeId===placeId));return matches.length===1?matches[0]!.id:ids.length===1?ids[0]:undefined;};
  workspace.bookingDayByItem=Object.fromEntries(presentation.days.flatMap(day=>(workspace.itineraries.find(itinerary=>itinerary.dayId===day.id)?.items??[]).map(item=>[item.key,day.id])));
  workspace.itineraries=workspace.itineraries.map(itinerary=>protectItineraryBookingActions(itinerary,reader,workspace.bookingDayByItem));
  return workspace;
}
function protectItineraryBookingActions(itinerary:ItineraryDayDisplay,reader?:BookingSnapshotActionReader,dayByItem?:Record<string,string>):ItineraryDayDisplay {
  if(!reader)return itinerary;
  const protect=(items:ItineraryCardDisplay[],dayId:string)=>items.map(item=>item.reorderable&&reader({kind:'move_place_within_day',placeId:item.placeId,dayId:dayByItem?.[item.key]??dayId}).knownFixed?{...item,reorderable:false}:item);
  return {...itinerary,items:protect(itinerary.items,itinerary.dayId),...(itinerary.sections?{sections:itinerary.sections.map(section=>({...section,items:protect(section.items,section.dayId)}))}:{})};
}

function groupedDayTabsForPresentation(presentation: PlanPresentation): BlueprintDayTabDisplay[] {
  const days = presentation.days;
  const tabs: BlueprintDayTabDisplay[] = [];
  for (let index = 0; index < days.length;) {
    const run = transitRunAt(days, index);
    if (run.length > 1) {
      tabs.push(dayTabForTransitRun(run));
      index += run.length;
      continue;
    }
    tabs.push(dayTabForDay(days[index]!));
    index += 1;
  }
  return tabs;
}

function transitRunAt(days: ItineraryDay[], startIndex: number): ItineraryDay[] {
  const first = days[startIndex];
  if (!first || !dayCanStartTransitRun(first)) return [];
  const run = [first];
  for (let index = startIndex + 1; index < days.length; index += 1) {
    const candidate = days[index]!;
    if (!dayCanJoinTransitRun(candidate)) break;
    run.push(candidate);
    if (arrivalSettlingDay(candidate) || completeLocalDay(candidate)) break;
  }
  if (run.length < 2) return [];
  const terminal = run[run.length - 1]!;
  if (completeLocalDay(terminal)) return run.slice(0, -1).length > 1 ? run.slice(0, -1) : [];
  return run;
}

function dayCanStartTransitRun(day: ItineraryDay): boolean {
  return transitOrLogisticsDay(day) && !completeLocalDay(day) && !substantialLocalDay(day) && !hasSubstantialLocalActivity(day);
}

function dayCanJoinTransitRun(day: ItineraryDay): boolean {
  return (transitOrLogisticsDay(day) && !hasSubstantialLocalActivity(day)) || arrivalSettlingDay(day);
}

function transitOrLogisticsDay(day: ItineraryDay): boolean {
  if (dayKind(day) === "transit") return true;
  const startStatus = day.startContext?.status;
  const endStatus = day.endContext?.status;
  if (startStatus === "transport_node" || startStatus === "in_transit" || endStatus === "transport_node" || endStatus === "in_transit") return true;
  const text = dayPurposeText(day);
  return /\b(transit|in flight|flight|airport|arrival|arrive|departure|depart|transfer|check.?in|settle|journey|date.?line)\b|在途|航班|机场|抵达|到达|出发|中转|转机|接送|入住/.test(text);
}

function arrivalSettlingDay(day: ItineraryDay): boolean {
  const text = dayPurposeText(day);
  if (!/\b(arrival|arrive|airport|check.?in|settle|recovery)\b|抵达|到达|机场|入住|安顿/.test(text)) return false;
  return !completeLocalDay(day);
}

function completeLocalDay(day: ItineraryDay): boolean {
  if (!hasTransitContext(day)) return false;
  const localBlocks = localActivityBlocks(day);
  if (localBlocks.length < 2) return false;
  const localMinutes = localBlocks.reduce((total, block) => total + (block.durationMinutes ?? defaultLocalBlockMinutes(block)), 0);
  const hasPrimaryLocal = localBlocks.some((block) => block.primaryExperience || block.kind === "stop" || block.kind === "event");
  return hasPrimaryLocal && localMinutes >= 240;
}

function substantialLocalDay(day: ItineraryDay): boolean {
  return !hasTransitContext(day) && localActivityBlocks(day).length >= 2;
}

function hasSubstantialLocalActivity(day: ItineraryDay): boolean {
  return localActivityBlocks(day).some((block) => block.kind === "stop" || block.kind === "event" || block.primaryExperience || (block.durationMinutes ?? 0) >= 120);
}

function hasTransitContext(day: ItineraryDay): boolean {
  return day.startContext?.status === "transport_node"
    || day.startContext?.status === "in_transit"
    || day.endContext?.status === "transport_node"
    || day.endContext?.status === "in_transit"
    || dayKind(day) === "transit";
}

function localActivityBlocks(day: ItineraryDay): BlueprintItineraryBlock[] {
  return (day.blocks ?? []).filter((block) => {
    if (block.planRole === "optional" || block.planRole === "replacement") return false;
    if (block.kind === "transfer" || block.kind === "lodging" || block.kind === "rest") return false;
    const text = `${block.kind} ${block.role ?? ""} ${block.title ?? ""} ${block.summary ?? ""}`.toLocaleLowerCase();
    if (/\b(airport|flight|transfer|pickup|drop.?off|check.?in|check.?out|luggage|immigration|customs|declaration|levy|visa|passport|in transit)\b|机场|航班|接送|入境|行李|海关|申报|签证|护照|中转/.test(text)) return false;
    return Boolean(block.placeId || block.title?.trim() || block.summary?.trim());
  });
}

function defaultLocalBlockMinutes(block: BlueprintItineraryBlock): number {
  if (block.kind === "meal") return 75;
  if (block.kind === "event") return 120;
  if (block.kind === "flexible") return 90;
  return 120;
}

function dayPurposeText(day: ItineraryDay): string {
  return `${dayKind(day) ?? ""} ${day.city ?? ""} ${day.title ?? ""} ${day.summary ?? ""} ${day.startContext?.label ?? ""} ${day.endContext?.label ?? ""}`.toLocaleLowerCase();
}

function dayKind(day: ItineraryDay): string | undefined {
  return (day as ItineraryDay & { kind?: string }).kind;
}

function dayTabForTransitRun(days: ItineraryDay[]): BlueprintDayTabDisplay {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return {
    id: `tab-${first.id}-to-${last.id}`,
    label: dateRangeLabel(first, last),
    tabLabel: "Transit",
    shortLabel: dateRangeLabel(first, last),
    city: "Transit",
    title: "Transit",
    summary: days.map((day) => day.summary).filter(Boolean).join(" "),
    dayIds: days.map((day) => day.id),
    defaultDayId: last.id
  };
}

function dateRangeLabel(first: ItineraryDay, last: ItineraryDay): string {
  const firstLabel = compactMonthDay(first.date || first.shortLabel || first.label);
  const lastLabel = compactMonthDay(last.date || last.shortLabel || last.label);
  return firstLabel && lastLabel && firstLabel !== lastLabel ? `${firstLabel}-${lastLabel}` : firstLabel || lastLabel || first.label;
}

function compactMonthDay(value: string | undefined): string {
  if (!value) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}`;
  const slash = /^(\d{1,2})[/-](\d{1,2})$/.exec(value);
  if (slash) return `${Number(slash[1])}/${Number(slash[2])}`;
  return value;
}

function placeDisplayForPlace(place: PlanPlace, travelTips: PlanPresentation["travelTips"] = [], requirements: BlueprintActionRequirement[] = []): BlueprintPlaceDisplay {
  const signals = workspaceSignalsForPlace(place, requirements);
  const contextualTip = contextualTipForPlace(place, travelTips, {}, requirements);
  const placementNote = placementNoteForPlace(place, requirements);
  const image = guideCardImageForPlace(place);
  return {
    id: place.id,
    title: displayPlaceName(place),
    locationLabel: place.locationLabel,
    ...(image ? { image } : {}),
    ...(validPlaceCoordinates(place.coordinates) ? { coordinates: place.coordinates } : {}),
    markerType: markerTypeForPlace(place),
    ...(place.city ? { city: place.city } : {}),
    ...(place.area ? { area: place.area } : {}),
    ...(place.durationMinutes ? { durationLabel: `${place.durationMinutes} min` } : {}),
    priority: place.priority,
    priorityLabel: placePriorityLabel(place.priority),
    ...(place.schedulingEligibility ? { schedulingEligibility: place.schedulingEligibility } : {}),
    placementSignals: signals,
    ...(placementNote ? { placementNote } : {}),
    ...(contextualTip ? { contextualTip } : {})
  };
}

function workspaceSignalsForPlace(place: PlanPlace, requirements: BlueprintActionRequirement[] = []): BlueprintPlaceDisplay["placementSignals"] {
  const explicit = place.display?.workspaceSignals;
  if (explicit) {
    return {
      reservation: explicit.reservation,
      needsRecheck: explicit.needsRecheck,
      longStop: explicit.longStop
    };
  }
  const reservation = reservationRequirementForPlace(requirements);
  return {
    reservation: reservation ? "required" : place.reservation?.requirement === "required" ? "required" : place.reservation?.requirement === "recommended" ? "recommended" : "none",
    needsRecheck: requirementNeedsRecheck(requirements) || place.priority === "recheck" || place.reservation?.verification === "needs_recheck" || Boolean(place.evidenceSources?.some((source) => source.status && source.status !== "verified")),
    longStop: Boolean(place.durationMinutes && place.durationMinutes >= 180)
  };
}

function contextualTipForPlace(place: PlanPlace, travelTips: PlanPresentation["travelTips"] = [], context: { dayId?: string | undefined; blockId?: string } = {}, requirements: BlueprintActionRequirement[] = []): string | undefined {
  const placeTips = travelTips.filter((tip) => tip.placeId === place.id || (context.blockId && tip.blockId === context.blockId));
  const matchingTip = placeTips.find((tip) => context.blockId && tip.blockId === context.blockId)
    ?? placeTips.find((tip) => context.dayId && tip.dayId === context.dayId)
    ?? placeTips.find((tip) => !tip.dayId && !tip.blockId)
    ?? placeTips[0];
  const tipText = matchingTip?.body || place.tip || requirementContextualTip(requirements) || place.reservation?.note || workspaceSignalTip(workspaceSignalsForPlace(place, requirements));
  const cleanTip = travelerFacingDefaultText(tipText);
  const sentence = cleanTip ? firstUsefulSentence(cleanTip) || cleanTip : "";
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
    ...(validPlaceCoordinates(place.coordinates) ? { coordinates: place.coordinates } : {})
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
    label: routeDisplayLabel(segment),
    verification: segment.verification,
    needsRefresh,
    mapLineState: segment.verification === "verified" ? "formal" : segment.display?.mapLineState ?? (needsRefresh ? "needs_refresh" : "formal"),
    ...(refreshReason ? { refreshReason } : {}),
    ...(routeDurationDisplayLabel(segment) ? { durationLabel: routeDurationDisplayLabel(segment)! } : {}),
    ...(travelerFacingDefaultText(segment.detail) ? { detail: travelerFacingDefaultText(segment.detail) } : {}),
    sources: sourceSummariesForRouteSegment(segment, planSources, sourceCatalog)
  };
}

function routeDisplayLabel(segment: PlanRouteSegment): string {
  return travelerFacingLabel(segment.display?.routeLabel?.trim() || segment.label, routeFallbackLabel(segment));
}

function routeFallbackLabel(segment: PlanRouteSegment): string {
  const duration = routeDurationDisplayLabel(segment);
  if (!duration && segment.verification === "needs_verification" && !segment.evidence?.length) return "Travel time to confirm";
  if (segment.mode === "walking") return duration ? `${duration} walk` : "Walk between stops";
  if (segment.mode === "transit") return duration ? `${duration} by transit` : "Transit between stops";
  if (segment.mode === "driving") return duration ? `${duration} by car` : "Go by car";
  return duration ? `${duration} journey` : "Travel time to confirm";
}

function routeDurationDisplayLabel(segment: Pick<PlanRouteSegment, "durationMinutes" | "verification" | "evidence">): string | undefined {
  if (!segment.durationMinutes) return undefined;
  if (segment.verification === "verified") return `${segment.durationMinutes} min`;
  if (segment.evidence?.length) return `~${segment.durationMinutes} min`;
  return undefined;
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
  if (segment.display?.refreshReason?.trim()) return travelerFacingRouteCheckReason(segment.display.refreshReason);
  return directEditRouteNeedsRefresh(segment) ? "Check travel time after this stop." : undefined;
}

function travelerFacingRouteCheckReason(value: string): string {
  if (/^refresh\b/i.test(value.trim())) return "Check travel time after this stop.";
  return travelerFacingDefaultText(value) || "Check travel time after this stop.";
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
    ...(day.title ? { title: day.title } : {}),
    ...(day.summary ? { summary: day.summary } : {}),
    ...(day.startContext ? { startContext: structuredClone(day.startContext) } : {}),
    ...(day.endContext ? { endContext: structuredClone(day.endContext) } : {})
  };
}

function guideTypeForPlace(place: Pick<PlanPlace, "category" | "visitRole" | "name" | "display">): GuideFilter {
  const explicit = place.display?.type;
  if (explicit) return explicit;
  const text = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/\b(hotel|accommodation|lodg|villa|resort|inn|guesthouse|check.?in|check.?out)\b/.test(text)) return "stay";
  if (/\b(airport|station|terminal|flight|rail|train|metro|subway|bus|ferry|transfer|transport|taxi|shuttle)\b/.test(text)) return "transport";
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
  const text = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/\b(hotel|accommodation|lodging|lodge|villa|resort|inn|guesthouse|airport|station|terminal|flight|rail|train|metro|subway|bus|ferry|transfer|transport)\b/.test(text)) return false;
  return true;
}

function guideStateForPlace(place: PlanPlace, scheduledPlaceIds: Set<string>, alternative?: { kind: "optional" | "replacement" }): GuideState {
  if (scheduledPlaceIds.has(place.id)) return "scheduled";
  if (alternative) return alternative.kind;
  if (place.guideDisplay?.state === "informational") return "informational";
  if (place.guideDisplay?.state === "unscheduled") return "unscheduled";
  if (place.schedulingEligibility?.decision === "informational") return "informational";
  const text = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/informational|theme|local food|local product|background|context/.test(text)) return "informational";
  return "unscheduled";
}

function visibleTimelineBlock(block: BlueprintItineraryBlock, place: PlanPlace | undefined, routeAnchor: boolean, requirements: BlueprintActionRequirement[]): boolean {
  if (block.planRole === "optional" || block.planRole === "replacement") return false;
  const text = `${block.kind} ${block.role ?? ""} ${block.title ?? ""} ${block.summary ?? ""}`.toLocaleLowerCase();
  const filler = /\b(free time|flexible time|open time|slow morning|easy morning|quiet evening|free evening|relax|take it easy|leisure time|unhurried time|downtime|enjoy the evening)\b|自由时间|放松|休闲|慢节奏/.test(text);
  const necessaryBreak = /\b(required|must|fixed|appointment|medical|medication|health|childcare|work call|meeting|pickup|ticket|booking|reservation|jet.?lag|recovery|heat|rain)\b|必须|固定|预约|药|医疗|健康|会议|接送|预订|订票|时差|恢复|高温|避雨/.test(text);
  // Planned/display metadata must not turn an empty buffer into a visible activity.
  if (["rest", "flexible"].includes(block.kind) && !place && !routeAnchor && !block.eventId && !requirements.length && filler && !necessaryBreak) return false;
  if (block.planRole === "planned" && (block.title?.trim() || block.summary?.trim() || block.startTime || block.durationMinutes)) return true;
  if (place || routeAnchor || block.eventId) return true;
  if (block.display?.timeLabel || block.display?.meta || block.display?.routeAnchor !== undefined || block.display?.reorderable !== undefined) return true;
  if (requirements.length) return true;
  if (block.kind === "transfer") return /\b(transfer|route|journey|arrival|airport|station|pickup|drop.?off|traffic|licensed|confirmed|meeting point)\b|\btransfer to\b|行程|路线|交通|抵达|机场|车站|接送|集合点/.test(text);
  if (block.kind === "lodging" || blockImpliesPendingPlace(block)) return /\b(tbd|to be determined|not selected|not confirmed|unconfirmed|choose|select|confirm|pending|reservation|booking|ticket|pickup point|meeting point|check.?in|check.?out|settle)\b|待定|未定|未选择|未确认|选择|确认|预订|订票|集合点|入住|退房|安顿/.test(text);
  if (block.kind === "meal") return meaningfulLightTimelineBlock(block) || /\b(reservation|booking|ticket|required|fixed|confirm|not selected|tbd|meeting|pickup)\b|预订|确认|待定|未选择|集合/.test(text);
  if (block.kind === "rest" || block.kind === "flexible") return meaningfulLightTimelineBlock(block) || /\b(required|must|fixed|appointment|medical|medication|health|childcare|work call|meeting|pickup|ticket|booking|reservation)\b|必须|固定|预约|药|医疗|健康|会议|接送|预订|订票/.test(text);
  return /\b(required|must|fixed|confirmed|reservation|booking|ticket|choose|select|confirm|pending|pickup|meeting point|documents?)\b|必须|固定|确认|预订|订票|选择|待定|集合点|证件/.test(text);
}

function meaningfulLightTimelineBlock(block: BlueprintItineraryBlock): boolean {
  if (!block.startTime && !block.endTime && !block.display?.timeLabel) return false;
  const text = `${block.role ?? ""} ${block.title ?? ""} ${block.summary ?? ""}`.toLocaleLowerCase();
  if (genericFillerTimelineText(text)) return false;
  if (block.kind === "meal") return /\b(breakfast|brunch|lunch|dinner|meal|food|restaurant|warung|cafe|coffee|market|near|around|central|base|hotel|lodging|accommodation|airport|station|temple|museum|beach|ubud|jimbaran|kuta|seminyak|sanur|nusa dua|uluwatu|denpasar)\b|早餐|午餐|晚餐|餐|咖啡|餐厅|附近|基地|酒店|机场|车站/.test(text);
  if (block.kind === "rest") return /\b(rest|recover|recovery|break|pause|cafe|coffee|cool.?down|shower|regroup|luggage|after|before|near|base|hotel|lodging|accommodation|airport|station|heat|rain|child|elder|jet.?lag)\b|休息|恢复|暂停|咖啡|酒店|行李|降温/.test(text);
  if (block.kind === "flexible") return /\b(window|flexible|buffer|optional|weather|rain|heat|low.?energy|shopping|walk|market|neighborhood|near|around|base|hotel|lodging|accommodation|before|after|between)\b|机动|缓冲|天气|低体力|购物|散步|附近/.test(text);
  return false;
}

function genericFillerTimelineText(text: string): boolean {
  return /\b(free time|flexible time|open time|slow morning|easy morning|quiet evening|free evening|relax|take it easy|leisure time|unhurried time|downtime|enjoy the evening)\b|自由时间|放松|休闲|慢节奏/.test(text)
    && !/\b(near|around|base|hotel|lodging|accommodation|airport|station|before|after|between|luggage|check.?in|check.?out|meal|breakfast|lunch|dinner|cafe|coffee|market|weather|heat|rain|medical|medication)\b|附近|基地|酒店|机场|行李|入住|退房|早餐|午餐|晚餐|咖啡|天气|医疗/.test(text);
}

function timelineBlocksForDay(presentation: PlanPresentation, day: ItineraryDay): TimelineBlock[] {
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  const displayDay = dayTabForDay(day);
  if (day.blocks) {
    const scheduledPlaceIds = new Set(day.placeIds);
    const orderedBlocks = [...day.blocks].sort((left, right) => left.order - right.order);
    return orderedBlocks.flatMap((block, index) => {
      const recommendedStay = recommendedStayForUnselectedBlock(presentation, day, block);
      const visibleBlock = recommendedStay ? { ...block, placeId: recommendedStay.id, title: `Recommended stay: ${recommendedStay.name}`, summary: "Suggested accommodation base; no booking has been made." } : block;
      if (semanticTransferCoveredByFormalRoute(visibleBlock, day.id, presentation.routeSegments, placeById)) return [];
      const place = visibleBlock.placeId ? placeById.get(visibleBlock.placeId) : undefined;
      if (visibleBlock.placeId && !place) return [];
      const requirements = place ? requirementsForPlace(presentation, place.id) : [];
      const routeAnchor = visibleBlock.display?.routeAnchor ?? Boolean(place && scheduledPlaceIds.has(place.id) && !["event", "transfer"].includes(visibleBlock.kind));
      if (!visibleTimelineBlock(visibleBlock, place, routeAnchor, requirements)) return [];
      const reorderable = Boolean(routeAnchor && place && ((visibleBlock.display?.reorderable !== false && directMoveAllowed(place, requirements))));
      const nextPlaceId = orderedBlocks.slice(index + 1).find((next) => next.placeId && next.placeId !== place?.id && next.kind !== "transfer" && (next.display?.routeAnchor ?? (scheduledPlaceIds.has(next.placeId) && !["event", "transfer"].includes(next.kind))) && next.planRole !== "optional" && next.planRole !== "replacement")?.placeId;
      const routeAfter = routeAnchor && place && nextPlaceId ? presentation.routeSegments.find((segment) => segment.dayId === day.id && segment.originPlaceId === place.id && segment.destinationPlaceId === nextPlaceId) : undefined;
      const status = timelineStatusForBlock(visibleBlock, place, requirements);
      const contextualTip = place ? contextualTipForPlace(place, presentation.travelTips, { dayId: day.id, blockId: visibleBlock.id }, requirements) : undefined;
      return [{
        day: displayDay,
        ...(place ? { place } : {}),
        block: visibleBlock,
        order: visibleBlock.order,
        timeLabel: deriveTimelineTimeDisplay(visibleBlock, place, index).label
          ?? (index === 0 && visibleBlock.kind === "lodging" && place
            ? orderedBlocks.slice(1).find((next) => next.kind === "transfer" && next.planRole !== "optional" && next.planRole !== "replacement")?.startTime ?? "" : ""),
        type: place ? guideTypeForPlace(place) : blockGuideType(visibleBlock),
        timelineRole: timelineRoleForBlock(visibleBlock, place),
        ...(blockTitle(visibleBlock, place) ? { title: blockTitle(visibleBlock, place)! } : {}),
        ...(blockMeta(visibleBlock) ? { meta: blockMeta(visibleBlock)! } : {}),
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
    const requirements = requirementsForPlace(presentation, place.id);
    const routeAfter = presentation.routeSegments.find((segment) => segment.dayId === day.id && segment.originPlaceId === place.id);
    const status = itineraryBlockStatus(place, requirements);
    const contextualTip = contextualTipForPlace(place, presentation.travelTips, { dayId: day.id }, requirements);
    return [{
      day: displayDay,
      place,
      order: stop.order,
      timeLabel: roughTimeLabel(stop.time, stop.role, place, index),
      type: guideTypeForPlace(place),
      timelineRole: timelineRoleForPlace(place),
      routeAnchor: true,
      ...(directMoveAllowed(place, requirements) ? { reorderable: true } : {}),
      ...(status ? { status } : {}),
      ...(contextualTip ? { contextualTip } : {}),
      ...(routeAfter ? { routeAfter } : {})
    }];
  });
}

function recommendedStayForUnselectedBlock(presentation: PlanPresentation, day: ItineraryDay, block: BlueprintItineraryBlock): PlanPlace | undefined {
  if (block.kind !== "lodging" || block.placeId || !/\b(?:hotel|accommodation|lodging).*(?:not selected|pending)\b/i.test(`${block.title ?? ""} ${block.summary ?? ""}`)) return undefined;
  if (presentation.bookingConstraints?.some((constraint) => constraint.type === "accommodation" && constraint.status !== "cancelled" && constraint.segments.some((segment) =>
    segment.segmentType === "hotel_stay" && (!segment.startAtLocal || !segment.endAtLocal || (segment.startAtLocal.slice(0, 10) <= (day.date ?? "") && segment.endAtLocal.slice(0, 10) > (day.date ?? "")))
  ))) return undefined;
  const city = day.city?.trim().toLocaleLowerCase();
  if (!city) return undefined;
  const candidates = presentation.places.filter((place) => place.accommodation?.state === "recommended" && (place.city?.trim().toLocaleLowerCase() === city || place.accommodation.baseLabel?.trim().toLocaleLowerCase() === city));
  const priority = (place: PlanPlace) => place.priority === "preferred" || place.priority === "must" ? 4 : place.priority === "nearby" ? 3 : place.priority === "pending" ? 1 : 2;
  const property = (place: PlanPlace) => /\bhotel\b/i.test(place.category) ? 3 : /\b(motel|lodge)\b/i.test(place.category) ? 2 : 1;
  return candidates.sort((left, right) => priority(right) + property(right) - priority(left) - property(left) || left.name.localeCompare(right.name))[0];
}

function semanticTransferCoveredByFormalRoute(block: BlueprintItineraryBlock, dayId: string, segments: PlanRouteSegment[], placeById: Map<string, PlanPlace>): boolean {
  if (block.kind !== "transfer") return false;
  const transferText = normalizedRouteEndpointText(`${block.title ?? ""} ${block.summary ?? ""}`);
  if (!transferText) return false;
  return segments.some((segment) => {
    if (segment.dayId !== dayId || !routeSegmentShowsAsFormalRoute(segment)) return false;
    const origin = placeById.get(segment.originPlaceId);
    const destination = placeById.get(segment.destinationPlaceId);
    if (!origin || !destination) return false;
    const originName = normalizedRouteEndpointText(displayPlaceName(origin));
    const destinationName = normalizedRouteEndpointText(displayPlaceName(destination));
    return originName.length >= 4 && destinationName.length >= 4 && transferText.includes(originName) && transferText.includes(destinationName);
  });
}

function normalizedRouteEndpointText(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function itineraryDisplayForDay(presentation: PlanPresentation, day: ItineraryDay, planSources: SourceReference[] = [], pendingEdit?: PendingItineraryEditDisplay | null): ItineraryDayDisplay {
  const blocks = timelineBlocksForDay(presentation, day);
  return itineraryDisplayFromBlocks(dayTabForDay(day), blocks, dayAlternativesForDay(day), presentation.places, planSources, presentation.sourceCatalog, presentation.travelTips, pendingEdit);
}

function itineraryDisplayForTab(presentation: PlanPresentation, tab: BlueprintDayTabDisplay, planSources: SourceReference[] = []): ItineraryDayDisplay {
  const dayIds = tab.dayIds?.length ? tab.dayIds : [tab.id];
  if (dayIds.length <= 1) {
    const day = presentation.days.find((candidate) => candidate.id === dayIds[0]) ?? presentation.days.find((candidate) => candidate.id === tab.id);
    return day ? itineraryDisplayForDay(presentation, day, planSources) : emptyItineraryDayDisplay();
  }
  const sections = dayIds.flatMap((dayId, index) => {
    const sourceDay = presentation.days.find((candidate) => candidate.id === dayId);
    if (!sourceDay) return [];
    const section = itineraryDisplayForDay(presentation, sourceDay, planSources);
    return {
      key: sourceDay.id,
      heading: sectionHeadingForDay(sourceDay, index, dayIds.length),
      dayId: sourceDay.id,
      day: section.day,
      ...(section.dayContext ? { dayContext: section.dayContext } : {}),
      dayAlternatives: section.dayAlternatives,
      items: section.items
    };
  });
  const combinedItems = sections.flatMap((section) => section.items);
  const combinedAlternatives = sections.flatMap((section) => section.dayAlternatives);
  const sectionDisplays = dayIds.flatMap((dayId) => {
    const sourceDay = presentation.days.find((candidate) => candidate.id === dayId);
    return sourceDay ? [itineraryDisplayForDay(presentation, sourceDay, planSources)] : [];
  });
  return {
    dayId: tab.id,
    day: tab,
    dayAlternatives: combinedAlternatives,
    items: combinedItems,
    sections,
    placementOptions: [],
    routePlaces: uniqueByKey(sectionDisplays.flatMap((section) => section.routePlaces), (place) => place.placeId),
    routeSegments: sectionDisplays.flatMap((section) => section.routeSegments),
    markers: uniqueByKey(sectionDisplays.flatMap((section) => section.markers), (marker) => marker.placeId)
  };
}

export function itineraryDisplayForWorkspace(workspace: BlueprintWorkspaceDisplay, dayId: string, pendingEdit?: PendingItineraryEditDisplay | PendingItineraryEditDisplay[] | null): ItineraryDayDisplay {
  const base = workspace.itineraries.find((candidate) => candidate.dayId === dayId) ?? workspace.itineraries[0];
  if (!base) return emptyItineraryDayDisplay();
  return protectItineraryBookingActions(itineraryDisplayWithPending(base, workspace.places, pendingEdit),workspace.bookingAction,workspace.bookingDayByItem);
}

function sectionHeadingForDay(day: ItineraryDay, index = 0, groupLength = 1): string {
  const date = compactMonthDay(day.date || day.shortLabel || day.label);
  const purpose = conciseDayPurposeLabel(day, index, groupLength);
  return [date, purpose].filter(Boolean).join(" · ");
}

function conciseDayPurposeLabel(day: ItineraryDay, index = 0, groupLength = 1): string {
  if (groupLength > 1 && index === 0) return "Departure";
  if (groupLength > 1 && index === groupLength - 1 && arrivalSettlingDay(day)) return "Arrival";
  const text = dayPurposeText(day);
  if (/\bdeparture|depart\b|出发/.test(text)) return "Departure";
  if (/\barrival|arrive|dps|抵达|到达/.test(text)) return "Arrival";
  if (/\bin transit|transit|flight|date.?line|中转|在途/.test(text)) return "In transit";
  if (/\btransfer|base change|接送|转场/.test(text)) return "Transfer";
  return day.title || day.city || "Trip day";
}

function uniqueByKey<T>(items: T[], keyForItem: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyForItem(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itineraryDisplayFromBlocks(day: BlueprintDayTabDisplay, blocks: TimelineBlock[], dayAlternatives: AlternativeDisplay[], places: PlanPlace[], planSources: SourceReference[], sourceCatalog: BlueprintSource[] = [], travelTips: PlanPresentation["travelTips"] = [], pendingEdit?: PendingItineraryEditDisplay | null): ItineraryDayDisplay {
  const routeSegments = blocks.slice(0, -1).flatMap((block) => {
    const routeSegment = block.routeAfter ? routeSegmentDisplayForSegment(block.routeAfter, planSources, sourceCatalog) : undefined;
    return routeSegment ? [routeSegment] : [];
  });
  const routeRefresh = routeRefreshDisplayForDay(day, routeSegments);
  const dayContext = dayContextDisplayForDay(day, blocks);
  const base = {
    dayId: day.id,
    day,
    ...(dayContext ? { dayContext } : {}),
    dayAlternatives,
    items: blocks.map((block) => itineraryCardForBlock(block, places)),
    placementOptions: itineraryPlacementOptions(blocks),
    routePlaces: blocks.flatMap((block) => block.place && block.routeAnchor && validPlaceCoordinates(block.place.coordinates) ? [mapPointForPlace(block.place)] : []),
    routeSegments,
    ...(routeRefresh ? { routeRefresh } : {}),
    markers: blocks.flatMap((block) => {
      const place = block.place;
      if (!place || !block.routeAnchor || !validPlaceCoordinates(place.coordinates)) return [];
      return {
        placeId: place.id,
        title: displayPlaceName(place),
        type: markerTypeForPlace(place),
        coordinates: place.coordinates,
        markerState: "on-day" as const,
        priority: place.priority
      };
    })
  };
  return itineraryDisplayWithPending(base, places.map((place) => placeDisplayForPlace(place, travelTips)), pendingEdit);
}

function dayAlternativesForDay(day: ItineraryDay): AlternativeDisplay[] {
  return [...(day.blocks ?? [])]
    .sort((left, right) => left.order - right.order)
    .flatMap((block) => {
    if (block.planRole !== "optional" && block.planRole !== "replacement") return [];
    const title = travelerFacingDefaultText(block.title ?? "");
    const summary = travelerFacingDefaultText(block.summary ?? "");
    if (!title && !summary) return [];
    const kind = block.planRole === "replacement" ? "replacement" : "optional";
    const replacementFor = travelerFacingDefaultText(block.replacementFor ?? "");
    const condition = conciseAlternativeCondition(block);
    return {
      key: block.id,
      kind,
      label: alternativeKindLabel(kind),
      title: title || "Alternative option",
      summary,
      ...(replacementFor ? { replacementFor } : {}),
      ...(condition ? { condition } : {})
    };
  });
}

function planLevelAlternativesForPresentation(presentation: PlanPresentation): AlternativeDisplay[] {
  return (presentation.alternatives ?? [])
    .filter((alternative) => alternative.kind === "excluded")
    .flatMap((alternative, index) => {
      const title = travelerFacingDefaultText(alternative.title);
      const summary = travelerFacingDefaultText(alternative.summary);
      if (!title && !summary) return [];
      return [{
        key: `plan-alternative-${index}`,
        kind: alternative.kind,
        label: alternativeKindLabel(alternative.kind),
        title: title || "Considered option",
        summary,
        ...(alternative.replacementFor ? { replacementFor: alternative.replacementFor } : {})
      }];
    });
}

function alternativeKindLabel(kind: BlueprintPlanAlternative["kind"]): string {
  if (kind === "replacement") return "Could swap";
  if (kind === "excluded") return "Left out";
  return "Optional";
}

function conciseAlternativeCondition(block: BlueprintItineraryBlock): string | undefined {
  const condition = block.operationalConditions?.map(alternativeConditionText).find(Boolean);
  return condition || undefined;
}

function alternativeConditionText(condition: NonNullable<BlueprintItineraryBlock["operationalConditions"]>[number]): string | undefined {
  if (condition.note?.trim()) return travelerFacingDefaultText(condition.note);
  if (condition.kind === "weather") return "Weather dependent";
  if (condition.kind === "route") return "Check route after hotel selection";
  if (condition.kind === "reservation") return "Reservation dependent";
  if (condition.kind === "session") return "Session time dependent";
  if (condition.kind === "access") return "Check current access";
  if (condition.kind === "traveler_choice") return "Traveler choice";
  if (condition.kind === "recheck") return "Needs recheck";
  return undefined;
}

function dayContextDisplayForDay(day: BlueprintDayTabDisplay, blocks: TimelineBlock[]): DayContextDisplay | undefined {
  const start = contextLabel(day.startContext?.label);
  const end = contextLabel(day.endContext?.label);
  if (!start && !end) return undefined;
  const hasVisibleTimeline = blocks.length > 0;
  const contextChanged = Boolean(start && end && normalizeContextLabel(start) !== normalizeContextLabel(end));
  const transitContext = day.startContext?.status === "transport_node"
    || day.startContext?.status === "in_transit"
    || day.endContext?.status === "transport_node"
    || day.endContext?.status === "in_transit";
  const dayText = `${day.label} ${day.title ?? ""} ${day.summary ?? ""}`.toLocaleLowerCase();
  const transitDay = /\b(arrival|arrive|airport|flight|transfer|transit|departure|depart|base change|check.?in|check.?out)\b|抵达|到达|机场|航班|中转|转场|离开|出发|退房/.test(dayText);
  if (hasVisibleTimeline && !contextChanged && !transitContext) return undefined;
  if (!hasVisibleTimeline && !contextChanged && !transitContext && !transitDay) return undefined;
  return {
    ...(start ? { startLabel: start } : {}),
    ...(end ? { endLabel: end } : {}),
    ...(!hasVisibleTimeline && day.summary ? { summary: day.summary } : {})
  };
}

function contextLabel(value: string | undefined): string | undefined {
  const cleaned = travelerFacingDefaultText(value ?? "");
  return cleaned || undefined;
}

function normalizeContextLabel(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function itineraryDisplayWithPending(base: ItineraryDayDisplay, places: BlueprintPlaceDisplay[], pendingEdit?: PendingItineraryEditDisplay | PendingItineraryEditDisplay[] | null): ItineraryDayDisplay {
  const compactEdits = compactPendingItineraryEdits(Array.isArray(pendingEdit) ? pendingEdit : pendingEdit ? [pendingEdit] : []);
  if (base.sections?.length) {
    const sections = base.sections.map((section) => {
      const sectionBase: ItineraryDayDisplay = {
        dayId: section.dayId,
        day: section.day,
        ...(section.dayContext ? { dayContext: section.dayContext } : {}),
        dayAlternatives: section.dayAlternatives,
        items: section.items,
        placementOptions: itineraryPlacementOptionsForItems(section.items),
        routePlaces: [],
        routeSegments: [],
        markers: []
      };
      const updated = itineraryDisplayWithPending(sectionBase, places, compactEdits);
      return {
        ...section,
        ...(updated.dayContext ? { dayContext: updated.dayContext } : {}),
        dayAlternatives: updated.dayAlternatives,
        items: updated.items
      };
    });
    return {
      ...base,
      sections,
      items: sections.flatMap((section) => section.items)
    };
  }
  const edits = compactEdits.filter((edit) => edit.dayId === base.dayId);
  if (!edits.length) return base;
  let items = base.items.map(({ routeAfterLabel: _routeAfterLabel, routeAfterStatusLabel: _routeAfterStatusLabel, ...item }) => item);
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
    if (validPlaceCoordinates(pendingPlace.coordinates) && !markers.some((marker) => marker.placeId === pendingPlace.id)) {
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
    items: edits.every((edit) => edit.kind === "move_place_within_day") ? items : itineraryItemsWithPendingRouteCheckReadouts(items),
    routePlaces,
    routeSegments,
    markers,
    routeRefresh: draftRouteRefreshDisplayForPendingEdits(base, items, places, edits)
  };
}

function itineraryPlacementOptionsForItems(items: ItineraryCardDisplay[]): ItineraryPlacementOption[] {
  const placeItems = items.filter((item) => item.kind === "block" && item.placeId && item.routeAnchor);
  return [
    { id: "start", label: "At the start of the day", kind: "start" },
    ...placeItems.map((item) => ({ id: `after-${item.placeId}`, label: `After ${item.title}`, kind: "after" as const, afterPlaceId: item.placeId })),
    { id: "end", label: "At the end of the day", kind: "end" }
  ];
}

function samePendingItineraryEditTarget(left: PendingItineraryEditDisplay, right: PendingItineraryEditDisplay): boolean {
  if (left.kind !== right.kind || left.placeId !== right.placeId) return false;
  return left.kind === "add_place_to_day" || left.dayId === right.dayId;
}

function pendingItineraryEditForPlace(edits: PendingItineraryEditDisplay[], placeId: string): PendingItineraryEditDisplay | undefined {
  return compactPendingItineraryEdits(edits).filter((edit) => edit.placeId === placeId).at(-1);
}

function guideCardWithPendingItineraryEdit(card: GuideCardDisplay, edit: PendingItineraryEditDisplay | undefined): GuideCardDisplay {
  if (!edit || edit.kind === "move_place_within_day") return card;
  if (edit.kind === "remove_place_from_day") {
    const { timeline: _timeline, ...rest } = card;
    return {
      ...rest,
      state: "unscheduled",
      canAdd: true,
      actionLabel: card.actionLabel ?? "Add",
      draftActionLabel: "Undo draft",
      planFitLabel: `Removed from ${edit.dayLabel} (not saved)`,
      footerNote: `Removed from ${edit.dayLabel} (not saved)`
    };
  }
  const { actionLabel: _actionLabel, addBlockedReason: _addBlockedReason, ...rest } = card;
  return {
    ...rest,
    state: "scheduled",
    canAdd: false,
    draftActionLabel: "Undo draft",
    planFitLabel: `Added to ${edit.dayLabel} (not saved)`,
    footerNote: `Added to ${edit.dayLabel} (not saved)`,
    timeline: { dayId: edit.dayId, label: edit.dayLabel, timeLabel: edit.kind === "add_place_to_day" ? "Draft" : "Not saved" }
  };
}

function detailWithPendingItineraryEdit(detail: DetailPlaceDisplay, edit: PendingItineraryEditDisplay | undefined): DetailPlaceDisplay {
  if (!edit || edit.kind === "move_place_within_day") return detail;
  if (edit.kind === "remove_place_from_day") {
    const { priorityBlockedNote: _priorityBlockedNote, removeActionLabel: _removeActionLabel, removeBlockedReason: _removeBlockedReason, ...rest } = detail;
    return {
      ...rest,
    scheduled: false,
    canAdd: true,
    canRemoveFromDay: false,
    primaryActionLabel: "Add to itinerary",
    priorityActions: placePriorityActions({ priority: detail.priority }, false),
    itineraryContext: { title: "In your itinerary", body: `Removed from ${edit.dayLabel} in this draft.`, items: ["Not saved yet."] },
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
    itineraryContext: { title: "In your itinerary", body: `Added to ${edit.dayLabel} in this draft.`, items: ["Not saved yet."] },
    itineraryDraftNote: `Added to ${edit.dayLabel} (not saved).`,
    draftActionLabel: "Undo draft"
  };
}

export function scheduledDayIdForPlace(workspace: BlueprintWorkspaceDisplay, placeId: string): string | undefined {
  for (const itinerary of workspace.itineraries) {
    for (const section of itinerary.sections ?? []) {
      if (section.items.some((item) => item.kind === "block" && item.placeId === placeId && item.routeAnchor)) return section.dayId;
    }
    if (workspace.placementDays.some((day) => day.id === itinerary.dayId) && itinerary.items.some((item) => item.kind === "block" && item.placeId === placeId && item.routeAnchor)) return itinerary.dayId;
  }
  return undefined;
}

function guideCardsForPresentation(presentation: PlanPresentation, planSources: SourceReference[] = [], informationalTopics = informationalGuideTopics(presentation)): GuideCardDisplay[] {
  const scheduledPlaceIds = new Set(presentation.days.flatMap((day) => day.placeIds));
  const alternativeByPlace = new Map<string, { kind: "optional" | "replacement"; dayId: string; dayLabel: string; replacementFor?: string }>();
  for (const day of presentation.days) {
    for (const block of day.blocks ?? []) {
      if (!block.placeId || (block.planRole !== "optional" && block.planRole !== "replacement") || alternativeByPlace.has(block.placeId)) continue;
      alternativeByPlace.set(block.placeId, {
        kind: block.planRole,
        dayId: day.id,
        dayLabel: day.shortLabel ?? day.label ?? day.date,
        ...(block.replacementFor ? { replacementFor: block.replacementFor } : {})
      });
    }
  }
  const firstTimelineByPlace = new Map<string, GuideCardDisplay["timeline"]>();
  for (const day of presentation.days) {
    for (const block of timelineBlocksForDay(presentation, day)) {
      const place = block.place;
      if (!place || !block.routeAnchor || firstTimelineByPlace.has(place.id)) continue;
      firstTimelineByPlace.set(place.id, { dayId: day.id, label: day.shortLabel ?? day.label ?? day.date, timeLabel: block.timeLabel });
    }
  }
  const placeCards = presentation.places
    .filter(isGuidePlace)
    .flatMap((place) => {
      const alternative = alternativeByPlace.get(place.id);
      const state = guideStateForPlace(place, scheduledPlaceIds, alternative);
      const requirements = requirementsForPlace(presentation, place.id);
      const image = guideCardImageForPlace(place);
      const timeline = firstTimelineByPlace.get(place.id);
      const planFitLabel = alternative
        ? alternative.kind === "replacement"
          ? `Alternative to ${alternative.replacementFor ?? "the planned stop"} · ${alternative.dayLabel}`
          : `Optional for ${alternative.dayLabel}`
        : guidePlanFitLabel(presentation, place, state, timeline, requirements);
      const practicalSignal = guidePracticalSignal(place, requirements);
      const fitDayIds = presentation.days.filter((day) => day.candidates?.includes(place.id)).map((day) => day.id);
      const card = {
        placeId: place.id,
        sources: sourceSummariesForPlace(place, planSources, presentation.sourceCatalog),
        ...(image ? { imageSource: sourceForGuideImage(place, image, presentation.sourceCatalog ?? []) } : {}),

        title: displayPlaceName(place),
        type: guideTypeForPlace(place),
        state,
        summary: shortGuideSummary(place),
        locationLabel: place.locationLabel,
        typeLabel: guideTypeLabel(place),
        ...(planFitLabel ? { planFitLabel } : {}),
        ...(practicalSignal ? { practicalSignal } : {}),
        ...(image ? { image } : {}),
        tags: guideDecisionTags(presentation, place, requirements, planFitLabel, practicalSignal),
        priorityLabel: placePriorityLabel(place.priority),
        ...guideCardAction(place, state, timeline, requirements),
        ...(timeline ? { timeline } : {}),
        ...(fitDayIds.length ? { fitDayIds } : {}),
        ...(place.schedulingEligibility?.suitableDayIds?.length ? { suitableDayIds: [...place.schedulingEligibility.suitableDayIds] } : {}),
        ...(alternative?.replacementFor ? { replacementFor: alternative.replacementFor } : {})
      };
      const types = new Set<GuideFilter>([card.type, ...informationalTopics.filter((topic) => topic.relatedPlaceIds.includes(place.id)).map((topic) => topic.type)]);
      return [...types].map((type) => ({ ...card, type, typeLabel: guideFilterLabel(type) }));
    });
  return [
    ...informationalTopics.map((topic) => ({
      placeId: topic.id,
      sources: sourceSummariesForEvidenceRefs(topic.evidence, presentation.sourceCatalog ?? []),
      relatedPlaceIds: topic.relatedPlaceIds,
      title: topic.title,
      type: topic.type,
      state: "informational" as const,
      summary: shorten(topic.summary, 132),
      locationLabel: topic.context ?? topic.label,
      typeLabel: topic.label,
      planFitLabel: "Background for this trip",
      tags: [topic.label, topic.context].filter((value): value is string => Boolean(value)).slice(0, 3),
      priorityLabel: "Background",
      canAdd: false,
      actionLabel: "Background note"
    })),
    ...placeCards
  ];
}

function guideCardImageForPlace(place: PlanPlace): GuideCardImageDisplay | undefined {
  const image = (place.images ?? []).find((candidate) => candidate.usage?.includes("card")) ?? place.images?.[0];
  if (!image) return undefined;
  return { url: image.url, alt: image.alt };
}

function sourceForGuideImage(place: PlanPlace, image: GuideCardImageDisplay, catalog: BlueprintSource[]): SourceMarkerDisplay {
  const original = place.images?.find((candidate) => candidate.url === image.url);
  const source = catalog.find((candidate) => candidate.id === original?.sourceId);
  if (!source) return { label: "Image source", summary: "Image source unavailable · Freshness unknown", status: "unknown" };
  return { label: "Image source", summary: [sourceReferenceSummary(source), evidenceStatusLabel(original?.status ?? source.status)].filter(Boolean).join(" · "), url: source.url, status: original?.status ?? source.status, retrievedAt: source.retrievedAt, purpose: source.purpose };
}

function detailDisplayForPlace(presentation: PlanPresentation, planSources: SourceReference[], place: PlanPlace, bookingAction?:BookingSnapshotActionReader, dayId?:string): DetailPlaceDisplay {
  const type = guideTypeForPlace(place);
  const scheduledDay = presentation.days.find(day=>day.id===dayId&&(day.placeIds.includes(place.id)||day.blocks?.some(block=>block.placeId===place.id))) ?? scheduledDayForPlace(presentation, place.id);
  const requirements = requirementsForPlace(presentation, place.id);
  const comparisonRows = comparisonRowsForPlace(presentation, place);
  const comparisonHeading = comparisonRows.length ? place.guideDisplay?.comparisonTitle ?? comparisonTitle(type) : undefined;
  const canAdd = !scheduledDay && addWorkflowAvailable(place);
  const removalProtection=bookingAction?.({kind:"remove_place_from_day",placeId:place.id,...(scheduledDay?{dayId:scheduledDay.id}:{})});
  const priorityProtection=bookingAction?.({kind:"update_place_priority",placeId:place.id});
  const canRemoveFromDay = Boolean(scheduledDay && directRemoveAllowed(place, requirements)&&!removalProtection?.knownFixed);
  const removeBlockedReason = scheduledDay && !canRemoveFromDay ? removalProtection?.knownFixed ? "Fixed booking" : directRemoveBlockedLabel(place, requirements) : undefined;
  const leadBody = travelerFacingDefaultText(place.whyWorthIt) || travelerFacingDefaultText(place.plan);
  const planBody = travelerFacingDefaultText(place.plan);
  const reservationNote = reservationRequirementNote(requirements) || travelerFacingDefaultText(place.reservation?.note);
  const imageCandidates = detailImagesForPlace(place, presentation.sourceCatalog ?? []);
  const image = imageCandidates[0];
  return {
    placeId: place.id,
    title: displayPlaceName(place),
    heroMeta: detailHeroMeta(place),
    priority: place.priority,
    priorityLabel: placePriorityLabel(place.priority),
    priorityActions: placePriorityActions(place, Boolean(scheduledDay)).map(action=>!action.active&&(priorityProtection?.knownFixed||independentFixedBooking(place,requirements))?{...action,disabled:true,disabledReason:"Ask Landi to replan changes to a fixed commitment."}:action),
    ...((removalProtection?.unknown||priorityProtection?.unknown)?{bookingRelationshipNote:"The booking links need review. Review them before previewing again; they will be checked again before saving."}:{}),
    ...(placePriorityBlockedNote(place, Boolean(scheduledDay)) ? { priorityBlockedNote: placePriorityBlockedNote(place, Boolean(scheduledDay))! } : {}),
    leadTitle: place.guideDisplay?.detailLeadTitle ?? detailLeadTitle(type),
    leadBody,
    visitFacts: detailVisitFacts(place, requirements),
    ...(image ? { image, imageCandidates } : {}),
    ...(planBody ? { planTitle: place.guideDisplay?.detailPlanTitle ?? detailPlanTitle(type), planBody } : {}),
    ...(reservationNote ? { reservationNote } : {}),
    visitNotes: visitNotesForRequirements(requirements),
    detailSections: [...travelerFacingDetailSections(place.detailSections), ...comparisonFactsForPlace(presentation, place, "place").map((fact) => ({ title: fact.label, body: fact.value, sources: fact.sources }))],
    guideContext: guideContextForPlace(presentation, place.id),
    relatedEvents: relatedEventsForPlace(presentation, planSources, place.id),
    sources: sourceSummariesForPlace(place, planSources, presentation.sourceCatalog, blockEvidenceForPlace(presentation, place.id)),
    ...(place.guideDisplay?.detailSourceTitle?.trim() ? { sourceTitle: place.guideDisplay.detailSourceTitle.trim() } : {}),
    ...(detailItineraryContext(presentation, place, requirements) ? { itineraryContext: detailItineraryContext(presentation, place, requirements)! } : {}),
    ...(comparisonHeading ? { comparisonTitle: comparisonHeading } : {}),
    comparisonRows: comparisonHeading ? comparisonRows : [],
    primaryActionLabel: detailPrimaryActionLabel(place, Boolean(scheduledDay), canAdd),
    scheduled: Boolean(scheduledDay),
    ...(scheduledDay?{scheduledDayId:scheduledDay.id}:{}),
    canAdd,
    canRemoveFromDay,
    ...(canRemoveFromDay ? { removeActionLabel: "Remove from day" } : {}),
    ...(removeBlockedReason ? { removeBlockedReason } : {}),
    links: detailLinks(place)
  };
}

function detailImagesForPlace(place: PlanPlace, sourceCatalog: BlueprintSource[]): DetailImageDisplay[] {
  return timelineImageCandidatesForPlace(place).flatMap((candidate) => {
    const image = place.images?.find((item) => item.url === candidate.url);
    const source = sourceCatalog.find((item) => item.id === image?.sourceId);
    if (!image || !source) return [];
    const status = evidenceStatusLabel(image.status ?? source.status);
    return [{
      url: image.url,
      alt: image.alt,
      ...(image.caption?.trim() ? { caption: image.caption.trim() } : {}),
      source: {
        label: "Image source",
        summary: [sourceReferenceSummary(source), status].filter(Boolean).join(" · "),
        url: source.url,
        contexts: [`Image for ${displayPlaceName(place)}`],
        purpose: source.purpose,
        status: source.status,
        retrievedAt: source.retrievedAt
      }
    }];
  });
}

function detailDisplayForInformationalTopic(presentation: PlanPresentation, topic: InformationalGuideTopic): DetailPlaceDisplay {
  const sourceCatalog = presentation.sourceCatalog ?? [];
  return {
    placeId: topic.id,
    title: topic.title,
    heroMeta: [topic.label, topic.context].filter((value): value is string => Boolean(value)),
    priority: "archive",
    priorityLabel: "Background",
    priorityActions: [],
    leadTitle: topic.label,
    leadBody: topic.summary,
    visitFacts: [],
    ...(topic.context ? { planTitle: "How to use it", planBody: topic.context } : {}),
    visitNotes: [],
    detailSections: [],
    guideContext: [],
    relatedEvents: [],
    sources: sourceSummariesForEvidenceRefs(topic.evidence, sourceCatalog, `Supports ${topic.title}`),
    ...(topic.relatedPlaceIds.length ? { comparisonTitle: "Compare concrete options" } : {}),
    comparisonRows: topic.relatedPlaceIds.flatMap((id) => {
      const place = presentation.places.find((candidate) => candidate.id === id);
      return place ? [comparisonRowForThemePlace(presentation, place)] : [];
    }),
    primaryActionLabel: "Background note",
    scheduled: false,
    canAdd: false,
    canRemoveFromDay: false,
    links: []
  };
}

function comparisonFactsForPlace(presentation: PlanPresentation, place: PlanPlace, scope: "place" | "theme"): NonNullable<ComparisonRow["facts"]> {
  const catalog = presentation.sourceCatalog ?? [];
  const facts: NonNullable<ComparisonRow["facts"]> = [];
  const evidenceSources = (evidence: BlueprintEvidenceRef[] | undefined) => sourceSummariesForEvidenceRefs(evidence, catalog);
  const appendFact = (label: string, value: string | undefined, evidence: BlueprintEvidenceRef[] | undefined) => {
    if (!value?.trim()) return;
    facts.push({ label, value: travelerFacingDefaultText(value), sources: evidenceSources(evidence) });
  };
  const operational = place.operationalFacts;
  for (const window of operational?.access?.windows ?? []) {
    appendFact("Opening", [window.label, window.opensAt && window.closesAt ? `${window.opensAt}–${window.closesAt}` : window.opensAt ?? window.closesAt, window.uncertaintyNote].filter(Boolean).join(" · "), window.evidence);
    appendFact("Season", window.appliesTo?.season ?? window.appliesTo?.note, window.evidence);
  }
  if (scope === "place") {
    for (const session of operational?.sessions ?? []) {
      appendFact("Session", [session.label, session.startsAt && session.endsAt ? `${session.startsAt}–${session.endsAt}` : session.startsAt ?? session.endsAt, session.durationMinutes ? `${session.durationMinutes} min` : undefined, session.uncertaintyNote].filter(Boolean).join(" · "), session.evidence);
      appendFact("Season", session.appliesTo?.season ?? session.appliesTo?.note, session.evidence);
    }
    for (const [label, requirement] of [["Reservation", operational?.entry?.reservation], ["Ticket", operational?.entry?.ticket], ["Booking", operational?.entry?.booking], ["Capacity", operational?.entry?.capacity]] as const) {
      if (!requirement) continue;
      appendFact(label, [requirement.requirement === "unknown" ? "Unknown" : requirement.requirement.replaceAll("_", " "), requirement.note, requirement.uncertaintyNote].filter(Boolean).join(" · "), requirement.evidence);
      appendFact("Season", requirement.appliesTo?.season ?? requirement.appliesTo?.note, requirement.evidence);
    }
    for (const field of place.fieldEvidence ?? []) {
      const parts = field.path.split(".");
      if (parts[0] === "places") { parts.shift(); if (parts[0] === place.id) parts.shift(); }
      let value: unknown = place;
      for (const part of parts) { value = value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, part) ? (value as Record<string, unknown>)[part] : undefined; }
      const leaf = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
      appendFact(!field.note && parts.at(-1) === "durationMinutes" ? "Duration (minutes)" : "Field note", field.note ?? leaf ?? uniqueStrings(field.evidence.flatMap((ref) => ref.supports ?? [])).join(" · "), field.evidence);
    }
  }
  return facts;
}

function comparisonRowForThemePlace(presentation: PlanPresentation, place: PlanPlace): ComparisonRow {
  // 主题关联只确认选项身份，不能授权其他比较上下文的事实。
  const facts = comparisonFactsForPlace(presentation, place, "theme");
  const sources = uniqueSourceMarkers(facts.flatMap((fact) => fact.sources));
  const openingTiming = facts.filter((fact) => fact.sources.some((source) => source.purpose !== "inspiration")).map((fact) => `${fact.label}: ${fact.value}`);
  return {
    id: place.id, relatedPlaceId: place.id,
    canAdd: !scheduledDayForPlace(presentation, place.id) && addWorkflowAvailable(place),
    name: displayPlaceName(place), area: place.area || place.locationLabel || "Unknown",
    routeFit: "Unknown",
    timing: openingTiming.join(" · ") || "Unknown",
    effort: "Unknown",
    sourceState: sources.some((source) => source.purpose !== "inspiration") ? uniqueStrings(sources.map((source) => source.status ?? "unknown")).join(" · ") : sources.length ? "Inspiration · facts unverified" : "Evidence unavailable",
    facts, sources
  };
}

function comparisonRowsForPlace(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const graphRows = comparisonRowsFromRelationshipGraph(presentation, selectedPlace);
  const displayRows = comparisonRowsFromGuideDisplay(presentation, selectedPlace);
  const explicitTargets = new Set(displayRows.flatMap((row) => row.relatedPlaceId ? [row.relatedPlaceId] : []));
  return [...displayRows, ...graphRows.filter((row) => !row.relatedPlaceId || !explicitTargets.has(row.relatedPlaceId))];
}

function comparisonRowsFromGuideDisplay(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const rows = selectedPlace.guideDisplay?.comparisonRows ?? [];
  if (!rows.length) return [];
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  return rows.map((row) => {
    const related = row.relatedPlaceId ? placeById.get(row.relatedPlaceId) : undefined;
    return {
      id: row.id,
      ...(related ? { relatedPlaceId: related.id, canAdd: !scheduledDayForPlace(presentation, related.id) && addWorkflowAvailable(related) } : {}),
      sources: sourceSummariesForEvidenceRefs(row.evidence, presentation.sourceCatalog ?? []),
      name: row.name?.trim() || (related ? displayPlaceName(related) : row.id),
      area: row.area,
      routeFit: travelerFacingComparisonText(row.routeFit, related ? routeFitLabel(related, selectedPlace) : "Related option"),
      timing: travelerFacingComparisonText(row.timing, related ? timingLabel(related, requirementsForPlace(presentation, related.id)) : "Flexible timing"),
      effort: travelerFacingComparisonText(row.effort, related ? effortLabel(related) : "Review details"),
      sourceState: travelerFacingComparisonText(row.sourceState, related ? sourceStateLabel(related) : "Referenced")
    };
  });
}

function comparisonRowsFromRelationshipGraph(presentation: PlanPresentation, selectedPlace: PlanPlace): ComparisonRow[] {
  const relationships = presentation.guideRelationshipGraph?.relationships ?? [];
  if (!relationships.length) return [];
  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  const relationshipPriority: BlueprintPlaceRelationship["kind"][] = ["rainy_day_alternative", "low_energy_alternative", "alternative", "same_area", "same_direction", "event_link", "supports_anchor", "meal_support", "similar"];
  const grouped = new Map<string, BlueprintPlaceRelationship[]>();
  for (const { relationship, placeId } of relationships.flatMap((relationship) => relatedPlaceForRelationship(relationship, selectedPlace.id))) {
    const place = placeById.get(placeId);
    if (!place || !isGuidePlace(place)) continue;
    grouped.set(placeId, [...(grouped.get(placeId) ?? []), relationship]);
  }
  return [...grouped.entries()].flatMap(([placeId, placeRelationships]) => {
    const place = placeById.get(placeId);
    if (!place) return [];
    const sorted = [...placeRelationships].sort((left, right) => relationshipPriority.indexOf(left.kind) - relationshipPriority.indexOf(right.kind));
    const primaryLabel = relationshipKindLabel(sorted[0]!.kind);
    const dayLabels = uniqueStrings(sorted.flatMap((relationship) => relationship.dayIds ?? []).map((dayId) => dayLabelForId(presentation, dayId))).slice(0, 2);
    const rationale = sorted.map((relationship) => travelerFacingDefaultText(relationship.rationale)).find(Boolean);
    return [{
      id: place.id,
      relatedPlaceId: place.id,
      canAdd: !scheduledDayForPlace(presentation, place.id) && addWorkflowAvailable(place),
      sources: sourceSummariesForEvidenceRefs(sorted.flatMap((relationship) => relationship.evidence), presentation.sourceCatalog ?? []),
      name: displayPlaceName(place),
      area: place.area ?? place.locationLabel,
      routeFit: primaryLabel || routeFitLabel(place, selectedPlace),
      timing: dayLabels.length ? dayLabels.join(", ") : timingLabel(place, requirementsForPlace(presentation, place.id)),
      effort: travelerFacingComparisonText(rationale ?? "", primaryLabel || routeFitLabel(place, selectedPlace)),
      sourceState: relationshipGroupSourceStateLabel(sorted, place)
    }];
  });
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

export function buildPendingItineraryEditForWorkspace(workspace: BlueprintWorkspaceDisplay, placeId: string, input: { dayId: string; positionId: string }): PendingItineraryEditDisplay | undefined {
  const place = workspace.places.find((candidate) => candidate.id === placeId);
  const requestedItinerary = workspace.itineraries.find((candidate) => candidate.dayId === input.dayId);
  const itinerary = place
    ? eligibleItineraryForPlace(workspace, place, requestedItinerary)
    : requestedItinerary ?? workspace.itineraries[0];
  const options = itinerary?.placementOptions ?? [];
  const position = options.find((option) => option.id === input.positionId) ?? options[options.length - 1];
  const operation={kind:"add_place_to_day",placeId,dayId:itinerary?.dayId??input.dayId,position:pendingEditPosition(position)};
  if(place&&(place.independentFixed||workspace.bookingAction?.(operation).knownFixed))return undefined;
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
  if (!itinerary || !place || workspace.bookingAction?.({kind:"move_place_within_day",...input}).knownFixed || !itinerary.items.some((item) => item.placeId === input.placeId && item.reorderable)) return undefined;
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
    advisories: [{ tone: "neutral", text: "This day will need travel-time and timing checks after reordering." }]
  };
}

export function buildPendingItineraryRemoveForWorkspace(workspace: BlueprintWorkspaceDisplay, input: { dayId: string; placeId: string }): PendingItineraryEditDisplay | undefined {
  const itinerary = workspace.itineraries.find((candidate) => candidate.dayId === input.dayId);
  const place = workspace.places.find((candidate) => candidate.id === input.placeId);
  const detail = detailDisplayForWorkspacePlace(workspace,input.placeId,[],input.dayId);
  if (!itinerary || !place || !detail?.scheduled || !detail.canRemoveFromDay) return undefined;
  if (!itinerary.items.some((item) => item.kind === "block" && item.placeId === input.placeId && item.routeAnchor)) return undefined;
  const dayLabel = itinerary.day.shortLabel ?? itinerary.day.date ?? itinerary.day.label;
  return {
    kind: "remove_place_from_day",
    placeId: place.id,
    placeName: place.title,
    dayId: itinerary.dayId,
    dayLabel,
    advisories: [{ tone: "neutral", text: "This day will need travel-time and timing checks after removing this stop." }]
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
  return { dayId: "", day: { id: "", label: "" }, dayAlternatives: [], items: [], placementOptions: [], routePlaces: [], routeSegments: [], markers: [] };
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
    summary: segmentCount === 1 ? `1 travel leg on ${dayLabel} will be checked automatically.` : `${segmentCount} travel legs on ${dayLabel} will be checked automatically.`,
    request: `Check travel times for ${dayLabel}. Review the affected travel leg${segmentCount === 1 ? "" : "s"}, timing, meal spacing, and opening constraints before marking this itinerary ready.`
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
    summary: `${changeCount} unsaved itinerary change${changeCount === 1 ? "" : "s"} will have travel times checked after you confirm.`,
    ...(impactNotes.length ? { impactNotes } : {}),
    request: `After you confirm the itinerary draft for ${dayLabel}, check travel times, timing, meal spacing, and opening constraints before marking this day ready.`,
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
  const notes: string[] = ["Travel time and timing will be checked after confirmation."];
  if (edits.some((edit) => edit.kind === "add_place_to_day")) {
    notes.push(addImpactNote(routePlaces));
  }
  notes.push(...spatialImpactNotes(base, previewItems, placesById, edits));
  if (edits.some((edit) => edit.kind === "remove_place_from_day")) {
    notes.push(removeImpactNote(routePlaces, placesById, edits));
  }
  if (edits.some((edit) => edit.kind === "move_place_within_day")) {
    notes.push("Moved stops keep their current time labels until timing is checked.");
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
    type: place.markerType,
    timelineRole: "place",
    ...(place.image ? { image: place.image } : {}),
    ...(edit.positionLabel ? { meta: edit.positionLabel } : {}),
    statusLabel: "Not saved",
    routeAnchor: true,
    draftActionLabel: "Undo draft",
    ...(place.contextualTip ? { contextualTip: place.contextualTip } : {})
  };
}

function itineraryCardForBlock(block: TimelineBlock, places: PlanPlace[] = []): ItineraryCardDisplay {
  const compactStep = Boolean(block.block && (isJourneyStep(block.block) || isAirportSupportingStep(block.block, block.place)));
  const routeAfterNeedsCheck = Boolean(block.routeAfter && routeSegmentShowsAsFormalRoute(block.routeAfter) && routeSegmentNeedsRefresh(block.routeAfter));
  const routeAfterLabel = routeAfterNeedsCheck ? undefined : itineraryRouteReadout(block.routeAfter);
  const routeAfterStatusLabel = routeAfterNeedsCheck ? routeCheckReadoutLabel(false) : undefined;
  const accommodationIntroduction = accommodationIntroductionBlock(block);
  const accommodationCard = Boolean(block.place?.accommodation);
  const imageCandidates = block.place ? timelineImageCandidatesForPlace(block.place) : [];
  const image = imageCandidates[0];
  const illustrationKind: ItineraryCardDisplay["illustrationKind"] = block.block?.kind === "rest" ? "rest"
    : block.block?.kind === "meal" && !block.place && (mealTimelineLabel(block.block) === "Lunch" || /午餐|午饭|午飯/.test(`${block.block.role ?? ""} ${block.block.title ?? ""}`)) ? "lunch" : undefined;
  const briefDescription = illustrationKind === "rest" ? "Take a break and recharge." : illustrationKind === "lunch" ? "Enjoy lunch and recharge." : undefined;
  const airportBreak = block.block && isAirportSupportingStep(block.block, block.place) && /meal|rest|break|吃饭|用餐|休息/i.test(`${block.block.title ?? ""} ${block.block.role ?? ""}`);
  const meta = airportBreak ? "Have something to eat or take a break before boarding." : compactStep ? block.block?.summary ?? timelineCardMeta(block) : briefDescription ?? timelineCardMeta(block);
  const placeMeta = !compactStep && block.place ? accommodationCard ? deriveTimelineAccommodationMeta(block.place) : deriveTimelinePlaceMeta(block.place).label : undefined;
  const purpose = compactStep ? undefined : briefDescription && block.place ? briefDescription : block.place ? accommodationCard ? deriveTimelineAccommodationPurpose(block.block, block.place) : deriveTimelinePlacePurpose(block.block, block.place) : undefined;
  const featurePlaceCard = !compactStep && block.place && block.timelineRole === "place" && !accommodationCard && block.type !== "stay"
    ? deriveTimelineFeaturePlaceCardModel(block.block, block.place, image)
    : undefined;
  const externalAction = block.place && (!block.place.accommodation || accommodationIntroduction) ? accommodationExternalAction(block.place) : undefined;
  return {
    kind: "block",
    key: `${block.day.id}-${block.place?.id ?? block.block?.id ?? block.order}-${block.order}`,
    ...(block.block ? { blockId: block.block.id } : {}),
    placeId: block.place?.id ?? "",
    title: (compactStep ? block.block?.title : undefined) ?? block.title ?? (block.place ? displayPlaceName(block.place) : "Flexible time"),
    timeLabel: block.timeLabel,
    type: block.type,
    timelineRole: block.timelineRole,
    ...(compactStep ? { compactStep: true } : {}),
    ...(illustrationKind ? { illustrationKind } : {}),
    ...(!compactStep && image ? { image, imageCandidates } : {}),
    ...(featurePlaceCard ? { featurePlaceCard } : {}),
    ...(placeMeta ? { placeMeta } : {}),
    ...(purpose ? { purpose } : {}),
    ...(block.place && !block.place.accommodation ? { emphasis: block.block?.primaryExperience ? "primary" as const : "secondary" as const } : {}),
    ...(meta ? { meta } : {}),
    ...(block.status ? { statusLabel: block.status } : {}),
    ...(routeAfterLabel ? { routeAfterLabel } : {}),
    ...(routeAfterStatusLabel ? { routeAfterStatusLabel } : {}),
    ...(block.routeAfter?.mode ? { routeAfterMode: block.routeAfter.mode } : block.timelineRole === "transport" ? { routeAfterMode: transportModeFromText(`${block.title ?? ""} ${block.meta ?? ""}`) } : {}),
    ...(block.routeAfter?.destinationPlaceId ? { routeAfterDestinationPlaceId: block.routeAfter.destinationPlaceId } : {}),
    ...(block.routeAfter?.durationMinutes ? { routeAfterDurationLabel: compactTravelDurationLabel(block.routeAfter.durationMinutes) } : {}),
    ...(block.routeAfter ? { routeAfterDetail: conciseRouteDetail(block.routeAfter, places) } : {}),
    ...(block.routeAnchor ? { routeAnchor: true } : {}),
    ...(block.place && block.reorderable ? { reorderable: true } : {}),
    ...(block.contextualTip ? { contextualTip: block.contextualTip } : {}),
    ...(externalAction ? { externalAction } : {})
  };
}

function isJourneyStep(block: BlueprintItineraryBlock): boolean {
  // A departure/arrival airport is a concrete place; processing at that place remains a step.
  if (block.placeId && /^(outbound departure|arrival airport)$/iu.test(block.role ?? "")) return false;
  return block.kind === "event" && /outbound|in.flight|preparation|check[ -]?in|security|airport processing|departure processing|depart|arrival|出发|准备|值机|安检|飞行|抵达/iu.test(`${block.role ?? ""} ${block.title ?? ""}`);
}

function isAirportSupportingStep(block: BlueprintItineraryBlock, place?: PlanPlace): boolean {
  if (!place || !/airport|机场|機場/i.test(place.category)) return false;
  // The gateway itself keeps its place card; actions within it use their own short titles.
  if (!["meal", "rest", "flexible", "event"].includes(block.kind)) return false;
  return /meal|rest|break|wait|boarding|check[ -]?in|security|吃饭|用餐|休息|候机|值机|安检/i.test(`${block.title ?? ""} ${block.role ?? ""}`);
}

export function deriveTimelineFeaturePlaceCardModel(block: BlueprintItineraryBlock | undefined, place: PlanPlace, image = guideCardImageForPlace(place)): TimelineFeaturePlaceCardModel {
  const meta = deriveTimelinePlaceMeta(place);
  const imageCandidates = timelineImageCandidatesForPlace(place);
  const selectedImage = imageCandidates.find((candidate) => candidate.url === image?.url) ?? imageCandidates[0];
  return {
    title: travelerFacingDefaultText(place.name) || displayPlaceName(place),
    typeLabel: meta.typeLabel,
    ...(meta.areaLabel ? { areaLabel: meta.areaLabel } : {}),
    summary: deriveTimelinePlacePurpose(block, place),
    chips: deriveTimelinePlaceChips(place, meta.typeLabel),
    ...(selectedImage ? { image: selectedImage } : {}),
    imageCandidates,
    imageAvailable: imageCandidates.length > 0,
    clickable: true
  };
}

export function deriveTimelinePlaceChips(place: PlanPlace, typeLabel = timelinePlaceTypeLabel(place)): TimelineFeaturePlaceCardModel["chips"] {
  const category = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  const labels = [typeLabel];
  if (/textile|weav|natural.?dye|craft/.test(category)) labels.push("Craft", "Culture");
  else if (/art museum|painting|woodcarv|museum/.test(category)) labels.push("Art", "Indoor");
  else if (/cooking class|cooking academy|culinary class/.test(category)) labels.push("Hands-on", "Local food");
  else if (/restaurant|dining|warung|cafe|food/.test(category)) labels.push("Local food");
  else if (/dance|performance|show/.test(category)) labels.push("Culture", ...(/sunset/.test(category) ? ["Sunset"] : []));
  else if (/clifftop.*temple|sea temple/.test(category)) labels.push("Culture", "Scenic spot");
  else if (/coast|beach/.test(category)) labels.push("Outdoors", "Scenic spot");
  else if (/temple|shrine/.test(category)) labels.push("Culture", "Scenic spot");
  else if (/ridge|walk|trail/.test(category)) labels.push("Outdoors", "Scenic spot");
  else if (/gallery|shop|market/.test(category)) labels.push("Craft", "Shopping");
  else if (/wildlife|forest|macaque|nature/.test(category)) labels.push("Nature", "Outdoors");
  const unique = [...new Set(labels)].slice(0, 4);
  return unique.map((label, index) => ({ label, kind: index === 0 ? "type" : "attribute" }));
}

export function deriveTimelinePlaceMeta(place: PlanPlace): { typeLabel: string; areaLabel?: string; label: string } {
  const typeLabel = timelinePlaceTypeLabel(place);
  const areaLabel = travelerFacingDefaultText(place.area) || travelerFacingDefaultText(place.city);
  return {
    typeLabel,
    ...(areaLabel ? { areaLabel } : {}),
    label: [typeLabel, areaLabel].filter(Boolean).join(" · ")
  };
}

function timelinePlaceTypeLabel(place: PlanPlace): string {
  const category = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/textile|weav|natural.?dye/.test(category)) return "Textiles";
  if (/art museum|painting|woodcarv/.test(category)) return "Art museum";
  if (/ridge walk|ridge path/.test(category)) return "Ridge walk";
  if (/cooking class|cooking academy|culinary class/.test(category)) return "Cooking class";
  if (/wildlife.*temple|temple.*forest|macaque/.test(category)) return "Temple forest";
  if (/restaurant|dining|warung|cafe|food/.test(category)) return /indonesian/.test(category) ? "Indonesian dining" : "Dining";
  if (/temple|shrine/.test(category)) return "Temple";
  if (/beach|coast/.test(category)) return "Beach";
  if (/gallery|shop|market|craft/.test(category)) return "Shopping";
  if (/walk|trail/.test(category)) return "Walk";
  if (/museum/.test(category)) return "Museum";
  const source = travelerFacingDefaultText(place.category);
  if (source && source.split(/\s+/).length <= 3) return sentenceCaseLabel(source);
  const fallback = guideTypeForPlace(place);
  return fallback === "dining" ? "Dining" : fallback === "shopping" ? "Shopping" : fallback === "experience" ? "Experience" : fallback === "stay" ? "Hotel" : fallback === "transport" ? "Transport" : "Attraction";
}

function deriveTimelinePlacePurpose(block: BlueprintItineraryBlock | undefined, place: PlanPlace): string {
  const authored = [place.guideDisplay?.cardSummary, block?.summary]
    .map((value) => concisePurposeCandidate(value, place))
    .find(Boolean);
  if (authored) return authored;
  const category = `${place.category} ${place.visitRole ?? ""}`.toLocaleLowerCase();
  if (/textile|weav|natural.?dye/.test(category)) return "Explore Indonesian weaving and natural-dye textiles.";
  if (/art museum|painting|woodcarv/.test(category)) return "Explore Balinese painting and woodcarving.";
  if (/ridge walk|ridge path/.test(category)) return "Walk a scenic ridge between river valleys.";
  if (/cooking class|cooking academy|culinary class/.test(category)) return "Try a hands-on Balinese cooking experience.";
  if (/wildlife.*temple|temple.*forest|macaque/.test(category)) return "Explore the temple forest and resident macaques.";
  if (/restaurant|dining|warung|cafe|food/.test(category)) return /indonesian/.test(category) ? "Explore regional Indonesian cooking." : "Pause for a meal along today’s route.";
  if (/clifftop.*temple|sea temple/.test(category)) return "Explore a clifftop Balinese temple setting.";
  if (/temple|shrine/.test(category)) return "Explore a Balinese temple setting.";
  if (/beach|coast/.test(category)) return "Take in the coast and beach setting.";
  if (/gallery|shop|market|craft/.test(category)) return "Browse local craft and design traditions.";
  const concise = [place.visitRole, place.plan, place.whyWorthIt]
    .map((value) => concisePurposeCandidate(value, place))
    .find(Boolean);
  if (concise) return concise;
  return "Explore this stop as part of today’s route.";
}

function deriveTimelineAccommodationMeta(place: PlanPlace): string {
  const area = travelerFacingDefaultText(place.accommodation?.baseLabel) || travelerFacingDefaultText(place.area) || travelerFacingDefaultText(place.city);
  return ["Hotel", area].filter(Boolean).join(" · ");
}

function deriveTimelineAccommodationPurpose(block: BlueprintItineraryBlock | undefined, place: PlanPlace): string {
  const text = `${block?.title ?? ""} ${block?.summary ?? ""}`.toLocaleLowerCase();
  if (/^check[ -]?out\b/i.test(block?.title ?? "") || /^check[ -]?out\b/i.test(block?.summary ?? "") || /luggage handover/.test(text)) return "Check out and hand over luggage.";
  if (/check[ -]?in|settle|base introduction/.test(text)) return "Leave your bags and take a moment to rest after the journey.";
  if (/breakfast|brunch/.test(text)) {
    if (/pack|luggage/.test(text)) return "Breakfast and finish packing.";
    if (/late departure|slow breakfast/.test(text)) return "Slow breakfast, then depart.";
    if (/light breakfast/.test(text)) return "Light breakfast, then depart.";
    if (/depart|leave|driver/.test(text)) return "Breakfast, then depart.";
    if (/quiet|beachfront|free time|morning/.test(text)) return "Breakfast and an unhurried hotel morning.";
    return "Breakfast at the hotel.";
  }
  if (block?.kind === "rest" && /rest|recover|recovery|pool|shower|early night/.test(text)) return "Rest and recover at the hotel.";
  if (/return|end at|back to/.test(text)) return "Return to the hotel.";
  if (/rest|recover|recovery|pool|shower|early night/.test(text)) return "Rest and recover at the hotel.";
  return place.accommodation?.state === "confirmed" ? `Your stay at ${place.name}.` : `A suggested stay at ${place.name}.`;
}

function concisePurposeCandidate(value: string | undefined, place: PlanPlace): string | undefined {
  const text = travelerFacingDefaultText(value).replace(/\s+/g, " ").trim();
  if (!text || text.length > 70 || text.includes(";") || sameText(text.replace(/[.!?]$/, ""), place.name)) return undefined;
  return /[.!?]$/.test(text) ? sentenceCaseLabel(text) : `${sentenceCaseLabel(text)}.`;
}

function sentenceCaseLabel(value: string): string {
  return value.replace(/^./u, (character) => character.toLocaleUpperCase());
}

function accommodationIntroductionBlock(block: TimelineBlock): boolean {
  if (!block.place?.accommodation || block.block?.kind !== "lodging") return false;
  if (!/check[ -]?in|arriv|settle|入住|抵达/i.test(block.block.title ?? "")) return false;
  return block.day.startContext?.placeId !== block.place.id || block.day.startContext?.label !== block.day.endContext?.label;
}

function timelineStatusForBlock(block: BlueprintItineraryBlock, place: PlanPlace | undefined, requirements: BlueprintActionRequirement[]): string | undefined {
  if (place && !place.accommodation) return timelinePlaceOperationalStatus(block, place, requirements);
  const timingStatus = block.display?.timingStatus;
  if (timingStatus === "confirmed") return "Confirmed";
  if (timingStatus === "estimated") return "Estimated";
  if (timingStatus === "recheck") return "Needs recheck";
  if (timingStatus === "unknown") return "Time pending";
  if (place?.accommodation) return accommodationTimelineStatus(place);
  return place ? itineraryBlockStatus(place, requirements) : undefined;
}

function timelinePlaceOperationalStatus(block: BlueprintItineraryBlock, place: PlanPlace, requirements: BlueprintActionRequirement[]): string | undefined {
  const entry = place.operationalFacts?.entry;
  const reservationRequired = Boolean(reservationRequirementForPlace(requirements))
    || entry?.reservation?.requirement === "required"
    || entry?.booking?.requirement === "required"
    || place.reservation?.requirement === "required";
  if (entry?.ticket?.requirement === "required") return "Ticket required";
  if (reservationRequired) return "Reservation required";
  if (entry?.reservation?.requirement === "recommended"
    || entry?.booking?.requirement === "recommended"
    || place.reservation?.requirement === "recommended") return "Reservation recommended";

  const accessNeedsRecheck = block.operationalConditions?.some((condition) => {
    const note = travelerFacingDefaultText(condition.note).toLocaleLowerCase();
    return (condition.kind === "access" || condition.kind === "recheck")
      && /recheck|check|confirm|verify/.test(note)
      && /hour|open|access|entry/.test(note);
  }) || place.operationalFacts?.access?.windows?.some((window) => window.status === "recheck" || window.status === "stale");
  if (accessNeedsRecheck) return "Hours need recheck";

  const generalRecheck = block.display?.timingStatus === "recheck"
    || block.display?.timingStatus === "unknown"
    || requirementNeedsRecheck(requirements)
    || place.priority === "recheck"
    || place.reservation?.verification === "needs_recheck"
    || block.operationalConditions?.some((condition) => condition.kind === "recheck");
  if (generalRecheck) return "Needs recheck";
  if (block.display?.timingStatus === "confirmed" || place.priority === "booked") return "Confirmed";
  return undefined;
}

export function itineraryCardImageForRender(image: GuideCardImageDisplay | undefined, failedUrl?: string): GuideCardImageDisplay | undefined {
  return image && image.url !== failedUrl ? image : undefined;
}

export function itineraryCardImageCandidateForRender(images: GuideCardImageDisplay[] | undefined, failedUrls: readonly string[] = []): GuideCardImageDisplay | undefined {
  const failed = new Set(failedUrls);
  return images?.find((image) => !failed.has(image.url));
}

function timelineImageCandidatesForPlace(place: PlanPlace): GuideCardImageDisplay[] {
  return [...(place.images ?? [])]
    .map((image, index) => ({ image, index, priority: image.usage?.includes("card") ? 0 : image.status === "verified" ? 1 : 2 }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ image }) => ({ url: image.url, alt: image.alt }))
    .filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index)
    .slice(0, 3);
}

function accommodationTimelineStatus(place: PlanPlace): string | undefined {
  if (!place.accommodation) return undefined;
  if (place.accommodation.state === "confirmed") return "Confirmed stay";
  if (place.accommodation.state === "selected") return "Selected · Booking not confirmed";
  if (place.accommodation.state === "recommended") return "Recommended";
  return "Hotel not selected";
}

function accommodationExternalAction(place: PlanPlace): ItineraryCardDisplay["externalAction"] | undefined {
  if (!place.accommodation) return undefined;
  if (place.accommodation.state === "confirmed") return place.bookingUrl ? { label: "View booking", url: place.bookingUrl } : undefined;
  if (place.bookingUrl) return { label: "Book", url: place.bookingUrl };
  if (place.officialUrl) return { label: "Check availability", url: place.officialUrl };
  return undefined;
}

function itineraryRouteReadout(segment: PlanRouteSegment | undefined): string | undefined {
  if (!segment || segment.verification !== "verified" || !routeSegmentShowsAsFormalRoute(segment)) return undefined;
  return routeConnectorTitle(segment);
}

function conciseRouteDetail(segment: PlanRouteSegment, places: PlanPlace[]): string {
  const placeById = new Map(places.map((place) => [place.id, place] as const));
  const origin = placeById.get(segment.originPlaceId);
  const destination = placeById.get(segment.destinationPlaceId);
  const endpoints = origin && destination ? `${shortRoutePlaceName(origin)} -> ${shortRoutePlaceName(destination)}` : "";
  const distance = segment.mode === "walking" ? routeDistanceLabel(segment) : "";
  return [endpoints, distance].filter(Boolean).join(" · ") || travelerFacingDefaultText(segment.detail) || "";
}

function conciseTransportDetail(value: string): string {
  return travelerFacingDefaultText(value)
    .replace(/Use a vehicle suitable for three travelers and luggage\.?/i, "Vehicle for 3 travelers + luggage.")
    .replace(/Destination and travel time depend on the selected first lodging and live traffic\.?/i, "")
    .replace(/Travel mode and time depend on the selected accommodation and live traffic\.?/i, "Confirm once lodging is set.")
    .replace(/after checking the exact lodging and entrance points; travel time remains to be checked\.?/i, "after lodging and entrances are set.")
    .replace(/Confirm transport after lodging and reservation details are known; travel time remains to be checked\.?/i, "Confirm after lodging and reservation details.")
    .replace(/\s+/g, " ")
    .trim();
}

function timelineCardMeta(block: TimelineBlock): string | undefined {
  if (block.block?.display?.timingStatus === "confirmed") {
    const recheck = block.block.operationalConditions?.find((condition) => condition.kind === "recheck" && condition.note?.trim());
    if (recheck) return `Recheck operating details: ${recheck.note!.trim()}`;
  }
  if (block.timelineRole === "transport") return block.meta ? conciseTransportDetail(block.meta) : undefined;
  if (block.timelineRole === "rest" || block.timelineRole === "activity") return lightTimelineMeta(block);
  if (block.timelineRole === "pending_place") return pendingPlaceMeta(block);
  const meta = travelerFacingDefaultText(block.meta);
  if (block.place) {
    const authoredMeta = travelerFacingDefaultText(block.block?.display?.meta);
    if (authoredMeta && !timingOnlyMeta(authoredMeta)) return timelineSafePlaceMeta(authoredMeta);
    if (block.block?.kind === "meal") return mealTimelineLabel(block.block);
    const title = travelerFacingDefaultText(block.block?.title ?? block.title);
    const placeName = displayPlaceName(block.place);
    return firstUsefulText([
      concisePlaceActionTitle(title, block.place),
      timelineSafePlaceMeta(meta),
      block.place.area || block.place.city ? [block.place.area, block.place.city].filter(Boolean).join(" · ") : block.place.locationLabel
    ]);
  }
  return meta;
}

function lightTimelineMeta(block: TimelineBlock): string | undefined {
  if (block.block?.kind === "lodging" && blockImpliesPendingPlace(block.block)) return "Hotel not selected";
  if (block.meta && (sameText(block.meta, block.block?.title ?? "") || sameText(block.meta, block.title ?? ""))) return undefined;
  return timelineSafePlaceMeta(block.meta ?? "");
}

function concisePlaceActionTitle(title: string, place: PlanPlace): string | undefined {
  if (!title || sameText(title, place.name) || sameText(title, displayPlaceName(place))) return undefined;
  if (/\bcomplete arrival processing|collect luggage|arriv(?:e|al)\b/i.test(title)) return place.city ? `Arrive in ${place.city}` : "Arrival";
  if (/\bcheck[ -]?in|settle\b/i.test(title)) return "Check in";
  if (/\bcheck[ -]?out\b/i.test(title)) return "Check out";
  return timelineSafePlaceMeta(title);
}

function timelineSafePlaceMeta(value: string): string | undefined {
  const text = travelerFacingDefaultText(value);
  if (!text || aiPlanningExplanationText(text)) return undefined;
  return text;
}

function timingOnlyMeta(value: string | undefined): boolean {
  return /^(?:planned(?: time)?|confirmed(?: time)?|estimated(?: time| timing)?|timing needs recheck|needs recheck|time pending|timing unknown)$/i.test(value?.trim() ?? "");
}

function pendingPlaceMeta(block: TimelineBlock): string | undefined {
  const text = `${block.title ?? ""} ${block.meta ?? ""}`.toLocaleLowerCase();
  if (/\b(restaurant|dinner|lunch|meal)\b/.test(text)) return "Restaurant TBD";
  if (/\b(station|pickup point|meeting point)\b/.test(text)) return "Place not confirmed";
  if (/\b(hotel|accommodation|lodging|check[ -]?in|settle)\b/.test(text)) return "Hotel not selected";
  return timelineSafePlaceMeta(block.meta ?? "") ?? "Place not confirmed";
}

function aiPlanningExplanationText(value: string): boolean {
  return /\b(the plan assumes|recommended because|confirm once|depends on|after checking|route refresh|before execution|needs replanning|suitable for|choose an easy|prioritize hydration|travel time remains to be checked)\b/i.test(value);
}

function shortRoutePlaceName(place: PlanPlace): string {
  return displayPlaceName(place).split(/[·•|]/)[0]!.replace(/\s+Sanctuary\b/i, "").trim();
}

function routeDistanceLabel(segment: Pick<PlanRouteSegment, "detail" | "distanceMeters">): string {
  if (typeof segment.distanceMeters === "number" && Number.isFinite(segment.distanceMeters)) {
    return segment.distanceMeters >= 1000 ? `${trimDistance(segment.distanceMeters / 1000)} km` : `${Math.round(segment.distanceMeters)} m`;
  }
  const text = travelerFacingDefaultText(segment.detail);
  const match = text.match(/\babout\s+([\d.]+\s*(?:km|miles?|mi|m))\b/i);
  return match?.[1] ?? "";
}

function routeConnectorTitle(segment: PlanRouteSegment): string {
  const duration = segment.durationMinutes ? compactTravelDurationLabel(segment.durationMinutes) : "";
  const mode = transportModeLabel(segment.mode);
  if (duration) return mode ? `${duration} ${mode}` : duration;
  return routeDisplayLabel(segment);
}

function compactTravelDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function transportModeLabel(mode: PlanRouteSegment["mode"]): string {
  if (mode === "walking") return "walk";
  if (mode === "driving") return "drive";
  if (mode === "rail") return "by rail";
  if (mode === "flight") return "flight";
  if (mode === "transit") return "by transit";
  return "";
}

function transportModeFromText(text: string): PlanRouteSegment["mode"] {
  const normalized = text.toLocaleLowerCase();
  if (/\bwalk|walking|徒歩|步行\b/.test(normalized)) return "walking";
  if (/\btrain|rail|shinkansen|metro|subway|station|火车|地铁|新干线\b/.test(normalized)) return "rail";
  if (/\bflight|fly|airport|航班|飞机\b/.test(normalized)) return "flight";
  if (/\bbus|transit|tram|公交\b/.test(normalized)) return "transit";
  return "driving";
}

function trimDistance(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function routeCheckReadoutLabel(afterConfirmation: boolean): string {
  return afterConfirmation ? "Travel time will be checked after confirm." : "Travel time will be checked automatically.";
}

function itineraryItemsWithPendingRouteCheckReadouts(items: ItineraryCardDisplay[]): ItineraryCardDisplay[] {
  const routeAnchorIndexes = items.flatMap((item, index) => item.placeId && item.routeAnchor ? [index] : []);
  if (routeAnchorIndexes.length < 2) return items;
  const indexesWithNextRoute = new Set(routeAnchorIndexes.slice(0, -1));
  return items.map((item, index) => indexesWithNextRoute.has(index)
    ? { ...item, routeAfterStatusLabel: routeCheckReadoutLabel(true) }
    : item);
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
  const moving = { ...items[currentIndex]! };
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
  return presentation.travelTips.flatMap((tip) => {
    const body = travelerFacingDefaultText(tip.body);
    if (!body) return [];
    return [{
      id: tip.id,
      title: travelerFacingLabel(tip.title, tipTitle(body)),
      body,
      context: travelerFacingLabel(tip.context, "Trip tip"),
      theme: tip.theme,
      sources: sourceSummariesForEvidenceRefs(tip.evidence, presentation.sourceCatalog ?? []),
      dayId: tip.dayId, blockId: tip.blockId, placeId: tip.placeId,
      pinned: tip.pinned, hidden: tip.hidden
    }];
  });
}

function localTipsForPlan(plan: Pick<Plan, "stages" | "presentation" | "location">): TipDisplay[] {
  const placeTips = (plan.presentation?.places ?? []).flatMap((place) => {
    const body = travelerFacingDefaultText(place.tip ?? "");
    if (!body || !isDestinationRelevantTip(body)) return [];
    return [{
      id: `place-${place.id}`,
      title: tipTitle(body),
      body,
      context: [place.area, place.city, place.name].filter(Boolean).join(" · ")
    }];
  });
  const taskTips = plan.stages.flatMap((stage) => stage.tasks.flatMap((task) => {
    const text = travelerFacingDefaultText(`${task.title}. ${task.description ?? ""}`);
    if (task.owner !== "assistant" || !/tip|custom|safety|payment|transport|etiquette|local|礼仪|安全|支付|交通|风俗/.test(`${stage.title} ${task.title}`.toLocaleLowerCase()) || !isDestinationRelevantTip(text)) return [];
    return [{ id: `task-${task.id}`, title: travelerFacingLabel(task.title, tipTitle(text)), body: travelerFacingDefaultText(task.description ?? task.title) || text, context: travelerFacingLabel(stage.title, "Trip tip") }];
  }));
  return uniqueTips([...placeTips, ...taskTips]).slice(0, 12);
}

function preparationGroupsForPresentation(plan: Plan, presentation: PlanPresentation): PreparationGroupDisplay[] {
  if (presentation.preparationChecklist === undefined) return preparationGroupsForPlan(plan);
  const canonical = presentation.preparationChecklist;
  const requirements = new Map((presentation.actionRequirements ?? []).map((requirement) => [requirement.id, requirement] as const));
  const places = new Map(presentation.places.map((place) => [place.id, place] as const));
  const completedTaskIds = new Set(plan.stages.flatMap((stage) => stage.tasks.filter((task) => task.status === "completed").map((task) => task.id)));
  const completedRequirementIds = new Set(plan.stages.flatMap((stage) => stage.tasks.flatMap((task) => task.status === "completed" && task.requirementId ? [task.requirementId] : [])));
  const taskByRequirementId = preparationTaskByRequirementId(plan);
  const taskByChecklistItemId = preparationTaskByChecklistItemId(plan, canonical);
  const actionItems = uniquePreparationActionRequirements(presentation.actionRequirements ?? []).map((requirement) => preparationItemForRequirement(requirement, places, completedRequirementIds, taskByRequirementId.get(requirement.id)));
  for (const item of actionItems) { const requirement = requirements.get(item.requirementId!); item.sources = sourceSummariesForEvidenceRefs(requirement?.evidence, presentation.sourceCatalog ?? []); const place = requirement?.placeId ? places.get(requirement.placeId) : undefined; item.links = place ? detailLinks(place) : []; }
  const actionFingerprints = actionItems.flatMap(preparationDisplayFingerprints);
  const generalGroups = new Map<BlueprintPreparationGroup, PreparationChecklistItemDisplay[]>();
  for (const item of canonical) {
    const requirement = item.requirementId ? requirements.get(item.requirementId) : undefined;
    if (requirement) {
      const action = actionItems.find((candidate) => candidate.requirementId === requirement.id);
      if (action) {
        action.sources = uniqueSourceMarkers([...(action.sources ?? []), ...sourceSummariesForEvidenceRefs(item.evidence, presentation.sourceCatalog ?? [])]);
        const linkedPlace = item.placeId ? places.get(item.placeId) : undefined;
        if (linkedPlace) action.links = [...new Map([...(action.links ?? []), ...detailLinks(linkedPlace)].map((link) => [link.url, link])).values()];
        continue;
      }
    }
    if (preparationChecklistDuplicatesAction(item, actionFingerprints)) continue;
    const place = item.placeId ? places.get(item.placeId) : undefined;
    const description = firstUsefulText([item.description, item.completionCondition]);
    const title = preparationItemTitle(item.title, undefined, description);
    const body = preparationBodyDescription(title, description);
    const completion = firstUsefulText([item.completionCondition], description);
    const context = place ? `For ${displayPlaceName(place)}` : undefined;
    const task = item.requirementId ? taskByRequirementId.get(item.requirementId) : taskByChecklistItemId.get(item.id);
    generalGroups.set(item.group, [...(generalGroups.get(item.group) ?? []), {
      id: item.id,
      ...(task ? { taskId: task.id } : {}),
      ...(item.requirementId ? { requirementId: item.requirementId } : {}),
      checklistItemId: item.id,
      title,
      ...(body ? { description: body } : {}),
      ...(completion ? { completion } : {}),
      ...(context ? { context } : {}),
      role: "general" as const,
      sources: sourceSummariesForEvidenceRefs(item.evidence, presentation.sourceCatalog ?? []),
      links: place ? detailLinks(place) : [],
      checked: Boolean(task ? completedTaskIds.has(task.id) : item.completed),
      checkable: true
    }]);
  }
  const groups: PreparationGroupDisplay[] = actionItems.length ? [{ title: "Action Required", items: actionItems }] : [];
  return [
    ...groups,
    ...preparationGroupOrder.flatMap((group) => {
    const items = generalGroups.get(group) ?? [];
    return items.length ? [{ title: preparationGroupLabel(group), items }] : [];
  })
  ];
}

function preparationItemForRequirement(requirement: BlueprintActionRequirement, places: Map<string, PlanPlace>, completedRequirementIds: Set<string>, task?: Task): PreparationChecklistItemDisplay {
  const place = requirement.placeId ? places.get(requirement.placeId) : undefined;
  const description = travelerFacingDefaultText(requirement.description);
  const title = preparationItemTitle(requirement.title, requirement, description);
  const body = preparationBodyDescription(title, description);
  const completion = firstUsefulText([requirement.completionCondition], description);
  const context = [place ? `For ${displayPlaceName(place)}` : undefined, travelerFacingDefaultText(requirement.relevantAt)].filter(Boolean).join(" · ");
  return {
    id: requirement.id,
    ...(task ? { taskId: task.id } : {}),
    requirementId: requirement.id,
    title,
    ...(body ? { description: body } : {}),
    ...(completion ? { completion } : {}),
    ...(context ? { context } : {}),
    role: "action",
    checked: task ? task.status === "completed" : completedRequirementIds.has(requirement.id),
    checkable: Boolean(task)
  };
}

function preparationTaskByRequirementId(plan: Plan): Map<string, Task> {
  const tasks = new Map<string, Task>();
  for (const task of plan.stages.flatMap((stage) => stage.tasks)) {
    if (!task.requirementId || !isUserPreparationTask(task)) continue;
    if (!tasks.has(task.requirementId)) tasks.set(task.requirementId, task);
  }
  return tasks;
}

function preparationTaskByChecklistItemId(plan: Plan, checklist: BlueprintPreparationChecklistItem[]): Map<string, Task> {
  const result = new Map<string, Task>();
  const tasks = plan.stages.flatMap((stage) => stage.tasks).filter(isUserPreparationTask);
  const tasksById = new Map(tasks.map((task) => [task.id, task] as const));
  for (const item of checklist) {
    const direct = tasksById.get(item.id);
    if (direct) result.set(item.id, direct);
  }
  return result;
}

function isUserPreparationTask(task: Task): boolean {
  return task.owner === "user" && task.preparationCategory !== undefined && task.preparationCategory !== "not_applicable";
}

function uniquePreparationActionRequirements(requirements: BlueprintActionRequirement[]): BlueprintActionRequirement[] {
  const unique: BlueprintActionRequirement[] = [];
  for (const requirement of requirements) {
    if (requirement.accountableParty === "assistant") continue;
    if (unique.some((candidate) => equivalentPreparationRequirement(candidate, requirement))) continue;
    unique.push(requirement);
  }
  return unique;
}

function equivalentPreparationRequirement(left: BlueprintActionRequirement, right: BlueprintActionRequirement): boolean {
  return left.id === right.id;
}

function preparationChecklistDuplicatesAction(item: BlueprintPreparationChecklistItem, actionFingerprints: string[]): boolean {
  const fingerprints = preparationChecklistFingerprints(item);
  return fingerprints.some((fingerprint) => actionFingerprints.some((action) => fingerprint === action || fingerprint.includes(action) || action.includes(fingerprint)));
}

function preparationDisplayFingerprints(item: PreparationChecklistItemDisplay): string[] {
  return [item.title, item.description, item.completion].flatMap((value) => {
    const normalized = normalizedPreparationText(value ?? "");
    return normalized ? [normalized] : [];
  });
}

function preparationChecklistFingerprints(item: BlueprintPreparationChecklistItem): string[] {
  return [item.title, item.description, item.completionCondition].flatMap((value) => {
    const normalized = normalizedPreparationText(value ?? "");
    return normalized ? [normalized] : [];
  });
}

function normalizedPreparationText(value: string): string {
  return travelerFacingDefaultText(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an|and|or|for|to|of|in|on|with|each|all|current)\b/g, " ").replace(/\s+/g, " ").trim();
}

function preparationItemsForPlan(plan: Plan): Array<{ task: Task; stageTitle: string }> {
  return plan.stages.flatMap((stage) => stage.tasks
    .filter((task) => task.owner === "user" && task.preparationCategory !== undefined && task.preparationCategory !== "not_applicable")
    .map((task) => ({ task, stageTitle: stage.title })));
}

function preparationGroupsForPlan(plan: Plan): PreparationGroupDisplay[] {
  return groupPreparationItems(preparationItemsForPlan(plan)).map((group) => ({
    title: group.title,
    items: group.items.map(({ task }) => {
      const title = preparationItemTitle(task.title);
      const description = preparationBodyDescription(title, travelerFacingDefaultText(task.description ?? ""));
      return {
        id: task.id,
        taskId: task.id,
        title,
        ...(description ? { description } : {}),
        role: "general" as const,
        checked: task.status === "completed",
        checkable: true
      };
    })
  }));
}

function preparationItemTitle(title: string | undefined, requirement?: BlueprintActionRequirement, fallbackText?: string): string {
  const primary = travelerFacingDefaultText(title);
  const fallback = firstUsefulSentence(fallbackText ?? "");
  if (primary && /\.\.\.|…/.test(primary) && fallback) return fallback;
  if (primary && !looksLikePreparationCategoryLabel(primary)) return primary;
  const requirementTitle = travelerFacingDefaultText(requirement?.title);
  if (requirementTitle && /\.\.\.|…/.test(requirementTitle) && fallback) return fallback;
  if (requirementTitle && !looksLikePreparationCategoryLabel(requirementTitle)) return requirementTitle;
  if (fallback) return fallback;
  return requirement ? "Travel documents" : "Travel preparation";
}

function firstUsefulText(values: Array<string | undefined>, skip?: string): string {
  const skipped = skip?.trim();
  for (const value of values) {
    const text = travelerFacingDefaultText(value);
    if (text && text !== skipped) return text;
  }
  return "";
}

function preparationBodyDescription(title: string, description: string | undefined): string | undefined {
  const body = travelerFacingDefaultText(description);
  if (!body || normalizedPreparationText(body) === normalizedPreparationText(title)) return undefined;
  if (!body.startsWith(title)) return body;
  const remainder = body.slice(title.length).replace(/^[\s.!?。！？;；:：-]+/, "").trim();
  return remainder || undefined;
}

function looksLikePreparationCategoryLabel(value: string): boolean {
  return /\btravel authorization\b/i.test(value.trim());
}

function roughTimeLabel(time: string | undefined, role: string | undefined, place: Pick<PlanPlace, "category" | "name" | "visitRole">, index: number): string {
  if (time && /^\d{2}:\d{2}$/.test(time)) return time;
  const text = `${role ?? ""} ${place.visitRole ?? ""} ${place.category} ${place.name}`.toLocaleLowerCase();
  if (/breakfast|morning meal/.test(text)) return "Breakfast window";
  if (/lunch|midday|noon/.test(text)) return "Around lunch";
  if (/dinner|supper/.test(text)) return "Dinner window";
  if (/night|evening|bar|show|performance/.test(text)) return "Optional evening";
  if (/shopping|shop|market|souvenir|product|rest|buffer|free|flex/.test(text)) return "Flexible time";
  return "Time to confirm";
}

function roughBlockTimeLabel(block: BlueprintItineraryBlock, place: PlanPlace | undefined, index: number): string {
  if (block.startTime && /^\d{2}:\d{2}$/.test(block.startTime)) return block.startTime;
  if (block.kind === "meal") {
    const mealText = `${block.role ?? ""} ${block.title ?? ""} ${block.summary ?? ""}`;
    if (!block.placeId && !block.endTime && /(?:carry|pack|bring)\b[^.。]{0,35}\b(?:lunch|food|snacks)|(?:准备|携带|自带)(?:午餐|食物|便当)/iu.test(mealText)) return "Meal preparation";
    return /dinner|evening/i.test(mealText) ? "Dinner window" : "Around lunch";
  }
  if (block.kind === "rest") return "Rest window";
  if (block.kind === "transfer") return "";
  if (block.kind === "lodging") return "";
  if (block.kind === "event") return "Event window";
  if (block.kind === "flexible") return "Flexible time";
  return roughTimeLabel(block.startTime, block.role, place ?? { category: block.kind, name: block.title ?? block.kind }, index);
}

export function deriveTimelineTimeDisplay(block: BlueprintItineraryBlock, place?: PlanPlace, index = 0): { mode: TimelineDisplayTimeMode; label?: string } {
  if (block.kind === "transfer" && !timelinePointAnchor(block, place)) return { mode: "none" };
  const start = /^\d{2}:\d{2}$/.test(block.startTime ?? "") ? block.startTime : undefined;
  const end = /^\d{2}:\d{2}$/.test(block.endTime ?? "") ? block.endTime : undefined;
  const authoredLabel = block.display?.timeLabel?.trim();
  if (authoredLabel && !/^\d{2}:\d{2}(?:\s*[-–]\s*\d{2}:\d{2})?$/.test(authoredLabel)) return { mode: "point", label: authoredLabel };
  if (!start) {
    if (end) {
      if (block.kind === "transfer") return { mode: "point", label: `Arrive by ${end}` };
      const departure = /\bdepart(?:ure|ing)?\b/i.test(`${block.role ?? ""} ${block.title ?? ""} ${block.summary ?? ""}`);
      return { mode: "point", label: `${departure ? "Departure" : "Ends"} ${end}` };
    }
    const fallback = roughBlockTimeLabel(block, place, index);
    return fallback ? { mode: "point", label: fallback } : { mode: "none" };
  }
  const range = Boolean(end && timelineDurationIsDecisionUseful(block, place));
  return range ? { mode: "range", label: `${start}–${end}` } : { mode: "point", label: start };
}

function timelineDurationIsDecisionUseful(block: BlueprintItineraryBlock, place: PlanPlace | undefined): boolean {
  if (timelinePointAnchor(block, place)) return false;
  if (block.kind === "stop" || block.kind === "event") return true;
  if (block.kind === "lodging" || block.kind === "rest") return false;
  const semanticText = `${block.role ?? ""} ${block.title ?? ""} ${place?.category ?? ""} ${place?.visitRole ?? ""} ${place?.name ?? ""}`.toLocaleLowerCase();
  if (block.kind === "meal") {
    return (block.durationMinutes ?? 0) >= 120 && /\b(tasting|degustation|chef.?s menu|set menu|dining experience|cooking class|culinary experience)\b/.test(semanticText);
  }
  if (block.kind === "flexible") {
    return Boolean(place && (block.durationMinutes ?? 0) >= 90 && /\b(experience|class|workshop|spa|session|performance|show|tour|cruise|tasting)\b/.test(semanticText));
  }
  return false;
}

function timelinePointAnchor(block: BlueprintItineraryBlock, place: PlanPlace | undefined): boolean {
  const text = `${block.role ?? ""} ${block.title ?? ""} ${place?.category ?? ""} ${place?.visitRole ?? ""}`.toLocaleLowerCase();
  return /\b(arriv(?:e|al)|depart(?:ure)?|flight|airport processing|check[ -]?(?:in|out)|luggage handover|formalities)\b/.test(text);
}

function blockGuideType(block: BlueprintItineraryBlock): GuideFilter {
  if (block.kind === "meal") return "dining";
  if (block.kind === "event") return "experience";
  if (block.kind === "lodging") return "stay";
  if (block.kind === "transfer") return "transport";
  return "attraction";
}

function timelineRoleForBlock(block: BlueprintItineraryBlock, place: PlanPlace | undefined): ItineraryTimelineRole {
  if (block.kind === "transfer") return "transport";
  if (isAirportSupportingStep(block, place)) return block.kind === "rest" ? "rest" : "activity";
  if ((block.kind === "lodging" || block.kind === "rest") && (!place || place.accommodation)) return "rest";
  if (place) return "place";
  if (block.kind === "meal") return blockImpliesPendingPlace(block) ? "pending_place" : "activity";
  return "activity";
}

function timelineRoleForPlace(place: PlanPlace): ItineraryTimelineRole {
  return "place";
}

function blockImpliesPendingPlace(block: BlueprintItineraryBlock): boolean {
  const text = `${block.title ?? ""} ${block.summary ?? ""} ${block.role ?? ""}`.toLocaleLowerCase();
  if (/\b(tbd|to be determined|not selected|not confirmed|unconfirmed|choose restaurant|select restaurant|choose hotel|select hotel|pickup point|meeting point)\b/.test(text)) return true;
  if (/\b(restaurant|hotel|accommodation|lodging|station|attraction)\b.*\b(tbd|not selected|not confirmed|unconfirmed)\b/.test(text)) return true;
  if (/\b(tbd|not selected|not confirmed|unconfirmed)\b.*\b(restaurant|hotel|accommodation|lodging|station|attraction)\b/.test(text)) return true;
  return /待定|未定|未选择|未确认|选择酒店|选择餐厅|集合点/.test(text);
}

function blockTitle(block: BlueprintItineraryBlock, place: PlanPlace | undefined): string | undefined {
  return deriveTimelineTitle(block, place);
}

export function deriveTimelineTitle(block: BlueprintItineraryBlock, place?: PlanPlace): string | undefined {
  const semanticTitle = block.title?.trim() ?? "";
  const text = `${block.role ?? ""} ${semanticTitle} ${block.summary ?? ""} ${block.display?.meta ?? ""}`.toLocaleLowerCase();
  if (place?.accommodation && block.kind !== "transfer") return place.name;
  if (block.kind === "rest") {
    if (/\bmedication|medical|health\b/.test(text)) return "Medication rest";
    if (/\bbreakfast|brunch\b/.test(text)) return /\bfree time|quiet|morning|beachfront\b/.test(text) ? "Breakfast & free time" : "Breakfast";
    return place?.accommodation || /\bhotel|lodg|accommodation|base\b/.test(text) ? "Hotel rest" : "Rest";
  }
  if (/\binternational check[ -]?in|security|departure processing|airport processing|formalities\b/.test(text)) return "Airport processing";
  if (block.kind === "event" && /\bdepart(?:ure)?\b/.test(text)) return semanticTitle.replace(/^confirmed\s+/i, "") || "Departure";
  if (block.kind === "event" && /\barriv(?:e|al)\b/.test(text)) return semanticTitle.replace(/^confirmed\s+/i, "") || "Arrival";
  if (block.kind === "transfer") {
    if (/^Depart from\s+.+/i.test(semanticTitle)) return semanticTitle;
    if (/\bdepart(?:ure)?\b/.test(text) && semanticTitle.length <= 32) return semanticTitle;
    if (/\b(?:airport|dps|lax)\b.*\barrival\b|\barrival\b.*\b(?:airport|dps|lax)\b/.test(text)) return semanticTitle.replace(/\s+and\s+pickup.*$/i, "");
    if (/\bpickup|meeting arrangement\b/.test(text) && semanticTitle.length <= 32) return semanticTitle;
    const destination = semanticTitle.match(/\b(?:to|toward|for)\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})/u)?.[1];
    const arrivalDestination = destination ?? semanticTitle.match(/\b(?:at|into)\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})/u)?.[1];
    if (/\badmission|arrival procedures|entry procedures\b/.test(text) && arrivalDestination) return `${arrivalDestination} arrival`;
    if (destination) return `Transfer to ${destination}`;
    if (/\bairport|dps|lax\b/.test(text) || /\bairport|terminal\b/.test(`${place?.category ?? ""} ${place?.visitRole ?? ""}`.toLocaleLowerCase())) return "Airport transfer";
    if (place?.accommodation?.baseLabel) return `Transfer to ${place.accommodation.baseLabel}`;
    if (place) return `Transfer to ${place.name}`;
    return "Transfer";
  }
  if (place) return place.name;
  if (block.kind === "meal") {
    const label = mealTimelineLabel(block);
    return label === "Breakfast" && /\bfree time|quiet|morning\b/.test(text) ? "Breakfast & free time" : label;
  }
  if (/\bpacking|pack\b/.test(text)) return "Packing";
  if (/\bconnection|connect\b/.test(text)) return "Connection";
  if (/\bin transit|transit\b/.test(text)) return "In transit";
  if (semanticTitle) return semanticTitle;
  if (block.kind === "lodging") return "Accommodation";
  if (block.kind === "event") return "Timed event";
  if (block.kind === "flexible") return "Flexible time";
  return undefined;
}

function mealTimelineLabel(block: BlueprintItineraryBlock): string {
  const text = `${block.role ?? ""} ${block.title ?? ""} ${block.summary ?? ""}`.toLocaleLowerCase();
  if (/\btasting|degustation|chef.?s menu\b/.test(text)) return "Tasting menu";
  if (/\bbreakfast|brunch\b/.test(text)) {
    if (/post[- ]walk|after the walk/.test(text)) return "Post-walk breakfast";
    if (/recover|recovery|hydration/.test(text)) return "Breakfast & recovery";
    return "Breakfast";
  }
  if (/\bdinner|supper\b/.test(text)) return "Dinner";
  if (/\blunch|midday\b/.test(text)) return "Lunch";
  const hour = Number.parseInt(block.startTime?.slice(0, 2) ?? "", 10);
  if (Number.isFinite(hour)) return hour < 11 ? "Breakfast" : hour < 16 ? "Lunch" : "Dinner";
  return "Meal";
}

function blockMeta(block: BlueprintItineraryBlock): string | undefined {
  const displayMeta = travelerFacingDefaultText(block.display?.meta);
  if (displayMeta && !timingOnlyMeta(displayMeta)) return displayMeta;
  const summary = travelerFacingDefaultText(block.summary);
  if (summary) return summary;
  const role = travelerFacingDefaultText(block.role);
  return role || (block.durationMinutes ? `${block.durationMinutes} min` : undefined);
}

function sourceSummariesForPlace(place: Pick<PlanPlace, "evidenceSources" | "fieldEvidence" | "sourceRefs">, planSources: SourceReference[], sourceCatalog: BlueprintSource[] = [], blockEvidence: SourceMarkerDisplay[] = []): SourceMarkerDisplay[] {
  const sources = [
    ...sourceSummariesForFieldEvidence(place.fieldEvidence, sourceCatalog),
    ...blockEvidence,
    ...(place.evidenceSources?.map((evidence) => {
      return {
        label: "Source",
        summary: [evidence.title, evidence.role, evidence.supports?.slice(0, 2).join("; "), evidence.status && evidence.status !== "verified" ? "needs recheck" : undefined, evidence.checkedAt ? `checked ${evidence.checkedAt}` : undefined].filter(Boolean).join(" · "),
        url: evidence.url
      };
    }) ?? []),
    ...place.sourceRefs.flatMap((sourceRef) => {
      const source = sourceReferenceForRef(sourceRef, planSources, sourceCatalog);
      const url = source?.url ?? (isHttpUrl(sourceRef) ? sourceRef : undefined);
      return [source ? sourceMarkerForReference(source) : { label: "Source", summary: "Source details unavailable", ...(url ? { url } : {}) }];
    })
  ];
  return uniqueSourceMarkers(sources);
}

function sourceSummariesForRefs(sourceRefs: string[] | undefined, planSources: SourceReference[], sourceCatalog: BlueprintSource[] = []): SourceMarkerDisplay[] {
  return (sourceRefs ?? []).flatMap((sourceRef) => {
    const source = sourceReferenceForRef(sourceRef, planSources, sourceCatalog);
    const url = source?.url ?? (isHttpUrl(sourceRef) ? sourceRef : undefined);
    return [source ? sourceMarkerForReference(source) : { label: "Source", summary: sourceRef, ...(url ? { url } : {}) }];
  });
}

function sourceSummariesForRouteSegment(segment: Pick<PlanRouteSegment, "evidence" | "sourceRefs">, planSources: SourceReference[], sourceCatalog: BlueprintSource[] = []): SourceMarkerDisplay[] {
  return uniqueSourceMarkers([
    ...sourceSummariesForEvidenceRefs(segment.evidence, sourceCatalog),
    ...sourceSummariesForRefs(segment.sourceRefs, planSources, sourceCatalog)
  ]);
}

function sourceSummariesForEvent(event: Pick<PlanPresentationEvent, "evidence" | "sourceRefs">, planSources: SourceReference[], sourceCatalog: BlueprintSource[] = [], context?: string): SourceMarkerDisplay[] {
  return uniqueSourceMarkers([
    ...sourceSummariesForEvidenceRefs(event.evidence, sourceCatalog, context),
    ...sourceSummariesForRefs(event.sourceRefs, planSources, sourceCatalog)
  ]);
}

function sourceSummariesForEvidenceRefs(evidence: BlueprintEvidenceRef[] | undefined, sourceCatalog: BlueprintSource[], context?: string): SourceMarkerDisplay[] {
  return (evidence ?? []).flatMap((ref) => {
    const source = sourceCatalog.find((candidate) => candidate.id === ref.sourceId);
    if (!source) return [];
    const refSummary = [sourceReferenceSummary(source), ref.supports?.slice(0, 2).join("; "), evidenceStatusLabel(ref.status), ref.checkedAt ? `checked ${ref.checkedAt}` : undefined].filter(Boolean).join(" · ");
    const contexts = sourceEvidenceContexts(ref, context);
    const status = sourceMarkerStatus(ref.status);
    return [{
      label: "Source",
      summary: refSummary,
      url: source.url,
      title: source.title,
      publisher: source.authority,
      ...(source.purpose ? { purpose: source.purpose } : {}),
      retrievedAt: source.retrievedAt,
      ...(status ? { status } : {}),
      ...(contexts.length ? { contexts } : {})
    }];
  });
}

function sourceMarkersForPlan(plan: Plan, presentation: PlanPresentation): SourceMarkerDisplay[] {
  const sourceCatalog = presentation.sourceCatalog ?? [];
  const fromPlan = plan.sources.map((source) => sourceMarkerForReference(source));
  const fromPlaces = presentation.places.flatMap((place) => place.evidenceSources?.map((source) => {
    const status = sourceMarkerStatus(source.status);
    return {
      label: "Source",
      summary: [source.title, source.role, source.status && source.status !== "verified" ? "Needs confirmation close to the trip" : undefined, source.checkedAt ? `checked ${source.checkedAt}` : undefined].filter(Boolean).join(" · "),
      url: source.url,
      title: source.title,
      ...(source.role ? { publisher: source.role } : {}),
      ...(status ? { status } : {}),
      contexts: [`Supports ${displayPlaceName(place)}`]
    };
  }) ?? []);
  const fromEvents = (presentation.events ?? []).flatMap((event) => sourceSummariesForEvent(event, plan.sources, sourceCatalog, "Supports event timing"));
  const fromPresentation = [
    ...sourceCatalog.map((source) => sourceMarkerForReference(source)),
    ...sourceSummariesForFieldEvidence(presentation.fieldEvidence, sourceCatalog, "Supports trip planning details"),
    ...(presentation.places ?? []).flatMap((place) => sourceSummariesForFieldEvidence(place.fieldEvidence, sourceCatalog, `Supports ${displayPlaceName(place)}`)),
    ...blockEvidenceForPlan(presentation, sourceCatalog),
    ...(presentation.routeSegments ?? []).flatMap((segment) => sourceSummariesForEvidenceRefs(segment.evidence, sourceCatalog, "Supports route timing")),
    ...(presentation.travelTips ?? []).flatMap((tip) => sourceSummariesForEvidenceRefs(tip.evidence, sourceCatalog, `Supports ${travelTipThemeLabel(tip.theme).toLocaleLowerCase()} tip`)),
    ...(presentation.preparationChecklist ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog, "Supports travel preparation")),
    ...(presentation.actionRequirements ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog, actionRequirementSourceContext(item))),
    ...(presentation.localFoods ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog, "Supports local food note")),
    ...(presentation.localProducts ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog, "Supports local find")),
    ...(presentation.experienceThemes ?? []).flatMap((item) => sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog, "Supports experience note")),
    ...(presentation.guideRelationshipGraph?.relationships ?? []).flatMap((relationship) => sourceSummariesForEvidenceRefs(relationship.evidence, sourceCatalog, "Supports place pairing"))
  ];
  return uniqueSourceMarkers([...fromPresentation, ...fromPlan, ...fromPlaces, ...fromEvents]);
}

function sourceGroupsForPlan(plan: Plan, presentation: PlanPresentation): SourceGroupDisplay[] {
  const groups = new Map<SourceGroupDisplay["id"], SourceMarkerDisplay[]>([
    ["needs_recheck", []],
    ["verified_with_recheck", []],
    ["verified", []],
    ["other", []]
  ]);
  for (const source of sourceMarkersForPlan(plan, presentation)) {
    const groupId: SourceGroupDisplay["id"] = source.documentStatus === "verified" && sourceNeedsRecheck(source)
      ? "verified_with_recheck"
      : sourceNeedsRecheck(source) ? "needs_recheck" : sourceIsGrounded(source) ? "verified" : "other";
    groups.set(groupId, [...(groups.get(groupId) ?? []), source]);
  }
  const definitions: Array<Omit<SourceGroupDisplay, "sources">> = [
    { id: "needs_recheck", title: "Needs recheck / confirmation", description: "Operational details whose evidence says to confirm timing, access, reservations, or rules close to the trip." },
    { id: "verified_with_recheck", title: "Verified sources · trip details to recheck", description: "The source was checked, but a specific schedule, price, booking, or rule still needs confirmation close to travel." },
    { id: "verified", title: "Verified / grounded sources", description: "Structured sources that ground plan facts, places, route notes, preparation, or tips." },
    { id: "other", title: "Other research sources", description: "Additional references retained from the plan without a current recheck flag." }
  ];
  return definitions.flatMap((definition) => {
    const sources = groups.get(definition.id) ?? [];
    return sources.length ? [{ ...definition, sources }] : [];
  });
}

function blockEvidenceForPlace(presentation: PlanPresentation, placeId: string): SourceMarkerDisplay[] {
  const sourceCatalog = presentation.sourceCatalog ?? [];
  return uniqueSourceMarkers(presentation.days.flatMap((day) => (day.blocks ?? [])
    .filter((block) => block.placeId === placeId)
    .flatMap((block) => sourceSummariesForEvidenceRefs(block.evidence, sourceCatalog, blockSourceContext(day, block)))));
}

function blockEvidenceForPlan(presentation: PlanPresentation, sourceCatalog: BlueprintSource[]): SourceMarkerDisplay[] {
  return presentation.days.flatMap((day) => (day.blocks ?? [])
    .flatMap((block) => sourceSummariesForEvidenceRefs(block.evidence, sourceCatalog, blockSourceContext(day, block))));
}

function blockSourceContext(day: Pick<ItineraryDay, "label" | "date">, block: BlueprintItineraryBlock): string {
  const label = day.date ?? day.label;
  const title = block.title?.trim();
  return `Supports ${label}${title ? ` ${title}` : ""} itinerary block`;
}

function sourceSummariesForFieldEvidence(fieldEvidence: Array<{ evidence: BlueprintEvidenceRef[] }> | undefined, sourceCatalog: BlueprintSource[], context?: string): SourceMarkerDisplay[] {
  return (fieldEvidence ?? []).flatMap((field) => sourceSummariesForEvidenceRefs(field.evidence, sourceCatalog, context));
}

function sourceReferenceForRef(sourceRef: string, planSources: SourceReference[], sourceCatalog: BlueprintSource[]): Pick<SourceReference, "title" | "authority" | "retrievedAt" | "url"> & { status?: string; purpose?: "evidence" | "inspiration" } | undefined {
  const normalizedRefUrl = isHttpUrl(sourceRef) ? normalizeSourceUrl(sourceRef) : undefined;
  return sourceCatalog.find((candidate) => candidate.id === sourceRef || candidate.url === sourceRef || (normalizedRefUrl && normalizeSourceUrl(candidate.url) === normalizedRefUrl))
    ?? planSources.find((candidate) => candidate.url === sourceRef || (normalizedRefUrl && normalizeSourceUrl(candidate.url) === normalizedRefUrl));
}

function uniqueSourceMarkers(sources: SourceMarkerDisplay[]): SourceMarkerDisplay[] {
  const merged = new Map<string, SourceMarkerDisplay>();
  for (const source of sources) {
    const key = sourceMarkerKey(source);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...source, ...(source.contexts?.length ? { contexts: uniqueStrings(source.contexts) } : {}) });
      continue;
    }
    const contexts = uniqueStrings([...(existing.contexts ?? []), ...(source.contexts ?? [])]);
    const status = strongestSourceStatus(existing.status, source.status);
    const documentStatus = strongestSourceStatus(existing.documentStatus, source.documentStatus);
    merged.set(key, {
      ...existing,
      ...(source.purpose ? { purpose: source.purpose } : {}),
      ...(source.retrievedAt ? { retrievedAt: source.retrievedAt } : {}),
      ...(status ? { status } : {}),
      ...(documentStatus ? { documentStatus } : {}),
      ...(contexts.length ? { contexts } : {})
    });
  }
  return [...merged.values()];
}

function sourceMarkerKey(source: SourceMarkerDisplay): string {
  return source.url ? `url:${normalizeSourceUrl(source.url)}` : `summary:${source.summary.trim().toLocaleLowerCase()}`;
}

function normalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${pathname}`.toLocaleLowerCase();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function evidenceStatusLabel(status: BlueprintEvidenceRef["status"]): string | undefined {
  return status === "verified" ? undefined : "Needs confirmation close to the trip";
}

function sourceMarkerForReference(source: Pick<SourceReference, "title" | "authority" | "retrievedAt" | "url"> & { status?: string; purpose?: "evidence" | "inspiration" }): SourceMarkerDisplay {
  const status = sourceMarkerStatus(source.status);
  return {
    label: "Source",
    summary: sourceReferenceSummary(source),
    url: source.url,
    title: source.title,
    publisher: source.authority,
    ...(source.purpose ? { purpose: source.purpose } : {}),
    retrievedAt: source.retrievedAt,
    ...(status ? { status, documentStatus: status } : {})
  };
}

function sourceMarkerStatus(status: string | undefined): SourceMarkerDisplay["status"] {
  if (status === "verified" || status === "recheck" || status === "stale") return status;
  return status ? "unknown" : undefined;
}

function strongestSourceStatus(left: SourceMarkerDisplay["status"], right: SourceMarkerDisplay["status"]): SourceMarkerDisplay["status"] {
  const rank: Record<NonNullable<SourceMarkerDisplay["status"]>, number> = { stale: 4, recheck: 3, unknown: 2, verified: 1 };
  if (!left) return right;
  if (!right) return left;
  return rank[right] > rank[left] ? right : left;
}

function sourceNeedsRecheck(source: SourceMarkerDisplay): boolean {
  const text = `${source.status ?? ""} ${source.summary} ${(source.contexts ?? []).join(" ")}`.toLocaleLowerCase();
  return /\b(recheck|stale|needs confirmation|confirm close|needs check)\b/.test(text);
}

function sourceIsGrounded(source: SourceMarkerDisplay): boolean {
  if (source.purpose === "inspiration") return false;
  if (source.status === "verified") return true;
  return Boolean(source.contexts?.some((context) => /^supports\b/i.test(context)));
}

function sourceEvidenceContexts(ref: BlueprintEvidenceRef, context?: string): string[] {
  return uniqueStrings([
    context,
    ...(ref.supports?.slice(0, 2).map((support) => `Supports ${support}`) ?? []),
    evidenceStatusLabel(ref.status),
    ref.checkedAt ? `Checked ${ref.checkedAt}` : undefined
  ].filter(Boolean) as string[]);
}

function actionRequirementSourceContext(requirement: BlueprintActionRequirement): string {
  switch (requirement.kind) {
    case "reservation": return "Supports reservation planning";
    case "travel_authorization": return "Supports entry preparation";
    case "time_sensitive_recheck": return "Supports details to confirm close to the trip";
    case "transport": return "Supports transport preparation";
    case "preparation": return "Supports travel preparation";
    case "other": return "Supports trip preparation";
  }
}

function displayPlaceName(place: Pick<PlanPlace, "name" | "localizedName">): string {
  return place.localizedName && place.localizedName !== place.name ? `${place.name} · ${place.localizedName}` : place.name;
}

function blueprintDateLabel(plan: Pick<Plan, "dates">, presentation: Pick<PlanPresentation, "startDate" | "endDate">): string {
  return presentation.startDate && presentation.endDate ? `${presentation.startDate} - ${presentation.endDate}` : plan.dates;
}

function mapFallbackForPlan(plan: Pick<Plan, "location" | "title" | "dates">, presentation: PlanPresentation): BlueprintMapViewportDisplay {
  const destinationFallback = destinationMapFallback([
    plan.location,
    plan.title,
    plan.dates,
    presentation.summary,
    ...(presentation.cities ?? []),
    ...presentation.days.flatMap((day) => [day.city, day.title, day.summary]),
    ...presentation.places.flatMap((place) => [place.city, place.area, place.locationLabel])
  ]);
  if (destinationFallback) return destinationFallback;
  const coordinates = presentation.places.flatMap((place) => validPlaceCoordinates(place.coordinates) ? [place.coordinates] : []);
  if (coordinates.length) {
    return {
      center: averageCoordinates(coordinates),
      zoom: coordinates.length > 1 ? 10 : 13,
      label: "Trip area"
    };
  }
  return { center: [0, 0], zoom: 2, label: "Trip area" };
}

function destinationMapFallback(values: Array<string | undefined>): BlueprintMapViewportDisplay | undefined {
  const text = normalizeDestinationText(values);
  if (/\b(bali|ubud|denpasar|dps|south kuta|seminyak|tabanan|uluwatu)\b/.test(text)) return { center: [-8.4095, 115.1889], zoom: 10, label: "Bali" };
  if (/\bkyoto\b/.test(text)) return { center: [35.0116, 135.7681], zoom: 11, label: "Kyoto" };
  if (/\b(tokyo|haneda|narita)\b/.test(text)) return { center: [35.6812, 139.7671], zoom: 11, label: "Tokyo" };
  if (/\blisbon\b/.test(text)) return { center: [38.7223, -9.1393], zoom: 12, label: "Lisbon" };
  if (/\bparis\b/.test(text)) return { center: [48.8566, 2.3522], zoom: 12, label: "Paris" };
  return undefined;
}

function normalizeDestinationText(values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase();
}

function averageCoordinates(coordinates: Array<[number, number]>): [number, number] {
  const totals = coordinates.reduce((sum, coordinate) => [sum[0] + coordinate[0], sum[1] + coordinate[1]] as [number, number], [0, 0]);
  return [totals[0] / coordinates.length, totals[1] / coordinates.length];
}

function validPlaceCoordinates(value: PlanPlace["coordinates"] | BlueprintPlaceDisplay["coordinates"] | undefined): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -90
    && value[0] <= 90
    && value[1] >= -180
    && value[1] <= 180;
}

export function guideFilterLabel(filter: GuideFilter): string {
  return filter === "all"
    ? "All"
    : filter === "attraction"
      ? "Attractions"
      : filter === "dining"
        ? "Dining"
        : filter === "shopping"
          ? "Shopping"
          : filter === "experience"
            ? "Experiences"
            : filter === "stay"
              ? "Stay"
              : "Transport";
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
  const explicitSummary = travelerFacingDefaultText(place.guideDisplay?.cardSummary ?? "");
  if (explicitSummary) return shorten(firstUsefulSentence(explicitSummary), 125);
  return shorten(firstUsefulSentence(travelerFacingDefaultText(place.whyWorthIt)) || firstUsefulSentence(travelerFacingDefaultText(place.plan)) || `${place.area ?? place.locationLabel}.`, 125);
}

function firstUsefulSentence(value: string): string {
  return value.split(/(?<=[.!?。！？])\s+/)[0]?.trim() ?? "";
}

function travelerFacingDefaultText(value: string | undefined): string {
  return (value ?? "").split(/(?<=[.!?。！？])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence && !looksLikeInternalWorkspaceText(sentence)).join(" ");
}

function travelerFacingLabel(value: string | undefined, fallback: string): string {
  const text = travelerFacingDefaultText(value);
  return text || fallback;
}

function travelerFacingComparisonText(value: string, fallback: string): string {
  const text = travelerFacingDefaultText(value);
  return text || fallback;
}

function travelerFacingDetailSections(sections: DetailSectionDisplay[]): DetailSectionDisplay[] {
  return sections.flatMap((section) => {
    const title = travelerFacingLabel(section.title, "");
    const body = travelerFacingDefaultText(section.body);
    const items = section.items?.map((item) => travelerFacingDefaultText(item)).filter(Boolean);
    if (!title || (!body && !items?.length)) return [];
    return [{
      title,
      ...(body ? { body } : {}),
      ...(items?.length ? { items } : {})
    }];
  });
}

function guideTypeLabel(place: PlanPlace): string {
  const text = travelerFacingDefaultText(place.category);
  if (!text) return guideFilterLabel(guideTypeForPlace(place));
  return text.split(/\s+/).slice(0, 4).map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1)).join(" ");
}

function guidePlanFitLabel(presentation: PlanPresentation, place: PlanPlace, state: GuideState, timeline: GuideCardDisplay["timeline"], requirements: BlueprintActionRequirement[] = []): string {
  if (timeline) return `In your plan · ${[timeline.label, timeline.timeLabel].filter(Boolean).join(", ")}`;
  if (state === "informational") return "Background for this trip";
  if (reservationRequirementForPlace(requirements)) return "Add after booking check";
  if (requirementNeedsRecheck(requirements) || place.priority === "recheck") return "Add after schedule check";
  if (place.schedulingEligibility?.decision === "high_impact") return "Requires major replanning";
  const relationshipFit = relationshipPlanFitLabel(presentation, place.id);
  if (relationshipFit) return relationshipFit;
  const candidateDay = candidateFitDayForPlace(presentation, place.id);
  if (candidateDay) return candidateDay.city ? `Fits your ${candidateDay.city} day` : `Option for ${dayLabelForId(presentation, candidateDay.id)}`;
  return "Not currently in your plan";
}

function guidePracticalSignal(place: PlanPlace, requirements: BlueprintActionRequirement[] = []): string {
  if (reservationRequirementForPlace(requirements) || place.reservation?.requirement === "required") return "Reservation required";
  if (requirementNeedsRecheck(requirements) || place.priority === "recheck" || place.reservation?.verification === "needs_recheck") return "Needs schedule check";
  const prep = requirements.find((requirement) => requirement.kind === "preparation" || /ticket|entry|permit/i.test(requirement.title));
  if (prep) return travelerFacingLabel(prep.title, "Check before going");
  if (place.durationMinutes) return `~${compactTravelDurationLabel(place.durationMinutes)}`;
  if (place.reservation?.requirement === "recommended") return "Reservation useful";
  return "";
}

function guideDecisionTags(presentation: PlanPresentation, place: PlanPlace, requirements: BlueprintActionRequirement[], planFitLabel: string, practicalSignal: string): string[] {
  const excluded = new Set([place.locationLabel, place.area ?? "", place.city ?? "", guideTypeLabel(place), planFitLabel, practicalSignal].map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
  const tags = guideTags(presentation, place, requirements)
    .filter((tag) => !excluded.has(tag.trim().toLocaleLowerCase()))
    .filter((tag) => !sameText(tag, placePriorityLabel(place.priority)))
    .filter((tag) => !tag.toLocaleLowerCase().includes("reservation") || practicalSignal !== "Reservation required");
  return tags.slice(0, 2);
}

function relationshipPlanFitLabel(presentation: PlanPresentation, placeId: string): string {
  const relationships = presentation.guideRelationshipGraph?.relationships ?? [];
  const rankedKinds: BlueprintPlaceRelationship["kind"][] = ["rainy_day_alternative", "low_energy_alternative", "alternative", "same_area", "same_direction", "event_link", "supports_anchor", "meal_support", "similar"];
  const relationship = [...relationships]
    .filter((item) => item.fromPlaceId === placeId || item.toPlaceId === placeId)
    .sort((left, right) => rankedKinds.indexOf(left.kind) - rankedKinds.indexOf(right.kind))[0];
  if (!relationship) return "";
  const dayLabel = relationship.dayIds?.find((dayId) => !isLightLogisticsDay(presentation.days.find((day) => day.id === dayId)));
  switch (relationship.kind) {
    case "rainy_day_alternative": return dayLabel ? `Rainy-day option for ${dayLabelForId(presentation, dayLabel)}` : "Rainy-day option";
    case "low_energy_alternative": return dayLabel ? `Low-energy option for ${dayLabelForId(presentation, dayLabel)}` : "Low-energy option";
    case "alternative": return dayLabel ? `Alternative for ${dayLabelForId(presentation, dayLabel)}` : "Alternative option";
    case "same_area": return dayLabel ? `Fits your ${dayLabelForId(presentation, dayLabel)} area` : "Fits the same area";
    case "same_direction": return "Fits the same direction";
    case "event_link": return "Conditional event option";
    case "supports_anchor": return "Supports a main stop";
    case "meal_support": return "Meal support option";
    case "similar": return "Similar fit";
  }
}

function candidateFitDayForPlace(presentation: PlanPresentation, placeId: string): ItineraryDay | undefined {
  return presentation.days.find((day) => day.candidates?.includes(placeId) && !isLightLogisticsDay(day));
}

function isLightLogisticsDay(day: ItineraryDay | undefined): boolean {
  if (!day) return true;
  const text = `${day.label} ${day.title ?? ""} ${day.summary ?? ""}`.toLocaleLowerCase();
  if (/\b(arrival|arrive|airport|flight in|landing|transit|transfer|departure|depart|flight out|check.?out|logistics)\b|抵达|到达|机场|航班|中转|转场|离开|出发|退房/.test(text)) return true;
  const placeCount = day.placeIds.length;
  const hasOnlyLogisticsBlocks = Boolean(day.blocks?.length) && day.blocks!.every((block) => block.kind === "transfer" || block.kind === "lodging");
  return placeCount === 0 || hasOnlyLogisticsBlocks;
}

function detailHeroMeta(place: PlanPlace): string[] {
  return uniqueStrings([guideTypeLabel(place), place.area, place.city, place.locationLabel].filter((value): value is string => Boolean(travelerFacingDefaultText(value)))).slice(0, 3);
}

function detailVisitFacts(place: PlanPlace, requirements: BlueprintActionRequirement[] = []): string[] {
  const duration = place.durationMinutes ? `Allow ~${compactTravelDurationLabel(place.durationMinutes)}` : "";
  const practical = guidePracticalSignal(place, requirements);
  return uniqueStrings([
    duration,
    travelerFacingDefaultText(place.visitRole),
    practical && !sameText(practical, duration.replace(/^Allow /, "")) ? practical : ""
  ].filter(Boolean)).slice(0, 3);
}

function detailItineraryContext(presentation: PlanPresentation, place: PlanPlace, requirements: BlueprintActionRequirement[] = []): DetailSectionDisplay | undefined {
  const scheduledDay = scheduledDayForPlace(presentation, place.id);
  if (scheduledDay) {
    const timeline = timelineBlocksForDay(presentation, scheduledDay).find((block) => block.place?.id === place.id && block.timelineRole !== "transport");
    const nextBlock = nextRouteAnchorBlock(presentation, scheduledDay, place.id);
    const routeAfter = timeline?.routeAfter;
    const items = [
      place.durationMinutes ? `Planned stay · ~${compactTravelDurationLabel(place.durationMinutes)}` : "",
      nextBlock ? `Next: ${displayPlaceName(nextBlock.place)}` : "",
      scheduledDay.startContext?.label ? `Start: ${scheduledDay.startContext.label}` : "",
      scheduledDay.endContext?.label ? `End: ${scheduledDay.endContext.label}` : "",
      routeAfter ? routeSegmentShortLabel(routeAfter) : ""
    ].filter(Boolean);
    return {
      title: "In your itinerary",
      body: [dayLabelForId(presentation, scheduledDay.id), timeline?.timeLabel].filter(Boolean).join(" · "),
      ...(items.length ? { items } : {})
    };
  }
  const fit = detailPlanFitLabel(presentation, place, requirements);
  return {
    title: "In your itinerary",
    body: "Not currently in your plan",
    ...(fit && fit !== "Not currently in your plan" ? { items: [`Works well as: ${fit}`] } : {})
  };
}

function scheduledDayForPlace(presentation: PlanPresentation, placeId: string): ItineraryDay | undefined {
  return presentation.days.find((day) => day.placeIds.includes(placeId) || day.blocks?.some((block) => block.placeId === placeId && block.planRole !== "optional" && block.planRole !== "replacement"));
}

function detailPlanFitLabel(presentation: PlanPresentation, place: PlanPlace, requirements: BlueprintActionRequirement[] = []): string {
  const fit = guidePlanFitLabel(presentation, place, guideStateForPlace(place, new Set(presentation.days.flatMap((day) => day.placeIds))), undefined, requirements);
  return fit === "Requires major replanning" ? "Needs a bigger itinerary change" : fit;
}

function nextRouteAnchorBlock(presentation: PlanPresentation, day: ItineraryDay, placeId: string): (TimelineBlock & { place: PlanPlace }) | undefined {
  const blocks = timelineBlocksForDay(presentation, day).filter((block): block is TimelineBlock & { place: PlanPlace } => Boolean(block.place && block.routeAnchor));
  const index = blocks.findIndex((block) => block.place.id === placeId);
  return index === -1 ? undefined : blocks.slice(index + 1).find((block) => block.place.id !== placeId && block.timelineRole !== "transport");
}

function routeSegmentShortLabel(segment: PlanRouteSegment): string {
  const mode = segment.mode === "walking" ? "walk" : segment.mode === "driving" ? "drive" : segment.mode === "transit" ? "transit" : segment.mode;
  return [segment.durationMinutes ? `${segment.durationMinutes} min ${mode}` : mode, segment.verification === "verified" ? "verified" : ""].filter(Boolean).join(" · ");
}

function looksLikeInternalWorkspaceText(value: string): boolean {
  const normalized = value.toLowerCase();
  return [
    /\bdo not schedule\b/,
    /\bdon't schedule\b/,
    /\bavoid scheduling\b/,
    /\bnot schedule (?:it|this)\b/,
    /\bcross-city day\b/,
    /\btiring\b/,
    /\broute order\b/,
    /\broute needs refresh\b/,
    /\broute refresh\b/,
    /\brefresh affected route\b/,
    /\bneeds? route\b/,
    /\bedited directly\b/,
    /\bworkspace\b/,
    /\bschema\b/,
    /\brenderer\b/,
    /\bthemeprofile\b/,
    /\btoken\b/,
    /\bhash\b/,
    /\bjson\b/,
    /\bcandidate\b/,
    /\bhigh-impact\b/,
    /\bexecution-ready\b/,
    /\bbefore execution\b/,
    /\bneeds? replanning\b/,
    /\breplans?\b/,
    /\breplanning\b/,
    /\bdirect[_ -]?addition\b/
  ].some((pattern) => pattern.test(normalized));
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function guideTags(presentation: PlanPresentation, place: PlanPlace, requirements: BlueprintActionRequirement[] = []): string[] {
  const catalogTags = catalogTagsForPlace(presentation, place.id);
  const reservation = reservationRequirementForPlace(requirements);
  const baseTags = place.guideDisplay?.tags?.length
    ? place.guideDisplay.tags
    : [place.durationMinutes ? `${place.durationMinutes} min` : undefined, reservation || place.reservation?.requirement === "required" ? "Reservation" : undefined].filter(Boolean) as string[];
  return uniqueStrings([...baseTags, ...catalogTags]).slice(0, 4);
}

function guideCardAction(place: PlanPlace, state: GuideState, timeline: GuideCardDisplay["timeline"], requirements: BlueprintActionRequirement[] = []): Pick<GuideCardDisplay, "canAdd" | "actionLabel" | "footerNote" | "addBlockedReason"> {
  if ((state === "unscheduled" || state === "optional" || state === "replacement") && addWorkflowAvailable(place)) {
    return {
      canAdd: true,
      actionLabel: travelerFacingLabel(place.guideDisplay?.addActionLabel ?? place.guideDisplay?.primaryActionLabel, "Add")
    };
  }
  if (state === "unscheduled" || state === "optional" || state === "replacement") {
    const label = validPlaceCoordinates(place.coordinates)
      ? travelerFacingLabel(place.guideDisplay?.addBlockedLabel ?? place.guideDisplay?.blockedActionLabel, requirementCardNote(requirements) || addBlockedLabel(place))
      : addBlockedLabel(place);
    return { canAdd: false, footerNote: label, addBlockedReason: label };
  }
  if (state === "scheduled") return { canAdd: false };
  const footerNote = travelerFacingDefaultText(place.guideDisplay?.footerNote);
  return { canAdd: false, ...(footerNote ? { footerNote } : {}) };
}

function detailPrimaryActionLabel(place: PlanPlace, scheduled: boolean, canAdd: boolean): string {
  if (scheduled) return travelerFacingLabel(place.guideDisplay?.scheduledActionLabel, "Show in itinerary");
  if (canAdd) return travelerFacingLabel(place.guideDisplay?.primaryActionLabel, "Add to itinerary");
  const decision = place.schedulingEligibility?.decision;
  if (decision === "informational") return travelerFacingLabel(place.guideDisplay?.informationalActionLabel ?? place.guideDisplay?.addBlockedLabel, "Background note");
  return travelerFacingLabel(place.guideDisplay?.blockedActionLabel ?? place.guideDisplay?.addBlockedLabel, addBlockedLabel(place));
}

function addWorkflowAvailable(place: Pick<PlanPlace, "coordinates" | "schedulingEligibility">): boolean {
  if (!validPlaceCoordinates(place.coordinates)) return false;
  const decision = effectiveWorkspaceSchedulingDecision(place);
  return decision === undefined || decision === "schedulable" || decision === "high_impact";
}

function directMoveAllowed(place: Pick<PlanPlace, "priority" | "schedulingEligibility" | "reservation" | "display" | "id" | "name" | "localizedName" | "locationLabel">, requirements: BlueprintActionRequirement[] = []): boolean {
  const reservationSignal = place.display?.workspaceSignals?.reservation;
  if (place.priority === "booked" || reservationSignal === "required" || (!reservationSignal && (reservationRequirementForPlace(requirements) || place.reservation?.requirement === "required"))) return false;
  const decision = effectiveWorkspaceSchedulingDecision(place);
  return decision === undefined || decision === "schedulable";
}

export const MAP_COORDINATES_PENDING_WORKSPACE_REASON = "This place lacks map-ready coordinates, so it remains useful written context until its location is verified.";

function effectiveWorkspaceSchedulingDecision(place: Pick<PlanPlace, "coordinates" | "schedulingEligibility">): BlueprintSchedulingEligibility["decision"] | undefined {
  const eligibility = place.schedulingEligibility;
  if (eligibility?.decision === "informational"
    && eligibility.reason === MAP_COORDINATES_PENDING_WORKSPACE_REASON
    && validPlaceCoordinates(place.coordinates)) return "schedulable";
  return eligibility?.decision;
}

function directRemoveAllowed(place: Pick<PlanPlace, "priority" | "schedulingEligibility" | "reservation" | "display" | "id" | "name" | "localizedName" | "locationLabel">, requirements: BlueprintActionRequirement[] = []): boolean {
  return directMoveAllowed(place.priority === "must" ? { ...place, priority: "preferred" } : place, requirements);
}

function directRemoveBlockedLabel(place: Pick<PlanPlace, "priority" | "coordinates" | "schedulingEligibility" | "reservation" | "display" | "id" | "name" | "localizedName" | "locationLabel">, requirements: BlueprintActionRequirement[] = []): string {
  const reservationSignal = place.display?.workspaceSignals?.reservation;
  if (place.priority === "booked" || reservationSignal === "required" || (!reservationSignal && (reservationRequirementForPlace(requirements) || place.reservation?.requirement === "required"))) return "Fixed booking";
  return addBlockedLabel(place);
}

function requirementsForPlace(presentation: Pick<PlanPresentation, "actionRequirements">, placeId: string): BlueprintActionRequirement[] {
  return (presentation.actionRequirements ?? []).filter((requirement) => requirement.placeId === placeId);
}

function reservationRequirementForPlace(requirements: BlueprintActionRequirement[]): BlueprintActionRequirement | undefined {
  return requirements.find((requirement) => requirement.kind === "reservation");
}

function requirementNeedsRecheck(requirements: BlueprintActionRequirement[]): boolean {
  return requirements.some((requirement) => requirement.kind === "time_sensitive_recheck" || requirement.evidence.some((ref) => ref.status === "recheck" || ref.status === "stale"));
}

function reservationRequirementNote(requirements: BlueprintActionRequirement[]): string {
  const requirement = reservationRequirementForPlace(requirements);
  return requirement ? firstUsefulText([requirement.description, requirement.completionCondition, requirement.title]) : "";
}

function requirementContextualTip(requirements: BlueprintActionRequirement[]): string {
  const requirement = reservationRequirementForPlace(requirements)
    ?? requirements.find((item) => item.kind === "time_sensitive_recheck")
    ?? requirements.find((item) => item.kind === "preparation");
  return requirement ? firstUsefulText([requirement.description, requirement.completionCondition, requirement.title]) : "";
}

function requirementCardNote(requirements: BlueprintActionRequirement[]): string {
  const note = requirementContextualTip(requirements);
  return note ? shorten(note, 88) : "";
}

function visitNotesForRequirements(requirements: BlueprintActionRequirement[]): DetailRequirementNoteDisplay[] {
  return requirements.flatMap((requirement, index) => {
    if (requirement.kind === "reservation") return [];
    const title = preparationItemTitle(requirement.title, requirement);
    const body = firstUsefulText([requirement.description, requirement.completionCondition], title);
    if (!body) return [];
    const completion = firstUsefulText([requirement.completionCondition], body);
    return [{
      id: `visit-note-${index + 1}`,
      title,
      body,
      ...(completion ? { completion } : {})
    }];
  });
}

function addBlockedLabel(place: Pick<PlanPlace, "coordinates" | "schedulingEligibility">): string {
  if (!validPlaceCoordinates(place.coordinates)) return "Location needs to be confirmed before adding.";
  const decision = place.schedulingEligibility?.decision;
  if (decision === "high_impact") return "Ask Landi to adjust";
  if (decision === "blocked") return "Not for this plan";
  if (decision === "informational") return "Background note";
  return "Needs review";
}

function placementAdvisoriesForWorkspace(workspace: BlueprintWorkspaceDisplay, place: BlueprintPlaceDisplay, itinerary: ItineraryDayDisplay | undefined, position: ItineraryPlacementOption | undefined): PlacementAdvisory[] {
  const advisories: PlacementAdvisory[] = [];
  if (place.placementNote) {
    advisories.push({ tone: "attention", text: place.placementNote });
  }
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

function placementNoteForPlace(place: PlanPlace, requirements: BlueprintActionRequirement[] = []): string | undefined {
  return travelerFacingDefaultText(place.guideDisplay?.footerNote) || requirementCardNote(requirements);
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function itineraryBlockStatus(place: PlanPlace, requirements: BlueprintActionRequirement[] = []): string | undefined {
  const explicit = place.display?.workspaceSignals?.itineraryStatusLabel?.trim();
  if (explicit) return explicit;
  if (reservationRequirementForPlace(requirements) || place.reservation?.requirement === "required") return "Reservation required";
  if (requirementNeedsRecheck(requirements) || place.priority === "recheck" || place.reservation?.verification === "needs_recheck") return "Needs recheck";
  if (place.priority === "booked") return "Booked";
  return undefined;
}

function routeFitLabel(place: PlanPlace, selectedPlace: PlanPlace): string {
  if (place.area && selectedPlace.area && place.area === selectedPlace.area) return "Same area";
  if (place.city && selectedPlace.city && place.city === selectedPlace.city) return "Same city";
  return place.locationLabel;
}

function timingLabel(place: PlanPlace, requirements: BlueprintActionRequirement[] = []): string {
  if (reservationRequirementForPlace(requirements) || place.reservation?.requirement === "required") return "Reserve ahead";
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

function relationshipGroupSourceStateLabel(relationships: BlueprintPlaceRelationship[], place: PlanPlace): string {
  if (relationships.some((relationship) => relationship.evidence.some((ref) => ref.status === "verified"))) return "Verified connection";
  if (relationships.some((relationship) => relationship.evidence.length)) return "Referenced connection";
  return sourceStateLabel(place);
}

function catalogTagsForPlace(presentation: PlanPresentation, placeId: string): string[] {
  return [
    ...(presentation.localFoods ?? []).flatMap((item) => item.diningPlaceIds.includes(placeId) ? [item.title] : []),
    ...(presentation.localProducts ?? []).flatMap((item) => item.purchasePlaceIds.includes(placeId) ? [item.title] : []),
    ...(presentation.experienceThemes ?? []).flatMap((item) => item.offeringPlaceIds.includes(placeId) ? [item.title] : [])
  ];
}

function guideContextForPlace(presentation: PlanPresentation, placeId: string): DetailGuideContextDisplay[] {
  const sourceCatalog = presentation.sourceCatalog ?? [];
  const contexts: DetailGuideContextDisplay[] = [
    ...(presentation.localFoods ?? []).flatMap((item) => item.diningPlaceIds.includes(placeId) ? [{
      id: item.id,
      kind: "food" as const,
      label: "Local food",
      title: item.title,
      description: travelerFacingDefaultText(item.description),
      ...(travelerFacingDefaultText(item.context) ? { context: travelerFacingDefaultText(item.context) } : {}),
      sources: sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog)
    }] : []),
    ...(presentation.localProducts ?? []).flatMap((item) => item.purchasePlaceIds.includes(placeId) ? [{
      id: item.id,
      kind: "product" as const,
      label: "Local find",
      title: item.title,
      description: travelerFacingDefaultText(item.description),
      ...(travelerFacingDefaultText(item.context) ? { context: travelerFacingDefaultText(item.context) } : {}),
      sources: sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog)
    }] : []),
    ...(presentation.experienceThemes ?? []).flatMap((item) => item.offeringPlaceIds.includes(placeId) ? [{
      id: item.id,
      kind: "experience" as const,
      label: "Experience",
      title: item.title,
      description: travelerFacingDefaultText(item.description),
      ...(travelerFacingDefaultText(item.context) ? { context: travelerFacingDefaultText(item.context) } : {}),
      sources: sourceSummariesForEvidenceRefs(item.evidence, sourceCatalog)
    }] : [])
  ];
  return contexts.filter((item) => item.title.trim() && item.description.trim());
}

function informationalGuideTopics(presentation: PlanPresentation): InformationalGuideTopic[] {
  return [
    ...(presentation.localFoods ?? [])
        .map((item): InformationalGuideTopic => ({
        id: topicDisplayId("food", item.id),
        kind: "food",
        type: "dining",
        label: "Local food",
        title: item.title,
        summary: topicSummary(item.description, item.context),
        ...(travelerFacingDefaultText(item.context) ? { context: travelerFacingDefaultText(item.context) } : {}),
        evidence: item.evidence,
        relatedPlaceIds: item.diningPlaceIds
      })),
    ...(presentation.localProducts ?? [])
        .map((item): InformationalGuideTopic => ({
        id: topicDisplayId("product", item.id),
        kind: "product",
        type: "shopping",
        label: "Local find",
        title: item.title,
        summary: topicSummary(item.description, item.context),
        ...(travelerFacingDefaultText(item.context) ? { context: travelerFacingDefaultText(item.context) } : {}),
        evidence: item.evidence,
        relatedPlaceIds: item.purchasePlaceIds
      })),
    ...(presentation.experienceThemes ?? [])
        .map((item): InformationalGuideTopic => ({
        id: topicDisplayId("experience", item.id),
        kind: "experience",
        type: "experience",
        label: "Experience",
        title: item.title,
        summary: topicSummary(item.description, item.context),
        ...(travelerFacingDefaultText(item.context) ? { context: travelerFacingDefaultText(item.context) } : {}),
        evidence: item.evidence,
        relatedPlaceIds: item.offeringPlaceIds
      }))
  ].filter((topic) => topic.title.trim() && topic.summary.trim());
}

function topicDisplayId(kind: InformationalGuideTopic["kind"], id: string): string {
  return `topic:${kind}:${id}`;
}

function topicSummary(description: string, context: string | undefined): string {
  return travelerFacingDefaultText(description) || travelerFacingDefaultText(context) || "Useful background for this trip.";
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
  return day?.shortLabel ?? day?.label ?? day?.date ?? dayId;
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
  return type === "dining" ? "What to eat" : type === "shopping" ? "What to buy" : type === "experience" ? "Experience fit" : type === "stay" ? "Stay context" : type === "transport" ? "Transport role" : "Why it matters";
}

function detailPlanTitle(type: GuideFilter): string {
  return type === "dining" ? "Meal context" : type === "shopping" ? "Purchase context" : type === "experience" ? "How it works" : type === "stay" ? "How it anchors the day" : type === "transport" ? "Route context" : "Visit style";
}

function comparisonTitle(type: GuideFilter): string {
  return type === "dining" ? "Compare dining nearby" : type === "shopping" ? "Compare shopping options" : type === "experience" ? "Compare experience options" : type === "stay" ? "Compare stay options" : type === "transport" ? "Compare transport nodes" : "Compare nearby options";
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
      sources: sourceSummariesForEvent(event, planSources, presentation.sourceCatalog)
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

export function contextualTipsForWorkspace(tips: NonNullable<PlanPresentation["travelTips"]>, context: { dayId?: string | undefined; placeId?: string | undefined; blockId?: string | undefined }): NonNullable<PlanPresentation["travelTips"]> {
  return tips.filter((tip) => {
    if (tip.hidden || (tip.dayId && tip.dayId !== context.dayId)) return false;
    if (tip.blockId) return tip.blockId === context.blockId && (!tip.dayId || tip.dayId === context.dayId);
    return Boolean((tip.placeId && tip.placeId === context.placeId) || (tip.dayId && tip.dayId === context.dayId));
  });
}
