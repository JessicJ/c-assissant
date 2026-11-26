import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import test from "node:test";

import { compilePlanProposal, createPlanFromRequest } from "@c-assistant/core";

import { runFoodNearbySkill, runHousingAreaRecommendationSkill, runTransportPlannerSkill, runWeatherAndPackingSkill } from "./index.js";

const candidates = [
  { id: "near", name: "Nearby Noodles", address: "1 Example Road", location: "121.47,31.23", type: "Chinese food", distanceMeters: 180 },
  { id: "far", name: "Farther Dumplings", address: "2 Example Road", location: "121.48,31.24", type: "Chinese food", distanceMeters: 920 }
];

test("food-nearby asks only for missing party size", () => {
  const result = runFoodNearbySkill({ candidates, observedAt: "2026-08-07T00:00:00.000Z" });
  assert.equal(result.status, "needs_input");
  assert.equal(result.needsInput?.field, "partySize");
  assert.equal(result.facts.length, 0);
});

test("food-nearby preserves Amap order and creates bounded handoff proposals", () => {
  const providerOrder = [...candidates].reverse();
  const result = runFoodNearbySkill({ partySize: 2, candidates: [...providerOrder, ...Array.from({ length: 5 }, (_, index) => ({ ...candidates[0]!, id: `extra-${index}` }))], observedAt: "2026-08-07T00:00:00.000Z" });
  assert.equal(result.status, "success");
  assert.deepEqual(result.facts.map((fact) => fact.id), ["far", "near", "extra-0", "extra-1", "extra-2"]);
  assert.deepEqual(result.facts.map((fact) => fact.position), [1, 2, 3, 4, 5]);
  assert.equal(result.recommendations.length, 0);
  assert.ok(result.actionCards.every((card) => card.completion === "unknown_until_user_confirms"));
  assert.match(result.warnings.join(" "), /not independently ranked/);
});

test("food-nearby fails closed on malformed context and omits malformed provider facts", () => {
  assert.equal(runFoodNearbySkill({ partySize: 0, candidates, observedAt: "2026-08-07T00:00:00.000Z" }).status, "failed");
  const result = runFoodNearbySkill({ partySize: 1, candidates: [...candidates, { ...candidates[0]!, id: "", distanceMeters: -1 }], observedAt: "2026-08-07T00:00:00.000Z" });
  assert.equal(result.status, "success");
  assert.equal(result.facts.length, 2);
  assert.match(result.warnings.join(" "), /omitted/);
});

test("housing-area-recommendation explains only Amap access facts and limitations", () => {
  const result = runHousingAreaRecommendationSkill({ centreName: "Shanghai Exhibition Centre", candidates, observedAt: "2026-08-07T00:00:00.000Z" });
  assert.equal(result.status, "success");
  assert.equal(result.recommendations.length, 2);
  assert.match(result.recommendations[0]?.reason ?? "", /180 m from Shanghai Exhibition Centre by Amap nearby-place distance/);
  assert.match(result.recommendations[0]?.reason ?? "", /Compare an actual route/);
  assert.match(result.warnings.join(" "), /foreign-guest eligibility have not been verified/);
  assert.ok(result.actionCards.every((card) => card.completion === "unknown_until_user_confirms"));
});

