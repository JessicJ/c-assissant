import assert from "node:assert/strict";
import test from "node:test";
import type { TripBlueprint } from "@c-assistant/core";
import { materializeRecommendedAccommodationAnchors } from "./accommodation-anchor-materialization.js";

test("uses researched hotel candidates in pending overnight blocks without altering the source blueprint", () => {
  const original = {
    places: [
      { id: "airport", name: "Wellington Airport", city: "Wellington", category: "airport" },
      { id: "hostel", name: "Central Hostel", city: "Wellington", category: "hostel", priority: "preferred", accommodation: { state: "recommended", baseLabel: "Wellington" } },
      { id: "hotel", name: "Park Hotel", city: "Wellington", category: "hotel", priority: "nearby", accommodation: { state: "recommended", baseLabel: "Wellington" } }
    ],
    days: [{ id: "arrival", date: "2026-12-13", city: "Wellington", blocks: [
      { id: "airport-block", kind: "arrival", placeId: "airport", order: 1, evidence: [] },
      { id: "stay", kind: "lodging", title: "Wellington accommodation not selected", order: 2, evidence: [] }
    ] }],
    movements: []
  } as unknown as TripBlueprint;
  const result = materializeRecommendedAccommodationAnchors(original);
  assert.deepEqual(result.assignments, [{ date: "2026-12-13", hotel: "Park Hotel", placeId: "hotel" }]);
  assert.equal(result.blueprint.days[0]!.blocks![1]!.placeId, "hotel");
  assert.match(result.blueprint.days[0]!.blocks![1]!.summary ?? "", /not booked/i);
  assert.equal(original.days[0]!.blocks![1]!.placeId, undefined);
  assert.deepEqual(result.blueprint.movements.map(({ originPlaceId, destinationPlaceId, mode, status, durationMinutes }) => ({ originPlaceId, destinationPlaceId, mode, status, durationMinutes })), [
    { originPlaceId: "airport", destinationPlaceId: "hotel", mode: "unknown", status: "recheck", durationMinutes: undefined }
  ]);
});

test("replacing a pending stay removes obsolete accommodation route edges", () => {
  const original = {
    endDate: "2026-12-15",
    places: [
      { id: "old", name: "Old Base", city: "Town", category: "hotel", accommodation: { state: "recommended" } },
      { id: "new", name: "New Base", city: "Town", category: "hotel", priority: "preferred", accommodation: { state: "recommended" } },
      { id: "visit", name: "Museum", city: "Town", category: "museum" }
    ],
    days: [{ id: "day", date: "2026-12-14", city: "Town", title: "Museum day", summary: "Visit", blocks: [
      { id: "old-stay", kind: "lodging", order: 1, placeId: "old", evidence: [] },
      { id: "pending-stay", kind: "lodging", order: 2, title: "Town accommodation not selected", evidence: [] },
      { id: "museum", kind: "stop", order: 3, placeId: "visit", evidence: [] }
    ] }],
    movements: [{ id: "day-accommodation-route-1", dayId: "day", originPlaceId: "old", destinationPlaceId: "visit", mode: "unknown", status: "recheck", evidence: [] }]
  } as unknown as TripBlueprint;
  const result = materializeRecommendedAccommodationAnchors(original).blueprint;
  assert.equal(result.movements.some((movement) => movement.id === "day-accommodation-route-1"), false);
  assert.ok(result.movements.some((movement) => movement.originPlaceId === "old" && movement.destinationPlaceId !== "visit"));
});

