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

test("Trip Blueprint validates optional place display intent", () => {
  const value = blueprint();
  value.places[0] = { ...value.places[0]!, display: { type: "shopping", markerKind: "shopping" } };
  assert.deepEqual(tripBlueprintIntegrityIssues(value), []);

  value.places[0] = { ...value.places[0]!, display: { type: "activity" as "shopping", markerKind: "shopping" } };
  const issues = tripBlueprintIntegrityIssues(value);
  assert.ok(issues.includes("place a has invalid display type"));
});

test("Trip Blueprint validates optional guide display intent", () => {
  const value = blueprint();
  value.places[0] = {
    ...value.places[0]!,
    guideDisplay: {
      showInGuide: true,
      state: "unscheduled",
      cardSummary: "Short card copy written by the planning skill.",
      tags: ["60 min", "Rain option"],
      detailLeadTitle: "Why this fits",
      detailPlanTitle: "How to use it",
      comparisonTitle: "Compare nearby stops",
      comparisonRows: [{
        id: "row-b",
        relatedPlaceId: "b",
        area: "Tokyo",
        routeFit: "Same direction",
        timing: "Flexible morning",
        effort: "Low-effort swap",
        sourceState: "Verified source"
      }]
    }
  };
  assert.deepEqual(tripBlueprintIntegrityIssues(value), []);

  value.places[0]!.guideDisplay = {
    state: "hidden" as "informational",
    tags: [""],
    comparisonRows: [{
      id: "",
      relatedPlaceId: "a",
      area: "",
      routeFit: "",
      timing: "",
      effort: "",
      sourceState: "",
      evidence: [{ sourceId: "missing-source", status: "verified" }]
    }]
  };
  const issues = tripBlueprintIntegrityIssues(value);
  assert.ok(issues.includes("place a has invalid guide display state"));
  assert.ok(issues.includes("place a guide display contains an empty tag"));
  assert.ok(issues.includes("place a.guideDisplay.comparisonRows contains a missing identity"));
  assert.ok(issues.some((issue) => issue.includes("place a guide display row <missing> is incomplete")));
  assert.ok(issues.some((issue) => issue.includes("place a guide display row <missing> has invalid related place a")));
  assert.ok(issues.some((issue) => issue.includes("place a guide display row <missing> references unknown source missing-source")));
});

test("Trip Blueprint validates canonical travel tips and preparation checklist", () => {
  const value = blueprint();
  value.actionRequirements = [{
    id: "requirement-passport",
    kind: "travel_authorization",
    title: "Check passport validity",
    description: "Passport validity must cover entry requirements.",
    accountableParty: "traveler",
    completionCondition: "Passport validity is confirmed.",
    evidence: []
  }];
  value.travelTips = [{
    id: "tip-etiquette",
    title: "Temple etiquette",
    body: "Temple visits require quiet behavior around worshippers.",
    theme: "etiquette",
    context: "Tokyo temples",
    dayId: "d1",
    placeId: "a",
    evidence: []
  }];
  value.preparationChecklist = [{
    id: "prep-passport",
    title: "Check passport validity",
    group: "documents",
    completionCondition: "Passport validity is confirmed.",
    requirementId: "requirement-passport",
    evidence: []
  }];
  assert.deepEqual(tripBlueprintIntegrityIssues(value), []);

  value.travelTips[0] = { ...value.travelTips[0]!, theme: "generic" as "etiquette", placeId: "missing", dayId: "missing-day" };
  value.preparationChecklist[0] = { ...value.preparationChecklist[0]!, group: "paperwork" as "documents", requirementId: "missing-requirement" };
  const issues = tripBlueprintIntegrityIssues(value);
  assert.ok(issues.some((issue) => issue.includes("travel tip tip-etiquette has invalid theme")));
  assert.ok(issues.some((issue) => issue.includes("travel tip tip-etiquette references unknown place missing")));
  assert.ok(issues.some((issue) => issue.includes("travel tip tip-etiquette references unknown day missing-day")));
  assert.ok(issues.some((issue) => issue.includes("preparation item prep-passport has invalid group")));
  assert.ok(issues.some((issue) => issue.includes("preparation item prep-passport references unknown action requirement missing-requirement")));
});

