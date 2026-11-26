/** Apply browser-verified sourced photos without changing route, tasks or bookings. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SkillImageEnrichmentArtifact } from "../packages/agent-adapters/src/index.js";
import { compileTripBlueprint } from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { itinerarySemanticSnapshot, mergePlannedPlaceImageEnrichment, auditPlannedPlaceImageCoverage } from "../apps/server/src/planned-place-image-coverage.js";
const [artifactPath, expectedPlanId, reportPath] = process.argv.slice(2);
if (!artifactPath || !expectedPlanId || !reportPath) throw new Error("Usage: tsx scripts/apply-verified-place-images.ts <browser-verified-photo-artifact> <expected-draft> <report>");
const artifact = JSON.parse(await readFile(resolve(artifactPath), "utf8")) as SkillImageEnrichmentArtifact;
const store = new SqliteWorkspaceStore(resolve(process.env.C_ASSISTANT_DATA_PATH ?? "data/c-assistant.sqlite"));
try {
  const workspace = store.getWorkspace();
  const original = workspace.activeBlueprint;
  if (!original || workspace.activePlan.id !== expectedPlanId || workspace.activePlan.status !== "draft") throw new Error("Expected draft changed.");
  const research = store.getResearchSet(original.researchSetId)!;
  const merged = mergePlannedPlaceImageEnrichment(research, original, artifact, new Date().toISOString());
  if (JSON.stringify(itinerarySemanticSnapshot(merged.blueprint)) !== JSON.stringify(itinerarySemanticSnapshot(original))) throw new Error("Image changes affected itinerary.");
  if (merged.acceptedImageCount !== artifact.images.length) throw new Error("Some photos failed source/identity/URL validation.");
  const compilation = compileTripBlueprint(merged.blueprint, { createdAt: new Date().toISOString(), completedRequirementIds: workspace.activePlan.stages.flatMap((stage) => stage.tasks).filter((task) => task.status === "completed" && task.requirementId).map((task) => task.requirementId!) });
  compilation.plan.configuration = structuredClone(workspace.activePlan.configuration);
  store.saveResearchSetAndTripBlueprint(merged.research, merged.blueprint);
  const saved = store.createCompiledBlueprintPlan(compilation, "codex");
  store.updatePlanningSessionStatus(original.proposalRef.sessionId, "draft_ready", saved.activePlan.id);
  const coverage = auditPlannedPlaceImageCoverage(merged.blueprint, merged.research);
  const report = { previousPlanId: expectedPlanId, planId: saved.activePlan.id, blueprintVersion: merged.blueprint.version, added: merged.acceptedImageCount,
    coverage, missing: coverage.filter((row) => row.status === "image_missing").map((row) => row.place) };
  await writeFile(resolve(reportPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ planId: report.planId, added: report.added, missing: report.missing }));
} finally { store.close(); }
