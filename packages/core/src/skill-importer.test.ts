import assert from "node:assert/strict";
import test from "node:test";

import { compileTripBlueprint } from "./blueprint-plan-compiler.js";
import { blueprintPresentation } from "./index.js";
import { importSkillItinerary, importSkillResearchBatches, mergeResearchSetCheckpoint, type SkillResearchBatchArtifact } from "./skill-importer.js";

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

test("Skill Importer normalizes reversed coordinates before Research Set integrity checks", () => {
  const value = batch();
  value.relationships = [];
  value.places = [
    {
      id: "ubud-palace",
      name: "Ubud Palace",
      locationLabel: "Jl. Raya Ubud No.8, Ubud, Bali",
      city: "Bali",
      area: "Ubud",
      category: "sight",
      coordinates: [115.2625, -8.5069],
      whyWorthIt: "A central Ubud cultural anchor.",
      plan: "Visit around the palace and nearby market.",
      schedulingEligibility: { decision: "schedulable", reason: "Works as an Ubud day anchor." }
    },
    {
      id: "broken-map-point",
      name: "Broken map point",
      locationLabel: "Bali",
      city: "Bali",
      category: "context",
      coordinates: [300, 400],
      whyWorthIt: "Useful context once its exact location is confirmed.",
      plan: "Keep as written context until mapped.",
      schedulingEligibility: { decision: "schedulable", reason: "Incoming source claimed this was schedulable." }
    }
  ];
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-bali-coordinates",
    generationKey: "generation-bali-coordinates",
    proposalRef: { sessionId: "session-bali-coordinates", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const palace = research.places.find((place) => place.name === "Ubud Palace");
  const broken = research.places.find((place) => place.name === "Broken map point");
  assert.deepEqual(palace?.coordinates, [-8.5069, 115.2625]);
  assert.equal(palace?.schedulingEligibility?.decision, "schedulable");
  assert.equal(broken?.coordinates, undefined);
  assert.equal(broken?.schedulingEligibility?.decision, "informational");
});

test("Skill Importer keeps sourced place images and strips unsafe image entries", () => {
  const value = batch();
  value.relationships = [];
  value.places = [{
    id: "ubud-palace",
    name: "Ubud Palace",
    locationLabel: "Jl. Raya Ubud No.8, Ubud, Bali",
    city: "Bali",
    area: "Ubud",
    category: "sight",
    whyWorthIt: "A central Ubud cultural anchor.",
    plan: "Visit around the palace and nearby market.",
    sourceUrls: ["https://example.com/place"],
    images: [
      { url: "https://example.com/palace.jpg#hero", alt: "Ubud Palace courtyard", caption: "Palace courtyard", sourceUrl: "https://example.com/place#visit", usage: ["detail"], status: "verified" },
      { url: "http://example.com/insecure.jpg", alt: "Insecure photo", sourceUrl: "https://example.com/place" },
      { url: "https://example.com/no-source.jpg", alt: "No known source" }
    ]
  }];

  const research = importSkillResearchBatches([value], {
    researchSetId: "research-bali-images",
    generationKey: "generation-bali-images",
    proposalRef: { sessionId: "session-bali-images", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });

  assert.deepEqual(research.places[0]?.images, [{
    url: "https://example.com/palace.jpg",
    alt: "Ubud Palace courtyard",
    sourceId: research.sources[0]?.id,
    caption: "Palace courtyard",
    usage: ["detail"],
    status: "verified"
  }]);
});

test("Skill Importer drops optional operational facts whose evidence is removed during source remapping", () => {
  const value = batch();
  value.relationships = [];
  value.sources = [
    { id: "official", title: "Official", authority: "Venue", url: "https://example.com/place", retrievedAt: "2026-08-26T00:00:00.000Z", official: true, status: "verified" }
  ];
  value.places = [{
    id: "feira",
    name: "Feira da Ladra",
    locationLabel: "Lisbon",
    city: "Lisbon",
    category: "market",
    whyWorthIt: "A flea-market stop near Alfama.",
    plan: "Use as optional day-completion intelligence.",
    sourceUrls: ["https://example.com/place"],
    operationalFacts: {
      access: {
        windows: [
          { opensAt: "09:00", closesAt: "18:00", status: "verified", evidence: [{ sourceId: "official", status: "verified", supports: ["official hours 09:00-18:00"] }] },
          { opensAt: "10:00", closesAt: "17:00", status: "verified", evidence: [{ sourceId: "missing-source", status: "verified", supports: ["directory hours 10:00-17:00"] }] }
        ]
      }
    }
  }];

  const research = importSkillResearchBatches([value], {
    researchSetId: "research-lisbon-completion",
    generationKey: "generation-lisbon-completion",
    proposalRef: { sessionId: "session-lisbon-completion", proposalVersion: 1 },
    skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });

  assert.equal(research.places[0]?.operationalFacts?.access?.windows?.length, 1);
  assert.equal(research.places[0]?.operationalFacts?.access?.windows?.[0]?.opensAt, "09:00");
  assert.equal(research.places[0]?.operationalFacts?.access?.windows?.[0]?.evidence[0]?.sourceId, research.sources[0]?.id);
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

test("Skill Importer preserves explicit empty day blocks through compilation and presentation", () => {
  const research = importSkillResearchBatches([{ ...batch(), places: batch().places.slice(0, 2) }], {
    researchSetId: "research-empty-blocks", generationKey: "generation-empty-blocks", proposalRef: { sessionId: "session-empty-blocks", proposalVersion: 1 },
    skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const [a, b] = research.places.map((place) => place.id);
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Open day", summary: "Keep the formal timeline empty.", stops: [{ placeId: a!, order: 1 }], blocks: [], candidatePlaceIds: [b!] }],
    movements: []
  }, { blueprintId: "blueprint-empty-blocks", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  const compiled = compileTripBlueprint(blueprint, { createdAt: "2026-08-26T01:05:00.000Z" });
  const presentation = blueprintPresentation(blueprint);

  assert.deepEqual(blueprint.days[0]?.blocks, []);
  assert.equal(compiled.plan.title, "Tokyo");
  assert.deepEqual(presentation.days[0]?.blocks, []);
  assert.deepEqual(presentation.days[0]?.stops?.map((stop) => stop.placeId), [a!]);
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
  assert.deepEqual(blueprint.movements[0]?.display, {
    routeLabel: "Walk to Garden B",
    refreshReason: "Refresh this route leg after itinerary verification.",
    refreshScope: { dayId: "d1", originPlaceId: a!, destinationPlaceId: b!, reason: "unverified_route" },
    showAsFormalRoute: true,
    mapLineState: "needs_refresh"
  });
});

test("Skill Importer preserves movement display intent into the Trip Blueprint", () => {
  const research = importSkillResearchBatches([{ ...batch(), places: batch().places.slice(0, 2) }], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const [a, b] = research.places.map((place) => place.id);
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: a!, order: 1 }, { placeId: b!, order: 2 }], candidatePlaceIds: [] }],
    movements: [{
      id: "a-b",
      dayId: "d1",
      originPlaceId: a!,
      destinationPlaceId: b!,
      mode: "walking",
      status: "recheck",
      label: "  Old label  ",
      detail: "  Old detail  ",
      display: {
        routeLabel: "  Reviewed lane walk  ",
        refreshReason: "  Refresh after direct edits.  ",
        refreshScope: { dayId: " d1 ", originPlaceId: ` ${a!} `, destinationPlaceId: ` ${b!} `, reason: "direct_itinerary_edit" },
        showAsFormalRoute: true,
        mapLineState: "needs_refresh"
      },
      evidence: []
    }]
  }, { blueprintId: "blueprint-1", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.movements[0]?.display, {
    routeLabel: "Reviewed lane walk",
    refreshReason: "Refresh after direct edits.",
    refreshScope: { dayId: "d1", originPlaceId: a!, destinationPlaceId: b!, reason: "direct_itinerary_edit" },
    showAsFormalRoute: true,
    mapLineState: "needs_refresh"
  });
});

test("Skill Importer removes refresh intent from verified movements", () => {
  const research = importSkillResearchBatches([{ ...batch(), places: batch().places.slice(0, 2) }], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const [a, b] = research.places.map((place) => place.id);
  const sourceId = research.sources[0]!.id;
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: a!, order: 1 }, { placeId: b!, order: 2 }], candidatePlaceIds: [] }],
    movements: [{
      id: "a-b",
      dayId: "d1",
      originPlaceId: a!,
      destinationPlaceId: b!,
      mode: "walking",
      status: "verified",
      label: "Verified lane walk",
      detail: "Verified detail.",
      display: {
        routeLabel: "Verified lane walk",
        refreshReason: "This should not leak into Web.",
        refreshScope: { dayId: "d1", originPlaceId: a!, destinationPlaceId: b!, reason: "direct_itinerary_edit" },
        showAsFormalRoute: true,
        mapLineState: "needs_refresh"
      },
      evidence: [{ sourceId, status: "verified", supports: ["route duration"] }]
    }]
  }, { blueprintId: "blueprint-1", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.equal(blueprint.movements[0]?.status, "verified");
  assert.deepEqual(blueprint.movements[0]?.display, {
    routeLabel: "Verified lane walk",
    showAsFormalRoute: true,
    mapLineState: "formal"
  });
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

test("Skill Importer keeps explicit empty Blueprint guidance authoritative", () => {
  const value = batch();
  value.places = [
    { id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "sight", whyWorthIt: "A matters", plan: "Visit A", tip: "Temple etiquette: keep voices low near worship halls." }
  ];
  value.relationships = [];
  value.actionRequirements = [{
    id: "passport",
    kind: "travel_authorization",
    title: "Check passport",
    description: "Confirm passport validity for entry.",
    accountableParty: "traveler",
    completionCondition: "Passport is confirmed."
  }];
  value.travelTips = [];
  value.preparationChecklist = [];
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  assert.deepEqual(research.travelTips, []);
  assert.deepEqual(research.preparationChecklist, []);

  const blueprint = importSkillItinerary(research, {
    title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: research.places[0]!.id, order: 1 }], candidatePlaceIds: [] }],
    movements: []
  }, { blueprintId: "blueprint-1", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.travelTips, []);
  assert.deepEqual(blueprint.preparationChecklist, []);
});

