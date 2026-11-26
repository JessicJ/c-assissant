import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LANDI_BLUEPRINT_SKILL } from "../packages/agent-adapters/src/index.js";
import { assertTripBlueprintIntegrity, compileTripBlueprint, importSkillItinerary, importSkillResearchBatches, type ResearchSet } from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { MahBlueprintRuntimeAdapter, mahStageIdentity } from "../apps/server/src/mah-blueprint-runtime.js";
import { MahCliTransport, MAH_SUPERVISION_STOP_REASON, type MahCommandRunner } from "../apps/server/src/mah-cli-transport.js";
import { canonicalJson, sha256, type MahStageRequest, type MahCarrierMapping, type MahGenerationMappings } from "../apps/server/src/mah-generation-contract.js";
import { queueRunner } from "../apps/server/src/mah-queue.fixture.test.js";
import { mergePlannedPlaceImageEnrichment } from "../apps/server/src/planned-place-image-coverage.js";
import { completionResearchBatchId } from "../apps/server/src/planning-generation.js";
import { currentPlanReadModel } from "../apps/web/src/current-plan-read-model.js";

const ROOT = "/tmp/landi-mah-stage-identity";
const NOW = "2026-10-13T00:00:00.000Z";
const PROFILE = { preferredLanguage: "zh-CN", nationality: "中国", gender: "not_specified" as const, immigrationStatus: "unknown" as const };
const ENV = { LANDI_MAH_CLI_COMMAND: "/受控/mah", LANDI_MAH_CLI_EXECUTABLE: "/受控/node", LANDI_MAH_CLI_MAIN: "/受控/index.js" };

// 保留原适配器、公开传输校验、Importer、Compiler 和事务；只替换外部 CLI。
async function fixture(dayCount = 1, placeCount = 1) {
  const directory = await mkdtemp(join(tmpdir(), "landi-mah-stage-identity-"));
  const path = join(directory, "workspace.sqlite");
  let storage = new SqliteWorkspaceStore(path);
  let research: ResearchSet;
  let imagePayload: (request: MahStageRequest) => Record<string, unknown> = validImagePayload;
  const mock = queueRunner(request => {
    if (request.operation === "planned_place_image_enrichment") return imagePayload(request);
    if (request.operation !== "research_batch") return itineraryPayload(research, dayCount);
    const payload = researchPayload();
    payload.places = Array.from({ length: placeCount }, (_, index) => ({ ...structuredClone(payload.places[0]!), id: `museum-${index}`, name: `测试博物馆${index + 1}` }));
    return payload;
  }, ROOT);
  function services(store = storage, run: MahCommandRunner = mock.run) {
    const mappings = store.generationCarriers as MahGenerationMappings;
    const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: mappings, environment: ENV, run, schedulerWaitMs: 25, cancelWaitMs: 10, pollIntervalMs: 1 });
    const adapter = new MahBlueprintRuntimeAdapter({ mappings, transport, checkpoint: key => store.getGenerationCarrierCheckpoint(key) });
    return { mappings, transport, adapter };
  }
  const session = storage.createPlanningSession("travel", new Date(NOW));
  storage.savePlanningSession({ ...session, status: "proposal_confirmed", proposal: {
    version: 1, title: "测试市一日行程", objective: "参观城市博物馆", theme: "城市历史", segments: ["测试市"], skeleton: ["2026-10-20"], tradeoffs: [], assumptions: [], decisionPoints: []
  }, confirmedProposalVersion: 1, updatedAt: NOW });
  const context = { generationKey: `${session.id}:1:${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`, proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL };
  storage.saveBlueprintGeneration({ ...context, status: "running", stage: "research", createdAt: NOW, updatedAt: NOW });
  const first = services();
  const batch = await first.adapter.runWithGenerationContext(context, () => first.adapter.generateSkillResearchBatch({ request: "为测试市规划一天。", batch: { id: "scope-test-city", scopeLabel: "测试市中心" }, completedAt: NOW, profile: PROFILE }));
  research = importSkillResearchBatches([batch], { researchSetId: "research-stage-identity", ...context, createdAt: NOW, updatedAt: NOW });
  const researchCarrier = first.adapter.carrierForCandidate(batch)!;
  research = storage.saveResearchSet(research, { carrierTaskIds: [researchCarrier.carrierTaskId], expectedCarriers: [researchCarrier], generationEvent: event("研究保存", "research") });
  const initial = await first.adapter.runWithGenerationContext(context, () => first.adapter.generateSkillItinerary({ request: "为测试市规划一天。", research, profile: PROFILE }));
  save(initial, 1);
  function event(id: string, stage: "research" | "itinerary" | "ready" = "itinerary") {
    return { id, generationKey: context.generationKey, stage, status: "running" as const, detail: "保存受控回归检查点。", savedPlaceCount: research.places.length, createdAt: NOW };
  }
  function save(candidate: typeof initial, version: number) {
    const blueprint = importSkillItinerary(research, candidate, { blueprintId: "blueprint-stage-identity", blueprintVersion: version, createdAt: NOW });
    assertTripBlueprintIntegrity(blueprint, { expectedResearchPlaceIds: research.places.map(place => place.id) });
    const mapping = (storage.generationCarriers as MahGenerationMappings).listForGeneration(context.generationKey).find(mapping => mapping.status === "validated" && mapping.operation !== "research_batch")!;
    assert.ok(mapping, "每次保存必须消费本轮已验证映射");
    return storage.saveTripBlueprint(blueprint, { carrierTaskIds: [mapping.carrierTaskId], expectedCarriers: [expected(mapping)], generationEvent: event(`行程保存-${version}`) });
  }
  function repair(adapter: MahBlueprintRuntimeAdapter, round: number, original = initial, dateScoped = true, signal?: AbortSignal) {
    return adapter.runWithGenerationContext(context, () => adapter.runWithStageContext({ phase: "质量修复", round, scope: "全行程" }, () => adapter.generateSkillItinerary({
      request: "连续两轮纠正尚未解决的相同质量问题。", research, profile: PROFILE,
      ...(dateScoped ? { dayPatch: { original, dates: ["2026-10-20"] } } : {}),
      repair: { rejected: original, issues: ["同日内容仍需完善。"] }, ...(signal ? { signal } : {})
    })));
  }
  return { path, services, mock, context, initial, initialBatch: batch, repair, save, event, setImagePayload(value: typeof imagePayload) { imagePayload = value; },
    get storage() { return storage; }, get research() { return research; },
    reopen() { storage.close(); storage = new SqliteWorkspaceStore(path); return services(); },
    async close() { storage.close(); await rm(directory, { recursive: true, force: true }); }
  };
}
function expected(mapping: MahCarrierMapping) { return { carrierTaskId: mapping.carrierTaskId, requestSha256: mapping.requestSha256, resultSha256: mapping.resultSha256! }; }
function frozen(mapping: MahCarrierMapping) { return [mapping.requestJson, mapping.requestSha256, mapping.resultJson, mapping.resultSha256]; }
function repairs(mappings: MahGenerationMappings, generationKey: string) { return mappings.listForGeneration(generationKey).filter(mapping => mapping.operation === "itinerary_repair") as MahCarrierMapping[]; }

