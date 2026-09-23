import assert from "node:assert/strict";
import test from "node:test";
import type { BlueprintPlace, ResearchSet, TripBlueprint } from "@c-assistant/core";
import { LANDI_BLUEPRINT_SKILL } from "@c-assistant/agent-adapters";
import { assessExploreSupply, buildExploreSupplyResearchRequest } from "./explore-supply.js";

const places: BlueprintPlace[] = [
  place("airport", "DPS Airport", "International airport", "Tuban"),
  place("ubud-1", "Ubud museum", "Art museum", "Ubud"),
  place("ubud-2", "Ubud temple", "Temple", "Ubud"),
  place("south-1", "South Bali beach", "Beach", "Jimbaran"),
  place("south-2", "South Bali restaurant", "Restaurant", "Jimbaran")
];

test("detects an Explore gap when a multi-day itinerary consumes every non-logistics place", () => {
  const blueprint = fixture(places);
  const assessment = assessExploreSupply(blueprint);
  assert.equal(assessment.destinationDayCount, 4);
  assert.deepEqual(assessment.logisticsPlaceIds, ["airport"]);
  assert.deepEqual(assessment.actionablePlaceIds, []);
  assert.equal(assessment.needsSupplement, true);
  assert.ok(assessment.uncoveredAreas.includes("Ubud"));
  assert.ok(assessment.uncoveredAreas.includes("Jimbaran"));
});

test("accepts useful plan-outside choices and keeps logistics separate", () => {
  const alternatives = [
    place("ubud-cafe", "Ubud cafe", "Cafe", "Ubud"),
    place("south-spa", "Jimbaran spa", "Spa experience", "Jimbaran")
  ];
  const assessment = assessExploreSupply(fixture([...places, ...alternatives]));
  assert.deepEqual(assessment.actionablePlaceIds, ["ubud-cafe", "south-spa"]);
  assert.deepEqual(new Set(assessment.choiceTypes), new Set(["dining", "experience"]));
  assert.deepEqual(assessment.uncoveredAreas, []);
  assert.equal(assessment.needsSupplement, false);
});

test("builds one bounded supplement request without asking for itinerary recomposition", () => {
  const blueprint = fixture(places);
  const research = {
    schemaVersion: 1,
    id: "research-1",
    generationKey: blueprint.generationKey,
    proposalRef: blueprint.proposalRef,
    skillLineage: blueprint.skillLineage,
    status: "completed",
    batches: [], places, events: [], sources: [], actionRequirements: [],
    createdAt: blueprint.createdAt, updatedAt: blueprint.createdAt, completedAt: blueprint.createdAt
  } as ResearchSet;
  const request = buildExploreSupplyResearchRequest("A relaxed Bali trip", blueprint, research, assessExploreSupply(blueprint));
  assert.match(request, /one small, plan-serving set/i);
  assert.match(request, /Keep them unscheduled/i);
  assert.match(request, /not a quota/i);
  assert.match(request, /valid latitude\/longitude coordinates/i);
  assert.match(request, /Never guess coordinates/i);
  assert.match(request, /do not redesign or restate the itinerary/i);
});

function place(id: string, name: string, category: string, area: string): BlueprintPlace {
  return { id, name, locationLabel: `${area}, Bali`, city: "Bali", area, category, priority: "preferred", coordinates: [-8.5, 115.2], display: { type: /restaurant|cafe/i.test(category) ? "dining" : /spa/i.test(category) ? "experience" : "attraction" }, whyWorthIt: `${name} adds a distinct local choice.`, plan: `Consider ${name} when it fits the route.`, detailSections: [], evidence: [], schedulingEligibility: { decision: /airport/i.test(category) ? "informational" : "schedulable", reason: "Fixture eligibility." } };
}

function fixture(catalog: BlueprintPlace[]): TripBlueprint {
  const day = (id: string, date: string, stopIds: string[]) => ({ id, date, kind: "scheduled" as const, city: "Bali", title: id, summary: id, stops: stopIds.map((placeId, index) => ({ placeId, order: index + 1 })), blocks: [], candidatePlaceIds: [] });
  return {
    schemaVersion: 1,
    id: "blueprint-1",
    version: 1,
    generationKey: "generation-1",
    proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: LANDI_BLUEPRINT_SKILL,
    researchSetId: "research-1",
    title: "Bali",
    summary: "Bali trip",
    language: "en",
    destinations: ["Bali"],
    startDate: "2026-10-05",
    endDate: "2026-10-08",
    places: catalog,
    events: [], sources: [],
    days: [day("d1", "2026-10-05", ["airport", "ubud-1"]), day("d2", "2026-10-06", ["ubud-2"]), day("d3", "2026-10-07", ["south-1"]), day("d4", "2026-10-08", ["south-2"])],
    movements: [], actionRequirements: [], createdAt: "2026-09-20T00:00:00.000Z"
  };
}
