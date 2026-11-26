import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { createPlanningGenerationService } from "../apps/server/src/planning-generation.js";

const [databasePath, expectedPlanId, outputPath] = process.argv.slice(2);
if (!databasePath || !expectedPlanId || !outputPath) throw new Error("Usage: tsx scripts/continue-isolated-trip-review.ts <isolated-db> <expected-draft-id> <report>");
if (!resolve(databasePath).startsWith("/private/tmp/")) throw new Error("Live acceptance continuation must use an isolated temporary database.");
const store = new SqliteWorkspaceStore(resolve(databasePath));
const started = Date.now();
try {
  const workspace = store.getWorkspace();
  if (workspace.activePlan.id !== expectedPlanId || !workspace.activeBlueprint) throw new Error("The expected isolated draft changed.");
  const session = store.getPlanningSessionById(workspace.activeBlueprint.proposalRef.sessionId)!;
  const runtime = new CodexRuntimeAdapter();
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => { finish = resolve; });
  const service = createPlanningGenerationService({ store, codex: runtime, plannedPlaceImageEnrichment: true,
    itineraryContentReview: (request) => runtime.reviewSkillItinerary(request),
    setGeneratingPlan: (running) => { if (!running) finish(); }, logGenerationFailure: (details, message) => console.error(JSON.stringify({ message, details })) });
  const job = service.enqueuePlanningSessionGeneration({ ...session, status: "proposal_confirmed" }, workspace);
  await completed;
  const revised = store.getWorkspace();
  const report = { status: job.status, message: job.message, elapsedMs: Date.now() - started,
    planId: revised.activePlan.id, blueprintVersion: revised.activeBlueprint?.version,
    events: store.getBlueprintGenerationEvents(job.generationKey).map((event) => ({ stage: event.stage, detail: event.detail, createdAt: event.createdAt })),
    blueprint: revised.activeBlueprint };
  await writeFile(resolve(outputPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: job.status, message: job.message, planId: revised.activePlan.id, elapsedMs: report.elapsedMs }));
  if (job.status !== "succeeded") process.exitCode = 1;
} finally { store.close(); }