test("Trip Blueprint validates Guide Catalog themes against concrete places", () => {
  const value = blueprint();
  value.localFoods = [{
    id: "food-soba",
    title: "Soba",
    description: "A local noodle choice useful for a quick lunch.",
    context: "Tokyo lunch stops",
    diningPlaceIds: ["a"],
    evidence: []
  }];
  value.localProducts = [{
    id: "product-paper",
    title: "Washi paper",
    description: "Traditional paper goods that fit small-shop browsing.",
    context: "Craft streets",
    purchasePlaceIds: ["b"],
    evidence: []
  }];
  value.experienceThemes = [{
    id: "experience-tea",
    title: "Tea practice",
    description: "A structured local experience that needs a concrete session provider.",
    context: "Quiet afternoon options",
    offeringPlaceIds: ["c"],
    evidence: []
  }];
  assert.deepEqual(tripBlueprintIntegrityIssues(value), []);

  value.localFoods[0] = { ...value.localFoods[0]!, diningPlaceIds: ["missing", "missing"] };
  value.localProducts[0] = { ...value.localProducts[0]!, purchasePlaceIds: [] };
  value.experienceThemes[0] = { ...value.experienceThemes[0]!, offeringPlaceIds: ["missing-offering"] };
  const issues = tripBlueprintIntegrityIssues(value);
  assert.ok(issues.some((issue) => issue.includes("local food food-soba references unknown dining place missing")));
  assert.ok(issues.some((issue) => issue.includes("local food food-soba contains duplicate dining places")));
  assert.ok(issues.some((issue) => issue.includes("local product product-paper needs at least one purchase place")));
  assert.ok(issues.some((issue) => issue.includes("experience theme experience-tea references unknown offering place missing-offering")));
});

test("Trip Blueprint validates V2 guide relationships, scheduling, blocks, and field evidence", () => {
  const value = blueprint();
  value.moduleIdentity = {
    primaryModule: "itinerary",
    enabledModules: [
      { id: "itinerary", title: "Itinerary", source: "blueprint" },
      { id: "preparation", title: "Preparation", source: "blueprint" }
    ]
  };
  value.guideTheme = {
    title: "Tokyo neighborhoods",
    narrative: "A balanced visitor route.",
    visitorMode: "balanced-visitor",
    citySegments: [{ id: "tokyo", city: "Tokyo", title: "Tokyo", summary: "Two days", dayIds: ["d1"] }]
  };
  value.places[2] = {
    ...value.places[2]!,
    schedulingEligibility: { decision: "schedulable", reason: "Works as a same-city alternative.", suitableDayIds: ["d1"] },
    fieldEvidence: [{ path: "whyWorthIt", status: "recheck", evidence: [] }]
  };
  value.guideRelationshipGraph = { relationships: [{ id: "rel-1", kind: "alternative", fromPlaceId: "c", toPlaceId: "a", rationale: "Use C when A is crowded.", dayIds: ["d1"], evidence: [] }] };
  value.days[0] = {
    ...value.days[0]!,
    blocks: [
      { id: "block-1", kind: "stop", order: 1, placeId: "a", evidence: [] },
      { id: "block-2", kind: "stop", order: 2, placeId: "b", evidence: [] }
    ]
  };
  assert.deepEqual(tripBlueprintIntegrityIssues(value), []);

  value.guideRelationshipGraph.relationships[0] = { ...value.guideRelationshipGraph.relationships[0]!, toPlaceId: "missing", dayIds: ["missing-day"] };
  value.days[0].blocks![1] = { ...value.days[0].blocks![1]!, order: 4 };
  value.places[2]!.schedulingEligibility = { decision: "high_impact", reason: "Requires a new city day.", suitableDayIds: ["missing-day"] };
  value.fieldEvidence = [{ path: "summary", status: "verified", evidence: [{ sourceId: "missing-source", status: "verified" }] }];
  const issues = tripBlueprintIntegrityIssues(value);
  assert.ok(issues.some((issue) => issue.includes("guide relationship rel-1 references unknown place missing")));
  assert.ok(issues.some((issue) => issue.includes("guide relationship rel-1 references unknown day missing-day")));
  assert.ok(issues.some((issue) => issue.includes("day d1 block order must be contiguous")));
  assert.ok(issues.some((issue) => issue.includes("place c high-impact scheduling eligibility requires reasons")));
  assert.ok(issues.some((issue) => issue.includes("place c scheduling eligibility references unknown suitable day missing-day")));
  assert.ok(issues.some((issue) => issue.includes("blueprint field evidence summary references unknown source missing-source")));
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
