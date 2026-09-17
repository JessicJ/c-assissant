import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  CodexRuntimeAdapter,
  runSemanticPlanRepairOnce,
  type SemanticPlanRepairRequest,
  type SemanticPlanRepairResult,
  type SemanticTravelPlan,
  type SemanticValidationContext
} from "../packages/agent-adapters/src/index.ts";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintBookingConstraint, type BlueprintPlace, type ResearchSet, type TripBlueprint } from "../packages/core/src/index.ts";

interface PresentationEnvelope {
  researchSetId?: string;
  blueprint?: TripBlueprint;
}

interface AuditCase {
  name: string;
  modelCallCount: number;
  finalPrompt?: string;
  modelInvocationPath: string;
  result: SemanticPlanRepairResult;
  driftClassifications: Array<{ date: string; classification: "JUSTIFIED_BY_CONFLICT" | "SUSPICIOUS_UNRELATED_DRIFT"; reason: string }>;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baliPlanPath = resolve(process.env.SEMANTIC_PLAN_INPUT ?? `${repoRoot}/output/semantic-plan-v24-contract-v2.json`);
const presentationPath = resolve(process.env.PRESENTATION_INPUT ?? `${repoRoot}/output/presentation-v2.json`);
const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? `${repoRoot}/data/c-assistant.sqlite`);
const reportJsonPath = resolve(process.env.REPAIR_AI_AUDIT_JSON ?? `${repoRoot}/output/repair-ai-audit-v1.json`);
const reportMarkdownPath = resolve(process.env.REPAIR_AI_AUDIT_MD ?? `${repoRoot}/output/repair-ai-audit-v1.md`);
const checkedAt = "2026-09-14T00:00:00.000Z";
const modelInvocationPath = "CodexRuntimeAdapter.generateSemanticTravelPlanRepair -> codex exec --output-schema semanticTravelPlanSchema -> parseSemanticTravelPlan";

const baliPlan = JSON.parse(await readFile(baliPlanPath, "utf8")) as SemanticTravelPlan;
const presentation = JSON.parse(await readFile(presentationPath, "utf8")) as PresentationEnvelope;
if (!presentation.blueprint) throw new Error(`No blueprint found in ${presentationPath}; needed only to locate research context.`);
const research = loadResearchSet(presentation.researchSetId ?? presentation.blueprint.researchSetId, presentation.blueprint).research;
const adapter = new CodexRuntimeAdapter();

const acceptedBali = await runAuditCase("accepted_bali_no_repair", baliPlan, { research }, async () => {
  throw new Error("Model must not be called for accepted Bali no-repair case.");
});

const closureContext: SemanticValidationContext = { research: withDateClosure(research, "Waterbom Bali", "2026-10-10") };
const closure = await runAuditCase("accepted_bali_with_confirmed_waterbom_closure", baliPlan, closureContext, async (request) => {
  const result = await adapter.generateSemanticTravelPlanRepair({ prompt: request.prompt });
  return result.plan;
});

const timingContext: SemanticValidationContext = {
  research: withVerifiedSession(research, "Uluwatu Kecak Dance", "2026-10-11", "18:00", "19:00"),
  bookingConstraints: [hardCommitment("2026-10-11T18:30", "Confirmed immovable evening commitment")]
};
const timing = await runAuditCase("accepted_bali_with_confirmed_kecak_timing_conflict", baliPlan, timingContext, async (request) => {
  const result = await adapter.generateSemanticTravelPlanRepair({ prompt: request.prompt });
  return result.plan;
});

const uncertainty = await runAuditCase("accepted_bali_uncertainty_only", baliPlan, { research }, async () => {
  throw new Error("Model must not be called for uncertainty-only case.");
});

const optionalContext: SemanticValidationContext = { research: withDateClosure(research, "Jimbaran Beach", "2026-10-10") };
const optionalPlan = ensureReplacementJimbaranHasPlaceName(baliPlan);
const optional = await runAuditCase("accepted_bali_optional_replacement_unavailable", optionalPlan, optionalContext, async () => {
  throw new Error("Model must not be called for optional/replacement unavailable case.");
});

