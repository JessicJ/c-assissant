import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft } from "@c-assistant/core";
import type { WeatherSnapshot } from "@c-assistant/connectors";
import { assessCurrentWeatherAttention, checkPlanCurrentWeather } from "./plan-weather-monitor.js";

const normalWeather: WeatherSnapshot = {
  provider: "google_weather",
  location: { id: "paris", name: "Paris", adminArea: "Île-de-France", country: "France", latitude: 48.86, longitude: 2.35, timezone: "Europe/Paris" },
  current: { observedAt: "2026-10-06T08:00:00Z", condition: "Partly cloudy", conditionCode: "PARTLY_CLOUDY", temperatureC: 19, feelsLikeC: 19, humidityPercent: 60, windDirection: "W", windScale: "2", precipitationMm: 0 },
  daily: [],
  retrievedAt: "2026-10-06T08:00:01Z"
};

function activeTravelPlan() {
  const plan = createPlanFromDraft({ title: "Paris and London", location: "Paris", dates: "October 2026", knownInformation: ["Travel"], assumptions: [], nextAction: "Review", presentation: { kind: "itinerary", summary: "Two cities", startDate: "2026-10-06", days: [{ id: "paris", label: "Oct 6", date: "2026-10-06", city: "Paris", placeIds: [] }, { id: "london", label: "Oct 9", date: "2026-10-09", city: "London", placeIds: [] }], places: [], routeSegments: [] }, stages: [] });
  return { ...plan, status: "active" as const };
}

test("weather attention ignores normal current conditions and flags material disruption", () => {
  assert.equal(assessCurrentWeatherAttention("Paris", normalWeather), undefined);
  const storm = assessCurrentWeatherAttention("Paris", { ...normalWeather, current: { ...normalWeather.current, condition: "Thunderstorm", conditionCode: "THUNDERSTORM" } });
  assert.equal(storm?.kind, "storm");
  assert.match(storm?.body ?? "", /indoor alternative/i);
});

test("Plan weather monitoring follows the current itinerary destination", async () => {
  const addresses: string[] = [];
  const result = await checkPlanCurrentWeather({
    plan: activeTravelPlan(),
    now: new Date("2026-10-10T08:00:00Z"),
    dependencies: {
      geocodeAddress: async ({ address }) => { addresses.push(address); return { status: "available", provider: "google_maps", observedAt: "2026-10-10T08:00:00Z", data: { formattedAddress: "London, UK", province: "", city: "London", district: "", location: "-0.12,51.50", level: "city" } }; },
      weather: async () => ({ status: "available", provider: "google_weather", observedAt: normalWeather.retrievedAt, data: normalWeather })
    }
  });
  assert.deepEqual(addresses, ["London"]);
  assert.equal(result.status, "normal");
});

test("an explicit arrival switches monitoring before the scheduled city date", async () => {
  const addresses: string[] = [];
  await checkPlanCurrentWeather({
    plan: activeTravelPlan(),
    now: new Date("2026-10-07T08:00:00Z"),
    arrivals: [{ city: "London", arrivedAt: "2026-10-07T07:00:00Z", confirmed: true }],
    dependencies: {
      geocodeAddress: async ({ address }) => { addresses.push(address); return { status: "available", provider: "google_maps", observedAt: "2026-10-07T08:00:00Z", data: { formattedAddress: "London, UK", province: "", city: "London", district: "", location: "-0.12,51.50", level: "city" } }; },
      weather: async () => ({ status: "available", provider: "google_weather", observedAt: normalWeather.retrievedAt, data: normalWeather })
    }
  });
  assert.deepEqual(addresses, ["London"]);
});
