import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromDraft, type Plan } from "@c-assistant/core";
import type { ConnectorResult, GeocodedPlaceFact, RouteFact, WeatherSnapshot } from "@c-assistant/connectors";
import { createMovementActionCard, type MovementActionCardMaps } from "./movement-action-card.js";
import { formatTelegramMovementActionCard } from "./telegram-movement-card.js";

function baliPlan(): Plan {
  const draft = createPlanFromDraft({
    title: "Bali one-route validation",
    location: "Bali, Indonesia",
    dates: "2026-09-10",
    knownInformation: ["Staying in Ubud and visiting Ubud Palace."],
    assumptions: [],
    nextAction: "Use /go on the trip.",
    presentation: {
      kind: "itinerary",
      summary: "One fixed Bali route.",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      days: [{ id: "bali-day", label: "Sep 10", date: "2026-09-10", city: "Bali", placeIds: ["ubud-palace"], stops: [{ placeId: "ubud-palace", order: 1, time: "10:30" }] }],
      places: [{ id: "ubud-palace", name: "Ubud Palace", locationLabel: "Jl. Raya Ubud No.8, Ubud, Bali", coordinates: [-8.5069, 115.2625], city: "Bali", area: "Ubud", category: "sight", priority: "must", whyWorthIt: "Central Ubud stop", plan: "Visit", detailSections: [], sourceRefs: [] }],
      routeSegments: []
    },
    stages: [{ title: "Itinerary", description: "Bali", tasks: [{ title: "Visit Ubud Palace", owner: "user", dueLabel: "During trip" }] }]
  });
  draft.configuration.arrival.timeZone = "Asia/Makassar";
  draft.configuration.transport.preference = "plan_recommended";
  draft.configuration.travelContext.luggage = "unknown";
  return { ...draft, status: "active" };
}

const observedAt = "2026-09-10T02:00:00.000Z";
function available<T>(provider: ConnectorResult<T>["provider"], data: T): ConnectorResult<T> {
  return { status: "available", provider, observedAt, data };
}

const maps: MovementActionCardMaps = {
  async convertGpsCoordinate(input) {
    const data: GeocodedPlaceFact = { provider: "google_maps", formattedAddress: "Ubud stay, Bali", location: input.location, province: "Bali", city: "Bali", country: "Indonesia", district: "Ubud", level: "premise" };
    return available("google_maps", data);
  },
  async drivingRoute(input) {
    const route: RouteFact = { provider: "google_maps", mode: "driving", origin: input.origin, destination: input.destination, distanceMeters: 3_800, durationSeconds: 780, strategy: "google_maps_recommended" };
    return available("google_maps", route);
  },
  async walkingRoute(input) {
    const route: RouteFact = { provider: "google_maps", mode: "walking", origin: input.origin, destination: input.destination, distanceMeters: 3_900, durationSeconds: 3_900, strategy: "google_maps_recommended" };
    return available("google_maps", route);
  },
  async transitRoute(input) {
    const route: RouteFact = { provider: "google_maps", mode: "transit", origin: input.origin, destination: input.destination, distanceMeters: 4_100, durationSeconds: 2_400, strategy: "public_transit_recommended" };
    return available("google_maps", route);
  },
  async reverseGeocode(input) {
    return available("google_maps", { formattedAddress: input.location, city: "Bali", cityCode: "bali", district: "Ubud" });
  }
};

function weather(): WeatherSnapshot {
  return {
    provider: "google_weather",
    location: { id: "bali", name: "Bali", adminArea: "Bali", country: "Indonesia", latitude: -8.5, longitude: 115.2, timezone: "Asia/Makassar" },
    current: { observedAt, condition: "Clear", conditionCode: "clear", temperatureC: 28, feelsLikeC: 30, humidityPercent: 70, windDirection: "E", windScale: "2", precipitationMm: 0 },
    daily: [],
    retrievedAt: observedAt
  };
}

test("Bali one-route validation produces a movement card with manual local handoffs and no Uber", async () => {
  const card = await createMovementActionCard({ plan: baliPlan(), currentLocation: { latitude: -8.514, longitude: 115.262 }, maps, weather: { weather: async () => available("google_weather", weather()) }, now: new Date("2026-09-10T02:00:00.000Z") });
  assert.equal(card.status, "degraded");
  assert.equal(card.stopId, "ubud-palace");
  assert.equal(card.primaryRecommendation?.option, "ride_hail_car");
  const services = card.primaryRecommendation?.handoffs.map((handoff) => handoff.serviceName).filter(Boolean) ?? [];
  assert.deepEqual(services, ["Google Maps", "Grab", "Gojek", "Bluebird"]);
  assert.equal(services.includes("Uber"), false);
  assert.equal(card.alternatives.some((action) => action.option === "ride_hail_motorbike" && action.handoffs.some((handoff) => handoff.serviceName === "Grab" || handoff.serviceName === "Gojek")), true);
  assert.equal(card.alternatives.some((action) => action.option === "scooter_rental"), false);
  const telegram = formatTelegramMovementActionCard(card);
  assert.match(telegram.text, /Movement card/);
  assert.doesNotMatch(telegram.text, /Why:/);
  assert.match(telegram.text, /Route:/);
  assert.match(telegram.text, /Use a local app/);
  assert.match(telegram.text, /choose Car/);
  assert.match(telegram.text, /Pickup and Destination shown below/);
  assert.doesNotMatch(telegram.text, /Local handoff/);
  assert.doesNotMatch(telegram.text, /Landi has not booked, paid, hailed a ride/);
  assert.doesNotMatch(telegram.text, /Uber/);
  const inline = telegram.replyMarkup && "inline_keyboard" in telegram.replyMarkup ? telegram.replyMarkup.inline_keyboard : undefined;
  assert.ok(inline?.some((row) => row[0]?.text === "Open in Google Maps"));
});

test("rain changes Bali movement recommendation away from walking without mutating the Plan", async () => {
  const plan = baliPlan();
  plan.configuration.transport.preference = "walking";
  plan.presentation!.places[0]!.coordinates = [-8.5072, 115.2624];
  const card = await createMovementActionCard({ plan, currentLocation: { latitude: -8.507, longitude: 115.262 }, maps: { ...maps, async drivingRoute(input) { return available("google_maps", { provider: "google_maps", mode: "driving", origin: input.origin, destination: input.destination, distanceMeters: 450, durationSeconds: 240, strategy: "google_maps_recommended" }); }, async walkingRoute(input) { return available("google_maps", { provider: "google_maps", mode: "walking", origin: input.origin, destination: input.destination, distanceMeters: 450, durationSeconds: 420, strategy: "google_maps_recommended" }); } }, weather: { weather: async () => available("google_weather", { ...weather(), current: { ...weather().current, condition: "Rain", conditionCode: "rain", precipitationMm: 2 } }) }, now: new Date("2026-09-10T02:00:00.000Z") });
  assert.equal(card.primaryRecommendation?.option, "ride_hail_car");
  assert.equal(plan.configuration.transport.preference, "walking");
});
