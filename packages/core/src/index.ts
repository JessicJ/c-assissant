import { randomUUID } from "node:crypto";
import type { PlanCompilationOrigin } from "./plan-compiler.js";
import type { DestinationArrivalEvent } from "./current-destination.js";
import type { BlueprintExperienceTheme, BlueprintFieldEvidence, BlueprintGuideRelationshipGraph, BlueprintGuideTheme, BlueprintItineraryBlock, BlueprintLocalFood, BlueprintLocalProduct, BlueprintModuleIdentity, BlueprintPlaceDisplayIntent, BlueprintPlaceGuideDisplay, BlueprintPreparationChecklistItem, BlueprintSchedulingEligibility, BlueprintSource, BlueprintTravelTip, TripBlueprint } from "./trip-blueprint.js";

export { recommendPlanTransport, type TransportMode, type TransportRecommendation, type TransportRouteFact } from "./transport.js";
export { assessPolicyPreparation, type PolicyPreparationAssessment, type PolicyPreparationItem, type PolicyPreparationStatus } from "./policy-applicability.js";
export { compilePlanProposal, type PlanCompilationAudit, type PlanCompilationBlockReason, type PlanCompilationDecision, type PlanCompilationOrigin, type PlanCompilationProposal, type PlanCompilationTaskProposal, type SourceEvidenceRef } from "./plan-compiler.js";
export { resolveCurrentPlanDestination, type CurrentPlanDestination, type DestinationArrivalEvent } from "./current-destination.js";
export {
  BLUEPRINT_PLAN_COMPILER_VERSION,
  compileTripBlueprint,
  type BlueprintPlanCompilation,
  type BlueprintPlanCompilerInput
} from "./blueprint-plan-compiler.js";
export {
  applyDirectBlueprintRevision,
  applyDirectBlueprintRevisionBatchWithMetadata,
  applyDirectBlueprintRevisionWithMetadata,
  type DirectBlueprintRevisionBatchMetadata,
  type DirectBlueprintRevisionBatchResult,
  type DirectBlueprintRevisionMetadata,
  type DirectBlueprintRevisionResult,
  type DirectBlueprintRevision
} from "./blueprint-revision.js";
export {
  SKILL_IMPORTER_VERSION,
  importSkillItinerary,
  importSkillResearchBatches,
  mergeResearchSetCheckpoint,
  type BlueprintImportContext,
  type ResearchImportContext,
  type SkillActionRequirementArtifact,
  type SkillExperienceThemeArtifact,
  type SkillItineraryArtifact,
  type SkillLocalFoodArtifact,
  type SkillLocalProductArtifact,
  type SkillResearchBatchArtifact,
  type SkillResearchEventArtifact,
  type SkillPlaceRelationshipArtifact,
  type SkillTravelTipArtifact,
  type SkillResearchPlaceArtifact,
  type SkillResearchSourceArtifact
} from "./skill-importer.js";
export {
  TRIP_BLUEPRINT_SCHEMA_VERSION,
  assertResearchSetIntegrity,
  assertTripBlueprintIntegrity,
  researchSetIntegrityIssues,
  tripBlueprintIntegrityIssues,
  type BlueprintActionRequirement,
  type BlueprintBookingConstraint,
  type BlueprintBookingConstraintStrength,
  type BlueprintBookingSegment,
  type BlueprintBookingSegmentType,
  type BlueprintBookingType,
  type BlueprintDayKind,
  type BlueprintEvidenceRef,
  type BlueprintEvidenceStatus,
  type BlueprintEvent,
  type BlueprintFieldEvidence,
  type BlueprintGeneration,
  type BlueprintGenerationEvent,
  type BlueprintGenerationFailure,
  type BlueprintGenerationStage,
  type BlueprintGenerationStatus,
  type BlueprintGuideRelationshipGraph,
  type BlueprintGuideTheme,
  type BlueprintGuideComparisonDisplay,
  type BlueprintGuideDisplayState,
  type BlueprintIntegrityOptions,
  type BlueprintItineraryBlock,
  type BlueprintItineraryBlockKind,
  type BlueprintItineraryDay,
  type BlueprintExperienceTheme,
  type BlueprintLocalFood,
  type BlueprintLocalProduct,
  type BlueprintModuleIdentity,
  type BlueprintMovement,
  type BlueprintMovementMode,
  type BlueprintPlace,
  type BlueprintPlaceDisplayIntent,
  type BlueprintPlaceDisplayType,
  type BlueprintPlaceGuideDisplay,
  type BlueprintPlacePriority,
  type BlueprintPreparationChecklistItem,
  type BlueprintPreparationGroup,
  type BlueprintPlaceRelationship,
  type BlueprintPlaceRelationshipKind,
  type BlueprintProposalRef,
  type BlueprintSchedulingDecision,
  type BlueprintSchedulingEligibility,
  type BlueprintSource,
  type BlueprintStop,
  type BlueprintTravelTip,
  type BlueprintTravelTipTheme,
  type BlueprintVisitorMode,
  type BlueprintWorkspaceModuleId,
  type PlanBlueprintLineage,
  type ResearchBatch,
  type ResearchSet,
  type SkillLineage,
  type TripBlueprint
} from "./trip-blueprint.js";

export type PlanStatus = "draft" | "active" | "completed" | "cancelled";
export type TaskStatus = "scheduled" | "ready" | "running" | "waiting_user" | "blocked" | "completed" | "skipped" | "failed" | "cancelled";
export type TaskActivationTrigger = "arrival";
export type ProfileGender = "not_specified" | "woman" | "man" | "nonbinary" | "prefer_not_to_say";
export type ImmigrationStatus = "unknown" | "not_obtained" | "no_visa" | "short_term_visitor" | "tourist_visa" | "student_visa" | "work_visa" | "residence_permit" | "other";
export type AgentRuntimeKind = "codex" | "claude-code";
export type RunStatus = "running" | "succeeded" | "failed" | "fallback";
export type RunTrigger = "web" | "telegram" | "whatsapp";
export type TransportPreference = "plan_recommended" | "taxi" | "public_transit" | "walking";
export type LuggageLevel = "unknown" | "light" | "standard" | "heavy";
export type TaskReminderDynamicFact = "weather";
export type TaskPreparationCategory = "packing_item" | "documents" | "digital" | "booking" | "other_predeparture" | "not_applicable";
export type StagePresentationKind = "overview" | "itinerary" | "reservations" | "budget" | "transport" | "details";
export type PlanningSessionStatus = "collecting" | "proposal_ready" | "proposal_confirmed" | "generating" | "draft_ready" | "failed" | "abandoned";
export type PlanningFactSource = "user" | "profile" | "inferred";