for (const dateScoped of [true, false]) test(`${dateScoped ? "同日期" : "全行程相同问题"}双轮修复各自导入，并原子编译唯一草稿`, async () => {
  const f = await fixture();
  try {
    const first = f.services();
    const candidate1 = await f.repair(first.adapter, 1, f.initial, dateScoped);
    f.save(candidate1, 2);
    const mapping1 = repairs(first.mappings, f.context.generationKey)[0]!;
    const before = frozen(mapping1);
    // 真正关闭并重建文件库；父检查点已变，回放第一轮仍使用冻结的父身份。
    const reopened = f.reopen();
    const replay = await f.repair(reopened.adapter, 1, f.initial, dateScoped);
    assert.deepEqual(replay, candidate1);
    assert.deepEqual(frozen(reopened.mappings.getByTaskId(mapping1.carrierTaskId) as MahCarrierMapping), before);
    const candidate2 = await f.repair(reopened.adapter, 2, candidate1, dateScoped);
    const blueprint = f.save(candidate2, 3);
    const [saved1, saved2] = repairs(reopened.mappings, f.context.generationKey);
    assert.equal(saved1!.status, "imported"); assert.equal(saved2!.status, "imported");
    assert.notEqual(saved1!.carrierTaskId, saved2!.carrierTaskId);
    assert.notEqual(saved1!.batchId, saved2!.batchId);
    assert.equal(saved1!.attempt, 1); assert.equal(saved2!.attempt, 1);
    assert.match(saved2!.carrierTaskId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(frozen(saved1!), before);
    assert.notDeepEqual(saved1!.request.parentCheckpoint, saved2!.request.parentCheckpoint);
    assert.deepEqual([mahStageIdentity(saved1!.request)?.round, mahStageIdentity(saved2!.request)?.round], [1, 2]);
    assert.equal(mahStageIdentity(saved1!.request)?.scope, mahStageIdentity(saved2!.request)?.scope);
    assert.equal(mahStageIdentity(saved2!.request)?.phase, "质量修复");
    const compiled = compileTripBlueprint(blueprint, { createdAt: NOW });
    const mappings = reopened.mappings.listForGeneration(f.context.generationKey) as MahCarrierMapping[];
    const commit = { generationKey: f.context.generationKey, carrierTaskIds: mappings.map(m => m.carrierTaskId), expectedCarriers: mappings.map(expected), generationEvent: { ...f.event("唯一草稿", "ready"), status: "completed" as const } };
    assert.throws(() => f.storage.createCompiledBlueprintPlan(compiled, "codex", { ...commit, expectedCarriers: commit.expectedCarriers.map(m => ({ ...m, resultSha256: "0".repeat(64) })) }), /摘要/);
    assert.equal(f.storage.getPlanBlueprintLineageByCompilationKey(compiled.lineage.compilationKey), undefined);
    assert.equal(f.storage.getBlueprintGenerationEvents(f.context.generationKey).some(e => e.id === "唯一草稿"), false);
    const workspace = f.storage.createCompiledBlueprintPlan(compiled, "codex", commit);
    const replayed = f.storage.createCompiledBlueprintPlan(compiled, "codex", commit);
    assert.equal(replayed.activePlan.id, workspace.activePlan.id);
    assert.equal(workspace.activeBlueprint?.version, 3);
    assert.equal(currentPlanReadModel(workspace.activePlan, workspace.activeBlueprint).presentation?.days[0]?.stops?.[0]?.placeId, f.research.places[0]!.id);
    assert.equal(f.storage.getBlueprintGenerationEvents(f.context.generationKey).filter(e => e.id === "唯一草稿").length, 1);
    assert.equal(f.mock.commands.filter(a => a[1] === "submit").length, 4);
  } finally { await f.close(); }
});

test("已导入轮次更改请求或约束会拒绝，不能凭同轮次重新提交", async () => {
  const f = await fixture();
  try {
    const active = f.services();
    const candidate = await f.repair(active.adapter, 1);
    f.save(candidate, 2);
    const mapping = repairs(active.mappings, f.context.generationKey)[0]!;
    const before = frozen(mapping);
    const commands = f.mock.commands.length;
    const changed = (language: string, request: string) => active.adapter.runWithGenerationContext(f.context, () =>
      active.adapter.runWithStageContext({ phase: "质量修复", round: 1, scope: "全行程" }, () => active.adapter.generateSkillItinerary({
        request, research: f.research, profile: { ...PROFILE, preferredLanguage: language },
        dayPatch: { original: f.initial, dates: ["2026-10-20"] }, repair: { rejected: f.initial, issues: ["同日内容仍需完善。"] }
      })));
    await assert.rejects(changed("zh-CN", "更改了本轮原请求。"), { code: "mah_request_conflict" });
    await assert.rejects(changed("en", "连续两轮纠正尚未解决的相同质量问题。"), { code: "mah_request_conflict" });
    assert.equal(f.mock.commands.length, commands);
    assert.equal(repairs(active.mappings, f.context.generationKey).length, 1);
    assert.deepEqual(frozen(active.mappings.getByTaskId(mapping.carrierTaskId) as MahCarrierMapping), before);
  } finally { await f.close(); }
});

test("领域拒绝后全行程第二轮停机恢复，忽略重建编排丢失的局部补丁推断", async () => {
  const f = await fixture(2);
  try {
    const first = f.services();
    const rejected = await f.repair(first.adapter, 1, f.initial, false);
    first.adapter.rejectValidatedStage({ generationKey: f.context.generationKey, operation: "itinerary_repair", candidate: rejected, code: "测试领域拒绝", message: "第一轮领域审查仍有问题。" });
    const firstMapping = repairs(first.mappings, f.context.generationKey)[0]!;
    assert.equal(firstMapping.status, "artifact_invalid");
    const beforeFirst = frozen(firstMapping);
    const abort = new AbortController();
    const run: MahCommandRunner = async (command, args, options) => {
      const result = await f.mock.run(command, args, options);
      if (args[1] === "submit") abort.abort(MAH_SUPERVISION_STOP_REASON);
      return result;
    };
    const active = f.services(f.storage, run);
    await assert.rejects(f.repair(active.adapter, 2, rejected, false, abort.signal), { code: "mah_supervision_stopped" });
    const mapping = repairs(active.mappings, f.context.generationKey).find(m => mahStageIdentity(m.request)?.round === 2)!;
    const request = mapping.requestJson;
    const submissions = f.mock.commands.filter(args => args[1] === "submit").length;
    const restarted = f.reopen();
    // 内存中的 rejectedCorrection 已丢失；新调用会推断只修一天。原任务实际冻结的是两日全行程。
    const restored = await restarted.adapter.runRecovery(() => f.repair(restarted.adapter, 2, f.initial, true));
    assert.deepEqual(restored.days.map(day => day.date), ["2026-10-20", "2026-10-21"]);
    assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.status, "validated");
    assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.requestJson, request);
    assert.deepEqual(frozen(restarted.mappings.getByTaskId(firstMapping.carrierTaskId) as MahCarrierMapping), beforeFirst);
    f.save(restored, 2);
    assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.status, "imported");
    assert.equal(f.mock.commands.filter(args => args[1] === "submit").length, submissions);
    assert.equal(repairs(restarted.mappings, f.context.generationKey).length, 2);
  } finally { await f.close(); }
});

