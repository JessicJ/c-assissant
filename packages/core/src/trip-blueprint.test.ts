import assert from "node:assert/strict";
import test from "node:test";

import {
  TRIP_BLUEPRINT_SCHEMA_VERSION,
  researchSetIntegrityIssues,
  tripBlueprintIntegrityIssues,
  type BlueprintPlace,
  type ResearchSet,
  type TripBlueprint
} from "./trip-blueprint.js";

const place = (id: string): BlueprintPlace => ({
  id,
  name: id,
  locationLabel: "Tokyo",
  city: "Tokyo",
  category: "sight",
  priority: "preferred",
  whyWorthIt: `Why ${id} matters`,
  plan: `Visit ${id}`,
  evidence: []
});

const research = (): ResearchSet => ({
  schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
  id: "research-1",
  generationKey: "session-1:proposal-1:interactive-trip-planner@0.2.0",
  proposalRef: { sessionId: "session-1", proposalVersion: 1 },
  skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
  status: "completed",
  batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b", "c"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:00:00.000Z" }],
  places: [place("a"), place("b"), place("c")],
  events: [],
  sources: [],
  actionRequirements: [],
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  completedAt: "2026-08-26T00:00:00.000Z"
});

const blueprint = (): TripBlueprint => ({
  schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
  id: "blueprint-1",
  version: 1,
  generationKey: "session-1:proposal-1:interactive-trip-planner@0.2.0",
  proposalRef: { sessionId: "session-1", proposalVersion: 1 },
  skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
  researchSetId: "research-1",
  title: "Tokyo",
  summary: "A complete Tokyo trip",
  language: "en",
  destinations: ["Tokyo"],
  startDate: "2026-09-01",
  endDate: "2026-09-02",
  places: [place("a"), place("b"), place("c")],
  events: [],
  sources: [],
  days: [
    { id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "East Tokyo", summary: "A practical sequence", stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }], candidatePlaceIds: ["c"] },
    { id: "d2", date: "2026-09-02", kind: "rest", city: "Tokyo", title: "Rest day", summary: "Keep this day unstructured", stops: [], candidatePlaceIds: ["c"] }
  ],
  movements: [{ id: "m1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "unknown", status: "recheck", evidence: [] }],
  actionRequirements: [],
  createdAt: "2026-08-26T00:00:00.000Z"
});

test("Research Set accepts evidence gaps and places without coordinates", () => {
  assert.deepEqual(researchSetIntegrityIssues(research()), []);
});

test("Trip Blueprint accepts explicit rest days and unverified movement", () => {
  const value = blueprint();
  assert.deepEqual(tripBlueprintIntegrityIssues(value, { expectedResearchPlaceIds: research().places.map((item) => item.id) }), []);
});

test("Trip Blueprint rejects missing dates, unresolved places, and missing movements", () => {
  const value = blueprint();
  value.days = [
    { ...value.days[0]!, stops: [{ placeId: "a", order: 1 }, { placeId: "missing", order: 2 }] }
  ];
  value.movements = [];
  const issues = tripBlueprintIntegrityIssues(value);
  assert.ok(issues.some((issue) => issue.includes("missing itinerary date 2026-09-02")));
  assert.ok(issues.some((issue) => issue.includes("unknown place missing")));
  assert.ok(issues.some((issue) => issue.includes("missing movement a -> missing")));
});

test("Trip Blueprint enforces exact Research Set place identity preservation", () => {
  const value = blueprint();
  value.places = value.places.filter((item) => item.id !== "c");
  const issues = tripBlueprintIntegrityIssues(value, { expectedResearchPlaceIds: ["a", "b", "c"] });
  assert.ok(issues.includes("blueprint lost research place c"));
});
