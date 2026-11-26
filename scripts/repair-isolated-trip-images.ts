/** Image acceptance in an isolated workspace. Restore sourced photos incorrectly rejected by old probes. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { assertResearchSetIntegrity, assertTripBlueprintIntegrity, compileTripBlueprint, type WorkspaceSnapshot } from "../packages/core/src/index.js";
import { probeRemoteImageUrl, runPlannedPlaceImagePass } from "../apps/server/src/planned-place-image-pipeline.js";
import { searchWikipediaPlaceImages } from "../apps/server/src/wikipedia-place-images.js";
import { auditPlannedPlaceImageCoverage, itinerarySemanticSnapshot } from "../apps/server/src/planned-place-image-coverage.js";

const [databasePath, expectedPlanId, originalSnapshotPath, reportPath] = process.argv.slice(2);
if (!databasePath || !expectedPlanId || !originalSnapshotPath || !reportPath || !resolve(databasePath).startsWith("/private/tmp/")) throw new Error("Usage: tsx scripts/repair-isolated-trip-images.ts <isolated-db> <draft-id> <original-snapshot> <report>");
const original = JSON.parse(await readFile(resolve(originalSnapshotPath), "utf8")) as WorkspaceSnapshot;
const store = new SqliteWorkspaceStore(resolve(databasePath));
try {
  const workspace = store.getWorkspace();
  if (workspace.activePlan.id !== expectedPlanId || !workspace.activeBlueprint || workspace.activePlan.status !== "draft") throw new Error("The isolated draft changed.");
  const blueprint = structuredClone(workspace.activeBlueprint);
  const research = structuredClone(store.getResearchSet(blueprint.researchSetId)!);
  const before = JSON.stringify(itinerarySemanticSnapshot(blueprint));
  let restored = 0;
  const urls = [...new Set(original.activeBlueprint!.places.flatMap((place) => place.images?.map((image) => image.url) ?? []))];
  const verdict = new Map<string, boolean | undefined>();
  for (let index = 0; index < urls.length; index += 8) await Promise.all(urls.slice(index, index + 8).map(async (url) => verdict.set(url, await probeRemoteImageUrl(url))));
  for (const oldPlace of original.activeBlueprint!.places) {
    const valid = oldPlace.images?.filter((image) => verdict.get(image.url) !== false) ?? [];
    if (!valid.length) continue;
    for (const collection of [research.places, blueprint.places]) {
      const place = collection.find((candidate) => candidate.id === oldPlace.id);
      if (!place || place.images?.length) continue;
      place.images = structuredClone(valid);
      for (const image of valid) {
        const source = original.activeBlueprint!.sources.find((candidate) => candidate.id === image.sourceId);
        if (!source) throw new Error("Cannot restore an unsourced image.");
        for (const sources of [research.sources, blueprint.sources]) if (!sources.some((candidate) => candidate.id === source.id)) sources.push(structuredClone(source));
      }
      if (collection === blueprint.places) restored += 1;
    }
  }
  blueprint.version += 1;
  assertResearchSetIntegrity(research);
  assertTripBlueprintIntegrity(blueprint);
  const adapter = new CodexRuntimeAdapter();
  const result = await runPlannedPlaceImagePass({ research, blueprint, probeImageUrl: probeRemoteImageUrl,
    lookupKnownImages: (places) => searchWikipediaPlaceImages(places),
    search: (places, timeoutMs, rejectedImageUrls) => adapter.generatePlannedPlaceImageEnrichment({
      request: `Find exact, sourced real photographs for ${blueprint.title}. Use the official place website or exact Wikipedia/Commons identity. Direct image URLs only. Do not reuse these confirmed unsuitable URLs: ${rejectedImageUrls.join(", ")}`,
      scopeLabel: blueprint.destinations.join(" / "), places, profile: workspace.profile, timeoutMs }),
    save: (updatedResearch, updatedBlueprint) => ({ research: updatedResearch, blueprint: updatedBlueprint }),
    onBatch: (batch) => console.log(JSON.stringify({ requested: batch.requested, accepted: batch.accepted, error: batch.error ? String(batch.error) : undefined })) });
  if (JSON.stringify(itinerarySemanticSnapshot(result.blueprint)) !== before) throw new Error("Images changed itinerary content.");
  store.saveResearchSetAndTripBlueprint(result.research, result.blueprint);
  const compilation = compileTripBlueprint(result.blueprint, { createdAt: new Date().toISOString(), completedRequirementIds: workspace.activePlan.stages.flatMap((stage) => stage.tasks).filter((task) => task.status === "completed" && task.requirementId).map((task) => task.requirementId!) });
  compilation.plan.configuration = structuredClone(workspace.activePlan.configuration);
  const saved = store.createCompiledBlueprintPlan(compilation, "codex");
  store.updatePlanningSessionStatus(result.blueprint.proposalRef.sessionId, "draft_ready", saved.activePlan.id);
  const report = { planId: saved.activePlan.id, blueprintVersion: result.blueprint.version, restoredPlaces: restored, acceptedImageCount: result.acceptedImageCount,
    remainingPlaceCount: result.remainingPlaceCount, failedBatchCount: result.failedBatchCount,
    coverage: auditPlannedPlaceImageCoverage(result.blueprint, result.research) };
  await writeFile(resolve(reportPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { store.close(); }
