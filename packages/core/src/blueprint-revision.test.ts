import assert from "node:assert/strict";
import test from "node:test";

import { applyDirectBlueprintRevision, applyDirectBlueprintRevisionBatchWithMetadata, applyDirectBlueprintRevisionWithMetadata } from "./blueprint-revision.js";
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
  assert.deepEqual(revised.movements.map((movement) => movement.mode), ["walking", "walking"]);
  assert.deepEqual(revised.movements.map((movement) => movement.display), [
    { routeLabel: "Route needs refresh", refreshReason: "Refresh this route leg after direct itinerary edits.", showAsFormalRoute: true, mapLineState: "needs_refresh" },
    { routeLabel: "Route needs refresh", refreshReason: "Refresh this route leg after direct itinerary edits.", showAsFormalRoute: true, mapLineState: "needs_refresh" }
  ]);
  assert.deepEqual(revised.places.map((candidate) => candidate.id), ["a", "b", "c"]);
});

test("Direct Blueprint Revision returns versioned metadata and an undo-ready day snapshot", () => {
  const original = blueprint();
  const result = applyDirectBlueprintRevisionWithMetadata(original, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "after", afterPlaceId: "a" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });
  assert.equal(result.blueprint.version, 2);
  assert.equal(result.metadata.kind, "add_place_to_day");
  assert.equal(result.metadata.baseBlueprintVersion, 1);
  assert.equal(result.metadata.appliedBlueprintVersion, 2);
  assert.deepEqual(result.metadata.affectedDayIds, ["d1"]);
  assert.deepEqual(result.metadata.routeRefresh.movementIds, ["movement-d1-1", "movement-d1-2"]);
  assert.deepEqual(result.metadata.undo.previousDay?.stops.map((stop) => stop.placeId), ["a", "b"]);
  assert.deepEqual(result.metadata.undo.previousMovements.map((movement) => movement.id), ["m1"]);

  result.blueprint.days[0]!.stops[0]!.placeId = "mutated";
  assert.deepEqual(result.metadata.undo.previousDay?.stops.map((stop) => stop.placeId), ["a", "b"]);
});

