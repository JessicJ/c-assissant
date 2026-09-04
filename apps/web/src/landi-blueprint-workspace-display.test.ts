import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plan, PlanPlace, PlanPresentation } from "@c-assistant/core";
import { buildBlueprintWorkspaceDisplay, buildPendingItineraryEditForWorkspace, buildPendingItineraryMoveForWorkspace, detailDisplayForWorkspacePlace, filterGuideCards, itineraryDisplayForWorkspace, pendingItineraryEditBatchRequest, pendingItineraryEditRequest, scheduledDayIdForPlace } from "./landi-blueprint-workspace-display.js";

function place(id: string, patch: Partial<PlanPlace> = {}): PlanPlace {
  return {
    id,
    name: id,
    locationLabel: "Kyoto",
    city: "Kyoto",
    area: "Central",
    category: "museum",
    priority: "preferred",
    coordinates: [35, 135],
    whyWorthIt: "Useful context.",
    plan: "Keep the card summary short.",
    detailSections: [],
    sourceRefs: [],
    ...patch
  };
}

function presentationFixture(patch: Partial<PlanPresentation> = {}): PlanPresentation {
  return {
    kind: "itinerary",
    summary: "Kyoto plan.",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    places: [
      place("temple", { category: "temple" }),
      place("lunch", { category: "restaurant", plan: "Eat near the market without turning the card into a full guide." }),
      place("craft", { category: "shopping craft store" })
    ],
    days: [{
      id: "day-1",
      label: "October 1",
      date: "2026-10-01",
      city: "Kyoto",
      placeIds: ["temple", "lunch", "craft"],
      stops: [{ placeId: "temple", order: 1, time: "09:30" }, { placeId: "lunch", order: 2, role: "lunch" }, { placeId: "craft", order: 3 }]
    }],
    routeSegments: [],
    ...patch
  };
}

function planFixture(presentation = presentationFixture(), patch: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    version: 1,
    title: "Landi Plan: Kyoto",
    location: "Kyoto",
    dates: "October 2026",
    status: "draft",
    knownInformation: [],
    assumptions: [],
    nextAction: "Review.",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [],
    sources: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    presentation,
    ...patch
  };
}

