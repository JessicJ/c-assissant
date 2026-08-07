import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { chinaArrivalPlanSupportingSkillOrder, runChinaArrivalPlanSkill, runFoodNearbySkill, runHousingAreaRecommendationSkill, runPolicyApplicabilitySkill, runTransportPlannerSkill, runWeatherAndPackingSkill, type ChinaArrivalPlanSupportingResult, type ChinaArrivalPlanSupportingSkillId } from "./index.js";
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

test("China Skill Registry loads every internal manifest and validates invocation envelopes", async () => {
  assert.deepEqual(chinaSkillRegistry.list().map((manifest) => manifest.id).sort(), ["china-arrival-plan", "food-nearby", "housing-area-recommendation", "policy-applicability", "transport-planner", "weather-and-packing"]);
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