test("冻结的日期补丁在恢复时仍拒绝越界结果，重建全行程输入不能放宽校验", async () => {
  const f = await fixture(2);
  try {
    const abort = new AbortController();
    const run: MahCommandRunner = async (command, args, options) => {
      const result = await f.mock.run(command, args, options);
      if (args[1] === "submit") abort.abort(MAH_SUPERVISION_STOP_REASON);
      return result;
    };
    const active = f.services(f.storage, run);
    // 仅请求一天，受控CLI故意产出两天；停机发生在业务解析之前。
    await assert.rejects(f.repair(active.adapter, 1, f.initial, true, abort.signal), { code: "mah_supervision_stopped" });
    const mapping = repairs(active.mappings, f.context.generationKey)[0]!;
    const before = mapping.requestJson;
    const submissions = f.mock.commands.filter(args => args[1] === "submit").length;
    const restarted = f.reopen();
    await assert.rejects(restarted.adapter.runRecovery(() => f.repair(restarted.adapter, 1, f.initial, false)), { code: "mah_business_integrity_failed" });
    assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.requestJson, before);
    assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.status, "artifact_invalid");
    assert.equal(f.storage.getTripBlueprintByGenerationKey(f.context.generationKey)?.version, 1);
    assert.equal(f.mock.commands.filter(args => args[1] === "submit").length, submissions);
  } finally { await f.close(); }
});

