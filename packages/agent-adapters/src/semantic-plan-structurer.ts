import {
  importSkillItinerary,
  type BlueprintActionRequirement,
  type BlueprintItineraryBlock,
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
import type { SemanticOperationalCondition, SemanticTravelExperience, SemanticTravelPlan } from "./index.js";

export type FidelityClassification = "PRESERVED" | "REPRESENTED DIFFERENTLY" | "NOT REPRESENTABLE" | "CHANGED" | "DROPPED";

export interface FidelityItem {
  subject: string;
  classification: FidelityClassification;
  detail: string;
}

export interface StructurerDiagnostic {
  semanticPlan: SemanticTravelPlan;
  artifact: SkillItineraryArtifact;
  importedBlueprint?: TripBlueprint;
  fidelity: FidelityItem[];
  representationGaps: FidelityItem[];
}

interface StructureOptions {
  importBlueprint?: boolean;
  createdAt?: string;
  hardenContract?: boolean;
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
  const fidelity: FidelityItem[] = [];
  const days = semanticPlan.dailyItinerary.map((day, index) => structureDay(day, index, placeByName, fidelity));
  resolveReplacementBlockRefs(days);
  const artifact: SkillItineraryArtifact = {
    title: semanticPlan.title,
    summary: semanticPlan.tripStrategy,
    language: semanticPlan.language,
    destinations: ["Bali"],
    startDate: isoDateFromDay(semanticPlan.dailyItinerary[0]?.date) ?? "",
    endDate: isoDateFromDay(semanticPlan.dailyItinerary.at(-1)?.date) ?? "",
    guideTheme: {
      title: semanticPlan.title,
      narrative: semanticPlan.tripStrategy,
      visitorMode: "balanced-visitor",
      citySegments: [{
        id: "segment-bali",
        city: "Bali",
        title: "Bali",
        summary: "Accepted Planner V2.4 semantic strategy represented through the S1.2 itinerary contract.",
        dayIds: days.map((day) => day.id)
      }]
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
  addFidelityV2(semanticPlan, artifact, research, fidelity);
  const importedBlueprint = options.importBlueprint
    ? importSkillItinerary(research, artifact, {
      blueprintId: "diagnostic-blueprint-semantic-s1-v2",
      blueprintVersion: 1,
      createdAt: options.createdAt ?? new Date().toISOString()
    })
    : undefined;
  if (importedBlueprint) addBlueprintFidelity(semanticPlan, importedBlueprint, fidelity);
  const representationGaps = fidelity.filter((item) => item.classification === "NOT REPRESENTABLE");
  return { semanticPlan, artifact, ...(importedBlueprint ? { importedBlueprint } : {}), fidelity, representationGaps };
}

function structureDay(day: SemanticDay, index: number, placeByName: Map<string, string>, fidelity: FidelityItem[]): BlueprintItineraryDay {
  const stops: BlueprintItineraryDay["stops"] = [];
  const blocks: BlueprintItineraryBlock[] = [];
  for (const item of day.experiences ?? []) {
    const placeName = item.placeName ?? item.title;
    const placeId = placeByName.get(normalizeName(placeName));
    const blockIdValue = blockId(day.date, item.title);
    const hasResolvedPlace = Boolean(placeId);
    if (hasResolvedPlace && item.planRole !== "replacement") {
      stops.push({ placeId: placeId!, order: stops.length + 1, ...(item.startTime ? { time: item.startTime } : {}), role: item.planRole });
    }
    blocks.push({
      id: blockIdValue,
      kind: hasResolvedPlace && item.planRole !== "replacement" ? "stop" : "flexible",
      order: blocks.length + 1,
      ...(hasResolvedPlace && item.planRole !== "replacement" ? { placeId: placeId! } : {}),
      ...(item.startTime ? { startTime: item.startTime } : {}),
      title: item.title,
      summary: item.summary,
      ...(item.durationMinutes ? { durationMinutes: item.durationMinutes } : {}),
      role: item.planRole,
      planRole: item.planRole,
      ...(item.primaryExperience === undefined ? {} : { primaryExperience: item.primaryExperience }),
      ...(item.operationalConditions?.length ? { operationalConditions: item.operationalConditions.map(toBlueprintCondition) } : {}),
      ...(item.replacementFor ? { replacementFor: item.replacementFor } : {}),
      evidence: []
    });
    const identity = hasResolvedPlace ? `resolved to ${placeId}` : "preserved without ResearchSet place identity";
    fidelity.push({ subject: `${isoDateFromDay(day.date) ?? day.date}: ${item.title} existence`, classification: "PRESERVED", detail: identity });
  }
  return {
    id: `day-${index + 1}`,
    date: isoDateFromDay(day.date) ?? day.date,
    kind: stops.length ? "scheduled" : day.startContext.status === "in_transit" || day.endContext.status === "in_transit" ? "transit" : "free_time",
    city: "Bali",
    title: day.area,
    summary: day.plan,
    startContext: day.startContext,
    endContext: day.endContext,
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

function addFidelityV2(plan: SemanticTravelPlan, artifact: SkillItineraryArtifact, research: ResearchSet, fidelity: FidelityItem[]): void {
  const dayByDate = new Map(artifact.days.map((day) => [day.date, day] as const));
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
      const block = blocks.find((candidate) => candidate.title === item.title);
      if (!block) {
        fidelity.push({ subject: `${date}: ${item.title}`, classification: "DROPPED", detail: "Experience missing from structured itinerary." });
        continue;
      }
      if (block.order !== index + 1) fidelity.push({ subject: `${date}: ${item.title} order`, classification: "CHANGED", detail: `Expected ${index + 1}, got ${block.order}.` });
      else fidelity.push({ subject: `${date}: ${item.title} order`, classification: "PRESERVED", detail: `Order ${block.order}.` });
      compareScalar(`${date}: ${item.title} planRole`, item.planRole, block.planRole, fidelity);
      compareBoolean(`${date}: ${item.title} primaryExperience`, item.primaryExperience ?? false, block.primaryExperience ?? false, fidelity);
      compareConditions(`${date}: ${item.title} operationalConditions`, item.operationalConditions ?? [], block.operationalConditions ?? [], fidelity);
      compareScalar(`${date}: ${item.title} replacementFor`, item.replacementFor ?? "", block.replacementFor ?? "", fidelity);
      compareScalar(`${date}: ${item.title} timing`, item.startTime ?? "", block.startTime ?? "", fidelity);
      compareNumber(`${date}: ${item.title} duration`, item.durationMinutes, block.durationMinutes, fidelity);
      const expectedPlace = item.placeName ?? item.title;
      const resolvedPlaceId = new Map(research.places.map((place) => [normalizeName(place.name), place.id] as const)).get(normalizeName(expectedPlace));
      if (resolvedPlaceId) compareScalar(`${date}: ${item.title} place identity`, resolvedPlaceId, block.placeId, fidelity);
      else fidelity.push({ subject: `${date}: ${item.title} place identity`, classification: "REPRESENTED DIFFERENTLY", detail: "No ResearchSet place identity exists; preserved as semantic block without placeId." });
    }
  }
  compareSection("preparation section identity", plan.preparation.length, artifact.preparationChecklist?.length ?? 0, fidelity);
  compareSection("practical tips identity", plan.tips.length, artifact.travelTips?.length ?? 0, fidelity);
  const expectedAlternativeCount = plan.unresolvedExperiences.length + plan.dailyItinerary.flatMap((day) => day.experiences ?? []).filter((item) => item.planRole === "replacement").length;
  compareSection("alternatives/exclusions identity", expectedAlternativeCount, artifact.alternatives?.length ?? 0, fidelity);
  if ((artifact.sources?.length ?? 0) > 0) fidelity.push({ subject: "research/source grounding", classification: "REPRESENTED DIFFERENTLY", detail: `${artifact.sources?.length ?? 0} existing ResearchSet source(s) carried structurally; narrative supplemental URLs without source IDs remain researchGrounding text.` });
  else fidelity.push({ subject: "research/source grounding", classification: "NOT REPRESENTABLE", detail: "The accepted ResearchSet contains no structural sources to carry; S1.2 did not fabricate source identities from prose URLs." });
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
    for (let index = 0; index < day.stops.length - 1; index += 1) {
      movements.push({
        id: `movement-${day.id}-${index + 1}`,
        dayId: day.id,
        originPlaceId: day.stops[index]!.placeId,
        destinationPlaceId: day.stops[index + 1]!.placeId,
        mode: "unknown",
        status: "recheck",
        label: "Route needs recheck",
        detail: "Planner supplied semantic order only; do not treat this as verified route timing.",
        evidence: []
      });
    }
  }
  return movements;
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