test("Skill Importer keeps canonical guidance source-backed and remaps checklist requirements", () => {
  const value = batch();
  value.places = batch().places.slice(0, 1);
  value.relationships = [];
  value.travelTips = [{
    id: "cash",
    title: "Carry cash",
    body: "Small local shops may prefer cash around temple markets.",
    theme: "payment",
    context: "Tokyo temple markets",
    placeId: "a",
    sourceUrls: ["https://example.com/place#visit"]
  }];
  value.actionRequirements = [{
    id: "reserve-a",
    kind: "reservation",
    title: "Reserve A",
    description: "Confirm the entry slot.",
    accountableParty: "traveler",
    completionCondition: "Entry slot is confirmed.",
    placeId: "a",
    sourceUrls: ["https://example.com/place#visit"]
  }];
  value.preparationChecklist = [{
    id: "prep-reserve-a",
    title: "Reserve A",
    description: "Use the official booking page.",
    group: "bookings_departure",
    completionCondition: "Entry slot is confirmed.",
    requirementId: "reserve-a",
    placeId: "a",
    sourceUrls: ["https://example.com/place#visit"]
  }];
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  assert.equal(research.travelTips?.[0]?.evidence[0]?.status, "recheck");
  assert.equal(research.preparationChecklist?.[0]?.requirementId, research.actionRequirements[0]?.id);
  assert.equal(research.preparationChecklist?.[0]?.evidence[0]?.status, "recheck");
});

