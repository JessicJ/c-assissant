import {
  TRIP_BLUEPRINT_SCHEMA_VERSION,
  assertResearchSetIntegrity,
  assertTripBlueprintIntegrity,
  type BlueprintActionRequirement,
  type BlueprintBookingConstraint,
  type BlueprintEvent,
  type BlueprintFieldEvidence,
  type BlueprintGuideRelationshipGraph,
  type BlueprintGuideTheme,
  type BlueprintEvidenceRef,
  type BlueprintItineraryBlock,
  type BlueprintItineraryDay,
  type BlueprintModuleIdentity,
  type BlueprintMovement,
  type BlueprintPlace,
  type BlueprintPlaceRelationship,
  type BlueprintProposalRef,
  type BlueprintSchedulingEligibility,
  type BlueprintSource,
  type ResearchBatch,
  type ResearchSet,
  type SkillLineage,
  type TripBlueprint
} from "./trip-blueprint.js";

export const SKILL_IMPORTER_VERSION = "1.0.0";

export interface SkillResearchSourceArtifact {
  id?: string;
  title: string;
  authority: string;
  url: string;
  retrievedAt: string;
  status?: "verified" | "recheck" | "stale";
  official?: boolean;
}

export interface SkillResearchPlaceArtifact {
  id?: string;
  externalIdentity?: string;
  name: string;
  localizedName?: string;
  locationLabel: string;
  city?: string;
  area?: string;
  category: string;
  priority?: BlueprintPlace["priority"];
  coordinates?: [number, number] | null;
  display?: BlueprintPlace["display"];
  contentTier?: BlueprintPlace["contentTier"];
  visitRole?: string;
  durationMinutes?: number;
  whyWorthIt: string;
  plan: string;
  tip?: string;
  detailSections?: BlueprintPlace["detailSections"];
  officialUrl?: string;
  bookingUrl?: string;
  mapUrl?: string;
  experienceUrl?: string;
  sourceUrls?: string[];
  fieldEvidence?: BlueprintFieldEvidence[];
  schedulingEligibility?: BlueprintSchedulingEligibility;
}

export interface SkillPlaceRelationshipArtifact {
  id?: string;
  kind: BlueprintPlaceRelationship["kind"];
  fromPlaceId: string;
  toPlaceId: string;
  rationale: string;
  sourceUrls?: string[];
}

export interface SkillResearchEventArtifact {
  id?: string;
  title: string;
  startDate?: string;
  endDate?: string;
  locationLabel?: string;
  placeId?: string;
  description: string;
  sourceUrls?: string[];
}

export interface SkillActionRequirementArtifact {
  id?: string;
  kind: BlueprintActionRequirement["kind"];
  title: string;
  description: string;
  accountableParty: BlueprintActionRequirement["accountableParty"];
  completionCondition: string;
  relevantAt?: string;
  placeId?: string;
  sourceUrls?: string[];
}

export interface SkillResearchBatchArtifact {
  id: string;
  scopeLabel: string;
  places: SkillResearchPlaceArtifact[];
  events: SkillResearchEventArtifact[];
  relationships?: SkillPlaceRelationshipArtifact[];
  sources: SkillResearchSourceArtifact[];
  actionRequirements?: SkillActionRequirementArtifact[];
  completedAt: string;
}

export interface SkillItineraryArtifact {
  title: string;
  summary: string;
  language: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  guideTheme?: BlueprintGuideTheme;
  days: BlueprintItineraryDay[];
  movements: BlueprintMovement[];
}

