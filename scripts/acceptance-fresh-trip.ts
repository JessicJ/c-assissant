/** Fresh real generation and restart recovery in an isolated copy; never writes the user's active workspace. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { CodexRuntimeAdapter, RuntimeAdapterError } from "../packages/agent-adapters/lib/index.js";
import { assertTripBlueprintIntegrity } from "../packages/core/lib/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/lib/index.js";
import { createPlanningGenerationService } from "../apps/server/src/planning-generation.js";
import { reviewItineraryForPublication } from "../apps/server/src/itinerary-publication-review.js";
import { auditPlannedPlaceImageCoverage } from "../apps/server/src/planned-place-image-coverage.js";

const outputDir = resolve(process.argv[2] ?? "/private/tmp/landi-fresh-trip-acceptance");
if (!outputDir.startsWith("/private/tmp/")) throw new Error("Acceptance must use a temporary isolated database.");
await mkdir(outputDir, { recursive: true });
const path = resolve(outputDir, "acceptance.sqlite");
const resuming = process.argv.includes("--resume");
const fresh = process.argv.includes("--fresh");
const fixtureIndex = process.argv.indexOf("--fixture");
const fixture = fixtureIndex >= 0 ? JSON.parse(await readFile(resolve(process.argv[fixtureIndex + 1]), "utf8")) : undefined;
if (fresh && resuming) throw new Error("Use --fresh for a new uninterrupted generation only.");
if (!resuming) {
const source = new DatabaseSync(resolve("data/c-assistant.sqlite"), { readOnly: true });
await backup(source, path); source.close();
}
let store = new SqliteWorkspaceStore(path);
const createdAt = new Date().toISOString();
const started = Date.now();
const facts: Record<string, string> = fixture?.facts ?? { destination: "杭州，中国", purpose: "两位成年人轻松体验西湖、园林、茶文化和杭州本地饮食，不安排购物打卡，普通旅行节奏", travel_dates: "2026-10-20 to 2026-10-22", arrival: "2026-10-20 从上海乘高铁前往杭州，车次未订，请推荐合理抵达时间与车站", departure: "2026-10-22 下午或晚上高铁返回上海，车次未订，请安排合理的建议出发时间", party_size: "2", transport_preference: "市内步行结合公共交通，需要时打车，不自驾", accommodation: "没有预订酒店，请推荐具体酒店并作为每天起终点", budget: "不设固定预算，优先舒适和性价比，不要求奢华住宿" };
const session = resuming ? store.getPlanningSessionById(process.argv[process.argv.indexOf("--resume") + 1])! : store.savePlanningSession({ ...store.createPlanningSession("travel"), status: "proposal_ready",
  messages: [{ id: "acceptance-user", role: "user", text: Object.values(facts).join("。"), createdAt }],
  facts: Object.entries(facts).map(([key, value]) => ({ key, value, confirmed: true, source: "user" as const, updatedAt: createdAt })), unresolved: [], deferred: [],
  proposal: fixture?.proposal ?? { version: 1, title: "杭州三天轻松旅行", objective: "以西湖、园林、茶文化和饮食体验杭州", theme: "步行、园林、茶文化与杭州饮食", segments: ["杭州"], skeleton: ["10月20日上海高铁抵达、酒店寄存与西湖轻松步行", "10月21日园林与茶文化，安排午餐休息", "10月22日轻松体验后从杭州车站返回上海"], tradeoffs: ["不堆叠景点", "未订车次使用建议时间"], assumptions: ["酒店未订，具体推荐为计划基地", "高铁车次未订"], decisionPoints: [] }, updatedAt: createdAt });
if (!session) throw new Error("Missing saved acceptance session.");
const confirmed = resuming ? session : store.confirmPlanningSession(session.id, 1);
await writeFile(resolve(outputDir, "session.json"), JSON.stringify({ sessionId: confirmed.id, startedAt: createdAt, mode: fresh ? "fresh uninterrupted" : "restart recovery" }, null, 2));
let interrupted = resuming;
const runtime = new CodexRuntimeAdapter();
const pendingImages: Promise<unknown>[] = [];
const originalItinerary = runtime.generateSkillItinerary.bind(runtime);
runtime.generateSkillItinerary = async (input) => {
  if (!fresh && !interrupted) { interrupted = true; throw new RuntimeAdapterError("cancelled", "Acceptance injection: stop after research checkpoint to verify restart recovery."); }
  return originalItinerary(input);
};
async function run() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const service = createPlanningGenerationService({ store, codex: runtime, plannedPlaceImageEnrichment: true,
    itineraryContentReview: (input) => runtime.reviewSkillItinerary(input), setGeneratingPlan: (running) => { if (!running) finish(); },
    logGenerationFailure: (details, message) => console.error(JSON.stringify({ message, details })) });
  const workspace = store.getWorkspace(); workspace.runtime.selectedKind = "codex";
  const current = store.getPlanningSessionById(confirmed.id)!;
  const job = service.enqueuePlanningSessionGeneration({ ...current, status: "proposal_confirmed" }, workspace);
  const log = setInterval(() => console.log(JSON.stringify({ sessionId: confirmed.id, generationKey: job.generationKey, elapsedMs: Date.now() - started, stage: job.stage, status: job.status, message: job.message })), 30_000);
  await done; clearInterval(log);
  pendingImages.push(...(service.imageContinuations?.values() ?? []));
  return { generationKey: job.generationKey, status: job.status, message: job.message };
}
try {
  const first = resuming ? JSON.parse(await readFile(resolve(outputDir, "checkpoint.json"), "utf8")).first : await run();
  const researchBefore = store.getResearchSetByGenerationKey(first.generationKey);
  const checkpoint = resuming ? JSON.parse(await readFile(resolve(outputDir, "checkpoint.json"), "utf8")) : { first, researchId: researchBefore?.id, places: researchBefore?.places.length, interruptedAtMs: Date.now() - started };
  console.log(JSON.stringify({ checkpoint }));
  if (!resuming) await writeFile(resolve(outputDir, "checkpoint.json"), JSON.stringify(checkpoint, null, 2));
  if ((!fresh && !interrupted) || !researchBefore?.places.length) throw new Error("The intentional interruption did not leave a completed research checkpoint.");
  store.close(); store = new SqliteWorkspaceStore(path);
  const resumed = fresh ? first : await run();
  const workspace = store.getWorkspace();
  const blueprint = workspace.activeBlueprint;
  if (resumed.status !== "succeeded" || !blueprint || blueprint.proposalRef.sessionId !== confirmed.id) throw new Error(`Fresh generation did not finish: ${JSON.stringify(resumed)}`);
  assertTripBlueprintIntegrity(blueprint);
  const research = store.getResearchSet(blueprint.researchSetId)!;
  const findings = reviewItineraryForPublication(blueprint, store.getPlanningSessionById(confirmed.id)!);
  const events = store.getBlueprintGenerationEvents(resumed.generationKey);
  const report = { ...resumed, sessionId: confirmed.id, planId: workspace.activePlan.id, blueprintVersion: blueprint.version, elapsedMs: Date.now() - started, elapsedScope: fresh ? "fresh uninterrupted generation from confirmed facts through publication" : resuming ? "this resume only" : "initial run including research and injected interruption",
    acceptanceScope: "Confirmed facts and proposal are seeded; this script does not test the conversational fact collection or browser interaction.",
    checkpoint, reusedGenerationKey: first.generationKey === resumed.generationKey, researchIdPreserved: researchBefore.id === research.id,
    findings, imageCoverage: auditPlannedPlaceImageCoverage(blueprint, research), events, blueprint };
  await writeFile(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: resumed.status, elapsedMs: report.elapsedMs, planId: report.planId, findings: findings.length, imageMissing: report.imageCoverage.filter((row) => row.status === "image_missing").length }));
  if (findings.length) process.exitCode = 1;
  const draftReadyAt = Date.now();
  await Promise.allSettled(pendingImages);
  const afterImages = store.getWorkspace();
  if (pendingImages.length && afterImages.activeBlueprint) await writeFile(resolve(outputDir, "background-images.json"), JSON.stringify({ elapsedAfterDraftMs: Date.now() - draftReadyAt, planId: afterImages.activePlan.id, coverage: auditPlannedPlaceImageCoverage(afterImages.activeBlueprint, store.getResearchSet(afterImages.activeBlueprint.researchSetId)!) }, null, 2));
} catch (error) {
  const generationKey = `${confirmed.id}:1:landi-trip-blueprint@1.0.0`;
  await writeFile(resolve(outputDir, "failure.json"), JSON.stringify({
    status: "failed", sessionId: confirmed.id, elapsedMs: Date.now() - started,
    mode: fresh ? "fresh uninterrupted" : "restart recovery",
    error: error instanceof Error ? error.message : String(error),
    events: store.getBlueprintGenerationEvents(generationKey)
  }, null, 2));
  throw error;
} finally { store.close(); }
