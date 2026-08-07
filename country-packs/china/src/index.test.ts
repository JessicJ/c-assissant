import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { chinaArrivalPlanSupportingSkillOrder, runArrivalPreparationSkill, runChinaArrivalPlanSkill, runDigitalLifeSetupSkill, runFoodNearbySkill, runHousingAreaRecommendationSkill, runLocalFoodGuideSkill, runPolicyApplicabilitySkill, runTransportPlannerSkill, runWeatherAndPackingSkill, type ArrivalPreparationItemInput, type ChinaArrivalPlanSupportingResult, type ChinaArrivalPlanSupportingSkillId } from "./index.js";
import { chinaSkillRegistry } from "./registry.js";

const candidates = [
  { id: "near", name: "Nearby Noodles", address: "1 Example Road", location: "121.47,31.23", type: "Chinese food", distanceMeters: 180 },
  { id: "far", name: "Farther Dumplings", address: "2 Example Road", location: "121.48,31.24", type: "Chinese food", distanceMeters: 920 }
];

test("food-nearby runtime identity matches its internal-only manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/food-nearby/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runFoodNearbySkill({ partySize: 1, candidates: [], observedAt: "2026-08-07T00:00:00.000Z" });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runFoodNearbySkill");
});

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

test("housing-area-recommendation asks for an access anchor before comparing stays", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/housing-area-recommendation/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runHousingAreaRecommendationSkill({ candidates, observedAt: "2026-08-07T00:00:00.000Z" });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runHousingAreaRecommendationSkill");
  assert.equal(result.status, "needs_input");
  assert.equal(result.needsInput?.field, "centreName");
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

test("transport-planner identity matches its internal-only manifest and asks for route facts", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/transport-planner/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runTransportPlannerSkill({ preference: "plan_recommended", luggage: "light", routeFacts: [], routeObservedAt: "2026-08-07T00:00:00.000Z" });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runTransportPlannerSkill");
  assert.equal(result.status, "needs_input");
  assert.equal(result.needsInput?.field, "routeFacts");
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

test("weather-and-packing identity matches its internal manifest and derives bounded prompts", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/weather-and-packing/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runWeatherAndPackingSkill(weatherInput);
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runWeatherAndPackingSkill");
  assert.deepEqual(result.recommendations.map((item) => item.kind), ["rain_protection", "warm_layer", "heat_hydration", "sun_protection"]);
  assert.equal(result.sources[0]?.url, weatherInput.attributionUrl);
});

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

const policyEvidence = { id: "source-1", sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidance", url: "https://en.nia.gov.cn/", retrievedAt: "2026-08-06T12:00:00.000Z", contentHash: "a".repeat(64) };

test("policy-applicability identity matches its internal manifest and asks only for missing facts", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/policy-applicability/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runPolicyApplicabilitySkill({ immigrationStatus: "unknown", location: "Shanghai, China", dates: "September 2026", evidence: [], now: "2026-08-07T00:00:00.000Z" });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runPolicyApplicabilitySkill");
  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.needsInput.map((item) => item.field), ["profile.nationality", "profile.immigrationStatus", "official_source.nia-english"]);
});

test("policy-applicability marks fresh approved evidence ready only for separate review", () => {
  const result = runPolicyApplicabilitySkill({ nationality: "Canada", immigrationStatus: "tourist_visa", location: "Shanghai, China", dates: "September 2026", evidence: [policyEvidence], now: "2026-08-07T00:00:00.000Z" });
  assert.equal(result.status, "success");
  assert.equal(result.sources[0]?.id, "source-1");
  assert.match(result.nextAction, /separate source-backed policy review/);
  assert.match(result.warnings.join(" "), /does not determine/);
  assert.deepEqual(result.proposedTasks, []);
});