test("Direct Blueprint Revision updates a place priority without route refresh", () => {
  const original = blueprint();
  const result = applyDirectBlueprintRevisionWithMetadata(original, {
    kind: "update_place_priority",
    placeId: "c",
    priority: "must",
    createdAt: "2026-08-27T00:00:00.000Z"
  });
  assert.equal(result.blueprint.version, 2);
  assert.equal(result.blueprint.places.find((candidate) => candidate.id === "c")?.priority, "must");
  assert.equal(original.places.find((candidate) => candidate.id === "c")?.priority, "preferred");
  assert.deepEqual(result.blueprint.days[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
  assert.deepEqual(result.blueprint.movements.map((movement) => [movement.id, movement.status]), [["m1", "verified"]]);
  assert.equal(result.metadata.kind, "update_place_priority");
  assert.deepEqual(result.metadata.affectedDayIds, []);
  assert.deepEqual(result.metadata.affectedPlaceIds, ["c"]);
  assert.deepEqual(result.metadata.routeRefresh.movementIds, []);
  assert.equal(result.metadata.undo.previousPlace?.priority, "preferred");
});

test("Direct Blueprint Revision keeps scheduled archive changes assisted", () => {
  const original = blueprint();
  assert.throws(() => applyDirectBlueprintRevision(original, {
    kind: "update_place_priority",
    placeId: "a",
    priority: "archive",
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /removed from the day/i);
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
  assert.deepEqual(revised.movements.map((movement) => movement.mode), ["walking"]);
  assert.deepEqual(revised.movements.map((movement) => movement.display?.mapLineState), ["needs_refresh"]);
});

test("Direct Blueprint Revision only marks edited-day movements as needing route refresh", () => {
  const original = blueprint();
  original.endDate = "2026-09-02";
  original.places.push(place("d"), place("e"));
  original.days.push({
    id: "d2",
    date: "2026-09-02",
    kind: "scheduled",
    city: "Tokyo",
    title: "West Tokyo",
    summary: "Another compact sequence.",
    stops: [{ placeId: "d", order: 1 }, { placeId: "e", order: 2 }],
    candidatePlaceIds: []
  });
  original.movements.push({
    id: "m2",
    dayId: "d2",
    originPlaceId: "d",
    destinationPlaceId: "e",
    mode: "walking",
    status: "verified",
    durationMinutes: 12,
    label: "Verified day two walk",
    detail: "Keep this saved route.",
    display: { routeLabel: "Verified day two walk", showAsFormalRoute: true, mapLineState: "formal" },
    evidence: []
  });

  const result = applyDirectBlueprintRevisionWithMetadata(original, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "after", afterPlaceId: "a" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });

  assert.deepEqual(result.metadata.affectedDayIds, ["d1"]);
  assert.deepEqual(result.metadata.routeRefresh.dayIds, ["d1"]);
  assert.deepEqual(result.metadata.routeRefresh.movementIds, ["movement-d1-1", "movement-d1-2"]);
  const dayTwoMovement = result.blueprint.movements.find((movement) => movement.id === "m2");
  assert.equal(dayTwoMovement?.status, "verified");
  assert.equal(dayTwoMovement?.display?.mapLineState, "formal");
});

test("Direct Blueprint Revision uses transit when edited adjacent places are far apart or transport nodes", () => {
  const distant = blueprint();
  distant.places[0] = { ...distant.places[0]!, coordinates: [35.6812, 139.7671] };
  distant.places[1] = { ...distant.places[1]!, coordinates: [35.7101, 139.8107] };
  distant.places[2] = { ...distant.places[2]!, name: "Haneda Airport", category: "airport", locationLabel: "Haneda Airport, Tokyo", coordinates: [35.5494, 139.7798] };
  const revised = applyDirectBlueprintRevision(distant, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "after", afterPlaceId: "a" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });

  assert.deepEqual(revised.movements.map((movement) => [movement.originPlaceId, movement.destinationPlaceId, movement.mode, movement.status]), [
    ["a", "c", "transit", "recheck"],
    ["c", "b", "transit", "recheck"]
  ]);
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

test("Direct Blueprint Revision inserts route blocks without flattening contextual blocks", () => {
  const original = blueprint();
  original.days[0] = {
    ...original.days[0]!,
    stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2, time: "10:30" }],
    blocks: [
      { id: "block-a", kind: "stop", order: 1, placeId: "a", startTime: "09:00", title: "A anchor", summary: "Use A as the morning anchor.", evidence: [] },
      { id: "block-rest", kind: "rest", order: 2, title: "Short reset", summary: "Keep a real pause between stops.", evidence: [] },
      { id: "block-b", kind: "meal", order: 3, placeId: "b", startTime: "10:30", title: "B meal", summary: "Use B as the food stop.", evidence: [] },
      { id: "block-c-flex", kind: "flexible", order: 4, placeId: "c", title: "C if time allows", summary: "Keep C as a backup before it is added.", evidence: [] }
    ]
  };

  const revised = applyDirectBlueprintRevision(original, {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "after", afterPlaceId: "a" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });

  assert.deepEqual(revised.days[0]?.stops.map((stop) => [stop.placeId, stop.order, stop.time ?? "", stop.role ?? ""]), [
    ["a", 1, "09:00", ""],
    ["c", 2, "", "direct_addition"],
    ["b", 3, "10:30", ""]
  ]);
  assert.deepEqual(revised.days[0]?.blocks?.map((block) => [block.id, block.kind, block.placeId ?? "", block.order, block.startTime ?? "", block.title ?? ""]), [
    ["block-a", "stop", "a", 1, "09:00", "A anchor"],
    ["block-d1-c-direct", "stop", "c", 2, "", ""],
    ["block-rest", "rest", "", 3, "", "Short reset"],
    ["block-b", "meal", "b", 4, "10:30", "B meal"]
  ]);
});

test("Direct Blueprint Revision reorders route blocks while keeping time slots in place", () => {
  const original = blueprint();
  original.days[0] = {
    ...original.days[0]!,
    stops: [{ placeId: "a", order: 1, time: "09:00", role: "morning" }, { placeId: "b", order: 2, time: "10:30", role: "lunch" }],
    blocks: [
      { id: "block-a", kind: "stop", order: 1, placeId: "a", startTime: "09:00", title: "A anchor", summary: "Use A as the morning anchor.", evidence: [] },
      { id: "block-rest", kind: "rest", order: 2, title: "Short reset", summary: "Keep a real pause between stops.", evidence: [] },
      { id: "block-b", kind: "meal", order: 3, placeId: "b", startTime: "10:30", endTime: "11:15", title: "B meal", summary: "Use B as the food stop.", evidence: [] }
    ]
  };

  const revised = applyDirectBlueprintRevision(original, {
    kind: "move_place_within_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "start" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });

  assert.deepEqual(revised.days[0]?.stops.map((stop) => [stop.placeId, stop.order, stop.time ?? "", stop.role ?? ""]), [
    ["b", 1, "09:00", "morning"],
    ["a", 2, "10:30", "lunch"]
  ]);
  assert.deepEqual(revised.days[0]?.blocks?.map((block) => [block.id, block.kind, block.placeId ?? "", block.order, block.startTime ?? "", block.endTime ?? "", block.role ?? "", block.title ?? ""]), [
    ["block-b", "meal", "b", 1, "09:00", "", "morning", "B meal"],
    ["block-rest", "rest", "", 2, "", "", "", "Short reset"],
    ["block-a", "stop", "a", 3, "10:30", "11:15", "lunch", "A anchor"]
  ]);
});

test("Direct Blueprint Revision batch applies multiple itinerary edits with one metadata envelope", () => {
  const original = blueprint();
  const result = applyDirectBlueprintRevisionBatchWithMetadata(original, [
    {
      kind: "add_place_to_day",
      placeId: "c",
      dayId: "d1",
      position: { kind: "after", afterPlaceId: "a" },
      createdAt: "2026-08-27T00:00:00.000Z"
    },
    {
      kind: "move_place_within_day",
      placeId: "b",
      dayId: "d1",
      position: { kind: "start" },
      createdAt: "2026-08-27T00:01:00.000Z"
    }
  ]);

  assert.equal(result.blueprint.version, 3);
  assert.deepEqual(result.blueprint.days[0]?.stops.map((stop) => [stop.placeId, stop.order]), [["b", 1], ["a", 2], ["c", 3]]);
  assert.equal(result.metadata.baseBlueprintVersion, 1);
  assert.equal(result.metadata.appliedBlueprintVersion, 3);
  assert.equal(result.metadata.revisionCount, 2);
  assert.deepEqual(result.metadata.kinds, ["add_place_to_day", "move_place_within_day"]);
  assert.deepEqual(result.metadata.affectedDayIds, ["d1"]);
  assert.deepEqual(result.metadata.affectedPlaceIds, ["c", "a", "b"]);
  assert.deepEqual(result.metadata.routeRefresh.movementIds, ["movement-d1-1", "movement-d1-2"]);
  assert.equal(result.metadata.undo.previousBlueprintVersion, 1);
  assert.deepEqual(result.metadata.undo.previousDays[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
  assert.deepEqual(result.metadata.undo.previousMovements.map((movement) => movement.id), ["m1"]);
});

test("Direct Blueprint Revision batch rejects invalid edits without mutating the original Blueprint", () => {
  const original = blueprint();

  assert.throws(() => applyDirectBlueprintRevisionBatchWithMetadata(original, [
    {
      kind: "add_place_to_day",
      placeId: "c",
      dayId: "d1",
      position: { kind: "after", afterPlaceId: "a" },
      createdAt: "2026-08-27T00:00:00.000Z"
    },
    {
      kind: "move_place_within_day",
      placeId: "c",
      dayId: "d1",
      position: { kind: "after", afterPlaceId: "missing-place" },
      createdAt: "2026-08-27T00:01:00.000Z"
    }
  ]), /unknown place missing-place/i);

  assert.equal(original.version, 1);
  assert.deepEqual(original.days[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
  assert.deepEqual(original.days[0]?.candidatePlaceIds, ["c"]);
  assert.deepEqual(original.movements.map((movement) => movement.id), ["m1"]);
});
