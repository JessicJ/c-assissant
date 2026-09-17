import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/lib/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/lib/index.js";
import type { PlanningFact, PlanningProposal, TravelBooking } from "../packages/core/lib/index.js";
import { createPlanningGenerationService } from "../apps/server/src/planning-generation.ts";

type CorpusBooking = Omit<TravelBooking, "id" | "planningSessionId" | "sourceHash" | "importedAt" | "updatedAt">;

type CorpusCase = {
  id: string;
  categories: string[];
  destination: string;
  duration: string;
  request: string;
  facts: Record<string, string>;
  proposal: Omit<PlanningProposal, "version">;
  bookings?: CorpusBooking[];
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? resolve(projectRoot, "data", "c-assistant.sqlite"));
const outputBase = resolve(process.env.SEMANTIC_SHADOW_CORPUS_OUTPUT ?? resolve(projectRoot, "output", "semantic-shadow-corpus-v1"));
const productionTotalGenerationTimeoutMs = 70 * 60_000;
const diagnosticTerminalGraceMs = 5 * 60_000;
const generationWaitMs = Number(process.env.SEMANTIC_SHADOW_GENERATION_WAIT_MS ?? productionTotalGenerationTimeoutMs + diagnosticTerminalGraceMs);
const runMode = process.argv.includes("--corpus") ? "corpus" : "probe";
process.env.LANDI_SEMANTIC_SHADOW = process.env.LANDI_SEMANTIC_SHADOW ?? "1";
process.env.LANDI_SEMANTIC_SHADOW_SAMPLE_RATE = process.env.LANDI_SEMANTIC_SHADOW_SAMPLE_RATE ?? "1";
process.env.C_ASSISTANT_DATA_PATH = databasePath;

const store = new SqliteWorkspaceStore(databasePath);
const codex = new CodexRuntimeAdapter();
const manifest: Array<Record<string, unknown>> = [];
const saveDiagnosticArtifact = store.saveDiagnosticArtifact.bind(store);
store.saveDiagnosticArtifact = ((input) => {
  console.error(JSON.stringify({ diagnostic: "saveDiagnosticArtifact", generationKey: input.generationKey, rawResponsePrefix: input.rawResponse.slice(0, 80), createdAt: input.createdAt, expiresAt: input.expiresAt }));
  return saveDiagnosticArtifact(input);
}) as typeof store.saveDiagnosticArtifact;
const generateSemanticTravelPlan = codex.generateSemanticTravelPlan.bind(codex);
codex.generateSemanticTravelPlan = (async (input) => {
  console.error(JSON.stringify({ diagnostic: "generateSemanticTravelPlan:start", generationKey: input.research.generationKey, places: input.research.places.length }));
  const result = await generateSemanticTravelPlan(input);
  console.error(JSON.stringify({ diagnostic: "generateSemanticTravelPlan:end", generationKey: input.research.generationKey, days: result.plan.dailyItinerary.length, targetedResearch: result.plan.targetedResearch.length }));
  return result;
}) as typeof codex.generateSemanticTravelPlan;
const generateSemanticTravelPlanRepair = codex.generateSemanticTravelPlanRepair.bind(codex);
codex.generateSemanticTravelPlanRepair = (async (input) => {
  console.error(JSON.stringify({ diagnostic: "generateSemanticTravelPlanRepair:start", promptCharacters: input.prompt.length }));
  const result = await generateSemanticTravelPlanRepair(input);
  console.error(JSON.stringify({ diagnostic: "generateSemanticTravelPlanRepair:end", days: result.plan.dailyItinerary.length }));
  return result;
}) as typeof codex.generateSemanticTravelPlanRepair;

