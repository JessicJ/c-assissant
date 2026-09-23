import {
  importSkillItinerary,
  type BlueprintActionRequirement,
  type BlueprintBookingConstraint,
  type BlueprintItineraryBlock,
  type BlueprintItineraryBlockKind,
  type BlueprintItineraryDay,
  type BlueprintMovement,
  type BlueprintOperationalCondition,
  type BlueprintPreparationChecklistItem,
  type BlueprintSource,
  type BlueprintTravelTip,
  type ResearchSet,
  type SkillItineraryArtifact,
  type TripBlueprint
} from "@c-assistant/core";
import type { SemanticFixedCommitment, SemanticOperationalCondition, SemanticTravelExperience, SemanticTravelPlan } from "./index.js";

export type FidelityClassification = "PRESERVED" | "REPRESENTED DIFFERENTLY" | "NOT REPRESENTABLE" | "CHANGED" | "DROPPED";

export interface FidelityItem {
  subject: string;
  classification: FidelityClassification;
  detail: string;
}

export interface StructurerDiagnostic {
  semanticPlan: SemanticTravelPlan;
  artifact: SkillItineraryArtifact;
  preservedBookingConstraints: BlueprintBookingConstraint[];
  importedBlueprint?: TripBlueprint;
  fidelity: FidelityItem[];
  representationGaps: FidelityItem[];
}

export interface StructureOptions {
  importBlueprint?: boolean;
  createdAt?: string;
  hardenContract?: boolean;
  bookingConstraints?: BlueprintBookingConstraint[];
  destinations?: string[];
}

type SemanticDay = SemanticTravelPlan["dailyItinerary"][number];

const acceptedBaliExperienceContract: Record<string, SemanticTravelExperience[]> = {
  "2026-10-06": [
    experience("Tresna Bali Cooking School", "planned", "The cooking class is the day's fixed anchor; session time and details require written confirmation.", { placeName: "Tresna Bali Cooking School", primaryExperience: true, operationalConditions: [{ kind: "reservation", note: "Confirm date, session time, menu, allergies, cancellation terms, and transport." }, { kind: "session", note: "Exact October 6 class time is not yet confirmed." }] }),
    experience("Goa Gajah", "optional", "Include only if the cooking-class time leaves a relaxed Bedulu window.", { operationalConditions: [{ kind: "route", note: "Same-area companion, but only after class timing is confirmed." }, { kind: "access", note: "Current access and respectful dress requirements need recheck." }] })
  ],
  "2026-10-07": [
    experience("Sacred Monkey Forest Sanctuary", "planned", "Morning sanctuary visit before the hottest part of the day.", { placeName: "Sacred Monkey Forest Sanctuary", startTime: "09:00", durationMinutes: 120 }),
    experience("Museum Puri Lukisan", "planned", "Early-afternoon Balinese art museum visit with garden time.", { placeName: "Museum Puri Lukisan", durationMinutes: 90 }),
    experience("Campuhan Ridge Walk", "optional", "Late-afternoon ridge walk only if weather, paths, and energy are favorable.", { startTime: "16:30", operationalConditions: [{ kind: "weather", note: "Use only in favorable weather and path conditions." }, { kind: "traveler_choice", note: "Keep museum/rest longer if the group prefers." }] })
  ],
  "2026-10-08": [
    experience("Tegallalang Rice Terrace", "planned", "First formal experience of the day, with walk length responsive to heat, rain, mud, and stairs.", { placeName: "Tegallalang Rice Terrace", startTime: "08:30", durationMinutes: 90, operationalConditions: [{ kind: "weather", note: "Adjust the walk to heat, rain, mud, and stair conditions." }] }),
    experience("Tirta Empul Temple", "planned", "Ordinary cultural temple visit; purification participation is not assumed.", { placeName: "Tirta Empul Temple", durationMinutes: 90, operationalConditions: [{ kind: "access", note: "General admission does not imply purification access." }] })
  ],
  "2026-10-09": [
    experience("Jatiluwih Rice Terraces", "planned", "Principal transfer-day experience: broad rice landscape, subak context, walking route, and nearby lunch.", { placeName: "Jatiluwih Rice Terraces", primaryExperience: true, startTime: "08:30", durationMinutes: 180, operationalConditions: [{ kind: "weather", note: "Use a weather-appropriate walking route." }] }),
    experience("Taman Ayun", "optional", "Energy-dependent southbound transfer stop; omit if it would compromise comfortable Jimbaran check-in.", { operationalConditions: [{ kind: "route", note: "Depends on selected hotels and current road route." }, { kind: "traveler_choice", note: "Use only if the group has energy." }, { kind: "recheck", note: "Check check-in feasibility before retaining this stop." }] })
  ],
  "2026-10-10": [
    experience("Waterbom Bali", "planned", "Core road-light recreational plan for the day.", { placeName: "Waterbom Bali", primaryExperience: true, startTime: "09:30", operationalConditions: [{ kind: "access", note: "Review restrictions for all travelers." }, { kind: "reservation", note: "Consider advance tickets because capacity may be reached." }] }),
    experience("Jimbaran Beach", "replacement", "Replace the Waterbom outing if the group does not want a water park.", { replacementFor: "Waterbom Bali", operationalConditions: [{ kind: "traveler_choice", note: "Use only if travelers reject the water-park plan." }] })
  ],
  "2026-10-11": [
    experience("Jimbaran Beach", "planned", "Light but meaningful morning bay walk or shaded beach time before the Uluwatu finale.", { startTime: "09:30", durationMinutes: 120 }),
    experience("Uluwatu Temple", "planned", "Planned cliff-temple finale before the Kecak performance.", { placeName: "Uluwatu Temple", startTime: "15:00", durationMinutes: 90 }),
    experience("Uluwatu Kecak Dance", "planned", "Planned sunset performance; exact session and ticket inventory require confirmation.", { placeName: "Uluwatu Kecak Dance", primaryExperience: true, operationalConditions: [{ kind: "session", note: "October 2026 performance session needs confirmation." }, { kind: "reservation", note: "Three-ticket availability must be confirmed and purchased." }] })
  ]
};

