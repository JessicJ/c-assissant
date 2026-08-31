import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft } from "@c-assistant/core";
import type { ConnectorResult, GeocodedPlaceFact, RouteFact } from "@c-assistant/connectors";
import { prepareAccommodationDepartures, type AccommodationDepartureMaps } from "./accommodation-departure.js";

function available<T>(data: T): ConnectorResult<T> { return { status: "available", provider: "google_maps", observedAt: "2026-08-18T04:00:00.000Z", data }; }

test("accommodation linkage prepares one verified departure for each scheduled day", async () => {
  const plan = createPlanFromDraft({
    title: "Paris", location: "Paris", dates: "2026-10-06 to 2026-10-08", knownInformation: [], assumptions: [], nextAction: "Review",
    presentation: { kind: "itinerary", summary: "Paris", days: [
      { id: "day-1", label: "Oct 6", city: "Paris", placeIds: ["louvre"] },
      { id: "day-2", label: "Oct 7", city: "Paris", placeIds: ["tower"] }
    ], places: [
      { id: "louvre", name: "Louvre", locationLabel: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "must", whyWorthIt: "Art", plan: "Visit", detailSections: [], sourceRefs: [] },
      { id: "tower", name: "Eiffel Tower", locationLabel: "Paris", coordinates: [48.858, 2.294], category: "sight", priority: "must", whyWorthIt: "View", plan: "Visit", detailSections: [], sourceRefs: [] }
    ], routeSegments: [] },
    stages: [{ title: "Itinerary", description: "Days", presentationKind: "itinerary", tasks: [{ title: "Travel", owner: "user", dueLabel: "During trip" }] }]
  });
  const destinations: string[] = [];
  const maps: AccommodationDepartureMaps = {
    geocodeAddress: async () => { throw new Error("coordinates already exist"); },
    drivingRoute: async ({ origin, destination }) => { destinations.push(destination); return available<RouteFact>({ provider: "google_maps", mode: "driving", origin, destination, distanceMeters: 4_000, durationSeconds: 900, strategy: "google_maps_recommended" }); },
    walkingRoute: async () => { throw new Error("wrong mode"); },
    transitRoute: async () => { throw new Error("wrong mode"); }
  };
  const result = await prepareAccommodationDepartures({ plan, accommodationName: "Hotel", accommodationAddress: "1 Rue, Paris", accommodationLocation: "2.33,48.85", maps });
  assert.deepEqual(destinations.sort(), ["2.294,48.858", "2.34,48.86"]);
  assert.equal(result.length, 2);
  assert.equal(result.every((item) => item.departure.verification === "verified" && item.departure.durationMinutes === 15), true);
});

test("accommodation linkage preserves a pending day when routing is unavailable", async () => {
  const plan = createPlanFromDraft({
    title: "London", location: "London", dates: "2026", knownInformation: [], assumptions: [], nextAction: "Review",
    presentation: { kind: "itinerary", summary: "London", days: [{ id: "day", label: "Day", city: "London", placeIds: ["museum"] }], places: [{ id: "museum", name: "Museum", locationLabel: "London", category: "museum", priority: "must", whyWorthIt: "Visit", plan: "Visit", detailSections: [], sourceRefs: [] }], routeSegments: [] },
    stages: [{ title: "Itinerary", description: "Day", tasks: [{ title: "Travel", owner: "user", dueLabel: "During trip" }] }]
  });
  const unavailable: ConnectorResult<RouteFact> = { status: "unavailable", provider: "google_maps", observedAt: "2026-08-18T04:00:00.000Z", failure: { code: "network", message: "down", retryable: true } };
  const maps: AccommodationDepartureMaps = {
    geocodeAddress: async () => available<GeocodedPlaceFact>({ provider: "google_maps", formattedAddress: "Museum", location: "-0.12,51.51", province: "", city: "London", district: "", level: "place" }),
    drivingRoute: async () => unavailable,
    walkingRoute: async () => unavailable,
    transitRoute: async () => unavailable
  };
  const result = await prepareAccommodationDepartures({ plan, accommodationName: "Hotel", accommodationAddress: "London", accommodationLocation: "-0.1,51.5", maps });
  assert.equal(result[0]?.departure.verification, "needs_verification");
});