for (const round of [1, 2]) test(`质量修复第${round}轮两个SQLite监督者竞争，只发送该轮一次`, async () => {
  const f = await fixture(); let second: SqliteWorkspaceStore | undefined;
  try {
    let original = f.initial;
    if (round === 2) { original = await f.repair(f.services().adapter, 1); f.save(original, 2); }
    second = new SqliteWorkspaceStore(f.path);
    const run: MahCommandRunner = async (command, args, options) => args[1] === "show" && !f.mock.requests.has(args[2]!)
      ? { code: 1, stdout: '{"error":{"code":"task_not_found"}}', stderr: "" } : f.mock.run(command, args, options);
    const a = f.services(f.storage, run), b = f.services(second, run);
    const before = f.mock.commands.filter(a => a[1] === "submit").length;
    const candidates = await Promise.all([f.repair(a.adapter, round, original), f.repair(b.adapter, round, original)]);
    assert.deepEqual(candidates[0], candidates[1]);
    assert.equal(f.mock.commands.filter(a => a[1] === "submit").length - before, 1);
    const mapping = repairs(a.mappings, f.context.generationKey).find(m => mahStageIdentity(m.request)?.round === round)!;
    assert.ok(mapping); assert.equal(mapping.status, "validated");
    assert.equal(repairs(a.mappings, f.context.generationKey).filter(m => mahStageIdentity(m.request)?.round === round).length, 1);
  } finally { second?.close(); await f.close(); }
});

for (const round of [1, 2]) for (const reason of ["未知回执", "正常停机", "用户取消"] as const) test(`修复第${round}轮${reason}后重建SQLite，仅查询原UUID并保留导入边界`, async () => {
  const f = await fixture();
  try {
    let original = f.initial;
    if (round === 2) { original = await f.repair(f.services().adapter, 1); f.save(original, 2); }
    const preserved = repairs(f.services().mappings, f.context.generationKey).map(m => [m.carrierTaskId, frozen(m)] as const);
    const abort = new AbortController();
    let unavailable = true;
    const run: MahCommandRunner = async (command, args, options) => {
      if (unavailable && ["show", "cancel"].includes(args[1]!)) { f.mock.commands.push([...args]); return { code: 1, stdout: '{"error":{"code":"task_not_found"}}', stderr: "" }; }
      const result = await f.mock.run(command, args, options);
      if (args[1] === "submit") {
        if (reason === "正常停机") abort.abort(MAH_SUPERVISION_STOP_REASON);
        return { code: 1, stdout: "", stderr: "" };
      }
      return result;
    };
    const active = f.services(f.storage, run);
    const initialSubmits = f.mock.commands.filter(a => a[1] === "submit").length;
    await assert.rejects(f.repair(active.adapter, round, original, true, abort.signal), { code: reason === "正常停机" ? "mah_supervision_stopped" : "mah_queue_wait_timed_out" });
    const mapping = repairs(active.mappings, f.context.generationKey).find(m => mahStageIdentity(m.request)?.round === round)!;
    assert.equal(mapping.status, "submission_unknown");
    const before = frozen(mapping);
    if (reason === "用户取消") {
      await assert.rejects(active.adapter.cancelGeneration(f.context.generationKey), { code: "mah_cancel_unconfirmed" });
      assert.ok(active.mappings.getByTaskId(mapping.carrierTaskId)?.cancelRequestedAt);
    }
    const restarted = f.reopen();
    unavailable = false;
    f.mock.setStatus("completed");
    const start = f.mock.commands.length;
    await restarted.transport.recoverActiveMappings();
    if (reason === "用户取消") {
      await assert.rejects(f.repair(restarted.adapter, round, original), { code: "cancelled" });
      assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.resultJson, undefined);
      assert.equal(f.storage.getTripBlueprintByGenerationKey(f.context.generationKey)?.version, round);
    } else {
      const candidate = await restarted.adapter.runRecovery(() => f.repair(restarted.adapter, round, original));
      assert.deepEqual(candidate, f.initial);
      assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.status, "validated");
      f.save(candidate, round + 1);
      assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.status, "imported");
    }
    const restored = restarted.mappings.getByTaskId(mapping.carrierTaskId)!;
    assert.deepEqual([restored.requestJson, restored.requestSha256], before.slice(0, 2));
    assert.equal(repairs(restarted.mappings, f.context.generationKey).length, round);
    for (const [id, bytes] of preserved) assert.deepEqual(frozen(restarted.mappings.getByTaskId(id) as MahCarrierMapping), bytes);
    assert.equal(f.mock.commands.filter(a => a[1] === "submit").length - initialSubmits, 1);
    assert.ok(f.mock.commands.slice(start).filter(a => a[1] === "show" || a[1] === "context").every(a => a[2] === mapping.carrierTaskId));
  } finally { await f.close(); }
});