const cases = [acceptedBali, closure, timing, uncertainty, optional];
const envelope = {
  generatedAt: new Date().toISOString(),
  diagnostic: {
    name: "Semantic Planner Real AI Repair Audit V1",
    mode: "diagnostic_only",
    maximumRepairAttempts: 1,
    productionWiring: false,
    modelInvocationPath
  },
  cases,
  acceptance: {
    realAiInvokedForRepairCases: closure.modelCallCount === 1 && timing.modelCallCount === 1,
    noAiInvokedForNonRepairCases: acceptedBali.modelCallCount === 0 && uncertainty.modelCallCount === 0 && optional.modelCallCount === 0,
    noRepairRetries: cases.every((item) => item.modelCallCount <= 1),
    noPostRepairRepairRequired: [closure, timing].every((item) => !(item.result.repairedReport?.findings.some((finding) => finding.requiresPlannerRepair) ?? true)),
    suspiciousUnrelatedDrift: cases.flatMap((item) => item.driftClassifications.filter((classification) => classification.classification === "SUSPICIOUS_UNRELATED_DRIFT").map((classification) => ({ case: item.name, ...classification })))
  }
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
    originalResult: item.result.originalReport.result,
    repairedResult: item.result.repairedReport?.result,
    modelCallCount: item.modelCallCount,
    repairFindings: item.result.repairFindings.length,
    suspiciousDrift: item.driftClassifications.filter((classification) => classification.classification === "SUSPICIOUS_UNRELATED_DRIFT").length
  }))
}, null, 2));

async function runAuditCase(name: string, plan: SemanticTravelPlan, validationContext: SemanticValidationContext, repairer: (request: SemanticPlanRepairRequest) => Promise<SemanticTravelPlan>): Promise<AuditCase> {
  let modelCallCount = 0;
  let finalPrompt: string | undefined;
  const result = await runSemanticPlanRepairOnce({
    plan,
    validationContext,
    planningContext: [
      "Accepted Bali diagnostic context.",
      "The model is editing an existing accepted SemanticTravelPlan, not creating a new trip.",
      "Confirmed hard commitments and validator repair findings must be preserved as facts.",
      "Resolve only the supplied repair-required conflict and preserve unaffected Bali decisions."
    ].join("\n"),
    repairer: async (request) => {
      modelCallCount += 1;
      finalPrompt = request.prompt;
      return repairer(request);
    }
  });
  return {
    name,
    modelCallCount,
    ...(finalPrompt ? { finalPrompt } : {}),
    modelInvocationPath,
    result,
    driftClassifications: classifyDrift(result)
  };
}

function classifyDrift(result: SemanticPlanRepairResult): AuditCase["driftClassifications"] {
  const repairDates = new Set(result.repairFindings.map((finding) => finding.date).filter((date): date is string => Boolean(date)));
  const repairExperiences = new Set(result.repairFindings.map((finding) => finding.experience).filter((experience): experience is string => Boolean(experience)));
  for (const moved of result.decisionDiff?.experiencesMoved ?? []) {
    if (repairExperiences.has(moved.title)) {
      repairDates.add(moved.fromDate);
      repairDates.add(moved.toDate);
    }
  }
  return (result.decisionDiff?.daysChanged ?? []).map((date) => repairDates.has(date)
    ? { date, classification: "JUSTIFIED_BY_CONFLICT", reason: "Date contains the repair-required finding or the moved conflicted experience." }
    : { date, classification: "SUSPICIOUS_UNRELATED_DRIFT", reason: "Date changed without being directly tied to a repair-required finding." });
}

function withDateClosure(research: ResearchSet, placeName: string, date: string): ResearchSet {
  return {
    ...research,
    places: research.places.map((place) => normalizeName(place.name) === normalizeName(placeName)
      ? {
        ...place,
        operationalFacts: {
          ...(place.operationalFacts ?? {}),
          access: {
            ...(place.operationalFacts?.access ?? {}),
            closed: [
              ...(place.operationalFacts?.access?.closed ?? []),
              { pattern: "Diagnostic verified date-specific closure", status: "verified" as const, appliesTo: { date }, evidence: [{ sourceId: "diagnostic-official", status: "verified" as const, checkedAt, supports: [`${placeName} is officially closed on ${date}.`] }] }
            ]
          }
        }
      }
      : place),
    sources: [...research.sources, { id: "diagnostic-official", title: "Diagnostic official closure notice", authority: "Official diagnostic source", url: "https://official.example/closure", retrievedAt: checkedAt, status: "verified", official: true }]
  };
}

function withVerifiedSession(research: ResearchSet, placeName: string, date: string, startsAt: string, endsAt: string): ResearchSet {
  return {
    ...research,
    places: research.places.map((place) => normalizeName(place.name) === normalizeName(placeName)
      ? {
        ...place,
        operationalFacts: {
          ...(place.operationalFacts ?? {}),
          sessions: [
            ...(place.operationalFacts?.sessions ?? []),
            { status: "verified" as const, appliesTo: { date }, evidence: [{ sourceId: "diagnostic-official-session", status: "verified" as const, checkedAt, supports: [`${placeName} session runs ${startsAt}-${endsAt} on ${date}.`] }], startsAt, endsAt }
          ]
        }
      }
      : place),
    sources: [...research.sources, { id: "diagnostic-official-session", title: "Diagnostic official session notice", authority: "Official diagnostic source", url: "https://official.example/session", retrievedAt: checkedAt, status: "verified", official: true }]
  };
}

