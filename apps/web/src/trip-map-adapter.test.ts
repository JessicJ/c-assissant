import assert from "node:assert/strict";
import test from "node:test";
import type { PlanPresentation } from "@c-assistant/core";
import { parseProviderLocation, toNativeTrip, validCoords } from "./trip-map-adapter.js";

test("Trip map adapter keeps only displayable places and adjacent route segments", () => {
  const presentation: PlanPresentation = {
    kind: "itinerary",
    summary: "Cafes and local streets.",
    startDate: "2026-10-05",
    endDate: "2026-10-06",
    cities: ["Kyoto"],
    places: [
      { id: "station", name: "Kyoto Station", locationLabel: "Kyoto", city: "Kyoto", category: "rail station", priority: "must", coordinates: [34.985, 135.758], whyWorthIt: "Arrival anchor.", plan: "Start here.", detailSections: [], sourceRefs: [] },
      { id: "coffee", name: "Local Cafe", locationLabel: "Kyoto", city: "Kyoto", category: "cafe", priority: "recheck", coordinates: [35.001, 135.76], whyWorthIt: "Slow morning.", plan: "Take a break.", detailSections: [{ title: "Order", body: "Try the seasonal roast.", items: ["Check opening hours"] }], sourceRefs: [] },
      { id: "missing", name: "Unmapped shop", locationLabel: "Kyoto", city: "Kyoto", category: "food", priority: "nearby", whyWorthIt: "Needs lookup.", plan: "Use only after geocoding.", detailSections: [], sourceRefs: [] }
    ],
    days: [{
      id: "day-1",
      label: "Day 1",
      date: "2026-10-05",
      city: "Kyoto",
      title: "Arrival and coffee",
      placeIds: ["station", "missing", "coffee"],
      stops: [{ placeId: "station", order: 1, time: "09:00" }, { placeId: "missing", order: 2 }, { placeId: "coffee", order: 3, role: "break" }],
      candidates: ["missing", "coffee"],
      routeReview: { routingMethod: "google_maps", sequenceRationale: "Station before cafe." },
      routeGeometry: [[34.985, 135.758], [35.001, 135.76]],
      routeGeometryMode: "walking",
      routeGeometryReviewedAt: "2026-09-01T00:00:00.000Z"
    }],
    routeSegments: [
      { id: "route-1", dayId: "day-1", originPlaceId: "station", destinationPlaceId: "coffee", mode: "walking", verification: "verified", durationMinutes: 18, sourceRefs: [] },
      { id: "route-2", dayId: "day-1", originPlaceId: "station", destinationPlaceId: "missing", mode: "walking", verification: "verified", durationMinutes: 5, sourceRefs: [] }
    ]
  };

  const trip = toNativeTrip("plan-1", 3, presentation, 2);

  assert.equal(trip.dataRevision, "3");
  assert.equal(trip.partySize, 2);
  assert.deepEqual(trip.pois.map((poi) => poi.id), ["station", "coffee"]);
  assert.equal(trip.pois[0]?.category, "transport");
  assert.equal(trip.pois[1]?.category, "coffee");
  assert.equal(trip.pois[1]?.priority, "pending");
  assert.match(trip.pois[1]?.plan ?? "", /seasonal roast/);
  assert.deepEqual(trip.days[0]?.routeStops.map((stop) => stop.poiId), ["station", "coffee"]);
  assert.match(trip.days[0]?.summary ?? "", /^Ease into Kyoto today\./);
  assert.deepEqual(trip.days[0]?.candidates, ["coffee"]);
  assert.equal(trip.days[0]?.transitSegments.length, 1);
  assert.equal(trip.days[0]?.routeGeometryMode, "walking");
});

test("Trip map adapter presents daily summaries in a guide-like voice", () => {
  const presentation: PlanPresentation = {
    kind: "itinerary",
    summary: "Arrival evening.",
    places: [
      { id: "haneda", name: "Haneda Airport Terminal 3", locationLabel: "Tokyo", city: "Tokyo", category: "transport", priority: "must", coordinates: [35.5446, 139.768], whyWorthIt: "Arrival.", plan: "Land here.", detailSections: [], sourceRefs: [] }
    ],
    days: [{
      id: "day-1",
      label: "Day 1",
      date: "2026-10-03",
      city: "Tokyo",
      title: "Haneda Arrival and Gentle Adjustment",
      summary: "Arrive at 17:25, allowing roughly two hours for immigration, baggage, connectivity, and orientation. Transfer to the eventual Tokyo lodging by the route verified against its entrance. No sightseeing obligation is added tonight.",
      placeIds: ["haneda"],
      stops: [{ placeId: "haneda", order: 1, time: "17:25" }]
    }],
    routeSegments: []
  };

  const summary = toNativeTrip("plan-1", 1, presentation).days[0]?.summary ?? "";

  assert.match(summary, /^Ease into Tokyo today\./);
  assert.match(summary, /leave about two hours/);
  assert.match(summary, /Then transfer to your Tokyo lodging once the exact entrance route is checked/);
  assert.match(summary, /Keep tonight light; there is no sightseeing to chase\./);
  assert.equal(/[\u4e00-\u9fff]/.test(summary), false);
});

test("Trip map coordinate helpers parse provider locations conservatively", () => {
  assert.deepEqual(parseProviderLocation("135.758,34.985"), [34.985, 135.758]);
  assert.equal(parseProviderLocation("not-a-location"), undefined);
  assert.equal(validCoords([34.985, Number.NaN]), false);
  assert.equal(validCoords([34.985, 135.758]), true);
});