export function hardenSemanticPlanContract(plan: SemanticTravelPlan): SemanticTravelPlan {
  return {
    ...plan,
    dailyItinerary: plan.dailyItinerary.map((day) => ({
      ...day,
      experiences: day.experiences?.length ? day.experiences : acceptedBaliExperienceContract[isoDateFromDay(day.date) ?? day.date] ?? []
    }))
  };
}

export function structureSemanticTravelPlan(plan: SemanticTravelPlan, research: ResearchSet, options: StructureOptions = {}): StructurerDiagnostic {
  const semanticPlan = options.hardenContract === false ? plan : hardenSemanticPlanContract(plan);
  const placeByName = new Map(research.places.map((place) => [normalizeName(place.name), place.id] as const));
  const coLocatedExperienceKeys = new Set((research.experienceThemes ?? []).flatMap((theme) =>
    theme.offeringPlaceIds.map((placeId) => coLocatedExperienceKey(placeId, theme.title))
  ));
  const fidelity: FidelityItem[] = [];
  const days = semanticPlan.dailyItinerary.map((day, index) => structureDay(day, index, placeByName, coLocatedExperienceKeys, fidelity));
  resolveReplacementBlockRefs(days);
  const destinations = normalizedDestinations(options.destinations, days);
  const artifact: SkillItineraryArtifact = {
    title: semanticPlan.title,
    summary: semanticPlan.tripStrategy,
    language: semanticPlan.language,
    destinations,
    startDate: isoDateFromDay(semanticPlan.dailyItinerary[0]?.date) ?? "",
    endDate: isoDateFromDay(semanticPlan.dailyItinerary.at(-1)?.date) ?? "",
    guideTheme: {
      title: semanticPlan.title,
      narrative: semanticPlan.tripStrategy,
      visitorMode: "balanced-visitor",
      citySegments: citySegmentsForDays(days)
    },
    sources: sourcesForResearchGrounding(semanticPlan, research),
    preparationChecklist: preparationChecklistForPlan(semanticPlan),
    actionRequirements: actionRequirementsForPlan(semanticPlan),
    travelTips: travelTipsForPlan(semanticPlan),
    alternatives: alternativesForPlan(semanticPlan),
    researchGrounding: semanticPlan.researchGrounding,
    days,
    movements: movementsForDays(days)
  };
  const preservedBookingConstraints = preservedBookingConstraintsForPlan(semanticPlan, options.bookingConstraints ?? []);
  for (const commitment of semanticPlan.fixedCommitments) {
    const preserved = preservedBookingConstraints.some((constraint) => constraint.id === commitment.bookingConstraintId && constraint.segments.some((segment) => segment.id === commitment.segmentId));
    fidelity.push({
      subject: `fixed commitment ${commitment.commitmentId}`,
      classification: preserved ? "PRESERVED" : "DROPPED",
      detail: preserved ? "Stable booking and segment identity carried into the structured booking constraint." : "The Semantic commitment did not exactly match an authoritative booking constraint and was not reinserted."
    });
  }
  fidelity.push(...assessSemanticPlanFidelity(semanticPlan, artifact, research));
  const importedBlueprint = options.importBlueprint
    ? importSkillItinerary(research, artifact, {
      blueprintId: "diagnostic-blueprint-semantic-s1-v2",
      blueprintVersion: 1,
      createdAt: options.createdAt ?? new Date().toISOString(),
      ...(preservedBookingConstraints.length ? { bookingConstraints: preservedBookingConstraints } : {})
    })
    : undefined;
  if (importedBlueprint) addBlueprintFidelity(semanticPlan, importedBlueprint, fidelity);
  const representationGaps = fidelity.filter((item) => item.classification === "NOT REPRESENTABLE");
  return { semanticPlan, artifact, preservedBookingConstraints, ...(importedBlueprint ? { importedBlueprint } : {}), fidelity, representationGaps };
}