export interface ResearchImportContext {
  researchSetId: string;
  generationKey: string;
  proposalRef: BlueprintProposalRef;
  skillLineage: SkillLineage;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintImportContext {
  blueprintId: string;
  blueprintVersion: number;
  createdAt: string;
  bookingConstraints?: BlueprintBookingConstraint[];
}

export function importSkillResearchBatches(artifacts: SkillResearchBatchArtifact[], context: ResearchImportContext): ResearchSet {
  const sourceByUrl = new Map<string, BlueprintSource>();
  for (const artifact of artifacts.flatMap((batch) => batch.sources)) {
    const url = normalizedHttpsUrl(artifact.url);
    const existing = sourceByUrl.get(url);
    if (existing) continue;
    sourceByUrl.set(url, {
      id: stableIdentity("source", artifact.id || url),
      title: artifact.title.trim(),
      authority: artifact.authority.trim(),
      url,
      retrievedAt: artifact.retrievedAt.trim(),
      status: artifact.status ?? "recheck",
      ...(artifact.official === undefined ? {} : { official: artifact.official })
    });
  }
  const referencedUrls = artifacts.flatMap((batch) => [
    ...batch.places.flatMap((place) => place.sourceUrls ?? []),
    ...batch.events.flatMap((event) => event.sourceUrls ?? []),
    ...(batch.actionRequirements ?? []).flatMap((requirement) => requirement.sourceUrls ?? [])
  ]);
  for (const referenced of referencedUrls) {
    const url = normalizedHttpsUrl(referenced);
    if (sourceByUrl.has(url)) continue;
    const host = new URL(url).hostname;
    sourceByUrl.set(url, {
      id: stableIdentity("source", url),
      title: `Source metadata needs review (${host})`,
      authority: host,
      url,
      retrievedAt: context.updatedAt,
      status: "recheck",
      official: false
    });
  }
  const sources = [...sourceByUrl.values()];
  const sourceIdByUrl = new Map(sources.map((source) => [source.url, source.id]));
  const sourceIdByArtifactId = new Map<string, string>();
  for (const artifact of artifacts.flatMap((batch) => batch.sources)) {
    if (!artifact.id) continue;
    sourceIdByArtifactId.set(artifact.id, sourceIdByUrl.get(normalizedHttpsUrl(artifact.url))!);
  }

  const places: BlueprintPlace[] = [];
  const placeIdByExternalIdentity = new Map<string, string>();
  const inputPlaceIdMap = new Map<string, string>();
  for (const artifact of artifacts.flatMap((batch) => batch.places)) {
    const externalKey = artifact.externalIdentity?.trim();
    const existingId = externalKey ? placeIdByExternalIdentity.get(externalKey) : undefined;
    const id = existingId ?? stableIdentity("place", artifact.id || externalKey || `${artifact.name}\0${artifact.city ?? artifact.locationLabel}`);
    if (artifact.id) inputPlaceIdMap.set(artifact.id, id);
    if (existingId) continue;
    if (externalKey) placeIdByExternalIdentity.set(externalKey, id);
    places.push({
      id,
      name: artifact.name.trim(),
      ...(artifact.localizedName?.trim() ? { localizedName: artifact.localizedName.trim() } : {}),
      locationLabel: artifact.locationLabel.trim(),
      ...(artifact.city?.trim() ? { city: artifact.city.trim() } : {}),
      ...(artifact.area?.trim() ? { area: artifact.area.trim() } : {}),
      category: artifact.category.trim(),
      priority: artifact.priority ?? "preferred",
      ...(artifact.coordinates ? { coordinates: artifact.coordinates } : {}),
      ...(artifact.display ? { display: structuredClone(artifact.display) } : {}),
      ...(artifact.contentTier ? { contentTier: artifact.contentTier } : {}),
      ...(artifact.visitRole?.trim() ? { visitRole: artifact.visitRole.trim() } : {}),
      ...(artifact.durationMinutes ? { durationMinutes: artifact.durationMinutes } : {}),
      whyWorthIt: artifact.whyWorthIt.trim(),
      plan: artifact.plan.trim(),
      ...(artifact.tip?.trim() ? { tip: artifact.tip.trim() } : {}),
      ...(artifact.detailSections ? { detailSections: structuredClone(artifact.detailSections) } : {}),
      ...optionalHttpsLinks(artifact),
      evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl),
      ...(artifact.fieldEvidence?.length ? { fieldEvidence: remapFieldEvidence(artifact.fieldEvidence, sourceIdByArtifactId) } : {}),
      ...(artifact.schedulingEligibility ? { schedulingEligibility: structuredClone(artifact.schedulingEligibility) } : {})
    });
  }
  const placeIds = new Set(places.map((place) => place.id));