function ensureReplacementJimbaranHasPlaceName(plan: SemanticTravelPlan): SemanticTravelPlan {
  return {
    ...plan,
    dailyItinerary: plan.dailyItinerary.map((day) => ({
      ...day,
      experiences: (day.experiences ?? []).map((experience) => experience.title === "Jimbaran Beach" && experience.planRole === "replacement"
        ? { ...experience, placeName: "Jimbaran Beach" }
        : experience)
    }))
  };
}

function hardCommitment(startAtLocal: string, title: string): BlueprintBookingConstraint {
  return {
    id: "diagnostic-hard-commitment",
    type: "event",
    title,
    status: "confirmed",
    sourceLabel: "Diagnostic confirmed booking",
    importedAt: checkedAt,
    constraintStrength: "hard",
    segments: [{
      id: "diagnostic-hard-commitment-segment",
      segmentType: "event_window",
      title,
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

function markdownReport(envelope: { diagnostic: { modelInvocationPath: string }; cases: AuditCase[]; acceptance: { realAiInvokedForRepairCases: boolean; noAiInvokedForNonRepairCases: boolean; noRepairRetries: boolean; noPostRepairRepairRequired: boolean; suspiciousUnrelatedDrift: unknown[] } }): string {
  const lines = [
    "# Repair AI Audit V1",
    "",
    `- Mode: diagnostic only`,
    `- Actual model invocation path: ${envelope.diagnostic.modelInvocationPath}`,
    `- Real AI invoked for repair cases: ${envelope.acceptance.realAiInvokedForRepairCases ? "yes" : "no"}`,
    `- No AI invoked for non-repair cases: ${envelope.acceptance.noAiInvokedForNonRepairCases ? "yes" : "no"}`,
    `- No repair retries: ${envelope.acceptance.noRepairRetries ? "yes" : "no"}`,
    `- No post-repair repair-required findings: ${envelope.acceptance.noPostRepairRepairRequired ? "yes" : "no"}`,
    `- Suspicious unrelated drift count: ${envelope.acceptance.suspiciousUnrelatedDrift.length}`,
    ""
  ];
  for (const item of envelope.cases) {
    lines.push(`## ${item.name}`);
    lines.push("");
    lines.push(`- Status: ${item.result.status}`);
    lines.push(`- Original Validator result: ${item.result.originalReport.result}`);
    lines.push(`- Repaired Validator result: ${item.result.repairedReport?.result ?? "n/a"}`);
    lines.push(`- Actual model call count: ${item.modelCallCount}`);
    lines.push(`- Repair findings supplied: ${item.result.repairFindings.length}`);
    lines.push(`- Changed dates: ${item.result.decisionDiff?.daysChanged.join(", ") || "none"}`);
    lines.push(`- Added experiences: ${item.result.decisionDiff?.experiencesAdded.map((experience) => `${experience.date}:${experience.title}`).join(", ") || "none"}`);
    lines.push(`- Removed experiences: ${item.result.decisionDiff?.experiencesRemoved.map((experience) => `${experience.date}:${experience.title}`).join(", ") || "none"}`);
    lines.push(`- Moved experiences: ${item.result.decisionDiff?.experiencesMoved.map((experience) => `${experience.title} ${experience.fromDate}->${experience.toDate}`).join(", ") || "none"}`);
    lines.push(`- PlanRole changes: ${item.result.decisionDiff?.planRoleChanges.map((change) => `${change.date}:${change.title} ${change.from}->${change.to}`).join(", ") || "none"}`);
    lines.push(`- Start/end changes: ${item.result.decisionDiff?.startEndContextChanges.length ?? 0}`);
    lines.push(`- Base strategy changed: ${item.result.decisionDiff?.baseStrategyChanged ? "yes" : "no"}`);
    lines.push(`- Drift classification: ${item.driftClassifications.map((classification) => `${classification.date}:${classification.classification}`).join(", ") || "none"}`);
    lines.push("");
  }
  lines.push("## Boundary", "");
  lines.push("- No production path was modified.");
  lines.push("- No Web, Telegram, Execution, or Structurer behavior was modified.");
  lines.push("- No retry loop was added.");
  return `${lines.join("\n")}\n`;
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