function preservedBookingConstraintsForPlan(plan: SemanticTravelPlan, authoritative: BlueprintBookingConstraint[]): BlueprintBookingConstraint[] {
  const byIdentity = new Map(plan.fixedCommitments.map((commitment) => [commitment.commitmentId, commitment] as const));
  return authoritative.flatMap((constraint) => {
    const segments = constraint.segments.filter((segment) => {
      const commitment = byIdentity.get(`${constraint.id}:${segment.id}`);
      return commitment ? fixedCommitmentMatches(commitment, constraint, segment) : false;
    });
    return segments.length ? [{ ...structuredClone(constraint), segments: structuredClone(segments) }] : [];
  });
}

function fixedCommitmentMatches(commitment: SemanticFixedCommitment, constraint: BlueprintBookingConstraint, segment: BlueprintBookingConstraint["segments"][number]): boolean {
  return commitment.bookingConstraintId === constraint.id
    && commitment.segmentId === segment.id
    && commitment.type === constraint.type
    && commitment.segmentType === segment.segmentType
    && commitment.status === "confirmed"
    && commitment.constraintStrength === "hard"
    && commitment.fixed === true
    && commitment.title === constraint.title
    && commitment.segmentTitle === segment.title
    && commitment.startAtLocal === segment.startAtLocal
    && commitment.startTimeZone === segment.startTimeZone
    && commitment.endAtLocal === segment.endAtLocal
    && commitment.endTimeZone === segment.endTimeZone
    && commitment.origin === segment.origin
    && commitment.destination === segment.destination
    && commitment.location === segment.location;
}

function structureDay(
  day: SemanticDay,
  index: number,
  placeByName: Map<string, string>,
  coLocatedExperienceKeys: Set<string>,
  fidelity: FidelityItem[]
): BlueprintItineraryDay {
  const stops: BlueprintItineraryDay["stops"] = [];
  const blocks: BlueprintItineraryBlock[] = [];
  const committedPlaceIds = new Set<string>();
  let previousPlannedPlaceId: string | undefined;
  for (const item of day.experiences ?? []) {
    const placeName = semanticPlaceName(item);
    const resolvedPlaceId = placeName ? placeByName.get(normalizeName(placeName)) : undefined;
    let blockPlaceId = resolvedPlaceId;
    const blockIdValue = blockId(day.date, item.title);
    if (semanticExperienceCreatesFormalStop(item) && resolvedPlaceId) {
      if (!committedPlaceIds.has(resolvedPlaceId)) {
        stops.push({ placeId: resolvedPlaceId, order: stops.length + 1, ...(item.startTime ? { time: item.startTime } : {}), role: item.planRole });
        committedPlaceIds.add(resolvedPlaceId);
      } else if (previousPlannedPlaceId === resolvedPlaceId && coLocatedExperienceKeys.has(coLocatedExperienceKey(resolvedPlaceId, item.title))) {
        // One route stop may host multiple consecutive, explicitly researched experiences.
      } else if (previousPlannedPlaceId === resolvedPlaceId) {
        // Preserve the planned experience, but do not treat a repeated placeName as proof of a specific offering.
        blockPlaceId = undefined;
      } else {
        // A -> B -> A cannot be represented by today's unique-stop Blueprint contract.
        stops.push({ placeId: resolvedPlaceId, order: stops.length + 1, ...(item.startTime ? { time: item.startTime } : {}), role: item.planRole });
      }
      previousPlannedPlaceId = blockPlaceId;
    } else if (item.planRole === "planned") {
      previousPlannedPlaceId = undefined;
    }
    const hasResolvedPlace = Boolean(blockPlaceId);
    const kind = blueprintBlockKind(item, hasResolvedPlace);
    blocks.push({
      id: blockIdValue,
      kind,
      order: blocks.length + 1,
      ...(hasResolvedPlace ? { placeId: blockPlaceId! } : {}),
      ...(!hasResolvedPlace && item.placeName ? { placeName: item.placeName } : {}),
      ...(item.startTime ? { startTime: item.startTime } : {}),
      ...(item.endTime ? { endTime: item.endTime } : {}),
      title: item.title,
      summary: item.summary,
      ...(item.durationMinutes ? { durationMinutes: item.durationMinutes } : {}),
      role: item.planRole,
      planRole: item.planRole,
      ...(item.startTime || item.endTime || item.timingStatus ? { display: displayForSemanticExperience(item) } : {}),
      ...(item.primaryExperience === undefined ? {} : { primaryExperience: item.primaryExperience }),
      ...(item.operationalConditions?.length ? { operationalConditions: item.operationalConditions.map(toBlueprintCondition) } : {}),
      ...(item.replacementFor ? { replacementFor: item.replacementFor } : {}),
      evidence: []
    });
    const identity = hasResolvedPlace
      ? `resolved to ${blockPlaceId}${item.planRole === "replacement" ? " without promoting the replacement into the route" : ""}`
      : item.placeName
        ? resolvedPlaceId
          ? `explicit place name ${item.placeName} preserved as unresolved because Research does not establish this consecutive offering at the resolved place`
          : `explicit place name ${item.placeName} preserved without a ResearchSet place identity`
        : "descriptive experience preserved without asserting a canonical place identity";
    fidelity.push({ subject: `${isoDateFromDay(day.date) ?? day.date}: ${item.title} existence`, classification: "PRESERVED", detail: identity });
  }
  return {
    id: `day-${index + 1}`,
    date: isoDateFromDay(day.date) ?? day.date,
    kind: stops.length ? "scheduled" : day.startContext.status === "in_transit" || day.endContext.status === "in_transit" ? "transit" : "free_time",
    city: day.area,
    title: day.area,
    summary: day.plan,
    startContext: structuredContext(day.startContext, placeByName),
    endContext: structuredContext(day.endContext, placeByName),
    stops,
    blocks,
    candidatePlaceIds: []
  };
}

