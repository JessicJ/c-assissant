import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromRequest } from "@c-assistant/core";

import { orchestrateChinaArrivalPlan, type ChinaArrivalOrchestrationInput } from "./orchestrator.js";

function orchestrationInput(): ChinaArrivalOrchestrationInput {
  const plan = createPlanFromRequest({ request: "I will attend an exhibition in Shanghai in September 2026." });
  const digitalSource = { id: "amap-user-guide", authority: "Amap", titleOriginal: "高德地图用户指南", url: "https://lbs.amap.com/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "c".repeat(64) };
  return {
    plan,
    profile: { nationality: "Canada", immigrationStatus: "tourist_visa" },
    now: "2026-08-07T01:00:00.000Z",
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
      detailsEnglish: "Review the user-visible essential checklist before leaving.",
      category: "arrival_logistics",
      criticality: "critical",
      state: "needed",
      sourceSkill: { id: "policy-applicability", version: "0.1.0" },
      timing: { anchor: "departure", leadMinutes: 120, refreshFacts: [] }
    }]
  };
}

test("China orchestrator runs all supporting Skills in order and returns an inert compiled draft", async () => {
  const input = orchestrationInput();
  const result = await orchestrateChinaArrivalPlan(input);
  assert.equal(result.status, "compiled");
  assert.deepEqual(result.supportingResults.map((item) => item.skill.id), ["policy-applicability", "weather-and-packing", "housing-area-recommendation", "transport-planner", "local-food-guide", "digital-life-setup", "arrival-preparation"]);
  assert.equal(result.composite.status, "degraded");
  if (result.status !== "compiled") return;
  assert.equal(result.compilation.plan.status, "draft");
  assert.equal(result.compilation.plan.version, input.plan.version + 1);
  const generated = result.compilation.plan.stages.at(-1)!;
  assert.ok(generated.tasks.some((task) => task.title === "Complete the source-backed entry requirement review"));
  assert.ok(generated.tasks.some((task) => task.title === "Set up Amap (高德地图)"));
  assert.equal(generated.tasks.find((task) => task.title === "Check essential carry-on items")?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.equal(result.compilation.audit.reminderCount, 1);
});

test("China orchestrator fails closed when a critical supporting Skill needs input", async () => {
  const input = orchestrationInput();
  input.profile = { nationality: "To be confirmed", immigrationStatus: "unknown" };
  const result = await orchestrateChinaArrivalPlan(input);
  assert.equal(result.status, "blocked");
  assert.equal(result.composite.status, "needs_input");
  if (result.status === "blocked") assert.equal(result.reasonCode, "composition_not_ready");
});

test("China orchestrator does not persist, activate, or expose Connector credentials", async () => {
  const input = orchestrationInput();
  const result = await orchestrateChinaArrivalPlan(input);
  assert.equal(input.plan.version, 1);
  assert.equal(input.plan.status, "draft");
  assert.doesNotMatch(JSON.stringify(result), /AMAP_API_KEY|QWEATHER_API_KEY|TELEGRAM_BOT_TOKEN|8921735075|14085cc|bfc3cf/i);
});
