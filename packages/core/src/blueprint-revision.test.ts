import assert from "node:assert/strict";
import test from "node:test";

import { applyDirectBlueprintRevision, applyDirectBlueprintRevisionBatchWithMetadata, applyDirectBlueprintRevisionWithMetadata, DirectBlueprintReplanRequirementError, prepareDirectBlueprintAssistedReplanningHandoff } from "./blueprint-revision.js";
import { MAP_COORDINATES_PENDING_SCHEDULING_REASON, TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintPlace, type TripBlueprint } from "./trip-blueprint.js";

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
    { routeLabel: "Route needs refresh", refreshReason: "Refresh this route leg after direct itinerary edits.", refreshScope: { dayId: "d1", originPlaceId: "a", destinationPlaceId: "c", reason: "direct_itinerary_edit" }, showAsFormalRoute: true, mapLineState: "needs_refresh" },
    { routeLabel: "Route needs refresh", refreshReason: "Refresh this route leg after direct itinerary edits.", refreshScope: { dayId: "d1", originPlaceId: "c", destinationPlaceId: "b", reason: "direct_itinerary_edit" }, showAsFormalRoute: true, mapLineState: "needs_refresh" }
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
  assert.deepEqual(result.metadata.routeImpact?.days, [{
    dayId: "d1",
    addedPlaceIds: ["c"],
    removedPlaceIds: [],
    movedPlaceIds: [],
    movementIds: ["movement-d1-1", "movement-d1-2"],
    requiresRouteRefresh: true,
    requiresTimingReview: true,
    requiresMealRestSpacingReview: true,
    capacityRisk: false,
    backtrackingRisk: false,
    fixedTimeRisk: false,
    readiness: "ready_for_route_refresh",
    reasons: [
      "add_place_to_day changed the saved itinerary order for this day.",
      "Adjacent movement timing should be reviewed before execution.",
      "Meal and rest spacing should be checked after this edit."
    ]
  }]);
  assert.deepEqual(result.metadata.replanReadiness, {
    status: "ready_for_route_refresh",
    dayIds: ["d1"],
    reason: "These direct itinerary edits are saved, but affected routes and timing still need refresh before execution."
  });
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
  assert.deepEqual(result.metadata.routeImpact?.days, []);
  assert.deepEqual(result.metadata.replanReadiness, {
    status: "no_replan_needed",
    dayIds: [],
    reason: "This place status update does not change route order or timing."
  });
  assert.equal(result.metadata.undo.previousPlace?.priority, "preferred");
});

test("Direct Blueprint Revision keeps scheduled archive changes assisted", () => {
  const original = blueprint();
  assert.throws(() => applyDirectBlueprintRevision(original, {
    kind: "update_place_priority",
    placeId: "a",
    priority: "archive",
    createdAt: "2026-08-27T00:00:00.000Z"
  }), DirectBlueprintReplanRequirementError);
});

test("Direct Blueprint Revision rejects edits that need assisted replanning", () => {
  const value = blueprint();
  value.places[2] = { ...value.places[2]!, schedulingEligibility: { decision: "high_impact", reason: "Requires another city day.", highImpactReasons: ["Different city"] } };
  const revision = {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "end" },
    createdAt: "2026-08-27T00:00:00.000Z"
  } as const;
  assert.throws(() => applyDirectBlueprintRevision(value, revision), DirectBlueprintReplanRequirementError);
  try {
    applyDirectBlueprintRevision(value, revision);
    assert.fail("Expected a structured assisted replanning requirement.");
  } catch (caught) {
    assert.ok(caught instanceof DirectBlueprintReplanRequirementError);
    assert.equal(caught.replanRequirement.reasonCode, "high_impact_place");
    assert.equal(caught.replanRequirement.editKind, "add_place_to_day");
    assert.deepEqual(caught.replanRequirement.affectedDayIds, ["d1"]);
    assert.deepEqual(caught.replanRequirement.affectedPlaceIds, ["c", "a", "b"]);
    assert.match(caught.replanRequirement.explanation, /changes the shape of 2026-09-01/i);
    assert.match(caught.replanRequirement.suggestedRequest, /Replan the affected itinerary day/i);
  }
});