test("Skill Importer rejects canonical guidance that references unknown structure", () => {
  assert.throws(() => importSkillResearchBatches([{ ...batch(), travelTips: [{ id: "bad", title: "Bad", body: "Carry cash near local temple markets.", theme: "payment", context: "Tokyo", placeId: "missing" }] }], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  }), /unknown place/);
  assert.throws(() => importSkillResearchBatches([{ ...batch(), preparationChecklist: [{ id: "bad", title: "Bad", group: "documents", completionCondition: "Done.", requirementId: "missing" }] }], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  }), /unknown action requirement/);
});

test("Skill Importer merge preserves explicit empty Blueprint guidance fields", () => {
  const current = importSkillResearchBatches([{ ...batch(), travelTips: [], preparationChecklist: [] }], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const incoming = importSkillResearchBatches([{ ...batch(), id: "tokyo-follow-up" }], {
    researchSetId: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T01:00:00.000Z"
  });
  const merged = mergeResearchSetCheckpoint(current, incoming, { status: "completed", updatedAt: "2026-08-26T02:00:00.000Z" });
  assert.deepEqual(merged.travelTips, []);
  assert.deepEqual(merged.preparationChecklist, []);
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
      display: { type: "experience", markerKind: "experience", workspaceSignals: { reservation: "recommended", needsRecheck: false, longStop: false, itineraryStatusLabel: "  Bookable tea slot  " } },
      guideDisplay: {
        showInGuide: true,
        state: "unscheduled",
        cardSummary: "Bookable tea practice with clear etiquette.",
        tags: ["90 min", "Small group"],
        primaryActionLabel: "  Add this tea stop  ",
        addActionLabel: "  Add tea  ",
        addBlockedLabel: "  Needs route redesign  ",
        scheduledActionLabel: "  Open scheduled tea stop  ",
        informationalActionLabel: "  Read tea background  ",
        blockedActionLabel: "  Ask Landi to rework tea  ",
        detailLeadTitle: "Why this tea stop fits",
        detailPlanTitle: "How to use it",
        detailSourceTitle: "  Tea sources  ",
        comparisonTitle: "Compare cultural options",
        comparisonRows: [{
          id: "row-pottery",
          name: "Nearby pottery workshop",
          area: "Gion",
          routeFit: "Same neighborhood",
          timing: "Afternoon",
          effort: "Requires a separate booking check",
          sourceState: "Needs recheck",
          sourceUrls: ["https://example.com/place#hours"]
        }]
      },
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
    events: [],
    localFoods: [{
      id: "wagashi",
      title: "Seasonal wagashi",
      description: "Small seasonal sweets that explain part of the tea-room rhythm.",
      context: "Gion tea stops",
      diningPlaceIds: ["tea"],
      sourceUrls: ["https://example.com/place#hours"]
    }],
    localProducts: [{
      id: "tea-tools",
      title: "Tea utensils",
      description: "Small utensils or sweets work better as light purchases than bulky souvenirs.",
      context: "Gion shops",
      purchasePlaceIds: ["tea"],
      sourceUrls: ["https://example.com/place#hours"]
    }],
    experienceThemes: [{
      id: "tea-practice",
      title: "Tea practice",
      description: "A guided tea session should be represented by a concrete provider, not only the theme.",
      context: "Kyoto culture afternoon",
      offeringPlaceIds: ["tea"],
      sourceUrls: ["https://example.com/place#hours"]
    }],
    travelTips: [{
      id: "quiet",
      title: "Tea-room etiquette",
      body: "Tea-room etiquette is quiet and shoes may need to be removed before entry.",
      theme: "etiquette",
      context: "Gion tea rooms",
      placeId: "tea",
      sourceUrls: ["https://example.com/place#hours"]
    }],
    actionRequirements: [{
      id: "pay-tea",
      kind: "preparation",
      title: "Set up a payment method for the tea session",
      description: "Confirm that the card or cash method accepted by the tea studio is ready.",
      accountableParty: "traveler",
      completionCondition: "Payment method is ready before the booked session.",
      placeId: "tea",
      sourceUrls: ["https://example.com/place#hours"]
    }]
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
  assert.deepEqual(place.display, { type: "experience", markerKind: "experience", workspaceSignals: { reservation: "recommended", needsRecheck: false, longStop: false, itineraryStatusLabel: "Bookable tea slot" } });
  assert.deepEqual(place.guideDisplay, {
    showInGuide: true,
    state: "unscheduled",
    cardSummary: "Bookable tea practice with clear etiquette.",
    tags: ["90 min", "Small group"],
    primaryActionLabel: "Add this tea stop",
    addActionLabel: "Add tea",
    addBlockedLabel: "Needs route redesign",
    scheduledActionLabel: "Open scheduled tea stop",
    informationalActionLabel: "Read tea background",
    blockedActionLabel: "Ask Landi to rework tea",
    detailLeadTitle: "Why this tea stop fits",
    detailPlanTitle: "How to use it",
    detailSourceTitle: "Tea sources",
    comparisonTitle: "Compare cultural options",
    comparisonRows: [{
      id: "row-pottery",
      name: "Nearby pottery workshop",
      area: "Gion",
      routeFit: "Same neighborhood",
      timing: "Afternoon",
      effort: "Requires a separate booking check",
      sourceState: "Needs recheck",
      evidence: [{ sourceId: research.sources[0]!.id, status: "recheck" }]
    }]
  });
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
  assert.equal(research.localFoods?.[0]?.diningPlaceIds[0], place.id);
  assert.equal(research.localProducts?.[0]?.purchasePlaceIds[0], place.id);
  assert.equal(research.experienceThemes?.[0]?.offeringPlaceIds[0], place.id);
  assert.equal(research.travelTips?.[0]?.title, "Tea-room etiquette");
  assert.equal(research.travelTips?.[0]?.placeId, place.id);
  assert.equal(research.preparationChecklist?.[0]?.title, "Set up a payment method for the tea session");
  assert.equal(research.preparationChecklist?.[0]?.group, "phone_payments");
  assert.equal(research.preparationChecklist?.[0]?.requirementId, research.actionRequirements[0]?.id);

  const blueprint = importSkillItinerary(research, {
    title: "Kyoto",
    summary: "Kyoto tea route.",
    language: "en",
    destinations: ["Kyoto"],
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    days: [{
      id: "d1",
      date: "2026-10-01",
      kind: "scheduled",
      city: "Kyoto",
      title: "Tea day",
      summary: "Keep this as a compact culture day.",
      stops: [{ placeId: place.id, order: 1, role: "afternoon flexible" }],
      blocks: [{
        id: "block-tea",
        kind: "flexible",
        order: 3,
        placeId: place.id,
        display: { timeLabel: "  Tea-room window  ", meta: "  Only if the afternoon stays relaxed  ", routeAnchor: false, reorderable: false },
        evidence: []
      }],
      candidatePlaceIds: []
    }],
    movements: []
  }, { blueprintId: "blueprint-kyoto", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.places[0]?.display, place.display);
  assert.deepEqual(blueprint.places[0]?.guideDisplay, place.guideDisplay);
  assert.deepEqual(blueprint.places[0]?.evidence, place.evidence);
  assert.equal(blueprint.places[0]?.schedulingEligibility?.decision, "schedulable");
  assert.deepEqual(blueprint.places[0]?.schedulingEligibility?.suitableDayIds, ["d1"]);
  assert.deepEqual(blueprint.moduleIdentity?.enabledModules.map((module) => module.id), ["itinerary", "preparation", "tips", "sources"]);
  assert.equal(blueprint.guideTheme?.visitorMode, "balanced-visitor");
  assert.deepEqual(blueprint.days[0]?.blocks?.map((block) => ({ kind: block.kind, order: block.order, placeId: block.placeId, display: block.display })), [{
    kind: "flexible",
    order: 1,
    placeId: place.id,
    display: { timeLabel: "Tea-room window", meta: "Only if the afternoon stays relaxed", routeAnchor: false, reorderable: false }
  }]);
  assert.equal(blueprint.localFoods?.[0]?.title, "Seasonal wagashi");
  assert.equal(blueprint.localProducts?.[0]?.title, "Tea utensils");
  assert.equal(blueprint.experienceThemes?.[0]?.title, "Tea practice");
  assert.equal(blueprint.travelTips?.[0]?.body, "Tea-room etiquette is quiet and shoes may need to be removed before entry.");
  assert.equal(blueprint.preparationChecklist?.[0]?.group, "phone_payments");
});

test("Skill Importer remaps guide display references before Web display inference", () => {
  const value: SkillResearchBatchArtifact = {
    ...batch(),
    relationships: [],
    places: [
      {
        id: "tea",
        name: "Tea Studio",
        locationLabel: "Kyoto",
        city: "Kyoto",
        category: "tea ceremony experience",
        whyWorthIt: "A quiet tea session.",
        plan: "Use as an afternoon cultural stop.",
        guideDisplay: {
          showInGuide: true,
          comparisonRows: [
            { id: "row-later", relatedPlaceId: "lunch", area: "Gion", routeFit: "Same neighborhood", timing: "Afternoon", effort: "Easy pairing", sourceState: "Needs recheck", sourceUrls: ["https://example.com/place"] },
            { id: "row-self", relatedPlaceId: "tea", name: "General tea context", area: "Gion", routeFit: "Background", timing: "Anytime", effort: "No route change", sourceState: "Needs recheck" },
            { id: "row-missing", relatedPlaceId: "missing", area: "Gion", routeFit: "Unknown", timing: "Unknown", effort: "Unknown", sourceState: "Needs recheck" }
          ]
        }
      },
      {
        id: "lunch",
        name: "Lunch Stop",
        locationLabel: "Kyoto",
        city: "Kyoto",
        category: "restaurant",
        whyWorthIt: "A practical lunch break.",
        plan: "Eat after the tea studio."
      }
    ]
  };
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-guide-refs",
    generationKey: "generation-guide-refs",
    proposalRef: { sessionId: "session-guide-refs", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const [tea, lunch] = research.places;
  const source = research.sources[0];
  const firstRow = tea?.guideDisplay?.comparisonRows?.[0];
  const firstEvidence = firstRow?.evidence?.[0];
  assert.ok(source);
  assert.ok(firstRow);
  assert.ok(firstEvidence);
  assert.equal(firstRow.relatedPlaceId, lunch?.id);
  assert.equal(firstEvidence.sourceId, source.id);
  assert.deepEqual(tea?.guideDisplay?.comparisonRows?.map((row) => [row.id, row.relatedPlaceId, row.name]), [
    ["row-later", lunch?.id, undefined],
    ["row-self", undefined, "General tea context"]
  ]);
});

test("Skill Importer filters itinerary-scoped scheduling refs without changing evidence status", () => {
  const value: SkillResearchBatchArtifact = {
    ...batch(),
    sources: [{ id: "official", title: "Official", authority: "Kyoto", url: "https://example.com/place", retrievedAt: "2026-08-26", status: "verified", official: true }],
    places: [
      {
        id: "a",
        name: "A",
        locationLabel: "Kyoto",
        city: "Kyoto",
        category: "museum",
        coordinates: [35.0, 135.0],
        whyWorthIt: "A matters.",
        plan: "Visit A.",
        fieldEvidence: [{ path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "official", status: "stale", supports: ["place value"] }] }],
        schedulingEligibility: {
          decision: "schedulable",
          reason: "Fits one Kyoto day.",
          suitableDayIds: ["d1", "missing-day", "d1"],
          blockedDayIds: ["old-day"],
          evidence: [{ sourceId: "official", status: "stale", supports: ["opening window"] }]
        }
      },
      { id: "b", name: "B", locationLabel: "Kyoto", city: "Kyoto", category: "garden", coordinates: [35.001, 135.001], whyWorthIt: "B matters.", plan: "Visit B." }
    ]
  };
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-scheduling",
    generationKey: "generation-scheduling",
    proposalRef: { sessionId: "session-scheduling", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  assert.equal(research.places[0]?.schedulingEligibility?.evidence?.[0]?.sourceId, research.sources[0]?.id);
  assert.equal(research.places[0]?.schedulingEligibility?.evidence?.[0]?.status, "stale");
  assert.deepEqual(research.places[0]?.fieldEvidence, [{ path: "whyWorthIt", status: "recheck", evidence: [{ sourceId: research.sources[0]!.id, status: "stale", supports: ["place value"] }] }]);
  const [a, b] = research.places.map((place) => place.id);
  const blueprint = importSkillItinerary(research, {
    title: "Kyoto",
    summary: "Kyoto route.",
    language: "en",
    destinations: ["Kyoto"],
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    days: [{ id: "d1", date: "2026-10-01", kind: "scheduled", city: "Kyoto", title: "Day", summary: "Flow", stops: [{ placeId: a!, order: 1 }], candidatePlaceIds: [b!] }],
    movements: []
  }, { blueprintId: "blueprint-scheduling", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.places[0]?.schedulingEligibility?.suitableDayIds, ["d1"]);
  assert.equal(blueprint.places[0]?.schedulingEligibility?.blockedDayIds, undefined);
  assert.deepEqual(blueprint.places[0]?.schedulingEligibility?.evidence, [{ sourceId: research.sources[0]!.id, status: "stale", supports: ["opening window"] }]);
});

test("Skill Importer resolves batch-scoped source aliases before integrity checks", () => {
  const value: SkillResearchBatchArtifact = {
    id: "scope-1",
    scopeLabel: "Bali",
    completedAt: "2026-09-09T00:00:00.000Z",
    sources: [
      { id: "src-tirta-empul", title: "Tirta Empul", authority: "Official tourism", url: "https://example.com/tirta-empul", retrievedAt: "2026-09-09", status: "verified", official: true },
      { id: "scope-1-src-tanah-lot", title: "Tanah Lot", authority: "Official tourism", url: "https://example.com/tanah-lot", retrievedAt: "2026-09-09", status: "verified", official: true }
    ],
    places: [
      {
        id: "pl-tirta-empul",
        name: "Tirta Empul",
        locationLabel: "Tampaksiring, Bali",
        city: "Bali",
        category: "temple",
        coordinates: [-8.4156, 115.3156],
        whyWorthIt: "A water temple that anchors the cultural landscape day.",
        plan: "Visit respectfully before the rice terrace stop.",
        fieldEvidence: [{ path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "scope-1-src-tirta-empul", status: "verified" }] }]
      },
      {
        id: "pl-tanah-lot",
        name: "Tanah Lot",
        locationLabel: "Beraban, Bali",
        city: "Bali",
        category: "temple",
        coordinates: [-8.6212, 115.0868],
        whyWorthIt: "A coastal temple that can anchor a sunset day.",
        plan: "Keep it for a west-coast route.",
        tip: "Check tide and crowd timing near the date.",
        fieldEvidence: [
          { path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "scope-1-src-tanah-lot", status: "verified" }] },
          { path: "tip", status: "verified", evidence: [{ sourceId: "src-tanah-lot", status: "verified" }] }
        ],
        schedulingEligibility: { decision: "schedulable", reason: "Works as a west Bali sunset route.", evidence: [{ sourceId: "scope-1-src-tanah-lot", status: "verified" }] }
      }
    ],
    events: [],
    relationships: []
  };

  const research = importSkillResearchBatches([value], {
    researchSetId: "research-bali-source-aliases",
    generationKey: "generation-bali-source-aliases",
    proposalRef: { sessionId: "session-bali-source-aliases", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z"
  });
  const sourceIds = new Set(research.sources.map((source) => source.id));
  for (const place of research.places) {
    for (const item of place.fieldEvidence ?? []) {
      for (const ref of item.evidence) assert.equal(sourceIds.has(ref.sourceId), true);
    }
    for (const ref of place.schedulingEligibility?.evidence ?? []) assert.equal(sourceIds.has(ref.sourceId), true);
  }
});