test("policy-applicability rejects stale, future, and unapproved evidence for current review without interpreting content", () => {
  const stale = runPolicyApplicabilitySkill({ nationality: "Canada", immigrationStatus: "tourist_visa", location: "Shanghai, China", dates: "September 2026", evidence: [{ ...policyEvidence, retrievedAt: "2026-07-01T00:00:00.000Z" }], now: "2026-08-07T00:00:00.000Z" });
  assert.equal(stale.status, "blocked");
  assert.equal(stale.reasonCode, "needs_evidence");
  assert.equal(stale.sources[0]?.id, "source-1");
  const future = runPolicyApplicabilitySkill({ nationality: "Canada", immigrationStatus: "tourist_visa", location: "Shanghai, China", dates: "September 2026", evidence: [{ ...policyEvidence, retrievedAt: "2026-08-08T00:00:00.000Z" }], now: "2026-08-07T00:00:00.000Z" });
  assert.equal(future.status, "blocked");
  const unapproved = runPolicyApplicabilitySkill({ nationality: "Canada", immigrationStatus: "tourist_visa", location: "Shanghai, China", dates: "September 2026", evidence: [{ ...policyEvidence, url: "https://example.com/policy" }], now: "2026-08-07T00:00:00.000Z" });
  assert.equal(unapproved.status, "blocked");
  assert.equal(unapproved.sources.length, 0);
  assert.match(unapproved.warnings.join(" "), /omitted/);
});

const localFoodSource = { id: "shanghai-culture-1", authority: "Shanghai Municipal Administration of Culture and Tourism", titleOriginal: "上海美食介绍", url: "https://example.shanghai.gov.cn/food", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "b".repeat(64) };
const localFoodFacts = [
  { id: "xiaolongbao", nameOriginal: "小笼包", nameEnglish: "xiaolongbao", descriptionEnglish: "A steamed bun style associated with the destination's food culture.", sourceId: localFoodSource.id },
  { id: "scallion-noodles", nameOriginal: "葱油拌面", nameEnglish: "scallion oil noodles", descriptionEnglish: "A noodle dish described by the linked destination source.", sourceId: localFoodSource.id }
];