async function runCase(corpusCase: CorpusCase): Promise<Record<string, unknown>> {
  const loadedConfig = await loadEffectiveConfig();
  const diagnostics: Array<Record<string, unknown>> = [];
  const beforeArtifactIds = new Set(store.listDiagnosticArtifacts("").map((artifact) => artifact.id));
  const createdAt = new Date().toISOString();
  const session = store.savePlanningSession({
    ...store.createPlanningSession("travel"),
    status: "proposal_ready",
    messages: [{ id: `user-${randomUUID()}`, role: "user", text: corpusCase.request, createdAt }],
    facts: Object.entries(corpusCase.facts).map(([key, value]) => fact(key, value, createdAt)),
    proposal: { ...corpusCase.proposal, version: 1 },
    unresolved: [],
    updatedAt: createdAt
  });
  for (const booking of corpusCase.bookings ?? []) {
    const importedAt = new Date().toISOString();
    store.saveTravelBooking({
      ...booking,
      id: `booking-${corpusCase.id}-${randomUUID()}`,
      planningSessionId: session.id,
      sourceHash: hash(`${corpusCase.id}:${booking.title}:${importedAt}`),
      importedAt,
      updatedAt: importedAt
    });
  }
  const confirmed = store.confirmPlanningSession(session.id, 1);
  let finished!: () => void;
  const generationFinished = new Promise<void>((resolve) => { finished = resolve; });
  const service = createPlanningGenerationService({
    store,
    codex,
    semanticShadow: loadedConfig.semanticShadow,
    onSemanticShadowDiagnostic: (event) => {
      diagnostics.push({ ...event, at: new Date().toISOString() });
      console.error(JSON.stringify({ diagnostic: "semanticShadowEvent", ...event }));
    },
    setGeneratingPlan: (running) => { if (!running) finished(); },
    logGenerationFailure: (details, message) => console.error(JSON.stringify({ message, details }))
  });
  const workspace = store.getWorkspace();
  workspace.runtime.selectedKind = "codex";
  const job = service.enqueuePlanningSessionGeneration(confirmed, workspace);
  const waitResult = await waitForGeneration(job, service, generationFinished);
  const draftReadyAt = Date.now();
  const afterLegacy = store.getWorkspace();
  const legacyPlan = afterLegacy.activePlan;
  const persistedGeneration = store.getBlueprintGeneration(job.generationKey);
  const draftReady = store.getPlanningSessionById(confirmed.id)?.status === "draft_ready";
  if (waitResult.status === "timeout" || !draftReady || persistedGeneration?.status !== "completed") {
    const legacyFailure = waitResult.status === "timeout"
      ? {
          code: "cancelled",
          stage: persistedGeneration?.stage ?? job.stage,
          issues: [{ path: persistedGeneration?.stage ?? job.stage, code: "cancelled", message: waitResult.message }],
          resumable: true
        }
      : persistedGeneration?.failure;
    return {
      caseId: corpusCase.id,
      categories: corpusCase.categories,
      destination: corpusCase.destination,
      duration: corpusCase.duration,
      bookingsPresent: (corpusCase.bookings ?? []).map((booking) => booking.type),
      sessionId: confirmed.id,
      generationKey: job.generationKey,
      legacyStatus: waitResult.status === "timeout" ? "cancelled" : persistedGeneration?.status ?? job.status,
      legacyStage: persistedGeneration?.stage,
      legacyFailure,
      corpusFailureClass: classifyCorpusFailure(legacyFailure),
      draftReady,
      legacyPlanId: legacyPlan.id,
      legacyPlanVersion: legacyPlan.version,
      shadowArtifactId: undefined,
      executionPlanStarted: Boolean(afterLegacy.executionPlan),
      activePlanStillLegacy: store.getWorkspace().activePlan.id === legacyPlan.id,
      effectiveConfig: loadedConfig,
      diagnostics,
      stageMatrix: stageMatrix(diagnostics, false),
      processCwd: process.cwd(),
      databasePath,
      outputBase,
      draftReadyAt,
      notes: "legacy generation did not reach draft_ready; semantic shadow was not scheduled"
    };
  }
  if (!loadedConfig.semanticShadow.enabled) {
    return {
      caseId: corpusCase.id,
      categories: corpusCase.categories,
      destination: corpusCase.destination,
      duration: corpusCase.duration,
      bookingsPresent: (corpusCase.bookings ?? []).map((booking) => booking.type),
      sessionId: confirmed.id,
      generationKey: job.generationKey,
      legacyStatus: persistedGeneration.status,
      legacyStage: persistedGeneration.stage,
      draftReady,
      legacyPlanId: legacyPlan.id,
      legacyPlanVersion: legacyPlan.version,
      shadowArtifactId: undefined,
      executionPlanStarted: Boolean(afterLegacy.executionPlan),
      activePlanStillLegacy: store.getWorkspace().activePlan.id === legacyPlan.id,
      effectiveConfig: loadedConfig,
      diagnostics,
      stageMatrix: stageMatrix(diagnostics, false),
      processCwd: process.cwd(),
      databasePath,
      outputBase,
      draftReadyAt,
      notes: "legacy draft_ready reached; semantic shadow disabled for pre-shadow smoke gate"
    };
  }
  const artifactResult = await waitForShadowArtifact(job.generationKey, beforeArtifactIds);
  const artifact = artifactResult.artifact;
  const parsed = artifact ? safeJson(artifact.rawResponse) : undefined;
  return {
    caseId: corpusCase.id,
    categories: corpusCase.categories,
    destination: corpusCase.destination,
    duration: corpusCase.duration,
    bookingsPresent: (corpusCase.bookings ?? []).map((booking) => booking.type),
    sessionId: confirmed.id,
    generationKey: job.generationKey,
    legacyStatus: persistedGeneration?.status ?? job.status,
    draftReady,
    legacyPlanId: legacyPlan.id,
    legacyPlanVersion: legacyPlan.version,
    shadowArtifactId: artifact?.id,
    artifactType: parsed?.type,
    shadowStatus: parsed?.status?.value,
    validatorResult: parsed?.validator?.initialResult,
    repairAttempted: parsed?.repair?.attempted,
    structurerSuccess: parsed?.structurer?.success,
    totalRuntimeMs: parsed?.totalRuntimeMs,
    artifactCreatedAt: artifact?.createdAt,
    artifactExpiresAt: artifact?.expiresAt,
    artifactAppearedAfterDraftReadyMs: artifactResult.elapsedMs,
    executionPlanStarted: Boolean(afterLegacy.executionPlan),
    activePlanStillLegacy: store.getWorkspace().activePlan.id === legacyPlan.id,
    effectiveConfig: loadedConfig,
    diagnostics,
    stageMatrix: stageMatrix(diagnostics, Boolean(artifact)),
    processCwd: process.cwd(),
    databasePath,
    outputBase,
    draftReadyAt,
    notes: artifact ? "semantic_shadow_v1 artifact persisted" : "semantic_shadow_v1 artifact missing after bounded wait"
  };
}

