import {
  TRIP_BLUEPRINT_SCHEMA_VERSION,
  assertResearchSetIntegrity,
  assertTripBlueprintIntegrity,
  type BlueprintActionRequirement,
  type BlueprintBookingConstraint,
  type BlueprintEvent,
  type BlueprintExperienceTheme,
  type BlueprintFieldEvidence,
  type BlueprintGuideComparisonDisplay,
  type BlueprintGuideRelationshipGraph,
  type BlueprintGuideTheme,
  type BlueprintEvidenceRef,
  type BlueprintItineraryBlock,
  type BlueprintItineraryDay,
  type BlueprintLocalFood,
  type BlueprintLocalProduct,
  type BlueprintModuleIdentity,
  type BlueprintMovement,
  type BlueprintOperationalFacts,
  type BlueprintPlanAlternative,
  type BlueprintPlace,
  type BlueprintPlaceImageUsage,
  type BlueprintPlaceRelationship,
  type BlueprintPreparationChecklistItem,
  type BlueprintProposalRef,
  type BlueprintSchedulingEligibility,
  type BlueprintSource,
  type BlueprintTravelTip,
  type ResearchBatch,
  type ResearchSet,
  type SkillLineage,
  type TripBlueprint
} from "./trip-blueprint.js";

export const SKILL_IMPORTER_VERSION = "1.0.0";

type SkillGuideDisplayArtifact = Omit<NonNullable<BlueprintPlace["guideDisplay"]>, "comparisonRows"> & {
  comparisonRows?: Array<Omit<BlueprintGuideComparisonDisplay, "evidence"> & { sourceUrls?: string[] }>;
};

export interface SkillResearchPlaceImageArtifact {
  url: string;
  alt: string;
  caption?: string;
  sourceUrl?: string;
  sourceUrls?: string[];
  usage?: NonNullable<BlueprintPlace["images"]>[number]["usage"];
  status?: NonNullable<BlueprintPlace["images"]>[number]["status"];
}

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
  guideDisplay?: SkillGuideDisplayArtifact;
  contentTier?: BlueprintPlace["contentTier"];
  visitRole?: string;
  durationMinutes?: number;
  whyWorthIt: string;
  plan: string;
  tip?: string;
  detailSections?: BlueprintPlace["detailSections"];
  images?: SkillResearchPlaceImageArtifact[];
  officialUrl?: string;
  bookingUrl?: string;
  mapUrl?: string;
  experienceUrl?: string;
  sourceUrls?: string[];
  fieldEvidence?: BlueprintFieldEvidence[];
  operationalFacts?: BlueprintOperationalFacts;
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

export interface SkillLocalFoodArtifact {
  id?: string;
  title: string;
  description: string;
  context: string;
  diningPlaceIds: string[];
  sourceUrls?: string[];
}

export interface SkillLocalProductArtifact {
  id?: string;
  title: string;
  description: string;
  context: string;
  purchasePlaceIds: string[];
  sourceUrls?: string[];
}

export interface SkillExperienceThemeArtifact {
  id?: string;
  title: string;
  description: string;
  context: string;
  offeringPlaceIds: string[];
  sourceUrls?: string[];
}

export interface SkillTravelTipArtifact {
  id?: string;
  title: string;
  body: string;
  theme?: BlueprintTravelTip["theme"];
  context: string;
  placeId?: string;
  sourceUrls?: string[];
}

export interface SkillPreparationChecklistArtifact {
  id?: string;
  title: string;
  description?: string;
  group: BlueprintPreparationChecklistItem["group"];
  completionCondition: string;
  requirementId?: string;
  placeId?: string;
  sourceUrls?: string[];
}

export interface SkillResearchBatchArtifact {
  id: string;
  scopeLabel: string;
  places: SkillResearchPlaceArtifact[];
  events: SkillResearchEventArtifact[];
  relationships?: SkillPlaceRelationshipArtifact[];
  localFoods?: SkillLocalFoodArtifact[];
  localProducts?: SkillLocalProductArtifact[];
  experienceThemes?: SkillExperienceThemeArtifact[];
  travelTips?: SkillTravelTipArtifact[];
  preparationChecklist?: SkillPreparationChecklistArtifact[];
  sources: SkillResearchSourceArtifact[];
  actionRequirements?: SkillActionRequirementArtifact[];
  completedAt: string;
  imageDiagnostics?: {
    requestedPlaceCount: number;
    acceptedImageCount: number;
    omitted: Array<{ placeId: string; reason: string }>;
  };
}

export interface SkillItineraryArtifact {
  title: string;
  summary: string;
  language: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  guideTheme?: BlueprintGuideTheme;
  sources?: BlueprintSource[];
  travelTips?: BlueprintTravelTip[];
  preparationChecklist?: BlueprintPreparationChecklistItem[];
  actionRequirements?: BlueprintActionRequirement[];
  alternatives?: BlueprintPlanAlternative[];
  researchGrounding?: string[];
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
    ...batch.places.flatMap((place) => place.images?.flatMap((image) => validHttpsUrls([image.sourceUrl, ...(image.sourceUrls ?? [])])) ?? []),
    ...batch.places.flatMap((place) => place.guideDisplay?.comparisonRows?.flatMap((row) => row.sourceUrls ?? []) ?? []),
    ...batch.events.flatMap((event) => event.sourceUrls ?? []),
    ...(batch.localFoods ?? []).flatMap((item) => item.sourceUrls ?? []),
    ...(batch.localProducts ?? []).flatMap((item) => item.sourceUrls ?? []),
    ...(batch.experienceThemes ?? []).flatMap((item) => item.sourceUrls ?? []),
    ...(batch.travelTips ?? []).flatMap((tip) => tip.sourceUrls ?? []),
    ...(batch.preparationChecklist ?? []).flatMap((item) => item.sourceUrls ?? []),
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
  const sourceIds = new Set(sources.map((source) => source.id));
  const sourceIdByArtifactId = new Map<string, string>();
  for (const batch of artifacts) {
    for (const artifact of batch.sources) {
      const finalSourceId = sourceIdByUrl.get(normalizedHttpsUrl(artifact.url))!;
      sourceIdByArtifactId.set(finalSourceId, finalSourceId);
      if (artifact.id) registerSourceIdAliases(sourceIdByArtifactId, artifact.id, batch.id, finalSourceId);
    }
  }