  const guideRelationships: BlueprintPlaceRelationship[] = artifacts.flatMap((batch) => batch.relationships ?? []).flatMap((artifact) => {
    const fromPlaceId = resolvePlaceId(artifact.fromPlaceId, inputPlaceIdMap, placeIds);
    const toPlaceId = resolvePlaceId(artifact.toPlaceId, inputPlaceIdMap, placeIds);
    if (fromPlaceId === toPlaceId) return [];
    return [{
      id: stableIdentity("relationship", artifact.id || `${artifact.kind}\0${fromPlaceId}\0${toPlaceId}`),
      kind: artifact.kind,
      fromPlaceId,
      toPlaceId,
      rationale: artifact.rationale.trim(),
      evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
    }];
  });

  const events: BlueprintEvent[] = artifacts.flatMap((batch) => batch.events).map((artifact) => ({
    id: stableIdentity("event", artifact.id || `${artifact.title}\0${artifact.startDate ?? ""}\0${artifact.locationLabel ?? ""}`),
    title: artifact.title.trim(),
    ...(artifact.startDate ? { startDate: artifact.startDate.trim() } : {}),
    ...(artifact.endDate ? { endDate: artifact.endDate.trim() } : {}),
    ...(artifact.locationLabel?.trim() ? { locationLabel: artifact.locationLabel.trim() } : {}),
    ...(artifact.placeId ? { placeId: resolvePlaceId(artifact.placeId, inputPlaceIdMap, placeIds) } : {}),
    description: artifact.description.trim(),
    evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
  }));
  const actionRequirements: BlueprintActionRequirement[] = artifacts.flatMap((batch) => batch.actionRequirements ?? []).map((artifact) => ({
    id: stableIdentity("requirement", artifact.id || `${artifact.kind}\0${artifact.title}`),
    kind: artifact.kind,
    title: artifact.title.trim(),
    description: artifact.description.trim(),
    accountableParty: artifact.accountableParty,
    completionCondition: artifact.completionCondition.trim(),
    ...(artifact.relevantAt?.trim() ? { relevantAt: artifact.relevantAt.trim() } : {}),
    ...(artifact.placeId ? { placeId: resolvePlaceId(artifact.placeId, inputPlaceIdMap, placeIds) } : {}),
    evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
  }));
  const eventIdByArtifact = new Map<string, string>();
  artifacts.flatMap((batch) => batch.events).forEach((artifact, index) => { if (artifact.id) eventIdByArtifact.set(artifact.id, events[index]!.id); });
  const batches: ResearchBatch[] = artifacts.map((artifact) => ({
    id: stableIdentity("batch", artifact.id),
    scopeLabel: artifact.scopeLabel.trim(),
    status: "completed",
    placeIds: artifact.places.map((place) => resolvePlaceId(place.id || stableIdentity("place", place.externalIdentity || `${place.name}\0${place.city ?? place.locationLabel}`), inputPlaceIdMap, placeIds)).filter(uniqueFilter),
    eventIds: artifact.events.map((event) => event.id ? eventIdByArtifact.get(event.id)! : stableIdentity("event", `${event.title}\0${event.startDate ?? ""}\0${event.locationLabel ?? ""}`)).filter(uniqueFilter),
    sourceIds: artifact.sources.map((source) => sourceIdByUrl.get(normalizedHttpsUrl(source.url))!).filter(uniqueFilter),
    completedAt: artifact.completedAt
  }));
  const research: ResearchSet = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: context.researchSetId,
    generationKey: context.generationKey,
    proposalRef: context.proposalRef,
    skillLineage: context.skillLineage,
    status: "completed",
    batches,
    places,
    events,
    sources,
    ...(guideRelationships.length ? { guideRelationships } : {}),
    actionRequirements,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
    completedAt: context.updatedAt
  };
  assertResearchSetIntegrity(research);
  return research;
}

