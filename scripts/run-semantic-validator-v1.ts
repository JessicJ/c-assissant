import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { validateSemanticTravelPlan, type SemanticTravelPlan, type ValidationReport } from "../packages/agent-adapters/src/index.ts";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type ResearchSet, type TripBlueprint } from "../packages/core/src/index.ts";

const semanticPlanPath = resolve(process.env.SEMANTIC_PLAN_INPUT ?? "output/semantic-plan-v24.json");
const presentationPath = resolve(process.env.PRESENTATION_INPUT ?? "output/presentation-v2.json");
const reportJsonPath = resolve(process.env.VALIDATION_REPORT_JSON ?? "output/validation-report-v1.json");
const reportMarkdownPath = resolve(process.env.VALIDATION_REPORT_MD ?? "output/validation-report-v1.md");

const semanticPlan = JSON.parse(await readFile(semanticPlanPath, "utf8")) as SemanticTravelPlan;
const presentation = JSON.parse(await readFile(presentationPath, "utf8")) as { generatedAt?: string; researchSetId?: string; blueprint?: TripBlueprint };
if (!presentation.blueprint) throw new Error(`No blueprint found in ${presentationPath}`);

const research = researchFromBlueprint(presentation.blueprint, presentation.researchSetId);
const report = validateSemanticTravelPlan(semanticPlan, {
  research,
  ...(presentation.blueprint.bookingConstraints ? { bookingConstraints: presentation.blueprint.bookingConstraints } : {})
});

await mkdir(dirname(reportJsonPath), { recursive: true });
await writeFile(reportJsonPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  validator: {
    name: "Semantic Reality Validator",
    version: "v1.1",
    mode: "deterministic_read_only",
    inputs: {
      semanticPlanPath,
      presentationPath,
      researchSetId: research.id,
      blueprintId: presentation.blueprint.id,
      blueprintVersion: presentation.blueprint.version
    },
    guarantees: [
      "does not replan",
      "does not add experiences",
      "does not remove experiences",
      "does not reorder experiences",
      "does not write database state",
      "does not call production planning code"
    ]
  },
  report
}, null, 2)}\n`, "utf8");
await writeFile(reportMarkdownPath, markdownReport(report, semanticPlan, presentation.blueprint), "utf8");

console.log(JSON.stringify({
  ok: true,
  result: report.result,
  findings: report.findings.length,
  requiresPlannerRepair: report.findings.some((finding) => finding.requiresPlannerRepair),
  reportJsonPath,
  reportMarkdownPath
}, null, 2));

function researchFromBlueprint(blueprint: TripBlueprint, fallbackResearchSetId: string | undefined): ResearchSet {
  return {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: fallbackResearchSetId ?? blueprint.researchSetId,
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

function markdownReport(report: ValidationReport, plan: SemanticTravelPlan, blueprint: TripBlueprint): string {
  const repairCount = report.findings.filter((finding) => finding.requiresPlannerRepair).length;
  const lines = [
    "# Validation Report V1",
    "",
    `- Validator: Semantic Reality Validator v1.1`,
    `- Mode: deterministic read-only`,
    `- Plan: ${plan.title}`,
    `- Blueprint: ${blueprint.id} v${blueprint.version}`,
    `- Result: ${report.result}`,
    `- Findings: ${report.findings.length}`,
    `- Requires planner repair: ${repairCount > 0 ? "yes" : "no"}`,
    `- Ignored invalid facts: ${report.diagnostics?.ignoredInvalidFactCount ?? 0}`,
    "",
    "## Findings",
    ""
  ];
  if (!report.findings.length) {
    lines.push("No deterministic validation findings.");
  } else {
    for (const [index, finding] of report.findings.entries()) {
      lines.push(`${index + 1}. ${finding.category}${finding.requiresPlannerRepair ? " (planner repair)" : " (recheck only)"}`);
      lines.push(`   - Date: ${finding.date ?? "n/a"}`);
      lines.push(`   - Experience: ${finding.experience ?? "n/a"}`);
      lines.push(`   - Explanation: ${finding.explanation}`);
      if (finding.evidenceRefs?.length) lines.push(`   - Evidence: ${finding.evidenceRefs.join("; ")}`);
    }
  }
  lines.push("");
  lines.push("## Boundary");
  lines.push("");
  lines.push("- This validator did not replan, add, remove, or reorder experiences.");
  lines.push("- Route estimates imported from presentation/compiler context are not treated as hard conflicts.");
  lines.push("- Non-verified, stale, indeterminate, or weakly evidenced facts are surfaced as rechecks, not repair demands.");
  return `${lines.join("\n")}\n`;
}
