import assert from "node:assert/strict";
import test from "node:test";
import { compileTripBlueprint, importSkillItinerary, importSkillResearchBatches, type SkillResearchBatchArtifact, type TripBlueprint } from "@c-assistant/core";
import { blueprintPresentation } from "./blueprint-presentation.js";
import { buildBlueprintWorkspaceDisplay } from "./landi-blueprint-workspace-display.js";

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
    moduleIdentity: { primaryModule: "itinerary", enabledModules: [{ id: "itinerary", title: "Itinerary", source: "blueprint" }, { id: "tips", title: "Tips", source: "blueprint" }] },
    guideTheme: { title: "Architecture and neighborhood life", narrative: "Keep architectural anchors connected to local streets.", visitorMode: "balanced-visitor", tasteModels: ["design-aware"] },
    guideRelationshipGraph: { relationships: [{ id: "rel-c-a", kind: "meal_support", fromPlaceId: "c", toPlaceId: "a", rationale: "C works as a light break after A.", dayIds: ["day-1"], evidence: [{ sourceId: "source-1", status: "verified" }] }] },
    fieldEvidence: [{ path: "guideTheme.title", status: "verified", evidence: [{ sourceId: "source-1", status: "verified" }] }],
    sources: [{ id: "source-1", title: "Official", authority: "City", url: "https://example.com/place", retrievedAt: "2026-08-26", status: "verified", official: true }],
    places: [
      { id: "a", name: "A", locationLabel: "Lisbon", city: "Lisbon", category: "architecture", priority: "must", coordinates: [38.7, -9.1], whyWorthIt: "A", plan: "Visit A", detailSections: [{ title: "Look", items: ["Facade"] }], evidence: [{ sourceId: "source-1", status: "verified" }], fieldEvidence: [{ path: "places.a.whyWorthIt", status: "verified", evidence: [{ sourceId: "source-1", status: "verified" }] }] },
      { id: "b", name: "B", locationLabel: "Lisbon", city: "Lisbon", category: "local-life", priority: "preferred", coordinates: [38.71, -9.11], whyWorthIt: "B", plan: "Visit B", evidence: [] },
      { id: "c", name: "C", locationLabel: "Lisbon", city: "Lisbon", category: "cafe", priority: "nearby", display: { type: "dining", markerKind: "dining" }, guideDisplay: { cardSummary: "Coffee break selected by the Blueprint.", tags: ["45 min"], detailLeadTitle: "Coffee role", comparisonRows: [{ id: "row-a", relatedPlaceId: "a", area: "Lisbon", routeFit: "After the anchor", timing: "Afternoon", effort: "Low effort", sourceState: "Verified source" }] }, schedulingEligibility: { decision: "schedulable", reason: "Works as a coffee alternative.", suitableDayIds: ["day-1"] }, whyWorthIt: "C", plan: "Keep C as an alternative", evidence: [] }
    ],
    events: [{ id: "event-a", title: "Festival A", startDate: "2026-10-12", locationLabel: "Lisbon", placeId: "a", description: "Evening event near A.", evidence: [{ sourceId: "source-1", status: "verified" }] }],
    days: [{ id: "day-1", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }], blocks: [{ id: "block-a", kind: "stop", order: 1, placeId: "a", evidence: [] }, { id: "block-b", kind: "stop", order: 2, placeId: "b", evidence: [] }], candidatePlaceIds: ["c"] }],
    movements: [{ id: "move-1", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "recheck", detail: "Use shaded side streets.", display: { routeLabel: "Shaded street walk", showAsFormalRoute: true, mapLineState: "reference" }, evidence: [{ sourceId: "source-1", status: "verified" }] }],
    actionRequirements: [{ id: "reserve-a", kind: "reservation", title: "Reserve A", description: "Choose an admission slot.", accountableParty: "traveler", completionCondition: "A slot is confirmed.", placeId: "a", evidence: [] }],
    localFoods: [{ id: "food-pastry", title: "Pastel stop", description: "A short pastry break near the route.", context: "Cafe breaks", diningPlaceIds: ["c"], evidence: [{ sourceId: "source-1", status: "verified" }] }],
    localProducts: [{ id: "product-tile", title: "Tile shops", description: "Small azulejo purchases fit compact browsing.", context: "Baixa shopping", purchasePlaceIds: ["b"], evidence: [] }],
    experienceThemes: [{ id: "experience-fado", title: "Fado night", description: "Use a concrete venue before adding it to the route.", context: "Evening options", offeringPlaceIds: ["a"], evidence: [] }],
    travelTips: [{ id: "tip-cash", title: "Carry some cash", body: "Small neighborhood cafes may prefer cash during busy service.", theme: "payment", context: "Lisbon cafes", placeId: "c", evidence: [{ sourceId: "source-1", status: "verified" }] }],
    preparationChecklist: [{ id: "prep-reserve-a", title: "Reserve A", description: "Choose an admission slot.", group: "bookings_departure", completionCondition: "A slot is confirmed.", requirementId: "reserve-a", placeId: "a", evidence: [] }],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.places.map((place) => place.id), ["a", "b", "c"]);
  assert.deepEqual(presentation.days[0]?.placeIds, ["a", "b"]);
  assert.deepEqual(presentation.days[0]?.candidates, ["c"]);
  assert.deepEqual(presentation.days[0]?.blocks?.map((block) => block.id), ["block-a", "block-b"]);
  assert.equal(presentation.routeSegments[0]?.verification, "needs_verification");
  assert.equal(presentation.routeSegments[0]?.detail, "Use shaded side streets.");
  assert.deepEqual(presentation.routeSegments[0]?.display, { routeLabel: "Shaded street walk", showAsFormalRoute: true, mapLineState: "reference" });
  assert.deepEqual(presentation.routeSegments[0]?.sourceRefs, ["https://example.com/place"]);
  assert.deepEqual(presentation.places[2]?.display, { type: "dining", markerKind: "dining" });
  assert.equal(presentation.places[2]?.guideDisplay?.cardSummary, "Coffee break selected by the Blueprint.");
  assert.equal(presentation.places[2]?.guideDisplay?.comparisonRows?.[0]?.relatedPlaceId, "a");
  assert.deepEqual(presentation.places[2]?.schedulingEligibility?.suitableDayIds, ["day-1"]);
  assert.deepEqual(presentation.moduleIdentity?.enabledModules.map((module) => module.id), ["itinerary", "tips"]);
  assert.equal(presentation.guideTheme?.visitorMode, "balanced-visitor");
  assert.equal(presentation.guideRelationshipGraph?.relationships[0]?.kind, "meal_support");
  assert.equal(presentation.fieldEvidence?.[0]?.path, "guideTheme.title");
  assert.deepEqual(presentation.sourceCatalog?.map((source) => [source.id, source.title, source.url]), [["source-1", "Official", "https://example.com/place"]]);
  assert.equal(presentation.localFoods?.[0]?.diningPlaceIds[0], "c");
  assert.equal(presentation.localProducts?.[0]?.purchasePlaceIds[0], "b");
  assert.equal(presentation.experienceThemes?.[0]?.offeringPlaceIds[0], "a");
  assert.equal(presentation.places[0]?.fieldEvidence?.[0]?.path, "places.a.whyWorthIt");
  assert.deepEqual(presentation.events, [{ id: "event-a", title: "Festival A", description: "Evening event near A.", startDate: "2026-10-12", locationLabel: "Lisbon", placeId: "a", sourceRefs: ["https://example.com/place"] }]);
  assert.equal(presentation.places[0]?.reservation?.requirement, "required");
  assert.equal(presentation.places[0]?.reservation?.verification, "needs_recheck");
  assert.equal(presentation.travelTips?.[0]?.title, "Carry some cash");
  assert.equal(presentation.preparationChecklist?.[0]?.requirementId, "reserve-a");
  assert.equal(buildBlueprintWorkspaceDisplay({ id: "plan-1", version: 1, title: "Lisbon", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } }, stages: [], sources: [], createdAt: "2026-08-26T00:00:00.000Z", presentation }, presentation).sources.some((source) => source.summary === "Official · City · 2026-08-26"), true);
});