export function importSkillItinerary(research: ResearchSet, artifact: SkillItineraryArtifact, context: BlueprintImportContext): TripBlueprint {
  const reasonableItinerary = normalizeItineraryReasonableness(research, artifact);
  const blueprint: TripBlueprint = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: context.blueprintId,
    version: context.blueprintVersion,
    generationKey: research.generationKey,
    proposalRef: research.proposalRef,
    skillLineage: research.skillLineage,
    researchSetId: research.id,
    title: artifact.title.trim(),
    summary: artifact.summary.trim(),
    language: artifact.language.trim(),
    destinations: artifact.destinations.map((value) => value.trim()).filter(Boolean),
    startDate: artifact.startDate,
    endDate: artifact.endDate,
    moduleIdentity: defaultBlueprintModuleIdentity(),
    guideTheme: normalizeGuideTheme(artifact.guideTheme, reasonableItinerary.days, artifact),
    guideRelationshipGraph: normalizeGuideRelationshipGraph(research.guideRelationships, reasonableItinerary.days),
    places: normalizeBlueprintPlaces(research.places, reasonableItinerary.days),
    events: structuredClone(research.events),
    sources: structuredClone(research.sources),
    days: reasonableItinerary.days,
    movements: reasonableItinerary.movements,
    ...(context.bookingConstraints?.length ? { bookingConstraints: structuredClone(context.bookingConstraints) } : {}),
    actionRequirements: structuredClone(research.actionRequirements),
    createdAt: context.createdAt
  };
  assertTripBlueprintIntegrity(blueprint, { expectedResearchPlaceIds: research.places.map((place) => place.id) });
  return blueprint;
}

function normalizeItineraryReasonableness(research: ResearchSet, artifact: SkillItineraryArtifact): Pick<SkillItineraryArtifact, "days" | "movements"> {
  const placeById = new Map(research.places.map((place) => [place.id, place] as const));
  const days = artifact.days.map((day) => {
    const stopIds = new Set(day.stops.map((stop) => stop.placeId));
    const candidates = enrichDayCandidates(day, research.places, stopIds);
    return {
      ...structuredClone(day),
      summary: enrichDaySummary(day),
      blocks: normalizeItineraryBlocks(day),
      candidatePlaceIds: candidates
    };
  });
  return { days, movements: normalizeMovementsForReasonableness(artifact.movements, days, placeById) };
}

function normalizeItineraryBlocks(day: BlueprintItineraryDay): BlueprintItineraryBlock[] {
  const inputBlocks = day.blocks ?? [];
  if (inputBlocks.length) {
    return inputBlocks
      .filter((block) => block.id.trim())
      .sort((left, right) => left.order - right.order)
      .map((block, index) => ({ ...structuredClone(block), order: index + 1, evidence: structuredClone(block.evidence ?? []) }));
  }
  return day.stops.map((stop, index) => ({
    id: `block-${day.id}-${index + 1}`,
    kind: inferItineraryBlockKind(stop.role),
    order: index + 1,
    placeId: stop.placeId,
    ...(stop.time ? { startTime: stop.time } : {}),
    ...(stop.role ? { role: stop.role } : {}),
    evidence: []
  }));
}

function inferItineraryBlockKind(role: string | undefined): BlueprintItineraryBlock["kind"] {
  const text = normalizeSearchText(role ?? "");
  if (/\b(lunch|dinner|breakfast|meal|coffee|cafe|café|snack|dessert|bar)\b/.test(text)) return "meal";
  if (/\b(hotel|lodging|check-in|checkout|luggage)\b/.test(text)) return "lodging";
  if (/\b(transfer|transit|rail|flight|airport|station)\b/.test(text)) return "transfer";
  if (/\b(rest|break|pause)\b/.test(text)) return "rest";
  if (/\b(flexible|optional|candidate|backup)\b/.test(text)) return "flexible";
  return "stop";
}

function defaultBlueprintModuleIdentity(): BlueprintModuleIdentity {
  return {
    primaryModule: "itinerary",
    enabledModules: [
      { id: "itinerary", title: "Itinerary", source: "blueprint" },
      { id: "preparation", title: "Preparation", source: "blueprint" },
      { id: "tips", title: "Tips", source: "blueprint" },
      { id: "sources", title: "Sources", source: "blueprint" }
    ]
  };
}

function normalizeGuideTheme(theme: BlueprintGuideTheme | undefined, days: BlueprintItineraryDay[], artifact: SkillItineraryArtifact): BlueprintGuideTheme {
  if (theme) {
    return {
      ...structuredClone(theme),
      title: theme.title.trim(),
      narrative: theme.narrative.trim(),
      ...(theme.citySegments ? { citySegments: theme.citySegments.map((segment) => {
        const dayIds = segment.dayIds?.filter((id, index, all) => days.some((day) => day.id === id) && all.indexOf(id) === index);
        return {
          id: segment.id.trim(),
          city: segment.city.trim(),
          title: segment.title.trim(),
          summary: segment.summary.trim(),
          ...(dayIds?.length ? { dayIds } : {})
        };
      }) } : {})
    };
  }
  return {
    title: artifact.title.trim(),
    narrative: artifact.summary.trim(),
    visitorMode: "balanced-visitor",
    citySegments: destinationsFromDays(days).map((city, index) => ({
      id: `segment-${index + 1}`,
      city,
      title: city,
      summary: days.filter((day) => day.city === city).map((day) => day.title).join("; ") || city,
      dayIds: days.filter((day) => day.city === city).map((day) => day.id)
    }))
  };
}

