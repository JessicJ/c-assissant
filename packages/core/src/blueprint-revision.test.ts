import assert from "node:assert/strict";
import test from "node:test";

import { applyDirectBlueprintRevision } from "./blueprint-revision.js";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintPlace, type TripBlueprint } from "./trip-blueprint.js";

const place = (id: string): BlueprintPlace => ({
  id,
  name: id,
  locationLabel: "Tokyo",
  city: "Tokyo",
  category: "sight",
  priority: "preferred",
  coordinates: [35.68, 139.76],
  whyWorthIt: `${id} supports the route.`,
  plan: `Visit ${id}.`,
  evidence: []
});

const blueprint = (): TripBlueprint => ({
  schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
  id: "blueprint-1",
  version: 1,
  generationKey: "generation-1",
  proposalRef: { sessionId: "session-1", proposalVersion: 1 },
  skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
  researchSetId: "research-1",
  title: "Tokyo",
  summary: "A complete Tokyo trip.",
  language: "en",
  destinations: ["Tokyo"],
  startDate: "2026-09-01",
  endDate: "2026-09-01",
  places: [
    place("a"),
    place("b"),
    { ...place("c"), schedulingEligibility: { decision: "schedulable", reason: "Works on the first day.", suitableDayIds: ["d1"] } }
  ],
  events: [],
  sources: [],
  days: [{
    id: "d1",
    date: "2026-09-01",
    kind: "scheduled",
    city: "Tokyo",
    title: "East Tokyo",
    summary: "A practical sequence.",
    stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }],
    candidatePlaceIds: ["c"]
  }],
  movements: [{ id: "m1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "verified", durationMinutes: 20, label: "Walk", detail: "Verified walk.", evidence: [] }],
  actionRequirements: [],
  createdAt: "2026-08-26T00:00:00.000Z"
});

test("Direct Blueprint Revision adds a place to one day without losing catalog content", () => {
  const original = blueprint();
  const revised = applyDirectBlueprintRevision(original, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "after", afterPlaceId: "a" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });
  assert.equal(revised.version, 2);
  assert.deepEqual(original.days[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
  assert.deepEqual(revised.days[0]?.stops.map((stop) => [stop.placeId, stop.order]), [["a", 1], ["c", 2], ["b", 3]]);
  assert.deepEqual(revised.days[0]?.candidatePlaceIds, []);
  assert.deepEqual(revised.days[0]?.blocks?.map((block) => [block.kind, block.placeId, block.order]), [["stop", "a", 1], ["stop", "c", 2], ["stop", "b", 3]]);
  assert.deepEqual(revised.movements.map((movement) => [movement.originPlaceId, movement.destinationPlaceId, movement.status]), [["a", "c", "recheck"], ["c", "b", "recheck"]]);
  assert.deepEqual(revised.places.map((candidate) => candidate.id), ["a", "b", "c"]);
});

test("Direct Blueprint Revision rejects edits that need assisted replanning", () => {
  const value = blueprint();
  value.places[2] = { ...value.places[2]!, schedulingEligibility: { decision: "high_impact", reason: "Requires another city day.", highImpactReasons: ["Different city"] } };
  assert.throws(() => applyDirectBlueprintRevision(value, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "end" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /assisted replanning/i);
});

test("Direct Blueprint Revision rejects invalid day eligibility and insertion anchors", () => {
  const value = blueprint();
  value.endDate = "2026-09-02";
  value.days.push({ id: "d2", date: "2026-09-02", kind: "rest", city: "Tokyo", title: "Rest", summary: "Keep this day open.", stops: [], candidatePlaceIds: ["c"] });
  value.places[2] = { ...value.places[2]!, schedulingEligibility: { decision: "schedulable", reason: "Only works later.", suitableDayIds: ["d2"] } };
  assert.throws(() => applyDirectBlueprintRevision(value, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "end" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /not eligible/i);

  value.places[2] = { ...value.places[2]!, schedulingEligibility: { decision: "schedulable", reason: "Works on day one.", suitableDayIds: ["d1"] } };
  assert.throws(() => applyDirectBlueprintRevision(value, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "after", afterPlaceId: "missing-place" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /unknown place missing-place/i);
});

test("Direct Blueprint Revision moves a scheduled place within one day", () => {
  const original = blueprint();
  const revised = applyDirectBlueprintRevision(original, {
    kind: "move_place_within_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "start" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });
  assert.equal(revised.version, 2);
  assert.deepEqual(original.days[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
  assert.deepEqual(revised.days[0]?.stops.map((stop) => [stop.placeId, stop.order]), [["b", 1], ["a", 2]]);
  assert.deepEqual(revised.places.map((candidate) => candidate.id), ["a", "b", "c"]);
  assert.deepEqual(revised.days[0]?.candidatePlaceIds, ["c"]);
  assert.deepEqual(revised.movements.map((movement) => [movement.originPlaceId, movement.destinationPlaceId, movement.status]), [["b", "a", "recheck"]]);
});

test("Direct Blueprint Revision moves timed labels and rejects reserved stop moves", () => {
  const timed = blueprint();
  timed.days[0] = { ...timed.days[0]!, stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2, time: "10:30" }] };
  const revisedTimed = applyDirectBlueprintRevision(timed, {
    kind: "move_place_within_day",
    placeId: "a",
    dayId: "d1",
    position: { kind: "end" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });
  assert.deepEqual(revisedTimed.days[0]?.stops.map((stop) => [stop.placeId, stop.time ?? ""]), [["b", "09:00"], ["a", "10:30"]]);

  const reserved = blueprint();
  reserved.actionRequirements = [{ id: "reserve-b", kind: "reservation", title: "Reserve B", description: "Book B.", accountableParty: "traveler", completionCondition: "B is booked.", placeId: "b", evidence: [] }];
  assert.throws(() => applyDirectBlueprintRevision(reserved, {
    kind: "move_place_within_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "start" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /booking/i);
});
