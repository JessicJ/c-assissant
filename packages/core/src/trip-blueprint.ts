export const TRIP_BLUEPRINT_SCHEMA_VERSION = 1 as const;

export type BlueprintEvidenceStatus = "verified" | "recheck" | "stale";
export type BlueprintPlacePriority = "must" | "preferred" | "nearby" | "archive" | "pending" | "recheck" | "booked";
export type BlueprintPlaceDisplayType = "attraction" | "dining" | "shopping" | "experience";
export type BlueprintMovementMode = "walking" | "transit" | "driving" | "rail" | "flight" | "unknown";
export type BlueprintDayKind = "scheduled" | "transit" | "rest" | "free_time";
export type BlueprintWorkspaceModuleId = "itinerary" | "preparation" | "tips" | "sources";
export type BlueprintVisitorMode = "first-visit" | "return-visit" | "landmark-light" | "local-only" | "balanced-visitor";
export type BlueprintItineraryBlockKind = "stop" | "flexible" | "meal" | "rest" | "transfer" | "lodging" | "event";
export type BlueprintSchedulingDecision = "schedulable" | "informational" | "blocked" | "high_impact";
export type BlueprintPlaceRelationshipKind = "same_area" | "same_direction" | "alternative" | "supports_anchor" | "meal_support" | "rainy_day_alternative" | "low_energy_alternative" | "event_link" | "similar";
export type BlueprintTravelTipTheme = "payment" | "transport" | "etiquette" | "safety" | "weather" | "timing" | "language" | "local_norms";
export type BlueprintPreparationGroup = "packing" | "documents" | "phone_payments" | "bookings_departure" | "other";
export type BlueprintMovementMapLineState = "formal" | "needs_refresh" | "reference";