test("Web Blueprint read model preserves explicit empty tips and preparation checklist", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-empty-guidance",
    version: 1,
    generationKey: "generation-empty-guidance",
    proposalRef: { sessionId: "session-empty-guidance", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-empty-guidance",
    title: "Tokyo",
    summary: "Neighborhood route.",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-10-12",
    endDate: "2026-10-12",
    sources: [],
    places: [{ id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "must", coordinates: [35.68, 139.76], whyWorthIt: "A", plan: "Visit A", evidence: [] }],
    events: [],
    days: [{ id: "day-1", date: "2026-10-12", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: [] }],
    movements: [],
    actionRequirements: [],
    travelTips: [],
    preparationChecklist: [],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.travelTips, []);
  assert.deepEqual(presentation.preparationChecklist, []);
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
    events: [{ id: "event-temple", title: "Neighborhood festival", startDate: "2026-10-03", locationLabel: "Nezu", placeId: "temple", description: "A local event that may change crowd levels around the shrine.", evidence: [{ sourceId: "tokyo-guide", status: "verified" }] }],
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

test("Trip Blueprint compiles into the Landi-native Web workspace contract", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-workspace",
    version: 1,
    generationKey: "generation-workspace",
    proposalRef: { sessionId: "session-workspace", proposalVersion: 1 },
    skillLineage: { skillId: "landi-native-blueprint", skillVersion: "0.1.0" },
    researchSetId: "research-workspace",
    title: "Tokyo and Kyoto",
    summary: "Temple etiquette, neighborhood walks, cafe stops, shopping streets, and bathing.",
    language: "en",
    destinations: ["Tokyo", "Kyoto"],
    startDate: "2026-10-03",
    endDate: "2026-10-04",
    sources: [
      { id: "tokyo-guide", title: "Tokyo guide", authority: "Tokyo official tourism", url: "https://example.com/tokyo", retrievedAt: "2026-08-26", status: "verified", official: true },
      { id: "kyoto-guide", title: "Kyoto guide", authority: "Kyoto official tourism", url: "https://example.com/kyoto", retrievedAt: "2026-08-26", status: "verified", official: true }
    ],
    places: [
      { id: "temple", name: "Nezu Shrine", localizedName: "根津神社", locationLabel: "Nezu, Tokyo", city: "Tokyo", area: "Nezu", category: "shrine", priority: "must", coordinates: [35.7202, 139.7609], contentTier: "deep", visitRole: "anchor", durationMinutes: 60, whyWorthIt: "A compact religious site that fits a neighborhood-led day.", plan: "Visit quietly and move through the smaller paths without blocking worshippers.", tip: "At active shrines, keep voices low near the worship hall and avoid photographing people at prayer.", detailSections: [{ title: "Etiquette", items: ["Step aside before taking photos.", "Do not block the worship route."] }], officialUrl: "https://example.com/nezu", evidence: [{ sourceId: "tokyo-guide", status: "verified", supports: ["location", "visit style"] }] },
      { id: "coffee", name: "ARiSE Coffee Roasters", locationLabel: "Kiyosumi-Shirakawa, Tokyo", city: "Tokyo", area: "Kiyosumi-Shirakawa", category: "coffee cafe", priority: "preferred", coordinates: [35.6814, 139.8031], contentTier: "standard", visitRole: "lunch nearby", durationMinutes: 45, whyWorthIt: "A short cafe stop that keeps the day relaxed.", plan: "Use as a coffee pause after the garden walk.", evidence: [{ sourceId: "tokyo-guide", status: "verified" }] },
      { id: "shopping", name: "Yanaka Ginza Shopping Street", locationLabel: "Yanaka, Tokyo", city: "Tokyo", area: "Yanaka", category: "shopping street", priority: "nearby", coordinates: [35.7278, 139.7662], contentTier: "compact", durationMinutes: 60, whyWorthIt: "A small shopping street for snacks and local browsing.", plan: "Walk through as a flexible afternoon stop if the group still has energy.", evidence: [{ sourceId: "tokyo-guide", status: "verified" }] },
      { id: "bath", name: "Spa LaQua", locationLabel: "Bunkyo, Tokyo", city: "Tokyo", area: "Bunkyo", category: "spa bathing experience", priority: "nearby", coordinates: [35.7056, 139.7521], contentTier: "standard", durationMinutes: 120, whyWorthIt: "A bathing reset that works as an optional evening experience.", plan: "Use only if everyone is comfortable with public-bath rules.", tip: "Public-bath facilities may have tattoo, towel, locker, and health rules; check the current rules before going.", bookingUrl: "https://example.com/spa", evidence: [{ sourceId: "tokyo-guide", status: "recheck" }] },
      { id: "kyoto-market", name: "Nishiki Market", locationLabel: "Central Kyoto", city: "Kyoto", area: "Central Kyoto", category: "food market", priority: "preferred", coordinates: [35.005, 135.7647], contentTier: "standard", visitRole: "lunch", durationMinutes: 75, whyWorthIt: "A compact lunch and food browsing stop.", plan: "Use as a lunch window rather than a long shopping block.", evidence: [{ sourceId: "kyoto-guide", status: "verified" }] },
      { id: "kyoto-view", name: "Kyoto Tower Observation Deck", locationLabel: "Kyoto Station, Kyoto", city: "Kyoto", area: "Kyoto Station", category: "landmark", priority: "preferred", coordinates: [34.9875, 135.7592], contentTier: "standard", durationMinutes: 45, whyWorthIt: "A compact viewpoint that gives spatial context before moving through central Kyoto.", plan: "Visit after lunch if the route still feels relaxed.", evidence: [{ sourceId: "kyoto-guide", status: "verified" }] }
    ],
    events: [
      {
        id: "event-temple",
        title: "Neighborhood festival",
        startDate: "2026-10-03",
        locationLabel: "Nezu",
        placeId: "temple",
        description: "A local event that may change crowd levels around the shrine.",
        evidence: [{ sourceId: "tokyo-guide", status: "verified" }]
      }
    ],
    days: [
      { id: "day-tokyo", date: "2026-10-03", kind: "scheduled", city: "Tokyo", title: "Old Tokyo and bathing option", summary: "Keep the route compact, with shopping and bathing as flexible sub-branch material.", stops: [{ placeId: "temple", order: 1, time: "09:00" }, { placeId: "coffee", order: 2, role: "lunch nearby" }], candidatePlaceIds: ["shopping", "bath"] },
      { id: "day-kyoto", date: "2026-10-04", kind: "scheduled", city: "Kyoto", title: "Central Kyoto food walk", summary: "Use the market as the day anchor.", stops: [{ placeId: "kyoto-market", order: 1, role: "lunch" }, { placeId: "kyoto-view", order: 2 }], candidatePlaceIds: [] }
    ],
    movements: [
      { id: "walk-1", dayId: "day-tokyo", originPlaceId: "temple", destinationPlaceId: "coffee", mode: "walking", status: "verified", label: "Neighborhood walk", durationMinutes: 20, evidence: [{ sourceId: "tokyo-guide", status: "verified" }] },
      { id: "walk-2", dayId: "day-kyoto", originPlaceId: "kyoto-market", destinationPlaceId: "kyoto-view", mode: "transit", status: "verified", label: "Cross-town hop", durationMinutes: 18, evidence: [{ sourceId: "kyoto-guide", status: "verified" }] }
    ],
    actionRequirements: [
      { id: "entry-check", kind: "travel_authorization", title: "Check Japan entry rules", description: "Review official entry rules for the traveler passport before departure.", accountableParty: "traveler", completionCondition: "Entry rules reviewed.", evidence: [{ sourceId: "tokyo-guide", status: "verified" }] },
      { id: "bath-rules", kind: "preparation", title: "Confirm bathing comfort and rules", description: "Confirm everyone is comfortable with public-bath format and current facility rules.", accountableParty: "traveler", completionCondition: "Bathing rules reviewed.", placeId: "bath", evidence: [{ sourceId: "tokyo-guide", status: "recheck" }] },
      { id: "local-etiquette", kind: "time_sensitive_recheck", title: "Check local temple etiquette", description: "Local temple and shrine etiquette should be rechecked before visiting active religious sites.", accountableParty: "assistant", completionCondition: "Etiquette note refreshed.", placeId: "temple", evidence: [{ sourceId: "tokyo-guide", status: "verified" }] }
    ],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const compiled = compileTripBlueprint(blueprint, { createdAt: "2026-08-26T01:00:00.000Z" });
  const presentation = blueprintPresentation(blueprint);
  const plan = { ...compiled.plan, presentation };
  const workspace = buildBlueprintWorkspaceDisplay(plan, presentation);

  assert.deepEqual(workspace.areas, ["itinerary", "preparation", "tips", "sources"]);
  assert.equal(workspace.days.length, 2);
  assert.equal(workspace.places.length, 6);
  assert.deepEqual(new Set(workspace.guideCards.map((card) => card.type)), new Set(["attraction", "dining", "shopping", "experience"]));
  assert.deepEqual(workspace.guideCards.filter((card) => card.canAdd).map((card) => card.placeId), ["shopping", "bath"]);
  assert.ok(workspace.preparationGroups.some((group) => group.items.some((item) => item.title === "Check Japan entry rules")));
  assert.ok(workspace.preparationGroups.some((group) => group.items.some((item) => item.title === "Confirm bathing comfort and rules")));
  assert.ok(workspace.tipGroups.some((group) => group.tips.some((tip) => /voices low/.test(tip.body))));
  assert.deepEqual(workspace.details.find((detail) => detail.placeId === "temple")?.relatedEvents.map((event) => ({ title: event.title, source: event.sources[0]?.summary })), [{ title: "Neighborhood festival", source: "Tokyo guide · Tokyo official tourism · 2026-08-26" }]);
  assert.ok(workspace.sources.some((source) => source.summary === "Tokyo guide · Tokyo official tourism · 2026-08-26"));
  const workspaceText = JSON.stringify(workspace);
  assert.equal(/candidate|candidates|best|default recommendation|source attached|authorization/i.test(workspaceText), false);
});