for (const legacy of [false, true]) test(`${legacy ? "旧索引" : "稳定日期"}补全研究首目标完成后，过滤重建仍查询第二目标原UUID`, async () => {
  const f = await fixture();
  try {
    const targets = [{ date: "2026-10-20", scopeLabel: "第一天补全研究" }, { date: "2026-10-21", scopeLabel: "第二天补全研究" }];
    const scopes = targets.map((target, index) => legacy ? `completion-${index + 1}-${target.date}` : completionResearchBatchId(target.date));
    const requestBatch = (adapter: MahBlueprintRuntimeAdapter, id: string, scopeLabel: string, completedAt: string) => adapter.runWithGenerationContext(f.context, () => adapter.runWithStageContext({ phase: "日期补全研究", round: 1 }, () => adapter.generateSkillResearchBatch({
      request: "为尚未排满的日期补充可用地点。", batch: { id, scopeLabel }, profile: PROFILE, completedAt
    })));
    const first = f.services();
    const accepted = await requestBatch(first.adapter, scopes[0]!, targets[0]!.scopeLabel, NOW);
    const receipt = first.adapter.carrierForCandidate(accepted)!;
    const combined = importSkillResearchBatches([f.initialBatch, accepted], { researchSetId: f.research.id, ...f.context, createdAt: NOW, updatedAt: NOW });
    f.storage.saveResearchSet(combined, { carrierTaskIds: [receipt.carrierTaskId], expectedCarriers: [receipt], generationEvent: f.event("第一补全目标已保存", "research") });
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] === "show") { f.mock.commands.push([...args]); return { code: 1, stdout: '{"error":{"code":"task_not_found"}}', stderr: "" }; }
      const result = await f.mock.run(command, args, options);
      return args[1] === "submit" ? { code: 1, stdout: "", stderr: "" } : result;
    };
    await assert.rejects(requestBatch(f.services(f.storage, run).adapter, scopes[1]!, targets[1]!.scopeLabel, NOW), { code: "mah_queue_wait_timed_out" });
    const mapping = first.mappings.listForGeneration(f.context.generationKey).find(m => mahStageIdentity(m.request)?.scope === scopes[1])!;
    assert.equal(mapping.status, "submission_unknown");
    const bytes = mapping.requestJson;
    const count = first.mappings.listForGeneration(f.context.generationKey).length;
    const submits = f.mock.commands.filter(args => args[1] === "submit").length;
    const restarted = f.reopen();
    const saved = f.storage.getResearchSet(f.research.id)!;
    const remaining = targets.filter(target => !saved.batches.some(batch => batch.status === "completed" && batch.scopeLabel === target.scopeLabel));
    assert.deepEqual(remaining.map(target => target.date), ["2026-10-21"]);
    const existingScopes = restarted.mappings.listForGeneration(f.context.generationKey).filter(m => m.operation === "research_batch").flatMap(m => {
      const identity = mahStageIdentity(m.request); return identity ? [identity.scope] : [];
    });
    const rebuiltId = completionResearchBatchId(remaining[0]!.date, existingScopes);
    assert.equal(rebuiltId, scopes[1]);
    const start = f.mock.commands.length;
    const recovered = await restarted.adapter.runRecovery(() => requestBatch(restarted.adapter, rebuiltId, "重建时变化的范围说明", "2026-10-14T00:00:00.000Z"));
    assert.equal(recovered.id, scopes[1]);
    assert.equal(recovered.scopeLabel, targets[1]!.scopeLabel);
    assert.equal(recovered.completedAt, NOW);
    assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.status, "validated");
    assert.equal(restarted.mappings.getByTaskId(mapping.carrierTaskId)?.requestJson, bytes);
    assert.equal(restarted.mappings.listForGeneration(f.context.generationKey).length, count);
    assert.equal(f.mock.commands.filter(args => args[1] === "submit").length, submits);
    assert.ok(f.mock.commands.slice(start).filter(args => args[1] === "show" || args[1] === "context").every(args => args[2] === mapping.carrierTaskId));
  } finally { await f.close(); }
});

test("同日期多个历史补全身份明确拒绝，不能任取一个恢复", () => {
  assert.throws(() => completionResearchBatchId("2026-10-21", ["completion-1-2026-10-21", "completion-2-2026-10-21"]), { code: "mah_stage_identity_legacy" });
});

for (const semantic of [false, true]) for (const state of ["queued", "artifact_invalid"] as const) test(`默认${semantic ? "语义" : "领域"}修复${state}时改变内容，只报冲突而不另开任务`, async () => {
  const f = await fixture();
  try {
    const active = f.services();
    f.mock.setStatus(state === "queued" ? "queued" : "completed");
    const invoke = (changed: boolean) => active.adapter.runWithGenerationContext(f.context, () => semantic
      ? active.adapter.generateSemanticTravelPlanRepair({ prompt: changed ? "更改后的语义修复请求。" : "原语义修复请求。" })
      : active.adapter.generateSkillItinerary({ request: "默认领域修复。", research: f.research, profile: PROFILE, repair: { rejected: f.initial, issues: [changed ? "变更后的问题。" : "原问题。"] } }));
    if (state === "queued") await assert.rejects(invoke(false), { code: "mah_queue_wait_timed_out" });
    else if (semantic) await assert.rejects(invoke(false));
    else {
      const candidate = await invoke(false);
      active.adapter.rejectValidatedStage({ generationKey: f.context.generationKey, operation: "itinerary_repair", candidate, code: "测试默认领域拒绝", message: "本轮候选仍有问题。" });
    }
    const mapping = active.mappings.listForGeneration(f.context.generationKey).find(m => m.operation === (semantic ? "semantic_repair" : "itinerary_repair"))!;
    assert.equal(mapping.status, state);
    assert.equal(mahStageIdentity(mapping.request)?.scope, "全行程");
    const before = frozen(mapping as MahCarrierMapping);
    const count = active.mappings.listForGeneration(f.context.generationKey).length;
    const commands = f.mock.commands.length;
    await assert.rejects(invoke(true), { code: "mah_request_conflict" });
    assert.equal(f.mock.commands.length, commands);
    assert.equal(active.mappings.listForGeneration(f.context.generationKey).length, count);
    assert.deepEqual(frozen(active.mappings.getByTaskId(mapping.carrierTaskId) as MahCarrierMapping), before);
  } finally { await f.close(); }
});