async function rerunExistingSession(sessionId: string): Promise<Record<string, unknown>> {
  const loadedConfig = await loadEffectiveConfig();
  const diagnostics: Array<Record<string, unknown>> = [];
  const session = store.getPlanningSessionById(sessionId);
  if (!session?.confirmedProposalVersion) throw new Error(`Confirmed Planning Session not found: ${sessionId}`);
  let finished!: () => void;
  const generationFinished = new Promise<void>((resolve) => { finished = resolve; });
  const service = createPlanningGenerationService({
    store,
    codex,
    semanticShadow: loadedConfig.semanticShadow,
    onSemanticShadowDiagnostic: (event) => {
      diagnostics.push({ ...event, at: new Date().toISOString() });
      console.error(JSON.stringify({ diagnostic: "semanticShadowEvent", ...event }));
    },
    setGeneratingPlan: (running) => { if (!running) finished(); },
    logGenerationFailure: (details, message) => console.error(JSON.stringify({ message, details }))
  });
  const workspace = store.getWorkspace();
  workspace.runtime.selectedKind = "codex";
  const job = service.enqueuePlanningSessionGeneration(session, workspace);
  await waitForGeneration(job, service, generationFinished);
  const artifactResult = await waitForShadowArtifact(job.generationKey, new Set());
  const artifact = artifactResult.artifact;
  const parsed = artifact ? safeJson(artifact.rawResponse) : undefined;
  const latest = store.getWorkspace();
  return {
    caseId: `resume-${sessionId}`,
    categories: ["diagnostic-resume"],
    sessionId,
    generationKey: job.generationKey,
    legacyStatus: job.status,
    draftReady: store.getPlanningSessionById(sessionId)?.status === "draft_ready",
    legacyPlanId: latest.activePlan.id,
    legacyPlanVersion: latest.activePlan.version,
    shadowArtifactId: artifact?.id,
    artifactType: parsed?.type,
    shadowStatus: parsed?.status?.value,
    validatorResult: parsed?.validator?.initialResult,
    repairAttempted: parsed?.repair?.attempted,
    structurerSuccess: parsed?.structurer?.success,
    totalRuntimeMs: parsed?.totalRuntimeMs,
    artifactCreatedAt: artifact?.createdAt,
    artifactExpiresAt: artifact?.expiresAt,
    artifactAppearedAfterDraftReadyMs: artifactResult.elapsedMs,
    executionPlanStarted: Boolean(latest.executionPlan),
    activePlanStillLegacy: true,
    effectiveConfig: loadedConfig,
    diagnostics,
    stageMatrix: stageMatrix(diagnostics, Boolean(artifact)),
    processCwd: process.cwd(),
    databasePath,
    outputBase,
    notes: artifact ? "semantic_shadow_v1 artifact persisted from checkpoint resume" : "semantic_shadow_v1 artifact missing after checkpoint resume"
  };
}