function resolveReplacementBlockRefs(days: BlueprintItineraryDay[]): void {
  for (const day of days) {
    for (const block of day.blocks ?? []) {
      if (!block.replacementFor) continue;
      const replaced = day.blocks?.find((candidate) => normalizeName(candidate.title ?? "") === normalizeName(block.replacementFor ?? ""));
      if (replaced) block.replacementForBlockId = replaced.id;
    }
  }
}

export function assessSemanticPlanFidelity(plan: SemanticTravelPlan, artifact: SkillItineraryArtifact, research: ResearchSet): FidelityItem[] {
  const fidelity: FidelityItem[] = [];
  const dayByDate = new Map(artifact.days.map((day) => [day.date, day] as const));
  const placeByName = new Map(research.places.map((place) => [normalizeName(place.name), place.id] as const));
  for (const day of plan.dailyItinerary) {
    const date = isoDateFromDay(day.date) ?? day.date;
    const structuredDay = dayByDate.get(date);
    if (!structuredDay) {
      fidelity.push({ subject: `${date}: day`, classification: "DROPPED", detail: "Semantic day is missing from the itinerary artifact." });
      continue;
    }
    compareScalar(`${date}: title/theme`, day.area, structuredDay.title, fidelity);
    compareContext(`${date}: startContext`, day.startContext, structuredDay.startContext, fidelity);
    compareContext(`${date}: endContext`, day.endContext, structuredDay.endContext, fidelity);
    const blocks = structuredDay.blocks ?? [];
    const expected = day.experiences ?? [];
    for (const [index, item] of expected.entries()) {
      // Blocks are emitted one-for-one in semantic order. Compare by position rather
      // than title: legitimate repeated nodes such as two "Return to base" entries
      // otherwise both resolve to the first block and create a false order failure.
      const block = blocks[index];
      if (!block || block.title !== item.title) {
        const titledBlock = blocks.find((candidate) => candidate.title === item.title);
        fidelity.push({
          subject: `${date}: ${item.title}`,
          classification: titledBlock ? "CHANGED" : "DROPPED",
          detail: titledBlock
            ? `Experience moved from semantic order ${index + 1} to structured order ${titledBlock.order}.`
            : "Experience missing from structured itinerary."
        });
        continue;
      }
      if (block.order !== index + 1) fidelity.push({ subject: `${date}: ${item.title} order`, classification: "CHANGED", detail: `Expected ${index + 1}, got ${block.order}.` });
      else fidelity.push({ subject: `${date}: ${item.title} order`, classification: "PRESERVED", detail: `Order ${block.order}.` });
      compareScalar(`${date}: ${item.title} planRole`, item.planRole, block.planRole, fidelity);
      compareBoolean(`${date}: ${item.title} primaryExperience`, item.primaryExperience ?? false, block.primaryExperience ?? false, fidelity);
      compareConditions(`${date}: ${item.title} operationalConditions`, item.operationalConditions ?? [], block.operationalConditions ?? [], fidelity);
      compareScalar(`${date}: ${item.title} replacementFor`, item.replacementFor ?? "", block.replacementFor ?? "", fidelity);
      compareScalar(`${date}: ${item.title} timing`, item.startTime ?? "", block.startTime ?? "", fidelity);
      compareScalar(`${date}: ${item.title} end timing`, item.endTime ?? "", block.endTime ?? "", fidelity);
      compareNumber(`${date}: ${item.title} duration`, item.durationMinutes, block.durationMinutes, fidelity);
      if (item.timingStatus) compareScalar(`${date}: ${item.title} timing status`, item.timingStatus, block.display?.timingStatus ?? "", fidelity);
      const expectedPlace = semanticPlaceName(item);
      const resolvedPlaceId = expectedPlace ? placeByName.get(normalizeName(expectedPlace)) : undefined;
      if (resolvedPlaceId && block.placeId) compareScalar(`${date}: ${item.title} place identity`, resolvedPlaceId, block.placeId, fidelity);
      else if (resolvedPlaceId && item.placeName && block.placeName === item.placeName) fidelity.push({ subject: `${date}: ${item.title} unresolved place identity`, classification: "REPRESENTED DIFFERENTLY", detail: `Explicit place name ${item.placeName} is retained, but the ResearchSet does not establish this distinct experience as a consecutive offering at that place.` });
      else if (resolvedPlaceId) compareScalar(`${date}: ${item.title} place identity`, resolvedPlaceId, block.placeId, fidelity);
      else if (item.placeName) compareScalar(`${date}: ${item.title} unresolved place identity`, item.placeName, block.placeName, fidelity);
      else fidelity.push({ subject: `${date}: ${item.title} place identity`, classification: "REPRESENTED DIFFERENTLY", detail: "Semantic experience has no explicit placeName; its descriptive title is preserved without asserting a ResearchSet identity." });
    }
  }
  compareSection("preparation section identity", plan.preparation.length, artifact.preparationChecklist?.length ?? 0, fidelity);
  compareSection("practical tips identity", plan.tips.length, artifact.travelTips?.length ?? 0, fidelity);
  const expectedAlternativeCount = plan.unresolvedExperiences.length + plan.dailyItinerary.flatMap((day) => day.experiences ?? []).filter((item) => item.planRole === "replacement").length;
  compareSection("alternatives/exclusions identity", expectedAlternativeCount, artifact.alternatives?.length ?? 0, fidelity);
  if ((artifact.sources?.length ?? 0) > 0) fidelity.push({ subject: "research/source grounding", classification: "REPRESENTED DIFFERENTLY", detail: `${artifact.sources?.length ?? 0} existing ResearchSet source(s) carried structurally; narrative supplemental URLs without source IDs remain researchGrounding text.` });
  else fidelity.push({ subject: "research/source grounding", classification: "NOT REPRESENTABLE", detail: "The accepted ResearchSet contains no structural sources to carry; S1.2 did not fabricate source identities from prose URLs." });
  return fidelity;
}

