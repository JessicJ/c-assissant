import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { auditItineraryContent } from "../apps/server/src/itinerary-content-audit.js";
import { itineraryArtifactFromBlueprint } from "../apps/server/src/itinerary-publication-review.js";
import { planningRequestForGenerationWithBookings } from "../apps/server/src/planning-session-generation.js";

const [databasePath, expectedPlanId, reportPath] = process.argv.slice(2);
if (!databasePath || !expectedPlanId || !reportPath) throw new Error("Usage: tsx scripts/review-saved-trip-content.ts <isolated-database> <draft-id> <report-path>");
const store = new SqliteWorkspaceStore(resolve(databasePath));
try {
  const workspace = store.getWorkspace();
  const blueprint = workspace.activeBlueprint;
  if (workspace.activePlan.id !== expectedPlanId || !blueprint) throw new Error("The expected isolated draft changed.");
  const session = store.getPlanningSessionById(blueprint.proposalRef.sessionId)!;
  const research = store.getResearchSet(blueprint.researchSetId)!;
  const runtime = new CodexRuntimeAdapter();
  const started = Date.now();
  const findings = await auditItineraryContent({ store, generationKey: blueprint.generationKey,
    request: { request: planningRequestForGenerationWithBookings({ ...session, status: "proposal_confirmed" }), research, itinerary: itineraryArtifactFromBlueprint(blueprint), profile: workspace.profile },
    review: (input) => runtime.reviewSkillItinerary(input) });
  const report = { planId: expectedPlanId, blueprintVersion: blueprint.version, elapsedMs: Date.now() - started, findings };
  await writeFile(resolve(reportPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { store.close(); }
