import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import Fastify from "fastify";
import { LANDI_BLUEPRINT_SKILL } from "@c-assistant/agent-adapters";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { MAH_SUPERVISION_STOP_REASON, MahCliTransport, type MahCommandRunner } from "./mah-cli-transport.js";
import type { MahGenerationMappings } from "./mah-generation-contract.js";
import { createIsolatedGenerationRuntimeServices, createRuntimeServices } from "./runtime-services.js";
import { generationCheckpointEvent } from "./planning-generation.js";
import { itineraryArtifactFromBlueprint } from "./itinerary-publication-review.js";
import { productionReadiness } from "./production-readiness.js";
import { registerIsolatedGenerationWebAgentRoutes, registerWebAgentRoutes } from "./web-agent-routes.js";
import { registerPlanningSessionRoutes } from "./planning-session-routes.js";
import { queueRunner } from "./mah-queue.fixture.test.js";
import { mahStageIdentity, mahBusinessParserContext } from "./mah-blueprint-runtime.js";
import type { MahStageRequest } from "./mah-generation-contract.js";

const ROOT = "/tmp/landi-isolated-composition";
const environment = {
  MAH_TASK_CLI_COMMAND: "/Applications/MAH.app/Contents/Resources/mah/mah-task-runtime/scripts/task-cli/mah",
  MAH_TASK_CLI_EXECUTABLE: "/Applications/MAH.app/Contents/MacOS/MAH",
  MAH_TASK_CLI_MAIN: "/Applications/MAH.app/Contents/Resources/mah/mah-task-runtime/dist/cli/index.js",
  MAH_TASK_CLI_APP: "", MAH_TASK_CLI_TERMINATOR: "--"
};
const json = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

