import assert from "node:assert/strict";
import test from "node:test";

import type { ConnectorResult, AmapGeocodedPlace, QWeatherWeatherSnapshot } from "@c-assistant/connectors";
import { createPlanFromDraft } from "@c-assistant/core";
import { refreshTaskReminderWeather } from "./task-reminder-weather.js";

function planAndReminder() {
  const plan = createPlanFromDraft({
    title: "Attend a Shanghai exhibition",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: [],
    assumptions: [],
    nextAction: "Review.",
    stages: [{ title: "Departure", description: "Prepare.", tasks: [{ title: "Pack", owner: "user", dueLabel: "Morning", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check essentials." } }] }]
  });
  return { plan, reminder: plan.stages[0]!.tasks[0]!.reminder! };
}

test("a Task reminder weather refresh uses only the exact forecast date and includes cautious advice", async () => {
  const { plan, reminder } = planAndReminder();
  const result = await refreshTaskReminderWeather({
    plan,
    reminder,
    dependencies: {
      geocodeAddress: async (): Promise<ConnectorResult<AmapGeocodedPlace>> => ({ status: "available", provider: "amap", observedAt: "2026-09-01T00:00:00Z", data: { formattedAddress: "Shanghai", location: "121.47,31.23", province: "Shanghai", city: "Shanghai", district: "Huangpu", level: "city" } }),
      weather: async (): Promise<ConnectorResult<QWeatherWeatherSnapshot>> => ({ status: "available", provider: "qweather", observedAt: "2026-09-01T00:00:01Z", data: { location: { id: "121.47,31.23", name: "Shanghai", adminArea: "Shanghai", country: "China", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" }, current: { observedAt: "2026-09-01T04:50:00+08:00", condition: "Cloudy", conditionCode: "101", temperatureC: 24, feelsLikeC: 25, humidityPercent: 80, windDirection: "East", windScale: "2", precipitationMm: 0 }, daily: [{ date: "2026-08-31", conditionDay: "Sunny", conditionNight: "Clear", highC: 31, lowC: 23, precipitationMm: 0, uvIndex: 8 }, { date: "2026-09-01", conditionDay: "Rain", conditionNight: "Rain", highC: 27, lowC: 21, precipitationMm: 5, uvIndex: 3 }], retrievedAt: "2026-09-01T00:00:01Z", attributionUrl: "https://www.qweather.com/weather/shanghai.html" } })
    }
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.match(result.data.summary, /Rain, 21–27°C/);
  assert.match(result.data.summary, /rain or snow protection/i);
  assert.doesNotMatch(result.data.summary, /31°C/);
  assert.equal(result.data.attributionUrl, "https://www.qweather.com/weather/shanghai.html");
});

test("a failed weather refresh returns a safe classification without inventing facts", async () => {
  const { plan, reminder } = planAndReminder();
  const result = await refreshTaskReminderWeather({
    plan,
    reminder,
    dependencies: {
      geocodeAddress: async (): Promise<ConnectorResult<AmapGeocodedPlace>> => ({ status: "unavailable", provider: "amap", observedAt: "2026-09-01T00:00:00Z", failure: { code: "network_error", message: "unavailable", retryable: true } }),
      weather: async (): Promise<ConnectorResult<QWeatherWeatherSnapshot>> => { throw new Error("Weather must not run without a resolved place."); }
    }
  });
  assert.deepEqual(result, { status: "unavailable", stage: "amap", code: "network_error" });
});

test("a Task reminder weather refresh drops an unapproved attribution link", async () => {
  const { plan, reminder } = planAndReminder();
  const result = await refreshTaskReminderWeather({
    plan,
    reminder,
    dependencies: {
      geocodeAddress: async (): Promise<ConnectorResult<AmapGeocodedPlace>> => ({ status: "available", provider: "amap", observedAt: "2026-09-01T00:00:00Z", data: { formattedAddress: "Shanghai", location: "121.47,31.23", province: "Shanghai", city: "Shanghai", district: "Huangpu", level: "city" } }),
      weather: async (): Promise<ConnectorResult<QWeatherWeatherSnapshot>> => ({ status: "available", provider: "qweather", observedAt: "2026-09-01T00:00:01Z", data: { location: { id: "121.47,31.23", name: "Shanghai", adminArea: "Shanghai", country: "China", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" }, current: { observedAt: "2026-09-01T04:50:00+08:00", condition: "Cloudy", conditionCode: "101", temperatureC: 24, feelsLikeC: 25, humidityPercent: 80, windDirection: "East", windScale: "2", precipitationMm: 0 }, daily: [{ date: "2026-09-01", conditionDay: "Cloudy", conditionNight: "Clear", highC: 27, lowC: 21, precipitationMm: 0, uvIndex: 3 }], retrievedAt: "2026-09-01T00:00:01Z", attributionUrl: "https://example.com/not-qweather" } })
    }
  });
  assert.equal(result.status, "available");
  if (result.status === "available") assert.equal(result.data.attributionUrl, undefined);
});