test("Direct Blueprint Revision accepts a map-refreshed place with stale synthetic informational eligibility", () => {
  const value = blueprint();
  value.places[1] = {
    ...value.places[1]!,
    schedulingEligibility: { decision: "informational", reason: MAP_COORDINATES_PENDING_SCHEDULING_REASON }
  };
  const result = applyDirectBlueprintRevision(value, {
    kind: "move_place_within_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "start" },
    createdAt: "2026-08-27T00:00:00.000Z"
  });
  assert.deepEqual(result.days[0]?.stops.map((stop) => stop.placeId), ["b", "a"]);

  value.places[1] = {
    ...value.places[1]!,
    schedulingEligibility: { decision: "informational", reason: "This is reference context, not an itinerary stop." }
  };
  assert.throws(() => applyDirectBlueprintRevision(value, {
    kind: "move_place_within_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "start" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }), (error) => error instanceof DirectBlueprintReplanRequirementError && error.replanRequirement.reasonCode === "informational_place");
});

test("Direct Blueprint Revision reports fixed bookings as assisted replanning requirements", () => {
  const value = blueprint();
  value.places[1] = { ...value.places[1]!, priority: "booked" };
  const revision = {
    kind: "remove_place_from_day",
    placeId: "b",
    dayId: "d1",
    createdAt: "2026-08-27T00:00:00.000Z"
  } as const;
  try {
    applyDirectBlueprintRevision(value, revision);
    assert.fail("Expected a structured assisted replanning requirement.");
  } catch (caught) {
    assert.ok(caught instanceof DirectBlueprintReplanRequirementError);
    assert.equal(caught.code, "assisted_replanning_required");
    assert.equal(caught.replanRequirement.reasonCode, "fixed_booking");
    assert.deepEqual(caught.replanRequirement.affectedDayIds, ["d1"]);
    assert.deepEqual(caught.replanRequirement.affectedPlaceIds, ["b", "a"]);
    assert.match(caught.replanRequirement.explanation, /booking or reservation/i);
    assert.match(caught.replanRequirement.suggestedRequest, /Preserve fixed bookings and reservations/i);
  }
});

test("Direct Blueprint assisted replanning handoff prepares a bounded request", () => {
  const value = blueprint();
  value.places[2] = { ...value.places[2]!, name: "Faraway dinner", category: "restaurant", schedulingEligibility: { decision: "high_impact", reason: "Requires another city day.", highImpactReasons: ["Different city"] } };
  const revision = {
    kind: "add_place_to_day",
    placeId: "c",
    dayId: "d1",
    position: { kind: "end" },
    createdAt: "2026-08-27T00:00:00.000Z"
  } as const;
  let requirement;
  try {
    applyDirectBlueprintRevision(value, revision);
    assert.fail("Expected a structured assisted replanning requirement.");
  } catch (caught) {
    assert.ok(caught instanceof DirectBlueprintReplanRequirementError);
    requirement = caught.replanRequirement;
  }

  const handoff = prepareDirectBlueprintAssistedReplanningHandoff(value, { replanRequirement: requirement, revisions: [revision] });

  assert.equal(handoff.status, "ready_for_assisted_replanning");
  assert.equal(handoff.baseBlueprintId, "blueprint-1");
  assert.equal(handoff.baseBlueprintVersion, 1);
  assert.deepEqual(handoff.affectedDayIds, ["d1"]);
  assert.deepEqual(handoff.affectedPlaceIds, ["c", "a", "b"]);
  assert.deepEqual(handoff.revisions.map((item) => item.kind), ["add_place_to_day"]);
  assert.match(handoff.request, /Replan the affected itinerary day for Tokyo/);
  assert.match(handoff.request, /Add Faraway dinner at the end of the day on 2026-09-01/);
  assert.match(handoff.request, /Keep every unlisted day and unaffected place unchanged/);
  assert.match(handoff.request, /publishing a new Trip Blueprint version/);
  assert.equal(value.version, 1);
  assert.deepEqual(value.days[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
});

test("Direct Blueprint assisted replanning handoff rejects stale or mismatched requirements", () => {
  const value = blueprint();
  const revision = {
    kind: "remove_place_from_day",
    placeId: "b",
    dayId: "d1",
    createdAt: "2026-08-27T00:00:00.000Z"
  } as const;
  const requirement = {
    status: "assisted_replanning_required",
    editKind: "remove_place_from_day",
    placeId: "b",
    dayId: "d1",
    reasonCode: "fixed_booking",
    affectedDayIds: ["d1"],
    affectedPlaceIds: ["b", "a"],
    explanation: "b is fixed by a booking.",
    suggestedRequest: "Replan day one."
  } satisfies Parameters<typeof prepareDirectBlueprintAssistedReplanningHandoff>[1]["replanRequirement"];

  assert.throws(() => prepareDirectBlueprintAssistedReplanningHandoff(value, {
    replanRequirement: { ...requirement, affectedDayIds: ["missing-day"] },
    revisions: [revision]
  }), /unknown affected day/i);
  assert.throws(() => prepareDirectBlueprintAssistedReplanningHandoff(value, {
    replanRequirement: { ...requirement, affectedPlaceIds: ["missing-place"] },
    revisions: [revision]
  }), /unknown affected place/i);
  assert.throws(() => prepareDirectBlueprintAssistedReplanningHandoff(value, {
    replanRequirement: { ...requirement, placeId: "a" },
    revisions: [revision]
  }), /matches the replanning requirement/i);
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

test("Direct Blueprint Revision removes a place from one day without deleting it", () => {
  const original = blueprint();
  original.places.push(place("d"));
  original.days[0] = {
    ...original.days[0]!,
    stops: [
      { placeId: "a", order: 1, time: "09:00", role: "morning" },
      { placeId: "b", order: 2, time: "10:30", role: "late_morning" },
      { placeId: "d", order: 3, time: "14:00", role: "afternoon" }
    ],
    candidatePlaceIds: ["c"],
    blocks: [
      { id: "block-a", kind: "stop", order: 1, placeId: "a", startTime: "09:00", title: "A anchor", summary: "Use A first.", evidence: [] },
      { id: "block-break", kind: "rest", order: 2, title: "Short break", summary: "Keep a pause.", evidence: [] },
      { id: "block-b", kind: "meal", order: 3, placeId: "b", startTime: "10:30", title: "B meal", summary: "Use B second.", evidence: [] },
      { id: "block-d", kind: "stop", order: 4, placeId: "d", startTime: "14:00", title: "D stop", summary: "Use D third.", evidence: [] }
    ]
  };
  original.movements = [
    { id: "m1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "verified", durationMinutes: 20, label: "Walk A to B", detail: "Verified walk.", evidence: [] },
    { id: "m2", dayId: "d1", originPlaceId: "b", destinationPlaceId: "d", mode: "walking", status: "verified", durationMinutes: 15, label: "Walk B to D", detail: "Verified walk.", evidence: [] }
  ];

  const result = applyDirectBlueprintRevisionWithMetadata(original, {
    kind: "remove_place_from_day",
    placeId: "b",
    dayId: "d1",
    createdAt: "2026-08-27T00:00:00.000Z"
  });

  assert.equal(result.blueprint.version, 2);
  assert.deepEqual(result.blueprint.places.map((candidate) => candidate.id), ["a", "b", "c", "d"]);
  assert.deepEqual(result.blueprint.days[0]?.stops.map((stop) => [stop.placeId, stop.order, stop.time ?? "", stop.role ?? ""]), [
    ["a", 1, "09:00", "morning"],
    ["d", 2, "14:00", "afternoon"]
  ]);
  assert.deepEqual(result.blueprint.days[0]?.candidatePlaceIds, ["c", "b"]);
  assert.deepEqual(result.blueprint.days[0]?.blocks?.map((block) => [block.id, block.kind, block.placeId ?? "", block.order, block.startTime ?? "", block.title ?? ""]), [
    ["block-a", "stop", "a", 1, "09:00", "A anchor"],
    ["block-break", "rest", "", 2, "", "Short break"],
    ["block-d", "stop", "d", 3, "14:00", "D stop"]
  ]);
  assert.deepEqual(result.blueprint.movements.map((movement) => [movement.originPlaceId, movement.destinationPlaceId, movement.status, movement.display?.mapLineState]), [
    ["a", "d", "recheck", "needs_refresh"]
  ]);
  assert.equal(result.metadata.kind, "remove_place_from_day");
  assert.deepEqual(result.metadata.affectedDayIds, ["d1"]);
  assert.deepEqual(result.metadata.routeRefresh.movementIds, ["movement-d1-1"]);
  assert.deepEqual(result.metadata.routeImpact?.days, [{
    dayId: "d1",
    addedPlaceIds: [],
    removedPlaceIds: ["b"],
    movedPlaceIds: [],
    movementIds: ["movement-d1-1"],
    requiresRouteRefresh: true,
    requiresTimingReview: true,
    requiresMealRestSpacingReview: true,
    capacityRisk: false,
    backtrackingRisk: false,
    fixedTimeRisk: true,
    readiness: "ready_for_route_refresh",
    reasons: [
      "remove_place_from_day changed the saved itinerary order for this day.",
      "Adjacent movement timing should be reviewed before execution.",
      "Meal and rest spacing should be checked after this edit.",
      "The edited day includes multiple fixed time labels."
    ]
  }]);
  assert.deepEqual(result.metadata.undo.previousDay?.stops.map((stop) => stop.placeId), ["a", "b", "d"]);
  assert.deepEqual(result.metadata.undo.previousMovements.map((movement) => movement.id), ["m1", "m2"]);
});

test("Direct Blueprint Revision rejects direct removal of booked places", () => {
  const reserved = blueprint();
  reserved.places[1] = { ...reserved.places[1]!, priority: "booked" };
  assert.throws(() => applyDirectBlueprintRevision(reserved, {
    kind: "remove_place_from_day",
    placeId: "b",
    dayId: "d1",
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /booking/i);
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

test("Direct Blueprint Revision routes standalone fixed bookings through assisted replanning", () => {
  const booked = blueprint();
  booked.places = [
    place("a"),
    { ...place("b"), name: "Fado night", category: "event", locationLabel: "Fado hall, Tokyo" },
    place("c")
  ];
  booked.bookingConstraints = [{
    id: "booking-fado",
    type: "event",
    title: "Fado night",
    status: "confirmed",
    sourceLabel: "Email",
    importedAt: "2026-08-26T00:00:00.000Z",
    constraintStrength: "hard",
    segments: [{
      id: "segment-fado",
      segmentType: "event_window",
      title: "Fado night",
      startAtLocal: "2026-09-01T20:00",
      startTimeZone: "Asia/Tokyo",
      location: "Fado hall, Tokyo",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  }];

  assert.throws(() => applyDirectBlueprintRevision(booked, {
    kind: "move_place_within_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "start" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }), (error) => error instanceof DirectBlueprintReplanRequirementError && error.replanRequirement.reasonCode === "fixed_booking");
  assert.throws(() => applyDirectBlueprintRevision(booked, {
    kind: "remove_place_from_day",
    placeId: "b",
    dayId: "d1",
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /booking/i);

  const unscheduled = structuredClone(booked);
  unscheduled.days[0] = { ...unscheduled.days[0]!, stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: ["b", "c"] };
  unscheduled.movements = [];
  assert.throws(() => applyDirectBlueprintRevision(unscheduled, {
    kind: "add_place_to_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "end" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }), /fixed booking/i);

  const broadHotel = structuredClone(booked);
  broadHotel.bookingConstraints = [{
    ...booked.bookingConstraints[0]!,
    id: "booking-hotel",
    type: "accommodation",
    title: "Tokyo stay",
    segments: [{ ...booked.bookingConstraints[0]!.segments[0]!, id: "segment-hotel", title: "Hotel stay", segmentType: "hotel_stay", location: "Tokyo" }]
  }];
  assert.doesNotThrow(() => applyDirectBlueprintRevision(broadHotel, {
    kind: "move_place_within_day",
    placeId: "b",
    dayId: "d1",
    position: { kind: "start" },
    createdAt: "2026-08-27T00:00:00.000Z"
  }));
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
      { id: "block-a", kind: "stop", order: 1, placeId: "a", startTime: "09:00", title: "A anchor", summary: "Use A as the morning anchor.", planRole: "planned", primaryExperience: true, operationalConditions: [{ kind: "recheck", note: "Recheck access." }], evidence: [] },
      { id: "block-rest", kind: "rest", order: 2, title: "Short reset", summary: "Keep a real pause between stops.", evidence: [] },
      { id: "block-b", kind: "meal", order: 3, placeId: "b", startTime: "10:30", endTime: "11:15", title: "B meal", summary: "Use B as the food stop.", planRole: "planned", primaryExperience: true, operationalConditions: [{ kind: "weather", note: "Use the indoor route in rain." }], evidence: [] }
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
  assert.deepEqual(revised.days[0]?.blocks?.filter((block) => block.placeId).map((block) => ({
    placeId: block.placeId,
    planRole: block.planRole,
    primaryExperience: block.primaryExperience,
    operationalConditions: block.operationalConditions
  })), [
    { placeId: "b", planRole: "planned", primaryExperience: true, operationalConditions: [{ kind: "weather", note: "Use the indoor route in rain." }] },
    { placeId: "a", planRole: "planned", primaryExperience: true, operationalConditions: [{ kind: "recheck", note: "Recheck access." }] }
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
  assert.deepEqual(result.metadata.routeImpact?.days, [{
    dayId: "d1",
    addedPlaceIds: ["c"],
    removedPlaceIds: [],
    movedPlaceIds: ["b"],
    movementIds: ["movement-d1-1", "movement-d1-2"],
    requiresRouteRefresh: true,
    requiresTimingReview: true,
    requiresMealRestSpacingReview: true,
    capacityRisk: false,
    backtrackingRisk: false,
    fixedTimeRisk: false,
    readiness: "ready_for_route_refresh",
    reasons: [
      "add_place_to_day changed the saved itinerary order for this day.",
      "Adjacent movement timing should be reviewed before execution.",
      "Meal and rest spacing should be checked after this edit.",
      "move_place_within_day changed the saved itinerary order for this day."
    ]
  }]);
  assert.deepEqual(result.metadata.replanReadiness, {
    status: "ready_for_route_refresh",
    dayIds: ["d1"],
    reason: "These direct itinerary edits are saved, but affected routes and timing still need refresh before execution."
  });
  assert.equal(result.metadata.undo.previousBlueprintVersion, 1);
  assert.deepEqual(result.metadata.undo.previousDays[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
  assert.deepEqual(result.metadata.undo.previousMovements.map((movement) => movement.id), ["m1"]);
});

test("Direct Blueprint Revision batch groups route impact by affected day", () => {
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
  original.movements.push({ id: "m2", dayId: "d2", originPlaceId: "d", destinationPlaceId: "e", mode: "walking", status: "verified", durationMinutes: 12, label: "Walk", detail: "Verified walk.", evidence: [] });

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
      placeId: "e",
      dayId: "d2",
      position: { kind: "start" },
      createdAt: "2026-08-27T00:01:00.000Z"
    }
  ]);

  assert.deepEqual(result.metadata.affectedDayIds, ["d1", "d2"]);
  assert.deepEqual(result.metadata.routeImpact?.days.map((day) => ({
    dayId: day.dayId,
    addedPlaceIds: day.addedPlaceIds,
    movedPlaceIds: day.movedPlaceIds,
    movementIds: day.movementIds,
    requiresTimingReview: day.requiresTimingReview,
    requiresMealRestSpacingReview: day.requiresMealRestSpacingReview,
    readiness: day.readiness
  })), [
    {
      dayId: "d1",
      addedPlaceIds: ["c"],
      movedPlaceIds: [],
      movementIds: ["movement-d1-1", "movement-d1-2"],
      requiresTimingReview: true,
      requiresMealRestSpacingReview: true,
      readiness: "ready_for_route_refresh"
    },
    {
      dayId: "d2",
      addedPlaceIds: [],
      movedPlaceIds: ["e"],
      movementIds: ["movement-d2-1"],
      requiresTimingReview: true,
      requiresMealRestSpacingReview: false,
      readiness: "ready_for_route_refresh"
    }
  ]);
  assert.deepEqual(result.metadata.replanReadiness, {
    status: "ready_for_route_refresh",
    dayIds: ["d1", "d2"],
    reason: "These direct itinerary edits are saved, but affected routes and timing still need refresh before execution."
  });
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