export interface PlanningMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  createdAt: string;
}

export interface PlanningFact {
  key: string;
  value: string;
  source: PlanningFactSource;
  confirmed: boolean;
  updatedAt: string;
}

export interface PlanningUnknown {
  key: string;
  question: string;
  impact: "high" | "dependent";
  status: "open" | "deferred";
}

export interface PlanningProposal {
  version: number;
  title: string;
  objective: string;
  theme: string;
  segments: string[];
  skeleton: string[];
  tradeoffs: string[];
  assumptions: string[];
  decisionPoints: string[];
}

export interface PlanningSession {
  id: string;
  status: PlanningSessionStatus;
  objectiveType: "travel" | "relocation" | "event" | "other";
  messages: PlanningMessage[];
  facts: PlanningFact[];
  unresolved: PlanningUnknown[];
  deferred: PlanningUnknown[];
  proposal?: PlanningProposal;
  confirmedProposalVersion?: number;
  outputPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskReminder {
  /** Local wall-clock time in YYYY-MM-DDTHH:mm form. */
  scheduledAtLocal: string;
  /** IANA time zone for the local wall-clock time. */
  timeZone: string;
  /** Why this reminder should run; final delivery copy is generated from current facts. */
  purpose: string;
  /** Explicit delivery-time facts to refresh. Missing means none for backward compatibility. */
  refreshFacts?: TaskReminderDynamicFact[];
}

export interface Task {
  id: string;
  title: string;
  /** Optional user-facing detail for a compiled preparation item. */
  description?: string;
  owner: "assistant" | "user" | "external";
  status: TaskStatus;
  dueLabel: string;
  /** Explicit presentation semantics; avoids guessing categories from prose. */
  preparationCategory?: TaskPreparationCategory;
  /** An explicit event marker; Core must never infer this from a task title. */
  activationTrigger?: TaskActivationTrigger;
  /** A proposed reminder remains inert until this exact Plan version is confirmed. */
  reminder?: TaskReminder;
  /** Stable Action Requirement identity used to preserve completion across Blueprint revisions. */
  requirementId?: string;
  /** Version-bound provenance for a task compiled from a Country Pack proposal. */
  origin?: PlanCompilationOrigin;
}

export interface Stage {
  id: string;
  title: string;
  description: string;
  /** Stable rendering semantics. Older in-memory fixtures may omit it; persisted Plans always restore it. */
  presentationKind?: StagePresentationKind;
  tasks: Task[];
  /** Allows a later compilation to replace this exact generated stage safely. */
  origin?: PlanCompilationOrigin;
}

export type PlanPlacePriority = "must" | "preferred" | "nearby" | "archive" | "pending" | "recheck" | "booked";
export type PlanRouteMode = "walking" | "transit" | "driving" | "rail" | "flight" | "unknown";
export type PlanRouteVerification = "needs_verification" | "verified" | "stale";

export interface PlanPlace {
  id: string;
  name: string;
  localizedName?: string;
  locationLabel: string;
  coordinates?: [number, number];
  city?: string;
  area?: string;
  category: string;
  priority: PlanPlacePriority;
  display?: BlueprintPlaceDisplayIntent;
  guideDisplay?: BlueprintPlaceGuideDisplay;
  schedulingEligibility?: BlueprintSchedulingEligibility;
  fieldEvidence?: BlueprintFieldEvidence[];
  contentTier?: "deep" | "standard" | "compact";
  visitRole?: string;
  durationMinutes?: number;
  whyWorthIt: string;
  plan: string;
  tip?: string;
  detailSections: Array<{ title: string; body?: string; items?: string[] }>;
  officialUrl?: string;
  bookingUrl?: string;
  /** Venue admission decision researched by Landi; the user only owns slot selection and payment. */
  reservation?: {
    requirement: "required" | "recommended" | "not_required" | "unknown";
    verification: "verified" | "needs_recheck";
    note: string;
    checkedAt?: string;
  };
  mapUrl?: string;
  experienceUrl?: string;
  evidenceSources?: Array<{
    title: string;
    url: string;
    type?: string;
    role?: string;
    language?: string;
    supports?: string[];
    checkedAt?: string;
    status?: string;
  }>;
  sourceRefs: string[];
}

export interface ItineraryDay {
  id: string;
  label: string;
  placeIds: string[];
  date?: string;
  shortLabel?: string;
  city?: string;
  title?: string;
  summary?: string;
  color?: string;
  capacity?: number;
  anchors?: string[];
  candidates?: string[];
  stops?: Array<{ placeId: string; order: number; time?: string; role?: string }>;
  blocks?: BlueprintItineraryBlock[];
  /** Current accommodation to the first scheduled place; host-managed after the user saves a stay. */
  accommodationDeparture?: {
    accommodationName: string;
    accommodationAddress: string;
    destinationPlaceId: string;
    mode: "walking" | "transit" | "driving";
    verification: "verified" | "needs_verification";
    durationMinutes?: number;
    distanceMeters?: number;
    checkedAt?: string;
  };
  /** GeoJSON coordinate order: [longitude, latitude]. */
  routeGeometry?: Array<[number, number]>;
  routeGeometryMode?: string;
  routeGeometryReviewedAt?: string;
  routeReview?: {
    fixedConstraints?: string[];
    sequenceRationale?: string;
    intentionalDetours?: string[];
    routingMethod?: string;
  };
}

export interface PlanPresentationEvent {
  id: string;
  title: string;
  description: string;
  startDate?: string;
  endDate?: string;
  locationLabel?: string;
  placeId?: string;
  sourceRefs: string[];
}

export interface PlanRouteSegment {
  id: string;
  originPlaceId: string;
  destinationPlaceId: string;
  mode: PlanRouteMode;
  verification: PlanRouteVerification;
  durationMinutes?: number;
  distanceMeters?: number;
  checkedAt?: string;
  sourceRefs: string[];
  dayId?: string;
  label?: string;
  detail?: string;
  breakRoute?: boolean;
}

/** Exploration data for itinerary-shaped Plans. It never replaces executable Stages and Tasks. */
export interface PlanPresentation {
  kind: "itinerary" | "timeline";
  summary: string;
  language?: string;
  startDate?: string;
  endDate?: string;
  cities?: string[];
  moduleIdentity?: BlueprintModuleIdentity;
  guideTheme?: BlueprintGuideTheme;
  guideRelationshipGraph?: BlueprintGuideRelationshipGraph;
  fieldEvidence?: BlueprintFieldEvidence[];
  /** Blueprint source catalog used by read surfaces to resolve evidence refs without guessing from URLs. */
  sourceCatalog?: BlueprintSource[];
  days: ItineraryDay[];
  places: PlanPlace[];
  events?: PlanPresentationEvent[];
  localFoods?: BlueprintLocalFood[];
  localProducts?: BlueprintLocalProduct[];
  experienceThemes?: BlueprintExperienceTheme[];
  travelTips?: BlueprintTravelTip[];
  preparationChecklist?: BlueprintPreparationChecklistItem[];
  routeSegments: PlanRouteSegment[];
}

/** Read adapter only. Trip Blueprint remains the source of truth. */
export function blueprintPresentation(blueprint: TripBlueprint): PlanPresentation {
  const sources = new Map(blueprint.sources.map((source) => [source.id, source]));
  const placeIds = new Set(blueprint.places.map((place) => place.id));
  const requirementsByPlace = new Map<string, TripBlueprint["actionRequirements"]>();
  for (const requirement of blueprint.actionRequirements) {
    if (!requirement.placeId) continue;
    requirementsByPlace.set(requirement.placeId, [...(requirementsByPlace.get(requirement.placeId) ?? []), requirement]);
  }
  const days = blueprint.days.map((day) => {
    const stops = [...day.stops]
      .sort((left, right) => left.order - right.order)
      .filter((stop, index, all) => placeIds.has(stop.placeId) && all.findIndex((candidate) => candidate.placeId === stop.placeId) === index)
      .map((stop, index) => ({ ...stop, order: index + 1 }));
    const scheduled = new Set(stops.map((stop) => stop.placeId));
    const candidates = day.candidatePlaceIds.filter((id, index, all) => placeIds.has(id) && !scheduled.has(id) && all.indexOf(id) === index);
    return {
      id: day.id,
      label: day.date,
      placeIds: stops.map((stop) => stop.placeId),
      date: day.date,
      shortLabel: day.date.slice(5),
      city: day.city,
      title: day.title,
      summary: day.summary,
      candidates,
      stops,
      ...(day.blocks ? { blocks: structuredClone(day.blocks) } : {})
    };
  });
  const dayById = new Map(days.map((day) => [day.id, day] as const));
  const routeByKey = new Map(blueprint.movements.flatMap((movement) => {
    const day = dayById.get(movement.dayId);
    if (!day || !placeIds.has(movement.originPlaceId) || !placeIds.has(movement.destinationPlaceId)) return [];
    const originIndex = day.placeIds.indexOf(movement.originPlaceId);
    if (originIndex < 0 || day.placeIds[originIndex + 1] !== movement.destinationPlaceId) return [];
    return [[`${day.id}\0${movement.originPlaceId}\0${movement.destinationPlaceId}`, movement] as const];
  }));
  const routeSegments = days.flatMap((day) => day.placeIds.slice(0, -1).map((originPlaceId, index) => {
    const destinationPlaceId = day.placeIds[index + 1]!;
    const movement = routeByKey.get(`${day.id}\0${originPlaceId}\0${destinationPlaceId}`);
    return {
      id: movement?.id ?? `${day.id}-route-${index + 1}`,
      originPlaceId,
      destinationPlaceId,
      mode: movement?.mode ?? "unknown" as const,
      verification: movement?.status === "verified" ? "verified" as const : movement?.status === "stale" ? "stale" as const : "needs_verification" as const,
      ...(movement?.durationMinutes ? { durationMinutes: movement.durationMinutes } : {}),
      ...(movement?.distanceMeters ? { distanceMeters: movement.distanceMeters } : {}),
      sourceRefs: movement?.evidence.flatMap((ref) => sources.get(ref.sourceId)?.url ?? []) ?? [],
      dayId: day.id,
      label: movement?.label ?? "Route needs verification",
      detail: movement?.detail ?? "This adjacent movement is reconstructed from the itinerary order and needs route verification before execution."
    };
  }));
  return {
    kind: "itinerary",
    summary: blueprint.summary,
    language: blueprint.language,
    startDate: blueprint.startDate,
    endDate: blueprint.endDate,
    cities: blueprint.destinations,
    ...(blueprint.moduleIdentity ? { moduleIdentity: structuredClone(blueprint.moduleIdentity) } : {}),
    ...(blueprint.guideTheme ? { guideTheme: structuredClone(blueprint.guideTheme) } : {}),
    ...(blueprint.guideRelationshipGraph ? { guideRelationshipGraph: structuredClone(blueprint.guideRelationshipGraph) } : {}),
    ...(blueprint.fieldEvidence ? { fieldEvidence: structuredClone(blueprint.fieldEvidence) } : {}),
    ...(blueprint.sources.length ? { sourceCatalog: structuredClone(blueprint.sources) } : {}),
    ...(blueprint.localFoods?.length ? { localFoods: structuredClone(blueprint.localFoods) } : {}),
    ...(blueprint.localProducts?.length ? { localProducts: structuredClone(blueprint.localProducts) } : {}),
    ...(blueprint.experienceThemes?.length ? { experienceThemes: structuredClone(blueprint.experienceThemes) } : {}),
    places: blueprint.places.map((place) => {
      const evidenceSources = place.evidence.flatMap((ref) => {
        const source = sources.get(ref.sourceId);
        return source ? [{
          title: source.title,
          url: source.url,
          role: "Trip Blueprint evidence",
          ...(ref.supports ? { supports: ref.supports } : {}),
          ...(ref.checkedAt ? { checkedAt: ref.checkedAt } : {}),
          status: ref.status
        }] : [];
      });
      const reservation = requirementsByPlace.get(place.id)?.find((requirement) => requirement.kind === "reservation");
      return {
        id: place.id,
        name: place.name,
        ...(place.localizedName ? { localizedName: place.localizedName } : {}),
        locationLabel: place.locationLabel,
        ...(place.coordinates ? { coordinates: place.coordinates } : {}),
        ...(place.city ? { city: place.city } : {}),
        ...(place.area ? { area: place.area } : {}),
        category: place.category,
        priority: place.priority,
        ...(place.display ? { display: structuredClone(place.display) } : {}),
        ...(place.guideDisplay ? { guideDisplay: structuredClone(place.guideDisplay) } : {}),
        ...(place.schedulingEligibility ? { schedulingEligibility: structuredClone(place.schedulingEligibility) } : {}),
        ...(place.fieldEvidence ? { fieldEvidence: structuredClone(place.fieldEvidence) } : {}),
        ...(place.contentTier ? { contentTier: place.contentTier } : {}),
        ...(place.visitRole ? { visitRole: place.visitRole } : {}),
        ...(place.durationMinutes ? { durationMinutes: place.durationMinutes } : {}),
        whyWorthIt: place.whyWorthIt,
        plan: place.plan,
        ...(place.tip ? { tip: place.tip } : {}),
        detailSections: place.detailSections ?? [],
        ...(place.officialUrl ? { officialUrl: place.officialUrl } : {}),
        ...(place.bookingUrl ? { bookingUrl: place.bookingUrl } : {}),
        ...(place.mapUrl ? { mapUrl: place.mapUrl } : {}),
        ...(place.experienceUrl ? { experienceUrl: place.experienceUrl } : {}),
        ...(reservation ? { reservation: { requirement: "required" as const, verification: reservation.evidence.some((item) => item.status === "verified") ? "verified" as const : "needs_recheck" as const, note: reservation.description } } : {}),
        ...(evidenceSources.length ? { evidenceSources } : {}),
        sourceRefs: evidenceSources.map((source) => source.url)
      };
    }),
    events: blueprint.events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      ...(event.startDate ? { startDate: event.startDate } : {}),
      ...(event.endDate ? { endDate: event.endDate } : {}),
      ...(event.locationLabel ? { locationLabel: event.locationLabel } : {}),
      ...(event.placeId ? { placeId: event.placeId } : {}),
      sourceRefs: event.evidence.flatMap((ref) => sources.get(ref.sourceId)?.url ?? [])
    })),
    ...(blueprint.travelTips ? { travelTips: structuredClone(blueprint.travelTips) } : {}),
    ...(blueprint.preparationChecklist ? { preparationChecklist: structuredClone(blueprint.preparationChecklist) } : {}),
    days,
    routeSegments
  };
}