async function adoptExistingGeneration(caseId: string, generationKey: string): Promise<Record<string, unknown>> {
  const corpusCase = cases.find((item) => item.id === caseId);
  if (!corpusCase) throw new Error(`Unknown corpus case: ${caseId}`);
  const loadedConfig = await loadEffectiveConfig();
  const generation = store.getBlueprintGeneration(generationKey);
  if (!generation) throw new Error(`Blueprint Generation not found: ${generationKey}`);
  const session = store.getPlanningSessionById(generation.proposalRef.sessionId);
  const latest = store.getWorkspace();
  const artifactResult = await waitForShadowArtifact(generationKey, new Set(), 0);
  const artifact = artifactResult.artifact;
  const parsed = artifact ? safeJson(artifact.rawResponse) : undefined;
  return {
    caseId: corpusCase.id,
    categories: corpusCase.categories,
    destination: corpusCase.destination,
    duration: corpusCase.duration,
    bookingsPresent: (corpusCase.bookings ?? []).map((booking) => booking.type),
    sessionId: generation.proposalRef.sessionId,
    generationKey,
    legacyStatus: generation.status,
    legacyStage: generation.stage,
    legacyFailure: generation.failure,
    draftReady: session?.status === "draft_ready",
    legacyPlanId: latest.activePlan.id,
    legacyPlanVersion: latest.activePlan.version,
    shadowArtifactId: artifact?.id,
    artifactType: parsed?.type,
    shadowStatus: parsed?.status?.value,
    validatorResult: parsed?.validator?.initialResult,
    repairAttempted: parsed?.repair?.attempted,
    structurerSuccess: parsed?.structurer?.success,
    totalRuntimeMs: parsed?.totalRuntimeMs,
    artifactCreatedAt: artifact?.createdAt,
    artifactExpiresAt: artifact?.expiresAt,
    artifactAppearedAfterDraftReadyMs: artifactResult.elapsedMs,
    executionPlanStarted: Boolean(latest.executionPlan),
    activePlanStillLegacy: true,
    effectiveConfig: loadedConfig,
    diagnostics: [],
    stageMatrix: stageMatrix([], Boolean(artifact)),
    processCwd: process.cwd(),
    databasePath,
    outputBase,
    notes: artifact ? "semantic_shadow_v1 artifact already persisted" : "existing generation did not produce a semantic_shadow_v1 artifact"
  };
}