test("Skill Importer drops unresolved field evidence refs instead of failing research import", () => {
  const value = batch();
  value.relationships = [];
  value.sources = [];
  value.places = [{
    id: "place-with-stale-claim",
    name: "Place with stale claim",
    locationLabel: "Bali",
    city: "Bali",
    category: "context",
    whyWorthIt: "Useful only after source review.",
    plan: "Keep the place but do not treat the unsupported claim as verified.",
    fieldEvidence: [{ path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "scope-1-src-missing", status: "verified" }] }]
  }];

  const research = importSkillResearchBatches([value], {
    researchSetId: "research-unresolved-source",
    generationKey: "generation-unresolved-source",
    proposalRef: { sessionId: "session-unresolved-source", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z"
  });
  assert.deepEqual(research.places[0]?.fieldEvidence, [{ path: "whyWorthIt", status: "recheck", evidence: [] }]);
});

test("Skill Importer merge canonicalizes duplicate source identities and remaps field evidence", () => {
  const currentBatch = batch();
  currentBatch.id = "scope-1";
  currentBatch.scopeLabel = "Porto";
  currentBatch.sources = [
    { id: "src-ribeira-commons", title: "Ribeira official", authority: "Porto", url: "https://example.com/ribeira", retrievedAt: "2026-09-09", status: "verified", official: true },
    { id: "src-alfama", title: "Alfama official", authority: "Lisbon", url: "https://example.com/alfama", retrievedAt: "2026-09-09", status: "verified", official: true }
  ];
  currentBatch.places = [{
    id: "porto-ribeira",
    name: "Ribeira",
    locationLabel: "Porto",
    city: "Porto",
    category: "riverfront",
    whyWorthIt: "A useful riverfront anchor.",
    plan: "Walk the riverfront.",
    sourceUrls: ["https://example.com/ribeira"]
  }];
  currentBatch.relationships = [];

  const current = importSkillResearchBatches([currentBatch], {
    researchSetId: "research-portugal-merge",
    generationKey: "generation-portugal-merge",
    proposalRef: { sessionId: "session-portugal-merge", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z"
  });

  const incomingBatch = batch();
  incomingBatch.id = "scope-3";
  incomingBatch.scopeLabel = "Portugal";
  incomingBatch.sources = [
    { id: "src-ribeira-commons", title: "Ribeira duplicate id", authority: "Porto", url: "https://example.com/ribeira-duplicate", retrievedAt: "2026-09-10", status: "verified", official: true },
    { id: "src-alfama-d67t19", title: "Alfama duplicate URL", authority: "Lisbon", url: "https://example.com/alfama", retrievedAt: "2026-09-10", status: "verified", official: true },
    { id: "src-serralves-jtx164", title: "Serralves official", authority: "Porto", url: "https://example.com/serralves", retrievedAt: "2026-09-10", status: "verified", official: true },
    { id: "src-cp-online-2734w4", title: "CP official", authority: "CP", url: "https://example.com/cp", retrievedAt: "2026-09-10", status: "verified", official: true }
  ];
  incomingBatch.places = [
    {
      id: "lis-alfama",
      name: "Alfama",
      locationLabel: "Lisbon",
      city: "Lisbon",
      category: "neighborhood",
      whyWorthIt: "A historic neighborhood for route texture.",
      plan: "Use it as a Lisbon context candidate.",
      tip: "Keep the route compact.",
      images: [{ url: "https://example.com/alfama.jpg", alt: "Alfama street", sourceUrl: "https://example.com/alfama", status: "verified" }],
      schedulingEligibility: { decision: "schedulable", reason: "Fits after arrival by train.", evidence: [{ sourceId: "scope-3-src-cp-online-2734w4", status: "verified" }] },
      fieldEvidence: [
        { path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "scope-3-src-alfama-d67t19", status: "verified" }, { sourceId: "missing-source", status: "verified" }] },
        { path: "tip", status: "verified", evidence: [{ sourceId: "src-alfama-d67t19", status: "verified" }] }
      ]
    },
    {
      id: "porto-serralves",
      name: "Serralves",
      locationLabel: "Porto",
      city: "Porto",
      category: "museum",
      whyWorthIt: "A strong art and garden anchor.",
      plan: "Pair with a Porto day.",
      tip: "Check garden time.",
      images: [{ url: "https://example.com/serralves.jpg", alt: "Serralves garden", sourceUrl: "https://example.com/serralves", status: "verified" }],
      fieldEvidence: [
        { path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "scope-3-src-serralves-jtx164", status: "verified" }] },
        { path: "tip", status: "verified", evidence: [{ sourceId: "src-serralves-jtx164", status: "verified" }] },
        { path: "detailSections", status: "verified", evidence: [{ sourceId: "unsupported-source", status: "verified" }] }
      ]
    }
  ];
  incomingBatch.relationships = [];

  const incoming = importSkillResearchBatches([incomingBatch], {
    researchSetId: current.id,
    generationKey: current.generationKey,
    proposalRef: current.proposalRef,
    skillLineage: current.skillLineage,
    createdAt: current.createdAt,
    updatedAt: "2026-09-10T00:00:00.000Z"
  });
  const merged = mergeResearchSetCheckpoint(current, incoming, { status: "completed", updatedAt: "2026-09-10T00:00:00.000Z" });
  const sourceIds = merged.sources.map((source) => source.id);
  assert.equal(sourceIds.length, new Set(sourceIds).size);
  const alfamaSource = current.sources.find((source) => source.url === "https://example.com/alfama");
  const serralvesSource = merged.sources.find((source) => source.url === "https://example.com/serralves");
  const cpSource = merged.sources.find((source) => source.url === "https://example.com/cp");
  assert.ok(alfamaSource);
  assert.ok(serralvesSource);
  assert.ok(cpSource);
  const alfama = merged.places.find((place) => place.name === "Alfama");
  const serralves = merged.places.find((place) => place.name === "Serralves");
  assert.deepEqual(alfama?.fieldEvidence?.map((item) => [item.path, item.status, item.evidence.map((ref) => ref.sourceId)]), [
    ["whyWorthIt", "verified", [alfamaSource.id]],
    ["tip", "verified", [alfamaSource.id]]
  ]);
  assert.deepEqual(serralves?.fieldEvidence?.map((item) => [item.path, item.status, item.evidence.map((ref) => ref.sourceId)]), [
    ["whyWorthIt", "verified", [serralvesSource.id]],
    ["tip", "verified", [serralvesSource.id]],
    ["detailSections", "recheck", []]
  ]);
  assert.deepEqual(alfama?.images?.map((image) => image.sourceId), [alfamaSource.id]);
  assert.deepEqual(alfama?.schedulingEligibility?.evidence?.map((ref) => ref.sourceId), [cpSource.id]);
  assert.deepEqual(serralves?.images?.map((image) => image.sourceId), [serralvesSource.id]);
});

