import assert from "node:assert/strict";
import test from "node:test";

import { orchestrateChinaArrivalPlan } from "@c-assistant/china-country-pack/orchestrator";
import { SqliteWorkspaceStore } from "@c-assistant/storage";

import {
  createChinaArrivalCompilationService,
  type ChinaArrivalCollectedFacts,
  type ChinaArrivalFactCollector
} from "./china-plan-compilation.js";

const now = "2026-08-07T01:00:00.000Z";

function collectedFacts(): ChinaArrivalCollectedFacts {
  const digitalSource = { id: "amap-user-guide", sourceSnapshotId: "snapshot-amap-user-guide", authority: "Amap", titleOriginal: "高德地图用户指南", url: "https://lbs.amap.com/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "c".repeat(64) };
  return {
    policyEvidence: [{ id: "nia-1", sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidance", url: "https://en.nia.gov.cn/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "a".repeat(64) }],
    weather: {
      locationName: "Shanghai",
      current: { condition: "Cloudy", temperatureC: 28, feelsLikeC: 30, precipitationMm: 0, observedAt: "2026-08-07T00:00:00.000Z" },
      daily: [{ date: "2026-08-08", conditionDay: "Rain", conditionNight: "Cloudy", highC: 31, lowC: 24, precipitationMm: 3, uvIndex: 7 }],
      retrievedAt: "2026-08-07T00:05:00.000Z",
      attributionUrl: "https://www.qweather.com/weather/shanghai.html"
    },
    housing: {
      centreName: "Shanghai Exhibition Centre",
      candidates: [{ id: "stay-1", name: "Example Stay", address: "1 Example Road", location: "121.47,31.23", type: "Accommodation", distanceMeters: 500 }],
      observedAt: "2026-08-07T00:10:00.000Z"
    },
    transport: {
      preference: "plan_recommended",
      luggage: "standard",
      routeFacts: [{ mode: "transit", distanceMeters: 12_000, durationSeconds: 2_400 }, { mode: "driving", distanceMeters: 14_000, durationSeconds: 1_800 }],
      routeObservedAt: "2026-08-07T00:15:00.000Z"
    },
    localFood: { facts: [], sources: [], approvedSourceIds: [] },
    digitalLife: {
      requiredCapabilities: ["map_navigation"],
      completedItemIds: [],
      items: [{ id: "amap", nameOriginal: "高德地图", nameEnglish: "Amap", category: "map_navigation", reasonEnglish: "Open verified Plan places and route handoffs.", stepsEnglish: ["Open the official guide.", "Install the official app for your device."], sourceId: digitalSource.id }],
      sources: [digitalSource],
      approvedSourceIds: [digitalSource.id]
    },
    schedule: { departureAt: "2026-09-01T07:00:00+08:00", timeZone: "Asia/Shanghai" },
    additionalPreparationItems: [{
      key: "flight-essential-check",
      titleEnglish: "Check essential carry-on items",
      detailsEnglish: "Review the essential checklist before leaving.",
      category: "arrival_logistics",
      criticality: "critical",
      state: "needed",
      sourceSkill: { id: "policy-applicability", version: "0.1.0" },
      timing: { anchor: "departure", leadMinutes: 120, refreshFacts: [] }
    }]
  };
}

function readyStore(): SqliteWorkspaceStore {
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({ displayName: "Alex", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" });
  return store;
}

function collector(facts = collectedFacts()): ChinaArrivalFactCollector {
  return { collect: async () => structuredClone(facts) };
}

function collectorForStore(store: SqliteWorkspaceStore): ChinaArrivalFactCollector {
  const policy = store.saveSourceSnapshot({ sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidance", url: "https://en.nia.gov.cn/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "a".repeat(64), excerpt: "Official guidance." }).snapshot;
  const digital = store.saveSourceSnapshot({ sourceId: "amap-user-guide", authority: "Amap", titleOriginal: "高德地图用户指南", url: "https://lbs.amap.com/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "c".repeat(64), excerpt: "Official setup guidance." }).snapshot;
  const facts = collectedFacts();
  facts.policyEvidence[0]!.id = policy.id;
  facts.digitalLife.sources[0]!.sourceSnapshotId = digital.id;
  return collector(facts);
}

test("China compilation service orchestrates and atomically saves the next inert draft", async () => {
  const store = readyStore();
  const original = store.getWorkspace().activePlan;
  const service = createChinaArrivalCompilationService({ store, factCollector: collectorForStore(store) });
  const result = await service.compileCurrentPlan({ now });
  assert.equal(result.status, "saved");
  if (result.status !== "saved") return;
  assert.equal(result.sourcePlanVersion, original.version);
  assert.equal(result.compiledPlanVersion, original.version + 1);
  assert.equal(result.workspace.activePlan.status, "draft");
  assert.equal(result.workspace.activePlan.stages.at(-1)?.tasks.find((task) => task.title === "Check essential carry-on items")?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.equal(store.listRecentPlanCompilationRuns().length, 1);
  const skillRuns = store.listRecentCountryPackSkillRuns();
  assert.equal(skillRuns.length, 8);
  assert.deepEqual(skillRuns.map((run) => run.skillId).sort(), ["arrival-preparation", "china-arrival-plan", "digital-life-setup", "housing-area-recommendation", "local-food-guide", "policy-applicability", "transport-planner", "weather-and-packing"]);
  assert.ok(skillRuns.every((run) => run.compilationRunId === store.listRecentPlanCompilationRuns()[0]!.id));
  assert.equal(store.listRecentPlanCompilationRuns()[0]?.sourceEvidence.length, 2);
  assert.equal(skillRuns.find((run) => run.skillId === "policy-applicability")?.sourceEvidence.length, 1);
  assert.equal(skillRuns.find((run) => run.skillId === "digital-life-setup")?.sourceEvidence.length, 1);
  assert.equal(skillRuns.find((run) => run.skillId === "china-arrival-plan")?.sourceEvidence.length, 2);
  assert.equal(result.workspace.activePlan.stages.at(-1)?.tasks.find((task) => task.title === "Complete the source-backed entry requirement review")?.origin?.sourceEvidence?.length, 1);
  assert.equal(result.workspace.activePlan.stages.at(-1)?.tasks.find((task) => /Set up Amap/.test(task.title))?.origin?.sourceEvidence?.length, 1);
  store.close();
});

test("China compilation service preserves a draft when orchestration needs user input", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const service = createChinaArrivalCompilationService({ store, factCollector: collectorForStore(store) });
  const result = await service.compileCurrentPlan({ now });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "orchestration");
    assert.equal(result.reasonCode, "composition_not_ready");
  }
  assert.equal(store.getWorkspace().activePlan.version, original.version);
  assert.equal(store.listRecentPlanCompilationRuns().length, 0);
  store.close();
});

test("China compilation service sanitizes fact collection failures", async () => {
  const store = readyStore();
  const service = createChinaArrivalCompilationService({
    store,
    factCollector: { collect: async () => { throw new Error("AMAP_API_KEY=secret-value"); } }
  });
  const result = await service.compileCurrentPlan({ now });
  assert.equal(result.status, "blocked");
  assert.doesNotMatch(JSON.stringify(result), /secret-value|AMAP_API_KEY/i);
  assert.equal(store.listRecentPlanCompilationRuns().length, 0);
  store.close();
});

test("China compilation service rejects a plan version race without a partial compiled write", async () => {
  const store = readyStore();
  const service = createChinaArrivalCompilationService({
    store,
    factCollector: collectorForStore(store),
    orchestrate: async (input) => {
      const result = await orchestrateChinaArrivalPlan(input);
      store.confirmPlan(input.plan.id);
      return result;
    }
  });
  const result = await service.compileCurrentPlan({ now });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "persistence");
    assert.equal(result.reasonCode, "plan_changed");
  }
  assert.equal(store.getWorkspace().activePlan.status, "active");
  assert.equal(store.listRecentPlanCompilationRuns().length, 0);
  store.close();
});

test("China compilation service does not misreport or expose an unexpected storage failure", async () => {
  const underlying = readyStore();
  const service = createChinaArrivalCompilationService({
    store: {
      getWorkspace: () => underlying.getWorkspace(),
      saveCompiledPlan: () => { throw new Error("database path and secret-value"); }
    },
    factCollector: collectorForStore(underlying)
  });
  const result = await service.compileCurrentPlan({ now });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.stage, "persistence");
    assert.equal(result.reasonCode, "persistence_failed");
  }
  assert.doesNotMatch(JSON.stringify(result), /database path|secret-value/i);
  underlying.close();
});