/** Returns structural defects that make an itinerary unsafe to publish as a formal Plan. */
export function planPresentationIntegrityIssues(presentation: PlanPresentation, options: { executionReady?: boolean } = {}): string[] {
  if (presentation.kind !== "itinerary") return [];
  const executionReady = options.executionReady ?? true;
  const issues: string[] = [];
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!presentation.startDate || !isoDate.test(presentation.startDate)) issues.push("itinerary.startDate must be a machine-readable date");
  if (!presentation.endDate || !isoDate.test(presentation.endDate)) issues.push("itinerary.endDate must be a machine-readable date");

  const placeById = new Map(presentation.places.map((place) => [place.id, place] as const));
  const dayById = new Map(presentation.days.map((day) => [day.id, day] as const));
  const seenDates = new Set<string>();
  for (const day of presentation.days) {
    if (!day.date || !isoDate.test(day.date)) issues.push(`day ${day.id} must have a machine-readable date`);
    else if (seenDates.has(day.date)) issues.push(`day ${day.id} duplicates itinerary date ${day.date}`);
    else seenDates.add(day.date);
    if (!day.city?.trim()) issues.push(`day ${day.id} must identify its destination city`);
    if (executionReady && !day.title?.trim()) issues.push(`day ${day.id} must have a traveler-facing title`);
    if (executionReady && !day.summary?.trim()) issues.push(`day ${day.id} must explain the day's planning rationale`);
    if (executionReady && day.placeIds.length === 0) issues.push(`day ${day.id} must contain at least one scheduled place`);
    if (new Set(day.placeIds).size !== day.placeIds.length) issues.push(`day ${day.id} contains duplicate scheduled places`);
    const candidates = day.candidates ?? [];
    if (new Set(candidates).size !== candidates.length) issues.push(`day ${day.id} contains duplicate candidates`);
    if (candidates.some((placeId) => day.placeIds.includes(placeId))) issues.push(`day ${day.id} schedules a place that is also a candidate`);
    if (day.capacity !== undefined && day.placeIds.length > day.capacity) issues.push(`day ${day.id} exceeds its declared capacity`);
    for (const placeId of [...day.placeIds, ...candidates]) if (!placeById.has(placeId)) issues.push(`day ${day.id} references unknown place ${placeId}`);
    for (const placeId of day.placeIds) {
      const place = placeById.get(placeId);
      if (!place) continue;
      if (!place.coordinates || !validLatitudeLongitude(place.coordinates)) issues.push(`scheduled place ${placeId} needs persistent coordinates`);
      if (!place.city?.trim()) issues.push(`scheduled place ${placeId} must identify its city`);
      else if (day.city && !normalizedLocation(day.city).includes(normalizedLocation(place.city))) issues.push(`scheduled place ${placeId} does not match day ${day.id} city`);
      if (executionReady && placeRequiresVisitDuration(place) && (!place.durationMinutes || place.durationMinutes < 1)) issues.push(`scheduled place ${placeId} must include a realistic visit duration`);
    }
    const stops = day.stops ?? [];
    if (stops.length !== day.placeIds.length || stops.some((stop, index) => stop.placeId !== day.placeIds[index] || stop.order !== index + 1)) issues.push(`day ${day.id} stops must exactly match scheduled order`);
    const blocks = day.blocks ?? [];
    if (blocks.length) {
      if (blocks.some((block, index) => block.order !== index + 1)) issues.push(`day ${day.id} blocks must use contiguous order`);
      for (const block of blocks) {
        if (block.placeId && !placeById.has(block.placeId)) issues.push(`day ${day.id} block ${block.id} references unknown place ${block.placeId}`);
        if (block.kind === "stop" && !block.placeId) issues.push(`day ${day.id} stop block ${block.id} requires a place`);
      }
    }
    if (executionReady) {
      const stopMinutes = stops.map((stop) => itineraryClockMinutes(stop.time));
      if (stops.some((stop, index) => stopMinutes[index] === undefined)) issues.push(`day ${day.id} every scheduled stop must have a local HH:mm start time`);
      else if (stopMinutes.some((minutes, index) => index > 0 && minutes! <= stopMinutes[index - 1]!)) issues.push(`day ${day.id} scheduled stop times must be strictly increasing`);
      if (day.placeIds.length > 1 && !day.routeReview?.sequenceRationale?.trim()) issues.push(`day ${day.id} must explain why its scheduled sequence is practical`);
    }
  }

  const routeKeys = new Set<string>();
  const routeByKey = new Map<string, PlanRouteSegment>();
  for (const segment of presentation.routeSegments) {
    const day = segment.dayId ? dayById.get(segment.dayId) : undefined;
    if (!day) {
      issues.push(`route ${segment.id} must reference an itinerary day`);
      continue;
    }
    const originIndex = day.placeIds.indexOf(segment.originPlaceId);
    const destinationIndex = day.placeIds.indexOf(segment.destinationPlaceId);
    if (originIndex < 0 || destinationIndex !== originIndex + 1) issues.push(`route ${segment.id} must connect adjacent scheduled places`);
    if (executionReady && segment.mode === "unknown") issues.push(`route ${segment.id} must specify a planned transport mode`);
    if (executionReady && (!segment.durationMinutes || segment.durationMinutes < 1)) issues.push(`route ${segment.id} must include a planned duration`);
    if (executionReady && !segment.label?.trim()) issues.push(`route ${segment.id} must have a traveler-facing movement label`);
    if (executionReady && !segment.detail?.trim()) issues.push(`route ${segment.id} must explain the movement and its evidence status`);
    const routeKey = `${day.id}\0${segment.originPlaceId}\0${segment.destinationPlaceId}`;
    routeKeys.add(routeKey);
    routeByKey.set(routeKey, segment);
  }
  for (const day of presentation.days) {
    for (let index = 0; index < day.placeIds.length - 1; index += 1) {
      const key = `${day.id}\0${day.placeIds[index]}\0${day.placeIds[index + 1]}`;
      if (!routeKeys.has(key)) issues.push(`day ${day.id} is missing a route between adjacent scheduled places`);
      if (!executionReady) continue;
      const origin = placeById.get(day.placeIds[index]!);
      const route = routeByKey.get(key);
      const start = itineraryClockMinutes(day.stops?.[index]?.time);
      const nextStart = itineraryClockMinutes(day.stops?.[index + 1]?.time);
      const visitMinutes = origin?.durationMinutes ?? (origin && !placeRequiresVisitDuration(origin) ? 0 : undefined);
      if (start !== undefined && nextStart !== undefined && visitMinutes !== undefined && route?.durationMinutes) {
        const minimumNextStart = start + visitMinutes + route.durationMinutes;
        if (nextStart < minimumNextStart) issues.push(`day ${day.id} does not leave enough time between ${origin?.id ?? "the current stop"} and ${day.placeIds[index + 1]} for the planned visit and movement`);
      }
    }
  }
  return [...new Set(issues)];
}

