import { compileTripBlueprint, assertTripBlueprintIntegrity } from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { materializeRecommendedAccommodationAnchors } from "../apps/server/src/accommodation-anchor-materialization.js";

const expectedPlanId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!expectedPlanId) throw new Error("Usage: tsx scripts/backfill-current-plan-accommodation.ts <current-draft-plan-id> [--apply]");

const store = new SqliteWorkspaceStore("data/c-assistant.sqlite");
try {
  const workspace = store.getWorkspace();
  if (workspace.activePlan.id !== expectedPlanId || workspace.activePlan.status !== "draft" || !workspace.activeBlueprint) throw new Error("The requested draft is no longer active.");
  const originalPlan = workspace.activePlan;
  const originalBlueprint = workspace.activeBlueprint;
  const result = materializeRecommendedAccommodationAnchors({ ...originalBlueprint, version: originalBlueprint.version + 1 });
  const updated = result.blueprint;
  const research = store.getResearchSet(originalBlueprint.researchSetId);
  if (!research) throw new Error("The current draft's Research Set is missing.");
  assertTripBlueprintIntegrity(updated, { expectedResearchPlaceIds: research.places.map((place) => place.id) });
  const completedRequirementIds = originalPlan.stages.flatMap((stage) => stage.tasks).filter((task) => task.status === "completed" && task.requirementId).map((task) => task.requirementId!);
  const compilation = compileTripBlueprint(updated, { createdAt: new Date().toISOString(), completedRequirementIds });
  compilation.plan.configuration = structuredClone(originalPlan.configuration);
  const days = updated.days.map((day) => ({ date: day.date, start: day.blocks?.[0]?.placeId, end: day.blocks?.at(-1)?.placeId, startContext: day.startContext?.label, endContext: day.endContext?.label }));
  if (apply) {
    const current = store.getWorkspace();
    if (current.activePlan.id !== originalPlan.id || current.activePlan.version !== originalPlan.version || current.activeBlueprint?.version !== originalBlueprint.version) throw new Error("The active draft changed; no accommodation changes were saved.");
    store.saveTripBlueprint(updated);
    store.createCompiledBlueprintPlan(compilation, "codex");
    store.updatePlanningSessionStatus(originalBlueprint.proposalRef.sessionId, "draft_ready", compilation.plan.id);
  }
  console.log(JSON.stringify({ applied: apply, previousPlanId: originalPlan.id, planId: apply ? compilation.plan.id : undefined, blueprintVersion: updated.version, days }));
} finally {
  store.close();
}
