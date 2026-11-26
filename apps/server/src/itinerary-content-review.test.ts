import assert from "node:assert/strict";
import test from "node:test";
import type { BlueprintItineraryBlock, BlueprintItineraryDay, BlueprintPlace, TripBlueprint } from "@c-assistant/core";
import { normalizeDayCandidates, reviewItineraryContent } from "./itinerary-content-review.js";

const place = (id: string, city: string, category = "museum"): BlueprintPlace => ({ id, name: id, city, category, locationLabel: city, priority: "preferred", whyWorthIt: "Visit", plan: "Visit", evidence: [] });
const block = (id: string, kind: BlueprintItineraryBlock["kind"], order: number, placeId?: string): BlueprintItineraryBlock => ({ id, kind, order, ...(placeId ? { placeId } : {}), evidence: [] });
function fixture(): TripBlueprint {
  return {
    places: [place("museum", "Auckland"), place("cafe", "Auckland", "cafe"), place("foreign", "Rotorua"), place("excursion", "Waiheke"), place("blocked", "Auckland"), place("airport", "Auckland", "airport"),
      { ...place("hotel", "Auckland", "hotel"), accommodation: { state: "recommended" } }],
    days: [{ id: "d1", date: "2026-11-04", kind: "scheduled", city: "Auckland", title: "Visit", summary: "Visit the museum", stops: [{ placeId: "museum", order: 1 }], blocks: [block("museum", "stop", 1, "museum")], candidatePlaceIds: ["foreign", "cafe", "cafe", "museum", "blocked", "excursion"] }],
    guideRelationshipGraph: { relationships: [{ id: "link", kind: "alternative", fromPlaceId: "museum", toPlaceId: "excursion", dayIds: ["d1"], rationale: "Sourced day trip", evidence: [] }] }, movements: []
  } as unknown as TripBlueprint;
}

test("day choices remove duplicate, scheduled, ineligible and foreign-city items without losing researched places", () => {
  const b = fixture();
  b.places.find((p) => p.id === "blocked")!.schedulingEligibility = { decision: "blocked", reason: "Closed" };
  const before = structuredClone(b);
  const next = normalizeDayCandidates(b);
  assert.deepEqual(next.days[0]!.candidatePlaceIds, ["cafe", "excursion"]);
  assert.deepEqual(next.places, before.places);
  assert.deepEqual(next.days[0]!.stops, before.days[0]!.stops);
  assert.deepEqual(b, before);
});

test("overnight flight does not offer restaurants from the destination before arrival", () => {
  const b = fixture();
  b.days[0] = { ...b.days[0]!, kind: "transit", city: "Los Angeles / in flight", title: "Overnight flight", stops: [], blocks: [] };
  assert.deepEqual(normalizeDayCandidates(b).days[0]!.candidatePlaceIds, []);
});

test("explicit day restrictions override a geographic relationship", () => {
  const b = fixture();
  b.places.find((p) => p.id === "excursion")!.schedulingEligibility = { decision: "schedulable", reason: "Available later", blockedDayIds: ["d1"] };
  assert.equal(normalizeDayCandidates(b).days[0]!.candidatePlaceIds.includes("excursion"), false);
});

test("a nearby candidate survives a city alias while a confirmed duplicate stays out of the day view", () => {
  const b = fixture();
  b.places[0]!.coordinates = [-43.73, 170.10];
  b.places[1]!.city = "Mount Cook Village";
  b.places[1]!.coordinates = [-43.735, 170.105];
  b.places[1]!.officialUrl = "https://example.com/cafe";
  b.places.push({ ...b.places[1]!, id: "cafe-copy" });
  b.days[0]!.candidatePlaceIds = ["cafe", "cafe-copy"];
  const next = normalizeDayCandidates(b);
  assert.deepEqual(next.days[0]!.candidatePlaceIds, ["cafe"]);
  assert.equal(next.places.length, b.places.length);
  assert.deepEqual(next.movements, b.movements);
});

test("a long sightseeing timeline needs a lunch or rest opportunity, without requiring a restaurant", () => {
  const b = fixture();
  b.days[0]!.blocks = [{ ...block("am", "stop", 1, "museum"), startTime: "09:00", endTime: "12:00" }, { ...block("pm", "stop", 2, "excursion"), startTime: "14:00", endTime: "17:00" }];
  assert.equal(reviewItineraryContent(b).some((f) => f.code === "missing_midday_break"), true);
  b.days[0]!.blocks.splice(1, 0, { ...block("lunch", "meal", 2), title: "Flexible lunch near the morning visit", startTime: "12:15", endTime: "13:00" });
  assert.deepEqual(reviewItineraryContent(b), []);
  assert.equal(b.days[0]!.blocks[1]!.placeId, undefined);
});

test("a short transfer and an explicit rest day are not padded with obligatory attractions or meals", () => {
  const b = fixture();
  b.days[0]!.kind = "transit";
  b.days[0]!.blocks = [{ ...block("drive", "transfer", 1), startTime: "09:00", endTime: "11:00" }, block("stay", "lodging", 2, "hotel")];
  assert.deepEqual(reviewItineraryContent(b), []);
  b.days[0]!.kind = "rest";
  assert.deepEqual(reviewItineraryContent(b), []);
});

test("a transfer card cannot stand in for a formal airport occurrence", () => {
  const b = fixture();
  b.days[0]!.blocks = [block("hotel", "lodging", 1, "hotel"), block("drive", "transfer", 2, "airport"), block("flight", "transfer", 3), block("arrive", "lodging", 4, "hotel")];
  assert.equal(reviewItineraryContent(b).some((f) => f.code === "missing_transport_occurrence"), true);
  b.days[0]!.blocks.splice(2, 0, block("terminal", "stop", 3, "airport"));
  assert.deepEqual(reviewItineraryContent(b), []);
});

test("hotel luggage drop requires a hotel occurrence before the visit even when that hotel ends the day", () => {
  const b = fixture();
  const d: BlueprintItineraryDay = b.days[0]!;
  d.blocks = [block("arrival", "stop", 1, "airport"), block("drop", "transfer", 2, "hotel"), block("visit", "stop", 3, "museum"), block("sleep", "lodging", 4, "hotel")];
  assert.equal(reviewItineraryContent(b).some((f) => f.code === "missing_luggage_drop_node"), true);
  d.blocks.splice(2, 0, { ...block("storage", "lodging", 3, "hotel"), title: "Leave luggage; room availability unconfirmed" });
  assert.deepEqual(reviewItineraryContent(b), []);
});


test("Chinese station categories do not turn an actual pre-visit hotel luggage drop into a false failure", () => {
  const b = fixture();
  b.places.find((p) => p.id === "airport")!.category = "高铁站";
  b.places.find((p) => p.id === "airport")!.name = "Hangzhou East Railway Station";
  b.days[0]!.summary = "抵达后前往酒店寄存行李，再参观博物馆。";
  b.days[0]!.blocks = [block("arrive", "stop", 1, "airport"), block("to-hotel", "transfer", 2), block("luggage", "lodging", 3, "hotel"), block("visit", "stop", 4, "museum"), block("night", "lodging", 5, "hotel")];
  assert.equal(reviewItineraryContent(b).some((f) => f.code === "missing_luggage_drop_node"), false);
  b.days[0]!.blocks.splice(2, 1);
  assert.equal(reviewItineraryContent(b).some((f) => f.code === "missing_luggage_drop_node"), true);
});