function validImagePayload(request: MahStageRequest): Record<string, unknown> {
  const ids = (request.input.businessInput.parserContext as { placeIds: string[] }).placeIds;
  return { sources: [{ id: "测试图片来源", title: "测试馆照片", authority: "测试来源", url: "https://example.com/image-source", retrievedAt: "2026-10-13", status: "verified", official: false }],
    images: ids.map(placeId => ({ placeId, url: "https://example.com/museum.jpg", sourceUrl: "https://example.com/image-source", alt: "测试馆照片", usage: ["detail"], status: "verified" })), omitted: [] };
}

function imageMappings(f: Awaited<ReturnType<typeof fixture>>) {
  return f.services().mappings.listForGeneration(f.context.generationKey).filter(m => m.operation === "planned_place_image_enrichment") as MahCarrierMapping[];
}
function requestImages(f: Awaited<ReturnType<typeof fixture>>, adapter: MahBlueprintRuntimeAdapter, places: ResearchSet["places"], round: number, phase = "图片补全") {
  return adapter.runWithGenerationContext(f.context, () => adapter.runWithStageContext({ phase, round }, () => adapter.generatePlannedPlaceImageEnrichment({
    request: "仅为指定地点补充有来源的照片。", scopeLabel: "测试市", places, profile: PROFILE, completedAt: NOW
  })));
}
function acceptImages(f: Awaited<ReturnType<typeof fixture>>, adapter: MahBlueprintRuntimeAdapter, candidate: Awaited<ReturnType<MahBlueprintRuntimeAdapter["generatePlannedPlaceImageEnrichment"]>>, id: string) {
  const receipt = adapter.carrierForCandidate(candidate)!;
  assert.ok(receipt);
  const blueprint = f.storage.getTripBlueprintByGenerationKey(f.context.generationKey)!;
  const research = f.storage.getResearchSet(f.research.id)!;
  const merged = mergePlannedPlaceImageEnrichment(research, blueprint, candidate, NOW);
  assert.equal(merged.acceptedImageCount, candidate.images.length);
  f.storage.saveResearchSetAndTripBlueprint(merged.research, merged.blueprint, undefined, { carrierTaskIds: [receipt.carrierTaskId], expectedCarriers: [receipt], generationEvent: f.event(id) });
}

for (const state of ["submission_unknown", "cancelled", "failed"] as const) test(`图片首批${state}而兄弟批已导入，重分组与跨阶段不能另开任务`, async () => {
  const f = await fixture(1, 4);
  try {
    const pending = f.research.places.slice(0, 3), sibling = f.research.places.slice(3);
    const unavailable: MahCommandRunner = async (command, args, options) => {
      if (args[1] === "show") { f.mock.commands.push([...args]); return { code: 1, stdout: '{"error":{"code":"task_not_found"}}', stderr: "" }; }
      const result = await f.mock.run(command, args, options);
      return args[1] === "submit" ? { code: 1, stdout: "", stderr: "" } : result;
    };
    const first = f.services(f.storage, unavailable);
    await assert.rejects(requestImages(f, first.adapter, pending, 1), { code: "mah_queue_wait_timed_out" });
    const original = imageMappings(f)[0]!;
    if (state !== "submission_unknown") first.mappings.updateStatus(original.carrierTaskId, state);
    const active = f.services();
    const brother = await requestImages(f, active.adapter, sibling, 1);
    acceptImages(f, active.adapter, brother, "兄弟图片批次已保存");
    assert.equal(imageMappings(f).find(m => m.carrierTaskId !== original.carrierTaskId)?.status, "imported");
    const before = frozen(active.mappings.getByTaskId(original.carrierTaskId) as MahCarrierMapping);
    const count = imageMappings(f).length;
    const submits = f.mock.commands.filter(a => a[1] === "submit").length;
    for (const [round, phase] of [[2, "图片补全"], [1, "发布后图片续补"]] as const) {
      await assert.rejects(requestImages(f, active.adapter, pending.slice(0, 2), round, phase), { code: "mah_stage_predecessor_pending" });
    }
    assert.equal(imageMappings(f).length, count);
    assert.equal(f.mock.commands.filter(a => a[1] === "submit").length, submits);
    assert.deepEqual(frozen(active.mappings.getByTaskId(original.carrierTaskId) as MahCarrierMapping), before);
    assert.equal(f.storage.getBlueprintGeneration(f.context.generationKey)?.status, "running");
    if (state === "submission_unknown") {
      const parent = structuredClone(original.request.parentCheckpoint);
      const brotherBefore = imageMappings(f).find(m => m.carrierTaskId !== original.carrierTaskId)!;
      const savedResearch = f.storage.getResearchSet(f.research.id);
      const savedBlueprint = f.storage.getTripBlueprintByGenerationKey(f.context.generationKey);
      const savedEvents = f.storage.getBlueprintGenerationEvents(f.context.generationKey);
      const start = f.mock.commands.length;
      // 兄弟批次已推进权威父内容；仅查询原任务，旧父候选保持拒绝，不能换身份重提。
      await assert.rejects(active.adapter.runRecovery(() => requestImages(f, active.adapter, pending, 1)), { code: "mah_request_conflict" });
      const queried = f.mock.commands.slice(start).filter(a => a[1] === "show" || a[1] === "context");
      assert.ok(queried.some(a => a[1] === "show"));
      assert.ok(queried.some(a => a[1] === "context"));
      assert.ok(queried.every(a => a[2] === original.carrierTaskId));
      assert.equal(imageMappings(f).length, count);
      assert.equal(f.mock.commands.filter(a => a[1] === "submit").length, submits);
      const stillOriginal = active.mappings.getByTaskId(original.carrierTaskId) as MahCarrierMapping;
      assert.deepEqual(frozen(stillOriginal), before);
      assert.deepEqual(stillOriginal.request.parentCheckpoint, parent);
      assert.ok(["submission_unknown", "queued", "running", "completed"].includes(stillOriginal.status));
      assert.deepEqual(active.mappings.getByTaskId(brotherBefore.carrierTaskId), brotherBefore);
      assert.deepEqual(f.storage.getResearchSet(f.research.id), savedResearch);
      assert.deepEqual(f.storage.getTripBlueprintByGenerationKey(f.context.generationKey), savedBlueprint);
      assert.deepEqual(f.storage.getBlueprintGenerationEvents(f.context.generationKey), savedEvents);
      for (const [round, phase] of [[2, "图片补全"], [1, "发布后图片续补"]] as const) {
        await assert.rejects(requestImages(f, active.adapter, pending.slice(0, 2), round, phase), { code: "mah_stage_predecessor_pending" });
      }
      assert.equal(imageMappings(f).length, count);
      assert.equal(f.mock.commands.filter(a => a[1] === "submit").length, submits);
    }
  } finally { await f.close(); }
});