describe("Landi Blueprint workspace display helpers", () => {
  it("builds the workspace display contract from plan and presentation data", () => {
    const display = buildBlueprintWorkspaceDisplay(planFixture(), presentationFixture());
    assert.deepEqual(display.areas, ["itinerary", "preparation", "tips", "sources"]);
    assert.deepEqual(display.guideFilters, ["attraction", "dining", "shopping", "experience"]);
    assert.equal(display.dateLabel, "2026-10-01 - 2026-10-02");
    assert.equal(display.initialDayId, "day-1");
    assert.equal(display.initialPlaceId, "temple");
    assert.equal(display.days.length, 1);
    assert.equal(display.places.length, 3);
    assert.equal(display.itineraries.length, 1);
    assert.equal(display.itineraries[0]?.dayId, "day-1");
    assert.deepEqual(display.itineraries[0]?.items.map((item) => item.placeId), ["temple", "lunch", "craft"]);
    assert.deepEqual(display.itineraries[0]?.items.map((item) => item.meta), [undefined, undefined, undefined]);
    assert.deepEqual(display.itineraries[0]?.placementOptions.map((option) => option.id), ["start", "after-temple", "after-lunch", "after-craft", "end"]);
    assert.equal(display.guideCards.length, 3);
    assert.equal(display.details.length, 3);
    assert.equal(detailDisplayForWorkspacePlace(display, "lunch")?.title, "lunch");
    assert.equal(scheduledDayIdForPlace(display, "craft"), "day-1");
    assert.equal("candidates" in (display.days[0] as unknown as Record<string, unknown>), false);
    assert.equal("placeIds" in (display.days[0] as unknown as Record<string, unknown>), false);
    assert.equal(/"category"|"priority"|"sourceRefs"|"evidenceSources"|"whyWorthIt"|"blocks"|"stops"|"candidates"|"placeIds"/.test(JSON.stringify(display)), false);
  });

  it("classifies itinerary guide material into sub-branches", () => {
    const presentation = presentationFixture({
      places: [
        place("a", { category: "landmark" }),
        place("b", { category: "local dining restaurant" }),
        place("c", { category: "shopping arcade" }),
        place("d", { category: "tea ceremony experience" }),
        place("e", { category: "shrine", plan: "Visit quietly without blocking worshippers." }),
        place("f", { name: "Kyoto Tower Observation Deck", category: "landmark", plan: "Visit after lunch if the route still feels relaxed." }),
        place("g", { category: "coffee cafe", plan: "Use as a pause after the garden." })
      ],
      days: []
    });
    const typeById = new Map(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards.map((card) => [card.placeId, card.type]));
    assert.equal(typeById.get("a"), "attraction");
    assert.equal(typeById.get("b"), "dining");
    assert.equal(typeById.get("c"), "shopping");
    assert.equal(typeById.get("d"), "experience");
    assert.equal(typeById.get("e"), "attraction");
    assert.equal(typeById.get("f"), "attraction");
    assert.equal(typeById.get("g"), "dining");
  });

  it("uses explicit Blueprint display intent before category inference", () => {
    const presentation = presentationFixture({
      places: [
        place("market", { category: "food market", display: { type: "shopping", markerKind: "shopping" } }),
        place("tea", { category: "tea ceremony experience", display: { type: "experience", markerKind: "dining" } })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["market", "tea"], stops: [{ placeId: "market", order: 1 }, { placeId: "tea", order: 2 }] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const cardTypeById = new Map(workspace.guideCards.map((card) => [card.placeId, card.type]));
    const markerTypeById = new Map(workspace.itineraries[0]!.markers.map((marker) => [marker.placeId, marker.type]));
    assert.equal(cardTypeById.get("market"), "shopping");
    assert.equal(markerTypeById.get("market"), "shopping");
    assert.equal(cardTypeById.get("tea"), "experience");
    assert.equal(markerTypeById.get("tea"), "dining");
  });

  it("uses Blueprint module identity, scheduling eligibility, typed blocks, and relationships before inference", () => {
    const presentation = presentationFixture({
      moduleIdentity: { primaryModule: "itinerary", enabledModules: [{ id: "itinerary", title: "Itinerary", source: "blueprint" }, { id: "tips", title: "Tips", source: "blueprint" }] },
      guideRelationshipGraph: { relationships: [{ id: "rel-tea-lunch", kind: "meal_support", fromPlaceId: "tea", toPlaceId: "lunch", rationale: "Tea works as a softer break after lunch.", dayIds: ["day-1"], evidence: [{ sourceId: "guide", status: "verified" }] }] },
      places: [
        place("temple", { category: "temple", display: { type: "attraction" } }),
        place("lunch", { category: "restaurant", display: { type: "dining" } }),
        place("tea", { category: "ceremony", display: { type: "experience" }, schedulingEligibility: { decision: "schedulable", reason: "Fits the first day.", suitableDayIds: ["day-1"] } }),
        place("context", { category: "food notes", display: { type: "dining" }, schedulingEligibility: { decision: "informational", reason: "Use this as background, not a stop." } }),
        place("hotel-shift", { category: "neighborhood dinner", display: { type: "dining" }, schedulingEligibility: { decision: "high_impact", reason: "It changes the hotel-side evening plan.", highImpactReasons: ["Late cross-town route"] } }),
        place("closed", { category: "museum", display: { type: "attraction" }, schedulingEligibility: { decision: "blocked", reason: "Closed during the trip." } })
      ],
      days: [{
        id: "day-1",
        label: "October 1",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["temple", "lunch"],
        stops: [{ placeId: "temple", order: 1, time: "09:30" }, { placeId: "lunch", order: 2 }],
        blocks: [
          { id: "block-temple", kind: "stop", order: 1, placeId: "temple", startTime: "09:30", evidence: [] },
          { id: "block-rest", kind: "rest", order: 2, title: "Hotel rest", summary: "Keep a real pause before lunch.", evidence: [] },
          { id: "block-lunch", kind: "meal", order: 3, placeId: "lunch", role: "lunch", evidence: [] }
        ]
      }, {
        id: "day-2",
        label: "October 2",
        date: "2026-10-02",
        city: "Kyoto",
        placeIds: [],
        stops: []
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [{ title: "Guide", url: "https://guide.example", authority: "Local", retrievedAt: "2026-09-02" }] }), presentation);
    assert.deepEqual(workspace.areas, ["itinerary", "tips"]);
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => ({ title: item.title, time: item.timeLabel, meta: item.meta, placeId: item.placeId })), [
      { title: "temple", time: "09:30", meta: undefined, placeId: "temple" },
      { title: "Hotel rest", time: "Rest window", meta: "Keep a real pause before lunch.", placeId: "" },
      { title: "lunch", time: "Around lunch", meta: "lunch", placeId: "lunch" }
    ]);
    assert.deepEqual(workspace.itineraries[0]?.routePlaces.map((place) => place.placeId), ["temple", "lunch"]);
    assert.deepEqual(workspace.itineraries[0]?.placementOptions.map((option) => option.id), ["start", "after-temple", "after-lunch", "end"]);
    const cardById = new Map(workspace.guideCards.map((card) => [card.placeId, card]));
    assert.equal(cardById.get("tea")?.canAdd, true);
    assert.equal(cardById.get("context")?.state, "informational");
    assert.equal(cardById.get("hotel-shift")?.canAdd, false);
    assert.equal(cardById.get("hotel-shift")?.footerNote, "Needs replanning");
    assert.equal(cardById.get("closed")?.footerNote, "Not for this plan");
    const teaEdit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-2", positionId: "end" });
    assert.equal(teaEdit.dayId, "day-1");
    assert.deepEqual(teaEdit.position, { kind: "end" });
    const detail = detailDisplayForWorkspacePlace(workspace, "tea");
    assert.equal(detail?.canAdd, true);
    assert.deepEqual(detail?.comparisonRows.map((row) => ({ id: row.id, route: row.routeFit, timing: row.timing, effort: row.effort, source: row.sourceState })), [
      { id: "lunch", route: "Meal support", timing: "2026-10-01", effort: "Tea works as a softer break after lunch.", source: "Verified relationship" }
    ]);
    assert.equal(detailDisplayForWorkspacePlace(workspace, "hotel-shift")?.canAdd, false);
    assert.equal(detailDisplayForWorkspacePlace(workspace, "hotel-shift")?.primaryActionLabel, "Needs replanning");
  });

  it("keeps observation landmarks while filtering actual transport nodes", () => {
    const presentation = presentationFixture({
      places: [
        place("view", { name: "Kyoto Tower Observation Deck", category: "landmark" }),
        place("station", { name: "Kyoto Station", category: "station transfer" })
      ],
      days: []
    });
    assert.deepEqual(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards.map((card) => card.placeId), ["view"]);
  });

  it("keeps flexible blocks ordered and labels them with rough time", () => {
    const display = buildBlueprintWorkspaceDisplay(planFixture(), presentationFixture()).itineraries[0]!;
    assert.deepEqual(display.items.map((item) => item.timeLabel), ["09:30", "Around lunch", "Flexible afternoon"]);
    assert.deepEqual(display.items.map((item) => item.placeId), ["temple", "lunch", "craft"]);
  });

  it("builds itinerary placement options around the day sequence", () => {
    const display = buildBlueprintWorkspaceDisplay(planFixture(), presentationFixture()).itineraries[0]!;
    assert.deepEqual(display.placementOptions.map((option) => option.id), ["start", "after-temple", "after-lunch", "after-craft", "end"]);
  });

  it("marks scheduled, unscheduled, and informational guide cards without candidate wording", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("shop", { category: "shopping" }),
        place("food-theme", { category: "local food theme" })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["temple"], stops: [{ placeId: "temple", order: 1 }] }]
    });
    const stateById = new Map(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards.map((card) => [card.placeId, card.state]));
    assert.equal(stateById.get("temple"), "scheduled");
    assert.equal(stateById.get("shop"), "unscheduled");
    assert.equal(stateById.get("food-theme"), "informational");
  });

  it("keeps guide card chrome free of redundant state labels", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("tea", { category: "tea ceremony experience" }),
        place("context", { category: "local food theme" })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["temple"], stops: [{ placeId: "temple", order: 1, time: "09:00" }] }]
    });
    const cards = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards;
    assert.deepEqual(cards.map((card) => ({ id: card.placeId, canAdd: card.canAdd, actionLabel: card.actionLabel, footerNote: card.footerNote })), [
      { id: "temple", canAdd: false, actionLabel: undefined, footerNote: "2026-10-01 09:00" },
      { id: "tea", canAdd: true, actionLabel: "Add", footerNote: undefined },
      { id: "context", canAdd: false, actionLabel: undefined, footerNote: undefined }
    ]);
    assert.equal(cards.some((card) => /available|informational|in itinerary/i.test([card.footerNote, card.actionLabel].filter(Boolean).join(" "))), false);
    assert.equal(cards.some((card) => /Higashiyama|Kyoto/i.test(card.tags.join(" "))), false);
  });

  it("filters guide cards by sub-branch and state", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple", area: "Higashiyama" }),
        place("ramen", { category: "restaurant ramen", area: "Central" }),
        place("product", { category: "local product theme", area: "Central" })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["temple"], stops: [{ placeId: "temple", order: 1 }] }]
    });
    const cards = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards;
    assert.deepEqual(filterGuideCards(cards, { type: "dining", state: "unscheduled" }).map((card) => card.placeId), ["ramen"]);
    assert.deepEqual(filterGuideCards(cards, { type: "all", state: "informational" }).map((card) => card.placeId), ["product"]);
  });

  it("builds a pending itinerary edit with lightweight placement advisories", () => {
    const presentation = presentationFixture({
      places: [
        ...presentationFixture().places,
        place("osaka-dinner", { city: "Osaka", area: "Namba", category: "restaurant", reservation: { requirement: "required", verification: "needs_recheck", note: "Book ahead." } })
      ],
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "lunch", destinationPlaceId: "craft", mode: "walking", verification: "needs_verification", sourceRefs: [] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "osaka-dinner", { dayId: "day-1", positionId: "after-lunch" });
    assert.equal(edit.dayLabel, "2026-10-01");
    assert.equal(edit.positionLabel, "After lunch");
    assert.equal("meaning" in (edit as unknown as Record<string, unknown>), false);
    assert(edit.advisories.some((advisory) => /Osaka/.test(advisory.text)));
    assert(edit.advisories.some((advisory) => /Reservation/.test(advisory.text)));
    assert(edit.advisories.some((advisory) => /route context/.test(advisory.text)));
  });

  it("inserts pending edits into the display sequence without changing saved blocks", () => {
    const presentation = presentationFixture({ places: [...presentationFixture().places, place("tea", { category: "tea ceremony experience" })] });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const preview = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.deepEqual(preview.items.map((item) => item.kind === "pending" ? `pending:${item.placeId}` : item.placeId), ["temple", "lunch", "pending:tea", "craft"]);
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => item.placeId), ["temple", "lunch", "craft"]);
  });

  it("previews same-day drag reorder as a pending itinerary edit", () => {
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(), presentationFixture());
    const edit = buildPendingItineraryMoveForWorkspace(workspace, { dayId: "day-1", placeId: "craft", position: { kind: "after", afterPlaceId: "temple" } });
    assert.ok(edit);
    assert.equal(edit.kind, "move_place_within_day");
    assert.equal(edit.positionLabel, "After temple");
    const preview = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.deepEqual(preview.items.map((item) => item.placeId), ["temple", "craft", "lunch"]);
    assert.deepEqual(preview.items.map((item) => item.timeLabel), ["09:30", "Around lunch", "Afternoon"]);
    assert.equal(preview.items.find((item) => item.placeId === "craft")?.statusLabel, "Not saved");
    assert.equal(preview.items.find((item) => item.placeId === "craft")?.editState, "moved");
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => item.placeId), ["temple", "lunch", "craft"]);
  });

  it("allows timed itinerary labels but not reserved cards to be staged for drag reorder", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("ticket", { category: "museum", reservation: { requirement: "required", verification: "needs_recheck", note: "Timed entry." } }),
        place("coffee", { category: "coffee cafe" })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["temple", "ticket", "coffee"], stops: [{ placeId: "temple", order: 1, time: "09:30" }, { placeId: "ticket", order: 2 }, { placeId: "coffee", order: 3 }] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => ({ id: item.placeId, reorderable: Boolean(item.reorderable) })), [
      { id: "temple", reorderable: true },
      { id: "ticket", reorderable: false },
      { id: "coffee", reorderable: true }
    ]);
    assert.equal(buildPendingItineraryMoveForWorkspace(workspace, { dayId: "day-1", placeId: "temple", position: { kind: "end" } })?.kind, "move_place_within_day");
    assert.equal(buildPendingItineraryMoveForWorkspace(workspace, { dayId: "day-1", placeId: "ticket", position: { kind: "end" } }), undefined);
  });

  it("accumulates pending itinerary edits by day with pending map markers", () => {
    const presentation = presentationFixture({
      places: [
        ...presentationFixture().places,
        place("tea", { name: "Tea Studio", category: "tea ceremony experience", coordinates: [35.15, 135.15] }),
        place("garden", { name: "Moss Garden", category: "garden", coordinates: [35.3, 135.3] })
      ],
      days: [
        presentationFixture().days[0]!,
        { id: "day-2", label: "October 2", date: "2026-10-02", city: "Kyoto", placeIds: [], stops: [], candidates: ["garden"] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const tea = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const garden = buildPendingItineraryEditForWorkspace(workspace, "garden", { dayId: "day-2", positionId: "end" });
    const dayOne = itineraryDisplayForWorkspace(workspace, "day-1", [tea, garden]);
    const dayTwo = itineraryDisplayForWorkspace(workspace, "day-2", [tea, garden]);
    assert.deepEqual(dayOne.items.map((item) => item.kind === "pending" ? `pending:${item.placeId}` : item.placeId), ["temple", "lunch", "pending:tea", "craft"]);
    assert.deepEqual(dayOne.markers.find((marker) => marker.placeId === "tea"), { placeId: "tea", title: "Tea Studio", type: "experience", coordinates: [35.15, 135.15], markerState: "pending" });
    assert.deepEqual(dayTwo.items.map((item) => item.kind === "pending" ? `pending:${item.placeId}` : item.placeId), ["pending:garden"]);
    assert.deepEqual(dayTwo.markers.map((marker) => ({ id: marker.placeId, state: marker.markerState })), [{ id: "garden", state: "pending" }]);
  });

  it("turns staged itinerary edits into an explicit Landi update request", () => {
    const presentation = presentationFixture({ places: [...presentationFixture().places, place("tea", { name: "Tea Studio", category: "tea ceremony experience" })] });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const request = pendingItineraryEditRequest(edit);
    assert.match(request, /Apply this confirmed itinerary edit directly to the plan/);
    assert.match(request, /Add Tea Studio to 2026-10-01\./);
    assert.match(request, /Placement: After lunch/);
    assert.doesNotMatch(request, /replacement draft|review changes/i);
    assert.equal(/candidate|best|default recommendation|scheduled stop|optional flexible stop/i.test(request), false);
  });

  it("turns multiple staged itinerary edits into one Landi update request", () => {
    const presentation = presentationFixture({ places: [...presentationFixture().places, place("tea", { name: "Tea Studio", category: "tea ceremony experience" })] });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const tea = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const craft = buildPendingItineraryEditForWorkspace(workspace, "craft", { dayId: "day-1", positionId: "end" });
    const request = pendingItineraryEditBatchRequest([tea, craft]);
    assert.match(request, /Apply these 2 confirmed itinerary edits directly to the plan in one update/);
    assert.match(request, /1\. Add Tea Studio to 2026-10-01\. Placement: After lunch\./);
    assert.match(request, /2\. Add craft to 2026-10-01\. Placement: At the end of the day\./);
    assert.match(request, /city compatibility/);
    assert.doesNotMatch(request, /replacement draft|review changes/i);
  });

  it("supports itinerary placement preview from the workspace read model", () => {
    const presentation = presentationFixture({ places: [...presentationFixture().places, place("tea", { name: "Tea Studio", category: "tea ceremony experience" })] });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.deepEqual(display.items.map((item) => item.kind === "pending" ? `pending:${item.placeId}` : item.placeId), ["temple", "lunch", "pending:tea", "craft"]);
    assert.equal(display.markers.some((marker) => marker.placeId === "tea" && marker.markerState === "pending"), true);
    assert.deepEqual(display.routePlaces.map((item) => item.id), ["temple", "lunch", "craft"]);
  });

  it("builds itinerary cards and map markers from the day display contract", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple", name: "Kiyomizu-dera Temple", localizedName: "清水寺", coordinates: [35.0, 135.0] }),
        place("lunch", { category: "restaurant", coordinates: [35.1, 135.1] }),
        place("craft", { category: "shopping craft store", coordinates: [35.2, 135.2] }),
        place("tea", { category: "tea ceremony experience", coordinates: [35.15, 135.15] }),
        place("outside", { category: "museum", coordinates: [34.9, 134.9] })
      ],
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "verified", label: "Short walk", detail: "Use the covered shopping lane if it rains.", durationMinutes: 12, sourceRefs: ["https://guide.example"] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [{ title: "Rain route guide", url: "https://guide.example", authority: "Guide", retrievedAt: "2026-09-02" }] }), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.deepEqual(display.items.map((item) => item.title), ["Kiyomizu-dera Temple · 清水寺", "lunch", "tea", "craft"]);
    assert.deepEqual(display.items.map((item) => item.timeLabel), ["09:30", "Around lunch", "Draft", "Flexible afternoon"]);
    assert.deepEqual(display.items.map((item) => item.kind === "pending" ? item.statusLabel : undefined), [undefined, undefined, "Not saved", undefined]);
    assert.deepEqual(display.routePlaces.map((item) => item.id), ["temple", "lunch", "craft"]);
    assert.deepEqual(display.routeSegments.map((segment) => segment.id), ["route-1"]);
    assert.deepEqual(display.routeSegments.map((segment) => ({ detail: segment.detail, source: segment.sources[0]?.summary })), [{ detail: "Use the covered shopping lane if it rains.", source: "Rain route guide · Guide · 2026-09-02" }]);
    assert.deepEqual(display.markers.map((marker) => ({ id: marker.placeId, state: marker.markerState, type: marker.type, coordinates: marker.coordinates, hasLabel: "label" in marker })), [
      { id: "temple", state: "on-day", type: "attraction", coordinates: [35.0, 135.0], hasLabel: false },
      { id: "lunch", state: "on-day", type: "dining", coordinates: [35.1, 135.1], hasLabel: false },
      { id: "craft", state: "on-day", type: "shopping", coordinates: [35.2, 135.2], hasLabel: false },
      { id: "tea", state: "pending", type: "experience", coordinates: [35.15, 135.15], hasLabel: false }
    ]);
  });

  it("sanitizes preparation checklist items for the Web workspace", () => {
    const plan = planFixture(undefined, {
      stages: [{
        id: "stage-entry",
        title: "Travel authorization",
        description: "Entry preparation.",
        presentationKind: "details",
        tasks: [{
          id: "task-entry",
          title: "Prepare Japan arrival information",
          description: "Review official entry rules before departure.",
          owner: "user",
          status: "waiting_user",
          dueLabel: "2026-09-25",
          preparationCategory: "documents"
        }]
      }]
    });
    const item = buildBlueprintWorkspaceDisplay(plan, plan.presentation!).preparationGroups[0]?.items[0] as unknown as Record<string, unknown>;
    assert.equal(item.title, "Prepare Japan arrival information");
    assert.equal(item.description, "Review official entry rules before departure.");
    assert.equal(item.checked, false);
    assert.equal("dueLabel" in item, false);
    assert.equal("stageTitle" in item, false);
    assert.equal("preparationCategory" in item, false);
  });

  it("keeps text-only guide cards free of source marker fields", () => {
    const presentation = presentationFixture({
      places: [place("sourced", { evidenceSources: [{ title: "Official hours", url: "https://example.com", role: "Opening hours", status: "verified", checkedAt: "2026-09-01" }] })],
      days: []
    });
    const card = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards[0] as unknown as Record<string, unknown>;
    assert.equal("source" in card, false);
  });

  it("lists detail sources without duplicating matching source refs", () => {
    const presentation = presentationFixture({
      places: [place("sourced", {
        evidenceSources: [{ title: "Official hours", url: "https://example.com", role: "Opening hours", status: "verified", checkedAt: "2026-09-01" }],
        sourceRefs: ["https://example.com", "https://guide.example"]
      })],
      days: []
    });
    const sources = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [{ title: "Guide article", url: "https://guide.example", authority: "Guide", retrievedAt: "2026-09-02" }] }), presentation), "sourced")?.sources ?? [];
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.summary, "Official hours · Opening hours · checked 2026-09-01");
    assert.equal(sources[1]?.summary, "Guide article · Guide · 2026-09-02");
  });

  it("does not repeat source-attached wording in the sources list", () => {
    const plan = planFixture(presentationFixture(), { sources: [{ title: "Official guide", url: "https://example.com", authority: "Official", retrievedAt: "2026-09-01" }] });
    assert.deepEqual(buildBlueprintWorkspaceDisplay(plan, plan.presentation!).sources.map((source) => source.summary), ["Official guide · Official · 2026-09-01"]);
  });

  it("filters tips to destination-relevant practical cautions", () => {
    const localTip = "Temple etiquette is quiet; check local photo rules before entering, avoid blocking the approach, and step aside before adjusting bags or umbrellas near the gate.";
    const plan = planFixture(presentationFixture({ places: [
        place("local", { tip: localTip }),
        place("generic", { tip: "Rest early and enjoy the journey." })
      ] }));
    const tips = buildBlueprintWorkspaceDisplay(plan, plan.presentation!).tipGroups.flatMap((group) => group.tips);
    assert.equal(tips.length, 1);
    assert.match(tips[0]?.body ?? "", /Temple etiquette/);
    assert.equal(tips[0]?.body, localTip);
    assert.equal("source" in (tips[0] as unknown as Record<string, unknown>), false);
  });

  it("groups destination tips by practical theme", () => {
    const plan = planFixture(presentationFixture({ places: [
      place("pay", { tip: "Cash is useful at small local counters in Kyoto markets." }),
      place("rail", { tip: "Train stations in Kyoto use numbered exits; check the exit before leaving the platform." })
    ] }));
    assert.deepEqual(buildBlueprintWorkspaceDisplay(plan, plan.presentation!).tipGroups.map((group) => group.theme), ["Payment", "Transport"]);
  });

  it("keeps comparison rows factual and includes effort signals", () => {
    const presentation = presentationFixture({ places: [
      place("selected", { category: "restaurant", area: "Central" }),
      place("recheck", { category: "restaurant", area: "Central", priority: "recheck" }),
      place("official", { category: "restaurant", area: "North", officialUrl: "https://example.com" })
    ] });
    const rows = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation), "selected")?.comparisonRows ?? [];
    assert.deepEqual(rows.map((row) => row.effort), ["Recheck before use", "Official link saved"]);
    assert.deepEqual(rows.map((row) => row.routeFit), ["Same area", "Same city"]);
  });

  it("builds detail display without a separate category eyebrow", () => {
    const presentation = presentationFixture({ places: [
      place("selected", { category: "restaurant", area: "Central", officialUrl: "https://example.com", reservation: { requirement: "required", verification: "verified", note: "Book a dinner seat before the route is finalized." } }),
      place("nearby", { category: "restaurant", area: "Central" })
    ] });
    const detail = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation), "selected")!;
    const exposed = detail as unknown as Record<string, unknown>;
    assert.equal(detail.title, "selected");
    assert.equal(detail.primaryActionLabel, "Add to itinerary");
    assert.equal(detail.reservationNote, "Book a dinner seat before the route is finalized.");
    assert.equal(detail.comparisonTitle, "Compare dining nearby");
    assert.deepEqual(detail.links, [{ label: "Official site", url: "https://example.com" }]);
    assert.equal("subtitle" in exposed, false);
    assert.equal("eyebrow" in exposed, false);
    assert.equal("typeLabel" in exposed, false);
    assert.equal("categoryLabel" in exposed, false);
  });

  it("does not invent precise times for flexible blocks", () => {
    const presentation = presentationFixture({
      places: [place("garden", { category: "garden" }), place("meal", { category: "restaurant" }), place("market", { category: "shopping market" })],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["garden", "meal", "market"], stops: [{ placeId: "garden", order: 1 }, { placeId: "meal", order: 2, role: "dinner" }, { placeId: "market", order: 4 }] }]
    });
    assert.deepEqual(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items.map((item) => item.timeLabel), ["Morning", "Dinner window", "Flexible afternoon"]);
  });

  it("keeps route verification out of itinerary card status", () => {
    const presentation = presentationFixture({
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "needs_verification", sourceRefs: [] }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;
    assert.equal(itinerary.items[0]?.statusLabel, undefined);
    assert.equal(itinerary.routeSegments[0]?.verification, "needs_verification");
  });

  it("keeps only action-relevant itinerary card status", () => {
    const presentation = presentationFixture({
      places: [place("reserved", { reservation: { requirement: "required", verification: "verified", note: "Timed entry." } })],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["reserved"], stops: [{ placeId: "reserved", order: 1 }] }]
    });
    assert.equal(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items[0]?.statusLabel, "Reservation required");
  });

  it("links related events to place details without adding itinerary blocks", () => {
    const presentation = presentationFixture({
      events: [{ id: "festival", title: "Local festival", description: "Expect nearby evening crowds.", startDate: "2026-10-01", locationLabel: "Central Kyoto", placeId: "temple", sourceRefs: ["https://guide.example"] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [{ title: "Event guide", url: "https://guide.example", authority: "Guide", retrievedAt: "2026-09-02" }] }), presentation);
    const detail = detailDisplayForWorkspacePlace(workspace, "temple")!;
    assert.deepEqual(detail.relatedEvents.map((event) => ({ title: event.title, dateLabel: event.dateLabel, source: event.sources[0]?.summary })), [{ title: "Local festival", dateLabel: "2026-10-01", source: "Event guide · Guide · 2026-09-02" }]);
    assert.equal(workspace.itineraries[0]?.items.some((item) => item.placeId === "festival"), false);
    assert.equal(workspace.sources.some((source) => source.summary === "Event guide · Guide · 2026-09-02"), true);
  });
});