test("Skill importer output reaches the Landi-native Web workspace read model", () => {
  const researchArtifact: SkillResearchBatchArtifact = {
    id: "tokyo-kyoto",
    scopeLabel: "Tokyo and Kyoto",
    completedAt: "2026-08-26T00:00:00.000Z",
    sources: [
      { id: "tokyo-official", title: "Tokyo official guide", authority: "Tokyo tourism", url: "https://example.com/tokyo#guide", retrievedAt: "2026-08-26", status: "verified", official: true },
      { id: "kyoto-official", title: "Kyoto official guide", authority: "Kyoto tourism", url: "https://example.com/kyoto#guide", retrievedAt: "2026-08-26", status: "verified", official: true }
    ],
    places: [
      { id: "shrine", name: "Nezu Shrine", localizedName: "根津神社", locationLabel: "Nezu, Tokyo", city: "Tokyo", area: "Nezu", category: "shrine", priority: "must", coordinates: [35.7202, 139.7609], contentTier: "deep", visitRole: "anchor", durationMinutes: 60, whyWorthIt: "A compact religious site for neighborhood context.", plan: "Visit quietly before the cafe stop.", tip: "At active shrines, keep voices low near the worship hall and avoid photographing people at prayer.", detailSections: [{ title: "Etiquette", items: ["Step aside before photos.", "Do not block the worship route."] }], officialUrl: "https://example.com/nezu#official", sourceUrls: ["https://example.com/tokyo#guide"] },
      { id: "coffee", name: "ARiSE Coffee Roasters", locationLabel: "Kiyosumi-Shirakawa, Tokyo", city: "Tokyo", area: "Kiyosumi-Shirakawa", category: "coffee cafe", priority: "preferred", coordinates: [35.6814, 139.8031], contentTier: "standard", visitRole: "lunch nearby", durationMinutes: 45, whyWorthIt: "A short cafe stop that keeps the day relaxed.", plan: "Use as the lunch-nearby pause.", sourceUrls: ["https://example.com/tokyo#guide"] },
      { id: "shop", name: "Yanaka Ginza Shopping Street", locationLabel: "Yanaka, Tokyo", city: "Tokyo", area: "Yanaka", category: "shopping street", priority: "nearby", coordinates: [35.7278, 139.7662], contentTier: "compact", durationMinutes: 60, whyWorthIt: "A small street for snacks and local browsing.", plan: "Use as a flexible afternoon stop.", sourceUrls: ["https://example.com/tokyo#guide"] },
      { id: "bath", name: "Spa LaQua", locationLabel: "Bunkyo, Tokyo", city: "Tokyo", area: "Bunkyo", category: "spa bathing experience", priority: "nearby", coordinates: [35.7056, 139.7521], display: { type: "experience", workspaceSignals: { reservation: "required", needsRecheck: true, longStop: false, itineraryStatusLabel: "Review entry rules" } }, contentTier: "standard", durationMinutes: 120, whyWorthIt: "A bathing reset for the evening.", plan: "Use only if everyone is comfortable with public-bath rules.", tip: "Public-bath facilities may have tattoo, towel, locker, and health rules; check the current rules before going.", experienceUrl: "https://example.com/spa#experience", sourceUrls: ["https://example.com/tokyo#guide"] },
      { id: "market", name: "Nishiki Market", locationLabel: "Central Kyoto", city: "Kyoto", area: "Central Kyoto", category: "food market", priority: "preferred", coordinates: [35.005, 135.7647], contentTier: "standard", visitRole: "lunch", durationMinutes: 75, whyWorthIt: "A compact lunch and food browsing stop.", plan: "Use as a lunch window.", sourceUrls: ["https://example.com/kyoto#guide"] }
    ],
    events: [],
    actionRequirements: [
      { id: "entry", kind: "travel_authorization", title: "Prepare Japan arrival information", description: "Review official entry rules for the traveler passport before departure.", accountableParty: "traveler", completionCondition: "Entry rules reviewed.", sourceUrls: ["https://example.com/tokyo#guide"] },
      { id: "bath-slot", kind: "reservation", title: "Choose bathing entry slot", description: "Choose the current entry option before adding the bathing stop to the day.", accountableParty: "traveler", completionCondition: "Bathing entry option selected.", placeId: "bath", sourceUrls: ["https://example.com/tokyo#guide"] },
      { id: "bath-rules", kind: "preparation", title: "Confirm bathing comfort and rules", description: "Confirm everyone is comfortable with public-bath format and current facility rules.", accountableParty: "traveler", completionCondition: "Bathing rules reviewed.", placeId: "bath", sourceUrls: ["https://example.com/tokyo#guide"] }
    ]
  };
  const research = importSkillResearchBatches([researchArtifact], {
    researchSetId: "research-imported",
    generationKey: "generation-imported",
    proposalRef: { sessionId: "session-imported", proposalVersion: 1 },
    skillLineage: { skillId: "landi-native-blueprint", skillVersion: "0.1.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const idFor = (inputId: string) => research.batches[0]!.placeIds[researchArtifact.places.findIndex((place) => place.id === inputId)]!;
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo and Kyoto",
    summary: "Imported Blueprint route.",
    language: "en",
    destinations: ["Tokyo", "Kyoto"],
    startDate: "2026-10-03",
    endDate: "2026-10-04",
    days: [
      {
        id: "day-tokyo",
        date: "2026-10-03",
        kind: "scheduled",
        city: "Tokyo",
        title: "Old Tokyo",
        summary: "Keep the route compact, with food, shopping, and bathing as flexible material.",
        stops: [{ placeId: idFor("shrine"), order: 1, time: "09:00" }, { placeId: idFor("coffee"), order: 2, role: "lunch nearby" }],
        blocks: [
          { id: "block-shrine", kind: "stop", order: 2, placeId: idFor("shrine"), startTime: "09:00", display: { timeLabel: "  Shrine opening  ", meta: "  Start with the quiet route anchor  ", routeAnchor: true, reorderable: false }, evidence: [] },
          { id: "block-coffee", kind: "meal", order: 3, placeId: idFor("coffee"), role: "lunch nearby", display: { timeLabel: "  Coffee and lunch buffer  ", meta: "  Keep this as the flexible meal pause  ", routeAnchor: true, reorderable: true }, evidence: [] }
        ],
        candidatePlaceIds: [idFor("shop"), idFor("bath")]
      },
      { id: "day-kyoto", date: "2026-10-04", kind: "scheduled", city: "Kyoto", title: "Central Kyoto food", summary: "Use the market as the day anchor.", stops: [{ placeId: idFor("market"), order: 1, role: "lunch" }], candidatePlaceIds: [] }
    ],
    movements: [{
      id: "walk-1",
      dayId: "day-tokyo",
      originPlaceId: idFor("shrine"),
      destinationPlaceId: idFor("coffee"),
      mode: "walking",
      status: "verified",
      label: "Neighborhood walk",
      detail: "Use the quieter lanes between the shrine and coffee stop.",
      display: { routeLabel: "  Reviewed shrine-to-coffee walk  ", refreshReason: "  Recheck after local day edits.  ", showAsFormalRoute: true, mapLineState: "needs_refresh" },
      durationMinutes: 20,
      evidence: [{ sourceId: research.sources[0]!.id, status: "verified" }]
    }]
  }, { blueprintId: "blueprint-imported", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  const compiled = compileTripBlueprint(blueprint, { createdAt: "2026-08-26T01:30:00.000Z" });
  const presentation = blueprintPresentation(blueprint);
  const workspace = buildBlueprintWorkspaceDisplay({ ...compiled.plan, presentation }, presentation);

  assert.deepEqual(new Set(workspace.guideCards.map((card) => card.type)), new Set(["attraction", "dining", "shopping", "experience"]));
  assert.equal(workspace.details.find((detail) => detail.title.includes("Nezu Shrine"))?.links[0]?.url, "https://example.com/nezu");
  const bathDetail = workspace.details.find((detail) => detail.title === "Spa LaQua");
  assert.ok(bathDetail?.links.some((link) => link.label === "Experience link" && link.url === "https://example.com/spa"));
  assert.equal(bathDetail?.reservationNote, "Choose the current entry option before adding the bathing stop to the day.");
  assert.deepEqual(workspace.places.find((place) => place.title === "Spa LaQua")?.placementSignals, { reservation: "required", needsRecheck: true, longStop: false });
  assert.deepEqual(workspace.itineraries[0]?.items.slice(0, 2).map((item) => ({ title: item.title, time: item.timeLabel, meta: item.meta, reorderable: Boolean(item.reorderable) })), [
    { title: "Nezu Shrine · 根津神社", time: "Shrine opening", meta: "Start with the quiet route anchor", reorderable: false },
    { title: "ARiSE Coffee Roasters", time: "Coffee and lunch buffer", meta: "Keep this as the flexible meal pause", reorderable: true }
  ]);
  assert.equal(workspace.itineraries[0]?.routeSegments[0]?.detail, "Use the quieter lanes between the shrine and coffee stop.");
  assert.equal(workspace.itineraries[0]?.routeSegments[0]?.label, "Reviewed shrine-to-coffee walk");
  assert.equal(workspace.itineraries[0]?.routeSegments[0]?.needsRefresh, true);
  assert.equal(workspace.itineraries[0]?.routeSegments[0]?.mapLineState, "needs_refresh");
  assert.equal(workspace.itineraries[0]?.routeSegments[0]?.refreshReason, "Recheck after local day edits.");
  assert.equal(workspace.itineraries[0]?.routeSegments[0]?.sources[0]?.summary, "Tokyo official guide · Tokyo tourism · 2026-08-26");
  assert.ok(workspace.tipGroups.some((group) => group.tips.some((tip) => /voices low/.test(tip.body))));
  assert.ok(workspace.preparationGroups.some((group) => group.items.some((item) => item.title === "Prepare Japan arrival information")));
  assert.ok(workspace.sources.some((source) => source.summary === "Tokyo official guide · Tokyo tourism · 2026-08-26"));
  assert.equal(/candidate|candidates|default recommendation|source attached|authorization/i.test(JSON.stringify(workspace)), false);
});