test("replaces a stale return to the previous city when the next day stays at the new base", () => {
  const original = {
    endDate: "2026-11-14",
    places: [
      { id: "old", name: "Old Hotel", city: "Aoraki / Mount Cook", category: "hotel", accommodation: { state: "recommended" } },
      { id: "new", name: "Te Anau Hotel", city: "Te Anau", category: "hotel", accommodation: { state: "recommended" } }
    ],
    days: [
      { id: "arrival", date: "2026-11-12", city: "Te Anau", title: "Travel to Te Anau", blocks: [
        { id: "old-start", kind: "lodging", order: 1, placeId: "old", evidence: [] },
        { id: "pending", kind: "lodging", order: 2, title: "Te Anau accommodation not selected", evidence: [] },
        { id: "old-return", kind: "lodging", role: "overnight accommodation return", order: 3, placeId: "old", evidence: [] }
      ], endContext: { label: "Old Hotel", status: "recommended_property", placeId: "old" } },
      { id: "next", date: "2026-11-13", city: "Te Anau", title: "Te Anau day", blocks: [{ id: "visit", kind: "stop", order: 1, evidence: [] }] }
    ], movements: []
  } as unknown as TripBlueprint;
  const result = materializeRecommendedAccommodationAnchors(original).blueprint;
  assert.equal(result.days[0]!.blocks!.at(-1)!.placeId, "new");
  assert.equal(result.days[0]!.endContext?.placeId, "new");
  assert.equal(result.days[1]!.blocks![0]!.placeId, "new");
});

test("preserves an imported user hotel instead of choosing a recommendation", () => {
  const original = {
    places: [{ id: "hotel", name: "Park Hotel", city: "Wellington", category: "hotel", accommodation: { state: "recommended" } }],
    days: [{ id: "arrival", date: "2026-12-13", city: "Wellington", blocks: [{ id: "stay", kind: "lodging", title: "Wellington accommodation not selected", order: 1, evidence: [] }] }],
    bookingConstraints: [{ type: "accommodation", status: "confirmed", segments: [{ segmentType: "hotel_stay", startAtLocal: "2026-12-13T15:00", endAtLocal: "2026-12-14T11:00" }] }],
    movements: []
  } as unknown as TripBlueprint;
  const result = materializeRecommendedAccommodationAnchors(original);
  assert.deepEqual(result.assignments, []);
  assert.equal(result.blueprint.days[0]!.blocks![0]!.placeId, undefined);
});

