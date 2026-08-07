import assert from "node:assert/strict";
import test from "node:test";

import type { AmapGeocodedPlace, ConnectorResult, QWeatherWeatherSnapshot } from "@c-assistant/connectors";
import { fetchTelegramPlanWeather, formatTelegramWeather } from "./telegram-weather.js";

const snapshot: QWeatherWeatherSnapshot = {
  location: { id: "121.47,31.23", name: "Shanghai", adminArea: "Shanghai", country: "China", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" },
  current: { observedAt: "2026-08-07T08:00:00+08:00", condition: "Cloudy", conditionCode: "101", temperatureC: 29, feelsLikeC: 31, humidityPercent: 72, windDirection: "East", windScale: "3", precipitationMm: 0 },
  daily: [{ date: "2026-08-07", conditionDay: "Rain", conditionNight: "Cloudy", highC: 32, lowC: 25, precipitationMm: 4, uvIndex: 7 }],
  retrievedAt: "2026-08-07T00:00:01.000Z",
  attributionUrl: "https://www.qweather.com/weather/shanghai.html"
};

test("Telegram weather resolves only the current Plan location through Amap and QWeather", async () => {
  const result = await fetchTelegramPlanWeather({
    location: "Shanghai, China",
    dependencies: {
      geocodeAddress: async (): Promise<ConnectorResult<AmapGeocodedPlace>> => ({ status: "available", provider: "amap", observedAt: "2026-08-07T00:00:00Z", data: { formattedAddress: "Shanghai", location: "121.47,31.23", province: "Shanghai", city: "Shanghai", district: "Huangpu", level: "city" } }),
      weather: async () => ({ status: "available", provider: "qweather", observedAt: "2026-08-07T00:00:01Z", data: snapshot })
    }
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  const text = formatTelegramWeather(result.data);
  assert.match(text, /Current observation: Cloudy, 29°C/);
  assert.match(text, /2026-08-07: Rain \/ Cloudy, 25–32°C/);
  assert.match(text, /rain or snow protection/);
  assert.match(text, /Source: QWeather — https:\/\/www\.qweather\.com/);
  assert.match(text, /does not create a reminder/);
});

test("Telegram weather does not call providers for an unconfirmed Plan location", async () => {
  const result = await fetchTelegramPlanWeather({
    location: "Location to be confirmed",
    dependencies: {
      geocodeAddress: async () => { throw new Error("Amap must not run."); },
      weather: async () => { throw new Error("QWeather must not run."); }
    }
  });
  assert.deepEqual(result, { status: "unavailable", stage: "plan", code: "location_missing", message: "Confirm the current Plan location before checking weather." });
});

test("Telegram weather drops non-QWeather attribution links", () => {
  assert.doesNotMatch(formatTelegramWeather({ ...snapshot, attributionUrl: "https://example.com/weather" }), /example\.com/);
});
