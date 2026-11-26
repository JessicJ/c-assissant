import assert from "node:assert/strict";
import test from "node:test";
import type { PlanningSession, TripBlueprint } from "@c-assistant/core";
import { completeDepartureEndpoint, departureReturnsToLodging } from "./departure-endpoint-completion.js";
import { materializeRecommendedAccommodationAnchors } from "./accommodation-anchor-materialization.js";
import { reviewItineraryForPublication } from "./itinerary-publication-review.js";

const session = { facts: [
  { key: "arrival_status", value: "not_booked", confirmed: true },
  { key: "departure_destination", value: "上海", confirmed: true }
] } as PlanningSession;

function blueprint(): TripBlueprint {
  return {
    id: "hangzhou", version: 1, title: "杭州三日游", summary: "Unbooked return train", language: "zh", destinations: ["杭州"],
    startDate: "2026-10-20", endDate: "2026-10-22",
    places: [
      { id: "hotel", name: "杭州新新饭店", category: "hotel", city: "杭州", accommodation: { state: "recommended" }, evidence: [] },
      { id: "restaurant", name: "楼外楼", category: "restaurant", city: "杭州", evidence: [] },
      { id: "station", name: "杭州东站", category: "railway station", city: "杭州", evidence: [] }
    ],
    days: [{ id: "last", date: "2026-10-22", kind: "transit", city: "杭州", title: "返程", summary: "杭州东站乘高铁返上海", stops: [{ placeId: "restaurant", order: 1 }], candidatePlaceIds: [],
      endContext: { label: "杭州新新饭店", status: "recommended_property", placeId: "hotel" }, blocks: [
        { id: "hotel-start", kind: "lodging", order: 1, placeId: "hotel", evidence: [] },
        { id: "lunch", kind: "meal", order: 2, placeId: "restaurant", evidence: [] },
        { id: "to-station", kind: "transfer", order: 3, placeId: "station", title: "去杭州东站", evidence: [] },
        { id: "false-return", kind: "lodging", order: 4, placeId: "hotel", title: "返回酒店", evidence: [] }
      ] }], movements: [{ id: "false-hotel-return", dayId: "last", originPlaceId: "restaurant", destinationPlaceId: "hotel", mode: "walking", status: "proposed", label: "Return to hotel", evidence: [] }]
  } as unknown as TripBlueprint;
}

test("unbooked return travel ends at the provisional station without inventing a train time", () => {
  const before = blueprint();
  assert.equal(departureReturnsToLodging(before, session), true);
  assert.equal(reviewItineraryForPublication(before, session).some((finding) => finding.code === "departure_returns_to_lodging"), true);
  const after = completeDepartureEndpoint(before, session);
  const day = after.days[0]!;
  assert.equal(day.blocks?.at(-1)?.placeId, "station");
  assert.equal(day.blocks?.at(-1)?.kind, "stop");
  assert.equal(day.endContext?.placeId, "station");
  assert.deepEqual(day.stops.map((stop) => stop.placeId), ["restaurant", "station"]);
  assert.equal(day.blocks?.some((block) => block.id === "false-return"), false);
  assert.equal(day.blocks?.at(-1)?.startTime, undefined);
  assert.equal(after.movements.some((movement) => movement.originPlaceId === "restaurant" && movement.destinationPlaceId === "station" && movement.status === "recheck"), true);
  assert.equal(after.movements.some((movement) => movement.id === "false-hotel-return"), false);
  assert.equal(departureReturnsToLodging(after, session), false);
  assert.equal(completeDepartureEndpoint(after, session), after);
});


test("a station to confirm does not gain an overnight return after luggage collection", () => {
 const before = blueprint(); const day = before.days[0]!;
 day.blocks![2] = {...day.blocks![2]!,title:"Hotel to the departure station",role:"Transfer to the Shanghai-bound train"};
 delete day.blocks![2]!.placeId;
 day.blocks![3]!.role = "overnight accommodation return";
 const after = completeDepartureEndpoint(before, session);
 assert.equal(after.days[0]!.blocks!.at(-1)!.id, "to-station");
 assert.equal(after.days[0]!.endContext!.status, "transport_node");
 assert.equal(after.days[0]!.endContext!.placeId, undefined, "No station is invented");
 const repeated = materializeRecommendedAccommodationAnchors(after).blueprint;
 assert.equal(repeated.days[0]!.blocks!.at(-1)!.id, "to-station");
 assert.equal(repeated.days[0]!.blocks!.some(block => block.role === "overnight accommodation return"), false);
});

test("provisional departure cleanup preserves a user-requested hotel return", () => {
 const before = blueprint();const day = before.days[0]!;
 day.blocks![2] = {...day.blocks![2]!,title:"Hotel to the departure station"};
 delete day.blocks![2]!.placeId;
 day.blocks![3]!.role = "User-required hotel return";
 assert.equal(completeDepartureEndpoint(before, session), before);
});
