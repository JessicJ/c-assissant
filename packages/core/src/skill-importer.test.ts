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
  events: [],
  relationships: [{ id: "a-to-b", kind: "same_area", fromPlaceId: "a", toPlaceId: "b", rationale: "A and B fit the same neighborhood route.", sourceUrls: ["https://example.com/place"] }]
});

test("Skill Importer performs safe normalization and only merges confirmed identities", () => {
  const research = importSkillResearchBatches([batch()], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  assert.equal(research.places.length, 2);
  assert.equal(research.sources[0]?.url, "https://example.com/place");
  assert.equal(research.places[0]?.evidence[0]?.sourceId, research.sources[0]?.id);
  assert.equal(research.guideRelationships?.[0]?.fromPlaceId, research.places[0]?.id);
  assert.equal(research.guideRelationships?.[0]?.toPlaceId, research.places[1]?.id);
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
  assert.equal(blueprint.guideRelationshipGraph?.relationships[0]?.kind, "same_area");
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

test("Skill Importer preserves Landi-native place presentation fields into the Trip Blueprint", () => {
  const value: SkillResearchBatchArtifact = {
    id: "kyoto",
    scopeLabel: "Kyoto",
    completedAt: "2026-08-26T00:00:00.000Z",
    sources: [{ id: "official", title: "Official place guide", authority: "Kyoto", url: "https://example.com/place#hours", retrievedAt: "2026-08-26", official: true, status: "verified" }],
    places: [{
      id: "tea",
      externalIdentity: "official:tea",
      name: "Tea Studio",
      localizedName: "茶室",
      locationLabel: "Gion, Kyoto",
      city: "Kyoto",
      area: "Gion",
      category: "tea ceremony experience",
      priority: "must",
      coordinates: [35.003, 135.778],
      display: { type: "experience", markerKind: "experience" },
      contentTier: "deep",
      visitRole: "afternoon flexible",
      durationMinutes: 90,
      whyWorthIt: "A concrete cultural experience with clear etiquette expectations.",
      plan: "Book a small-group session and leave buffer before dinner.",
      tip: "Tea-room etiquette is quiet and shoes may need to be removed before entry.",
      detailSections: [{ title: "Etiquette", body: "Arrive calmly.", items: ["Follow the host's seating guidance.", "Avoid loud conversation."] }],
      officialUrl: "https://example.com/place#official",
      bookingUrl: "https://example.com/book#slot",
      mapUrl: "https://example.com/map#pin",
      experienceUrl: "https://example.com/experience#details",
      sourceUrls: ["https://example.com/place#hours"]
    }],
    events: []
  };
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-kyoto",
    generationKey: "generation-kyoto",
    proposalRef: { sessionId: "session-kyoto", proposalVersion: 1 },
    skillLineage: { skillId: "landi-native-blueprint", skillVersion: "0.1.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const place = research.places[0]!;
  assert.equal(place.name, "Tea Studio");
  assert.equal(place.localizedName, "茶室");
  assert.equal(place.area, "Gion");
  assert.equal(place.category, "tea ceremony experience");
  assert.equal(place.priority, "must");
  assert.deepEqual(place.coordinates, [35.003, 135.778]);
  assert.deepEqual(place.display, { type: "experience", markerKind: "experience" });
  assert.equal(place.contentTier, "deep");
  assert.equal(place.visitRole, "afternoon flexible");
  assert.equal(place.durationMinutes, 90);
  assert.equal(place.tip, "Tea-room etiquette is quiet and shoes may need to be removed before entry.");
  assert.deepEqual(place.detailSections, [{ title: "Etiquette", body: "Arrive calmly.", items: ["Follow the host's seating guidance.", "Avoid loud conversation."] }]);
  assert.equal(place.officialUrl, "https://example.com/place");
  assert.equal(place.bookingUrl, "https://example.com/book");
  assert.equal(place.mapUrl, "https://example.com/map");
  assert.equal(place.experienceUrl, "https://example.com/experience");
  assert.equal(place.evidence[0]?.sourceId, research.sources[0]?.id);

  const blueprint = importSkillItinerary(research, {
    title: "Kyoto",
    summary: "Kyoto tea route.",
    language: "en",
    destinations: ["Kyoto"],
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    days: [{ id: "d1", date: "2026-10-01", kind: "scheduled", city: "Kyoto", title: "Tea day", summary: "Keep this as a compact culture day.", stops: [{ placeId: place.id, order: 1, role: "afternoon flexible" }], candidatePlaceIds: [] }],
    movements: []
  }, { blueprintId: "blueprint-kyoto", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.places[0]?.display, place.display);
  assert.deepEqual(blueprint.places[0]?.evidence, place.evidence);
  assert.equal(blueprint.places[0]?.schedulingEligibility?.decision, "schedulable");
  assert.deepEqual(blueprint.places[0]?.schedulingEligibility?.suitableDayIds, ["d1"]);
  assert.deepEqual(blueprint.moduleIdentity?.enabledModules.map((module) => module.id), ["itinerary", "preparation", "tips", "sources"]);
  assert.equal(blueprint.guideTheme?.visitorMode, "balanced-visitor");
  assert.deepEqual(blueprint.days[0]?.blocks?.map((block) => ({ kind: block.kind, placeId: block.placeId })), [{ kind: "flexible", placeId: place.id }]);
});