test("transport-planner respects this Plan preference and leaves action completion unknown", () => {
  const result = runTransportPlannerSkill({
    preference: "public_transit",
    luggage: "heavy",
    routeFacts: [{ mode: "driving", distanceMeters: 4_000, durationSeconds: 900 }, { mode: "transit", distanceMeters: 3_600, durationSeconds: 1_200 }],
    routeObservedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.equal(result.status, "success");
  assert.equal(result.recommendations[0]?.mode, "transit");
  assert.match(result.recommendations[0]?.reasons.join(" ") ?? "", /explicitly prefers/i);
  assert.equal(result.actionCards[0]?.completion, "unknown_until_user_confirms");
  assert.match(result.warnings.join(" "), /No ride/);
});

test("transport-planner records matched weather provenance and fails closed on malformed facts", () => {
  const result = runTransportPlannerSkill({
    preference: "plan_recommended",
    luggage: "light",
    routeFacts: [{ mode: "walking", distanceMeters: 900, durationSeconds: 800 }, { mode: "transit", distanceMeters: 1_200, durationSeconds: 1_000 }],
    routeObservedAt: "2026-08-07T00:00:00.000Z",
    weather: { condition: "Rain", precipitationMm: 2 },
    weatherObservedAt: "2026-08-07T00:05:00.000Z"
  });
  assert.equal(result.recommendations[0]?.mode, "transit");
  assert.deepEqual(result.sources.map((source) => source.provider), ["amap", "qweather"]);
  assert.deepEqual(result.proposedPlanChanges, []);
  assert.equal(runTransportPlannerSkill({ preference: "plan_recommended", luggage: "light", routeFacts: [{ mode: "walking", distanceMeters: 900 }], routeObservedAt: "2026-08-07T00:00:00.000Z", weather: { condition: "Rain", precipitationMm: 2 } }).status, "failed");
  assert.equal(runTransportPlannerSkill({ preference: "plan_recommended", luggage: "light", routeFacts: [{ mode: "walking", distanceMeters: -1 }], routeObservedAt: "2026-08-07T00:00:00.000Z" }).status, "failed");
});

test("place and transport Skills preserve Google provider provenance", () => {
  const food = runFoodNearbySkill({ partySize: 2, candidates, observedAt: "2026-08-07T00:00:00.000Z", provider: "google_maps" });
  const housing = runHousingAreaRecommendationSkill({ centreName: "Shanghai Exhibition Centre", candidates, observedAt: "2026-08-07T00:00:00.000Z", provider: "google_maps" });
  const transport = runTransportPlannerSkill({
    preference: "walking",
    luggage: "light",
    routeFacts: [{ mode: "walking", distanceMeters: 900, durationSeconds: 800 }],
    routeObservedAt: "2026-08-07T00:00:00.000Z",
    mapProvider: "google_maps",
    weather: { condition: "Cloudy", precipitationMm: 0 },
    weatherObservedAt: "2026-08-07T00:05:00.000Z",
    weatherProvider: "google_weather"
  });
  assert.deepEqual(food.sources.map((source) => source.provider), ["google_maps"]);
  assert.deepEqual(housing.sources.map((source) => source.provider), ["google_maps"]);
  assert.deepEqual(transport.sources.map((source) => source.provider), ["google_maps", "google_weather"]);
  assert.match(food.summary, /Google Maps/);
  assert.match(housing.recommendations[0]?.reason ?? "", /Google Maps/);
});

const weatherInput = {
  locationName: "Shanghai",
  current: { condition: "Cloudy", temperatureC: 24, feelsLikeC: 25, precipitationMm: 0, observedAt: "2026-08-07T00:00:00.000Z" },
  daily: [
    { date: "2026-08-08", conditionDay: "Rain", conditionNight: "Cloudy", highC: 31, lowC: 22, precipitationMm: 4, uvIndex: 7 },
    { date: "2026-08-09", conditionDay: "Sunny", conditionNight: "Clear", highC: 28, lowC: 9, precipitationMm: 0, uvIndex: 5 }
  ],
  retrievedAt: "2026-08-07T00:05:00.000Z",
  attributionUrl: "https://www.qweather.com/weather/shanghai.html"
};

test("weather-and-packing uses only an exact target-date forecast", () => {
  const exact = runWeatherAndPackingSkill({ ...weatherInput, targetDate: "2026-08-08" });
  assert.equal(exact.status, "success");
  assert.equal(exact.facts[0]?.date, "2026-08-08");
  assert.match(exact.summary, /Forecast for 2026-08-08/);
  const missing = runWeatherAndPackingSkill({ ...weatherInput, targetDate: "2026-09-01" });
  assert.equal(missing.status, "degraded");
  assert.equal(missing.facts[0]?.kind, "current");
  assert.match(missing.warnings.join(" "), /not as that date's forecast/);
});

test("weather-and-packing omits unapproved attribution and fails closed on malformed facts", () => {
  const unapproved = runWeatherAndPackingSkill({ ...weatherInput, attributionUrl: "https://example.com/weather" });
  assert.equal(unapproved.sources[0]?.url, undefined);
  assert.match(unapproved.warnings.join(" "), /unapproved attribution/);
  assert.equal(runWeatherAndPackingSkill({ ...weatherInput, retrievedAt: "not-a-date" }).status, "failed");
});

test("weather-and-packing degrades without blocking when the configured provider does not cover a region", () => {
  const result = runWeatherAndPackingSkill({
    locationName: "Unsupported destination",
    availability: "not_supported",
    retrievedAt: "2026-08-07T00:05:00.000Z",
    provider: "google_weather",
    reasonCode: "http_404"
  });
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.recommendations, []);
  assert.deepEqual(result.sources.map((source) => source.provider), ["google_weather"]);
  assert.match(result.summary, /rest of the Plan can continue/i);
});

const policyEvidence = { id: "source-1", sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidance", url: "https://en.nia.gov.cn/", retrievedAt: "2026-08-06T12:00:00.000Z", contentHash: "a".repeat(64) };

const localFoodSource = { id: "shanghai-culture-1", sourceSnapshotId: "snapshot-shanghai-culture-1", authority: "Shanghai Municipal Administration of Culture and Tourism", titleOriginal: "上海美食介绍", url: "https://example.shanghai.gov.cn/food", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "b".repeat(64) };

const localFoodFacts = [
  { id: "xiaolongbao", nameOriginal: "小笼包", nameEnglish: "xiaolongbao", descriptionEnglish: "A steamed bun style associated with the destination's food culture.", sourceId: localFoodSource.id },
  { id: "scallion-noodles", nameOriginal: "葱油拌面", nameEnglish: "scallion oil noodles", descriptionEnglish: "A noodle dish described by the linked destination source.", sourceId: localFoodSource.id }
];

const digitalSource = { id: "amap-user-guide", sourceSnapshotId: "snapshot-amap-user-guide", authority: "Amap", titleOriginal: "高德地图用户指南", url: "https://lbs.amap.com/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "c".repeat(64) };

const digitalItems = [
  { id: "amap", nameOriginal: "高德地图", nameEnglish: "Amap", category: "map_navigation" as const, reasonEnglish: "Use the Plan's verified places and route handoffs.", stepsEnglish: ["Open the official link.", "Install Amap from the official store for your device."], sourceId: digitalSource.id },
  { id: "unused-pay", nameOriginal: "示例支付", nameEnglish: "Example payment app", category: "local_payments" as const, reasonEnglish: "Payment context.", stepsEnglish: ["Review the official setup guide."], sourceId: digitalSource.id }
];