function placeRequiresVisitDuration(place: PlanPlace): boolean {
  return !/(?:accommodation|hotel|transport|airport|station)/i.test(`${place.category} ${place.visitRole ?? ""}`);
}

function itineraryClockMinutes(value?: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export function assertPlanPresentationIntegrity(presentation: PlanPresentation, options: { executionReady?: boolean } = {}): void {
  const issues = planPresentationIntegrityIssues(presentation, options);
  if (issues.length) throw new Error(`The generated Plan presentation failed its integrity gate: ${issues.join("; ")}.`);
}

function validLatitudeLongitude(coordinates: [number, number]): boolean {
  const [latitude, longitude] = coordinates;
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function normalizedLocation(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Only packing/carry items and concrete pre-departure work belong in the Web checklist. */
export function isPreDepartureChecklistTask(
  task: Pick<Task, "title" | "description" | "owner" | "dueLabel"> & Partial<Pick<Task, "preparationCategory">>,
  stageTitle = ""
): boolean {
  if (task.owner !== "user") return false;
  if (task.preparationCategory) return task.preparationCategory !== "not_applicable";
  const titleAndDetail = `${task.title} ${task.description ?? ""}`.toLocaleLowerCase();
  const due = task.dueLabel.trim().toLocaleLowerCase();
  const stage = stageTitle.toLocaleLowerCase();

  const isCarryItem = /\b(pack|packing|bring|carry|luggage|baggage|clothing|medicine|medication|charger|adapter)\b|携带|打包|行李|物品清单|衣物|药品|充电器|转换插头/.test(titleAndDetail);
  if (isCarryItem) return true;

  const explicitlyBeforeDeparture = /before (departure|departing|arrival|travel|the trip|leaving home)|prior to (departure|travel|the trip)|出发前|行前|出行前|启程前|抵达前|到达前/.test(due);
  if (explicitlyBeforeDeparture) return true;

  const startsBefore = /^(before|prior to)\b|^(在)?.+(前|之前)$/.test(due);
  if (!startsBefore) return false;
  const postArrivalContext = /每日行程|daily itinerary|itinerary|arriv|arrival|exhibition|展会|抵达|到达/.test(stage)
    || /airport|hotel check-in|first exhibition|final exhibition|leaving the airport|机场|入住|展会/.test(due);
  if (postArrivalContext) return false;

  return /准备|行前|清单|预订|应急资料|prepar|essential|checklist|reservation|booking|document/.test(stage);
}

export interface SourceReference {
  title: string;
  authority: string;
  url: string;
  retrievedAt: string;
  /** Present only when this reference came from an immutable saved SourceSnapshot. */
  sourceSnapshotId?: string;
  /** SHA-256 fingerprint of the exact saved evidence version, when available. */
  contentHash?: string;
}

/** Immutable evidence retained after an allowlisted official-source fetch. */
export interface SourceSnapshot {
  id: string;
  sourceId: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
  excerpt: string;
}

export interface SourceSnapshotInput {
  sourceId: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
  excerpt: string;
}

export interface SourceSnapshotWriteResult {
  snapshot: SourceSnapshot;
  previousSnapshot?: SourceSnapshot;
  duplicate: boolean;
  contentChanged: boolean;
}

export interface PlanAccommodation {
  status: "not_set" | "candidate" | "confirmed";
  id?: string;
  name?: string;
  address?: string;
  location?: string;
  source?: "amap" | "user";
  updatedAt?: string;
}

/** A local arrival time belongs to one Plan, never to the long-term Profile. */
export interface PlanArrival {
  expectedAtLocal?: string;
  timeZone?: string;
}

/** Temporary, Plan-scoped facts. They must not leak into the long-term Profile. */
export interface PlanConfiguration {
  accommodation: PlanAccommodation;
  arrival: PlanArrival;
  transport: {
    preference: TransportPreference;
  };
  travelContext: {
    partySize?: number;
    luggage: LuggageLevel;
  };
}

export interface Plan {
  id: string;
  version: number;
  title: string;
  location: string;
  dates: string;
  status: PlanStatus;
  knownInformation: string[];
  assumptions: string[];
  nextAction: string;
  configuration: PlanConfiguration;
  stages: Stage[];
  presentation?: PlanPresentation;
  sources: SourceReference[];
  createdAt: string;
}

export interface PlanChangeSet {
  id: string;
  planId: string;
  baseVersion: number;
  appliedVersion: number;
  kind: "reorder_task";
  impact: "low";
  status: "applied" | "undone";
  stageId: string;
  taskId: string;
  fromIndex: number;
  toIndex: number;
  affectedTaskIds: string[];
  createdAt: string;
  undoneAt?: string;
}

export interface PlanChangeImpactPreview {
  planId: string;
  baseVersion: number;
  impact: "low" | "high";
  summary: string;
  reasons: string[];
  affectedAreas: Array<"dates" | "destination" | "accommodation" | "fixed_commitments" | "party" | "reminders" | "itinerary">;
  requiresConfirmation: boolean;
  createsReplacementDraft: boolean;
}

export type PlanRevalidationScope = "route_facts" | "time_estimates" | "official_sources" | "reminders" | "accommodation_options";

/** Immutable handover evidence from one Plan version to a reviewable replacement draft. */
export interface PlanReplacementAudit {
  id: string;
  sourcePlanId: string;
  sourcePlanVersion: number;
  replacementPlanId: string;
  replacementPlanVersion: number;
  impact: PlanChangeImpactPreview["impact"];
  affectedAreas: PlanChangeImpactPreview["affectedAreas"];
  revalidationScopes: PlanRevalidationScope[];
  preservedCompletedTasks: Array<{
    sourceTaskId: string;
    replacementTaskId: string;
    title: string;
  }>;
  createdAt: string;
}

export type TravelBookingType = "accommodation" | "flight" | "train" | "rental_car" | "event" | "tour" | "ticket" | "restaurant" | "other";
export type TravelBookingStatus = "pending" | "confirmed" | "cancelled" | "needs_review";
export type BookingConstraintStrength = "hard" | "soft" | "ignored";
export type BookingSegmentType = "flight_leg" | "train_leg" | "hotel_stay" | "rental_pickup" | "rental_return" | "event_window" | "other";

export interface BookingSegment {
  id: string;
  segmentType: BookingSegmentType;
  title: string;
  status: TravelBookingStatus;
  startAtLocal?: string;
  startTimeZone?: string;
  endAtLocal?: string;
  endTimeZone?: string;
  origin?: string;
  destination?: string;
  location?: string;
  constraintStrength: BookingConstraintStrength;
  fixedCommitment: boolean;
  needsReviewReasons: string[];
}

export interface TravelBooking {
  id: string;
  planningSessionId?: string;
  planId?: string;
  planVersionCreated?: number;
  type: TravelBookingType;
  status: TravelBookingStatus;
  title: string;
  providerName?: string;
  source: "user" | "imported_email" | "imported_text";
  sourceHash: string;
  sourceLabel: string;
  importedAt: string;
  updatedAt: string;
  constraintStrength: BookingConstraintStrength;
  segments: BookingSegment[];
  notes?: string;
}

export interface BookingImportPreview {
  sourceHash: string;
  sourceLabel: string;
  duplicate: boolean;
  possibleDuplicate: boolean;
  bookings: TravelBooking[];
}

export interface BookingImportInput {
  sourceLabel?: string;
  content: string;
}

export interface InboxItem {
  id: string;
  tone: "notice" | "attention" | "ready";
  title: string;
  body: string;
  timestamp: string;
}

export interface Profile {
  displayName: string;
  preferredLanguage: string;
  nationality: string;
  gender: ProfileGender;
  immigrationStatus: ImmigrationStatus;
  status: "incomplete" | "ready";
}

/** A per-instance choice only; credentials remain in the selected CLI's own login state. */
export interface RuntimeSelection {
  selectedKind: AgentRuntimeKind;
}

/** A privacy-preserving audit record for one user-requested Agent action. */
export interface AgentRun {
  id: string;
  kind: "plan_generation";
  runtimeKind: AgentRuntimeKind;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  outputPlanId?: string;
  /** A short sanitized classification only; no prompt, model output, or secret. */
  failureCode?: string;
}

export type TaskReminderRunStatus = "running" | "retry_wait" | "succeeded" | "failed" | "cancelled";
export type TaskReminderWeatherStatus = "not_attempted" | "available" | "unavailable";

/** A minimized local audit record for one scheduled Reminder across all retry attempts. */
export interface TaskReminderRun {
  id: string;
  kind: "task_reminder";
  planId: string;
  taskId: string;
  reminderKey: string;
  dueAt: string;
  status: TaskReminderRunStatus;
  attemptCount: number;
  weatherStatus: TaskReminderWeatherStatus;
  weatherStage?: "amap" | "qweather" | "pipeline";
  weatherFailureCode?: string;
  telegramFailureCode?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
}

/** Minimized audit for one atomic Country Pack compilation into a new draft Plan version. */
export interface PlanCompilationRun {
  id: string;
  kind: "plan_compilation";
  planId: string;
  countryPackId: string;
  countryPackVersion: string;
  compositionSkillId: string;
  compositionSkillVersion: string;
  sourcePlanVersion: number;
  compiledPlanVersion: number;
  taskCount: number;
  reminderCount: number;
  compiledAt: string;
  sourceEvidence: import("./plan-compiler.js").SourceEvidenceRef[];
}

/** One minimized internal Skill result belonging to a successful Country Pack compilation. */
export interface CountryPackSkillRun {
  id: string;
  kind: "country_pack_skill";
  compilationRunId: string;
  planId: string;
  sourcePlanVersion: number;
  skillId: string;
  skillVersion: string;
  status: "success" | "degraded" | "needs_input" | "blocked" | "failed" | "not_supported";
  finishedAt: string;
  sourceEvidence: import("./plan-compiler.js").SourceEvidenceRef[];
}

/** A Telegram account bound to this single-user local instance. */
export interface TelegramBinding {
  chatId: string;
  userId: string;
  firstName: string;
  username?: string;
  pairedAt: string;
}

export interface TelegramPairingStatus {
  state: "not_paired" | "waiting_for_start" | "paired";
  expiresAt?: string;
  binding?: TelegramBinding;
}

export interface WorkspaceSnapshot {
  profile: Profile;
  runtime: RuntimeSelection;
  activePlan: Plan;
  /** The versioned itinerary source of truth for a Blueprint-compiled current Plan. */
  activeBlueprint?: TripBlueprint;
  planningSession?: PlanningSession;
  latestPlanChange?: PlanChangeSet;
  /** Present when the current draft was generated as a replacement for another Plan version. */
  latestPlanReplacement?: PlanReplacementAudit;
  /** Present only while a replacement draft is under review and an older Plan remains in execution. */
  executionPlan?: Plan;
  /** Explicit, Plan-scoped arrival confirmations used to resolve the current destination without continuous GPS. */
  destinationArrivals: DestinationArrivalEvent[];
  inbox: InboxItem[];
  sourceSnapshots: SourceSnapshot[];
  system: {
    core: "ready";
    storage: "local";
    runtime: "configured";
    telegram: "not_configured";
    amap: "not_configured";
  };
}

export interface CreatePlanInput {
  request: string;
}

export interface ProfileUpdate {
  displayName: string;
  preferredLanguage: string;
  nationality: string;
  gender: ProfileGender;
  immigrationStatus: ImmigrationStatus;
}

export interface RuntimeSelectionUpdate {
  kind: AgentRuntimeKind;
}

export interface PlanAccommodationInput {
  status: "candidate" | "confirmed";
  id?: string;
  name: string;
  address: string;
  location: string;
  source: "amap" | "user";
}

export interface PlanTransportPreferenceInput {
  preference: TransportPreference;
}

export interface PlanTravelContextInput {
  partySize?: number;
  luggage: LuggageLevel;
}

export interface PlanArrivalInput {
  expectedAtLocal?: string;
  timeZone?: string;
}

export interface GeneratedPlanDraft {
  title: string;
  location: string;
  dates: string;
  knownInformation: string[];
  assumptions: string[];
  nextAction: string;
  presentation?: PlanPresentation;
  sources?: Array<Pick<SourceReference, "title" | "authority" | "url" | "retrievedAt">>;
  stages: Array<{
    title: string;
    description: string;
    /** Runtime-generated drafts must provide this; host-created compatibility drafts are normalized on ingestion. */
    presentationKind?: StagePresentationKind;
      tasks: Array<{
        title: string;
        description?: string;
        owner: Task["owner"];
        dueLabel: string;
        preparationCategory?: TaskPreparationCategory;
        activationTrigger?: TaskActivationTrigger;
        reminder?: TaskReminder;
    }>;
  }>;
}

export function createInitialWorkspace(): WorkspaceSnapshot {
  const activePlan = createPlanFromRequest({
    request: "I will attend an exhibition in Shanghai in September 2026."
  });

  return {
    profile: {
      displayName: "New explorer",
      preferredLanguage: "English",
      nationality: "To be confirmed",
      gender: "not_specified",
      immigrationStatus: "unknown",
      status: "incomplete"
    },
    runtime: { selectedKind: "codex" },
    activePlan: {
      ...activePlan,
      title: "Attend an exhibition in Shanghai",
      location: "Shanghai, China",
      dates: "September 2026",
      knownInformation: [
        "Purpose: attend an exhibition",
        "Destination: Shanghai, China",
        "Expected period: September 2026"
      ],
      assumptions: ["Arrival airport and accommodation are not confirmed yet.", "Transport preferences will be kept inside this Plan."],
      nextAction: "Review and confirm this Plan to activate its reminder scope."
    },
    destinationArrivals: [],
    inbox: [
      {
        id: "welcome",
        tone: "notice",
        title: "Your first Plan is ready to review",
        body: "This initial Plan is stored locally. No messages, reminders, or external actions have been sent.",
        timestamp: "Now"
      },
      {
        id: "setup",
        tone: "attention",
        title: "Profile details are still incomplete",
        body: "Nationality and relevant travel status are needed before policy guidance can be reliable.",
        timestamp: "Before plan activation"
      }
    ],
    sourceSnapshots: [],
    system: {
      core: "ready",
      storage: "local",
      runtime: "configured",
      telegram: "not_configured",
      amap: "not_configured"
    }
  };
}

export function createPlanFromRequest({ request }: CreatePlanInput): Plan {
  const normalizedRequest = request.trim();
  if (!normalizedRequest) throw new Error("A request is needed to create a Plan.");

  const title = normalizedRequest.length > 88 ? `${normalizedRequest.slice(0, 85).trimEnd()}…` : normalizedRequest;
  const location = inferLocation(normalizedRequest);
  const dates = inferDates(normalizedRequest);

  return {
    id: `plan-${randomUUID()}`,
    version: 1,
    title,
    location,
    dates,
    status: "draft",
    knownInformation: [
      `Your request: ${normalizedRequest}`,
      `Destination: ${location}`,
      `Time: ${dates}`
    ],
    assumptions: [
      "This initial template does not yet use Codex or Claude Code to interpret the request.",
      "Confirm the destination, dates, and purpose before automated guidance is enabled."
    ],
    nextAction: "Review and confirm this Plan to save its current reminder scope.",
    configuration: createDefaultPlanConfiguration(),
    stages: [
      {
        id: `stage-${randomUUID()}`,
        title: "Clarify essentials",
        description: "Confirm the details that make local guidance reliable.",
        presentationKind: "details",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Confirm destination, dates, and purpose",
            owner: "user",
            status: "waiting_user",
            dueLabel: "Before Plan activation"
          }
        ]
      },
      {
        id: `stage-${randomUUID()}`,
        title: "Before departure",
        description: "Prepare information and local-life decisions for this Plan.",
        presentationKind: "details",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Prepare a source-backed arrival checklist",
            owner: "assistant",
            status: "scheduled",
            dueLabel: "When the Agent Runtime is connected"
          }
        ]
      },
      {
        id: `stage-${randomUUID()}`,
        title: "Arrival",
        description: "Hand off the planned route when location services are connected.",
        presentationKind: "itinerary",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Open the arrival route in Amap",
            owner: "external",
            status: "scheduled",
            dueLabel: "At expected arrival time",
            activationTrigger: "arrival"
          }
        ]
      }
    ],
    sources: [],
    createdAt: new Date().toISOString()
  };
}