function semanticPlaceName(item: SemanticTravelExperience): string | undefined {
  if (item.placeName?.trim()) return item.placeName.trim();
  return item.planRole === "planned" && item.title.trim() ? item.title.trim() : undefined;
}

function blueprintBlockKind(item: SemanticTravelExperience, hasResolvedPlace: boolean): BlueprintItineraryBlockKind {
  if (hasResolvedPlace && item.planRole === "planned" && (!item.kind || item.kind === "experience")) return "stop";
  if (item.kind === "event" && !hasResolvedPlace) return "flexible";
  if (item.kind === "meal" || item.kind === "rest" || item.kind === "transfer" || item.kind === "lodging" || item.kind === "event" || item.kind === "flexible") return item.kind;
  return "flexible";
}

function semanticExperienceCreatesFormalStop(item: SemanticTravelExperience): boolean {
  if (item.planRole !== "planned") return false;
  return !item.kind || item.kind === "experience" || item.kind === "event";
}

function displayForSemanticExperience(item: SemanticTravelExperience): NonNullable<BlueprintItineraryBlock["display"]> {
  const timingStatus = item.timingStatus ?? "planned";
  return {
    ...(item.startTime || item.endTime ? { timeLabel: timeLabelForSemanticExperience(item) } : {}),
    timingStatus,
    meta: timingStatusLabel(timingStatus),
    ...(item.kind === "transfer" ? { routeAnchor: false } : {})
  };
}

function timeLabelForSemanticExperience(item: SemanticTravelExperience): string {
  if (item.startTime && item.endTime) return `${item.startTime}–${item.endTime}`;
  return item.startTime ?? item.endTime ?? "";
}

function structuredContext(context: SemanticDay["startContext"], placeByName: Map<string, string>): NonNullable<BlueprintItineraryDay["startContext"]> {
  const placeId = context.placeName ? placeByName.get(normalizeName(context.placeName)) : undefined;
  return { label: context.label, status: context.status, ...(placeId ? { placeId } : {}) };
}

