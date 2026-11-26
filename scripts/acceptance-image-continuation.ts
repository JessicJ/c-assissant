/** Real image-only continuation in a copied temporary database; never sends messages. */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { continuePublishedPlanImages } from "../apps/server/src/planned-place-image-continuation.js";
import { auditPlannedPlaceImageCoverage, itinerarySemanticSnapshot } from "../apps/server/src/planned-place-image-coverage.js";
import { compileExecutionItinerary } from "../apps/server/src/execution-itinerary.js";
import { materializeProposedHotelDepartures } from "../apps/server/src/proposed-departure-times.js";
import { reviewItineraryForPublication } from "../apps/server/src/itinerary-publication-review.js";
const [source, output] = process.argv.slice(2);
if (!source || !output || !resolve(source).startsWith("/private/tmp/") || !resolve(output).startsWith("/private/tmp/")) throw new Error("Use isolated temporary directories.");
await mkdir(output, { recursive: true });
await copyFile(resolve(source, "acceptance.sqlite"), resolve(output, "acceptance.sqlite"));
const store = new SqliteWorkspaceStore(resolve(output, "acceptance.sqlite"));
try {
  const workspace = store.getWorkspace();
  const original = workspace.activeBlueprint!;
  const research = store.getResearchSet(original.researchSetId)!;
  const session = store.getPlanningSessionById(original.proposalRef.sessionId)!;
  const initial = store.getTripBlueprint(original.id, 1)!;
  const repairedDefault = materializeProposedHotelDepartures(initial, session);
  const airportFindings = reviewItineraryForPublication(repairedDefault, session).filter(finding => finding.code === "insufficient_international_airport_buffer");
  assert.deepEqual(airportFindings, []);
  const oldDeparture = initial.days.at(-1)!.blocks!.find(block => block.kind === "transfer")!.startTime;
  const newDeparture = repairedDefault.days.at(-1)!.blocks!.find(block => block.kind === "transfer")!.startTime;
  const start = Date.now();
  const result = await continuePublishedPlanImages({ store, codex: new CodexRuntimeAdapter(), planId: workspace.activePlan.id, research, blueprint: original, request: "Find sourced real photographs for this Japan trip's remaining exact places.", profile: workspace.profile });
  const after = store.getWorkspace();
  assert.equal(after.activePlan.id, workspace.activePlan.id);
  assert.equal(after.activePlan.status, workspace.activePlan.status);
  assert.equal(after.activePlan.version, workspace.activePlan.version);
  assert.equal(after.activeBlueprint!.version, original.version);
  assert.equal(JSON.stringify(itinerarySemanticSnapshot(after.activeBlueprint!)), JSON.stringify(itinerarySemanticSnapshot(original)));
  assert.deepEqual(compileExecutionItinerary(after.activePlan), compileExecutionItinerary(workspace.activePlan));
  const coverage = auditPlannedPlaceImageCoverage(after.activeBlueprint!, store.getResearchSet(research.id)!);
  const report = { elapsedMs: Date.now() - start, missingBefore: auditPlannedPlaceImageCoverage(original, research).filter(row => row.status === "image_missing").length,
    missingAfter: coverage.filter(row => row.status === "image_missing").length, accepted: result?.acceptedImageCount ?? 0, coverage,
    planId: after.activePlan.id, planStatus: after.activePlan.status, planVersion: after.activePlan.version, blueprintVersion: after.activeBlueprint!.version,
    executionUnchanged: true, airportDefault: { oldDeparture, newDeparture, findings: airportFindings }, telegramMessagesSent: 0 };
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, coverage: undefined }));
} finally { store.close(); }
