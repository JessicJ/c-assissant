import assert from "node:assert/strict";
import test from "node:test";
import type { AmapBasicWeatherSnapshot, ConnectorResult, QWeatherWeatherSnapshot } from "@c-assistant/connectors";
import { fetchUserWeather } from "./user-weather.js";

const amapWeather: AmapBasicWeatherSnapshot = {
  source: "amap",
  location: { name: "上海市", province: "上海", adcode: "310000" },
  current: { observedAt: "2026-08-08 11:00:00", condition: "多云", temperatureC: 30, humidityPercent: 68, windDirection: "东", windScale: "3" },
  daily: [{ date: "2026-08-08", conditionDay: "多云", conditionNight: "晴", highC: 32, lowC: 26, windDirectionDay: "东", windDirectionNight: "东南", windScaleDay: "3", windScaleNight: "2" }],
  retrievedAt: "2026-08-08T03:01:00.000Z",
  attributionUrl: "https://lbs.amap.com/api/webservice/guide/api/weatherinfo",
  limitations: ["display only"]
};

test("keeps QWeather as the preferred complete source", async () => {
  let amapCalls = 0;
  const preferred = { status: "available", provider: "qweather", observedAt: "2026-08-08T03:00:00.000Z", data: { retrievedAt: "2026-08-08T03:00:00.000Z" } } as ConnectorResult<QWeatherWeatherSnapshot>;
  const result = await fetchUserWeather({ coordinates: "121.47,31.23", locationName: "Shanghai", adcode: "310000", dependencies: { qweather: async () => preferred, amap: async () => { amapCalls += 1; return { status: "available", provider: "amap", observedAt: amapWeather.retrievedAt, data: amapWeather }; } } });
  assert.equal(result.provider, "qweather");
  assert.equal(amapCalls, 0);
});

test("falls back to display-only Amap facts when QWeather is unavailable", async () => {
  const result = await fetchUserWeather({ coordinates: "121.47,31.23", locationName: "Shanghai", adcode: "310000", dependencies: { qweather: async () => ({ status: "rate_limited", provider: "qweather", observedAt: "2026-08-08T03:00:00.000Z", failure: { code: "qweather_429", message: "limited", retryable: true } }), amap: async () => ({ status: "available", provider: "amap", observedAt: amapWeather.retrievedAt, data: amapWeather }) } });
  assert.equal(result.provider, "amap");
  assert.equal(result.data && "source" in result.data ? result.data.source : undefined, "amap");
});

test("preserves the preferred failure when no Amap administrative code is known", async () => {
  let amapCalls = 0;
  const result = await fetchUserWeather({ coordinates: "121.47,31.23", locationName: "Shanghai", dependencies: { qweather: async () => ({ status: "not_configured", provider: "qweather", observedAt: "2026-08-08T03:00:00.000Z", failure: { code: "not_configured", message: "missing", retryable: false } }), amap: async () => { amapCalls += 1; return { status: "available", provider: "amap", observedAt: amapWeather.retrievedAt, data: amapWeather }; } } });
  assert.equal(result.status, "not_configured");
  assert.equal(amapCalls, 0);
});