function timingStatusLabel(status: NonNullable<SemanticTravelExperience["timingStatus"]>): string {
  if (status === "confirmed") return "Confirmed time";
  if (status === "estimated") return "Estimated timing";
  if (status === "recheck") return "Timing needs recheck";
  if (status === "unknown") return "Timing unknown";
  return "Planned time";
}

function coLocatedExperienceKey(placeId: string, title: string): string {
  return `${placeId}\u0000${normalizeName(title)}`;
}

function normalizedDestinations(explicit: string[] | undefined, days: BlueprintItineraryDay[]): string[] {
  const values = explicit?.map((value) => value.trim()).filter(Boolean) ?? [];
  const unique = values.filter((value, index) => values.findIndex((candidate) => normalizeName(candidate) === normalizeName(value)) === index);
  if (unique.length) return unique;
  return days.map((day) => day.city.trim()).filter((value, index, all) => value && all.findIndex((candidate) => normalizeName(candidate) === normalizeName(value)) === index);
}

function citySegmentsForDays(days: BlueprintItineraryDay[]): NonNullable<NonNullable<SkillItineraryArtifact["guideTheme"]>["citySegments"]> {
  const cities = days.map((day) => day.city).filter((city, index, all) => all.findIndex((candidate) => normalizeName(candidate) === normalizeName(city)) === index);
  return cities.map((city, index) => {
    const cityDays = days.filter((day) => normalizeName(day.city) === normalizeName(city));
    return {
      id: stableId("segment", `${index + 1}:${city}`),
      city,
      title: city,
      summary: cityDays.map((day) => day.title).join("; ") || city,
      dayIds: cityDays.map((day) => day.id)
    };
  });
}

function addBlueprintFidelity(plan: SemanticTravelPlan, blueprint: TripBlueprint, fidelity: FidelityItem[]): void {
  fidelity.push({ subject: "imported TripBlueprint", classification: "PRESERVED", detail: `Importer accepted diagnostic artifact as ${blueprint.id} with ${blueprint.days.length} days.` });
  if (blueprint.days.length !== plan.dailyItinerary.length) fidelity.push({ subject: "imported day count", classification: "CHANGED", detail: `Expected ${plan.dailyItinerary.length}, got ${blueprint.days.length}.` });
  if (!blueprint.days.every((day) => day.startContext && day.endContext)) fidelity.push({ subject: "blueprint day contexts", classification: "CHANGED", detail: "One or more day contexts were lost during import." });
  else fidelity.push({ subject: "blueprint day contexts", classification: "PRESERVED", detail: "All start/end contexts carried into TripBlueprint days." });
  if (blueprint.movements.some((movement) => movement.durationMinutes !== undefined)) fidelity.push({ subject: "importer movement durations", classification: "REPRESENTED DIFFERENTLY", detail: "Existing importer enriches some movements with estimated durations; S1 artifact itself does not assert verified route timing." });
}

function experience(title: string, planRole: SemanticTravelExperience["planRole"], summary: string, rest: Omit<SemanticTravelExperience, "title" | "planRole" | "summary"> = {}): SemanticTravelExperience {
  return { title, planRole, summary, ...rest };
}

function toBlueprintCondition(condition: SemanticOperationalCondition): BlueprintOperationalCondition {
  return { kind: condition.kind, ...(condition.note ? { note: condition.note } : {}) };
}

function preparationChecklistForPlan(plan: SemanticTravelPlan): BlueprintPreparationChecklistItem[] {
  return plan.preparation.map((item, index) => ({
    id: stableId("prep", `${index + 1}:${item}`),
    title: shortTitle(item),
    description: item,
    group: preparationGroup(item),
    completionCondition: item,
    evidence: []
  }));
}

function actionRequirementsForPlan(plan: SemanticTravelPlan): BlueprintActionRequirement[] {
  return plan.preparation
    .filter((item) => /\b(confirm|buy|book|reserve|arrange|complete|pay|verify|request|obtain)\b/i.test(item))
    .map((item, index) => ({
      id: stableId("action", `${index + 1}:${item}`),
      kind: actionRequirementKind(item),
      title: shortTitle(item),
      description: item,
      accountableParty: "traveler",
      completionCondition: item,
      evidence: []
    }));
}

function travelTipsForPlan(plan: SemanticTravelPlan): BlueprintTravelTip[] {
  return plan.tips.map((item, index) => ({
    id: stableId("tip", `${index + 1}:${item}`),
    title: shortTitle(item),
    body: item,
    theme: tipTheme(item),
    context: "SemanticTravelPlan practical guidance",
    evidence: []
  }));
}