test("local-food-guide identity matches its internal manifest and asks only for Plan location", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/local-food-guide/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runLocalFoodGuideSkill({ facts: localFoodFacts, sources: [localFoodSource], approvedSourceIds: [localFoodSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runLocalFoodGuideSkill");
  assert.equal(result.status, "needs_input");
  assert.equal(result.needsInput?.field, "plan.location");
});

test("local-food-guide preserves bilingual source-backed context without choosing restaurants", () => {
  const result = runLocalFoodGuideSkill({ locationName: "Shanghai", facts: localFoodFacts, sources: [localFoodSource], approvedSourceIds: [localFoodSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(result.status, "success");
  assert.deepEqual(result.facts.map((fact) => [fact.nameOriginal, fact.nameEnglish]), [["小笼包", "xiaolongbao"], ["葱油拌面", "scallion oil noodles"]]);
  assert.equal(result.recommendations.length, 2);
  assert.deepEqual(result.actionCards, []);
  assert.deepEqual(result.proposedTasks, []);
  assert.match(result.summary, /specific places can be considered after arrival or on request/);
  assert.match(result.warnings.join(" "), /not restaurant recommendations/);
});

test("local-food-guide degrades without traceable facts and omits malformed or duplicate input", () => {
  const untraceable = runLocalFoodGuideSkill({ locationName: "Shanghai", facts: localFoodFacts, sources: [], approvedSourceIds: [localFoodSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(untraceable.status, "degraded");
  assert.equal(untraceable.facts.length, 0);
  const filtered = runLocalFoodGuideSkill({ locationName: "Shanghai", facts: [...localFoodFacts, { ...localFoodFacts[0]!, id: "duplicate" }, { ...localFoodFacts[0]!, id: "", sourceId: "missing" }], sources: [localFoodSource, { ...localFoodSource, id: "bad", url: "http://example.com" }], approvedSourceIds: [localFoodSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(filtered.status, "success");
  assert.equal(filtered.facts.length, 2);
  assert.match(filtered.warnings.join(" "), /omitted/);
  const stale = runLocalFoodGuideSkill({ locationName: "Shanghai", facts: localFoodFacts, sources: [{ ...localFoodSource, retrievedAt: "2026-01-01T00:00:00.000Z" }], approvedSourceIds: [localFoodSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(stale.status, "degraded");
});

const digitalSource = { id: "amap-user-guide", authority: "Amap", titleOriginal: "高德地图用户指南", url: "https://lbs.amap.com/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "c".repeat(64) };
const digitalItems = [
  { id: "amap", nameOriginal: "高德地图", nameEnglish: "Amap", category: "map_navigation" as const, reasonEnglish: "Use the Plan's verified places and route handoffs.", stepsEnglish: ["Open the official link.", "Install Amap from the official store for your device."], sourceId: digitalSource.id },
  { id: "unused-pay", nameOriginal: "示例支付", nameEnglish: "Example payment app", category: "local_payments" as const, reasonEnglish: "Payment context.", stepsEnglish: ["Review the official setup guide."], sourceId: digitalSource.id }
];

test("digital-life-setup identity matches its internal manifest and derives needs from this Plan", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/digital-life-setup/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runDigitalLifeSetupSkill({ requiredCapabilities: [], completedItemIds: [], items: digitalItems, sources: [digitalSource], approvedSourceIds: [digitalSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runDigitalLifeSetupSkill");
  assert.equal(result.status, "degraded");
  assert.match(result.warnings.join(" "), /derive digital needs from the Plan/);
});

test("digital-life-setup gives English steps, preserves the Chinese name, and skips confirmed work", () => {
  const needed = runDigitalLifeSetupSkill({ requiredCapabilities: ["map_navigation"], completedItemIds: [], items: digitalItems, sources: [digitalSource], approvedSourceIds: [digitalSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(needed.status, "success");
  assert.equal(needed.facts[0]?.nameOriginal, "高德地图");
  assert.equal(needed.facts[0]?.nameEnglish, "Amap");
  assert.deepEqual(needed.recommendations[0]?.stepsEnglish, digitalItems[0]?.stepsEnglish);
  assert.equal(needed.actionCards[0]?.url, digitalSource.url);
  assert.equal(needed.actionCards[0]?.completion, "unknown_until_user_confirms");
  assert.deepEqual(needed.proposedTasks, []);
  const completed = runDigitalLifeSetupSkill({ requiredCapabilities: ["map_navigation"], completedItemIds: ["amap"], items: digitalItems, sources: [digitalSource], approvedSourceIds: [digitalSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(completed.facts[0]?.setupState, "confirmed_completed");
  assert.equal(completed.recommendations.length, 0);
  assert.equal(completed.actionCards.length, 0);
});

test("digital-life-setup degrades on missing or stale approved guidance and fails malformed input", () => {
  const missing = runDigitalLifeSetupSkill({ requiredCapabilities: ["communication", "map_navigation"], completedItemIds: [], items: digitalItems, sources: [digitalSource], approvedSourceIds: [digitalSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(missing.status, "degraded");
  assert.deepEqual(missing.unresolvedCapabilities, ["communication"]);
  const stale = runDigitalLifeSetupSkill({ requiredCapabilities: ["map_navigation"], completedItemIds: [], items: digitalItems, sources: [{ ...digitalSource, retrievedAt: "2026-01-01T00:00:00.000Z" }], approvedSourceIds: [digitalSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(stale.status, "degraded");
  assert.equal(stale.facts.length, 0);
  const malformedItem = runDigitalLifeSetupSkill({ requiredCapabilities: ["map_navigation"], completedItemIds: [], items: [{ id: "broken" } as never], sources: [digitalSource], approvedSourceIds: [digitalSource.id], now: "2026-08-07T01:00:00.000Z" });
  assert.equal(malformedItem.status, "degraded");
  assert.equal(runDigitalLifeSetupSkill({ requiredCapabilities: ["unknown" as never], completedItemIds: [], items: [], sources: [], approvedSourceIds: [], now: "not-a-date" }).status, "failed");
});

const preparationItems: ArrivalPreparationItemInput[] = [
  { key: "carry-entry-documents", titleEnglish: "Carry entry documents", titleOriginal: "携带入境材料", detailsEnglish: "Keep the source-backed documents required for review accessible.", category: "documents", criticality: "critical", state: "needed", sourceSkill: { id: "policy-applicability", version: "0.1.0" }, timing: { anchor: "departure", leadMinutes: 120, refreshFacts: [] } },
  { key: "pack-for-weather", titleEnglish: "Check weather-sensitive packing", detailsEnglish: "Refresh the destination forecast before leaving.", category: "packing", criticality: "supporting", state: "needed", sourceSkill: { id: "weather-and-packing", version: "0.1.0" }, timing: { anchor: "departure", leadMinutes: 720, refreshFacts: ["weather"] } }
];

test("arrival-preparation identity matches its internal manifest and degrades without valid items", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/arrival-preparation/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runArrivalPreparationSkill({ items: [], schedule: { timeZone: "Asia/Shanghai" } });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runArrivalPreparationSkill");
  assert.equal(result.status, "degraded");
});

test("arrival-preparation deduplicates provenance and does not repropose confirmed work", () => {
  const result = runArrivalPreparationSkill({
    items: [...preparationItems, { ...preparationItems[0]!, state: "confirmed_completed", sourceSkill: { id: "digital-life-setup", version: "0.1.0" } }],
    schedule: { departureAt: "2026-09-01T07:00:00+08:00", timeZone: "Asia/Shanghai" }
  });
  assert.equal(result.status, "success");
  const documents = result.facts.find((fact) => fact.key === "carry-entry-documents");
  assert.equal(documents?.state, "confirmed_completed");
  assert.deepEqual(documents?.sourceSkills.map((source) => source.id), ["policy-applicability", "digital-life-setup"]);
  assert.equal(result.proposedTasks.some((task) => task.proposalId.endsWith("carry-entry-documents")), false);
  assert.match(result.warnings.join(" "), /Duplicate preparation items/);
});

test("arrival-preparation calculates the explicit five o'clock reminder without activating it", () => {
  const result = runArrivalPreparationSkill({ items: [preparationItems[0]!], schedule: { departureAt: "2026-09-01T07:00:00+08:00", timeZone: "Asia/Shanghai" } });
  assert.equal(result.status, "success");
  assert.equal(result.proposedReminders[0]?.dueAt, "2026-08-31T21:00:00.000Z");
  assert.equal(result.proposedReminders[0]?.timeZone, "Asia/Shanghai");
  assert.deepEqual(result.proposedReminders[0]?.refreshFacts, []);
  assert.equal(result.proposedTasks[0]?.completion, "requires_user_confirmation");
  assert.deepEqual(result.actionCards, []);
});

test("arrival-preparation asks only for a missing critical anchor and fails malformed timing", () => {
  const missing = runArrivalPreparationSkill({ items: preparationItems, schedule: { timeZone: "Asia/Shanghai" } });
  assert.equal(missing.status, "needs_input");
  assert.deepEqual(missing.needsInput.map((item) => item.field), ["schedule.departureAt"]);
  const malformed = runArrivalPreparationSkill({ items: [{ ...preparationItems[0]!, timing: { anchor: "departure", leadMinutes: -1, refreshFacts: [] } }], schedule: { departureAt: "2026-09-01T07:00:00", timeZone: "not-a-zone" } });
  assert.equal(malformed.status, "failed");
  const mismatchedZone = runArrivalPreparationSkill({ items: preparationItems, schedule: { departureAt: "2026-09-01T07:00:00+08:00", timeZone: "America/New_York" } });
  assert.equal(mismatchedZone.status, "failed");
});

test("China Skill Registry loads every internal manifest and validates invocation envelopes", async () => {
  assert.deepEqual(chinaSkillRegistry.list().map((manifest) => manifest.id).sort(), ["arrival-preparation", "china-arrival-plan", "digital-life-setup", "food-nearby", "housing-area-recommendation", "local-food-guide", "policy-applicability", "transport-planner", "weather-and-packing"]);
  const result = await chinaSkillRegistry.invoke("food-nearby", { partySize: 2, candidates, observedAt: "2026-08-07T00:00:00.000Z" });
  assert.equal(result.skill.id, "food-nearby");
  assert.equal(result.status, "success");
  await assert.rejects(() => chinaSkillRegistry.invoke("unknown-skill", {}), /Unknown Skill/);
});

function supportingResult(id: ChinaArrivalPlanSupportingSkillId, status: ChinaArrivalPlanSupportingResult["status"] = "success"): ChinaArrivalPlanSupportingResult {
  return { skill: { id, version: "0.1.0" }, status, summary: `${id} result.`, facts: [], assumptions: [], recommendations: [{ id }], proposedPlanChanges: [], proposedTasks: [], proposedReminders: [], actionCards: [], sources: [{ id }], warnings: [] };
}

test("china-arrival-plan manifest and runtime block incomplete composition honestly", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/china-arrival-plan/skill.json", import.meta.url), "utf8")) as { id: string; version: string; visibility: string; entrypoint: string };
  const result = runChinaArrivalPlanSkill({ planId: "plan-1", planVersion: 3, supportingResults: [supportingResult("policy-applicability")] });
  assert.deepEqual(result.skill, { id: manifest.id, version: manifest.version });
  assert.equal(manifest.visibility, "internal");
  assert.equal(manifest.entrypoint, "runChinaArrivalPlanSkill");
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "composition_incomplete");
  assert.deepEqual(result.missingSkills, chinaArrivalPlanSupportingSkillOrder.filter((id) => id !== "policy-applicability"));
  assert.deepEqual(result.proposedPlanChanges, []);
});

test("china-arrival-plan preserves declared order and supporting provenance without promoting actions", () => {
  const reversed = [...chinaArrivalPlanSupportingSkillOrder].reverse().map((id) => supportingResult(id));
  const result = runChinaArrivalPlanSkill({ planId: "plan-1", planVersion: 3, supportingResults: reversed });
  assert.equal(result.status, "success");
  assert.deepEqual(result.facts.map((fact) => fact.skillId), chinaArrivalPlanSupportingSkillOrder);
  assert.deepEqual(result.sources.map((source) => source.skillId), chinaArrivalPlanSupportingSkillOrder);
  assert.equal(result.actionCards.length, 0);
  assert.match(result.warnings.at(-1) ?? "", /not promoted/);
});

test("china-arrival-plan fails duplicate results and propagates supporting gates", () => {
  const duplicate = runChinaArrivalPlanSkill({ planId: "plan-1", planVersion: 1, supportingResults: [supportingResult("policy-applicability"), supportingResult("policy-applicability")] });
  assert.equal(duplicate.status, "failed");
  const needsInput = chinaArrivalPlanSupportingSkillOrder.map((id) => supportingResult(id, id === "housing-area-recommendation" ? "needs_input" : "success"));
  assert.equal(runChinaArrivalPlanSkill({ planId: "plan-1", planVersion: 1, supportingResults: needsInput }).status, "needs_input");
  const blocked = chinaArrivalPlanSupportingSkillOrder.map((id) => supportingResult(id, id === "policy-applicability" ? "blocked" : "success"));
  assert.equal(runChinaArrivalPlanSkill({ planId: "plan-1", planVersion: 1, supportingResults: blocked }).reasonCode, "supporting_skill_blocked");
});
