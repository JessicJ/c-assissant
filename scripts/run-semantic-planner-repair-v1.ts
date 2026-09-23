import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  runSemanticPlanRepairOnce,
  semanticExperience,
  type SemanticPlanRepairRequest,
  type SemanticPlanRepairResult,
  type SemanticTravelPlan,
  type SemanticValidationContext
} from "../packages/agent-adapters/src/index.ts";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintBookingConstraint, type BlueprintEvidenceRef, type BlueprintPlace, type ResearchSet, type TripBlueprint } from "../packages/core/src/index.ts";

interface PresentationEnvelope {
  researchSetId?: string;
  blueprint?: TripBlueprint;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baliPlanPath = resolve(process.env.SEMANTIC_PLAN_INPUT ?? `${repoRoot}/output/semantic-plan-v24-contract-v2.json`);
const presentationPath = resolve(process.env.PRESENTATION_INPUT ?? `${repoRoot}/output/presentation-v2.json`);
const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? `${repoRoot}/data/c-assistant.sqlite`);
const reportJsonPath = resolve(process.env.REPAIR_REPORT_JSON ?? `${repoRoot}/output/repair-report-v1.json`);
const reportMarkdownPath = resolve(process.env.REPAIR_REPORT_MD ?? `${repoRoot}/output/repair-report-v1.md`);

const checkedAt = "2026-09-14T00:00:00.000Z";
const verifiedEvidence: BlueprintEvidenceRef[] = [{ sourceId: "official", status: "verified", checkedAt, supports: ["Diagnostic official evidence."] }];

const baliPlan = JSON.parse(await readFile(baliPlanPath, "utf8")) as SemanticTravelPlan;
const presentation = JSON.parse(await readFile(presentationPath, "utf8")) as PresentationEnvelope;
if (!presentation.blueprint) throw new Error(`No blueprint found in ${presentationPath}; needed only to locate research context.`);
const baliContext = { research: loadResearchSet(presentation.researchSetId ?? presentation.blueprint.researchSetId, presentation.blueprint).research };

const noRepair = await runCase("accepted_bali_no_repair", baliPlan, baliContext, () => {
  throw new Error("Planner must not be called for accepted Bali no-repair case.");
});

const closureOriginal = fixturePlan("Fixture Museum", "Fixture Museum");
const closureContext = { research: fixtureResearch([fixturePlace({ operationalFacts: closureFacts() }), fixturePlace({ id: "open-gallery", name: "Open Gallery" })]) };
const closure = await runCase("synthetic_date_specific_closure", closureOriginal, closureContext, scriptedRepairer("Open Gallery", "Open Gallery"));

const timingOriginal = fixturePlan("Evening Performance", "Evening Performance");
const timingContext = {
  research: fixtureResearch([fixturePlace({ id: "evening-performance", name: "Evening Performance", operationalFacts: sessionFacts() })]),
  bookingConstraints: [fixedCommitment("2026-10-06T18:30")]
};
const timing = await runCase("synthetic_fixed_timing_conflict", timingOriginal, timingContext, moveExperienceRepairer("2026-10-07"));

const uncertainty = await runCase("synthetic_non_repair_uncertainty", fixturePlan("Fixture Museum", "Fixture Museum", { hotelPending: true }), {
  research: fixtureResearch([fixturePlace({
    operationalFacts: { entry: { ticket: { requirement: "required", status: "verified", evidence: verifiedEvidence } } }
  })])
}, () => {
  throw new Error("Planner must not be called for non-repair uncertainty.");
});

const optionalConflict = await runCase("synthetic_optional_conflict", fixturePlan("Fixture Museum", "Fixture Museum", { planRole: "optional" }), closureContext, () => {
  throw new Error("Planner must not be called for optional conflicts.");
});

const cases = [noRepair, closure, timing, uncertainty, optionalConflict];
const envelope = {
  generatedAt: new Date().toISOString(),
  diagnostic: {
    name: "Semantic Planner Repair V1",
    mode: "diagnostic_only",
    maximumRepairAttempts: 1,
    productionWiring: false,
    plannerImplementation: "deterministic diagnostic repairer used for orchestration acceptance; production Planner repair is not connected"
  },
  cases
};

