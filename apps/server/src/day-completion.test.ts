import assert from "node:assert/strict";
import test from "node:test";
import { importSkillItinerary, importSkillResearchBatches, type SkillResearchBatchArtifact } from "@c-assistant/core";
import { assessBlueprintDayReasonableness, completionTargetsForBlueprint } from "./day-completion.js";

const now = "2026-09-08T00:00:00.000Z";
const lineage = { skillId: "interactive-trip-planner", skillVersion: "1.0.0" };
const proposalRef = { sessionId: "session", proposalVersion: 1 };

test("dependency-gap transfer day is preserved instead of targeted for attraction completion", () => {
  const research = researchSet([]);
  const blueprint = importSkillItinerary(research, {
    title: "Bali",
    summary: "Base change",
    language: "en",
    destinations: ["Bali"],
    startDate: "2026-10-08",
    endDate: "2026-10-08",
    days: [{
      id: "day-2026-10-08",
      date: "2026-10-08",
      kind: "transit",
      city: "South Bali",
      title: "Change to the South Bali Base",
      summary: "Move from the assumed Ubud-area base to South Bali. South Bali lodging not selected; baggage and check-in are unresolved.",
      stops: [],
      blocks: [{ id: "lodging", kind: "lodging", order: 1, title: "South Bali lodging not selected", summary: "Book the second base and confirm baggage, check-in, and transfer plan.", evidence: [] }],
      candidatePlaceIds: []
    }],
    movements: []
  }, { blueprintId: "blueprint", blueprintVersion: 1, createdAt: now });
  const [assessment] = assessBlueprintDayReasonableness(blueprint);
  assert.equal(assessment!.classification, "UNDER_PLANNED");
  assert.equal(assessment!.cause, "DEPENDENCY_GAP");
  assert.equal(completionTargetsForBlueprint(blueprint, research).length, 0);
});

test("candidate-gap sightseeing day prefers existing same-area research before new research", () => {
  const research = researchSet([
    { id: "tanah-lot", name: "Tanah Lot", area: "Beraban", city: "Tabanan", category: "sea temple", durationMinutes: 90 },
    { id: "kediri-market", name: "Kediri Market", area: "Beraban", city: "Tabanan", category: "market", durationMinutes: 90 }
  ], [{ kind: "same_area", fromPlaceId: "kediri-market", toPlaceId: "tanah-lot", rationale: "Same west-coast area." }]);
  const anchor = research.places.find((place) => place.name === "Tanah Lot")!;
  const candidate = research.places.find((place) => place.name === "Kediri Market")!;
  const blueprint = importSkillItinerary(research, {
    title: "Bali",
    summary: "Coast",
    language: "en",
    destinations: ["Bali"],
    startDate: "2026-10-11",
    endDate: "2026-10-11",
    days: [{
      id: "day-2026-10-11",
      date: "2026-10-11",
      kind: "scheduled",
      city: "Tabanan",
      title: "Tanah Lot Coastal Temple",
      summary: "A one-anchor final sightseeing day.",
      stops: [{ placeId: anchor.id, order: 1 }],
      blocks: [{ id: "tanah", kind: "stop", order: 1, placeId: anchor.id, durationMinutes: 90, evidence: [] }],
      candidatePlaceIds: [candidate.id]
    }],
    movements: []
  }, { blueprintId: "blueprint", blueprintVersion: 1, createdAt: now });
  const [target] = completionTargetsForBlueprint(blueprint, research);
  assert.equal(target!.assessment.cause, "CANDIDATE_GAP");
  assert.deepEqual(target!.existingCandidates.map((place) => place.id), [candidate.id]);
  assert.equal(target!.researchScopeLabel, undefined);
});

function researchSet(
  places: Array<{ id: string; name: string; area: string; city: string; category: string; durationMinutes: number }>,
  relationships: NonNullable<SkillResearchBatchArtifact["relationships"]> = []
) {
  return importSkillResearchBatches([{
    id: "scope-1",
    scopeLabel: "Bali",
    completedAt: now,
    sources: [],
    events: [],
    actionRequirements: [],
    places: places.map((place) => ({
      id: place.id,
      name: place.name,
      locationLabel: `${place.area}, ${place.city}`,
      city: place.city,
      area: place.area,
      category: place.category,
      priority: "preferred" as const,
      coordinates: [-8.6, 115.1] as [number, number],
      durationMinutes: place.durationMinutes,
      whyWorthIt: `${place.name} is relevant to the day.`,
      plan: `Visit ${place.name}.`,
      sourceUrls: []
    })),
    relationships
  }], { researchSetId: "research", generationKey: "generation", proposalRef, skillLineage: lineage, createdAt: now, updatedAt: now });
}