async function fixture(queue?: ReturnType<typeof queueRunner>, options?: Parameters<typeof createIsolatedGenerationRuntimeServices>[2]) {
  const directory = await mkdtemp(join(tmpdir(), "landi-queue-http-"));
  const store = new SqliteWorkspaceStore(join(directory, "isolated.sqlite"));
  store.updateProfile({ ...store.getWorkspace().profile, preferredLanguage: "zh-CN" });
  const created = store.createPlanningSession("travel");
  const now = new Date().toISOString();
  const session = store.savePlanningSession({ ...created, status: "proposal_ready",
    facts: Object.entries({ destination: "测试市", purpose: "了解城市历史", travel_dates: "2026-11-20 to 2026-11-21",
      arrival: "测试市车站 09:00", departure: "测试市车站 18:00", party_size: "2", transport_preference: "walking" })
      .map(([key, value]) => ({ key, value, source: "user" as const, confirmed: true, updatedAt: now })),
    proposal: { version: 1, title: "测试市行程", objective: "了解测试市历史", theme: "城市文化", segments: ["测试市"],
      skeleton: ["2026-11-20", "2026-11-21"], tradeoffs: [], assumptions: [], decisionPoints: [] }, updatedAt: now });
  let taskId = "";
  let cancelled = false;
  let submitCount = 0;
  let cancelCount = 0;
  let showCount = 0;
  let didSubmit!: () => void;
  const submitted = new Promise<void>(resolve => { didSubmit = resolve; });
  const run: MahCommandRunner = async (command, args, options) => {
    assert.equal(command, environment.MAH_TASK_CLI_COMMAND);
    assert.equal(options.env.MAH_TASK_CLI_MAIN, environment.MAH_TASK_CLI_MAIN);
    assert.equal(options.cwd, ROOT);
    assert.equal(args[0], "task");
    if (args[1] === "submit") {
      submitCount++;
      taskId = args[args.indexOf("--task-id") + 1]!;
      const mapping = store.generationCarriers.getByTaskId(taskId)!;
      assert.equal(mapping.status, "submission_unknown", "CLI 调用前必须已经提交 CAS");
      const attachment = await readFile(args[args.indexOf("--attach") + 1]!, "utf8");
      assert.equal(attachment, mapping.requestJson);
      assert.equal(args.includes("--no-write"), true);
      assert.equal(args.includes("--write"), false);
      didSubmit();
      return json({ task_id: taskId, title: args[args.indexOf("--title") + 1],
        audit_ref: `.mah/tasks/${taskId}/audit/audit.ndjson`, events_ref: `.mah/tasks/${taskId}/stream.jsonl`, result_ref: { type: "none" } });
    }
    if (args[1] === "cancel") {
      cancelCount++;
      assert.equal(args[2], taskId);
      assert.ok(store.generationCarriers.getByTaskId(taskId)?.cancelRequestedAt, "取消 CLI 前先持久化意图");
      cancelled = true;
      return json({ ok: true, task_id: taskId });
    }
    if (args[1] === "show") {
      showCount++;
      assert.equal(args[2], taskId);
      return json({ ok: true, project_root: ROOT, task_record_materialized: true,
        task: { task_id: taskId, root_dir: ROOT, status: cancelled ? "cancelled" : "queued", task_lifecycle_revision: cancelled ? 2 : 1 } });
    }
    throw new Error(`隔离检查不允许此命令：${args[1]}`);
  };
  const failures: Array<{ details: Record<string, unknown>; message: string }> = [];
  const dependencies = { store, semanticShadow: { enabled: false, sampleRate: 0, timeoutMs: 1000 },
    semanticDraftCanary: { enabled: false, localEnvironment: false, allowedSessionIds: [] },
    logGenerationFailure: (details: Record<string, unknown>, message: string) => { failures.push({ details, message }); } };
  const makeTransport = () => new MahCliTransport({ mahProjectRoot: ROOT, environment, run: queue?.run ?? run,
    store: store.generationCarriers as MahGenerationMappings, schedulerWaitMs: 500, cancelWaitMs: 100, pollIntervalMs: 5 });
  const services = createIsolatedGenerationRuntimeServices(dependencies, makeTransport(), options);
  const server = Fastify({ logger: false });
  const routes = { store, blueprintGenerationEnabled: true, generation: services.planningGeneration,
    getGeneratingPlan: services.getGeneratingPlan, setGeneratingPlan: services.setGeneratingPlan,
    business: services.business, prepareGeneratedPlanEvidence: async () => ({ workspace: store.getWorkspace(), status: "partial" as const }) };
  return { directory, store, session, server, services, dependencies, makeTransport, routes, submitted, failures,
    counts: () => ({ submitCount, cancelCount, showCount }), taskId: () => taskId,
    async close() { await services.abortGenerationJobs(); await server.close(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("隔离 HTTP 生成入口复用真实编排，取消先落库且不导入晚到结果", async () => {
  const f = await fixture();
  try {
    registerIsolatedGenerationWebAgentRoutes(f.server, f.routes, f.services);
    registerPlanningSessionRoutes(f.server, { store: f.store, generation: f.services.planningGeneration });
    const confirmation = await f.server.inject({ method: "POST", url: `/api/planning-sessions/${f.session.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal(confirmation.statusCode, 202, confirmation.body);
    await f.submitted;
    const status = await f.server.inject({ method: "GET", url: `/api/planning-sessions/${f.session.id}/generation` });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().snapshot.proposalRef.proposalVersion, 1);
    const cancellation = await f.server.inject({ method: "POST", url: `/api/planning-sessions/${f.session.id}/generation/cancel` });
    assert.equal(cancellation.statusCode, 200, cancellation.body);
    await f.services.abortGenerationJobs();
    const mapping = f.store.generationCarriers.getByTaskId(f.taskId())!;
    assert.ok(mapping.cancelRequestedAt);
    assert.equal(mapping.status, "cancelled");
    assert.equal(mapping.resultJson, undefined);
    assert.equal(f.counts().submitCount, 1);
    assert.ok(f.counts().cancelCount >= 1);
    assert.equal(f.store.getResearchSetByGenerationKey(mapping.generationKey), undefined);
  } finally { await f.close(); }
});

test("同一隔离 HTTP 应用从公开候选贯通研究、行程、审阅和草稿 Plan", async () => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  const queue = queueRunner(request => applicationPayload(request, f.store), ROOT);
  f = await fixture(queue, { plannedPlaceImageEnrichment: false });
  try {
    const session = f.store.savePlanningSession({ ...f.session, facts: f.session.facts.map(fact =>
      fact.key === "arrival" ? { ...fact, value: "行程前已抵达测试市" }
      : fact.key === "departure" ? { ...fact, value: "行程结束后离开" } : fact) });
    registerIsolatedGenerationWebAgentRoutes(f.server, f.routes, f.services);
    registerPlanningSessionRoutes(f.server, { store: f.store, generation: f.services.planningGeneration });
    const confirmation = await f.server.inject({ method: "POST", url: `/api/planning-sessions/${session.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal(confirmation.statusCode, 202, confirmation.body);
    const job = f.services.planningGeneration.jobs.get(session.id)!;
    const deadline = Date.now() + 10000;
    while (job.status === "running" && Date.now() < deadline) await setTimeout(10);
    assert.equal(job.status, "succeeded", job.message);
    const status = await f.server.inject({ method: "GET", url: `/api/planning-sessions/${session.id}/generation` });
    assert.equal(status.statusCode, 200);
    const result = status.json();
    const workspace = f.store.getWorkspace();
    assert.equal(result.outputPlanId, workspace.activePlan.id);
    assert.equal(workspace.activePlan.status, "draft");
    assert.equal(workspace.activeBlueprint?.places.length, 3);
    assert.ok(f.store.getPlanBlueprintLineage(workspace.activePlan.id));
    const mappings = f.store.generationCarriers.listForGeneration(job.generationKey);
    await verifyPairedSchemas(mappings.map(mapping => ({ request: mapping.request,
      result: JSON.parse(queue.artifacts.get(mapping.carrierTaskId)!) })));
    for (const operation of ["research_batch", "itinerary_draft", "itinerary_review"]) {
      assert.ok(mappings.some(mapping => mapping.operation === operation && mapping.status === "imported"), operation);
    }
    assert.equal(mappings.some(mapping => mapping.status === "validated"), false);
    assert.equal(new Set(queue.requests.keys()).size, queue.commands.filter(args => args[1] === "submit").length);
    assert.equal(workspace.executionPlan, undefined);
  } finally { await f.close(); }
});

async function verifyPairedSchemas(pairs: Array<{ request: unknown; result: unknown }>): Promise<void> {
  const require = createRequire(import.meta.url);
  const fastify = createRequire(require.resolve("fastify"));
  const compiler = createRequire(fastify.resolve("@fastify/ajv-compiler"));
  const Ajv2020 = compiler("ajv/dist/2020.js");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const names = ["landi-mah-stage-request.v3.schema.json", "landi-mah-stage-result.v2.schema.json",
    "landi-mah-stage-request.schema.json", "landi-mah-stage-result.schema.json"];
  const schemas = await Promise.all(names.map(async name => JSON.parse(await readFile(new URL(`../../../docs/contracts/${name}`, import.meta.url), "utf8"))));
  const [newRequest, newResult, oldRequest, oldResult] = schemas.map(schema => ajv.compile(schema));
  for (const pair of pairs) {
    assert.equal(newRequest(pair.request), true, JSON.stringify(newRequest.errors));
    assert.equal(newResult(pair.result), true, JSON.stringify(newResult.errors));
    const request = structuredClone(pair.request) as any;
    delete request.protocol; delete request.projectRoot;
    request.schemaVersion = 2;
    request.output.envelopeContract = "landi.mah-generation-stage-result.v1";
    request.execution.agentPreference = "mah-routing";
    request.execution.personalOsSlotClass = "interactive";
    delete request.execution.adaptiveProducerClockV1;
    const result = structuredClone(pair.result) as any;
    result.schemaVersion = 1; delete result.requestSha256; delete result.parentCheckpoint;
    assert.equal(oldRequest(request), true, JSON.stringify(oldRequest.errors));
    assert.equal(oldResult(result), true, JSON.stringify(oldResult.errors));
    assert.equal(newRequest(request), false);
    assert.equal(newResult(result), false);
    assert.equal(oldRequest(pair.request), false);
    assert.equal(oldResult(pair.result), false);
  }
}

function applicationPayload(request: MahStageRequest, store: SqliteWorkspaceStore, dayCount = 2): Record<string, unknown> {
  if (request.operation === "itinerary_review") return { issues: [] };
  if (request.operation === "planned_place_image_enrichment") return { images: [] };
  if (request.operation === "research_batch") return {
    id: mahStageIdentity(request)?.scope ?? request.batchId, scopeLabel: "测试市", completedAt: new Date().toISOString(),
    sources: [{ id: "source-museum", title: "测试博物馆官方资料", authority: "测试博物馆", url: "https://example.com/museum",
      retrievedAt: "2026-11-09", status: "verified", official: true }],
    places: ["甲馆", "乙馆", ...(dayCount === 3 ? ["丙馆"] : []), "旅馆"].map((name, index) => ({ id: `place-${index}`, name,
      locationLabel: "测试市中心", city: "测试市", area: "中心区", category: index === dayCount ? "hotel" : "museum",
      coordinates: [31.2 + index * 0.001, 121.4], priority: "preferred", durationMinutes: 300,
      ...(index === dayCount ? { accommodation: { state: "recommended" } } : {}),
      whyWorthIt: "可核验的虚构测试地点。", plan: "在已确认日期内参观或住宿。", sourceUrls: ["https://example.com/museum"] })),
    events: [], relationships: [], localFoods: [], localProducts: [], experienceThemes: [], travelTips: [], actionRequirements: []
  };
  if (request.operation === "itinerary_draft" || request.operation === "itinerary_repair") {
    const research = store.getResearchSetByGenerationKey(request.generationKey)!;
    return { title: "测试市文化行程", summary: "两天了解城市文化。", language: "zh-CN", destinations: ["测试市"],
      startDate: "2026-11-20", endDate: `2026-11-${19 + dayCount}`, days: ["甲馆", "乙馆", ...(dayCount === 3 ? ["丙馆"] : [])].map((name, index) => {
        const placeId = research.places.find(place => place.name === name)!.id;
        return { id: `day-${index}`, date: `2026-11-${20 + index}`, kind: "scheduled", city: "测试市", title: name, summary: "参观城市文化展览。",
          stops: [{ placeId, order: 1, time: "10:00" }], candidatePlaceIds: [],
          blocks: [{ id: `block-${index}`, kind: "stop", order: 1, placeId, startTime: "10:00", durationMinutes: 300, evidence: [] }] };
      }), movements: [] };
  }
  throw new Error(`隔离成功路径未声明操作：${request.operation}`);
}

for (const phase of ["explore", "images"] as const) test(`可选${phase === "explore" ? "研究" : "图片"}中停机与重启保留原 UUID，不持久化旅行取消`, async () => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  let entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const queue = queueRunner(request => applicationPayload(request, f.store, phase === "explore" ? 3 : 2), ROOT);
  const originalRun = queue.run;
  let stoppedTaskId = "";
  queue.run = async (command, args, options) => {
    const response = await originalRun(command, args, options);
    if (args[1] === "submit") {
      const request = JSON.parse(await readFile(args[args.indexOf("--attach") + 1]!, "utf8")) as MahStageRequest;
      if (phase === "explore" ? mahStageIdentity(request)?.scope === "explore-supply" : request.operation === "planned_place_image_enrichment") {
        stoppedTaskId = request.carrierTaskId;
        entered();
        if (!options.signal?.aborted) await new Promise<void>(resolve => options.signal!.addEventListener("abort", () => resolve(), { once: true }));
        assert.equal(options.signal?.reason, MAH_SUPERVISION_STOP_REASON);
        return { code: -1, stdout: "", stderr: "", aborted: true };
      }
    }
    return response;
  };
  const isolation = { plannedPlaceImageEnrichment: phase === "images", probeImageUrl: async () => false,
    lookupKnownImages: async () => ({ images: [], sources: [], omitted: [] }) };
  f = await fixture(queue, isolation);
  try {
    const session = f.store.savePlanningSession({ ...f.session,
      ...(phase === "explore" ? { proposal: { ...f.session.proposal!, skeleton: ["2026-11-20", "2026-11-21", "2026-11-22"] } } : {}),
      facts: f.session.facts.map(fact =>
      fact.key === "arrival" ? { ...fact, value: "行程前已抵达测试市" }
      : fact.key === "departure" ? { ...fact, value: "行程结束后离开" }
      : phase === "explore" && fact.key === "travel_dates" ? { ...fact, value: "2026-11-20 to 2026-11-22" } : fact) });
    registerIsolatedGenerationWebAgentRoutes(f.server, f.routes, f.services);
    const confirmation = await f.server.inject({ method: "POST", url: `/api/planning-sessions/${session.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal(confirmation.statusCode, 202, confirmation.body);
    await Promise.race([reached, setTimeout(10000, undefined, { ref: false }).then(() => { throw new Error("隔离检查未进入预定可选阶段。"); })]);
    await f.services.abortGenerationJobs();
    const mapping = f.store.generationCarriers.getByTaskId(stoppedTaskId)!;
    assert.equal(mapping.cancelRequestedAt, undefined);
    assert.equal(f.store.getBlueprintGeneration(mapping.generationKey)?.status, "running");
    assert.ok(f.store.getResearchSetByGenerationKey(mapping.generationKey));
    const identities = [...queue.requests.keys()];
    queue.setStatus("queued");
    const restarted = createIsolatedGenerationRuntimeServices(f.dependencies, f.makeTransport(), isolation);
    await restarted.recoverMahGenerations();
    await restarted.abortGenerationJobs();
    assert.deepEqual([...queue.requests.keys()], identities);
    assert.equal(queue.commands.some(args => args[1] === "cancel"), false);
    assert.equal(f.store.generationCarriers.getByTaskId(stoppedTaskId)?.cancelRequestedAt, undefined);
  } finally { await f.close(); }
});

test("隔离应用正常停机不取消远端，重启仅查询主库原 UUID", async () => {
  const f = await fixture();
  try {
    registerIsolatedGenerationWebAgentRoutes(f.server, f.routes, f.services);
    const confirmation = await f.server.inject({ method: "POST", url: `/api/planning-sessions/${f.session.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal(confirmation.statusCode, 202, confirmation.body);
    await f.submitted;
    await f.services.abortGenerationJobs();
    const identity = f.taskId();
    const before = f.counts();
    assert.equal(before.cancelCount, 0);
    const restarted = createIsolatedGenerationRuntimeServices(f.dependencies, f.makeTransport());
    await restarted.recoverMahGenerations();
    await restarted.abortGenerationJobs();
    assert.equal(f.counts().submitCount, 1);
    assert.equal(f.counts().cancelCount, 0);
    assert.ok(f.counts().showCount > before.showCount);
    assert.equal(f.store.generationCarriers.listForGeneration(f.store.generationCarriers.getByTaskId(identity)!.generationKey).length, 1);
  } finally { await f.close(); }
});

test("生产 HTTP 门禁不能通过环境、请求参数或伪造隔离对象开启", async () => {
  const f = await fixture();
  const previous = process.env.LANDI_ISOLATED_GENERATION;
  try {
    process.env.LANDI_ISOLATED_GENERATION = "true";
    const production = createRuntimeServices(f.dependencies);
    assert.throws(() => registerIsolatedGenerationWebAgentRoutes(f.server, { ...f.routes, generation: production.planningGeneration,
      business: production.business }, production), /组合身份不一致/);
    registerWebAgentRoutes(f.server, f.routes);
    const result = await f.server.inject({ method: "POST", url: `/api/planning-sessions/${f.session.id}/confirm?isolated=true`,
      headers: { "x-landi-isolated": "true" }, payload: { proposalVersion: 1, isolated: true } });
    assert.equal(result.statusCode, 503);
    assert.equal(f.counts().submitCount, 0);
    assert.equal(productionReadiness().generation, false);
    assert.equal(productionReadiness().unattendedEmail, false);
  } finally {
    if (previous === undefined) delete process.env.LANDI_ISOLATED_GENERATION;
    else process.env.LANDI_ISOLATED_GENERATION = previous;
    await f.close();
  }
});


for (const mode of ["日期", "全行程", "拒绝后第二轮停机"] as const) test(`真实隔离HTTP${mode}双轮沿原映射完成草稿lineage`, async () => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  let entered!: () => void;
  const secondSubmitted = new Promise<void>(resolve => { entered = resolve; });
  let stopped = false;
  let resumed = false;
  let stoppedTaskId = "";
  let unchangedDay: unknown;
  let firstFrozen: unknown;
  const queue = queueRunner(request => {
    const identity = mahStageIdentity(request);
    const mappings = f.store.generationCarriers.listForGeneration(request.generationKey);
    const secondImported = mappings.some(mapping => mapping.status === "imported" && mahStageIdentity(mapping.request as MahStageRequest)?.phase === "质量修复" && mahStageIdentity(mapping.request as MahStageRequest)?.round === 2);
    if (request.operation === "itinerary_review") return { issues: secondImported ? [] : [{
      code: mode === "全行程" ? "route_efficiency" : "excursion_meeting_point",
      date: mode === "全行程" ? null : "2026-11-20", blocking: true,
      explanation: "同一项已确认的行程问题仍需修复。", repairInstruction: "保持已有安排，完善此项内容。"
    }] };
    if (identity?.phase !== "质量修复") return applicationPayload(request, f.store);
    const payload = itineraryArtifactFromBlueprint(f.store.getTripBlueprintByGenerationKey(request.generationKey)!) as unknown as Record<string, unknown>;
    if (identity.round === 2 && !firstFrozen) {
      const first = mappings.find(mapping => mahStageIdentity(mapping.request as MahStageRequest)?.phase === "质量修复" && mahStageIdentity(mapping.request as MahStageRequest)?.round === 1)!;
      firstFrozen = [first.requestJson, first.requestSha256, first.resultJson, first.resultSha256];
    }
    const days = payload.days as Array<Record<string, unknown>>;
    if (!unchangedDay) unchangedDay = structuredClone(f.store.getTripBlueprintByGenerationKey(request.generationKey)!.days[1]);
    payload.title = `第${identity.round}轮完整修复标题`;
    payload.summary = `第${identity.round}轮修复说明。`;
    for (const day of days) day.summary = `第${identity.round}轮内容。`;
    const parser = mahBusinessParserContext(request);
    if (parser?.dayPatch) payload.days = days.filter(day => parser.dayPatch!.dates.includes(String(day.date)));
    if (mode === "拒绝后第二轮停机" && identity.round === 1) {
      for (const day of payload.days as Array<Record<string, unknown>>) { day.stops = []; day.blocks = []; }
    }
    return payload;
  }, ROOT);
  const originalRun = queue.run;
  queue.run = async (command, args, options) => {
    const result = await originalRun(command, args, options);
    if (args[1] === "submit") {
      const request = queue.requests.get(args[args.indexOf("--task-id") + 1]!)!;
      if (mode === "拒绝后第二轮停机" && mahStageIdentity(request)?.phase === "质量修复" && mahStageIdentity(request)?.round === 2 && !stopped) {
        stopped = true; stoppedTaskId = request.carrierTaskId; entered();
        if (!options.signal?.aborted) await new Promise<void>(resolve => options.signal!.addEventListener("abort", () => resolve(), { once: true }));
        return { code: -1, stdout: "", stderr: "", aborted: true };
      }
    }
    return result;
  };
  f = await fixture(queue, { plannedPlaceImageEnrichment: false });
  let restarted: ReturnType<typeof createIsolatedGenerationRuntimeServices> | undefined;
  let continuation: ReturnType<typeof createIsolatedGenerationRuntimeServices> | undefined;
  let continuationServer: ReturnType<typeof Fastify> | undefined;
  let activeServices = f.services;
  let activeServer = f.server;
  try {
    const session = f.store.savePlanningSession({ ...f.session, facts: f.session.facts.map(fact =>
      fact.key === "arrival" ? { ...fact, value: "行程前已抵达测试市" }
      : fact.key === "departure" ? { ...fact, value: "行程结束后离开" } : fact) });
    registerIsolatedGenerationWebAgentRoutes(f.server, f.routes, f.services);
    registerPlanningSessionRoutes(f.server, { store: f.store, generation: f.services.planningGeneration });
    const confirm = () => activeServer.inject({ method: "POST", url: `/api/planning-sessions/${session.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal((await confirm()).statusCode, 202);
    const waitForJob = async (services: typeof f.services) => {
      const job = services.planningGeneration.jobs.get(session.id)!;
      const deadline = Date.now() + 10000;
      while (job.status === "running" && Date.now() < deadline) await setTimeout(10);
      return job;
    };
    if (mode === "拒绝后第二轮停机") {
      await Promise.race([secondSubmitted, setTimeout(10000, undefined, { ref: false }).then(() => { throw new Error("未进入第二轮修复。"); })]);
      await f.services.abortGenerationJobs();
      const before = f.store.generationCarriers.getByTaskId(stoppedTaskId)!;
      const originalBytes = before.requestJson;
      const originalReviewEvents = f.store.getBlueprintGenerationEvents(before.generationKey).filter(event => event.id.startsWith("mah-blueprint-"));
      assert.equal(mahBusinessParserContext(before.request as MahStageRequest)?.dayPatch, undefined);
      const submitCount = queue.commands.filter(args => args[1] === "submit").length;
      restarted = createIsolatedGenerationRuntimeServices(f.dependencies, f.makeTransport(), { plannedPlaceImageEnrichment: false });
      await restarted.recoverMahGenerations();
      const recoveredJob = await waitForJob(restarted);
      assert.notEqual(recoveredJob.status, "succeeded", "恢复不得为尚未提交的审阅阶段自动创建任务。");
      const recovered = f.store.generationCarriers.getByTaskId(stoppedTaskId)!;
      assert.equal(recovered.status, "imported", JSON.stringify({ stage: recoveredJob.stage, status: recoveredJob.status, failureCode: recoveredJob.failureCode, message: recoveredJob.message,
        generationFailure: f.store.getBlueprintGeneration(recovered.generationKey)?.failure,
        mappings: f.store.generationCarriers.listForGeneration(recovered.generationKey).map(mapping => ({ operation: mapping.operation, stageIdentity: mahStageIdentity(mapping.request as MahStageRequest), status: mapping.status })),
        failures: f.failures }));
      assert.equal(recovered.requestJson, originalBytes);
      const replayedEvents = f.store.getBlueprintGenerationEvents(recovered.generationKey);
      for (const event of originalReviewEvents) assert.deepEqual(replayedEvents.filter(candidate => candidate.id === event.id), [event]);
      assert.equal(queue.commands.filter(args => args[1] === "submit").length, submitCount);
      const checkpoint = f.store.getTripBlueprintByGenerationKey(recovered.generationKey)!;
      assert.equal(checkpoint.title, "第2轮完整修复标题");
      assert.deepEqual(checkpoint.days[1], unchangedDay);
      await restarted.abortGenerationJobs();
      // 重新组合的服务实例中的既有HTTP确认是下一未提交阶段的显式用户动作。
      continuation = createIsolatedGenerationRuntimeServices(f.dependencies, f.makeTransport(), { plannedPlaceImageEnrichment: false });
      continuationServer = Fastify({ logger: false });
      registerIsolatedGenerationWebAgentRoutes(continuationServer, { ...f.routes, generation: continuation.planningGeneration,
        business: continuation.business, getGeneratingPlan: continuation.getGeneratingPlan, setGeneratingPlan: continuation.setGeneratingPlan }, continuation);
      registerPlanningSessionRoutes(continuationServer, { store: f.store, generation: continuation.planningGeneration });
      activeServices = continuation;
      activeServer = continuationServer;
      assert.equal((await confirm()).statusCode, 202);
      resumed = true;
    }
    const job = await waitForJob(activeServices);
    assert.equal(job.status, "succeeded", job.message);
    const mappings = f.store.generationCarriers.listForGeneration(job.generationKey);
    const repairs = mappings.filter(mapping => mahStageIdentity(mapping.request as MahStageRequest)?.phase === "质量修复");
    assert.deepEqual(repairs.map(mapping => mahStageIdentity(mapping.request as MahStageRequest)?.round).sort(), [1, 2]);
    assert.equal(repairs.find(mapping => mahStageIdentity(mapping.request as MahStageRequest)?.round === 2)?.status, "imported");
    assert.equal(repairs.find(mapping => mahStageIdentity(mapping.request as MahStageRequest)?.round === 1)?.status, mode === "拒绝后第二轮停机" ? "artifact_invalid" : "imported");
    const workspace = f.store.getWorkspace();
    const status = await activeServer.inject({ method: "GET", url: `/api/planning-sessions/${session.id}/generation` });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().outputPlanId, workspace.activePlan.id);
    await verifyPairedSchemas(mappings.map(mapping => ({ request: mapping.request, result: JSON.parse(queue.artifacts.get(mapping.carrierTaskId)!) })));
    for (const mapping of mappings) assert.equal(mapping.requestJson, queue.rawRequests.get(mapping.carrierTaskId));
    const first = repairs.find(mapping => mahStageIdentity(mapping.request as MahStageRequest)?.round === 1)!;
    assert.deepEqual([first.requestJson, first.requestSha256, first.resultJson, first.resultSha256], firstFrozen);
    assert.equal(workspace.activePlan.status, "draft");
    assert.ok(f.store.getPlanBlueprintLineage(workspace.activePlan.id));
    assert.equal(workspace.executionPlan, undefined);
    assert.equal(new Set(queue.requests.keys()).size, queue.commands.filter(args => args[1] === "submit").length);
    if (mode === "拒绝后第二轮停机") assert.equal(resumed, true);
  } finally { await continuation?.abortGenerationJobs(); await continuationServer?.close(); await restarted?.abortGenerationJobs(); await f.close(); }
});


test("可选研究保存失败按精确候选拒绝，保留原行程并编译草稿", async () => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  const queue = queueRunner(request => applicationPayload(request, f.store, 3), ROOT);
  f = await fixture(queue, { plannedPlaceImageEnrichment: false });
  const originalSave = f.store.saveResearchSetAndTripBlueprint.bind(f.store);
  let refused = 0;
  f.store.saveResearchSetAndTripBlueprint = (...args: Parameters<typeof originalSave>) => {
    if (args[3]?.carrierTaskIds.some(id => mahStageIdentity(f.store.generationCarriers.getByTaskId(id)!.request as MahStageRequest)?.scope === "explore-supply")) {
      refused += 1;
      throw new Error("受控可选研究保存失败。");
    }
    return originalSave(...args);
  };
  try {
    const session = f.store.savePlanningSession({ ...f.session,
      proposal: { ...f.session.proposal!, skeleton: ["2026-11-20", "2026-11-21", "2026-11-22"] },
      facts: f.session.facts.map(fact => fact.key === "arrival" ? { ...fact, value: "行程前已抵达测试市" }
        : fact.key === "departure" ? { ...fact, value: "行程结束后离开" }
        : fact.key === "travel_dates" ? { ...fact, value: "2026-11-20 to 2026-11-22" } : fact) });
    registerIsolatedGenerationWebAgentRoutes(f.server, f.routes, f.services);
    registerPlanningSessionRoutes(f.server, { store: f.store, generation: f.services.planningGeneration });
    const confirmation = await f.server.inject({ method: "POST", url: `/api/planning-sessions/${session.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal(confirmation.statusCode, 202);
    const job = f.services.planningGeneration.jobs.get(session.id)!;
    const deadline = Date.now() + 10000;
    while (job.status === "running" && Date.now() < deadline) await setTimeout(10);
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(refused, 1);
    const mappings = f.store.generationCarriers.listForGeneration(job.generationKey);
    const rejected = mappings.find(mapping => mahStageIdentity(mapping.request as MahStageRequest)?.scope === "explore-supply")!;
    assert.equal(rejected.status, "artifact_invalid");
    assert.ok(rejected.resultSha256);
    assert.equal(mappings.some(mapping => mapping.status === "validated"), false);
    const status = await f.server.inject({ method: "GET", url: `/api/planning-sessions/${session.id}/generation` });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().outputPlanId, f.store.getWorkspace().activePlan.id);
    assert.equal(f.store.getWorkspace().activePlan.status, "draft");
    assert.ok(f.store.getPlanBlueprintLineage(f.store.getWorkspace().activePlan.id));
  } finally { f.store.saveResearchSetAndTripBlueprint = originalSave; await f.close(); }
});


test("generating状态缺少原生成记录时入队零写入且不提交任务", async () => {
  const f = await fixture();
  const originalStart = f.store.startPlanGenerationRun;
  const originalSave = f.store.saveBlueprintGeneration;
  const originalStatus = f.store.updatePlanningSessionStatus;
  let writes = 0;
  const rejectWrite = () => { writes += 1; throw new Error("不应在恢复身份核对前写入。"); };
  try {
    const before = f.store.getPlanningSessionById(f.session.id);
    const session = { ...f.session, status: "generating" as const, confirmedProposalVersion: f.session.proposal!.version };
    const workspace = f.store.getWorkspace();
    f.store.startPlanGenerationRun = rejectWrite;
    f.store.saveBlueprintGeneration = rejectWrite;
    f.store.updatePlanningSessionStatus = rejectWrite;
    assert.throws(() => f.services.planningGeneration.enqueuePlanningSessionGeneration(session, workspace), { code: "mah_generation_context_missing" });
    assert.equal(writes, 0);
    assert.equal(f.services.planningGeneration.jobs.size, 0);
    assert.equal(f.counts().submitCount, 0);
    assert.deepEqual(f.store.getPlanningSessionById(f.session.id), before);
    assert.equal(f.store.getBlueprintGeneration(f.services.planningGeneration.blueprintGenerationKey(session.id, session.confirmedProposalVersion)), undefined);
  } finally {
    f.store.startPlanGenerationRun = originalStart;
    f.store.saveBlueprintGeneration = originalSave;
    f.store.updatePlanningSessionStatus = originalStatus;
    await f.close();
  }
});


test("三类耐久检查点事件重放保留原时间和数量，内容改变仍被严格拒绝", async () => {
  const f = await fixture();
  try {
    const session = f.store.savePlanningSession({ ...f.session, status: "proposal_confirmed", confirmedProposalVersion: 1 });
    const generationKey = f.services.planningGeneration.blueprintGenerationKey(session.id, 1);
    f.store.saveBlueprintGeneration({ generationKey, proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: LANDI_BLUEPRINT_SKILL, stage: "itinerary", status: "running",
      createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z" });
    for (const prefix of ["mah-import", "mah-blueprint", "mah-ready"]) {
      const event = { id: `${prefix}-受控事件`, generationKey,
        stage: prefix === "mah-ready" ? "ready" as const : "itinerary" as const,
        status: prefix === "mah-ready" ? "completed" as const : "running" as const,
        detail: "受控检查点已保存。", savedPlaceCount: 3, createdAt: "2026-11-09T00:00:00.000Z" };
      const original = f.store.appendBlueprintGenerationEvent(event);
      const before = f.store.getBlueprintGenerationEvents(generationKey);
      const replayed = generationCheckpointEvent(f.store, { ...event, createdAt: "2026-11-09T01:00:00.000Z" });
      assert.equal(replayed.createdAt, original.createdAt);
      assert.deepEqual(f.store.appendBlueprintGenerationEvent(replayed), original);
      assert.deepEqual(f.store.getBlueprintGenerationEvents(generationKey), before);
      for (const changed of [{ savedPlaceCount: 4 }, { detail: "改变了已保存的事件说明。" }]) {
        assert.throws(() => f.store.appendBlueprintGenerationEvent(generationCheckpointEvent(f.store, {
          ...event, ...changed, createdAt: "2026-11-09T02:00:00.000Z"
        })), /已绑定到不同内容/);
        assert.deepEqual(f.store.getBlueprintGenerationEvents(generationKey), before);
      }
    }
  } finally { await f.close(); }
});

test('normal confirmation after a queue timeout reuses the original research Task and can finish the plan', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  const queue = queueRunner(request => applicationPayload(request, f.store), ROOT);
  queue.setStatus('queued');
  f = await fixture(queue, { plannedPlaceImageEnrichment: false });
  try {
    const session = f.store.savePlanningSession({ ...f.session, facts: f.session.facts.map(fact =>
      fact.key === 'arrival' ? { ...fact, value: '行程前已抵达测试市' }
      : fact.key === 'departure' ? { ...fact, value: '行程结束后离开' } : fact) });
    registerIsolatedGenerationWebAgentRoutes(f.server, f.routes, f.services);
    registerPlanningSessionRoutes(f.server, { store: f.store, generation: f.services.planningGeneration });
    const confirm = () => f.server.inject({ method: 'POST', url: `/api/planning-sessions/${session.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal((await confirm()).statusCode, 202);
    const first = f.services.planningGeneration.jobs.get(session.id)!;
    let deadline = Date.now() + 5000;
    while (first.status === 'running' && Date.now() < deadline) await setTimeout(10);
    assert.equal(first.failureCode, 'mah_queue_wait_timed_out', first.message);
    const mapping = f.store.generationCarriers.listForGeneration(first.generationKey)[0]!;
    const frozen = [mapping.carrierTaskId, mapping.requestJson, mapping.requestSha256];
    queue.setStatus('completed');
    assert.equal((await confirm()).statusCode, 202);
    const retried = f.services.planningGeneration.jobs.get(session.id)!;
    deadline = Date.now() + 10000;
    while (retried.status === 'running' && Date.now() < deadline) await setTimeout(10);
    assert.equal(retried.status, 'succeeded', retried.message);
    const original = f.store.generationCarriers.getByTaskId(mapping.carrierTaskId)!;
    assert.deepEqual([original.carrierTaskId, original.requestJson, original.requestSha256], frozen);
    assert.equal(queue.commands.filter(args => args[1] === 'submit' && args.includes(mapping.carrierTaskId)).length, 1);
    assert.ok(f.store.getPlanningSessionById(session.id)?.outputPlanId);
  } finally { await f.close(); }
});