async function waitForShadowArtifact(generationKey: string, beforeArtifactIds: Set<string>, overrideTimeoutMs?: number): Promise<{ artifact?: ReturnType<SqliteWorkspaceStore["listDiagnosticArtifacts"]>[number]; elapsedMs?: number }> {
  const started = Date.now();
  const timeoutMs = overrideTimeoutMs ?? Number(process.env.SEMANTIC_SHADOW_ARTIFACT_WAIT_MS ?? 15 * 60_000);
  const findArtifact = () => {
    const artifacts = store.listDiagnosticArtifacts(generationKey).filter((artifact) => !beforeArtifactIds.has(artifact.id));
    return artifacts.find((artifact) => safeJson(artifact.rawResponse)?.type === "semantic_shadow_v1");
  };
  const initial = findArtifact();
  if (initial) return { artifact: initial, elapsedMs: Date.now() - started };
  while (Date.now() - started < timeoutMs) {
    const semantic = findArtifact();
    if (semantic) return { artifact: semantic, elapsedMs: Date.now() - started };
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return {};
}

async function loadEffectiveConfig(): Promise<Record<string, unknown> & { semanticShadow: { enabled: boolean; sampleRate: number; timeoutMs: number } }> {
  const module = await import("../apps/server/src/server-config.ts");
  const config = module.loadServerConfig(new URL("../apps/server/src/index.ts", import.meta.url).href);
  return {
    processCwd: process.cwd(),
    projectRoot: config.projectRoot,
    databasePath: config.databasePath,
    outputBase,
    semanticShadow: config.semanticShadow
  };
}

function stageMatrix(diagnostics: Array<Record<string, unknown>>, artifactFound: boolean): Record<string, boolean> {
  const has = (event: string) => diagnostics.some((item) => item.event === event);
  const eligibility = diagnostics.find((item) => item.event === "eligibility_checked");
  return {
    featureEnabled: eligibility?.featureEnabled === true,
    sampled: eligibility?.sampled === true,
    scheduleBranchReached: has("scheduling_branch_reached"),
    shadowScheduled: has("scheduled"),
    shadowRunnerStarted: has("runner_started"),
    plannerStarted: has("planner_started"),
    validatorReached: has("validator_reached"),
    structurerReached: has("structurer_reached"),
    diagnosticSaveAttempted: has("diagnostic_save_attempted"),
    diagnosticSaveSucceeded: has("diagnostic_save_succeeded"),
    artifactFoundInExpectedDb: artifactFound
  };
}

async function waitForGeneration(job: { generationKey: string; controller: AbortController }, service: ReturnType<typeof createPlanningGenerationService>, finished: Promise<void>): Promise<{ status: "completed" } | { status: "timeout"; message: string }> {
  if (!Number.isFinite(generationWaitMs) || generationWaitMs <= 0) {
    await finished;
    return { status: "completed" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), generationWaitMs);
    timer.unref?.();
  });
  const result = await Promise.race([finished.then(() => "completed" as const), timeout]);
  if (timer) clearTimeout(timer);
  if (result === "completed") return { status: "completed" };
  const message = `Corpus collection bounded wait exceeded ${generationWaitMs}ms before draft_ready.`;
  job.controller.abort(message);
  service.markPersistedGenerationCancelled(job.generationKey, message);
  await Promise.race([
    finished,
    new Promise((resolve) => setTimeout(resolve, 30_000))
  ]);
  return { status: "timeout", message };
}

function classifyCorpusFailure(failure: unknown): string | undefined {
  if (!failure || typeof failure !== "object") return undefined;
  const code = "code" in failure ? String((failure as { code?: unknown }).code ?? "") : "";
  const stage = "stage" in failure ? String((failure as { stage?: unknown }).stage ?? "") : "";
  const text = JSON.stringify(failure);
  if (code === "rate_limited" || /rate.?limit|usage limit|quota|too many requests/i.test(text)) return "CORPUS_COLLECTION_INFRA_FAILURE";
  if (code === "timed_out") return stage === "research" ? "PROVIDER_TIMEOUT" : "PRODUCTION_GENERATION_TIMEOUT";
  if (code === "cancelled" && /bounded wait/i.test(text)) return "HARNESS_DIAGNOSTIC_TIMEOUT";
  if (/Research Set failed integrity/i.test(text)) return "RESEARCH_INTEGRITY_FAILURE";
  if (stage === "itinerary") return "LEGACY_ITINERARY_FAILURE";
  return "OTHER";
}

async function saveManifest(items: Array<Record<string, unknown>>): Promise<void> {
  await mkdir(dirname(outputBase), { recursive: true });
  await writeFile(`${outputBase}.json`, `${JSON.stringify({ databasePath, mode: runMode, generatedAt: new Date().toISOString(), cases: items }, null, 2)}\n`, "utf8");
  await writeFile(`${outputBase}.md`, markdownManifest(items), "utf8");
}

