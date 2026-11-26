import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LANDI_BLUEPRINT_SKILL } from "../packages/agent-adapters/src/index.js";
import {
  assertTripBlueprintIntegrity,
  compileTripBlueprint,
  importSkillItinerary,
  importSkillResearchBatches,
  type ResearchSet
} from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { MahBlueprintRuntimeAdapter } from "../apps/server/src/mah-blueprint-runtime.js";
import { MahCliTransport } from "../apps/server/src/mah-cli-transport.js";
import { type MahCommandRunner } from "../apps/server/src/mah-cli-transport.js";
import {
  canonicalJson, sha256,
  MAH_STAGE_RESULT_SUBPATH,
  mahOperationContracts,
  type MahGenerationMappings,
  type MahStageRequest
} from "../apps/server/src/mah-generation-contract.js";
import { queueRunner } from "../apps/server/src/mah-queue.fixture.test.js";
import { currentPlanReadModel } from "../apps/web/src/current-plan-read-model.js";

test("公开 MAH research 与 itinerary 结果经 Core 编译、Storage 保存并由 Web 投影", async () => {
  const directory = await mkdtemp(join(tmpdir(), "landi-queue-integration-"));
  const storage = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
  const mappings = storage.generationCarriers as MahGenerationMappings;
  let research: ResearchSet | undefined;
  const runner = publicRunner((request) => request.operation === "research_batch" ? researchPayload() : itineraryPayload(research!));
  const transport = new MahCliTransport({
    mahProjectRoot: "/tmp/landi-mah-integration",
    store: mappings,
    environment: { LANDI_MAH_CLI_COMMAND: "/受控/mah", LANDI_MAH_CLI_EXECUTABLE: "/受控/node", LANDI_MAH_CLI_MAIN: "/受控/index.js" },
    run: runner,
    schedulerWaitMs: 20,
    pollIntervalMs: 1
  });
  const adapter = new MahBlueprintRuntimeAdapter({ mappings, transport, checkpoint: key => storage.getGenerationCarrierCheckpoint(key) });
  const createdSession = storage.createPlanningSession("travel", new Date("2026-10-13T00:00:00.000Z"));
  storage.savePlanningSession({
    ...createdSession,
    status: "proposal_confirmed",
    proposal: { version: 1, title: "测试市一日行程", objective: "参观城市博物馆", theme: "城市历史", segments: ["测试市"], skeleton: ["2026-10-20"], tradeoffs: [], assumptions: [], decisionPoints: [] },
    confirmedProposalVersion: 1,
    updatedAt: "2026-10-13T00:00:00.000Z"
  });
  const context = {
    generationKey: `${createdSession.id}:1:${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`,
    proposalRef: { sessionId: createdSession.id, proposalVersion: 1 },
    skillLineage: LANDI_BLUEPRINT_SKILL
  };
  try {
    storage.saveBlueprintGeneration({
      generationKey: context.generationKey,
      proposalRef: context.proposalRef,
      skillLineage: context.skillLineage,
      status: "running",
      stage: "research",
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z"
    });
    const profile = { preferredLanguage: "zh-CN", nationality: "中国", gender: "not_specified" as const, immigrationStatus: "unknown" as const };
    const batch = await adapter.runWithGenerationContext(context, () => adapter.generateSkillResearchBatch({
      request: "为测试市规划一天的博物馆行程。",
      batch: { id: "scope-test-city", scopeLabel: "测试市中心" },
      completedAt: "2026-10-13T00:00:00.000Z",
      profile
    }));
    research = importSkillResearchBatches([batch], {
      researchSetId: "research-integration",
      generationKey: context.generationKey,
      proposalRef: context.proposalRef,
      skillLineage: context.skillLineage,
      createdAt: "2026-10-13T00:00:01.000Z",
      updatedAt: "2026-10-13T00:00:01.000Z"
    });
    const researchMapping = mappings.listForGeneration(context.generationKey).find((mapping) => mapping.operation === "research_batch")!;
    const researchEvent = {
      id: `mah-import-${researchMapping.carrierTaskId}`,
      generationKey: context.generationKey,
      stage: "research" as const,
      status: "running" as const,
      detail: "保存受控研究检查点。",
      savedPlaceCount: research.places.length,
      createdAt: "2026-10-13T00:00:01.000Z"
    };
    assert.throws(() => storage.saveResearchSet(research!, {
      carrierTaskIds: [randomUUID()],
      generationEvent: { ...researchEvent, id: `${researchEvent.id}-rollback` }
    }), /待导入的 MAH carrier/);
    assert.equal(storage.getResearchSet(research.id), undefined);
    assert.equal(mappings.getByTaskId(researchMapping.carrierTaskId)?.status, "validated");
    research = storage.saveResearchSet(research, { carrierTaskIds: [researchMapping.carrierTaskId], expectedCarriers: [{ carrierTaskId: researchMapping.carrierTaskId, requestSha256: researchMapping.requestSha256, resultSha256: researchMapping.resultSha256! }], generationEvent: researchEvent });
    assert.equal(mappings.getByTaskId(researchMapping.carrierTaskId)?.status, "imported");

    const itinerary = await adapter.runWithGenerationContext(context, () => adapter.generateSkillItinerary({
      request: "为测试市规划一天的博物馆行程。",
      research: research!,
      profile
    }));
    const blueprint = importSkillItinerary(research, itinerary, {
      blueprintId: "blueprint-integration",
      blueprintVersion: 1,
      createdAt: "2026-10-13T00:00:02.000Z"
    });
    assertTripBlueprintIntegrity(blueprint, { expectedResearchPlaceIds: research.places.map((place) => place.id) });
    const itineraryMapping = mappings.listForGeneration(context.generationKey).find(m => m.operation === "itinerary_draft")!;
    const savedBlueprint = storage.saveTripBlueprint(blueprint, { carrierTaskIds: [itineraryMapping.carrierTaskId], expectedCarriers: [{carrierTaskId: itineraryMapping.carrierTaskId,requestSha256: itineraryMapping.requestSha256,resultSha256: itineraryMapping.resultSha256!}], generationEvent: { ...researchEvent, id: `mah-itinerary-${itineraryMapping.carrierTaskId}`, stage: "itinerary", createdAt: "2026-10-13T00:00:02.000Z" } });
    const compiled = compileTripBlueprint(savedBlueprint, { createdAt: "2026-10-13T00:00:03.000Z" });
    assert.deepEqual(mappings.listForGeneration(context.generationKey).map((mapping) => mapping.status), ["imported", "imported"]);
    const expectedCarriers = mappings.listForGeneration(context.generationKey).map(m => ({carrierTaskId:m.carrierTaskId,requestSha256:m.requestSha256,resultSha256:m.resultSha256!}));
    const carrierTaskIds = mappings.listForGeneration(context.generationKey).map((mapping) => mapping.carrierTaskId);
    const generationEvent = {
      id: `mah-ready-${compiled.lineage.compilationKey}`,
      generationKey: context.generationKey,
      stage: "ready" as const,
      status: "completed" as const,
      detail: "受控集成中的 Trip Blueprint 与 Draft Plan 已可审阅。",
      savedPlaceCount: savedBlueprint.places.length,
      nextAction: "审阅受控 Draft Plan。",
      createdAt: "2026-10-13T00:00:03.000Z"
    };
    assert.throws(() => storage.createCompiledBlueprintPlan(compiled, "codex", {
      generationKey: context.generationKey,
      carrierTaskIds: [researchMapping.carrierTaskId],
      expectedCarriers: expectedCarriers.map(m => ({...m,resultSha256:"0".repeat(64)})),
      generationEvent: { ...generationEvent, id: `${generationEvent.id}-omitted` }
    }), /摘要/);
    assert.throws(() => storage.createCompiledBlueprintPlan(compiled, "codex", {
      generationKey: context.generationKey,
      carrierTaskIds: [...carrierTaskIds, randomUUID()],
      expectedCarriers,
      generationEvent: { ...generationEvent, id: `${generationEvent.id}-rollback` }
    }), /待导入的 MAH carrier/);
    assert.deepEqual(mappings.listForGeneration(context.generationKey).map((mapping) => mapping.status), ["imported", "imported"]);
    assert.equal(storage.getPlanBlueprintLineageByCompilationKey(compiled.lineage.compilationKey), undefined);
    assert.equal(storage.getBlueprintGenerationEvents(context.generationKey).some((event) => event.id === `${generationEvent.id}-rollback`), false);
    const workspace = storage.createCompiledBlueprintPlan(compiled, "codex", { generationKey: context.generationKey, carrierTaskIds, expectedCarriers, generationEvent });
    const replayed = storage.createCompiledBlueprintPlan(compiled, "codex", { generationKey: context.generationKey, carrierTaskIds, expectedCarriers, generationEvent });
    const model = currentPlanReadModel(workspace.activePlan, workspace.activeBlueprint);

    assert.equal(workspace.activePlan.id, compiled.plan.id);
    assert.equal(workspace.activeBlueprint?.id, savedBlueprint.id);
    assert.equal(replayed.activePlan.id, workspace.activePlan.id);
    assert.equal(model.presentationSource, "blueprint");
    assert.equal(model.presentation?.days[0]?.stops?.[0]?.placeId, research.places[0]?.id);
    assert.deepEqual(mappings.listForGeneration(context.generationKey).map((mapping) => [mapping.operation, mapping.status]), [
      ["research_batch", "imported"],
      ["itinerary_draft", "imported"]
    ]);
    assert.equal(storage.getBlueprintGenerationEvents(context.generationKey).filter((event) => event.id === generationEvent.id).length, 1);
  } finally {
    storage.close();
    await rm(directory, {recursive:true,force:true});
  }
});

test("生成主路径静态绑定 MAH 适配器且没有直接 Codex 成功旁路", async () => {
  const source = await readFile(new URL("../apps/server/src/runtime-services.ts", import.meta.url), "utf8");
  const generation = await readFile(new URL("../apps/server/src/planning-generation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /catch[\s\S]{0,240}generateSkill(?:ResearchBatch|Itinerary)/);
  assert.match(generation, /authoritativeMahCarriers/);
  assert.match(generation, /createCompiledBlueprintPlan/);
  assert.doesNotMatch(source, /mah-carriers\.sqlite|MahGenerationStore/);
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

function itineraryPayload(research: ResearchSet) {
  const placeId = research.places[0]!.id;
  return {
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
}

function publicRunner(payloadFor: (request: MahStageRequest) => Record<string, unknown>): MahCommandRunner {
  return queueRunner(payloadFor, "/tmp/landi-mah-integration").run;
}
