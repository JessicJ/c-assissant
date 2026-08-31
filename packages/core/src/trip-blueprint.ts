export const TRIP_BLUEPRINT_SCHEMA_VERSION = 1 as const;

export type BlueprintEvidenceStatus = "verified" | "recheck" | "stale";
export type BlueprintPlacePriority = "must" | "preferred" | "nearby" | "archive" | "pending" | "recheck" | "booked";
export type BlueprintMovementMode = "walking" | "transit" | "driving" | "rail" | "flight" | "unknown";
export type BlueprintDayKind = "scheduled" | "transit" | "rest" | "free_time";

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
  contentTier?: "deep" | "standard" | "compact";
  visitRole?: string;
  durationMinutes?: number;
  whyWorthIt: string;
  plan: string;
  tip?: string;
  detailSections?: Array<{ title: string; body?: string; items?: string[] }>;
  officialUrl?: string;
  bookingUrl?: string;
  mapUrl?: string;
  experienceUrl?: string;
  evidence: BlueprintEvidenceRef[];
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

export interface BlueprintItineraryDay {
  id: string;
  date: string;
  kind: BlueprintDayKind;
  city: string;
  title: string;
  summary: string;
  stops: BlueprintStop[];
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
  evidence: BlueprintEvidenceRef[];
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
  places: BlueprintPlace[];
  events: BlueprintEvent[];
  sources: BlueprintSource[];
  days: BlueprintItineraryDay[];
  movements: BlueprintMovement[];
  bookingConstraints?: BlueprintBookingConstraint[];
  actionRequirements: BlueprintActionRequirement[];
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
  uniqueIdentityIssues("research.actionRequirements", research.actionRequirements.map((requirement) => requirement.id), issues);
  uniqueIdentityIssues("research.batches", research.batches.map((batch) => batch.id), issues);

  for (const place of research.places) validatePlace(place, sourceIds, placeIds, issues, `place ${place.id || "<missing>"}`);
  for (const event of research.events) {
    if (event.placeId && !placeIds.has(event.placeId)) issues.push(`event ${event.id} references unknown place ${event.placeId}`);
    validateEvidence(event.evidence, sourceIds, issues, `event ${event.id}`);
  }
  for (const requirement of research.actionRequirements) validateRequirement(requirement, placeIds, sourceIds, issues);
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

  for (const place of blueprint.places) validatePlace(place, sourceIds, placeIds, issues, `place ${place.id || "<missing>"}`);
  for (const event of blueprint.events) {
    if (event.placeId && !placeIds.has(event.placeId)) issues.push(`event ${event.id} references unknown place ${event.placeId}`);
    validateEvidence(event.evidence, sourceIds, issues, `event ${event.id}`);
  }
  for (const requirement of blueprint.actionRequirements) validateRequirement(requirement, placeIds, sourceIds, issues);
  for (const constraint of blueprint.bookingConstraints ?? []) validateBookingConstraint(constraint, issues);

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
  }
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
  if (place.possibleDuplicateOf?.some((id) => !placeIds.has(id) || id === place.id)) issues.push(`${path} has invalid possible duplicate reference`);
  validateEvidence(place.evidence, sourceIds, issues, path);
}

function validateRequirement(requirement: BlueprintActionRequirement, placeIds: Set<string>, sourceIds: Set<string>, issues: string[]): void {
  if (!requirement.id.trim() || !requirement.title.trim() || !requirement.description.trim() || !requirement.completionCondition.trim()) issues.push(`action requirement ${requirement.id || "<missing>"} is incomplete`);
  if (requirement.placeId && !placeIds.has(requirement.placeId)) issues.push(`action requirement ${requirement.id} references unknown place ${requirement.placeId}`);
  validateEvidence(requirement.evidence, sourceIds, issues, `action requirement ${requirement.id}`);
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
