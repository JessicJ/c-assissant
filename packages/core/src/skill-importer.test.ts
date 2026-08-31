import assert from "node:assert/strict";
import test from "node:test";

import { importSkillItinerary, importSkillResearchBatches, type SkillResearchBatchArtifact } from "./skill-importer.js";

const batch = (): SkillResearchBatchArtifact => ({
  id: "tokyo",
  scopeLabel: "Tokyo",
  completedAt: "2026-08-26T00:00:00.000Z",
  sources: [{ title: "Official", authority: "Tokyo", url: "https://example.com/place#visit", retrievedAt: "2026-08-26T00:00:00.000Z", official: true, status: "verified" }],
  places: [
    { id: "a", externalIdentity: "official:a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "sight", whyWorthIt: "A matters", plan: "Visit A", sourceUrls: ["https://example.com/place"] },
    { id: "b", name: "B", locationLabel: "Tokyo", city: "Tokyo", category: "sight", whyWorthIt: "B matters", plan: "Visit B" },
    { id: "a-copy", externalIdentity: "official:a", name: "A duplicate", locationLabel: "Tokyo", city: "Tokyo", category: "sight", whyWorthIt: "Duplicate", plan: "Duplicate" }
  ],
  events: []
});

test("Skill Importer performs safe normalization and only merges confirmed identities", () => {
  const research = importSkillResearchBatches([batch()], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  assert.equal(research.places.length, 2);
  assert.equal(research.sources[0]?.url, "https://example.com/place");
  assert.equal(research.places[0]?.evidence[0]?.sourceId, research.sources[0]?.id);
});

test("Skill Importer preserves every Research Set place in the Trip Blueprint", () => {
  const research = importSkillResearchBatches([{ ...batch(), places: batch().places.slice(0, 2) }], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const [a, b] = research.places.map((place) => place.id);
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: a!, order: 1 }], candidatePlaceIds: [b!] }], movements: []
  }, { blueprintId: "blueprint-1", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.places.map((place) => place.id), research.places.map((place) => place.id));
});

test("Skill Importer adds a reasonableness pass for candidates and unverified movements", () => {
  const value = batch();
  value.places = [
    { id: "a", name: "Museum A", locationLabel: "Tokyo", city: "Tokyo", category: "museum", coordinates: [35.6812, 139.7671], whyWorthIt: "A strong anchor", plan: "Visit the main collection" },
    { id: "b", name: "Garden B", locationLabel: "Tokyo", city: "Tokyo", category: "garden", coordinates: [35.6852, 139.7528], whyWorthIt: "A calm second stop", plan: "Walk the garden loop" },
    { id: "c", name: "Cafe C", locationLabel: "Tokyo", city: "Tokyo", category: "coffee", coordinates: [35.684, 139.76], whyWorthIt: "Useful for a mid-day pause", plan: "Use as a flexible coffee break" }
  ];
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const [a, b, c] = research.places.map((place) => place.id);
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: a!, order: 1 }, { placeId: b!, order: 2 }], candidatePlaceIds: [] }],
    movements: []
  }, { blueprintId: "blueprint-1", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.equal(blueprint.days[0]?.candidatePlaceIds.includes(c!), true);
  assert.match(blueprint.days[0]?.summary ?? "", /meal, café, rainy-day, or low-energy swaps/);
  assert.equal(blueprint.movements.length, 1);
  assert.equal(blueprint.movements[0]?.status, "recheck");
  assert.equal(typeof blueprint.movements[0]?.durationMinutes, "number");
  assert.match(blueprint.movements[0]?.detail ?? "", /conservative planning estimate/);
});

test("Skill Importer keeps an orphan HTTPS source reference as a local recheck gap", () => {
  const value = batch();
  value.places[0]!.sourceUrls = ["https://unknown.example/place"];
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const source = research.sources.find((item) => item.url === "https://unknown.example/place");
  assert.equal(source?.status, "recheck");
  assert.equal(research.places[0]?.evidence.some((item) => item.sourceId === source?.id), true);
});
