import assert from "node:assert/strict";
import test from "node:test";

import { createChinaReferenceCatalog, listChinaDigitalLifeSourceIds, listChinaLocalFoodSourceIds } from "@c-assistant/china-country-pack/reference-catalog";
import type { AmapRoute, ConnectorResult, QWeatherWeatherSnapshot } from "@c-assistant/connectors";
import { SqliteWorkspaceStore } from "@c-assistant/storage";

import { createChinaArrivalFactCollector, type ChinaArrivalAmapReader } from "./china-arrival-facts.js";
import { createChinaArrivalCompilationService } from "./china-plan-compilation.js";
import { createChinaPlanWorkflow } from "./china-plan-workflow.js";
import { createChinaSourcePreparationService } from "./china-source-preparation.js";

const now = "2026-08-07T01:00:00.000Z";

function available<T>(provider: "amap" | "qweather", data: T): ConnectorResult<T> {
  return { status: "available", provider, observedAt: now, data };
}

test("fresh one-user instance prepares, reviews, and confirms a complete China Plan without real providers", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({ displayName: "Alex", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" });
  const initial = store.getWorkspace().activePlan;
  store.updatePlanAccommodation(initial.id, { status: "confirmed", id: "stay-1", name: "Example Stay", address: "1 Example Road", location: "121.46,31.22", source: "amap" });
  store.updatePlanArrival(initial.id, { expectedAtLocal: "2026-09-01T10:00", timeZone: "Asia/Shanghai" });
  store.updatePlanTravelContext(initial.id, { partySize: 2, luggage: "heavy" });

  const route = (mode: AmapRoute["mode"]): ConnectorResult<AmapRoute> => available("amap", { mode, origin: "121.46,31.22", destination: "121.47,31.23", distanceMeters: mode === "walking" ? 1800 : 2400, durationSeconds: mode === "walking" ? 1500 : 600, strategy: mode === "transit" ? "public_transit_recommended" : "amap_recommended" });
  const amap: ChinaArrivalAmapReader = {
    geocodeAddress: async () => available("amap", { formattedAddress: "Shanghai", location: "121.47,31.23", province: "Shanghai", city: "Shanghai", district: "Huangpu", level: "city" }),
    nearbyAccommodation: async () => available("amap", [{ id: "stay-1", name: "Example Stay", address: "1 Example Road", location: "121.46,31.22", type: "Accommodation", city: "Shanghai", district: "Huangpu", distanceMeters: 500 }]),
    drivingRoute: async () => route("driving"),
    walkingRoute: async () => route("walking"),
    reverseGeocode: async () => available("amap", { formattedAddress: "Shanghai", city: "Shanghai", cityCode: "021", district: "Huangpu" }),
    transitRoute: async () => route("transit")
  };
  const weather: QWeatherWeatherSnapshot = {
    location: { id: "121.47,31.23", name: "Shanghai", adminArea: "Shanghai", country: "China", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" },
    current: { observedAt: now, condition: "Cloudy", conditionCode: "101", temperatureC: 28, feelsLikeC: 30, humidityPercent: 70, windDirection: "East", windScale: "2", precipitationMm: 0 },
    daily: [{ date: "2026-09-01", conditionDay: "Rain", conditionNight: "Cloudy", highC: 31, lowC: 24, precipitationMm: 3, uvIndex: 7 }],
    retrievedAt: now,
    attributionUrl: "https://www.qweather.com/weather/shanghai.html"
  };
  const collector = createChinaArrivalFactCollector({
    amap,
    qweather: { weather: async () => available("qweather", weather) },
    sourceSnapshots: () => store.getWorkspace().sourceSnapshots,
    referenceCatalog: (locationName) => createChinaReferenceCatalog({ snapshots: store.getWorkspace().sourceSnapshots, locationName })
  });
  const sourcePreparation = createChinaSourcePreparationService({
    store,
    refresher: {
      refresh: async ({ sourceId }) => {
        const saved = store.saveSourceSnapshot({ sourceId, authority: sourceId === "nia-english" ? "National Immigration Administration" : "Approved first-party provider", titleOriginal: `Official ${sourceId}`, url: sourceId === "nia-english" ? "https://en.nia.gov.cn/" : officialUrl(sourceId), retrievedAt: now, contentHash: (sourceId.charCodeAt(0) % 16).toString(16).repeat(64), excerpt: "Bounded test fixture." });
        return { status: "available", provider: "official_source" as const, observedAt: now, data: saved };
      }
    }
  });
  const workflow = createChinaPlanWorkflow({ sourcePreparation, compilation: createChinaArrivalCompilationService({ store, factCollector: collector }) });

  const result = await workflow.prepareCurrentPlan({ planId: initial.id, now });
  assert.equal(result.status, "saved", JSON.stringify(result));
  if (result.status !== "saved") return;
  assert.equal(result.sources.length, 1 + listChinaDigitalLifeSourceIds().length + listChinaLocalFoodSourceIds(initial.location).length);
  assert.equal(result.compilation.workspace.activePlan.status, "draft");
  assert.ok(result.compilation.workspace.activePlan.stages.at(-1)?.tasks.length);
  assert.ok(result.compilation.workspace.activePlan.knownInformation.some((item) => /Nanxiang xiaolongbao.*南翔小笼包/i.test(item)));
  assert.ok(result.compilation.workspace.activePlan.sources.some((source) => source.url.includes("english.shanghai.gov.cn/en-SpecialtyFood/")));
  assert.equal(store.listRecentCountryPackSkillRuns().length, 8);

  const confirmed = store.confirmPlan(initial.id);
  assert.equal(confirmed.activePlan.status, "active");
  assert.throws(() => store.saveCompiledPlan({ plan: result.compilation.workspace.activePlan, expectedPlanId: initial.id, expectedVersion: initial.version, audit: { countryPackId: "china", countryPackVersion: "0.1.0", compositionSkillId: "china-arrival-plan", compositionSkillVersion: "0.1.0", sourcePlanVersion: initial.version, compiledPlanVersion: initial.version + 1, taskCount: 0, reminderCount: 0 } }), /changed before|next draft/i);
  store.close();
});

function officialUrl(sourceId: string): string {
  const urls: Record<string, string> = {
    "china-working-living-guide-2025": "https://english.www.gov.cn/2025special/bizexpatsinchina2025",
    "china-mobile-foreign-sim": "https://www.10086.cn/support/service/foreign/",
    "amap-mobile-official": "https://mobile.amap.com/cn/Index.aspx",
    "wechat-official": "https://www.wechat.com/en",
    "shanghai-official-iconic-foods-2026": "https://english.shanghai.gov.cn/en-SpecialtyFood/20260511/594d417a429d426e8442a47336c47574.html"
  };
  return urls[sourceId]!;
}