test("carries overnight hotels through sightseeing, base changes, and airport departure", () => {
  const original = {
    places: [
      { id: "airport", name: "Airport", city: "Wellington", category: "airport" },
      { id: "hotel-a", name: "Wellington Stay", city: "Wellington", category: "hotel", accommodation: { state: "recommended" } },
      { id: "museum", name: "Museum", city: "Wellington", category: "museum" },
      { id: "ferry", name: "Ferry", city: "Wellington", category: "ferry", locationLabel: "Wellington to Picton" },
      { id: "hotel-b", name: "Picton Stay", city: "Picton", category: "hotel", accommodation: { state: "recommended" } },
      { id: "cruise", name: "Cruise", city: "Picton", category: "attraction" }
    ],
    days: [
      { id: "arrival", date: "2026-12-13", city: "Wellington", title: "Arrival", blocks: [
        { id: "airport-arrival", kind: "stop", order: 1, placeId: "airport", evidence: [] },
        { id: "hotel-arrival", kind: "lodging", order: 2, placeId: "hotel-a", evidence: [] }
      ] },
      { id: "sightseeing", date: "2026-12-14", city: "Wellington", title: "Museum day", blocks: [
        { id: "to-museum", kind: "transfer", order: 1, title: "From base to museum", endTime: "09:00", evidence: [] },
        { id: "museum-stop", kind: "stop", order: 2, placeId: "museum", evidence: [] }
      ] },
      { id: "change", date: "2026-12-15", city: "Wellington and Picton", title: "Ferry to Picton", blocks: [
        { id: "to-ferry", kind: "transfer", order: 1, title: "From base to ferry", evidence: [] },
        { id: "ferry-stop", kind: "stop", order: 2, placeId: "ferry", evidence: [] },
        { id: "picton-stay", kind: "lodging", order: 3, placeId: "hotel-b", evidence: [] }
      ] },
      { id: "picton", date: "2026-12-16", city: "Picton", title: "Cruise day", blocks: [
        { id: "cruise-stop", kind: "stop", order: 1, placeId: "cruise", evidence: [] }
      ] },
      { id: "departure", date: "2026-12-17", city: "Picton", title: "Airport departure", blocks: [
        { id: "to-airport", kind: "transfer", order: 1, evidence: [] },
        { id: "airport-departure", kind: "stop", order: 2, placeId: "airport", title: "Airport departure", evidence: [] }
      ] }
    ],
    movements: [
      { id: "airport-hotel", dayId: "arrival", originPlaceId: "airport", destinationPlaceId: "hotel-a", mode: "unknown", status: "recheck", evidence: [] },
      { id: "ferry-hotel", dayId: "change", originPlaceId: "ferry", destinationPlaceId: "hotel-b", mode: "walking", status: "verified", distanceMeters: 99_000, durationMinutes: 267, label: "267 min walk", evidence: [] }
    ]
  } as unknown as TripBlueprint;
  const result = materializeRecommendedAccommodationAnchors(original).blueprint;
  const routes = result.days.map((day) => [day.id, day.blocks?.[0]?.placeId, day.blocks?.at(-1)?.placeId]);
  assert.deepEqual(routes, [
    ["arrival", "airport", "hotel-a"],
    ["sightseeing", "hotel-a", "hotel-a"],
    ["change", "hotel-a", "hotel-b"],
    ["picton", "hotel-b", "hotel-b"],
    ["departure", "hotel-b", "airport"]
  ]);
  assert.equal(result.days[1]?.startContext?.placeId, "hotel-a");
  assert.equal(result.days[1]?.endContext?.placeId, "hotel-a");
  assert.match(result.days[1]?.blocks?.[1]?.title ?? "", /Depart from Wellington Stay/);
  assert.equal(result.days[1]?.blocks?.[1]?.endTime, "09:00");
  assert.ok(result.movements.some((movement) => movement.dayId === "sightseeing" && movement.originPlaceId === "hotel-a" && movement.destinationPlaceId === "museum"));
  assert.ok(result.movements.some((movement) => movement.dayId === "sightseeing" && movement.originPlaceId === "museum" && movement.destinationPlaceId === "hotel-a"));
  assert.deepEqual(result.movements.find((movement) => movement.id === "ferry-hotel") && {
    mode: result.movements.find((movement) => movement.id === "ferry-hotel")!.mode,
    status: result.movements.find((movement) => movement.id === "ferry-hotel")!.status,
    durationMinutes: result.movements.find((movement) => movement.id === "ferry-hotel")!.durationMinutes
  }, { mode: "unknown", status: "recheck", durationMinutes: undefined });
  assert.deepEqual(materializeRecommendedAccommodationAnchors(result).blueprint.days.map((day) => day.blocks?.length), result.days.map((day) => day.blocks?.length));
  assert.equal(original.days[1]!.blocks![0]!.placeId, undefined);
});

test("exposes an unresolved overnight stay instead of silently ending at an attraction", () => {
  const original = {
    places: [{ id: "museum", name: "Museum", city: "Wellington", category: "museum" }],
    days: [
      { id: "day-1", date: "2026-12-14", city: "Wellington", title: "Museum day", summary: "Visit the museum", blocks: [{ id: "museum", kind: "stop", order: 1, placeId: "museum", evidence: [] }] },
      { id: "day-2", date: "2026-12-15", city: "Wellington", title: "Departure", summary: "Leave town", blocks: [] }
    ],
    endDate: "2026-12-15", movements: []
  } as unknown as TripBlueprint;
  const result = materializeRecommendedAccommodationAnchors(original).blueprint;
  assert.equal(result.days[0]?.blocks?.at(-1)?.kind, "lodging");
  assert.equal(result.days[0]?.endContext?.status, "planned_base_pending_property");
});
