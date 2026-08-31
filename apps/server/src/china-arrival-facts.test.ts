import assert from "node:assert/strict";
import test from "node:test";

import type { AmapRoute, ConnectorResult, QWeatherWeatherSnapshot } from "@c-assistant/connectors";
import { createInitialWorkspace, type SourceSnapshot } from "@c-assistant/core";

import { ChinaArrivalFactCollectionError, createChinaArrivalFactCollector, type ChinaArrivalAmapReader } from "./china-arrival-facts.js";

const now = "2026-08-07T01:00:00.000Z";
const linkedSnapshot: SourceSnapshot = { id: "source-linked", sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidance", url: "https://en.nia.gov.cn/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "a".repeat(64), excerpt: "Retained only in storage." };
const unlinkedSnapshot: SourceSnapshot = { ...linkedSnapshot, id: "source-unlinked", contentHash: "b".repeat(64) };
const weather: QWeatherWeatherSnapshot = {
  location: { id: "121.47,31.23", name: "Shanghai", adminArea: "Shanghai", country: "China", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" },
  current: { observedAt: "2026-08-07T08:00:00+08:00", condition: "Cloudy", conditionCode: "101", temperatureC: 28, feelsLikeC: 30, humidityPercent: 70, windDirection: "East", windScale: "2", precipitationMm: 0 },
  daily: [{ date: "2026-09-01", conditionDay: "Rain", conditionNight: "Cloudy", highC: 31, lowC: 24, precipitationMm: 3, uvIndex: 7 }],
  retrievedAt: "2026-08-07T00:05:00.000Z",
  attributionUrl: "https://www.qweather.com/weather/shanghai.html"
};

function available<T>(provider: "amap" | "qweather", data: T, observedAt = "2026-08-07T00:10:00.000Z"): ConnectorResult<T> {
  return { status: "available", provider, observedAt, data };
}

function planWithFacts() {
  const plan = createInitialWorkspace().activePlan;
  plan.configuration.accommodation = { status: "confirmed", id: "stay-1", name: "Example Stay", address: "1 Example Road", location: "121.46,31.22", source: "amap", updatedAt: now };
  plan.configuration.arrival = { expectedAtLocal: "2026-09-01T10:00", timeZone: "Asia/Shanghai" };
  plan.configuration.travelContext = { partySize: 2, luggage: "heavy" };
  plan.sources = [{ title: linkedSnapshot.titleOriginal, authority: linkedSnapshot.authority, url: linkedSnapshot.url, retrievedAt: linkedSnapshot.retrievedAt, sourceSnapshotId: linkedSnapshot.id, contentHash: linkedSnapshot.contentHash }];
  return plan;
}

function amapReader(routeCalls: string[]): ChinaArrivalAmapReader {
  const route = (mode: AmapRoute["mode"]): ConnectorResult<AmapRoute> => available("amap", { mode, origin: "121.46,31.22", destination: "121.47,31.23", distanceMeters: mode === "walking" ? 1800 : 2400, durationSeconds: mode === "walking" ? 1500 : 600, strategy: mode === "transit" ? "public_transit_recommended" : "amap_recommended" });
  return {
    geocodeAddress: async () => available("amap", { formattedAddress: "Shanghai", location: "121.47,31.23", province: "Shanghai", city: "Shanghai", district: "Huangpu", level: "city" }),
    nearbyAccommodation: async (input) => {
      assert.deepEqual(input, { location: "121.47,31.23", limit: 5 });
      return available("amap", [{ id: "stay-1", name: "Example Stay", address: "1 Example Road", location: "121.46,31.22", type: "Accommodation", city: "Shanghai", cityCode: "021", district: "Huangpu", distanceMeters: 500 }]);
    },
    drivingRoute: async () => { routeCalls.push("driving"); return route("driving"); },
    walkingRoute: async () => { routeCalls.push("walking"); return route("walking"); },
    reverseGeocode: async () => available("amap", { formattedAddress: "Shanghai", city: "Shanghai", cityCode: "021", district: "Huangpu" }),
    transitRoute: async () => { routeCalls.push("transit"); return route("transit"); }
  };
}

const referenceCatalog = () => ({
  localFood: { facts: [], sources: [], approvedSourceIds: [] },
  digitalLife: { requiredCapabilities: ["map_navigation" as const], completedItemIds: [], items: [], sources: [], approvedSourceIds: [] }
});

test("production China fact collector normalizes Plan-scoped provider facts without credentials", async () => {
  const routeCalls: string[] = [];
  const collector = createChinaArrivalFactCollector({
    maps: amapReader(routeCalls),
    weather: { weather: async () => available("qweather", weather) },
    sourceSnapshots: () => [unlinkedSnapshot, linkedSnapshot],
    referenceCatalog
  });
  const facts = await collector.collect({ plan: planWithFacts(), profile: { nationality: "Canada", immigrationStatus: "tourist_visa" }, now });
  assert.deepEqual(routeCalls.sort(), ["driving", "transit", "walking"]);
  assert.deepEqual(facts.policyEvidence.map((item) => item.id), [linkedSnapshot.id]);
  assert.equal("targetDate" in facts.weather ? facts.weather.targetDate : undefined, "2026-09-01");
  assert.equal(facts.transport.weather?.precipitationMm, 3);
  assert.equal(facts.transport.routeFacts.length, 3);
  assert.equal(facts.schedule.arrivalAt, "2026-09-01T10:00:00+08:00");
  assert.doesNotMatch(JSON.stringify(facts), /excerpt|API_KEY|secret/i);
});

test("production China fact collector does not invent a transport origin before accommodation is chosen", async () => {
  const routeCalls: string[] = [];
  const plan = planWithFacts();
  plan.configuration.accommodation = { status: "not_set" };
  const collector = createChinaArrivalFactCollector({
    maps: amapReader(routeCalls),
    weather: { weather: async () => available("qweather", weather) },
    sourceSnapshots: () => [linkedSnapshot],
    referenceCatalog
  });
  const facts = await collector.collect({ plan, profile: { nationality: "Canada", immigrationStatus: "tourist_visa" }, now });
  assert.deepEqual(routeCalls, []);
  assert.deepEqual(facts.transport.routeFacts, []);
});

test("production China fact collector preserves an unsupported weather region as a non-blocking limitation", async () => {
  const collector = createChinaArrivalFactCollector({
    maps: amapReader([]),
    weather: { weather: async () => ({ status: "degraded", provider: "google_weather", observedAt: now, failure: { code: "http_404", message: "provider detail", retryable: false } }) },
    sourceSnapshots: () => [linkedSnapshot],
    referenceCatalog
  });
  const plan = planWithFacts();
  plan.configuration.accommodation = { status: "not_set" };
  const facts = await collector.collect({ plan, profile: { nationality: "Canada", immigrationStatus: "tourist_visa" }, now });
  assert.equal(facts.weather.availability, "not_supported");
  assert.equal(facts.weather.reasonCode, "http_404");
  assert.equal(facts.transport.weather, undefined);
  assert.doesNotMatch(JSON.stringify(facts), /provider detail/);
});

test("production China fact collector returns a sanitized typed provider failure", async () => {
  const amap = amapReader([]);
  amap.geocodeAddress = async () => ({ status: "unauthorized", provider: "amap", observedAt: now, failure: { code: "key=secret-value", message: "AMAP_API_KEY=secret-value", retryable: false } });
  const collector = createChinaArrivalFactCollector({
    maps: amap,
    weather: { weather: async () => { throw new Error("weather must not run"); } },
    sourceSnapshots: () => [],
    referenceCatalog
  });
  await assert.rejects(() => collector.collect({ plan: planWithFacts(), profile: { nationality: "Canada", immigrationStatus: "tourist_visa" }, now }), (error: unknown) => {
    assert.ok(error instanceof ChinaArrivalFactCollectionError);
    assert.equal(error.stage, "destination");
    assert.doesNotMatch(JSON.stringify(error), /secret-value|AMAP_API_KEY/i);
    return true;
  });
});
