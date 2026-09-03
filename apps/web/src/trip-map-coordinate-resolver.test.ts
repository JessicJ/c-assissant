import assert from "node:assert/strict";
import test from "node:test";
import type { PlanPresentation } from "@c-assistant/core";
import { resolveMissingCoordinates, type MapCoordinateCache } from "./trip-map-coordinate-resolver.js";

function basePresentation(): PlanPresentation {
  return {
    kind: "itinerary",
    summary: "Kyoto route.",
    startDate: "2026-10-05",
    endDate: "2026-10-05",
    cities: ["Kyoto"],
    places: [
      { id: "station", name: "Kyoto Station", locationLabel: "Kyoto", city: "Kyoto", category: "transport", priority: "must", coordinates: [34.985, 135.758], whyWorthIt: "Arrival.", plan: "Start.", detailSections: [], sourceRefs: [] },
      { id: "temple", name: "Kiyomizu-dera", locationLabel: "Higashiyama", city: "Kyoto", category: "sight", priority: "must", whyWorthIt: "Temple.", plan: "Visit.", detailSections: [], sourceRefs: [] },
      { id: "market", name: "Nishiki Market", locationLabel: "Downtown", city: "Kyoto", category: "food", priority: "preferred", whyWorthIt: "Food.", plan: "Browse.", detailSections: [], sourceRefs: [] }
    ],
    days: [{ id: "day-1", label: "Day 1", date: "2026-10-05", city: "Kyoto", title: "Kyoto", placeIds: ["station", "temple", "market"] }],
    routeSegments: []
  };
}

test("map coordinate resolver uses cache before searching", async () => {
  const reads: string[] = [];
  const cache: MapCoordinateCache = {
    read: (query) => {
      reads.push(query);
      return query.startsWith("Kiyomizu") ? [34.995, 135.785] : undefined;
    },
    write: () => undefined
  };
  let searches = 0;

  const resolved = await resolveMissingCoordinates(basePresentation(), {
    cache,
    searchMapPlaces: async () => {
      searches += 1;
      return { status: "available", data: [{ location: "135.765,35.005" }] };
    }
  });

  assert.deepEqual(reads, ["Kiyomizu-dera Higashiyama Kyoto", "Nishiki Market Downtown Kyoto"]);
  assert.equal(searches, 1);
  assert.deepEqual(resolved.places.find((place) => place.id === "temple")?.coordinates, [34.995, 135.785]);
  assert.deepEqual(resolved.places.find((place) => place.id === "market")?.coordinates, [35.005, 135.765]);
});

test("map coordinate resolver writes successful lookups and preserves unresolved places", async () => {
  const writes: Array<{ query: string; coordinates: [number, number] }> = [];
  const cache: MapCoordinateCache = {
    read: () => undefined,
    write: (query, coordinates) => writes.push({ query, coordinates })
  };

  const resolved = await resolveMissingCoordinates(basePresentation(), {
    cache,
    searchMapPlaces: async (query) => query.startsWith("Kiyomizu")
      ? { status: "available", data: [{ location: "135.785,34.995" }] }
      : { status: "available", data: [] }
  });

  assert.deepEqual(writes, [{ query: "Kiyomizu-dera Higashiyama Kyoto", coordinates: [34.995, 135.785] }]);
  assert.deepEqual(resolved.places.find((place) => place.id === "temple")?.coordinates, [34.995, 135.785]);
  assert.equal(resolved.places.find((place) => place.id === "market")?.coordinates, undefined);
});
