import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runFoodNearbySkill, runHousingAreaRecommendationSkill, runTransportPlannerSkill } from "./index.js";

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
