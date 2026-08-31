import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorResult, QWeatherWeatherSnapshot } from "@c-assistant/connectors";
import { fetchUserWeather } from "./user-weather.js";

test("uses the configured global weather provider without a regional fallback", async () => {
  let calls = 0;
  const available = {
    status: "available",
    provider: "google_weather",
    observedAt: "2026-08-08T03:00:00.000Z",
    data: { provider: "google_weather", retrievedAt: "2026-08-08T03:00:00.000Z" }
  } as ConnectorResult<QWeatherWeatherSnapshot>;
  const result = await fetchUserWeather({ coordinates: "121.47,31.23", locationName: "Shanghai", dependencies: { weather: async () => { calls += 1; return available; } } });
  assert.equal(result.provider, "google_weather");
  assert.equal(calls, 1);
});

test("preserves a Google Weather failure without calling a regional provider", async () => {
  const result = await fetchUserWeather({
    coordinates: "121.47,31.23",
    locationName: "Shanghai",
    dependencies: { weather: async () => ({ status: "not_configured", provider: "google_weather", observedAt: "2026-08-08T03:00:00.000Z", failure: { code: "not_configured", message: "missing", retryable: false } }) }
  });
  assert.equal(result.status, "not_configured");
  assert.equal(result.provider, "google_weather");
});