function destinationsFromDays(days: BlueprintItineraryDay[]): string[] {
  return days.map((day) => day.city).filter((city, index, all) => city && all.indexOf(city) === index);
}

function normalizeGuideRelationshipGraph(relationships: BlueprintPlaceRelationship[] | undefined, days: BlueprintItineraryDay[]): BlueprintGuideRelationshipGraph {
  const dayByPlace = new Map<string, string[]>();
  for (const day of days) {
    for (const stop of day.stops) dayByPlace.set(stop.placeId, [...(dayByPlace.get(stop.placeId) ?? []), day.id]);
    for (const candidateId of day.candidatePlaceIds) dayByPlace.set(candidateId, [...(dayByPlace.get(candidateId) ?? []), day.id]);
  }
  return {
    relationships: (relationships ?? []).map((relationship) => ({
      ...structuredClone(relationship),
      dayIds: relationship.dayIds ?? [...new Set([...(dayByPlace.get(relationship.fromPlaceId) ?? []), ...(dayByPlace.get(relationship.toPlaceId) ?? [])])]
    }))
  };
}

function normalizeBlueprintPlaces(places: BlueprintPlace[], days: BlueprintItineraryDay[]): BlueprintPlace[] {
  const scheduled = new Set(days.flatMap((day) => day.stops.map((stop) => stop.placeId)));
  const candidateDaysByPlace = new Map<string, string[]>();
  const scheduledDaysByPlace = new Map<string, string[]>();
  for (const day of days) {
    for (const stop of day.stops) scheduledDaysByPlace.set(stop.placeId, [...(scheduledDaysByPlace.get(stop.placeId) ?? []), day.id]);
    for (const candidateId of day.candidatePlaceIds) candidateDaysByPlace.set(candidateId, [...(candidateDaysByPlace.get(candidateId) ?? []), day.id]);
  }
  return places.map((place) => {
    if (place.schedulingEligibility) return structuredClone(place);
    const suitableDayIds = [...new Set([...(scheduledDaysByPlace.get(place.id) ?? []), ...(candidateDaysByPlace.get(place.id) ?? [])])];
    const decision: BlueprintSchedulingEligibility["decision"] = place.coordinates ? "schedulable" : "informational";
    return {
      ...structuredClone(place),
      schedulingEligibility: {
        decision,
        reason: scheduled.has(place.id)
          ? "This place is already part of the day-by-day itinerary and can be moved through itinerary editing."
          : suitableDayIds.length
            ? "This place is suitable for the listed itinerary day as an alternative or addition."
            : decision === "schedulable"
              ? "This place has map-ready identity and may be considered during replanning."
              : "This place lacks map-ready coordinates, so it remains useful written context until its location is verified.",
        ...(suitableDayIds.length ? { suitableDayIds } : {})
      }
    };
  });
}

