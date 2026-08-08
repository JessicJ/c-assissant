import assert from "node:assert/strict";
import test from "node:test";

import { listChinaDigitalLifeSourceIds, listChinaLocalFoodSourceIds } from "@c-assistant/china-country-pack/reference-catalog";
import type { ConnectorResult } from "@c-assistant/connectors";
import type { SourceSnapshotInput, SourceSnapshotWriteResult } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";

import { createChinaSourcePreparationService, type ChinaOfficialSourceRefresher } from "./china-source-preparation.js";

const now = "2026-08-07T12:00:00.000Z";

function sourceInput(sourceId: string): SourceSnapshotInput {
  const domain = sourceId === "nia-english" ? "en.nia.gov.cn" : sourceId === "china-mobile-foreign-sim" ? "www.10086.cn" : sourceId === "amap-mobile-official" ? "mobile.amap.com" : sourceId === "wechat-official" ? "www.wechat.com" : sourceId === "shanghai-official-iconic-foods-2026" ? "english.shanghai.gov.cn" : "english.www.gov.cn";
  return { sourceId, authority: `Authority ${sourceId}`, titleOriginal: `Title ${sourceId}`, url: `https://${domain}/guide`, retrievedAt: now, contentHash: sourceId.padEnd(64, "a").slice(0, 64).replace(/[^a-f0-9]/gi, "a"), excerpt: "Retained source text." };
}

function savingRefresher(store: SqliteWorkspaceStore, calls: string[]): ChinaOfficialSourceRefresher {
  return {
    refresh: async ({ sourceId }): Promise<ConnectorResult<SourceSnapshotWriteResult>> => {
      calls.push(sourceId);
      return { status: "available", provider: "official_source", observedAt: now, data: store.saveSourceSnapshot(sourceInput(sourceId)) };
    }
  };
}

test("China source preparation refreshes approved sources and links policy plus city food evidence to the draft", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const calls: string[] = [];
  const service = createChinaSourcePreparationService({ store, refresher: savingRefresher(store, calls) });
  const first = await service.prepareCurrentPlan({ planId: original.id, now });
  assert.equal(first.status, "ready");
  const localFoodSourceIds = listChinaLocalFoodSourceIds(original.location);
  assert.deepEqual(calls, ["nia-english", ...listChinaDigitalLifeSourceIds(), ...localFoodSourceIds]);
  const prepared = store.getWorkspace();
  assert.equal(prepared.activePlan.version, original.version + 1 + localFoodSourceIds.length);
  assert.deepEqual(new Set(prepared.activePlan.sources.map((source) => source.sourceSnapshotId)), new Set(prepared.sourceSnapshots.filter((snapshot) => snapshot.sourceId === "nia-english" || localFoodSourceIds.includes(snapshot.sourceId)).map((snapshot) => snapshot.id)));
  assert.equal(prepared.sourceSnapshots.length, 1 + listChinaDigitalLifeSourceIds().length + localFoodSourceIds.length);

  calls.length = 0;
  const second = await service.prepareCurrentPlan({ planId: original.id, now });
  assert.equal(second.status, "ready");
  assert.deepEqual(calls, []);
  assert.equal(store.getWorkspace().activePlan.version, original.version + 1 + localFoodSourceIds.length);
  store.close();
});

test("China source preparation fails closed when current NIA evidence is unavailable", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const service = createChinaSourcePreparationService({ store, refresher: { refresh: async () => ({ status: "unavailable", provider: "official_source", observedAt: now, failure: { code: "network_error", message: "secret provider detail", retryable: true } }) } });
  const result = await service.prepareCurrentPlan({ planId: plan.id, now });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.equal(result.reasonCode, "critical_source_unavailable");
  assert.equal(store.getWorkspace().activePlan.version, plan.version);
  assert.doesNotMatch(JSON.stringify(result), /secret provider detail|network_error/i);
  store.close();
});

test("China source preparation does not link evidence after the Plan is activated concurrently", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const refresher: ChinaOfficialSourceRefresher = {
    refresh: async ({ sourceId }) => {
      const data = store.saveSourceSnapshot(sourceInput(sourceId));
      if (sourceId === "nia-english") store.confirmPlan(plan.id);
      return { status: "available", provider: "official_source", observedAt: now, data };
    }
  };
  const result = await createChinaSourcePreparationService({ store, refresher }).prepareCurrentPlan({ planId: plan.id, now });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.equal(result.reasonCode, "plan_changed");
  assert.equal(store.getWorkspace().activePlan.status, "active");
  assert.equal(store.getWorkspace().activePlan.sources.length, 0);
  store.close();
});