test("图片未知回执且父未变化，重建库后原UUID查询可接受并保存", async () => {
  const f = await fixture(1, 4);
  try {
    const pending = f.research.places.slice(0, 3);
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] === "show") { f.mock.commands.push([...args]); return { code: 1, stdout: '{"error":{"code":"task_not_found"}}', stderr: "" }; }
      const response = await f.mock.run(command, args, options);
      return args[1] === "submit" ? { code: 1, stdout: "", stderr: "" } : response;
    };
    const active = f.services(f.storage, run);
    await assert.rejects(requestImages(f, active.adapter, pending, 1), { code: "mah_queue_wait_timed_out" });
    const original = imageMappings(f)[0]!;
    const request = [original.requestJson, original.requestSha256, structuredClone(original.request.parentCheckpoint)];
    const submits = f.mock.commands.filter(args => args[1] === "submit").length;
    const restarted = f.reopen();
    const start = f.mock.commands.length;
    const recovered = await restarted.adapter.runRecovery(() => requestImages(f, restarted.adapter, pending, 1));
    assert.equal(recovered.images.length, 3);
    const queried = f.mock.commands.slice(start).filter(args => args[1] === "show" || args[1] === "context");
    assert.ok(queried.some(args => args[1] === "show"));
    assert.ok(queried.some(args => args[1] === "context"));
    assert.ok(queried.every(args => args[2] === original.carrierTaskId));
    acceptImages(f, restarted.adapter, recovered, "原图片身份恢复并保存");
    const saved = restarted.mappings.getByTaskId(original.carrierTaskId)!;
    assert.equal(saved.status, "imported");
    assert.deepEqual([saved.requestJson, saved.requestSha256, saved.request.parentCheckpoint], request);
    assert.equal(imageMappings(f).length, 1);
    assert.equal(f.mock.commands.filter(args => args[1] === "submit").length, submits);
    assert.equal(f.storage.getTripBlueprintByGenerationKey(f.context.generationKey)!.places.filter(place => place.images?.length).length, 3);
  } finally { await f.close(); }
});

test("图片零可用候选及时拒绝，兄弟批导入后第二轮可合法提交并原子保存", async () => {
  const f = await fixture(1, 4);
  try {
    const active = f.services();
    const pending = f.research.places.slice(0, 3), sibling = f.research.places.slice(3);
    f.setImagePayload(() => ({ images: [], sources: [], omitted: [] }));
    const empty = await requestImages(f, active.adapter, pending, 1);
    assert.equal(empty.images.length, 0);
    active.adapter.rejectValidatedStage({ generationKey: f.context.generationKey, operation: "planned_place_image_enrichment", candidate: empty, code: "测试图片无可用候选", message: "没有可接受的图片，保留插画。" });
    const rejected = imageMappings(f)[0]!;
    assert.equal(rejected.status, "artifact_invalid");
    const before = frozen(rejected);
    f.setImagePayload(validImagePayload);
    const brother = await requestImages(f, active.adapter, sibling, 1);
    assert.equal(brother.images.length, 1);
    acceptImages(f, active.adapter, brother, "正向兄弟图片保存");
    const second = await requestImages(f, active.adapter, pending.slice(0, 2), 2);
    assert.equal(second.images.length, 2);
    acceptImages(f, active.adapter, second, "第二轮图片保存");
    const mappings = imageMappings(f);
    assert.equal(mappings.length, 3);
    assert.equal(mappings.find(m => mahStageIdentity(m.request)?.round === 2)?.status, "imported");
    assert.deepEqual(frozen(active.mappings.getByTaskId(rejected.carrierTaskId) as MahCarrierMapping), before);
    assert.equal(new Set(mappings.map(m => m.carrierTaskId)).size, 3);
    const saved = f.storage.getResearchSet(f.research.id)!;
    assert.equal(saved.places.filter(place => place.images?.length).length, 3);
    assert.equal(f.storage.getTripBlueprintByGenerationKey(f.context.generationKey)!.places.filter(place => place.images?.length).length, 3);
  } finally { await f.close(); }
});

