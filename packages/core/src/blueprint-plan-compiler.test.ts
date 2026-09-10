import assert from "node:assert/strict";
import test from "node:test";

import { compileTripBlueprint } from "./blueprint-plan-compiler.js";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type TripBlueprint } from "./trip-blueprint.js";

const blueprint = (): TripBlueprint => ({
  schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: "blueprint-1", version: 1, generationKey: "generation-1",
  proposalRef: { sessionId: "session-1", proposalVersion: 1 }, skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, researchSetId: "research-1",
  title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
  places: [{ id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred", whyWorthIt: "A matters", plan: "Visit A", evidence: [] }],
  events: [], sources: [],
  days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: [] }], movements: [],
  actionRequirements: [
    { id: "visa", kind: "travel_authorization", title: "Review visa guidance", description: "Use official evidence", accountableParty: "traveler", completionCondition: "Guidance reviewed", evidence: [] },
    { id: "booking", kind: "reservation", title: "Choose museum slot", description: "Choose a slot before payment", accountableParty: "traveler", completionCondition: "Slot selected", placeId: "a", evidence: [] }
  ], createdAt: "2026-08-26T00:00:00.000Z"
});

test("Blueprint Plan Compiler is deterministic and does not embed travel presentation", () => {
  const first = compileTripBlueprint(blueprint(), { createdAt: "2026-08-26T01:00:00.000Z" });
  const second = compileTripBlueprint(blueprint(), { createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(first, second);
  assert.equal(first.plan.presentation, undefined);
  assert.equal(first.plan.stages.length, 3);
  assert.equal(first.lineage.blueprintId, "blueprint-1");
});

test("Blueprint Plan Compiler carries completion by Requirement Identity", () => {
  const result = compileTripBlueprint(blueprint(), { createdAt: "2026-08-26T01:00:00.000Z", completedRequirementIds: ["visa"] });
  const tasks = result.plan.stages.flatMap((stage) => stage.tasks);
  assert.equal(tasks.find((task) => task.requirementId === "visa")?.status, "completed");
  assert.equal(tasks.find((task) => task.requirementId === "booking")?.status, "waiting_user");
});

test("Blueprint Plan Compiler emits only non-empty fixed modules", () => {
  const value = blueprint();
  value.actionRequirements = [];
  const result = compileTripBlueprint(value, { createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(result.plan.stages.map((stage) => stage.title), ["Packing list"]);
  assert.ok(result.plan.stages.every((stage) => stage.tasks.length > 0));
});

test("Blueprint Plan Compiler adds deterministic packing items from trip shape", () => {
  const value = blueprint();
  value.summary = "Autumn museums, cafes, long walks, and bathing.";
  value.startDate = "2026-10-03";
  value.endDate = "2026-10-03";
  value.days[0]!.date = "2026-10-03";
  value.places.push({ id: "spa", name: "Spa LaQua", locationLabel: "Tokyo", city: "Tokyo", category: "spa", priority: "preferred", whyWorthIt: "Bathing break", plan: "Use as an evening recovery stop.", evidence: [] });
  const result = compileTripBlueprint(value, { createdAt: "2026-08-26T01:00:00.000Z", completedRequirementIds: ["packing:phone-power"] });
  const packing = result.plan.stages.find((stage) => stage.title === "Packing list");
  assert.ok(packing);
  assert.deepEqual(packing.tasks.map((task) => task.preparationCategory), Array(packing.tasks.length).fill("packing_item"));
  assert.equal(packing.tasks.find((task) => task.requirementId === "packing:phone-power")?.status, "completed");
  assert.ok(packing.tasks.some((task) => /umbrella|rain shell/i.test(task.title)));
  assert.ok(packing.tasks.some((task) => /towel/i.test(task.title)));
  assert.ok(packing.tasks.every((task) => !/Tokyo and Kyoto/i.test(task.description ?? "")));
});

test("Blueprint Plan Compiler carries booking constraints into Plan details", () => {
  const value = blueprint();
  value.actionRequirements = [];
  value.bookingConstraints = [{
    id: "booking-hotel",
    type: "accommodation",
    title: "Shinjuku Hotel",
    status: "confirmed",
    sourceLabel: "Hotel confirmation email",
    importedAt: "2026-08-27T00:00:00.000Z",
    constraintStrength: "hard",
    segments: [{
      id: "stay",
      segmentType: "hotel_stay",
      title: "Hotel stay",
      startAtLocal: "2026-09-01T15:00",
      startTimeZone: "Asia/Tokyo",
      endAtLocal: "2026-09-02T11:00",
      endTimeZone: "Asia/Tokyo",
      location: "Shinjuku, Tokyo",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  }];
  const result = compileTripBlueprint(value, { createdAt: "2026-08-26T01:00:00.000Z" });
  assert.equal(result.plan.configuration.accommodation.status, "confirmed");
  assert.equal(result.plan.configuration.accommodation.location, "Shinjuku, Tokyo");
  assert.ok(result.plan.knownInformation.some((item) => item.includes("Confirmed accommodation")));
  const bookingTasks = result.plan.stages.flatMap((stage) => stage.tasks).filter((task) => task.requirementId?.startsWith("booking:"));
  assert.equal(bookingTasks.length, 1);
  assert.equal(bookingTasks[0]?.preparationCategory, "booking");
  assert.equal(bookingTasks[0]?.reminder?.timeZone, "Asia/Tokyo");
});