  const rawPlaces = artifacts.flatMap((batch) => batch.places);
  const places: BlueprintPlace[] = [];
  const placeIdByExternalIdentity = new Map<string, string>();
  const inputPlaceIdMap = new Map<string, string>();
  for (const artifact of rawPlaces) {
    const externalKey = artifact.externalIdentity?.trim();
    const existingId = externalKey ? placeIdByExternalIdentity.get(externalKey) : undefined;
    const id = existingId ?? stableIdentity("place", artifact.id || externalKey || `${artifact.name}\0${artifact.city ?? artifact.locationLabel}`);
    if (artifact.id) inputPlaceIdMap.set(artifact.id, id);
    if (!existingId && externalKey) placeIdByExternalIdentity.set(externalKey, id);
  }
  const importedPlaceIds = new Set([
    ...inputPlaceIdMap.values(),
    ...placeIdByExternalIdentity.values(),
    ...rawPlaces.filter((place) => !place.id && !place.externalIdentity?.trim()).map((place) => stableIdentity("place", `${place.name}\0${place.city ?? place.locationLabel}`))
  ]);
  const emittedPlaceIds = new Set<string>();
  for (const artifact of rawPlaces) {
    const externalKey = artifact.externalIdentity?.trim();
    const id = artifact.id
      ? inputPlaceIdMap.get(artifact.id)!
      : externalKey
        ? placeIdByExternalIdentity.get(externalKey)!
        : stableIdentity("place", `${artifact.name}\0${artifact.city ?? artifact.locationLabel}`);
    const existingId = emittedPlaceIds.has(id);
    if (existingId) continue;
    emittedPlaceIds.add(id);
    const coordinates = normalizePlaceCoordinates(artifact.coordinates);
    const schedulingEligibility = artifact.schedulingEligibility
      ? normalizeResearchSchedulingEligibility(artifact.schedulingEligibility, sourceIdByArtifactId, sourceIds, Boolean(coordinates))
      : undefined;
    places.push({
      id,
      name: artifact.name.trim(),
      ...(artifact.localizedName?.trim() ? { localizedName: artifact.localizedName.trim() } : {}),
      locationLabel: artifact.locationLabel.trim(),
      ...(artifact.city?.trim() ? { city: artifact.city.trim() } : {}),
      ...(artifact.area?.trim() ? { area: artifact.area.trim() } : {}),
      category: artifact.category.trim(),
      priority: artifact.priority ?? "preferred",
      ...(coordinates ? { coordinates } : {}),
      ...(artifact.display ? { display: normalizePlaceDisplay(artifact.display) } : {}),
      ...(artifact.guideDisplay ? { guideDisplay: normalizeGuideDisplay(artifact.guideDisplay, sourceIdByUrl, inputPlaceIdMap, importedPlaceIds, id) } : {}),
      ...(artifact.contentTier ? { contentTier: artifact.contentTier } : {}),
      ...(artifact.visitRole?.trim() ? { visitRole: artifact.visitRole.trim() } : {}),
      ...(artifact.durationMinutes ? { durationMinutes: artifact.durationMinutes } : {}),
      whyWorthIt: artifact.whyWorthIt.trim(),
      plan: artifact.plan.trim(),
      ...(artifact.tip?.trim() ? { tip: artifact.tip.trim() } : {}),
      ...(artifact.detailSections ? { detailSections: structuredClone(artifact.detailSections) } : {}),
      ...(artifact.images?.length ? { images: normalizePlaceImages(artifact.images, sourceIdByUrl) } : {}),
      ...optionalHttpsLinks(artifact),
      evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl),
      ...(artifact.fieldEvidence?.length ? { fieldEvidence: remapFieldEvidence(artifact.fieldEvidence, sourceIdByArtifactId, sourceIds) } : {}),
      ...(artifact.operationalFacts ? { operationalFacts: remapOperationalFacts(artifact.operationalFacts, sourceIdByArtifactId, sourceIds) } : {}),
      ...(schedulingEligibility ? { schedulingEligibility } : {})
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
  const inputRequirementIdMap = new Map<string, string>();
  const actionRequirements: BlueprintActionRequirement[] = artifacts.flatMap((batch) => batch.actionRequirements ?? []).map((artifact) => {
    const id = stableIdentity("requirement", artifact.id || `${artifact.kind}\0${artifact.title}`);
    if (artifact.id) inputRequirementIdMap.set(artifact.id, id);
    return {
      id,
      kind: artifact.kind,
      title: artifact.title.trim(),
      description: artifact.description.trim(),
      accountableParty: artifact.accountableParty,
      completionCondition: artifact.completionCondition.trim(),
      ...(artifact.relevantAt?.trim() ? { relevantAt: artifact.relevantAt.trim() } : {}),
      ...(artifact.placeId ? { placeId: resolvePlaceId(artifact.placeId, inputPlaceIdMap, placeIds) } : {}),
      evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
    };
  });
  const requirementIds = new Set(actionRequirements.map((requirement) => requirement.id));
  const localFoods: BlueprintLocalFood[] = artifacts.flatMap((batch) => batch.localFoods ?? []).map((artifact) => ({
    id: stableIdentity("food", artifact.id || artifact.title),
    title: artifact.title.trim(),
    description: artifact.description.trim(),
    context: artifact.context.trim(),
    diningPlaceIds: artifact.diningPlaceIds.map((id) => resolvePlaceId(id, inputPlaceIdMap, placeIds)).filter(uniqueFilter),
    evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
  }));
  const localProducts: BlueprintLocalProduct[] = artifacts.flatMap((batch) => batch.localProducts ?? []).map((artifact) => ({
    id: stableIdentity("product", artifact.id || artifact.title),
    title: artifact.title.trim(),
    description: artifact.description.trim(),
    context: artifact.context.trim(),
    purchasePlaceIds: artifact.purchasePlaceIds.map((id) => resolvePlaceId(id, inputPlaceIdMap, placeIds)).filter(uniqueFilter),
    evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
  }));
  const experienceThemes: BlueprintExperienceTheme[] = artifacts.flatMap((batch) => batch.experienceThemes ?? []).map((artifact) => ({
    id: stableIdentity("experience", artifact.id || artifact.title),
    title: artifact.title.trim(),
    description: artifact.description.trim(),
    context: artifact.context.trim(),
    offeringPlaceIds: artifact.offeringPlaceIds.map((id) => resolvePlaceId(id, inputPlaceIdMap, placeIds)).filter(uniqueFilter),
    evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
  }));
  const hasExplicitTravelTips = artifacts.some((batch) => batch.travelTips !== undefined);
  const travelTips: BlueprintTravelTip[] = artifacts.flatMap((batch) => batch.travelTips ?? []).flatMap((artifact) => {
    const body = artifact.body.trim();
    if (!isDestinationRelevantTip(body)) return [];
    return [{
      id: stableIdentity("tip", artifact.id || `${artifact.title}\0${body}`),
      title: artifact.title.trim(),
      body,
      theme: artifact.theme ?? inferTravelTipTheme(`${artifact.title} ${body}`),
      context: artifact.context.trim(),
      ...(artifact.placeId ? { placeId: resolvePlaceId(artifact.placeId, inputPlaceIdMap, placeIds) } : {}),
      evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
    }];
  });
  const hasExplicitPreparationChecklist = artifacts.some((batch) => batch.preparationChecklist !== undefined);
  const preparationChecklist = hasExplicitPreparationChecklist
    ? artifacts.flatMap((batch) => batch.preparationChecklist ?? []).map((artifact) => ({
      id: stableIdentity("prep", artifact.id || `${artifact.group}\0${artifact.title}`),
      title: artifact.title.trim(),
      ...(artifact.description?.trim() ? { description: artifact.description.trim() } : {}),
      group: artifact.group,
      completionCondition: artifact.completionCondition.trim(),
      ...(artifact.requirementId ? { requirementId: resolveRequirementId(artifact.requirementId, inputRequirementIdMap, requirementIds) } : {}),
      ...(artifact.placeId ? { placeId: resolvePlaceId(artifact.placeId, inputPlaceIdMap, placeIds) } : {}),
      evidence: evidenceForUrls(artifact.sourceUrls, sourceIdByUrl)
    }))
    : preparationItemsFromRequirements(actionRequirements);
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
    ...(localFoods.length ? { localFoods } : {}),
    ...(localProducts.length ? { localProducts } : {}),
    ...(experienceThemes.length ? { experienceThemes } : {}),
    ...(hasExplicitTravelTips ? { travelTips: dedupeTravelTips(travelTips) } : {}),
    ...(hasExplicitPreparationChecklist || preparationChecklist.length ? { preparationChecklist } : {}),
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
  const travelTips = artifact.travelTips !== undefined ? structuredClone(artifact.travelTips) : normalizeTravelTips(research, reasonableItinerary.days);
  const preparationChecklist = artifact.preparationChecklist !== undefined ? structuredClone(artifact.preparationChecklist) : normalizePreparationChecklist(research);
  const sources = mergeBlueprintSources(research.sources, artifact.sources ?? []);
  const actionRequirements = mergeActionRequirements(research.actionRequirements, artifact.actionRequirements ?? []);
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
    sources,
    days: reasonableItinerary.days,
    movements: reasonableItinerary.movements,
    ...(context.bookingConstraints?.length ? { bookingConstraints: structuredClone(context.bookingConstraints) } : {}),
    actionRequirements,
    ...(research.localFoods?.length ? { localFoods: structuredClone(research.localFoods) } : {}),
    ...(research.localProducts?.length ? { localProducts: structuredClone(research.localProducts) } : {}),
    ...(research.experienceThemes?.length ? { experienceThemes: structuredClone(research.experienceThemes) } : {}),
    ...(artifact.travelTips !== undefined || research.travelTips !== undefined ? { travelTips } : {}),
    ...(artifact.preparationChecklist !== undefined || research.preparationChecklist !== undefined || preparationChecklist.length ? { preparationChecklist } : {}),
    ...(artifact.alternatives?.length ? { alternatives: structuredClone(artifact.alternatives) } : {}),
    ...(artifact.researchGrounding?.length ? { researchGrounding: artifact.researchGrounding.map((item) => item.trim()).filter(Boolean) } : {}),
    createdAt: context.createdAt
  };
  assertTripBlueprintIntegrity(blueprint, { expectedResearchPlaceIds: research.places.map((place) => place.id) });
  return blueprint;
}

function mergeBlueprintSources(researchSources: BlueprintSource[], artifactSources: BlueprintSource[]): BlueprintSource[] {
  const byId = new Map<string, BlueprintSource>();
  for (const source of [...researchSources, ...artifactSources]) {
    if (!source.id.trim()) continue;
    byId.set(source.id, structuredClone(source));
  }
  return [...byId.values()];
}

function mergeActionRequirements(researchRequirements: BlueprintActionRequirement[], artifactRequirements: BlueprintActionRequirement[]): BlueprintActionRequirement[] {
  const byId = new Map<string, BlueprintActionRequirement>();
  for (const requirement of [...researchRequirements, ...artifactRequirements]) {
    if (!requirement.id.trim()) continue;
    byId.set(requirement.id, structuredClone(requirement));
  }
  return [...byId.values()];
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
  if (day.blocks !== undefined) return day.blocks
    .filter((block) => block.id.trim())
    .sort((left, right) => left.order - right.order)
    .map((block, index) => normalizeItineraryBlock(block, index));
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

function normalizeItineraryBlock(block: BlueprintItineraryBlock, index: number): BlueprintItineraryBlock {
  return {
    ...structuredClone(block),
    order: index + 1,
    ...(block.display ? { display: normalizeItineraryBlockDisplay(block.display) } : {}),
    evidence: structuredClone(block.evidence ?? [])
  };
}

function normalizeItineraryBlockDisplay(display: NonNullable<BlueprintItineraryBlock["display"]>): NonNullable<BlueprintItineraryBlock["display"]> {
  return {
    ...(display.timeLabel?.trim() ? { timeLabel: display.timeLabel.trim() } : {}),
    ...(display.meta?.trim() ? { meta: display.meta.trim() } : {}),
    ...(display.routeAnchor === undefined ? {} : { routeAnchor: display.routeAnchor }),
    ...(display.reorderable === undefined ? {} : { reorderable: display.reorderable })
  };
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
  const dayIds = new Set(days.map((day) => day.id));
  const candidateDaysByPlace = new Map<string, string[]>();
  const scheduledDaysByPlace = new Map<string, string[]>();
  for (const day of days) {
    for (const stop of day.stops) scheduledDaysByPlace.set(stop.placeId, [...(scheduledDaysByPlace.get(stop.placeId) ?? []), day.id]);
    for (const candidateId of day.candidatePlaceIds) candidateDaysByPlace.set(candidateId, [...(candidateDaysByPlace.get(candidateId) ?? []), day.id]);
  }
  return places.map((place) => {
    const suitableDayIds = [...new Set([...(scheduledDaysByPlace.get(place.id) ?? []), ...(candidateDaysByPlace.get(place.id) ?? [])])];
    if (place.schedulingEligibility) {
      return {
        ...structuredClone(place),
        schedulingEligibility: normalizeBlueprintSchedulingEligibility(place.schedulingEligibility, dayIds, suitableDayIds)
      };
    }
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
  const status = movement.status === "verified" && evidenceIsFullyVerified(movement.evidence) ? "verified" : "recheck";
  const label = movement.label?.trim() || movementLabel(inferredMode, destination);
  const detail = movement.detail?.trim() || movementDetail(inferredMode, durationMinutes);
  const display = normalizeMovementDisplayForStatus(movement, normalizeMovementDisplay(movement.display), status, label);
  return {
    ...movement,
    mode: inferredMode,
    status,
    ...(durationMinutes ? { durationMinutes } : {}),
    label,
    detail,
    ...(display ? { display } : {})
  };
}

function normalizeMovementDisplay(display: BlueprintMovement["display"]): NonNullable<BlueprintMovement["display"]> | undefined {
  if (!display) return undefined;
  return {
    ...(display.routeLabel?.trim() ? { routeLabel: display.routeLabel.trim() } : {}),
    ...(display.refreshReason?.trim() ? { refreshReason: display.refreshReason.trim() } : {}),
    ...(display.refreshScope ? { refreshScope: normalizeMovementRefreshScope(display.refreshScope) } : {}),
    ...(display.showAsFormalRoute === undefined ? {} : { showAsFormalRoute: display.showAsFormalRoute }),
    ...(display.mapLineState ? { mapLineState: display.mapLineState } : {})
  };
}

function normalizeMovementDisplayForStatus(movement: BlueprintMovement, display: NonNullable<BlueprintMovement["display"]> | undefined, status: BlueprintMovement["status"], label: string): NonNullable<BlueprintMovement["display"]> | undefined {
  if (status === "verified") {
    if (!display) return undefined;
    const { refreshReason: _refreshReason, refreshScope: _refreshScope, ...rest } = display;
    const mapLineState = rest.mapLineState === "needs_refresh" ? "formal" : rest.mapLineState;
    return compactMovementDisplay({
      ...rest,
      ...(mapLineState ? { mapLineState } : {})
    });
  }
  return compactMovementDisplay({
    ...display,
    routeLabel: display?.routeLabel ?? label,
    refreshReason: display?.refreshReason ?? "Refresh this route leg after itinerary verification.",
    refreshScope: display?.refreshScope ?? {
      dayId: movement.dayId,
      originPlaceId: movement.originPlaceId,
      destinationPlaceId: movement.destinationPlaceId,
      reason: "unverified_route"
    },
    showAsFormalRoute: display?.showAsFormalRoute ?? true,
    mapLineState: display?.mapLineState ?? "needs_refresh"
  });
}

function compactMovementDisplay(display: NonNullable<BlueprintMovement["display"]>): NonNullable<BlueprintMovement["display"]> | undefined {
  return Object.keys(display).length ? display : undefined;
}

function normalizeMovementRefreshScope(scope: NonNullable<BlueprintMovement["display"]>["refreshScope"]): NonNullable<NonNullable<BlueprintMovement["display"]>["refreshScope"]> {
  return {
    dayId: scope?.dayId?.trim() ?? "",
    originPlaceId: scope?.originPlaceId?.trim() ?? "",
    destinationPlaceId: scope?.destinationPlaceId?.trim() ?? "",
    reason: scope?.reason ?? "unverified_route"
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

function normalizeTravelTips(research: ResearchSet, days: BlueprintItineraryDay[]): BlueprintTravelTip[] {
  if (research.travelTips !== undefined) return dedupeTravelTips(structuredClone(research.travelTips));
  void days;
  return [];
}

function normalizePreparationChecklist(research: ResearchSet): BlueprintPreparationChecklistItem[] {
  if (research.preparationChecklist !== undefined) return structuredClone(research.preparationChecklist);
  return preparationItemsFromRequirements(research.actionRequirements);
}

function preparationItemsFromRequirements(requirements: BlueprintActionRequirement[]): BlueprintPreparationChecklistItem[] {
  return requirements
    .filter((requirement) => requirement.accountableParty === "traveler")
    .map((requirement) => ({
      id: stableIdentity("prep", requirement.id),
      title: travelerPreparationTitle(requirement),
      description: requirement.description.trim(),
      group: preparationGroupForRequirement(requirement),
      completionCondition: requirement.completionCondition.trim(),
      requirementId: requirement.id,
      ...(requirement.placeId ? { placeId: requirement.placeId } : {}),
      evidence: structuredClone(requirement.evidence)
    }));
}

function dedupeTravelTips(tips: BlueprintTravelTip[]): BlueprintTravelTip[] {
  const seen = new Set<string>();
  return tips.filter((tip) => {
    const key = normalizeSearchText(`${tip.placeId ?? ""}\0${tip.title}\0${tip.body}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function travelerPreparationTitle(requirement: BlueprintActionRequirement): string {
  const title = requirement.title.trim();
  if (requirement.kind === "travel_authorization" && /authorization/i.test(title)) return title.replace(/authorization/ig, "entry document").trim();
  return title;
}

function preparationGroupForRequirement(requirement: BlueprintActionRequirement): BlueprintPreparationChecklistItem["group"] {
  const text = normalizeSearchText(`${requirement.kind} ${requirement.title} ${requirement.description} ${requirement.completionCondition}`);
  if (/passport|visa|entry|immigration|permit|document|id|签证|护照|入境/.test(text)) return "documents";
  if (/phone|sim|esim|app|payment|cash|card|suica|pasmo|ic card|wallet|支付|现金|电话|流量|交通卡/.test(text)) return "phone_payments";
  if (/book|booking|reservation|ticket|flight|train|hotel|departure|check-?in|预约|预订|机票|车票|酒店/.test(text)) return "bookings_departure";
  if (/pack|clothes|shoe|medicine|adapter|rain|umbrella|weather|行李|衣服|药|雨伞|转换插头/.test(text)) return "packing";
  if (requirement.kind === "reservation" || requirement.kind === "transport") return "bookings_departure";
  if (requirement.kind === "travel_authorization") return "documents";
  return "other";
}

function inferTravelTipTheme(value: string): BlueprintTravelTip["theme"] {
  const text = normalizeSearchText(value);
  if (/payment|cash|card|tax|wallet|suica|pasmo|支付|现金/.test(text)) return "payment";
  if (/transport|taxi|metro|train|bus|rail|station|交通|地铁|电车|车站/.test(text)) return "transport";
  if (/temple|shrine|etiquette|custom|礼仪|风俗|寺|神社/.test(text)) return "etiquette";
  if (/safety|safe|scam|risk|crime|安全|诈骗/.test(text)) return "safety";
  if (/weather|dress|rain|heat|cold|snow|天气|穿|雨|冷|热/.test(text)) return "weather";
  if (/reservation|queue|opening|hours|closed|timing|预约|排队|营业|闭馆/.test(text)) return "timing";
  if (/language|phrase|translation|japanese|english|语言|翻译/.test(text)) return "language";
  return "local_norms";
}

function isDestinationRelevantTip(value: string): boolean {
  const text = normalizeSearchText(value);
  if (/rest early|stay positive|enjoy the journey|take photos|have fun|relax and enjoy/.test(text)) return false;
  return /local|custom|etiquette|safety|safe|scam|payment|cash|card|transport|taxi|metro|train|bus|weather|dress|temple|shrine|market|queue|reservation|opening|hours|passport|visa|entry|neighborhood|area|language|tip|礼仪|安全|支付|现金|交通|天气|寺|神社|市场|排队|预约|营业|签证|入境/.test(text);
}

export function mergeResearchSetCheckpoint(current: ResearchSet | undefined, incoming: ResearchSet, input: { status: ResearchSet["status"]; updatedAt: string }): ResearchSet {
  if (!current) {
    const first = { ...incoming, status: input.status, updatedAt: input.updatedAt, ...(input.status === "completed" ? { completedAt: input.updatedAt } : {}) };
    assertResearchSetIntegrity(first);
    return first;
  }
  if (current.id !== incoming.id || current.generationKey !== incoming.generationKey || JSON.stringify(current.proposalRef) !== JSON.stringify(incoming.proposalRef) || JSON.stringify(current.skillLineage) !== JSON.stringify(incoming.skillLineage)) throw new Error("Research checkpoint does not belong to the current Blueprint Generation.");
  const sourceByUrl = new Map(current.sources.map((source) => [source.url, source]));
  const sourceById = new Map(current.sources.map((source) => [source.id, source]));
  const incomingSourceRemap = new Map<string, string>();
  for (const source of incoming.sources) {
    const existing = sourceByUrl.get(source.url) ?? sourceById.get(source.id);
    if (existing) incomingSourceRemap.set(source.id, existing.id);
    else {
      sourceByUrl.set(source.url, source);
      sourceById.set(source.id, source);
      incomingSourceRemap.set(source.id, source.id);
    }
  }
  const remapEvidence = (evidence: BlueprintEvidenceRef[]) => evidence.map((ref) => ({ ...ref, sourceId: incomingSourceRemap.get(ref.sourceId) ?? ref.sourceId }));
  const places = appendUnique(current.places, incoming.places.map((place) => ({
    ...place,
    evidence: remapEvidence(place.evidence),
    ...(place.images?.length ? { images: remapMergedPlaceImages(place.images, remapEvidence) } : {}),
    ...(place.fieldEvidence?.length ? { fieldEvidence: remapMergedFieldEvidence(place.fieldEvidence, remapEvidence) } : {}),
    ...(place.operationalFacts ? { operationalFacts: remapOperationalFactEvidence(place.operationalFacts, remapEvidence) } : {}),
    ...(place.guideDisplay ? { guideDisplay: remapGuideDisplayEvidence(place.guideDisplay, remapEvidence) } : {}),
    ...(place.schedulingEligibility ? { schedulingEligibility: remapMergedSchedulingEligibility(place.schedulingEligibility, remapEvidence) } : {})
  })), (item) => item.id);
  const events = appendUnique(current.events, incoming.events.map((event) => ({ ...event, evidence: remapEvidence(event.evidence) })), (item) => item.id);
  const actionRequirements = appendUnique(current.actionRequirements, incoming.actionRequirements.map((requirement) => ({ ...requirement, evidence: remapEvidence(requirement.evidence) })), (item) => item.id);
  const localFoods = appendUnique(current.localFoods ?? [], (incoming.localFoods ?? []).map((item) => ({ ...item, evidence: remapEvidence(item.evidence) })), (item) => item.id);
  const localProducts = appendUnique(current.localProducts ?? [], (incoming.localProducts ?? []).map((item) => ({ ...item, evidence: remapEvidence(item.evidence) })), (item) => item.id);
  const experienceThemes = appendUnique(current.experienceThemes ?? [], (incoming.experienceThemes ?? []).map((item) => ({ ...item, evidence: remapEvidence(item.evidence) })), (item) => item.id);
  const hasTravelTips = current.travelTips !== undefined || incoming.travelTips !== undefined;
  const hasPreparationChecklist = current.preparationChecklist !== undefined || incoming.preparationChecklist !== undefined;
  const travelTips = appendUnique(current.travelTips ?? [], (incoming.travelTips ?? []).map((tip) => ({ ...tip, evidence: remapEvidence(tip.evidence) })), (item) => item.id);
  const preparationChecklist = appendUnique(current.preparationChecklist ?? [], (incoming.preparationChecklist ?? []).map((item) => ({ ...item, evidence: remapEvidence(item.evidence) })), (item) => item.id);
  const guideRelationships = appendUnique(current.guideRelationships ?? [], (incoming.guideRelationships ?? []).map((relationship) => ({ ...relationship, evidence: remapEvidence(relationship.evidence) })), (item) => item.id);
  const batches = appendUnique(current.batches, incoming.batches.map((batch) => ({ ...batch, sourceIds: batch.sourceIds.map((id) => incomingSourceRemap.get(id) ?? id) })), (item) => item.id);
  const merged: ResearchSet = {
    ...current,
    status: input.status,
    batches,
    places,
    events,
    sources: [...sourceById.values()],
    ...(localFoods.length ? { localFoods } : {}),
    ...(localProducts.length ? { localProducts } : {}),
    ...(experienceThemes.length ? { experienceThemes } : {}),
    ...(hasTravelTips ? { travelTips } : {}),
    ...(hasPreparationChecklist ? { preparationChecklist } : {}),
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

function normalizePlaceImages(images: SkillResearchPlaceImageArtifact[], sourceIdByUrl: Map<string, string>): NonNullable<BlueprintPlace["images"]> {
  return images.flatMap((image) => {
    const url = safeNormalizedHttpsUrl(image.url);
    const alt = image.alt?.trim();
    const sourceId = validHttpsUrls([image.sourceUrl, ...(image.sourceUrls ?? [])])
      .map((sourceUrl) => sourceIdByUrl.get(sourceUrl))
      .find((id): id is string => Boolean(id));
    if (!url || !alt || !sourceId) return [];
    const usage: BlueprintPlaceImageUsage[] = (image.usage ?? [])
      .filter((value): value is BlueprintPlaceImageUsage => value === "detail" || value === "card")
      .filter(uniqueFilter);
    const status: NonNullable<BlueprintPlace["images"]>[number]["status"] = image.status === "verified" || image.status === "stale" ? image.status : "recheck";
    const normalized: NonNullable<BlueprintPlace["images"]>[number] = {
      url,
      alt,
      sourceId,
      status
    };
    if (image.caption?.trim()) normalized.caption = image.caption.trim();
    if (usage.length) normalized.usage = usage;
    return [normalized];
  }).filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url && candidate.sourceId === image.sourceId) === index);
}

function remapFieldEvidence(items: BlueprintFieldEvidence[], sourceIdByArtifactId: Map<string, string>, sourceIds: Set<string>): BlueprintFieldEvidence[] {
  return items.map((item) => {
    const evidence = remapEvidenceRefs(item.evidence, sourceIdByArtifactId, sourceIds);
    return {
      ...structuredClone(item),
      status: item.status === "verified" && !evidenceIsFullyVerified(evidence) ? "recheck" : item.status,
      evidence
    };
  });
}

function remapOperationalFacts(facts: BlueprintOperationalFacts, sourceIdByArtifactId: Map<string, string>, sourceIds: Set<string>): BlueprintOperationalFacts {
  const remapFact = <T extends { status: BlueprintEvidenceRef["status"]; evidence: BlueprintEvidenceRef[] }>(fact: T): T | undefined => {
    const evidence = remapEvidenceRefs(fact.evidence, sourceIdByArtifactId, sourceIds);
    if (!evidence.length) return undefined;
    return {
      ...structuredClone(fact),
      status: fact.status === "verified" && !evidenceIsFullyVerified(evidence) ? "recheck" : fact.status,
      evidence
    };
  };
  const access = facts.access;
  const entry = facts.entry;
  const windows = access?.windows?.map(remapFact).filter(isDefined);
  const closed = access?.closed?.map(remapFact).filter(isDefined);
  const lastEntry = access?.lastEntry ? remapFact(access.lastEntry) : undefined;
  const sessions = facts.sessions?.map(remapFact).filter(isDefined);
  const reservation = entry?.reservation ? remapFact(entry.reservation) : undefined;
  const ticket = entry?.ticket ? remapFact(entry.ticket) : undefined;
  const booking = entry?.booking ? remapFact(entry.booking) : undefined;
  const capacity = entry?.capacity ? remapFact(entry.capacity) : undefined;
  const normalizedAccess = {
    ...(windows?.length ? { windows } : {}),
    ...(closed?.length ? { closed } : {}),
    ...(lastEntry ? { lastEntry } : {})
  };
  const normalizedEntry = {
    ...(reservation ? { reservation } : {}),
    ...(ticket ? { ticket } : {}),
    ...(booking ? { booking } : {}),
    ...(capacity ? { capacity } : {})
  };
  return {
    ...(Object.keys(normalizedAccess).length ? { access: normalizedAccess } : {}),
    ...(sessions?.length ? { sessions } : {}),
    ...(Object.keys(normalizedEntry).length ? { entry: normalizedEntry } : {})
  };
}

function normalizePlaceCoordinates(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [first, second] = value;
  if (typeof first !== "number" || typeof second !== "number") return undefined;
  if (isLatitudeLongitudePair(first, second)) return [first, second];
  if (isLatitudeLongitudePair(second, first)) return [second, first];
  return undefined;
}

function isLatitudeLongitudePair(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function normalizeResearchSchedulingEligibility(eligibility: BlueprintSchedulingEligibility, sourceIdByArtifactId: Map<string, string>, sourceIds: Set<string>, hasMapReadyCoordinates: boolean): BlueprintSchedulingEligibility {
  if (!hasMapReadyCoordinates && eligibility.decision === "schedulable") {
    return {
      decision: "informational",
      reason: "This place lacks map-ready coordinates, so it remains useful written context until its location is verified.",
      ...(eligibility.highImpactReasons?.length ? { highImpactReasons: uniqueStrings(eligibility.highImpactReasons.map((reason) => reason.trim()).filter(Boolean)) } : {}),
      ...(eligibility.evidence?.length ? { evidence: remapEvidenceRefs(eligibility.evidence, sourceIdByArtifactId, sourceIds) } : {})
    };
  }
  return {
    decision: eligibility.decision,
    reason: eligibility.reason.trim(),
    ...(eligibility.suitableDayIds?.length ? { suitableDayIds: uniqueStrings(eligibility.suitableDayIds.map((id) => id.trim()).filter(Boolean)) } : {}),
    ...(eligibility.blockedDayIds?.length ? { blockedDayIds: uniqueStrings(eligibility.blockedDayIds.map((id) => id.trim()).filter(Boolean)) } : {}),
    ...(eligibility.highImpactReasons?.length ? { highImpactReasons: uniqueStrings(eligibility.highImpactReasons.map((reason) => reason.trim()).filter(Boolean)) } : {}),
    ...(eligibility.evidence?.length ? { evidence: remapEvidenceRefs(eligibility.evidence, sourceIdByArtifactId, sourceIds) } : {})
  };
}

function normalizeBlueprintSchedulingEligibility(eligibility: BlueprintSchedulingEligibility, dayIds: Set<string>, fallbackSuitableDayIds: string[]): BlueprintSchedulingEligibility {
  const suitableDayIds = uniqueStrings((eligibility.suitableDayIds ?? []).filter((id) => dayIds.has(id)));
  const blockedDayIds = uniqueStrings((eligibility.blockedDayIds ?? []).filter((id) => dayIds.has(id)));
  const highImpactReasons = uniqueStrings((eligibility.highImpactReasons ?? []).map((reason) => reason.trim()).filter(Boolean));
  return {
    decision: eligibility.decision,
    reason: eligibility.reason.trim(),
    ...(suitableDayIds.length ? { suitableDayIds } : eligibility.decision === "schedulable" && fallbackSuitableDayIds.length ? { suitableDayIds: fallbackSuitableDayIds } : {}),
    ...(blockedDayIds.length ? { blockedDayIds } : {}),
    ...(highImpactReasons.length ? { highImpactReasons } : {}),
    ...(eligibility.evidence?.length ? { evidence: structuredClone(eligibility.evidence) } : {})
  };
}

function remapEvidenceRefs(evidence: BlueprintEvidenceRef[], sourceIdByArtifactId: Map<string, string>, sourceIds: Set<string>): BlueprintEvidenceRef[] {
  return evidence.flatMap((ref) => {
    const sourceId = sourceIdByArtifactId.get(ref.sourceId) ?? ref.sourceId;
    if (!sourceIds.has(sourceId)) return [];
    return [{ ...structuredClone(ref), sourceId }];
  }).filter((ref, index, all) => all.findIndex((candidate) => candidate.sourceId === ref.sourceId && candidate.status === ref.status) === index);
}

function registerSourceIdAliases(map: Map<string, string>, artifactId: string, batchId: string, finalSourceId: string): void {
  const trimmed = artifactId.trim();
  if (!trimmed) return;
  const aliases = [trimmed, `${batchId}-${trimmed}`];
  if (trimmed.startsWith(`${batchId}-`)) aliases.push(trimmed.slice(batchId.length + 1));
  for (const alias of aliases) if (alias) map.set(alias, finalSourceId);
}

function evidenceIsFullyVerified(evidence: BlueprintEvidenceRef[]): boolean {
  return evidence.length > 0 && evidence.every((ref) => ref.status === "verified");
}

function normalizeGuideDisplay(display: NonNullable<SkillResearchPlaceArtifact["guideDisplay"]>, sourceIdByUrl: Map<string, string>, inputPlaceIdMap: Map<string, string>, placeIds: Set<string>, selfPlaceId: string): NonNullable<BlueprintPlace["guideDisplay"]> {
  const comparisonRows = (display.comparisonRows ?? []).flatMap((row) => {
    const relatedPlaceId = row.relatedPlaceId?.trim() ? inputPlaceIdMap.get(row.relatedPlaceId.trim()) ?? row.relatedPlaceId.trim() : undefined;
    const validRelatedPlaceId = relatedPlaceId && placeIds.has(relatedPlaceId) && relatedPlaceId !== selfPlaceId ? relatedPlaceId : undefined;
    if (!validRelatedPlaceId && !row.name?.trim()) return [];
    return [{
      id: row.id.trim(),
      ...(validRelatedPlaceId ? { relatedPlaceId: validRelatedPlaceId } : {}),
      ...(row.name?.trim() ? { name: row.name.trim() } : {}),
      area: row.area.trim(),
      routeFit: row.routeFit.trim(),
      timing: row.timing.trim(),
      effort: row.effort.trim(),
      sourceState: row.sourceState.trim(),
      evidence: evidenceForUrls(row.sourceUrls, sourceIdByUrl)
    }];
  });
  return {
    ...(display.showInGuide === undefined ? {} : { showInGuide: display.showInGuide }),
    ...(display.state ? { state: display.state } : {}),
    ...(display.cardSummary?.trim() ? { cardSummary: display.cardSummary.trim() } : {}),
    ...(display.tags?.length ? { tags: display.tags.map((tag) => tag.trim()).filter(Boolean) } : {}),
    ...(display.footerNote?.trim() ? { footerNote: display.footerNote.trim() } : {}),
    ...(display.primaryActionLabel?.trim() ? { primaryActionLabel: display.primaryActionLabel.trim() } : {}),
    ...(display.addActionLabel?.trim() ? { addActionLabel: display.addActionLabel.trim() } : {}),
    ...(display.addBlockedLabel?.trim() ? { addBlockedLabel: display.addBlockedLabel.trim() } : {}),
    ...(display.scheduledActionLabel?.trim() ? { scheduledActionLabel: display.scheduledActionLabel.trim() } : {}),
    ...(display.informationalActionLabel?.trim() ? { informationalActionLabel: display.informationalActionLabel.trim() } : {}),
    ...(display.blockedActionLabel?.trim() ? { blockedActionLabel: display.blockedActionLabel.trim() } : {}),
    ...(display.detailLeadTitle?.trim() ? { detailLeadTitle: display.detailLeadTitle.trim() } : {}),
    ...(display.detailPlanTitle?.trim() ? { detailPlanTitle: display.detailPlanTitle.trim() } : {}),
    ...(display.detailSourceTitle?.trim() ? { detailSourceTitle: display.detailSourceTitle.trim() } : {}),
    ...(display.comparisonTitle?.trim() ? { comparisonTitle: display.comparisonTitle.trim() } : {}),
    ...(comparisonRows.length ? { comparisonRows } : {})
  };
}

function normalizePlaceDisplay(display: NonNullable<SkillResearchPlaceArtifact["display"]>): NonNullable<BlueprintPlace["display"]> {
  return {
    type: display.type,
    ...(display.markerKind ? { markerKind: display.markerKind } : {}),
    ...(display.workspaceSignals ? {
      workspaceSignals: {
        reservation: display.workspaceSignals.reservation,
        needsRecheck: display.workspaceSignals.needsRecheck,
        longStop: display.workspaceSignals.longStop,
        ...(display.workspaceSignals.itineraryStatusLabel?.trim() ? { itineraryStatusLabel: display.workspaceSignals.itineraryStatusLabel.trim() } : {})
      }
    } : {})
  };
}

function remapGuideDisplayEvidence(display: NonNullable<BlueprintPlace["guideDisplay"]>, remapEvidence: (evidence: BlueprintEvidenceRef[]) => BlueprintEvidenceRef[]): NonNullable<BlueprintPlace["guideDisplay"]> {
  return {
    ...structuredClone(display),
    ...(display.comparisonRows?.length ? { comparisonRows: display.comparisonRows.map((row) => ({
      ...row,
      evidence: remapEvidence(row.evidence ?? [])
    })) } : {})
  };
}

function remapMergedFieldEvidence(items: BlueprintFieldEvidence[], remapEvidence: (evidence: BlueprintEvidenceRef[]) => BlueprintEvidenceRef[]): BlueprintFieldEvidence[] {
  return items.map((item) => {
    const evidence = remapEvidence(item.evidence);
    return {
      ...structuredClone(item),
      status: item.status === "verified" && !evidenceIsFullyVerified(evidence) ? "recheck" : item.status,
      evidence
    };
  });
}

function remapMergedPlaceImages(images: NonNullable<BlueprintPlace["images"]>, remapEvidence: (evidence: BlueprintEvidenceRef[]) => BlueprintEvidenceRef[]): NonNullable<BlueprintPlace["images"]> {
  return images.flatMap((image) => {
    const evidence = remapEvidence([{ sourceId: image.sourceId, status: image.status ?? "recheck" }]);
    const sourceId = evidence[0]?.sourceId;
    if (!sourceId) return [];
    return [{ ...structuredClone(image), sourceId }];
  });
}

function remapMergedSchedulingEligibility(eligibility: BlueprintSchedulingEligibility, remapEvidence: (evidence: BlueprintEvidenceRef[]) => BlueprintEvidenceRef[]): BlueprintSchedulingEligibility {
  return {
    ...structuredClone(eligibility),
    ...(eligibility.evidence?.length ? { evidence: remapEvidence(eligibility.evidence) } : {})
  };
}

function remapOperationalFactEvidence(facts: BlueprintOperationalFacts, remapEvidence: (evidence: BlueprintEvidenceRef[]) => BlueprintEvidenceRef[]): BlueprintOperationalFacts {
  const remapFact = <T extends { evidence: BlueprintEvidenceRef[] }>(fact: T): T | undefined => {
    const evidence = remapEvidence(fact.evidence);
    if (!evidence.length) return undefined;
    return { ...structuredClone(fact), evidence };
  };
  const access = facts.access;
  const entry = facts.entry;
  const windows = access?.windows?.map(remapFact).filter(isDefined);
  const closed = access?.closed?.map(remapFact).filter(isDefined);
  const lastEntry = access?.lastEntry ? remapFact(access.lastEntry) : undefined;
  const sessions = facts.sessions?.map(remapFact).filter(isDefined);
  const reservation = entry?.reservation ? remapFact(entry.reservation) : undefined;
  const ticket = entry?.ticket ? remapFact(entry.ticket) : undefined;
  const booking = entry?.booking ? remapFact(entry.booking) : undefined;
  const capacity = entry?.capacity ? remapFact(entry.capacity) : undefined;
  const normalizedAccess = {
    ...(windows?.length ? { windows } : {}),
    ...(closed?.length ? { closed } : {}),
    ...(lastEntry ? { lastEntry } : {})
  };
  const normalizedEntry = {
    ...(reservation ? { reservation } : {}),
    ...(ticket ? { ticket } : {}),
    ...(booking ? { booking } : {}),
    ...(capacity ? { capacity } : {})
  };
  return {
    ...(Object.keys(normalizedAccess).length ? { access: normalizedAccess } : {}),
    ...(sessions?.length ? { sessions } : {}),
    ...(Object.keys(normalizedEntry).length ? { entry: normalizedEntry } : {})
  };
}

function resolvePlaceId(value: string, imported: Map<string, string>, placeIds: Set<string>): string {
  const resolved = imported.get(value) ?? value;
  if (!placeIds.has(resolved)) throw new Error(`Skill artifact references an unknown place: ${value}`);
  return resolved;
}

function resolveRequirementId(value: string, imported: Map<string, string>, requirementIds: Set<string>): string {
  const resolved = imported.get(value) ?? value;
  if (!requirementIds.has(resolved)) throw new Error(`Skill artifact references an unknown action requirement: ${value}`);
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

function safeNormalizedHttpsUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return normalizedHttpsUrl(value);
  } catch {
    return undefined;
  }
}

function validHttpsUrls(values: Array<string | undefined>): string[] {
  return values.flatMap((value) => {
    const url = safeNormalizedHttpsUrl(value);
    return url ? [url] : [];
  }).filter(uniqueFilter);
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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function appendUnique<T>(current: T[], incoming: T[], identity: (item: T) => string): T[] {
  const seen = new Set(current.map(identity));
  return [...current, ...incoming.filter((item) => !seen.has(identity(item)) && Boolean(seen.add(identity(item))))];
}