for (const version of [1, 2] as const) test(`历史Schema${version}槽位记录禁止借新阶段键重开普通队列任务`, async () => {
  const f = await fixture();
  try {
    const active = f.services();
    const seed = active.mappings.listForGeneration(f.context.generationKey).find(m => m.operation === "itinerary_draft")!;
    const businessInput = { prompt: "历史行程请求" };
    const inputSha256 = sha256(canonicalJson(businessInput));
    const legacy = active.mappings.prepare({ generationKey: f.context.generationKey, operation: "itinerary_draft", batchId: "旧业务批次", inputSha256,
      protocol: version === 1 ? "mah_slot_v1" : "mah_slot_v2", slotClass: version === 1 ? "background" : "interactive", projectRoot: ROOT,
      expectedSubpath: seed.expectedSubpath, preparedStatus: "prepared", retryableTerminalStatuses: [], serializeRequest: canonicalJson, hashRequest: sha256,
      // 历史槽位使用完整旧合同，不能继承普通队列新增的执行字段。
      createRequest: ({ carrierTaskId, requestId, attempt }) => ({
        schemaVersion: version, kind: "landi_generation_stage_request", carrierTaskId, requestId, attempt,
        generationKey: f.context.generationKey, proposalRef: seed.request.proposalRef, skillLineage: seed.request.skillLineage,
        operation: "itinerary_draft", batchId: "旧业务批次", parentCheckpoint: f.storage.getGenerationCarrierCheckpoint(f.context.generationKey),
        input: { businessContract: "landi.skill-itinerary-input.v1", businessInput, sha256: inputSha256 },
        output: { subpath: seed.expectedSubpath, envelopeContract: "landi.mah-generation-stage-result.v1" },
        execution: {
          preferredLanguage: "zh-CN", agentPreference: "codex", webSearch: false, maxRuntimeSeconds: 60,
          capabilityRequirements: ["structured_output"], ...(version === 2 ? { personalOsSlotClass: "interactive" } : {})
        },
        createdAt: NOW
      } as MahStageRequest)
    }) as MahCarrierMapping;
    const before = legacy.requestJson;
    const count = active.mappings.listForGeneration(f.context.generationKey).length;
    const commands = f.mock.commands.length;
    await assert.rejects(active.adapter.runWithGenerationContext(f.context, () => active.adapter.runWithStageContext({ phase: "历史行程继续", round: 2 }, () => active.adapter.generateSkillItinerary({ request: "继续历史行程。", research: f.research, profile: PROFILE }))), { code: "mah_legacy_protocol_read_only" });
    assert.equal(f.mock.commands.length, commands);
    assert.equal(active.mappings.listForGeneration(f.context.generationKey).length, count);
    assert.equal(active.mappings.getByTaskId(legacy.carrierTaskId)?.requestJson, before);
    assert.equal(active.mappings.getByTaskId(legacy.carrierTaskId)?.protocol, legacy.protocol);
  } finally { await f.close(); }
});

function researchPayload() {
  return {
    id: "scope-test-city",
    scopeLabel: "测试市中心",
    completedAt: "2026-10-13T00:00:00.000Z",
    sources: [{ id: "source-museum", title: "博物馆官方页面", authority: "测试博物馆", url: "https://example.com/museum", retrievedAt: "2026-10-13", status: "verified", official: true }],
    places: [{
      id: "museum", name: "测试博物馆", locationLabel: "测试市中心", city: "测试市", area: "中心区", category: "museum", priority: "must",
      coordinates: [31.2, 121.4], display: { type: "attraction" }, schedulingEligibility: { decision: "schedulable", reason: "适合作为当天主要参观点。" },
      contentTier: "standard", durationMinutes: 180, whyWorthIt: "展示城市历史与地方文化。", plan: "上午参观常设展。", sourceUrls: ["https://example.com/museum"]
    }],
    events: [], relationships: [], localFoods: [], localProducts: [], experienceThemes: [], travelTips: [], actionRequirements: []
  };
}

function itineraryPayload(research: ResearchSet, dayCount = 1) {
  const placeId = research.places[0]!.id;
  const payload = {
    title: "测试市一日行程",
    summary: "以城市博物馆为当天主要参观点。",
    language: "zh-CN",
    destinations: ["测试市"],
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    guideTheme: { title: "城市历史", narrative: "用一日时间了解测试市的历史脉络。", visitorMode: "first-visit", tasteModels: [], citySegments: [{ id: "segment-1", city: "测试市", title: "中心区", summary: "围绕博物馆安排紧凑的一日路线。", dayIds: ["day-1"] }] },
    days: [{
      id: "day-1", date: "2026-10-20", kind: "scheduled", city: "测试市", title: "博物馆日", summary: "上午参观城市博物馆。",
      stops: [{ placeId, order: 1, time: "10:00" }],
      blocks: [{ id: "block-1", kind: "stop", order: 1, placeId, startTime: "10:00", durationMinutes: 180, evidence: [] }],
      candidatePlaceIds: []
    }],
    movements: []
  };
  if (research.places.length > 1) {
    // 图片夹具的每个地点都是真正排入当天时间线的地点，沿正式图片合并器保存。
    payload.days[0]!.stops = research.places.map((place, index) => ({ placeId: place.id, order: index + 1, time: `${10 + index}:00` }));
    payload.days[0]!.blocks = research.places.map((place, index) => ({ id: `block-${index + 1}`, kind: "stop", order: index + 1, placeId: place.id, startTime: `${10 + index}:00`, durationMinutes: 60, evidence: [] }));
  }
  if (dayCount === 2) {
    payload.endDate = "2026-10-21";
    payload.days.push({ ...structuredClone(payload.days[0]!), id: "day-2", date: "2026-10-21", title: "博物馆补充参观" });
    payload.guideTheme.citySegments[0]!.dayIds.push("day-2");
  }
  return payload;
}