export interface BlueprintLocalFood {
  id: string;
  title: string;
  description: string;
  context: string;
  diningPlaceIds: string[];
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintLocalProduct {
  id: string;
  title: string;
  description: string;
  context: string;
  purchasePlaceIds: string[];
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintExperienceTheme {
  id: string;
  title: string;
  description: string;
  context: string;
  offeringPlaceIds: string[];
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintPlaceDisplayIntent {
  /** Primary Web workspace branch for this place. */
  type: BlueprintPlaceDisplayType;
  /** Optional map marker override when the marker should differ from the branch. */
  markerKind?: BlueprintPlaceDisplayType;
  /** Explicit Web workspace signals so read surfaces do not infer status from prose. */
  workspaceSignals?: BlueprintPlaceWorkspaceSignals;
}

export type BlueprintGuideDisplayState = "scheduled" | "unscheduled" | "informational";

export interface BlueprintPlaceWorkspaceSignals {
  reservation: "required" | "recommended" | "none";
  needsRecheck: boolean;
  longStop: boolean;
  itineraryStatusLabel?: string;
}

export interface BlueprintGuideComparisonDisplay {
  id: string;
  relatedPlaceId?: string;
  name?: string;
  area: string;
  routeFit: string;
  timing: string;
  effort: string;
  sourceState: string;
  evidence?: BlueprintEvidenceRef[];
}

export interface BlueprintPlaceGuideDisplay {
  /** Explicitly includes or excludes this place from traveler guide browsing. */
  showInGuide?: boolean;
  /** Optional guide browse state. The itinerary still decides whether a place is currently scheduled. */
  state?: BlueprintGuideDisplayState;
  cardSummary?: string;
  tags?: string[];
  footerNote?: string;
  primaryActionLabel?: string;
  addActionLabel?: string;
  addBlockedLabel?: string;
  scheduledActionLabel?: string;
  informationalActionLabel?: string;
  blockedActionLabel?: string;
  detailLeadTitle?: string;
  detailPlanTitle?: string;
  detailSourceTitle?: string;
  comparisonTitle?: string;
  comparisonRows?: BlueprintGuideComparisonDisplay[];
}

export interface BlueprintFieldEvidence {
  path: string;
  status: BlueprintEvidenceStatus;
  evidence: BlueprintEvidenceRef[];
  note?: string;
}

export interface BlueprintModuleIdentity {
  primaryModule: BlueprintWorkspaceModuleId;
  enabledModules: Array<{
    id: BlueprintWorkspaceModuleId;
    title: string;
    source: "blueprint" | "compiled_plan";
  }>;
}

export interface BlueprintGuideTheme {
  title: string;
  narrative: string;
  visitorMode?: BlueprintVisitorMode;
  tasteModels?: string[];
  citySegments?: Array<{
    id: string;
    city: string;
    title: string;
    summary: string;
    dayIds?: string[];
  }>;
}

export interface BlueprintSchedulingEligibility {
  decision: BlueprintSchedulingDecision;
  reason: string;
  suitableDayIds?: string[];
  blockedDayIds?: string[];
  highImpactReasons?: string[];
  evidence?: BlueprintEvidenceRef[];
}

export interface BlueprintPlaceRelationship {
  id: string;
  kind: BlueprintPlaceRelationshipKind;
  fromPlaceId: string;
  toPlaceId: string;
  rationale: string;
  dayIds?: string[];
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintGuideRelationshipGraph {
  relationships: BlueprintPlaceRelationship[];
}

export interface BlueprintTravelTip {
  id: string;
  title: string;
  body: string;
  theme: BlueprintTravelTipTheme;
  context: string;
  dayId?: string;
  blockId?: string;
  placeId?: string;
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintPreparationChecklistItem {
  id: string;
  title: string;
  description?: string;
  group: BlueprintPreparationGroup;
  completionCondition: string;
  requirementId?: string;
  placeId?: string;
  evidence: BlueprintEvidenceRef[];
}

export interface SkillLineage {
  skillId: "interactive-trip-planner" | string;
  skillVersion: string;
}

export interface BlueprintProposalRef {
  sessionId: string;
  proposalVersion: number;
}

export interface BlueprintSource {
  id: string;
  title: string;
  authority: string;
  url: string;
  retrievedAt: string;
  status: BlueprintEvidenceStatus;
  official?: boolean;
}

export interface BlueprintEvidenceRef {
  sourceId: string;
  status: BlueprintEvidenceStatus;
  checkedAt?: string;
  supports?: string[];
}

export type BlueprintPlaceImageUsage = "detail" | "card";

export interface BlueprintPlaceImage {
  url: string;
  alt: string;
  sourceId: string;
  caption?: string;
  usage?: BlueprintPlaceImageUsage[];
  status?: BlueprintEvidenceStatus;
}

export interface BlueprintPlace {
  id: string;
  name: string;
  localizedName?: string;
  locationLabel: string;
  city?: string;
  area?: string;
  category: string;
  priority: BlueprintPlacePriority;
  coordinates?: [number, number];
  display?: BlueprintPlaceDisplayIntent;
  guideDisplay?: BlueprintPlaceGuideDisplay;
  contentTier?: "deep" | "standard" | "compact";
  visitRole?: string;
  durationMinutes?: number;
  whyWorthIt: string;
  plan: string;
  tip?: string;
  detailSections?: Array<{ title: string; body?: string; items?: string[] }>;
  images?: BlueprintPlaceImage[];
  officialUrl?: string;
  bookingUrl?: string;
  mapUrl?: string;
  experienceUrl?: string;
  evidence: BlueprintEvidenceRef[];
  fieldEvidence?: BlueprintFieldEvidence[];
  schedulingEligibility?: BlueprintSchedulingEligibility;
  possibleDuplicateOf?: string[];
}

export interface BlueprintEvent {
  id: string;
  title: string;
  startDate?: string;
  endDate?: string;
  locationLabel?: string;
  placeId?: string;
  description: string;
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintActionRequirement {
  id: string;
  kind: "reservation" | "travel_authorization" | "time_sensitive_recheck" | "preparation" | "transport" | "other";
  title: string;
  description: string;
  accountableParty: "assistant" | "traveler" | "external";
  completionCondition: string;
  relevantAt?: string;
  placeId?: string;
  evidence: BlueprintEvidenceRef[];
}

export type BlueprintBookingConstraintStrength = "hard" | "soft" | "ignored";
export type BlueprintBookingType = "accommodation" | "flight" | "train" | "rental_car" | "event" | "tour" | "ticket" | "restaurant" | "other";
export type BlueprintBookingSegmentType = "flight_leg" | "train_leg" | "hotel_stay" | "rental_pickup" | "rental_return" | "event_window" | "other";

export interface BlueprintBookingSegment {
  id: string;
  segmentType: BlueprintBookingSegmentType;
  title: string;
  startAtLocal?: string;
  startTimeZone?: string;
  endAtLocal?: string;
  endTimeZone?: string;
  origin?: string;
  destination?: string;
  location?: string;
  constraintStrength: BlueprintBookingConstraintStrength;
  fixedCommitment: boolean;
  needsReviewReasons: string[];
}

export interface BlueprintBookingConstraint {
  id: string;
  type: BlueprintBookingType;
  title: string;
  status: "pending" | "confirmed" | "cancelled" | "needs_review";
  sourceLabel: string;
  importedAt: string;
  constraintStrength: BlueprintBookingConstraintStrength;
  segments: BlueprintBookingSegment[];
}

export interface ResearchBatch {
  id: string;
  scopeLabel: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  placeIds: string[];
  eventIds: string[];
  sourceIds: string[];
  completedAt?: string;
}

export interface ResearchSet {
  schemaVersion: typeof TRIP_BLUEPRINT_SCHEMA_VERSION;
  id: string;
  generationKey: string;
  proposalRef: BlueprintProposalRef;
  skillLineage: SkillLineage;
  status: "researching" | "completed" | "failed" | "cancelled" | "superseded";
  batches: ResearchBatch[];
  places: BlueprintPlace[];
  events: BlueprintEvent[];
  sources: BlueprintSource[];
  localFoods?: BlueprintLocalFood[];
  localProducts?: BlueprintLocalProduct[];
  experienceThemes?: BlueprintExperienceTheme[];
  travelTips?: BlueprintTravelTip[];
  preparationChecklist?: BlueprintPreparationChecklistItem[];
  guideRelationships?: BlueprintPlaceRelationship[];
  actionRequirements: BlueprintActionRequirement[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type BlueprintGenerationStage = "queued" | "research" | "itinerary" | "import" | "compile" | "ready";
export type BlueprintGenerationStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "superseded";

export interface BlueprintGenerationFailure {
  code: string;
  stage: BlueprintGenerationStage;
  issues: Array<{ path: string; code: string; message: string }>;
  resumable: boolean;
}

export interface BlueprintGeneration {
  generationKey: string;
  proposalRef: BlueprintProposalRef;
  skillLineage: SkillLineage;
  status: BlueprintGenerationStatus;
  stage: BlueprintGenerationStage;
  researchSetId?: string;
  blueprintId?: string;
  blueprintVersion?: number;
  failure?: BlueprintGenerationFailure;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintGenerationEvent {
  id: string;
  generationKey: string;
  sequence: number;
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  scopeLabel?: string;
  savedPlaceCount?: number;
  detail: string;
  nextAction?: string;
  createdAt: string;
}

export interface PlanBlueprintLineage {
  planId: string;
  planVersion: number;
  blueprintId: string;
  blueprintVersion: number;
  compilerVersion: string;
  compilationKey: string;
  createdAt: string;
}

export interface BlueprintStop {
  placeId: string;
  order: number;
  time?: string;
  role?: string;
}

export interface BlueprintItineraryBlockDisplayIntent {
  /** Traveler-facing time text for this timeline card. */
  timeLabel?: string;
  /** Secondary traveler-facing text for this timeline card. */
  meta?: string;
  /** Whether this block participates in the formal day route and map markers. */
  routeAnchor?: boolean;
  /** Whether the Web workspace may stage same-day reorder edits for this block. */
  reorderable?: boolean;
}

export interface BlueprintItineraryBlock {
  id: string;
  kind: BlueprintItineraryBlockKind;
  order: number;
  placeId?: string;
  eventId?: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  summary?: string;
  durationMinutes?: number;
  role?: string;
  display?: BlueprintItineraryBlockDisplayIntent;
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintItineraryDay {
  id: string;
  date: string;
  kind: BlueprintDayKind;
  city: string;
  title: string;
  summary: string;
  stops: BlueprintStop[];
  blocks?: BlueprintItineraryBlock[];
  candidatePlaceIds: string[];
}

export interface BlueprintMovement {
  id: string;
  dayId: string;
  originPlaceId: string;
  destinationPlaceId: string;
  mode: BlueprintMovementMode;
  status: BlueprintEvidenceStatus;
  durationMinutes?: number;
  distanceMeters?: number;
  label?: string;
  detail?: string;
  display?: BlueprintMovementDisplayIntent;
  evidence: BlueprintEvidenceRef[];
}

export interface BlueprintMovementDisplayIntent {
  /** Traveler-facing route label for Web map/workspace surfaces. */
  routeLabel?: string;
  /** Explains why this route leg should be refreshed after direct edits or stale route checks. */
  refreshReason?: string;
  /** Structured refresh target so Web does not infer the affected leg from prose. */
  refreshScope?: BlueprintMovementRefreshScope;
  /** False means keep the movement as context but do not draw it as a formal map route. */
  showAsFormalRoute?: boolean;
  /** Explicit map line state so Web does not infer it from prose. */
  mapLineState?: BlueprintMovementMapLineState;
}

export type BlueprintMovementRefreshReason = "direct_itinerary_edit" | "unverified_route" | "route_conflict";

export interface BlueprintMovementRefreshScope {
  dayId: string;
  originPlaceId: string;
  destinationPlaceId: string;
  reason: BlueprintMovementRefreshReason;
}

export interface TripBlueprint {
  schemaVersion: typeof TRIP_BLUEPRINT_SCHEMA_VERSION;
  id: string;
  version: number;
  generationKey: string;
  proposalRef: BlueprintProposalRef;
  skillLineage: SkillLineage;
  researchSetId: string;
  title: string;
  summary: string;
  language: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  moduleIdentity?: BlueprintModuleIdentity;
  guideTheme?: BlueprintGuideTheme;
  guideRelationshipGraph?: BlueprintGuideRelationshipGraph;
  places: BlueprintPlace[];
  events: BlueprintEvent[];
  sources: BlueprintSource[];
  days: BlueprintItineraryDay[];
  movements: BlueprintMovement[];
  bookingConstraints?: BlueprintBookingConstraint[];
  actionRequirements: BlueprintActionRequirement[];
  localFoods?: BlueprintLocalFood[];
  localProducts?: BlueprintLocalProduct[];
  experienceThemes?: BlueprintExperienceTheme[];
  travelTips?: BlueprintTravelTip[];
  preparationChecklist?: BlueprintPreparationChecklistItem[];
  fieldEvidence?: BlueprintFieldEvidence[];
  createdAt: string;
}

export interface BlueprintIntegrityOptions {
  expectedResearchPlaceIds?: Iterable<string>;
}

export function researchSetIntegrityIssues(research: ResearchSet): string[] {
  const issues: string[] = [];
  if (research.schemaVersion !== TRIP_BLUEPRINT_SCHEMA_VERSION) issues.push("research.schemaVersion is unsupported");
  if (!research.id.trim()) issues.push("research.id is required");
  if (!research.generationKey.trim()) issues.push("research.generationKey is required");
  if (!validProposalRef(research.proposalRef)) issues.push("research.proposalRef is invalid");
  if (!validSkillLineage(research.skillLineage)) issues.push("research.skillLineage is invalid");

  const placeIds = uniqueIdentityIssues("research.places", research.places.map((place) => place.id), issues);
  const eventIds = uniqueIdentityIssues("research.events", research.events.map((event) => event.id), issues);
  const sourceIds = uniqueIdentityIssues("research.sources", research.sources.map((source) => source.id), issues);
  uniqueIdentityIssues("research.guideRelationships", (research.guideRelationships ?? []).map((relationship) => relationship.id), issues);
  uniqueIdentityIssues("research.localFoods", (research.localFoods ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("research.localProducts", (research.localProducts ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("research.experienceThemes", (research.experienceThemes ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("research.travelTips", (research.travelTips ?? []).map((tip) => tip.id), issues);
  uniqueIdentityIssues("research.preparationChecklist", (research.preparationChecklist ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("research.actionRequirements", research.actionRequirements.map((requirement) => requirement.id), issues);
  uniqueIdentityIssues("research.batches", research.batches.map((batch) => batch.id), issues);

  for (const place of research.places) validatePlace(place, sourceIds, placeIds, issues, `place ${place.id || "<missing>"}`);
  for (const relationship of research.guideRelationships ?? []) validatePlaceRelationship(relationship, placeIds, new Set<string>(), sourceIds, issues, `research guide relationship ${relationship.id || "<missing>"}`);
  for (const item of research.localFoods ?? []) validateLocalFood(item, placeIds, sourceIds, issues, `research local food ${item.id || "<missing>"}`);
  for (const item of research.localProducts ?? []) validateLocalProduct(item, placeIds, sourceIds, issues, `research local product ${item.id || "<missing>"}`);
  for (const item of research.experienceThemes ?? []) validateExperienceTheme(item, placeIds, sourceIds, issues, `research experience theme ${item.id || "<missing>"}`);
  for (const event of research.events) {
    if (event.placeId && !placeIds.has(event.placeId)) issues.push(`event ${event.id} references unknown place ${event.placeId}`);
    validateEvidence(event.evidence, sourceIds, issues, `event ${event.id}`);
  }
  for (const requirement of research.actionRequirements) validateRequirement(requirement, placeIds, sourceIds, issues);
  for (const tip of research.travelTips ?? []) validateTravelTip(tip, placeIds, new Set<string>(), new Set<string>(), sourceIds, issues, `research travel tip ${tip.id || "<missing>"}`);
  for (const item of research.preparationChecklist ?? []) validatePreparationItem(item, placeIds, new Set(research.actionRequirements.map((requirement) => requirement.id)), sourceIds, issues, `research preparation item ${item.id || "<missing>"}`);
  for (const batch of research.batches) {
    for (const id of batch.placeIds) if (!placeIds.has(id)) issues.push(`research batch ${batch.id} references unknown place ${id}`);
    for (const id of batch.eventIds) if (!eventIds.has(id)) issues.push(`research batch ${batch.id} references unknown event ${id}`);
    for (const id of batch.sourceIds) if (!sourceIds.has(id)) issues.push(`research batch ${batch.id} references unknown source ${id}`);
  }
  return unique(issues);
}

export function tripBlueprintIntegrityIssues(blueprint: TripBlueprint, options: BlueprintIntegrityOptions = {}): string[] {
  const issues: string[] = [];
  if (blueprint.schemaVersion !== TRIP_BLUEPRINT_SCHEMA_VERSION) issues.push("blueprint.schemaVersion is unsupported");
  if (!blueprint.id.trim()) issues.push("blueprint.id is required");
  if (!Number.isInteger(blueprint.version) || blueprint.version < 1) issues.push("blueprint.version must be a positive integer");
  if (!blueprint.generationKey.trim()) issues.push("blueprint.generationKey is required");
  if (!validProposalRef(blueprint.proposalRef)) issues.push("blueprint.proposalRef is invalid");
  if (!validSkillLineage(blueprint.skillLineage)) issues.push("blueprint.skillLineage is invalid");
  if (!blueprint.researchSetId.trim()) issues.push("blueprint.researchSetId is required");
  if (!validDate(blueprint.startDate) || !validDate(blueprint.endDate) || blueprint.startDate > blueprint.endDate) issues.push("blueprint date range is invalid");

  const placeIds = uniqueIdentityIssues("blueprint.places", blueprint.places.map((place) => place.id), issues);
  const eventIds = uniqueIdentityIssues("blueprint.events", blueprint.events.map((event) => event.id), issues);
  const sourceIds = uniqueIdentityIssues("blueprint.sources", blueprint.sources.map((source) => source.id), issues);
  const dayIds = uniqueIdentityIssues("blueprint.days", blueprint.days.map((day) => day.id), issues);
  uniqueIdentityIssues("blueprint.movements", blueprint.movements.map((movement) => movement.id), issues);
  uniqueIdentityIssues("blueprint.bookingConstraints", (blueprint.bookingConstraints ?? []).map((constraint) => constraint.id), issues);
  uniqueIdentityIssues("blueprint.actionRequirements", blueprint.actionRequirements.map((requirement) => requirement.id), issues);
  uniqueIdentityIssues("blueprint.localFoods", (blueprint.localFoods ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("blueprint.localProducts", (blueprint.localProducts ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("blueprint.experienceThemes", (blueprint.experienceThemes ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("blueprint.travelTips", (blueprint.travelTips ?? []).map((tip) => tip.id), issues);
  uniqueIdentityIssues("blueprint.preparationChecklist", (blueprint.preparationChecklist ?? []).map((item) => item.id), issues);
  uniqueIdentityIssues("blueprint.guideRelationshipGraph.relationships", (blueprint.guideRelationshipGraph?.relationships ?? []).map((relationship) => relationship.id), issues);

  for (const place of blueprint.places) validatePlace(place, sourceIds, placeIds, issues, `place ${place.id || "<missing>"}`);
  for (const event of blueprint.events) {
    if (event.placeId && !placeIds.has(event.placeId)) issues.push(`event ${event.id} references unknown place ${event.placeId}`);
    validateEvidence(event.evidence, sourceIds, issues, `event ${event.id}`);
  }
  for (const requirement of blueprint.actionRequirements) validateRequirement(requirement, placeIds, sourceIds, issues);
  for (const constraint of blueprint.bookingConstraints ?? []) validateBookingConstraint(constraint, issues);
  for (const item of blueprint.localFoods ?? []) validateLocalFood(item, placeIds, sourceIds, issues, `local food ${item.id || "<missing>"}`);
  for (const item of blueprint.localProducts ?? []) validateLocalProduct(item, placeIds, sourceIds, issues, `local product ${item.id || "<missing>"}`);
  for (const item of blueprint.experienceThemes ?? []) validateExperienceTheme(item, placeIds, sourceIds, issues, `experience theme ${item.id || "<missing>"}`);
  if (blueprint.moduleIdentity) validateModuleIdentity(blueprint.moduleIdentity, issues);

  const daysById = new Map(blueprint.days.map((day) => [day.id, day] as const));
  const seenDates = new Set<string>();
  for (const day of blueprint.days) {
    if (!validDate(day.date)) issues.push(`day ${day.id} has invalid date`);
    else if (seenDates.has(day.date)) issues.push(`day ${day.id} duplicates date ${day.date}`);
    else seenDates.add(day.date);
    if (!day.city.trim()) issues.push(`day ${day.id} requires a city or scope label`);
    if (!day.title.trim() || !day.summary.trim()) issues.push(`day ${day.id} requires title and summary`);
    if (day.kind === "scheduled" && day.stops.length === 0) issues.push(`scheduled day ${day.id} requires at least one stop`);
    const stopIds = day.stops.map((stop) => stop.placeId);
    if (new Set(stopIds).size !== stopIds.length) issues.push(`day ${day.id} contains duplicate stops`);
    if (day.stops.some((stop, index) => stop.order !== index + 1)) issues.push(`day ${day.id} stop order must be contiguous`);
    for (const id of [...stopIds, ...day.candidatePlaceIds]) if (!placeIds.has(id)) issues.push(`day ${day.id} references unknown place ${id}`);
    if (day.candidatePlaceIds.some((id) => stopIds.includes(id))) issues.push(`day ${day.id} schedules a candidate place`);
    if (day.blocks) validateItineraryBlocks(day, placeIds, eventIds, sourceIds, issues);
  }
  const knownDayIds = new Set(blueprint.days.map((day) => day.id));
  const blockIds = new Set(blueprint.days.flatMap((day) => (day.blocks ?? []).map((block) => block.id)));
  if (blueprint.guideTheme) validateGuideTheme(blueprint.guideTheme, knownDayIds, issues);
  for (const relationship of blueprint.guideRelationshipGraph?.relationships ?? []) validatePlaceRelationship(relationship, placeIds, knownDayIds, sourceIds, issues, `guide relationship ${relationship.id || "<missing>"}`);
  for (const place of blueprint.places) validateSchedulingEligibilityDayRefs(place.schedulingEligibility, knownDayIds, sourceIds, issues, `place ${place.id || "<missing>"}`);
  const requirementIds = new Set(blueprint.actionRequirements.map((requirement) => requirement.id));
  for (const tip of blueprint.travelTips ?? []) validateTravelTip(tip, placeIds, knownDayIds, blockIds, sourceIds, issues, `travel tip ${tip.id || "<missing>"}`);
  for (const item of blueprint.preparationChecklist ?? []) validatePreparationItem(item, placeIds, requirementIds, sourceIds, issues, `preparation item ${item.id || "<missing>"}`);
  validateFieldEvidence(blueprint.fieldEvidence ?? [], sourceIds, issues, "blueprint");
  if (validDate(blueprint.startDate) && validDate(blueprint.endDate) && blueprint.startDate <= blueprint.endDate) {
    for (const date of datesBetween(blueprint.startDate, blueprint.endDate)) if (!seenDates.has(date)) issues.push(`blueprint is missing itinerary date ${date}`);
    for (const date of seenDates) if (date < blueprint.startDate || date > blueprint.endDate) issues.push(`itinerary date ${date} is outside the blueprint range`);
  }

  const movementKeys = new Set<string>();
  for (const movement of blueprint.movements) {
    const day = daysById.get(movement.dayId);
    if (!day) {
      issues.push(`movement ${movement.id} references unknown day ${movement.dayId}`);
      continue;
    }
    const originIndex = day.stops.findIndex((stop) => stop.placeId === movement.originPlaceId);
    const destinationIndex = day.stops.findIndex((stop) => stop.placeId === movement.destinationPlaceId);
    if (originIndex < 0 || destinationIndex !== originIndex + 1) issues.push(`movement ${movement.id} must connect adjacent stops`);
    if (movement.display) validateMovementDisplay(movement.display, issues, `movement ${movement.id || "<missing>"}`);
    validateEvidence(movement.evidence, sourceIds, issues, `movement ${movement.id}`);
    movementKeys.add(movementKey(day.id, movement.originPlaceId, movement.destinationPlaceId));
  }
  for (const day of blueprint.days) {
    for (let index = 0; index < day.stops.length - 1; index += 1) {
      const origin = day.stops[index]!.placeId;
      const destination = day.stops[index + 1]!.placeId;
      if (!movementKeys.has(movementKey(day.id, origin, destination))) issues.push(`day ${day.id} is missing movement ${origin} -> ${destination}`);
    }
  }

  if (options.expectedResearchPlaceIds) {
    for (const id of new Set(options.expectedResearchPlaceIds)) if (!placeIds.has(id)) issues.push(`blueprint lost research place ${id}`);
  }
  void eventIds;
  void dayIds;
  return unique(issues);
}

export function assertResearchSetIntegrity(research: ResearchSet): void {
  const issues = researchSetIntegrityIssues(research);
  if (issues.length) throw new Error(`Research Set failed integrity: ${issues.join("; ")}`);
}

export function assertTripBlueprintIntegrity(blueprint: TripBlueprint, options: BlueprintIntegrityOptions = {}): void {
  const issues = tripBlueprintIntegrityIssues(blueprint, options);
  if (issues.length) throw new Error(`Trip Blueprint failed integrity: ${issues.join("; ")}`);
}

function validatePlace(place: BlueprintPlace, sourceIds: Set<string>, placeIds: Set<string>, issues: string[], path: string): void {
  if (!place.id.trim() || !place.name.trim() || !place.locationLabel.trim() || !place.category.trim()) issues.push(`${path} requires identity, name, location, and category`);
  if (!place.whyWorthIt.trim() || !place.plan.trim()) issues.push(`${path} requires travel rationale and plan`);
  if (place.coordinates && !validCoordinates(place.coordinates)) issues.push(`${path} has invalid coordinates`);
  if (place.display) validatePlaceDisplay(place.display, issues, path);
  if (place.guideDisplay) validatePlaceGuideDisplay(place.guideDisplay, sourceIds, placeIds, issues, path, place.id);
  validatePlaceImages(place.images ?? [], sourceIds, issues, path);
  validateFieldEvidence(place.fieldEvidence ?? [], sourceIds, issues, path);
  validateSchedulingEligibilityShape(place.schedulingEligibility, issues, path);
  if (place.possibleDuplicateOf?.some((id) => !placeIds.has(id) || id === place.id)) issues.push(`${path} has invalid possible duplicate reference`);
  validateEvidence(place.evidence, sourceIds, issues, path);
}

function validatePlaceImages(images: BlueprintPlaceImage[], sourceIds: Set<string>, issues: string[], path: string): void {
  for (const [index, image] of images.entries()) {
    const imagePath = `${path} image ${index + 1}`;
    if (!image.url?.trim() || !validHttpsUrl(image.url)) issues.push(`${imagePath} has invalid image URL`);
    if (!image.alt?.trim()) issues.push(`${imagePath} needs alt text`);
    if (!sourceIds.has(image.sourceId)) issues.push(`${imagePath} references unknown source ${image.sourceId}`);
    if (image.caption !== undefined && !image.caption.trim()) issues.push(`${imagePath} has an empty caption`);
    for (const usage of image.usage ?? []) if (usage !== "detail" && usage !== "card") issues.push(`${imagePath} has invalid usage ${usage}`);
    if (image.status !== undefined && image.status !== "verified" && image.status !== "recheck" && image.status !== "stale") issues.push(`${imagePath} has invalid status`);
  }
}

function validatePlaceDisplay(display: BlueprintPlaceDisplayIntent, issues: string[], path: string): void {
  if (!validPlaceDisplayType(display.type)) issues.push(`${path} has invalid display type`);
  if (display.markerKind && !validPlaceDisplayType(display.markerKind)) issues.push(`${path} has invalid display marker kind`);
  if (display.workspaceSignals) validatePlaceWorkspaceSignals(display.workspaceSignals, issues, path);
}

function validatePlaceWorkspaceSignals(signals: BlueprintPlaceWorkspaceSignals, issues: string[], path: string): void {
  if (signals.reservation !== "required" && signals.reservation !== "recommended" && signals.reservation !== "none") issues.push(`${path} has invalid workspace reservation signal`);
  if (typeof signals.needsRecheck !== "boolean") issues.push(`${path} has invalid workspace recheck signal`);
  if (typeof signals.longStop !== "boolean") issues.push(`${path} has invalid workspace long-stop signal`);
  if (signals.itineraryStatusLabel !== undefined && !signals.itineraryStatusLabel.trim()) issues.push(`${path} has an empty workspace itinerary status label`);
}

function validatePlaceGuideDisplay(display: BlueprintPlaceGuideDisplay, sourceIds: Set<string>, placeIds: Set<string>, issues: string[], path: string, selfPlaceId: string): void {
  if (display.state && !validGuideDisplayState(display.state)) issues.push(`${path} has invalid guide display state`);
  for (const tag of display.tags ?? []) if (!tag.trim()) issues.push(`${path} guide display contains an empty tag`);
  for (const [field, value] of Object.entries(guideDisplayTextFields(display))) if (value !== undefined && !value.trim()) issues.push(`${path} guide display has an empty ${field}`);
  const rows = display.comparisonRows ?? [];
  uniqueIdentityIssues(`${path}.guideDisplay.comparisonRows`, rows.map((row) => row.id), issues);
  for (const row of rows) {
    if (!row.area.trim() || !row.routeFit.trim() || !row.timing.trim() || !row.effort.trim() || !row.sourceState.trim()) issues.push(`${path} guide display row ${row.id || "<missing>"} is incomplete`);
    if (!row.name?.trim() && !row.relatedPlaceId) issues.push(`${path} guide display row ${row.id || "<missing>"} needs a name or related place`);
    if (row.relatedPlaceId && (!placeIds.has(row.relatedPlaceId) || row.relatedPlaceId === selfPlaceId)) issues.push(`${path} guide display row ${row.id || "<missing>"} has invalid related place ${row.relatedPlaceId}`);
    validateEvidence(row.evidence ?? [], sourceIds, issues, `${path} guide display row ${row.id || "<missing>"}`);
  }
}

function guideDisplayTextFields(display: BlueprintPlaceGuideDisplay): Partial<Record<keyof BlueprintPlaceGuideDisplay, string | undefined>> {
  return {
    cardSummary: display.cardSummary,
    footerNote: display.footerNote,
    primaryActionLabel: display.primaryActionLabel,
    addActionLabel: display.addActionLabel,
    addBlockedLabel: display.addBlockedLabel,
    scheduledActionLabel: display.scheduledActionLabel,
    informationalActionLabel: display.informationalActionLabel,
    blockedActionLabel: display.blockedActionLabel,
    detailLeadTitle: display.detailLeadTitle,
    detailPlanTitle: display.detailPlanTitle,
    detailSourceTitle: display.detailSourceTitle,
    comparisonTitle: display.comparisonTitle
  };
}

function validateRequirement(requirement: BlueprintActionRequirement, placeIds: Set<string>, sourceIds: Set<string>, issues: string[]): void {
  if (!requirement.id.trim() || !requirement.title.trim() || !requirement.description.trim() || !requirement.completionCondition.trim()) issues.push(`action requirement ${requirement.id || "<missing>"} is incomplete`);
  if (requirement.placeId && !placeIds.has(requirement.placeId)) issues.push(`action requirement ${requirement.id} references unknown place ${requirement.placeId}`);
  validateEvidence(requirement.evidence, sourceIds, issues, `action requirement ${requirement.id}`);
}

function validateModuleIdentity(identity: BlueprintModuleIdentity, issues: string[]): void {
  if (identity.primaryModule !== "itinerary") issues.push("blueprint module identity must use itinerary as the primary module");
  const moduleIds = uniqueIdentityIssues("blueprint.moduleIdentity.enabledModules", identity.enabledModules.map((module) => module.id), issues);
  for (const module of identity.enabledModules) {
    if (!validWorkspaceModule(module.id)) issues.push(`blueprint module identity has invalid module ${module.id}`);
    if (!module.title.trim()) issues.push(`blueprint module ${module.id} requires a title`);
    if (module.source !== "blueprint" && module.source !== "compiled_plan") issues.push(`blueprint module ${module.id} has invalid source`);
  }
  if (!moduleIds.has(identity.primaryModule)) issues.push("blueprint module identity must include the primary module");
}

function validateGuideTheme(theme: BlueprintGuideTheme, dayIds: Set<string>, issues: string[]): void {
  if (!theme.title.trim() || !theme.narrative.trim()) issues.push("blueprint guide theme requires title and narrative");
  if (theme.visitorMode && !validVisitorMode(theme.visitorMode)) issues.push("blueprint guide theme has invalid visitor mode");
  if (theme.tasteModels?.some((item) => !item.trim())) issues.push("blueprint guide theme contains an empty taste model");
  const segmentIds = new Set<string>();
  for (const segment of theme.citySegments ?? []) {
    if (!segment.id.trim() || segmentIds.has(segment.id)) issues.push(`guide theme contains invalid city segment ${segment.id || "<missing>"}`);
    segmentIds.add(segment.id);
    if (!segment.city.trim() || !segment.title.trim() || !segment.summary.trim()) issues.push(`guide theme segment ${segment.id} is incomplete`);
    for (const dayId of segment.dayIds ?? []) if (!dayIds.has(dayId)) issues.push(`guide theme segment ${segment.id} references unknown day ${dayId}`);
  }
}

function validateItineraryBlocks(day: BlueprintItineraryDay, placeIds: Set<string>, eventIds: Set<string>, sourceIds: Set<string>, issues: string[]): void {
  uniqueIdentityIssues(`day ${day.id}.blocks`, day.blocks!.map((block) => block.id), issues);
  if (day.blocks!.some((block, index) => block.order !== index + 1)) issues.push(`day ${day.id} block order must be contiguous`);
  for (const block of day.blocks!) {
    if (!validItineraryBlockKind(block.kind)) issues.push(`day ${day.id} block ${block.id} has invalid kind`);
    if (block.kind === "stop" && !block.placeId) issues.push(`day ${day.id} stop block ${block.id} requires a place`);
    if (block.kind === "event" && !block.eventId && !block.placeId) issues.push(`day ${day.id} event block ${block.id} requires an event or place`);
    if (block.placeId && !placeIds.has(block.placeId)) issues.push(`day ${day.id} block ${block.id} references unknown place ${block.placeId}`);
    if (block.eventId && !eventIds.has(block.eventId)) issues.push(`day ${day.id} block ${block.id} references unknown event ${block.eventId}`);
    if (block.durationMinutes !== undefined && (!Number.isInteger(block.durationMinutes) || block.durationMinutes < 1)) issues.push(`day ${day.id} block ${block.id} has invalid duration`);
    if (block.display) validateItineraryBlockDisplay(block, new Set(day.stops.map((stop) => stop.placeId)), issues, `day ${day.id} block ${block.id || "<missing>"}`);
    validateEvidence(block.evidence, sourceIds, issues, `day ${day.id} block ${block.id}`);
  }
}

function validateItineraryBlockDisplay(block: BlueprintItineraryBlock, scheduledPlaceIds: Set<string>, issues: string[], path: string): void {
  const display = block.display!;
  if (display.timeLabel !== undefined && !display.timeLabel.trim()) issues.push(`${path} has an empty display time label`);
  if (display.meta !== undefined && !display.meta.trim()) issues.push(`${path} has an empty display meta`);
  if (display.routeAnchor === true && !block.placeId) issues.push(`${path} display route anchor requires a place`);
  if (display.reorderable === true && (display.routeAnchor === false || !block.placeId)) issues.push(`${path} display reorderable requires a route place`);
  if (display.routeAnchor === true && block.placeId && !scheduledPlaceIds.has(block.placeId)) issues.push(`${path} display route anchor must use a scheduled stop`);
}

function validatePlaceRelationship(relationship: BlueprintPlaceRelationship, placeIds: Set<string>, dayIds: Set<string>, sourceIds: Set<string>, issues: string[], path: string): void {
  if (!relationship.id.trim() || !relationship.rationale.trim()) issues.push(`${path} is incomplete`);
  if (!validPlaceRelationshipKind(relationship.kind)) issues.push(`${path} has invalid kind`);
  if (!placeIds.has(relationship.fromPlaceId)) issues.push(`${path} references unknown place ${relationship.fromPlaceId}`);
  if (!placeIds.has(relationship.toPlaceId)) issues.push(`${path} references unknown place ${relationship.toPlaceId}`);
  if (relationship.fromPlaceId === relationship.toPlaceId) issues.push(`${path} cannot relate a place to itself`);
  for (const dayId of relationship.dayIds ?? []) if (!dayIds.has(dayId)) issues.push(`${path} references unknown day ${dayId}`);
  validateEvidence(relationship.evidence, sourceIds, issues, path);
}

function validateLocalFood(item: BlueprintLocalFood, placeIds: Set<string>, sourceIds: Set<string>, issues: string[], path: string): void {
  if (!item.id.trim() || !item.title.trim() || !item.description.trim() || !item.context.trim()) issues.push(`${path} is incomplete`);
  if (!item.diningPlaceIds.length) issues.push(`${path} needs at least one dining place`);
  for (const placeId of item.diningPlaceIds) if (!placeIds.has(placeId)) issues.push(`${path} references unknown dining place ${placeId}`);
  if (new Set(item.diningPlaceIds).size !== item.diningPlaceIds.length) issues.push(`${path} contains duplicate dining places`);
  validateEvidence(item.evidence, sourceIds, issues, path);
}

function validateLocalProduct(item: BlueprintLocalProduct, placeIds: Set<string>, sourceIds: Set<string>, issues: string[], path: string): void {
  if (!item.id.trim() || !item.title.trim() || !item.description.trim() || !item.context.trim()) issues.push(`${path} is incomplete`);
  if (!item.purchasePlaceIds.length) issues.push(`${path} needs at least one purchase place`);
  for (const placeId of item.purchasePlaceIds) if (!placeIds.has(placeId)) issues.push(`${path} references unknown purchase place ${placeId}`);
  if (new Set(item.purchasePlaceIds).size !== item.purchasePlaceIds.length) issues.push(`${path} contains duplicate purchase places`);
  validateEvidence(item.evidence, sourceIds, issues, path);
}

function validateExperienceTheme(item: BlueprintExperienceTheme, placeIds: Set<string>, sourceIds: Set<string>, issues: string[], path: string): void {
  if (!item.id.trim() || !item.title.trim() || !item.description.trim() || !item.context.trim()) issues.push(`${path} is incomplete`);
  if (!item.offeringPlaceIds.length) issues.push(`${path} needs at least one concrete offering place`);
  for (const placeId of item.offeringPlaceIds) if (!placeIds.has(placeId)) issues.push(`${path} references unknown offering place ${placeId}`);
  if (new Set(item.offeringPlaceIds).size !== item.offeringPlaceIds.length) issues.push(`${path} contains duplicate offering places`);
  validateEvidence(item.evidence, sourceIds, issues, path);
}

function validateTravelTip(tip: BlueprintTravelTip, placeIds: Set<string>, dayIds: Set<string>, blockIds: Set<string>, sourceIds: Set<string>, issues: string[], path: string): void {
  if (!tip.id.trim() || !tip.title.trim() || !tip.body.trim() || !tip.context.trim()) issues.push(`${path} is incomplete`);
  if (!validTravelTipTheme(tip.theme)) issues.push(`${path} has invalid theme`);
  if (tip.placeId && !placeIds.has(tip.placeId)) issues.push(`${path} references unknown place ${tip.placeId}`);
  if (tip.dayId && dayIds.size && !dayIds.has(tip.dayId)) issues.push(`${path} references unknown day ${tip.dayId}`);
  if (tip.blockId && blockIds.size && !blockIds.has(tip.blockId)) issues.push(`${path} references unknown block ${tip.blockId}`);
  validateEvidence(tip.evidence, sourceIds, issues, path);
}

function validatePreparationItem(item: BlueprintPreparationChecklistItem, placeIds: Set<string>, requirementIds: Set<string>, sourceIds: Set<string>, issues: string[], path: string): void {
  if (!item.id.trim() || !item.title.trim() || !item.completionCondition.trim()) issues.push(`${path} is incomplete`);
  if (!validPreparationGroup(item.group)) issues.push(`${path} has invalid group`);
  if (item.placeId && !placeIds.has(item.placeId)) issues.push(`${path} references unknown place ${item.placeId}`);
  if (item.requirementId && !requirementIds.has(item.requirementId)) issues.push(`${path} references unknown action requirement ${item.requirementId}`);
  validateEvidence(item.evidence, sourceIds, issues, path);
}

function validateSchedulingEligibilityShape(eligibility: BlueprintSchedulingEligibility | undefined, issues: string[], path: string): void {
  if (!eligibility) return;
  if (!validSchedulingDecision(eligibility.decision)) issues.push(`${path} has invalid scheduling decision`);
  if (!eligibility.reason.trim()) issues.push(`${path} scheduling eligibility requires a reason`);
  if (eligibility.decision === "high_impact" && !(eligibility.highImpactReasons?.length)) issues.push(`${path} high-impact scheduling eligibility requires reasons`);
}

function validateSchedulingEligibilityDayRefs(eligibility: BlueprintSchedulingEligibility | undefined, dayIds: Set<string>, sourceIds: Set<string>, issues: string[], path: string): void {
  if (!eligibility) return;
  for (const dayId of eligibility.suitableDayIds ?? []) if (!dayIds.has(dayId)) issues.push(`${path} scheduling eligibility references unknown suitable day ${dayId}`);
  for (const dayId of eligibility.blockedDayIds ?? []) if (!dayIds.has(dayId)) issues.push(`${path} scheduling eligibility references unknown blocked day ${dayId}`);
  validateEvidence(eligibility.evidence ?? [], sourceIds, issues, `${path} scheduling eligibility`);
}

function validateFieldEvidence(items: BlueprintFieldEvidence[], sourceIds: Set<string>, issues: string[], path: string): void {
  for (const item of items) {
    if (!item.path.trim()) issues.push(`${path} field evidence requires a path`);
    if (!["verified", "recheck", "stale"].includes(item.status)) issues.push(`${path} field evidence ${item.path || "<missing>"} has invalid status`);
    validateEvidence(item.evidence, sourceIds, issues, `${path} field evidence ${item.path || "<missing>"}`);
  }
}

function validateBookingConstraint(constraint: BlueprintBookingConstraint, issues: string[]): void {
  if (!constraint.id.trim() || !constraint.title.trim() || !constraint.sourceLabel.trim()) issues.push(`booking constraint ${constraint.id || "<missing>"} is incomplete`);
  if (!["hard", "soft", "ignored"].includes(constraint.constraintStrength)) issues.push(`booking constraint ${constraint.id} has invalid strength`);
  if (!constraint.segments.length) issues.push(`booking constraint ${constraint.id} needs at least one segment`);
  uniqueIdentityIssues(`booking constraint ${constraint.id}.segments`, constraint.segments.map((segment) => segment.id), issues);
  for (const segment of constraint.segments) {
    if (!segment.id.trim() || !segment.title.trim()) issues.push(`booking segment ${segment.id || "<missing>"} is incomplete`);
    if (!["hard", "soft", "ignored"].includes(segment.constraintStrength)) issues.push(`booking segment ${segment.id} has invalid strength`);
    if (segment.constraintStrength === "hard" && !((segment.startAtLocal || segment.endAtLocal) && (segment.location || segment.origin || segment.destination))) {
      issues.push(`hard booking segment ${segment.id} needs timing and location`);
    }
  }
}

function validateEvidence(evidence: BlueprintEvidenceRef[], sourceIds: Set<string>, issues: string[], path: string): void {
  for (const ref of evidence) if (!sourceIds.has(ref.sourceId)) issues.push(`${path} references unknown source ${ref.sourceId}`);
}

function validateMovementDisplay(display: BlueprintMovementDisplayIntent, issues: string[], path: string): void {
  if (display.routeLabel !== undefined && !display.routeLabel.trim()) issues.push(`${path} has an empty display route label`);
  if (display.refreshReason !== undefined && !display.refreshReason.trim()) issues.push(`${path} has an empty display refresh reason`);
  if (display.refreshScope !== undefined) validateMovementRefreshScope(display.refreshScope, issues, path);
  if (display.showAsFormalRoute !== undefined && typeof display.showAsFormalRoute !== "boolean") issues.push(`${path} has invalid formal route display flag`);
  if (display.mapLineState !== undefined && !validMovementMapLineState(display.mapLineState)) issues.push(`${path} has invalid map line state`);
}

function validateMovementRefreshScope(scope: BlueprintMovementRefreshScope, issues: string[], path: string): void {
  if (!scope.dayId?.trim()) issues.push(`${path} has an empty refresh day`);
  if (!scope.originPlaceId?.trim()) issues.push(`${path} has an empty refresh origin`);
  if (!scope.destinationPlaceId?.trim()) issues.push(`${path} has an empty refresh destination`);
  if (!["direct_itinerary_edit", "unverified_route", "route_conflict"].includes(scope.reason)) issues.push(`${path} has invalid refresh reason`);
}

function uniqueIdentityIssues(path: string, ids: string[], issues: string[]): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    if (!id.trim()) issues.push(`${path} contains a missing identity`);
    else if (result.has(id)) issues.push(`${path} contains duplicate identity ${id}`);
    else result.add(id);
  }
  return result;
}

function validProposalRef(value: BlueprintProposalRef): boolean {
  return Boolean(value.sessionId.trim()) && Number.isInteger(value.proposalVersion) && value.proposalVersion > 0;
}

function validSkillLineage(value: SkillLineage): boolean {
  return Boolean(value.skillId.trim()) && Boolean(value.skillVersion.trim());
}

function validCoordinates(value: [number, number]): boolean {
  return Number.isFinite(value[0]) && value[0] >= -90 && value[0] <= 90 && Number.isFinite(value[1]) && value[1] >= -180 && value[1] <= 180;
}

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function validPlaceDisplayType(value: unknown): value is BlueprintPlaceDisplayType {
  return value === "attraction" || value === "dining" || value === "shopping" || value === "experience";
}

function validGuideDisplayState(value: unknown): value is BlueprintGuideDisplayState {
  return value === "scheduled" || value === "unscheduled" || value === "informational";
}

function validWorkspaceModule(value: unknown): value is BlueprintWorkspaceModuleId {
  return value === "itinerary" || value === "preparation" || value === "tips" || value === "sources";
}

function validVisitorMode(value: unknown): value is BlueprintVisitorMode {
  return value === "first-visit" || value === "return-visit" || value === "landmark-light" || value === "local-only" || value === "balanced-visitor";
}

function validItineraryBlockKind(value: unknown): value is BlueprintItineraryBlockKind {
  return value === "stop" || value === "flexible" || value === "meal" || value === "rest" || value === "transfer" || value === "lodging" || value === "event";
}

function validSchedulingDecision(value: unknown): value is BlueprintSchedulingDecision {
  return value === "schedulable" || value === "informational" || value === "blocked" || value === "high_impact";
}

function validPlaceRelationshipKind(value: unknown): value is BlueprintPlaceRelationshipKind {
  return value === "same_area" || value === "same_direction" || value === "alternative" || value === "supports_anchor" || value === "meal_support" || value === "rainy_day_alternative" || value === "low_energy_alternative" || value === "event_link" || value === "similar";
}

function validMovementMapLineState(value: unknown): value is BlueprintMovementMapLineState {
  return value === "formal" || value === "needs_refresh" || value === "reference";
}

function validTravelTipTheme(value: unknown): value is BlueprintTravelTipTheme {
  return value === "payment" || value === "transport" || value === "etiquette" || value === "safety" || value === "weather" || value === "timing" || value === "language" || value === "local_norms";
}

function validPreparationGroup(value: unknown): value is BlueprintPreparationGroup {
  return value === "packing" || value === "documents" || value === "phone_payments" || value === "bookings_departure" || value === "other";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function movementKey(dayId: string, originPlaceId: string, destinationPlaceId: string): string {
  return `${dayId}\0${originPlaceId}\0${destinationPlaceId}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
