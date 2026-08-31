import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft } from "@c-assistant/core";
import type { ConnectorResult, GeocodedPlaceFact, WeatherSnapshot } from "@c-assistant/connectors";
import { resolvePlanArrivalTimeZone } from "./plan-arrival-timezone.js";

test("arrival timezone comes from destination weather facts, never a city-name guess", async () => {
  const plan = createPlanFromDraft({ title: "Paris", location: "Paris", dates: "2026-10-12", knownInformation: [], assumptions: [], nextAction: "Review", presentation: { kind: "itinerary", summary: "Arrival", days: [{ id: "d1", label: "Day 1", date: "2026-10-12", city: "Paris", placeIds: [] }], places: [], routeSegments: [] }, stages: [] });
  plan.configuration.arrival.expectedAtLocal = "2026-10-12T14:30";
  const available = <T>(data: T): ConnectorResult<T> => ({ status: "available", provider: "google_weather", observedAt: "2026-08-18T00:00:00Z", data });
  const result = await resolvePlanArrivalTimeZone(plan, { geocodeAddress: async () => available<GeocodedPlaceFact>({ formattedAddress: "Paris, France", location: "2.35,48.86", province: "", city: "Paris", district: "", level: "city" }), weather: async () => available<WeatherSnapshot>({ location: { id: "paris", name: "Paris", adminArea: "", country: "France", latitude: 48.86, longitude: 2.35, timezone: "Europe/Paris" }, current: { observedAt: "", condition: "Clear", conditionCode: "CLEAR", temperatureC: 20, feelsLikeC: 20, humidityPercent: 50, windDirection: "", windScale: "", precipitationMm: 0 }, daily: [], retrievedAt: "" }) });
  assert.equal(result, "Europe/Paris");
});
