import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { compileTripBlueprint } from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { probeRemoteImageUrl, runPlannedPlaceImagePass } from "../apps/server/src/planned-place-image-pipeline.js";

const expectedPlanId = process.argv[2];
if (!expectedPlanId) throw new Error("Usage: tsx scripts/backfill-current-plan-images.ts <current-draft-plan-id>");

const store = new SqliteWorkspaceStore("data/c-assistant.sqlite");
try {
  const workspace = store.getWorkspace();
  if (workspace.activePlan.id !== expectedPlanId || workspace.activePlan.status !== "draft" || !workspace.activeBlueprint) throw new Error("The requested draft is no longer active.");
  const originalPlan = workspace.activePlan;
  const originalBlueprint = workspace.activeBlueprint;
  const research = store.getResearchSet(originalBlueprint.researchSetId);
  if (!research) throw new Error("The current draft's Research Set is missing.");
  const adapter = new CodexRuntimeAdapter();
  const request = `Find exact-place images for the current travel plan: ${originalPlan.title}. Destinations: ${originalBlueprint.destinations.join(", ")}. Dates: ${originalBlueprint.startDate} to ${originalBlueprint.endDate}.`;
  const result = await runPlannedPlaceImagePass({
    research,
    blueprint: originalBlueprint,
    probeImageUrl: probeRemoteImageUrl,
    search: (places, timeoutMs, rejectedImageUrls) => adapter.generatePlannedPlaceImageEnrichment({
      request: rejectedImageUrls.length ? `${request}\n\nThese image URLs did not return image content and must not be reused: ${rejectedImageUrls.join(", ")}` : request,
      scopeLabel: originalBlueprint.destinations.join(" / "),
      places,
      profile: workspace.profile,
      timeoutMs
    }),
    save: (updatedResearch, updatedBlueprint) => ({ research: updatedResearch, blueprint: updatedBlueprint }),
    onBatch: ({ requested, accepted, error }) => console.log(JSON.stringify({ requested, accepted, ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) }))
  });
  if (result.blueprint.version !== originalBlueprint.version) {
    const current = store.getWorkspace();
    if (current.activePlan.id !== originalPlan.id || current.activePlan.version !== originalPlan.version || current.activeBlueprint?.version !== originalBlueprint.version) throw new Error("The active draft changed during image research; no image changes were saved.");
    const saved = store.saveResearchSetAndTripBlueprint(result.research, result.blueprint);
    const completedRequirementIds = originalPlan.stages.flatMap((stage) => stage.tasks).filter((task) => task.status === "completed" && task.requirementId).map((task) => task.requirementId!);
    const compilation = compileTripBlueprint(saved.blueprint, { createdAt: new Date().toISOString(), completedRequirementIds });
    compilation.plan.configuration = structuredClone(originalPlan.configuration);
    store.createCompiledBlueprintPlan(compilation, "codex");
    store.updatePlanningSessionStatus(originalBlueprint.proposalRef.sessionId, "draft_ready", compilation.plan.id);
    console.log(JSON.stringify({ previousPlanId: originalPlan.id, planId: compilation.plan.id, blueprintVersion: saved.blueprint.version, acceptedImageCount: result.acceptedImageCount, remainingPlaceCount: result.remainingPlaceCount, failedBatchCount: result.failedBatchCount }));
  } else {
    console.log(JSON.stringify({ planId: originalPlan.id, acceptedImageCount: 0, remainingPlaceCount: result.remainingPlaceCount, failedBatchCount: result.failedBatchCount }));
  }
} finally {
  store.close();
}
