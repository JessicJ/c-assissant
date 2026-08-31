import assert from "node:assert/strict";
import test from "node:test";
import type { TripBlueprint } from "@c-assistant/core";
import { blueprintPresentation } from "./blueprint-presentation.js";

test("Web derives a complete read model from the linked Trip Blueprint", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-1",
    version: 1,
    generationKey: "generation-1",
    proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-1",
    title: "Lisbon",
    summary: "Architecture and neighborhood life.",
    language: "en",
    destinations: ["Lisbon"],
    startDate: "2026-10-12",
    endDate: "2026-10-12",
    sources: [{ id: "source-1", title: "Official", authority: "City", url: "https://example.com/place", retrievedAt: "2026-08-26", status: "verified", official: true }],
    places: [
      { id: "a", name: "A", locationLabel: "Lisbon", city: "Lisbon", category: "architecture", priority: "must", coordinates: [38.7, -9.1], whyWorthIt: "A", plan: "Visit A", detailSections: [{ title: "Look", items: ["Facade"] }], evidence: [{ sourceId: "source-1", status: "verified" }] },
      { id: "b", name: "B", locationLabel: "Lisbon", city: "Lisbon", category: "local-life", priority: "preferred", coordinates: [38.71, -9.11], whyWorthIt: "B", plan: "Visit B", evidence: [] },
      { id: "c", name: "C", locationLabel: "Lisbon", city: "Lisbon", category: "cafe", priority: "nearby", whyWorthIt: "C", plan: "Keep C as an alternative", evidence: [] }
    ],
    events: [],
    days: [{ id: "day-1", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }], candidatePlaceIds: ["c"] }],
    movements: [{ id: "move-1", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "recheck", evidence: [] }],
    actionRequirements: [{ id: "reserve-a", kind: "reservation", title: "Reserve A", description: "Choose an admission slot.", accountableParty: "traveler", completionCondition: "A slot is confirmed.", placeId: "a", evidence: [] }],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.places.map((place) => place.id), ["a", "b", "c"]);
  assert.deepEqual(presentation.days[0]?.placeIds, ["a", "b"]);
  assert.deepEqual(presentation.days[0]?.candidates, ["c"]);
  assert.equal(presentation.routeSegments[0]?.verification, "needs_verification");
  assert.equal(presentation.places[0]?.reservation?.verification, "needs_recheck");
});

test("Web Blueprint read model filters invalid itinerary references and preserves a displayable route", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-1",
    version: 1,
    generationKey: "generation-1",
    proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-1",
    title: "Tokyo",
    summary: "Neighborhood route.",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-10-12",
    endDate: "2026-10-12",
    sources: [],
    places: [
      { id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "must", coordinates: [35.68, 139.76], whyWorthIt: "A", plan: "Visit A", evidence: [] },
      { id: "b", name: "B", locationLabel: "Tokyo", city: "Tokyo", category: "food", priority: "preferred", coordinates: [35.69, 139.77], whyWorthIt: "B", plan: "Visit B", evidence: [] },
      { id: "c", name: "C", locationLabel: "Tokyo", city: "Tokyo", category: "coffee", priority: "nearby", coordinates: [35.7, 139.78], whyWorthIt: "C", plan: "Keep C nearby", evidence: [] }
    ],
    events: [],
    days: [{
      id: "day-1",
      date: "2026-10-12",
      kind: "scheduled",
      city: "Tokyo",
      title: "Day",
      summary: "Flow",
      stops: [{ placeId: "a", order: 1 }, { placeId: "missing", order: 2 }, { placeId: "b", order: 3 }],
      candidatePlaceIds: ["b", "missing-candidate", "c"]
    }],
    movements: [{ id: "bad", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "missing", mode: "walking", status: "verified", evidence: [] }],
    actionRequirements: [],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.days[0]?.placeIds, ["a", "b"]);
  assert.deepEqual(presentation.days[0]?.candidates, ["c"]);
  assert.equal(presentation.routeSegments.length, 1);
  assert.equal(presentation.routeSegments[0]?.originPlaceId, "a");
  assert.equal(presentation.routeSegments[0]?.destinationPlaceId, "b");
  assert.equal(presentation.routeSegments[0]?.verification, "needs_verification");
});