await mkdir(dirname(reportJsonPath), { recursive: true });
await writeFile(reportJsonPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
await writeFile(reportMarkdownPath, markdownReport(envelope), "utf8");

console.log(JSON.stringify({
  ok: true,
  reportJsonPath,
  reportMarkdownPath,
  cases: cases.map((item) => ({
    name: item.name,
    status: item.result.status,
    plannerCallCount: item.plannerCallCount,
    originalResult: item.result.originalReport.result,
    repairedResult: item.result.repairedReport?.result,
    repairFindings: item.result.repairFindings.length,
    unrelatedDaysChanged: unrelatedDaysChanged(item.result)
  }))
}, null, 2));

async function runCase(name: string, plan: SemanticTravelPlan, validationContext: SemanticValidationContext, repairer: (request: SemanticPlanRepairRequest) => SemanticTravelPlan | Promise<SemanticTravelPlan>) {
  let plannerCallCount = 0;
  const result = await runSemanticPlanRepairOnce({
    plan,
    validationContext,
    planningContext: "Diagnostic synthetic repair context. Preserve unaffected days, fixed commitments, base strategy, trip pace, and accepted experience semantics.",
    repairer: (request) => {
      plannerCallCount += 1;
      return repairer(request);
    }
  });
  return {
    name,
    plannerCallCount,
    repairFindingsPassedToPlanner: result.repairFindings,
    result,
    unrelatedDaysChanged: unrelatedDaysChanged(result)
  };
}

function scriptedRepairer(title: string, placeName: string) {
  return (request: SemanticPlanRepairRequest): SemanticTravelPlan => ({
    ...request.originalPlan,
    dailyItinerary: request.originalPlan.dailyItinerary.map((day) => day.date === "2026-10-06"
      ? {
        ...day,
        plan: "Use the same day structure, replacing only the closed experience with a same-day open diagnostic experience.",
        experiences: [semanticExperience(title, "planned", "Diagnostic repaired replacement for the confirmed closed experience.", { placeName })]
      }
      : day),
    markdown: repairMarkdown("The confirmed closure was repaired by changing only the affected October 6 experience.")
  });
}

function moveExperienceRepairer(targetDate: string) {
  return (request: SemanticPlanRepairRequest): SemanticTravelPlan => ({
    ...request.originalPlan,
    dailyItinerary: request.originalPlan.dailyItinerary.map((day) => {
      if (day.date === "2026-10-06") return { ...day, experiences: [] };
      if (day.date === targetDate) return { ...day, experiences: [semanticExperience("Evening Performance", "planned", "Moved away from the confirmed fixed commitment.", { placeName: "Evening Performance" })] };
      return day;
    }),
    markdown: repairMarkdown("The confirmed timing conflict was repaired by moving only the affected performance away from the fixed commitment.")
  });
}

function fixturePlan(title: string, placeName: string, options: { hotelPending?: boolean; planRole?: "planned" | "optional" | "replacement" } = {}): SemanticTravelPlan {
  return {
    title: "One-shot repair diagnostic fixture",
    language: "en",
    tripStrategy: "Preserve a two-day compact base strategy and make only the smallest coherent change when a confirmed conflict requires repair.",
    fixedCommitments: [],
    targetedResearch: [],
    dailyItinerary: [
      {
        date: "2026-10-06",
        area: "Fixture district",
        startContext: { label: "Fixture base", status: options.hotelPending ? "planned_base_pending_property" : "confirmed_property" },
        endContext: { label: "Fixture base", status: options.hotelPending ? "planned_base_pending_property" : "confirmed_property" },
        plan: "Use the fixture base and keep one planned experience on the affected day.",
        experiences: [semanticExperience(title, options.planRole ?? "planned", "Diagnostic experience for one-shot repair.", { placeName })]
      },
      {
        date: "2026-10-07",
        area: "Unaffected district",
        startContext: { label: "Fixture base", status: "confirmed_property" },
        endContext: { label: "Fixture base", status: "confirmed_property" },
        plan: "Keep this day available for minimal coherent repair when necessary.",
        experiences: []
      }
    ],
    unresolvedExperiences: [],
    preparation: ["Protect confirmed hard commitments."],
    tips: ["Preserve unaffected days."],
    researchGrounding: ["Diagnostic fixture source."],
    followUpChecks: [],
    markdown: repairMarkdown("Original diagnostic plan with enough readable content for the existing SemanticTravelPlan parser.")
  };
}

function repairMarkdown(detail: string): string {
  return `# One-shot repair diagnostic

${detail}

This diagnostic plan exists to exercise one-shot SemanticTravelPlan repair orchestration. It is intentionally long enough to satisfy the existing parser while keeping the travel decisions simple: a compact base, one affected day, one unaffected day, and no hidden production wiring. The important acceptance question is not prose quality, but whether the repair machinery calls the Planner only when the validator reports a repair-required finding, sends only those repair findings, revalidates once, and flags travel-decision drift for review.

The surrounding trip should remain stable unless a confirmed conflict directly requires a coherent change.`;
}

function fixtureResearch(places: BlueprintPlace[]): ResearchSet {
  return {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "research-repair-diagnostic",
    generationKey: "repair-diagnostic",
    proposalRef: { sessionId: "session-repair-diagnostic", proposalVersion: 1 },
    skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" },
    status: "completed",
    batches: [],
    places,
    events: [],
    sources: [{ id: "official", title: "Official diagnostic source", authority: "Official", url: "https://official.example/diagnostic", retrievedAt: checkedAt, status: "verified", official: true }],
    actionRequirements: [],
    createdAt: checkedAt,
    updatedAt: checkedAt,
    completedAt: checkedAt
  };
}

function fixturePlace(overrides: Partial<BlueprintPlace> = {}): BlueprintPlace {
  return {
    id: "fixture-museum",
    name: "Fixture Museum",
    locationLabel: "Fixture district",
    category: "museum",
    priority: "must",
    whyWorthIt: "A deterministic diagnostic place.",
    plan: "Use for repair diagnostics.",
    evidence: verifiedEvidence,
    ...overrides
  };
}

function closureFacts(): NonNullable<BlueprintPlace["operationalFacts"]> {
  return { access: { closed: [{ pattern: "Closed for maintenance", status: "verified", appliesTo: { date: "2026-10-06" }, evidence: verifiedEvidence }] } };
}

function sessionFacts(): NonNullable<BlueprintPlace["operationalFacts"]> {
  return { sessions: [{ status: "verified", appliesTo: { weekdays: ["tuesday", "wednesday"] }, evidence: verifiedEvidence, startsAt: "18:00", endsAt: "19:00" }] };
}

function fixedCommitment(startAtLocal: string): BlueprintBookingConstraint {
  return {
    id: "fixed-flight",
    type: "flight",
    title: "Confirmed fixed departure",
    status: "confirmed",
    sourceLabel: "Diagnostic booking",
    importedAt: checkedAt,
    constraintStrength: "hard",
    segments: [{
      id: "fixed-flight-segment",
      segmentType: "flight_leg",
      title: "Confirmed fixed departure segment",
      startAtLocal,
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}

function loadResearchSet(researchSetId: string, blueprint: TripBlueprint): { research: ResearchSet; source: "sqlite_research_set" | "blueprint_research_projection" } {
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
    completedAt: blueprint.createdAt
  };
}

function unrelatedDaysChanged(result: SemanticPlanRepairResult): string[] {
  const repairDates = new Set(result.repairFindings.map((finding) => finding.date).filter((date): date is string => Boolean(date)));
  const repairExperienceTitles = new Set(result.repairFindings.map((finding) => finding.experience).filter((title): title is string => Boolean(title)));
  for (const moved of result.decisionDiff?.experiencesMoved ?? []) {
    if (repairExperienceTitles.has(moved.title)) {
      repairDates.add(moved.fromDate);
      repairDates.add(moved.toDate);
    }
  }
  return result.decisionDiff?.daysChanged.filter((date) => !repairDates.has(date)) ?? [];
}

function markdownReport(envelope: { diagnostic: { plannerImplementation: string }; cases: Array<{ name: string; plannerCallCount: number; repairFindingsPassedToPlanner: unknown[]; result: SemanticPlanRepairResult; unrelatedDaysChanged: string[] }> }): string {
  const lines = [
    "# Repair Report V1",
    "",
    `- Mode: diagnostic only`,
    `- Planner implementation: ${envelope.diagnostic.plannerImplementation}`,
    `- Maximum repair attempts: 1`,
    ""
  ];
  for (const item of envelope.cases) {
    lines.push(`## ${item.name}`);
    lines.push("");
    lines.push(`- Status: ${item.result.status}`);
    lines.push(`- Original result: ${item.result.originalReport.result}`);
    lines.push(`- Planner invoked: ${item.result.plannerInvoked ? "yes" : "no"}`);
    lines.push(`- Planner call count: ${item.plannerCallCount}`);
    lines.push(`- Repair findings passed: ${item.repairFindingsPassedToPlanner.length}`);
    lines.push(`- Repaired result: ${item.result.repairedReport?.result ?? "n/a"}`);
    lines.push(`- Unrelated days changed: ${item.unrelatedDaysChanged.length ? item.unrelatedDaysChanged.join(", ") : "none"}`);
    lines.push(`- Days changed: ${item.result.decisionDiff?.daysChanged.join(", ") || "none"}`);
    lines.push("");
  }
  lines.push("## Boundary", "");
  lines.push("- No production planning-generation path was modified.");
  lines.push("- No Web, Telegram, Execution, or Structurer behavior was modified.");
  lines.push("- This script does not persist to the database.");
  return `${lines.join("\n")}\n`;
}
