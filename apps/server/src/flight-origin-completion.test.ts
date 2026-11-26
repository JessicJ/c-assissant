import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchSet, TripBlueprint } from "@c-assistant/core";
import { addResearchedFlightOrigins, flightOriginGaps } from "./flight-origin-completion.js";

test("researched departure airport becomes a real stop and splits the cross-city leg", () => {
  const hotel = { id: "hotel", name: "Hotel Give", city: "Christchurch", category: "hotel" };
  const arrival = { id: "wlg", name: "Wellington Airport", city: "Wellington", category: "airport" };
  const departure = { id: "chc", name: "Christchurch Airport", city: "Christchurch", category: "airport", coordinates: [-43.49, 172.54], evidence: [] };
  const blueprint = {
    places: [hotel, arrival],
    days: [{ id: "day-23", date: "2026-12-23", kind: "transit", city: "Christchurch and Wellington", title: "Fly", summary: "Flight", stops: [{ placeId: "wlg", order: 1 }], candidatePlaceIds: [], blocks: [
      { id: "base", kind: "lodging", order: 1, placeId: "hotel", evidence: [] },
      { id: "flight", kind: "transfer", order: 2, title: "Christchurch–Wellington flight", evidence: [] },
      { id: "wlg", kind: "stop", order: 3, placeId: "wlg", evidence: [] }
    ] }],
    movements: [{ id: "bad-direct", dayId: "day-23", originPlaceId: "hotel", destinationPlaceId: "wlg", mode: "unknown", status: "recheck", evidence: [] }]
  } as unknown as TripBlueprint;
  const research = { places: [departure] } as unknown as ResearchSet;
  assert.equal(flightOriginGaps(blueprint).length, 1);
  const result = addResearchedFlightOrigins(blueprint, research);
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.blueprint.days[0]?.stops.map((stop) => stop.placeId), ["chc", "wlg"]);
  assert.deepEqual(result.blueprint.movements.map((movement) => [movement.originPlaceId, movement.destinationPlaceId, movement.mode]), [["hotel", "chc", "unknown"], ["chc", "wlg", "flight"]]);
  assert.equal(flightOriginGaps(result.blueprint).length, 0);
});