export function createPlanFromDraft(draft: GeneratedPlanDraft): Plan {
  return {
    id: `plan-${randomUUID()}`,
    version: 1,
    title: draft.title,
    location: draft.location,
    dates: draft.dates,
    status: "draft",
    knownInformation: draft.knownInformation,
    assumptions: draft.assumptions,
    nextAction: draft.nextAction,
    configuration: createDefaultPlanConfiguration(),
    stages: draft.stages.map((stage) => ({
      id: `stage-${randomUUID()}`,
      title: stage.title,
      description: stage.description,
      presentationKind: stage.presentationKind ?? inferStagePresentationKind(stage.title),
      tasks: stage.tasks.map((task) => ({
        id: `task-${randomUUID()}`,
        title: task.title,
        ...(task.description ? { description: task.description } : {}),
        owner: task.owner,
        status: task.activationTrigger ? "scheduled" : task.owner === "user" ? "waiting_user" : "scheduled",
        dueLabel: task.dueLabel,
        ...(task.preparationCategory ? { preparationCategory: task.preparationCategory } : {}),
        ...(task.activationTrigger ? { activationTrigger: task.activationTrigger } : {}),
        ...(task.reminder ? { reminder: task.reminder } : {})
      }))
    })),
    ...(draft.presentation ? { presentation: structuredClone(draft.presentation) } : {}),
    sources: draft.sources ? draft.sources.map((source) => ({ ...source })) : [],
    createdAt: new Date().toISOString()
  };
}

