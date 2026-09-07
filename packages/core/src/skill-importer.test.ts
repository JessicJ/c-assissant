import assert from "node:assert/strict";
import test from "node:test";

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
      display: { type: "experience", markerKind: "experience" },
      guideDisplay: {
        showInGuide: true,
        state: "unscheduled",
        cardSummary: "Bookable tea practice with clear etiquette.",
        tags: ["90 min", "Small group"],
        detailLeadTitle: "Why this tea stop fits",
        detailPlanTitle: "How to use it",
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
  assert.deepEqual(place.display, { type: "experience", markerKind: "experience" });
  assert.deepEqual(place.guideDisplay, {
    showInGuide: true,
    state: "unscheduled",
    cardSummary: "Bookable tea practice with clear etiquette.",
    tags: ["90 min", "Small group"],
    detailLeadTitle: "Why this tea stop fits",
    detailPlanTitle: "How to use it",
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
    days: [{ id: "d1", date: "2026-10-01", kind: "scheduled", city: "Kyoto", title: "Tea day", summary: "Keep this as a compact culture day.", stops: [{ placeId: place.id, order: 1, role: "afternoon flexible" }], candidatePlaceIds: [] }],
    movements: []
  }, { blueprintId: "blueprint-kyoto", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.places[0]?.display, place.display);
  assert.deepEqual(blueprint.places[0]?.guideDisplay, place.guideDisplay);
  assert.deepEqual(blueprint.places[0]?.evidence, place.evidence);
  assert.equal(blueprint.places[0]?.schedulingEligibility?.decision, "schedulable");
  assert.deepEqual(blueprint.places[0]?.schedulingEligibility?.suitableDayIds, ["d1"]);
  assert.deepEqual(blueprint.moduleIdentity?.enabledModules.map((module) => module.id), ["itinerary", "preparation", "tips", "sources"]);
  assert.equal(blueprint.guideTheme?.visitorMode, "balanced-visitor");
  assert.deepEqual(blueprint.days[0]?.blocks?.map((block) => ({ kind: block.kind, placeId: block.placeId })), [{ kind: "flexible", placeId: place.id }]);
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
