import assert from "node:assert/strict";
import test from "node:test";
import type { Plan, PlanPresentation, TripBlueprint } from "@c-assistant/core";
import { currentPlanReadModel } from "./current-plan-read-model.js";

function legacyPresentation(): PlanPresentation {
  return {
    kind: "itinerary",
    summary: "Stale stored presentation.",
    startDate: "2026-10-04",
    endDate: "2026-10-04",
    places: [{ id: "old", name: "Old Place", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "must", coordinates: [35.67, 139.75], whyWorthIt: "Old", plan: "Old plan", detailSections: [], sourceRefs: [] }],
    days: [{ id: "day-1", label: "2026-10-04", date: "2026-10-04", city: "Tokyo", placeIds: ["old"], stops: [{ placeId: "old", order: 1 }] }],
    routeSegments: []
  };
}

function plan(presentation: PlanPresentation | null = legacyPresentation()): Plan {
  return {
    id: "plan-1",
    version: 1,
    title: "Tokyo",
    location: "Tokyo",
    dates: "2026-10-04",
    status: "draft",
    knownInformation: [],
    assumptions: [],
    nextAction: "Review.",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [],
    sources: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    ...(presentation ? { presentation } : {})
  };
}

function blueprint(patch: Partial<TripBlueprint> = {}): TripBlueprint {
  return {
    schemaVersion: 1,
    id: "blueprint-1",
    version: 3,
    generationKey: "generation-1",
    proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-1",
    title: "Tokyo",
    summary: "Fresh Blueprint presentation.",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-10-04",
    endDate: "2026-10-04",
    sources: [],
    places: [
      { id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "must", coordinates: [35.68, 139.76], whyWorthIt: "A", plan: "Visit A", evidence: [] },
      { id: "b", name: "B", locationLabel: "Tokyo", city: "Tokyo", category: "garden", priority: "preferred", coordinates: [35.69, 139.77], whyWorthIt: "B", plan: "Visit B", evidence: [] }
    ],
    events: [],
    days: [{ id: "day-1", date: "2026-10-04", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Fresh order.", stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }], candidatePlaceIds: [] }],
    movements: [],
    actionRequirements: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    ...patch
  };
}

test("Current Plan read model uses the active Blueprint over stale Plan presentation", () => {
  const original = plan();
  const model = currentPlanReadModel(original, blueprint());
  assert.equal(model.presentationSource, "blueprint");
  assert.equal(model.presentationVersion, 3);
  assert.equal(model.presentationKey, "blueprint:blueprint-1:3");
  assert.equal(model.plan.id, original.id);
  assert.equal(model.plan.version, original.version);
  assert.equal(original.presentation?.summary, "Stale stored presentation.");
  assert.equal(model.presentation?.summary, "Fresh Blueprint presentation.");
  assert.deepEqual(model.presentation?.days[0]?.placeIds, ["a", "b"]);
});

test("Current Plan read model changes identity when the Blueprint version changes", () => {
  const original = plan();
  const earlier = currentPlanReadModel(original, blueprint({ version: 3 }));
  const later = currentPlanReadModel(original, blueprint({ version: 4, days: [{ id: "day-1", date: "2026-10-04", kind: "scheduled", city: "Tokyo", title: "Day", summary: "New order.", stops: [{ placeId: "b", order: 1 }, { placeId: "a", order: 2 }], candidatePlaceIds: [] }] }));
  assert.notEqual(later.presentationKey, earlier.presentationKey);
  assert.equal(later.presentationVersion, 4);
  assert.deepEqual(later.presentation?.days[0]?.placeIds, ["b", "a"]);
});

test("Current Plan read model keeps legacy presentation when no Blueprint exists", () => {
  const original = plan();
  const model = currentPlanReadModel(original);
  assert.equal(model.presentationSource, "plan");
  assert.equal(model.presentationVersion, 1);
  assert.equal(model.presentation, original.presentation);
  assert.equal(model.plan, original);
});

test("Current Plan read model supports non-itinerary plans without inventing presentation", () => {
  const original = plan(null);
  const model = currentPlanReadModel(original);
  assert.equal(model.presentationSource, "none");
  assert.equal(model.presentation, undefined);
  assert.equal(model.presentationKey, "none:plan-1:1");
});