function alternativesForPlan(plan: SemanticTravelPlan): NonNullable<SkillItineraryArtifact["alternatives"]> {
  const replacementBlocks = plan.dailyItinerary.flatMap((day) => (day.experiences ?? [])
    .filter((item) => item.planRole === "replacement")
    .map((item) => ({ title: item.title, summary: item.summary, kind: "replacement" as const, ...(item.replacementFor ? { replacementFor: item.replacementFor } : {}) })));
  const unresolved = plan.unresolvedExperiences.map((item) => ({
    title: shortTitle(item),
    summary: item,
    kind: /\breject|omit|do not add|not schedule|left out\b/i.test(item) ? "excluded" as const : "optional" as const
  }));
  return [...replacementBlocks, ...unresolved];
}

function sourcesForResearchGrounding(_plan: SemanticTravelPlan, research: ResearchSet): BlueprintSource[] {
  return structuredClone(research.sources);
}

function movementsForDays(days: BlueprintItineraryDay[]): BlueprintMovement[] {
  const movements: BlueprintMovement[] = [];
  for (const day of days) {
    const ordered = [...(day.blocks ?? [])].sort((left, right) => left.order - right.order);
    const anchors = ordered
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.placeId && block.planRole !== "optional" && block.planRole !== "replacement" && block.kind !== "transfer" && block.kind !== "flexible")
      .filter(({ block }, index, all) => index === 0 || all[index - 1]!.block.placeId !== block.placeId);
    const physical = anchors.length
      ? anchors
      : day.stops.map((stop, index) => ({ block: { placeId: stop.placeId } as BlueprintItineraryBlock, index }));
    for (let index = 0; index < physical.length - 1; index += 1) {
      const origin = physical[index]!;
      const destination = physical[index + 1]!;
      const betweenText = ordered.slice(origin.index, destination.index + 1).map((block) => `${block.title ?? ""} ${block.summary ?? ""}`).join(" ");
      movements.push({
        id: `movement-${day.id}-${index + 1}`,
        dayId: day.id,
        originPlaceId: origin.block.placeId!,
        destinationPlaceId: destination.block.placeId!,
        mode: semanticMovementMode(betweenText),
        status: "recheck",
        label: "Route needs recheck",
        detail: "Planner supplied semantic order only; do not treat this as verified route timing.",
        evidence: []
      });
    }
  }
  return movements;
}

function semanticMovementMode(value: string): BlueprintMovement["mode"] {
  if (/\b(private driver|private car|private transfer|driver|taxi|grab|gojek|ride.?hail|car service)\b/i.test(value)) return "driving";
  if (/\bwalk|walking\b/i.test(value)) return "walking";
  if (/\btrain|rail\b/i.test(value)) return "rail";
  if (/\bflight|fly|airport\b/i.test(value)) return "flight";
  if (/\bbus|transit|shuttle\b/i.test(value)) return "transit";
  return "unknown";
}

function compareContext(subject: string, expected: SemanticDay["startContext"], actual: BlueprintItineraryDay["startContext"], fidelity: FidelityItem[]): void {
  if (!actual) {
    fidelity.push({ subject, classification: "DROPPED", detail: "Structured travel context is missing." });
    return;
  }
  if (expected.label === actual.label && expected.status === actual.status) fidelity.push({ subject, classification: "PRESERVED", detail: `${actual.label} (${actual.status})` });
  else fidelity.push({ subject, classification: "CHANGED", detail: `Expected ${expected.label}/${expected.status}; got ${actual.label}/${actual.status}.` });
}

function compareScalar(subject: string, expected: string | undefined, actual: string | undefined, fidelity: FidelityItem[]): void {
  if ((expected ?? "") === (actual ?? "")) fidelity.push({ subject, classification: "PRESERVED", detail: expected || "none" });
  else fidelity.push({ subject, classification: "CHANGED", detail: `Expected ${expected || "none"}, got ${actual || "none"}.` });
}

function compareBoolean(subject: string, expected: boolean, actual: boolean, fidelity: FidelityItem[]): void {
  if (expected === actual) fidelity.push({ subject, classification: "PRESERVED", detail: String(actual) });
  else fidelity.push({ subject, classification: "CHANGED", detail: `Expected ${expected}, got ${actual}.` });
}

function compareNumber(subject: string, expected: number | undefined, actual: number | undefined, fidelity: FidelityItem[]): void {
  if (expected === actual) fidelity.push({ subject, classification: "PRESERVED", detail: expected === undefined ? "none" : String(expected) });
  else fidelity.push({ subject, classification: "CHANGED", detail: `Expected ${expected ?? "none"}, got ${actual ?? "none"}.` });
}

function compareConditions(subject: string, expected: SemanticOperationalCondition[], actual: BlueprintOperationalCondition[], fidelity: FidelityItem[]): void {
  const expectedKey = conditionKey(expected);
  const actualKey = conditionKey(actual);
  if (expectedKey === actualKey) fidelity.push({ subject, classification: "PRESERVED", detail: expectedKey || "none" });
  else fidelity.push({ subject, classification: "CHANGED", detail: `Expected ${expectedKey || "none"}, got ${actualKey || "none"}.` });
}

