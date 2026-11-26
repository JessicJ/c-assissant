/** Targeted real-runtime acceptance; copies the source DB and never publishes or sends messages. */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { assertTripBlueprintIntegrity, blueprintPresentation, compileTripBlueprint, importSkillItinerary } from "../packages/core/src/index.js";
import { itineraryArtifactFromBlueprint, reviewItineraryForPublication } from "../apps/server/src/itinerary-publication-review.js";
import { compileExecutionItinerary } from "../apps/server/src/execution-itinerary.js";
import { restoreUntargetedItineraryDays } from "../apps/server/src/planning-generation.js";
import { probeRemoteImageUrl, runPlannedPlaceImagePass } from "../apps/server/src/planned-place-image-pipeline.js";
import { searchWikipediaPlaceImages } from "../apps/server/src/wikipedia-place-images.js";
import { auditPlannedPlaceImageCoverage, itinerarySemanticSnapshot } from "../apps/server/src/planned-place-image-coverage.js";

const [source, destination, mode] = process.argv.slice(2);
if (!source || !destination || !resolve(source).startsWith("/private/tmp/") || !resolve(destination).startsWith("/private/tmp/")) throw new Error("Use isolated temporary source and output directories.");
await mkdir(destination, { recursive: true });
await copyFile(resolve(source, "acceptance.sqlite"), resolve(destination, "acceptance.sqlite"));
const store = new SqliteWorkspaceStore(resolve(destination, "acceptance.sqlite"));
const workspace = store.getWorkspace();
const blueprint = structuredClone(workspace.activeBlueprint!);
const research = structuredClone(store.getResearchSet(blueprint.researchSetId)!);
const session = store.getPlanningSessionById(blueprint.proposalRef.sessionId)!;
store.close();
const runtime = new CodexRuntimeAdapter();
const dates = ["2026-11-13", "2026-11-15", "2026-11-18"];
const original = itineraryArtifactFromBlueprint(blueprint);
const tasks = {
  scoped: async () => {
    const started = Date.now();
    const patch = await runtime.generateSkillItinerary({
      request: `Review and re-compose only ${dates.join(", ")} using the saved itinerary and research. Preserve every selected place, hotel, existing time and commitment. Ensure practical daytime connections and meal/rest blocks. Do not research new places or rewrite other dates. This acceptance measures a scoped re-composition of an already reviewed trip, not fresh trip generation.`,
      research, profile: workspace.profile, dayPatch: { original, dates }, signal: AbortSignal.timeout(5 * 60_000)
    });
    await writeFile(resolve(destination, "patch.json"), JSON.stringify({ elapsedMs: Date.now() - started, patch }, null, 2));
    const merged = restoreUntargetedItineraryDays(original, patch, dates, true);
    for (const day of original.days.filter((day) => !dates.includes(day.date))) assert.deepEqual(merged.days.find((candidate) => candidate.date === day.date), day);
    assert.equal(merged.title, original.title);
    const retainedIds = new Set(original.days.filter(day => !dates.includes(day.date)).map(day => day.id));
    assert.deepEqual(merged.movements.filter(movement => retainedIds.has(movement.dayId)), original.movements.filter(movement => retainedIds.has(movement.dayId)));
    for (const day of original.days) {
      const revisedDay = merged.days.find(candidate => candidate.date === day.date)!;
      for (const stop of day.stops) assert.ok(revisedDay.stops.some(candidate => candidate.placeId === stop.placeId), `Selected stop removed on ${day.date}`);
    }
    const revised = importSkillItinerary(research, merged, { blueprintId: blueprint.id, blueprintVersion: blueprint.version + 1, createdAt: blueprint.createdAt, bookingConstraints: blueprint.bookingConstraints });
    assertTripBlueprintIntegrity(revised);
    const plan = { ...compileTripBlueprint(revised, { createdAt: revised.createdAt }).plan, presentation: blueprintPresentation(revised) };
    const execution = compileExecutionItinerary(plan);
    assert.deepEqual(execution.gaps, []);
    assert.ok(execution.activities.length > 0);
    const report = { executionActivities: execution.activities.length, executionGaps: execution.gaps, elapsedMs: Date.now() - started, outputDays: patch.days.length, restoredDays: merged.days.length, unchangedUntargetedDays: original.days.length - dates.length, findings: reviewItineraryForPublication(revised, session), scope: "Scoped real re-composition of an accepted trip; not fresh generation", patch };
    await writeFile(resolve(destination, "scoped.json"), JSON.stringify(report, null, 2));
    assert.deepEqual(report.findings, [], "Scoped result must pass whole-trip publication review");
    return { ...report, patch: undefined };
  },
  images: async () => {
    const started = Date.now();
    const before = JSON.stringify(itinerarySemanticSnapshot(blueprint));
    const coverageBefore = auditPlannedPlaceImageCoverage(blueprint, research);
    const result = await runPlannedPlaceImagePass({ research, blueprint, probeImageUrl: (url, signal) => probeRemoteImageUrl(url, { signal }),
      lookupKnownImages: (places, signal) => searchWikipediaPlaceImages(places, { signal }),
      search: (places, timeoutMs, rejectedImageUrls, signal) => runtime.generatePlannedPlaceImageEnrichment({ request: `Find exact sourced real photographs for ${blueprint.title}. Use the official place website or exact Wikipedia/Commons identity. Direct image URLs only. Avoid rejected URLs: ${rejectedImageUrls.join(", ")}`, scopeLabel: blueprint.destinations.join(" / "), places, profile: workspace.profile, timeoutMs, signal }),
      save: (updatedResearch, updatedBlueprint) => ({ research: updatedResearch, blueprint: updatedBlueprint }),
      onBatch: (batch) => console.log(JSON.stringify({ imageBatch: { requested: batch.requested, accepted: batch.accepted, error: batch.error ? String(batch.error) : undefined } })) });
    assert.equal(JSON.stringify(itinerarySemanticSnapshot(result.blueprint)), before);
    const report = { elapsedMs: Date.now() - started, missingBefore: coverageBefore.filter((row) => row.status === "image_missing").length, missingAfter: result.remainingPlaceCount, accepted: result.acceptedImageCount, failedBatches: result.failedBatchCount, coverage: auditPlannedPlaceImageCoverage(result.blueprint, result.research) };
    await writeFile(resolve(destination, "images.json"), JSON.stringify(report, null, 2));
    return report;
  }
};
const results = await Promise.allSettled(Object.entries(tasks).filter(([name]) => !mode || name === mode).map(async ([name, run]) => ({ name, result: await run() })));
await writeFile(resolve(destination, "report.json"), JSON.stringify(results.map((result) => result.status === "fulfilled" ? result.value : { error: String(result.reason) }), null, 2));
for (const result of results) console.log(JSON.stringify(result.status === "fulfilled" ? result.value : { error: String(result.reason) }));
if (results.some((result) => result.status === "rejected")) process.exitCode = 1;