export function createDefaultPlanConfiguration(): PlanConfiguration {
  return { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } };
}

/** Compatibility normalization at the ingestion boundary; presentation code must use the stored kind. */
export function inferStagePresentationKind(title: string): StagePresentationKind {
  const value = title.trim().toLocaleLowerCase();
  if (/每日行程|daily itinerary|day.by.day|itinerary/.test(value)) return "itinerary";
  if (/总行程|trip overview|journey overview|overview/.test(value)) return "overview";
  if (/预订|reservation|booking/.test(value)) return "reservations";
  if (/预算|budget|cost/.test(value)) return "budget";
  if (/交通方案|transport plan|transportation plan|transport/.test(value)) return "transport";
  return "details";
}


export function confirmPlan(snapshot: WorkspaceSnapshot, planId: string): WorkspaceSnapshot {
  if (snapshot.activePlan.id !== planId) {
    throw new Error(`Plan ${planId} was not found.`);
  }

  return {
    ...snapshot,
    activePlan: {
      ...snapshot.activePlan,
      status: "active",
      nextAction: "Complete the missing profile facts before policy-related tasks run."
    },
    inbox: [
      {
        id: `plan-confirmed-${snapshot.activePlan.version}`,
        tone: "ready",
        title: "Plan activated",
        body: "The Plan is active. Scheduler, Telegram, and external connectors are not connected yet.",
        timestamp: "Just now"
      },
      ...snapshot.inbox
    ]
  };
}

function inferLocation(request: string): string {
  const knownCities = ["Shanghai", "Beijing", "Guangzhou", "Shenzhen", "Hangzhou", "Chengdu", "上海", "北京", "广州", "深圳", "杭州", "成都"];
  const matchedCity = knownCities.find((city) => request.toLocaleLowerCase().includes(city.toLocaleLowerCase()));
  if (matchedCity) return `${matchedCity}, China`;

  const englishLocation = request.match(/\b(?:in|to|at)\s+([A-Z][A-Za-z -]{1,40})(?:[,.]|\s+(?:in|on|for)|$)/);
  return englishLocation?.[1]?.trim() ?? "Location to be confirmed";
}

function inferDates(request: string): string {
  const monthDate = request.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2})?(?:,?\s+20\d{2})?/i);
  if (monthDate?.[0]) return monthDate[0];

  const year = request.match(/\b20\d{2}\b/);
  return year?.[0] ?? "Dates to be confirmed";
}