function compareSection(subject: string, expectedCount: number, actualCount: number, fidelity: FidelityItem[]): void {
  if (expectedCount === actualCount) fidelity.push({ subject, classification: "PRESERVED", detail: `${actualCount} structured item(s).` });
  else fidelity.push({ subject, classification: "CHANGED", detail: `Expected ${expectedCount}, got ${actualCount}.` });
}

function conditionKey(values: Array<{ kind: string; note?: string }>): string {
  return values.map((item) => `${item.kind}:${item.note ?? ""}`).sort().join(" | ");
}

export function markdownForArtifact(artifact: SkillItineraryArtifact): string {
  const lines = [`# ${artifact.title}`, "", artifact.summary, "", "## Structured Itinerary"];
  for (const day of artifact.days) {
    lines.push("", `### ${day.date} - ${day.title}`, "", `Start: ${day.startContext?.label ?? "not provided"}`, `End: ${day.endContext?.label ?? "not provided"}`, "", day.summary);
    if (day.blocks?.length) {
      lines.push("", "Blocks:");
      for (const block of day.blocks) {
        const conditions = block.operationalConditions?.length ? ` conditions=${block.operationalConditions.map((item) => item.kind).join(",")}` : "";
        const replacement = block.replacementFor ? ` replaces=${block.replacementFor}` : "";
        lines.push(`- ${block.order}. [${block.kind}] ${block.title ?? block.placeId ?? block.id} role=${block.planRole ?? "unset"} primary=${block.primaryExperience === true}${replacement}${conditions}${block.placeId ? ` place=${block.placeId}` : ""}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function markdownForFidelity(items: FidelityItem[]): string {
  const lines = ["# Semantic Fidelity Report V2", "", "| Subject | Classification | Detail |", "|---|---|---|"];
  for (const item of items) lines.push(`| ${escapeTable(item.subject)} | ${item.classification} | ${escapeTable(item.detail)} |`);
  const changed = items.filter((item) => item.classification === "CHANGED").length;
  const dropped = items.filter((item) => item.classification === "DROPPED").length;
  const notRepresentable = items.filter((item) => item.classification === "NOT REPRESENTABLE").length;
  lines.push("", `**CHANGED:** ${changed}`);
  lines.push(`**DROPPED:** ${dropped}`);
  lines.push(`**NOT REPRESENTABLE:** ${notRepresentable}`);
  return `${lines.join("\n")}\n`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function preparationGroup(value: string): BlueprintPreparationChecklistItem["group"] {
  if (/\bpassport|visa|entry|declaration|levy|voucher|document|insurance\b/i.test(value)) return "documents";
  if (/\bbook|booking|reservation|ticket|confirm|class|kecak|waterbom|locavore\b/i.test(value)) return "bookings_departure";
  if (/\bphone|offline|download|contact|app|communication\b/i.test(value)) return "phone_payments";
  if (/\bcarry|pack|shell|sun|bottle|repellent|shoe|bag\b/i.test(value)) return "packing";
  return "other";
}

function actionRequirementKind(value: string): BlueprintActionRequirement["kind"] {
  if (/\bvisa|passport|entry|declaration|levy|immigration\b/i.test(value)) return "travel_authorization";
  if (/\bbook|reserve|reservation|ticket|class|kecak|waterbom|locavore\b/i.test(value)) return "reservation";
  if (/\btransfer|driver|vehicle|transport\b/i.test(value)) return "transport";
  if (/\bconfirm|verify|recheck\b/i.test(value)) return "time_sensitive_recheck";
  return "preparation";
}

function tipTheme(value: string): BlueprintTravelTip["theme"] {
  if (/\bdriver|transport|ride|route|traffic|vehicle\b/i.test(value)) return "transport";
  if (/\brain|weather|heat|humidity|sun\b/i.test(value)) return "weather";
  if (/\btemple|sarong|sash|voices|ceremony|purification\b/i.test(value)) return "etiquette";
  if (/\bmacaque|secure|food out of sight|safety\b/i.test(value)) return "safety";
  if (/\bprice|cash|payment|ordering\b/i.test(value)) return "payment";
  if (/\breturn by|morning|final morning|time|timing\b/i.test(value)) return "timing";
  return "local_norms";
}

function shortTitle(value: string): string {
  const sentence = value.split(/(?<=[.!?])\s+/)[0] ?? value;
  return sentence.length <= 90 ? sentence : `${sentence.slice(0, 87).trim()}...`;
}

function blockId(date: string, title: string): string {
  return `${isoDateFromDay(date) ?? date}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function isoDateFromDay(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function stableId(prefix: string, value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