function enrichDayCandidates(day: BlueprintItineraryDay, places: BlueprintPlace[], stopIds: Set<string>): string[] {
  const existing = day.candidatePlaceIds.filter((id, index, all) => !stopIds.has(id) && all.indexOf(id) === index);
  const target = day.kind === "scheduled" ? 8 : day.kind === "transit" ? 5 : 4;
  if (existing.length >= target) return existing;

  const existingSet = new Set(existing);
  const normalizedCity = normalizeSearchText(day.city);
  const scored = places
    .filter((place) => !stopIds.has(place.id) && !existingSet.has(place.id))
    .map((place) => ({ place, score: dayCandidateScore(day, place, normalizedCity) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));

  const enriched = [...existing];
  for (const { place } of scored) {
    enriched.push(place.id);
    if (enriched.length >= target) break;
  }
  return enriched;
}

function dayCandidateScore(day: BlueprintItineraryDay, place: BlueprintPlace, normalizedDayCity: string): number {
  const placeText = normalizeSearchText(`${place.city ?? ""} ${place.locationLabel} ${place.area ?? ""}`);
  const category = normalizeSearchText(`${place.category} ${place.visitRole ?? ""} ${place.name}`);
  const sameCity = normalizedDayCity && placeText.includes(normalizedDayCity);
  let score = sameCity ? 20 : 0;
  if (!sameCity && day.kind === "scheduled") return 0;
  if (/\b(restaurant|food|ramen|sushi|market|coffee|cafe|café|tea|dessert|bakery|bar)\b/.test(category)) score += day.kind === "scheduled" ? 12 : 16;
  if (/\b(park|garden|neighborhood|shopping|street|onsen|bath|viewpoint)\b/.test(category)) score += 8;
  if (/\b(airport|station|hotel|transport|rail|flight)\b/.test(category)) score += day.kind === "transit" ? 10 : -6;
  if (place.priority === "must") score += 4;
  if (place.priority === "preferred") score += 3;
  if (place.priority === "nearby") score += 2;
  if (place.contentTier === "deep") score += 2;
  if (place.contentTier === "compact") score -= 1;
  return score;
}

function enrichDaySummary(day: BlueprintItineraryDay): string {
  const summary = day.summary.trim();
  if (summary.length > 380 || /\b(candidate|fallback|swap|low-energy|buffer|meal|café|coffee)\b/i.test(summary)) return summary;
  const sentence = day.kind === "scheduled"
    ? " Treat the scheduled stops as the day’s spine, then use the candidates as meal, café, rainy-day, or low-energy swaps rather than extra obligations."
    : " Keep this as a light logistics day; use candidates only when timing, luggage, and energy make them easy.";
  return `${summary}${sentence}`;
}

function normalizeMovementsForReasonableness(movements: BlueprintMovement[], days: BlueprintItineraryDay[], placeById: Map<string, BlueprintPlace>): BlueprintMovement[] {
  const movementByKey = new Map<string, BlueprintMovement>();
  const usedIds = new Set<string>();
  for (const movement of movements) {
    const origin = placeById.get(movement.originPlaceId);
    const destination = placeById.get(movement.destinationPlaceId);
    const id = uniqueMovementIdentity(movement.id, usedIds);
    movementByKey.set(movementKey(movement.dayId, movement.originPlaceId, movement.destinationPlaceId), enrichMovement({ ...structuredClone(movement), id }, origin, destination));
  }
  for (const day of days) {
    for (let index = 0; index < day.stops.length - 1; index += 1) {
      const originPlaceId = day.stops[index]!.placeId;
      const destinationPlaceId = day.stops[index + 1]!.placeId;
      const key = movementKey(day.id, originPlaceId, destinationPlaceId);
      if (movementByKey.has(key)) continue;
      const origin = placeById.get(originPlaceId);
      const destination = placeById.get(destinationPlaceId);
      movementByKey.set(key, enrichMovement({
        id: uniqueMovementIdentity(`movement-${day.id}-${index + 1}`, usedIds),
        dayId: day.id,
        originPlaceId,
        destinationPlaceId,
        mode: inferMovementMode(origin, destination),
        status: "recheck",
        evidence: []
      }, origin, destination));
    }
  }
  return [...movementByKey.values()];
}

function enrichMovement(movement: BlueprintMovement, origin?: BlueprintPlace, destination?: BlueprintPlace): BlueprintMovement {
  const inferredMode = movement.mode === "unknown" ? inferMovementMode(origin, destination) : movement.mode;
  const durationMinutes = movement.durationMinutes ?? estimateMovementMinutes(origin, destination, inferredMode);
  const status = movement.status === "verified" && movement.evidence.length > 0 ? "verified" : "recheck";
  return {
    ...movement,
    mode: inferredMode,
    status,
    ...(durationMinutes ? { durationMinutes } : {}),
    label: movement.label?.trim() || movementLabel(inferredMode, destination),
    detail: movement.detail?.trim() || movementDetail(inferredMode, durationMinutes)
  };
}

function inferMovementMode(origin?: BlueprintPlace, destination?: BlueprintPlace): BlueprintMovement["mode"] {
  const text = normalizeSearchText(`${origin?.category ?? ""} ${origin?.name ?? ""} ${destination?.category ?? ""} ${destination?.name ?? ""}`);
  if (/\b(airport|flight|terminal|lax|haneda|narita|kansai)\b/.test(text)) return "flight";
  if (origin?.city && destination?.city && normalizeSearchText(origin.city) !== normalizeSearchText(destination.city)) return "rail";
  if (estimatedDistanceMeters(origin, destination) !== undefined && estimatedDistanceMeters(origin, destination)! <= 1400) return "walking";
  return "transit";
}

function estimateMovementMinutes(origin: BlueprintPlace | undefined, destination: BlueprintPlace | undefined, mode: BlueprintMovement["mode"]): number {
  const distance = estimatedDistanceMeters(origin, destination);
  if (mode === "flight") return 180;
  if (mode === "rail") return distance && distance > 250000 ? 150 : 70;
  if (mode === "walking") return distance ? Math.max(10, Math.ceil(distance / 70 / 5) * 5) : 15;
  if (distance) {
    if (distance <= 3000) return 25;
    if (distance <= 15000) return 40;
    if (distance <= 80000) return 75;
    return 120;
  }
  if (origin?.city && destination?.city && normalizeSearchText(origin.city) === normalizeSearchText(destination.city)) return 35;
  return 60;
}

function movementLabel(mode: BlueprintMovement["mode"], destination?: BlueprintPlace): string {
  const destinationName = destination?.name ?? "next stop";
  if (mode === "walking") return `Walk to ${destinationName}`;
  if (mode === "rail") return `Rail transfer to ${destinationName}`;
  if (mode === "flight") return `Flight or airport transfer to ${destinationName}`;
  if (mode === "driving") return `Drive to ${destinationName}`;
  return `Transit to ${destinationName}`;
}

function movementDetail(mode: BlueprintMovement["mode"], durationMinutes?: number): string {
  const estimate = durationMinutes ? `Allow about ${durationMinutes} minutes. ` : "";
  const method = mode === "walking" ? "walking time" : mode === "rail" ? "rail timing" : mode === "flight" ? "airport timing" : "routing";
  return `${estimate}This is a conservative planning estimate; refresh live ${method} before execution.`;
}

function estimatedDistanceMeters(origin?: BlueprintPlace, destination?: BlueprintPlace): number | undefined {
  if (!origin?.coordinates || !destination?.coordinates) return undefined;
  const [originLat, originLng] = origin.coordinates;
  const [destinationLat, destinationLng] = destination.coordinates;
  const toRad = (value: number) => value * Math.PI / 180;
  const latDelta = toRad(destinationLat - originLat);
  const lngDelta = toRad(destinationLng - originLng);
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(toRad(originLat)) * Math.cos(toRad(destinationLat)) * Math.sin(lngDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function movementKey(dayId: string, originPlaceId: string, destinationPlaceId: string): string {
  return `${dayId}\0${originPlaceId}\0${destinationPlaceId}`;
}

function uniqueMovementIdentity(id: string, usedIds: Set<string>): string {
  const base = id.trim() || "movement";
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
  const next = `${base}-${suffix}`;
  usedIds.add(next);
  return next;
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "");
}

export function mergeResearchSetCheckpoint(current: ResearchSet | undefined, incoming: ResearchSet, input: { status: ResearchSet["status"]; updatedAt: string }): ResearchSet {
  if (!current) {
    const first = { ...incoming, status: input.status, updatedAt: input.updatedAt, ...(input.status === "completed" ? { completedAt: input.updatedAt } : {}) };
    assertResearchSetIntegrity(first);
    return first;
  }
  if (current.id !== incoming.id || current.generationKey !== incoming.generationKey || JSON.stringify(current.proposalRef) !== JSON.stringify(incoming.proposalRef) || JSON.stringify(current.skillLineage) !== JSON.stringify(incoming.skillLineage)) throw new Error("Research checkpoint does not belong to the current Blueprint Generation.");
  const sourceByUrl = new Map(current.sources.map((source) => [source.url, source]));
  const incomingSourceRemap = new Map<string, string>();
  for (const source of incoming.sources) {
    const existing = sourceByUrl.get(source.url);
    if (existing) incomingSourceRemap.set(source.id, existing.id);
    else {
      sourceByUrl.set(source.url, source);
      incomingSourceRemap.set(source.id, source.id);
    }
  }
  const remapEvidence = (evidence: BlueprintEvidenceRef[]) => evidence.map((ref) => ({ ...ref, sourceId: incomingSourceRemap.get(ref.sourceId) ?? ref.sourceId }));
  const places = appendUnique(current.places, incoming.places.map((place) => ({ ...place, evidence: remapEvidence(place.evidence) })), (item) => item.id);
  const events = appendUnique(current.events, incoming.events.map((event) => ({ ...event, evidence: remapEvidence(event.evidence) })), (item) => item.id);
  const actionRequirements = appendUnique(current.actionRequirements, incoming.actionRequirements.map((requirement) => ({ ...requirement, evidence: remapEvidence(requirement.evidence) })), (item) => item.id);
  const guideRelationships = appendUnique(current.guideRelationships ?? [], (incoming.guideRelationships ?? []).map((relationship) => ({ ...relationship, evidence: remapEvidence(relationship.evidence) })), (item) => item.id);
  const batches = appendUnique(current.batches, incoming.batches.map((batch) => ({ ...batch, sourceIds: batch.sourceIds.map((id) => incomingSourceRemap.get(id) ?? id) })), (item) => item.id);
  const merged: ResearchSet = {
    ...current,
    status: input.status,
    batches,
    places,
    events,
    sources: [...sourceByUrl.values()],
    ...(guideRelationships.length ? { guideRelationships } : {}),
    actionRequirements,
    updatedAt: input.updatedAt,
    ...(input.status === "completed" ? { completedAt: input.updatedAt } : {})
  };
  assertResearchSetIntegrity(merged);
  return merged;
}

function evidenceForUrls(urls: string[] | undefined, sourceIdByUrl: Map<string, string>): BlueprintEvidenceRef[] {
  return (urls ?? []).map(normalizedHttpsUrl).map((url) => {
    const sourceId = sourceIdByUrl.get(url);
    if (!sourceId) throw new Error(`Skill artifact references an unknown source URL: ${url}`);
    return { sourceId, status: "recheck" as const };
  }).filter((value, index, all) => all.findIndex((candidate) => candidate.sourceId === value.sourceId) === index);
}

function remapFieldEvidence(items: BlueprintFieldEvidence[], sourceIdByArtifactId: Map<string, string>): BlueprintFieldEvidence[] {
  return items.map((item) => ({
    ...structuredClone(item),
    evidence: item.evidence.map((ref) => ({
      ...ref,
      sourceId: sourceIdByArtifactId.get(ref.sourceId) ?? ref.sourceId
    }))
  }));
}

function resolvePlaceId(value: string, imported: Map<string, string>, placeIds: Set<string>): string {
  const resolved = imported.get(value) ?? value;
  if (!placeIds.has(resolved)) throw new Error(`Skill artifact references an unknown place: ${value}`);
  return resolved;
}

function stableIdentity(prefix: string, input: string): string {
  const readable = input.normalize("NFKD").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${prefix}-${readable || "item"}-${fnv1a(input).toString(36)}`;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizedHttpsUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error(`Skill artifact URL must use HTTPS: ${value}`);
  url.hash = "";
  return url.toString();
}

function optionalHttpsLinks(input: Pick<SkillResearchPlaceArtifact, "officialUrl" | "bookingUrl" | "mapUrl" | "experienceUrl">): Pick<BlueprintPlace, "officialUrl" | "bookingUrl" | "mapUrl" | "experienceUrl"> {
  return {
    ...(input.officialUrl ? { officialUrl: normalizedHttpsUrl(input.officialUrl) } : {}),
    ...(input.bookingUrl ? { bookingUrl: normalizedHttpsUrl(input.bookingUrl) } : {}),
    ...(input.mapUrl ? { mapUrl: normalizedHttpsUrl(input.mapUrl) } : {}),
    ...(input.experienceUrl ? { experienceUrl: normalizedHttpsUrl(input.experienceUrl) } : {})
  };
}

function uniqueFilter<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}

function appendUnique<T>(current: T[], incoming: T[], identity: (item: T) => string): T[] {
  const seen = new Set(current.map(identity));
  return [...current, ...incoming.filter((item) => !seen.has(identity(item)) && Boolean(seen.add(identity(item))))];
}