function markdownManifest(items: Array<Record<string, unknown>>): string {
  const lines = ["# Semantic Shadow Corpus V1", "", `Database: ${databasePath}`, "", "| Case | Categories | Session | Legacy Plan | Artifact | Shadow | Validator | Repair | Runtime |", "|---|---|---|---|---|---|---|---|---|"];
  for (const item of items) {
    lines.push(`| ${item.caseId} | ${(item.categories as string[]).join(", ")} | ${item.sessionId ?? ""} | ${item.legacyPlanId ?? ""} v${item.legacyPlanVersion ?? ""} | ${item.shadowArtifactId ?? "missing"} | ${item.shadowStatus ?? "missing"} | ${item.validatorResult ?? ""} | ${String(item.repairAttempted ?? "")} | ${item.totalRuntimeMs ?? ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

function fact(key: string, value: string, updatedAt: string): PlanningFact {
  return { key, value, source: "user", confirmed: true, updatedAt };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeJson(value: string): any | undefined {
  try { return JSON.parse(value); } catch { return undefined; }
}

const cases: CorpusCase[] = [
  {
    id: "single-base-relaxed-lisbon",
    categories: ["single-base", "relaxed", "no-accommodation-yet"],
    destination: "Lisbon",
    duration: "2026-10-12 to 2026-10-14",
    request: "Plan a relaxed Lisbon trip for two adults from 2026-10-12 to 2026-10-14, focused on tiles, viewpoints, food, and unhurried neighborhoods. No hotel has been booked yet.",
    facts: { destination: "Lisbon", purpose: "relaxed culture, tiles, viewpoints, food", travel_dates: "2026-10-12 to 2026-10-14", arrival: "Arrive at Lisbon airport around 10:30 on 2026-10-12", departure: "Depart Lisbon airport around 18:00 on 2026-10-14", party_size: "2", transport_preference: "Landi推荐" },
    proposal: { title: "Relaxed Lisbon culture trip", objective: "Lisbon relaxed culture trip", theme: "Tiles, viewpoints, food, and neighborhoods", segments: ["Lisbon"], skeleton: ["2026-10-12 arrival and light neighborhoods", "2026-10-13 culture and viewpoints", "2026-10-14 slow morning and departure"], tradeoffs: ["Keep pacing relaxed", "Avoid overfilling arrival and departure days"], assumptions: ["Accommodation is not booked yet"], decisionPoints: [] }
  },
  {
    id: "hotel-paris-art",
    categories: ["single-base", "confirmed hotels", "activity-dense"],
    destination: "Paris",
    duration: "2026-10-06 to 2026-10-09",
    request: "Plan a Paris art trip for three from 2026-10-06 to 2026-10-09 with a confirmed hotel near Saint-Germain.",
    facts: { destination: "Paris", purpose: "art museums and cafes", travel_dates: "2026-10-06 to 2026-10-09", arrival: "Arrive at Paris CDG around 14:30 on 2026-10-06", departure: "Depart Paris CDG around 18:20 on 2026-10-09", party_size: "3", transport_preference: "公共交通" },
    proposal: { title: "Paris art base trip", objective: "Paris art museums and cafes", theme: "Art, cafes, and walkable neighborhoods", segments: ["Paris"], skeleton: ["Arrival and Saint-Germain", "Major museum day", "Left Bank and smaller museums", "Departure day"], tradeoffs: ["Use transit over taxis when reasonable"], assumptions: ["Hotel is confirmed near Saint-Germain"], decisionPoints: [] },
    bookings: [hotel("Hotel Saint-Germain", "Paris Saint-Germain", "2026-10-06T15:00", "2026-10-09T11:00")]
  },
  {
    id: "flights-heavy-tokyo",
    categories: ["confirmed flights", "arrival/departure heavy", "no-accommodation-yet"],
    destination: "Tokyo",
    duration: "2026-11-03 to 2026-11-06",
    request: "Plan Tokyo architecture and food with fixed arrival and departure flights; accommodation is not confirmed yet.",
    facts: { destination: "Tokyo", purpose: "architecture and food", travel_dates: "2026-11-03 to 2026-11-06", arrival: "Arrive at Tokyo Haneda at 07:25 on 2026-11-03", departure: "Depart Tokyo Haneda at 23:10 on 2026-11-06", party_size: "2", transport_preference: "公共交通" },
    proposal: { title: "Tokyo architecture and food", objective: "Tokyo architecture and food with fixed flights", theme: "Architecture, neighborhoods, and food", segments: ["Tokyo"], skeleton: ["Early arrival day", "Architecture focus", "Food and neighborhoods", "Late departure day"], tradeoffs: ["Respect jet lag and airport buffers"], assumptions: ["Accommodation not confirmed"], decisionPoints: [] },
    bookings: [flight("Arrival flight to Haneda", "flight_leg", "2026-11-03T07:25", "Shanghai", "Tokyo Haneda"), flight("Departure flight from Haneda", "flight_leg", "2026-11-06T23:10", "Tokyo Haneda", "Shanghai")]
  },
  {
    id: "multi-base-portugal-hotels",
    categories: ["multi-base", "confirmed hotels"],
    destination: "Portugal",
    duration: "2026-10-12 to 2026-10-18",
    request: "Plan Portugal across Lisbon and Porto with confirmed hotels in both bases.",
    facts: { destination: "Lisbon and Porto, Portugal", purpose: "architecture, food, and train-based city change", travel_dates: "2026-10-12 to 2026-10-18", arrival: "Arrive Lisbon airport at 14:30 on 2026-10-12", departure: "Depart Porto airport at 17:50 on 2026-10-18", party_size: "2", transport_preference: "公共交通" },
    proposal: { title: "Lisbon to Porto architecture trip", objective: "Lisbon and Porto multi-base trip", theme: "Architecture, food, and rail transfer", segments: ["Lisbon", "Porto"], skeleton: ["Lisbon base", "Rail transfer to Porto", "Porto base", "Departure"], tradeoffs: ["Avoid one-night base churn"], assumptions: ["Hotels are confirmed"], decisionPoints: [] },
    bookings: [hotel("Lisbon Baixa Hotel", "Lisbon Baixa", "2026-10-12T15:00", "2026-10-15T11:00"), hotel("Porto Ribeira Hotel", "Porto Ribeira", "2026-10-15T15:00", "2026-10-18T11:00")]
  },
  {
    id: "fixed-event-london",
    categories: ["fixed event/session", "reservation/ticket dependent", "single-base"],
    destination: "London",
    duration: "2026-12-04 to 2026-12-07",
    request: "Plan a London weekend around a fixed theatre ticket on Saturday evening.",
    facts: { destination: "London", purpose: "theatre, museums, and markets", travel_dates: "2026-12-04 to 2026-12-07", arrival: "Arrive London Heathrow at 12:10 on 2026-12-04", departure: "Depart London Heathrow at 16:00 on 2026-12-07", party_size: "2", transport_preference: "公共交通" },
    proposal: { title: "London theatre weekend", objective: "London weekend with fixed theatre ticket", theme: "Theatre, museums, and markets", segments: ["London"], skeleton: ["Arrival Friday", "Saturday theatre anchor", "Sunday museums and markets", "Monday departure"], tradeoffs: ["Keep Saturday evening fixed"], assumptions: ["Theatre ticket is confirmed"], decisionPoints: [] },
    bookings: [event("Theatre ticket", "London West End", "2026-12-05T19:30", "2026-12-05T22:00")]
  },
  {
    id: "ticket-dependent-kyoto",
    categories: ["reservation/ticket dependent", "activity-dense", "single-base"],
    destination: "Kyoto",
    duration: "2026-11-10 to 2026-11-14",
    request: "Plan an activity-dense Kyoto trip with temples, gardens, and a tea ceremony that may require reservation.",
    facts: { destination: "Kyoto", purpose: "temples, gardens, tea ceremony, food", travel_dates: "2026-11-10 to 2026-11-14", arrival: "Arrive Kyoto Station around 13:00 on 2026-11-10", departure: "Depart Kyoto Station around 15:00 on 2026-11-14", party_size: "2", transport_preference: "公共交通" },
    proposal: { title: "Kyoto temples and tea", objective: "Kyoto temples, gardens, and tea ceremony", theme: "Temples, gardens, tea, and food", segments: ["Kyoto"], skeleton: ["Arrival", "East Kyoto", "Arashiyama", "Tea and central Kyoto", "Departure"], tradeoffs: ["Prefer meaningful density but avoid impossible cross-city hops"], assumptions: ["Tea ceremony may require reservation"], decisionPoints: [] }
  },
  {
    id: "dense-new-york",
    categories: ["activity-dense", "single-base", "confirmed hotels"],
    destination: "New York City",
    duration: "2026-09-21 to 2026-09-25",
    request: "Plan an activity-dense New York City trip for first-time visitors with a confirmed Midtown hotel.",
    facts: { destination: "New York City", purpose: "first-time highlights, museums, food, skyline", travel_dates: "2026-09-21 to 2026-09-25", arrival: "Arrive JFK at 11:40 on 2026-09-21", departure: "Depart JFK at 20:30 on 2026-09-25", party_size: "4", transport_preference: "公共交通" },
    proposal: { title: "NYC first-time dense trip", objective: "New York City first-time highlights", theme: "Museums, food, skyline, neighborhoods", segments: ["Manhattan", "Brooklyn"], skeleton: ["Arrival and Midtown", "Museum day", "Downtown and Brooklyn", "Central Park and Upper East Side", "Departure"], tradeoffs: ["Dense but geographically coherent"], assumptions: ["Midtown hotel is confirmed"], decisionPoints: [] },
    bookings: [hotel("Midtown Hotel", "Midtown Manhattan", "2026-09-21T15:00", "2026-09-25T11:00")]
  },
  {
    id: "no-accommodation-seoul",
    categories: ["no-accommodation-yet", "single-base", "relaxed"],
    destination: "Seoul",
    duration: "2026-10-20 to 2026-10-23",
    request: "Plan a relaxed Seoul trip focused on neighborhoods, design shops, cafes, and palaces. No accommodation has been chosen.",
    facts: { destination: "Seoul", purpose: "neighborhoods, design shops, cafes, palaces", travel_dates: "2026-10-20 to 2026-10-23", arrival: "Arrive Incheon at 09:20 on 2026-10-20", departure: "Depart Incheon at 19:15 on 2026-10-23", party_size: "2", transport_preference: "公共交通" },
    proposal: { title: "Relaxed Seoul neighborhoods", objective: "Seoul design, cafes, and palaces", theme: "Neighborhoods, design, cafes, palaces", segments: ["Seoul"], skeleton: ["Arrival", "Palaces and hanok area", "Design shops and cafes", "Departure"], tradeoffs: ["Keep routing simple without a hotel base"], assumptions: ["Accommodation not chosen"], decisionPoints: [] }
  }
];

function hotel(title: string, location: string, startAtLocal: string, endAtLocal: string): CorpusBooking {
  return {
    type: "accommodation",
    status: "confirmed",
    title,
    source: "user",
    sourceLabel: "Diagnostic corpus booking",
    constraintStrength: "hard",
    segments: [{ id: `segment-${randomUUID()}`, segmentType: "hotel_stay", title, startAtLocal, endAtLocal, location, constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
}

function flight(title: string, segmentType: "flight_leg", startAtLocal: string, origin: string, destination: string): CorpusBooking {
  return {
    type: "flight",
    status: "confirmed",
    title,
    source: "user",
    sourceLabel: "Diagnostic corpus booking",
    constraintStrength: "hard",
    segments: [{ id: `segment-${randomUUID()}`, segmentType, title, startAtLocal, origin, destination, constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
}

function event(title: string, location: string, startAtLocal: string, endAtLocal: string): CorpusBooking {
  return {
    type: "event",
    status: "confirmed",
    title,
    source: "user",
    sourceLabel: "Diagnostic corpus booking",
    constraintStrength: "hard",
    segments: [{ id: `segment-${randomUUID()}`, segmentType: "event_window", title, startAtLocal, endAtLocal, location, constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
}

try {
  const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) ?? "1");
  const start = Number(process.argv.find((arg) => arg.startsWith("--start="))?.slice("--start=".length) ?? "0");
  const resumeSessionId = process.argv.find((arg) => arg.startsWith("--resume-session="))?.slice("--resume-session=".length);
  const adoptGeneration = process.argv.find((arg) => arg.startsWith("--adopt-generation="))?.slice("--adopt-generation=".length);
  if (process.argv.includes("--append")) {
    try {
      const existing = JSON.parse(await readFile(`${outputBase}.json`, "utf8")) as { cases?: Array<Record<string, unknown>> };
      manifest.push(...(existing.cases ?? []));
    } catch {
      // A missing prior manifest simply starts a new one.
    }
  }
  const maxCases = runMode === "probe" ? 1 : Math.min(Math.max(1, limit), Math.max(0, cases.length - start));
  const inputs = resumeSessionId ? [] : cases.slice(0, maxCases);
  if (adoptGeneration) {
    const separator = adoptGeneration.indexOf(":");
    if (separator < 0) throw new Error("--adopt-generation expects caseId:generationKey");
    const result = await adoptExistingGeneration(adoptGeneration.slice(0, separator), adoptGeneration.slice(separator + 1));
    manifest.push(result);
    await saveManifest(manifest);
  } else if (resumeSessionId) {
    const result = await rerunExistingSession(resumeSessionId);
    manifest.push(result);
    await saveManifest(manifest);
  } else {
    for (const corpusCase of (runMode === "probe" ? inputs : cases.slice(start, start + maxCases))) {
      const result = await runCase(corpusCase);
      manifest.push(result);
      await saveManifest(manifest);
      if (runMode === "probe" && !result.shadowArtifactId) break;
    }
  }
  console.log(JSON.stringify({ ok: true, mode: runMode, databasePath, outputBase, cases: manifest.length, manifest }, null, 2));
} finally {
  store.close();
}
