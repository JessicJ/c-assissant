import assert from "node:assert/strict";
import test from "node:test";

import type { RouteFact, WeatherSnapshot } from "@c-assistant/connectors";
import { classifyMovementWeather, recommendLocalTransport } from "./local-transport-recommendation.js";

const driving: RouteFact = { provider: "google_maps", mode: "driving", origin: "115.25,-8.51", destination: "115.26,-8.50", distanceMeters: 4_200, durationSeconds: 900, strategy: "google_maps_recommended" };
const walking: RouteFact = { provider: "google_maps", mode: "walking", origin: "115.25,-8.51", destination: "115.26,-8.50", distanceMeters: 4_400, durationSeconds: 4_800, strategy: "google_maps_recommended" };

function weather(overrides: Partial<WeatherSnapshot["current"]> = {}): WeatherSnapshot {
  return {
    provider: "google_weather",
    location: { id: "bali", name: "Bali", adminArea: "Bali", country: "Indonesia", latitude: -8.5, longitude: 115.2, timezone: "Asia/Makassar" },
    current: { observedAt: "2026-09-10T02:00:00.000Z", condition: "Clear", conditionCode: "clear", temperatureC: 28, feelsLikeC: 30, humidityPercent: 70, windDirection: "E", windScale: "2", precipitationMm: 0, ...overrides },
    daily: [],
    retrievedAt: "2026-09-10T02:00:00.000Z"
  };
}

test("maps a taxi preference to ride-hail car, not a provider", () => {
  const result = recommendLocalTransport({ routeFacts: [driving, walking], preference: "taxi", localTime: "11:00", luggage: "light", partySize: 1, weather: weather() });
  assert.equal(result.primary.option, "ride_hail_car");
  assert.match(result.primary.visibleRationale, /Choose the local ride app yourself/);
});

test("uses walking only for short daytime acceptable-weather movement", () => {
  const result = recommendLocalTransport({ routeFacts: [{ ...walking, distanceMeters: 650, durationSeconds: 540 }], preference: "plan_recommended", localTime: "14:00", luggage: "light", partySize: 1, weather: weather() });
  assert.equal(result.primary.option, "walking");
  assert.equal(result.alternatives.some((action) => action.option === "ride_hail_car"), true);
});

test("overrides walking preference at night", () => {
  const result = recommendLocalTransport({ routeFacts: [{ ...walking, distanceMeters: 650 }, driving], preference: "walking", localTime: "21:00", luggage: "light", partySize: 1, weather: weather() });
  assert.equal(result.primary.option, "ride_hail_car");
  assert.ok(result.primary.rationaleCodes.includes("walking_preference_overridden_by_safety_context"));
});

test("degrades missing context with conservative defaults", () => {
  const result = recommendLocalTransport({ routeFacts: [driving], preference: "plan_recommended", localTime: "11:00" });
  assert.equal(result.primary.option, "ride_hail_car");
  assert.ok(result.degradedReasons.includes("unknown_luggage_defaulted_to_light_bag"));
  assert.ok(result.primary.rationaleCodes.includes("unknown_luggage_blocks_two_wheel_primary"));
});

test("classifies first-slice movement weather impacts", () => {
  assert.equal(classifyMovementWeather(weather({ condition: "Light rain", precipitationMm: 0.2 })), "rain");
  assert.equal(classifyMovementWeather(weather({ condition: "Thunderstorm" })), "severe");
  assert.equal(classifyMovementWeather(weather({ feelsLikeC: 33 })), "heat");
});

test("visible recommendation copy uses route facts without exposing internal rule wording", () => {
  const result = recommendLocalTransport({ routeFacts: [driving, walking], preference: "plan_recommended", localTime: "11:00", luggage: "light", partySize: 1, weather: weather() });
  assert.equal(result.primary.option, "ride_hail_car");
  assert.doesNotMatch(result.primary.visibleRationale, /safest default|route certainty|first-slice|weak preference|safety rules/i);
  assert.match(result.primary.visibleRationale, /4\.2 km/);
  assert.match(result.primary.visibleRationale, /15 min by car/);
  assert.match(result.primary.visibleRationale, /80 min walking/);
});