test("Skill Importer refuses to keep a verified movement when route evidence is not verified", () => {
  const value = batch();
  value.places = [
    { id: "a", name: "Museum A", locationLabel: "Tokyo", city: "Tokyo", category: "museum", coordinates: [35.6812, 139.7671], whyWorthIt: "A strong anchor", plan: "Visit the main collection" },
    { id: "b", name: "Garden B", locationLabel: "Tokyo", city: "Tokyo", category: "garden", coordinates: [35.6852, 139.7528], whyWorthIt: "A calm second stop", plan: "Walk the garden loop" }
  ];
  const research = importSkillResearchBatches([value], {
    researchSetId: "research-route-evidence",
    generationKey: "generation-route-evidence",
    proposalRef: { sessionId: "session-route-evidence", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const [a, b] = research.places.map((place) => place.id);
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo",
    summary: "Tokyo route.",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: a!, order: 1 }, { placeId: b!, order: 2 }], candidatePlaceIds: [] }],
    movements: [{ id: "route-a-b", dayId: "d1", originPlaceId: a!, destinationPlaceId: b!, mode: "walking", status: "verified", durationMinutes: 12, evidence: [{ sourceId: research.sources[0]!.id, status: "stale", supports: ["route duration"] }] }]
  }, { blueprintId: "blueprint-route-evidence", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });

  assert.equal(blueprint.movements[0]?.status, "recheck");
  assert.deepEqual(blueprint.movements[0]?.evidence, [{ sourceId: research.sources[0]!.id, status: "stale", supports: ["route duration"] }]);
});
