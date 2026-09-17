import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { validateSemanticTravelPlan, type SemanticTravelExperience, type SemanticTravelPlan, type ValidationReport } from "../packages/agent-adapters/src/index.ts";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintEvidenceRef, type BlueprintPlace, type ResearchSet, type TripBlueprint } from "../packages/core/src/index.ts";

interface PresentationEnvelope {
  researchSetId?: string;
  blueprint?: TripBlueprint;
}

interface ValidationEnvelope {
  report?: ValidationReport;
}

interface CoverageExperience {
  date: string;
  title: string;
  planRole: SemanticTravelExperience["planRole"];
  placeName?: string;
  identityKey: string;
  hasStablePlaceId: boolean;
  matchMethod: "exact_normalized_name" | "none";
  matchedPlaceId?: string;
  matchedPlaceName?: string;
  hasOperationalConditions: boolean;
  operationalConditionKinds: string[];
  hasOperationalFacts: boolean;
  hasEvidenceBackedOperationalFacts: boolean;
  hasStrongVerifiedOperationalEvidence: boolean;
  skippedReason?: string;
}

interface CoverageDiagnostics {
  semanticInput: {
    path: string;
    sourceType: string;
    totalDays: number;
    generatedBeforeStructuredExperienceContract: boolean;
  };
  researchContext: {
    source: "sqlite_research_set" | "blueprint_research_projection";
    id: string;
    placeCount: number;
    sourceCount: number;
    semanticExperienceStablePlaceIdsAvailable: boolean;
    identityMatching: string;
  };
  totals: {
    experiencesSeen: number;
    plannedExperiencesSeen: number;
    optionalExperiencesSeen: number;
    replacementExperiencesSeen: number;
    experiencesMatchedToResearchSetPlaces: number;
    experiencesWithOperationalFacts: number;
    experiencesWithValidEvidenceBackedOperationalFacts: number;
    experiencesWithNoOperationalEvidence: number;
    experiencesSkipped: number;
  };
  requiredExperienceCoverage: Array<{ date: string; title: string; role: string; present: boolean }>;
  experiences: CoverageExperience[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const semanticPlanPath = resolve(process.env.SEMANTIC_PLAN_INPUT ?? `${repoRoot}/output/semantic-plan-v24-contract-v2.json`);
const presentationPath = resolve(process.env.PRESENTATION_INPUT ?? `${repoRoot}/output/presentation-v2.json`);
const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? `${repoRoot}/data/c-assistant.sqlite`);
const oldReportPath = resolve(process.env.OLD_VALIDATION_REPORT_JSON ?? `${repoRoot}/output/validation-report-v1.json`);
const reportJsonPath = resolve(process.env.VALIDATION_REPORT_JSON ?? `${repoRoot}/output/validation-report-v1a.json`);
const reportMarkdownPath = resolve(process.env.VALIDATION_REPORT_MD ?? `${repoRoot}/output/validation-report-v1a.md`);

const semanticPlan = JSON.parse(await readFile(semanticPlanPath, "utf8")) as SemanticTravelPlan;
const presentation = JSON.parse(await readFile(presentationPath, "utf8")) as PresentationEnvelope;
if (!presentation.blueprint) throw new Error(`No blueprint found in ${presentationPath}; needed only to identify the ResearchSet context.`);

const researchResult = loadResearchSet(presentation.researchSetId ?? presentation.blueprint.researchSetId, presentation.blueprint);
const coverage = coverageDiagnostics(semanticPlan, researchResult.research, semanticPlanPath, researchResult.source);
const report = validateSemanticTravelPlan(semanticPlan, { research: researchResult.research, ...(presentation.blueprint.bookingConstraints ? { bookingConstraints: presentation.blueprint.bookingConstraints } : {}) });
const oldReport = existsSync(oldReportPath) ? (JSON.parse(await readFile(oldReportPath, "utf8")) as ValidationEnvelope).report : undefined;

const envelope = {
  generatedAt: new Date().toISOString(),
  validator: {
    name: "Semantic Reality Validator",
    version: "v1.1A",
    mode: "deterministic_read_only",
    inputs: {
      semanticPlanPath,
      presentationPath,
      databasePath,
      researchSetId: researchResult.research.id,
      researchContextSource: researchResult.source,
      oldReportPath
    },
    guarantees: [
      "does not replan",
      "does not add experiences",
      "does not remove experiences",
      "does not reorder experiences",
      "does not parse prose to recover experiences",
      "does not write database state",
      "does not call production planning code"
    ]
  },
  audit: {
    semanticPlanV24HadStructuredExperiences: false,
    chosenInputReason: "output/semantic-plan-v24-contract-v2.json is the deterministic S1.2 contract-hardened SemanticTravelPlan fixture derived from the accepted V2.4 decisions; it contains structured dailyItinerary[].experiences[] without parsing prose at validation time.",
    currentPlannerContractRequiresExperiences: true,
    semanticExperienceStablePlaceIdsAvailable: false
  },
  coverage,
  report,
  comparisonWithV1: oldReport ? {
    oldResult: oldReport.result,
    oldFindingCount: oldReport.findings.length,
    oldRepairFindingCount: oldReport.findings.filter((finding) => finding.requiresPlannerRepair).length,
    newResult: report.result,
    newFindingCount: report.findings.length,
    newRepairFindingCount: report.findings.filter((finding) => finding.requiresPlannerRepair).length,
    deltaFindingCount: report.findings.length - oldReport.findings.length
  } : undefined
};

await mkdir(dirname(reportJsonPath), { recursive: true });
await writeFile(reportJsonPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
await writeFile(reportMarkdownPath, markdownReport(envelope), "utf8");

console.log(JSON.stringify({
  ok: true,
  result: report.result,
  findings: report.findings.length,
  requiresPlannerRepair: report.findings.some((finding) => finding.requiresPlannerRepair),
  experiencesSeen: coverage.totals.experiencesSeen,
  matchedPlaces: coverage.totals.experiencesMatchedToResearchSetPlaces,
  reportJsonPath,
  reportMarkdownPath
}, null, 2));

function loadResearchSet(researchSetId: string, blueprint: TripBlueprint): { research: ResearchSet; source: CoverageDiagnostics["researchContext"]["source"] } {
  if (existsSync(databasePath)) {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db.prepare("SELECT content_json FROM research_sets WHERE json_extract(content_json, '$.id') = ? LIMIT 1").get(researchSetId) as { content_json: string } | undefined;
      if (row) return { research: JSON.parse(row.content_json) as ResearchSet, source: "sqlite_research_set" };
    } finally {
      db.close();
    }
  }
  return { research: researchFromBlueprint(blueprint, researchSetId), source: "blueprint_research_projection" };
}

function researchFromBlueprint(blueprint: TripBlueprint, researchSetId: string): ResearchSet {
  return {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: researchSetId,
    generationKey: blueprint.generationKey,
    proposalRef: blueprint.proposalRef,
    skillLineage: blueprint.skillLineage,
    status: "completed",
    batches: [],
    places: blueprint.places,
    events: blueprint.events,
    sources: blueprint.sources,
    actionRequirements: blueprint.actionRequirements,
    createdAt: blueprint.createdAt,
    updatedAt: blueprint.createdAt,
    completedAt: blueprint.createdAt,
    ...(blueprint.localFoods ? { localFoods: blueprint.localFoods } : {}),
    ...(blueprint.localProducts ? { localProducts: blueprint.localProducts } : {}),
    ...(blueprint.experienceThemes ? { experienceThemes: blueprint.experienceThemes } : {}),
    ...(blueprint.travelTips ? { travelTips: blueprint.travelTips } : {}),
    ...(blueprint.preparationChecklist ? { preparationChecklist: blueprint.preparationChecklist } : {}),
    ...(blueprint.guideRelationshipGraph?.relationships ? { guideRelationships: blueprint.guideRelationshipGraph.relationships } : {})
  };
}

function coverageDiagnostics(plan: SemanticTravelPlan, research: ResearchSet, inputPath: string, researchSource: CoverageDiagnostics["researchContext"]["source"]): CoverageDiagnostics {
  const sourceIds = new Set(research.sources.map((source) => source.id));
  const placeByName = new Map(research.places.map((place) => [normalizeName(place.name), place] as const));
  const experiences: CoverageExperience[] = [];
  for (const day of plan.dailyItinerary) {
    const date = isoDateFromDay(day.date) ?? day.date;
    for (const experience of day.experiences ?? []) {
      const identityKey = experience.placeName ?? experience.title;
      const matchedPlace = placeByName.get(normalizeName(identityKey));
      const operationalEvidence = matchedPlace ? operationalEvidenceSummary(matchedPlace, sourceIds) : { hasFacts: false, hasEvidenceBackedFacts: false, hasStrongVerifiedEvidence: false };
      const skippedReason = skipReason(matchedPlace, operationalEvidence);
      experiences.push(cleanCoverageExperience({
        date,
        title: experience.title,
        planRole: experience.planRole,
        placeName: experience.placeName,
        identityKey,
        hasStablePlaceId: false,
        matchMethod: matchedPlace ? "exact_normalized_name" : "none",
        matchedPlaceId: matchedPlace?.id,
        matchedPlaceName: matchedPlace?.name,
        hasOperationalConditions: Boolean(experience.operationalConditions?.length),
        operationalConditionKinds: [...new Set((experience.operationalConditions ?? []).map((condition) => condition.kind))],
        hasOperationalFacts: operationalEvidence.hasFacts,
        hasEvidenceBackedOperationalFacts: operationalEvidence.hasEvidenceBackedFacts,
        hasStrongVerifiedOperationalEvidence: operationalEvidence.hasStrongVerifiedEvidence,
        skippedReason
      }));
    }
  }
  return {
    semanticInput: {
      path: inputPath,
      sourceType: "deterministic S1.2 contract-hardened SemanticTravelPlan fixture",
      totalDays: plan.dailyItinerary.length,
      generatedBeforeStructuredExperienceContract: false
    },
    researchContext: {
      source: researchSource,
      id: research.id,
      placeCount: research.places.length,
      sourceCount: research.sources.length,
      semanticExperienceStablePlaceIdsAvailable: false,
      identityMatching: "SemanticTravelExperience currently has no stable placeId. Diagnostics use conservative exact normalized matching on placeName, falling back to title."
    },
    totals: {
      experiencesSeen: experiences.length,
      plannedExperiencesSeen: experiences.filter((item) => item.planRole === "planned").length,
      optionalExperiencesSeen: experiences.filter((item) => item.planRole === "optional").length,
      replacementExperiencesSeen: experiences.filter((item) => item.planRole === "replacement").length,
      experiencesMatchedToResearchSetPlaces: experiences.filter((item) => item.matchedPlaceId).length,
      experiencesWithOperationalFacts: experiences.filter((item) => item.hasOperationalFacts).length,
      experiencesWithValidEvidenceBackedOperationalFacts: experiences.filter((item) => item.hasEvidenceBackedOperationalFacts).length,
      experiencesWithNoOperationalEvidence: experiences.filter((item) => !item.hasEvidenceBackedOperationalFacts).length,
      experiencesSkipped: experiences.filter((item) => item.skippedReason).length
    },
    requiredExperienceCoverage: requiredCoverage(experiences),
    experiences
  };
}

function operationalEvidenceSummary(place: BlueprintPlace, sourceIds: Set<string>): { hasFacts: boolean; hasEvidenceBackedFacts: boolean; hasStrongVerifiedEvidence: boolean } {
  const refs = operationalEvidenceRefs(place);
  return {
    hasFacts: Boolean(place.operationalFacts),
    hasEvidenceBackedFacts: refs.some((ref) => sourceIds.has(ref.sourceId) && (ref.supports?.some((support) => support.trim()) ?? false)),
    hasStrongVerifiedEvidence: refs.some((ref) => ref.status === "verified" && sourceIds.has(ref.sourceId) && (ref.supports?.some((support) => support.trim()) ?? false))
  };
}

function operationalEvidenceRefs(place: BlueprintPlace): BlueprintEvidenceRef[] {
  const facts = place.operationalFacts;
  if (!facts) return [];
  return [
    ...(facts.access?.windows ?? []).flatMap((fact) => fact.evidence),
    ...(facts.access?.closed ?? []).flatMap((fact) => fact.evidence),
    ...(facts.access?.lastEntry?.evidence ?? []),
    ...(facts.sessions ?? []).flatMap((fact) => fact.evidence),
    ...(facts.entry?.reservation?.evidence ?? []),
    ...(facts.entry?.ticket?.evidence ?? []),
    ...(facts.entry?.booking?.evidence ?? []),
    ...(facts.entry?.capacity?.evidence ?? [])
  ];
}

function skipReason(matchedPlace: BlueprintPlace | undefined, evidence: { hasFacts: boolean; hasEvidenceBackedFacts: boolean }): string | undefined {
  if (!matchedPlace) return "no ResearchSet place matched by exact normalized placeName/title";
  if (!evidence.hasFacts) return "matched place has no operationalFacts";
  if (!evidence.hasEvidenceBackedFacts) return "operationalFacts have no valid evidence-backed refs";
  return undefined;
}

function requiredCoverage(experiences: CoverageExperience[]): CoverageDiagnostics["requiredExperienceCoverage"] {
  const required = [
    { date: "2026-10-06", title: "Tresna Bali Cooking School", role: "planned" },
    { date: "2026-10-06", title: "Goa Gajah", role: "optional" },
    { date: "2026-10-08", title: "Tegallalang Rice Terrace", role: "planned" },
    { date: "2026-10-08", title: "Tirta Empul Temple", role: "planned" },
    { date: "2026-10-09", title: "Jatiluwih Rice Terraces", role: "planned" },
    { date: "2026-10-09", title: "Taman Ayun", role: "optional" },
    { date: "2026-10-10", title: "Waterbom Bali", role: "planned" },
    { date: "2026-10-10", title: "Jimbaran Beach", role: "replacement" },
    { date: "2026-10-11", title: "Jimbaran Beach", role: "planned" },
    { date: "2026-10-11", title: "Uluwatu Temple", role: "planned" },
    { date: "2026-10-11", title: "Uluwatu Kecak Dance", role: "planned" }
  ];
  return required.map((item) => ({
    ...item,
    present: experiences.some((experience) => experience.date === item.date && experience.title === item.title && experience.planRole === item.role)
  }));
}

function cleanCoverageExperience(input: CoverageExperience): CoverageExperience {
  return {
    date: input.date,
    title: input.title,
    planRole: input.planRole,
    ...(input.placeName ? { placeName: input.placeName } : {}),
    identityKey: input.identityKey,
    hasStablePlaceId: input.hasStablePlaceId,
    matchMethod: input.matchMethod,
    ...(input.matchedPlaceId ? { matchedPlaceId: input.matchedPlaceId } : {}),
    ...(input.matchedPlaceName ? { matchedPlaceName: input.matchedPlaceName } : {}),
    hasOperationalConditions: input.hasOperationalConditions,
    operationalConditionKinds: input.operationalConditionKinds,
    hasOperationalFacts: input.hasOperationalFacts,
    hasEvidenceBackedOperationalFacts: input.hasEvidenceBackedOperationalFacts,
    hasStrongVerifiedOperationalEvidence: input.hasStrongVerifiedOperationalEvidence,
    ...(input.skippedReason ? { skippedReason: input.skippedReason } : {})
  };
}

function markdownReport(envelope: {
  validator: { inputs: { semanticPlanPath: string; researchContextSource: string } };
  coverage: CoverageDiagnostics;
  report: ValidationReport;
  comparisonWithV1?: { oldResult: string; oldFindingCount: number; oldRepairFindingCount: number; newResult: string; newFindingCount: number; newRepairFindingCount: number; deltaFindingCount: number };
}): string {
  const report = envelope.report;
  const coverage = envelope.coverage;
  const lines = [
    "# Validation Report V1A",
    "",
    `- Validator: Semantic Reality Validator v1.1A`,
    `- Mode: deterministic read-only`,
    `- Semantic input: ${envelope.validator.inputs.semanticPlanPath}`,
    `- Research context: ${envelope.validator.inputs.researchContextSource}`,
    `- Result: ${report.result}`,
    `- Findings: ${report.findings.length}`,
    `- Requires planner repair: ${report.findings.some((finding) => finding.requiresPlannerRepair) ? "yes" : "no"}`,
    "",
    "## Coverage",
    "",
    `- Experiences seen: ${coverage.totals.experiencesSeen}`,
    `- Planned / optional / replacement: ${coverage.totals.plannedExperiencesSeen} / ${coverage.totals.optionalExperiencesSeen} / ${coverage.totals.replacementExperiencesSeen}`,
    `- Matched to ResearchSet places: ${coverage.totals.experiencesMatchedToResearchSetPlaces}`,
    `- With operationalFacts: ${coverage.totals.experiencesWithOperationalFacts}`,
    `- With evidence-backed operationalFacts: ${coverage.totals.experiencesWithValidEvidenceBackedOperationalFacts}`,
    `- With no operational evidence: ${coverage.totals.experiencesWithNoOperationalEvidence}`,
    "",
    "## Required Experiences",
    ""
  ];
  for (const item of coverage.requiredExperienceCoverage) lines.push(`- ${item.date} ${item.title} (${item.role}): ${item.present ? "present" : "missing"}`);
  lines.push("", "## Findings", "");
  if (!report.findings.length) lines.push("No deterministic validation findings.");
  for (const [index, finding] of report.findings.entries()) {
    lines.push(`${index + 1}. ${finding.category}${finding.requiresPlannerRepair ? " (planner repair)" : " (recheck only)"}`);
    lines.push(`   - Date: ${finding.date ?? "n/a"}`);
    lines.push(`   - Experience: ${finding.experience ?? "n/a"}`);
    lines.push(`   - Explanation: ${finding.explanation}`);
  }
  lines.push("", "## Skipped / No Evidence", "");
  for (const item of coverage.experiences.filter((experience) => experience.skippedReason)) {
    lines.push(`- ${item.date} ${item.title}: ${item.skippedReason}`);
  }
  if (envelope.comparisonWithV1) {
    lines.push("", "## Comparison With V1", "");
    lines.push(`- Old result/count/repair: ${envelope.comparisonWithV1.oldResult} / ${envelope.comparisonWithV1.oldFindingCount} / ${envelope.comparisonWithV1.oldRepairFindingCount}`);
    lines.push(`- New result/count/repair: ${envelope.comparisonWithV1.newResult} / ${envelope.comparisonWithV1.newFindingCount} / ${envelope.comparisonWithV1.newRepairFindingCount}`);
    lines.push(`- Finding delta: ${envelope.comparisonWithV1.deltaFindingCount}`);
  }
  lines.push("", "## Boundary", "");
  lines.push("- This diagnostic did not parse prose to recover experiences.");
  lines.push("- This diagnostic did not validate TripBlueprint as the canonical plan input.");
  lines.push("- This diagnostic did not replan, add, remove, or reorder experiences.");
  return `${lines.join("\n")}\n`;
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isoDateFromDay(value: string): string | undefined {
  return value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
}
