import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { BlueprintItineraryBlock, DirectBlueprintRevisionBatchMetadata, Plan, PlanPlace, PlanPresentation } from "@c-assistant/core";
import { MAP_COORDINATES_PENDING_WORKSPACE_REASON, appliedItineraryRevisionSummary, buildBlueprintWorkspaceDisplay, buildPendingItineraryEditForWorkspace, buildPendingItineraryMoveForWorkspace, buildPendingItineraryRemoveForWorkspace, compactPendingItineraryEdits, deriveTimelineFeaturePlaceCardModel, deriveTimelinePlaceMeta, deriveTimelineTimeDisplay, deriveTimelineTitle, detailDisplayForWorkspacePlace, filterGuideCards, guideCardsForWorkspace, itineraryCardImageCandidateForRender, itineraryCardImageForRender, itineraryDisplayForWorkspace, itineraryTimelineNodesForItems, mergePendingItineraryEdit, pendingItineraryDraftSummary, pendingItineraryEditBatchRequest, pendingItineraryEditRequest, scheduledDayIdForPlace, timelineVisualPrimitiveForItem } from "./landi-blueprint-workspace-display.js";

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

describe("daily accommodation anchors", () => {
  it("keeps a recommended hotel not booked and exposes only evidence-backed actions", () => {
    const presentation = presentationFixture({
      places: [
        place("hotel", {
          name: "Sourced Ubud Hotel",
          category: "hotel",
          accommodation: { state: "recommended", baseLabel: "Ubud", stayStartDate: "2026-10-05", stayEndDate: "2026-10-09", rationale: "Keeps central Ubud days compact." },
          bookingUrl: "https://booking.example/hotel"
        }),
        place("museum", { name: "Museum Puri Lukisan", category: "museum" })
      ],
      days: [{
        id: "ubud-day",
        label: "Oct 8",
        date: "2026-10-08",
        city: "Bali",
        placeIds: ["museum"],
        startContext: { label: "Sourced Ubud Hotel", status: "recommended_property", placeId: "hotel" },
        endContext: { label: "Sourced Ubud Hotel", status: "recommended_property", placeId: "hotel" },
        blocks: [
          { id: "start", kind: "lodging", order: 1, placeId: "hotel", title: "Start · Sourced Ubud Hotel", startTime: "09:00", display: { timeLabel: "09:00", timingStatus: "planned" }, evidence: [] },
          { id: "museum", kind: "stop", order: 2, placeId: "museum", title: "Museum Puri Lukisan", startTime: "09:20", endTime: "11:20", display: { timeLabel: "09:20–11:20", timingStatus: "planned" }, evidence: [] },
          { id: "return", kind: "lodging", order: 3, placeId: "hotel", title: "Return · Sourced Ubud Hotel", startTime: "20:20", display: { timeLabel: "20:20", timingStatus: "planned" }, evidence: [] }
        ]
      }],
      routeSegments: []
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const items = workspace.itineraries[0]!.items;
    assert.deepEqual(items.map((item) => [item.title, item.timeLabel, item.timelineRole, item.statusLabel]), [
      ["Sourced Ubud Hotel", "09:00", "rest", "Recommended · Not booked"],
      ["Museum Puri Lukisan", "09:20–11:20", "place", undefined],
      ["Sourced Ubud Hotel", "20:20", "rest", undefined]
    ]);
    assert.equal(items[0]?.externalAction, undefined);
    assert.equal(items[0]?.image, undefined);
    assert.equal(items[2]?.externalAction, undefined);
    assert.deepEqual(workspace.guideFilters, ["attraction", "dining", "shopping", "experience"]);
  });

  it("does not fabricate a Book action when a recommendation has no supported URL", () => {
    const presentation = presentationFixture({
      places: [place("hotel", { name: "Sourced Hotel", category: "hotel", accommodation: { state: "recommended" } })],
      days: [{ id: "d", label: "Day", date: "2026-10-08", city: "Bali", placeIds: [], blocks: [{ id: "hotel", kind: "lodging", order: 1, placeId: "hotel", title: "Start", startTime: "08:30", evidence: [] }] }],
      routeSegments: []
    });
    assert.equal(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!.items[0]?.externalAction, undefined);
  });

  it("shows a recommended hotel as the accommodation place and makes the morning meal order explicit", () => {
    const hotelImage = { url: "https://images.example/hotel.jpg", alt: "Recommended Ubud hotel", sourceId: "hotel-photo", usage: ["detail" as const] };
    const presentation = presentationFixture({
      places: [place("hotel", { name: "Bisma Eight Hotel", city: "Ubud", area: "Central Ubud", category: "boutique hotel", accommodation: { state: "recommended", baseLabel: "Ubud" }, images: [hotelImage] }), place("ridge", { name: "Campuhan Ridge Walk", category: "ridge walk" })],
      days: [
        { id: "arrival", label: "Arrival", date: "2026-10-05", city: "Bali", placeIds: [], blocks: [{ id: "check-in", kind: "lodging", order: 1, placeId: "hotel", title: "Check-in and recovery", summary: "Check in, settle luggage, shower, hydrate, and rest. Property is a route anchor only until booked.", startTime: "15:00", evidence: [] }] },
        { id: "ubud", label: "Ubud", date: "2026-10-06", city: "Bali", placeIds: ["ridge"], blocks: [
          { id: "morning", kind: "lodging", order: 1, placeId: "hotel", title: "Depart the Ubud base", summary: "Leave after a light breakfast with water and sun protection.", startTime: "07:15", evidence: [] },
          { id: "ridge", kind: "stop", order: 2, placeId: "ridge", title: "Campuhan Ridge Walk", startTime: "07:45", endTime: "09:15", evidence: [] },
          { id: "breakfast", kind: "meal", order: 3, title: "Breakfast recovery and hydration", summary: "Pause near central Ubud after the walk.", startTime: "09:30", evidence: [] },
          { id: "rest", kind: "rest", order: 4, placeId: "hotel", title: "Hotel rest", summary: "Return for quiet recovery.", startTime: "15:00", evidence: [] },
          { id: "return", kind: "lodging", order: 5, placeId: "hotel", title: "Return to lodging", startTime: "20:15", evidence: [] }
        ] }
      ],
      routeSegments: []
    });
    const before = structuredClone(presentation);
    const itineraries = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries;
    const arrival = itineraries[0]!.items[0]!;
    const [morning, ridge, breakfast, rest, evening] = itineraries[1]!.items;

    assert.deepEqual([arrival.title, arrival.placeMeta, arrival.purpose, arrival.statusLabel, arrival.image], ["Bisma Eight Hotel", "Hotel · Ubud", "Proposed arrival base for luggage and recovery.", "Recommended · Not booked", { url: hotelImage.url, alt: hotelImage.alt }]);
    assert.deepEqual([morning?.title, morning?.placeMeta, morning?.purpose, Boolean(morning?.image)], ["Bisma Eight Hotel", "Hotel · Ubud", "Light breakfast, then depart.", true]);
    assert.equal(ridge?.title, "Campuhan Ridge Walk");
    assert.equal(breakfast?.title, "Post-walk breakfast");
    assert.deepEqual([rest?.title, rest?.timelineRole, rest?.purpose, rest?.image], ["Bisma Eight Hotel", "rest", "Rest and recover at the hotel.", undefined]);
    assert.deepEqual([evening?.title, evening?.purpose, evening?.image], ["Bisma Eight Hotel", "Return to the hotel.", undefined]);
    assert.deepEqual(presentation, before);
  });

  it("shows the accommodation CTA only for first check-in and keeps ordinary hotel rows compact", () => {
    const presentation = presentationFixture({
      places: [place("hotel", { name: "Bisma Eight", category: "hotel", accommodation: { state: "recommended" }, officialUrl: "https://hotel.example/", images: [{ url: "https://hotel.example/card.jpg", alt: "Hotel", sourceId: "photo", usage: ["card"] }] }), place("airport", { category: "airport" })],
      days: [{
        id: "arrival", label: "Arrival", date: "2026-10-05", city: "Bali", placeIds: ["airport"],
        startContext: { label: "DPS", status: "transport_node", placeId: "airport" }, endContext: { label: "Bisma Eight", status: "recommended_property", placeId: "hotel" },
        blocks: [
          { id: "check-in", kind: "lodging", order: 1, placeId: "hotel", title: "Check-in and recovery", startTime: "15:00", endTime: "17:00", display: { timeLabel: "15:00–17:00", timingStatus: "planned" }, evidence: [] },
          { id: "rest", kind: "rest", order: 2, placeId: "hotel", title: "Hotel rest", startTime: "17:00", endTime: "18:00", display: { timeLabel: "17:00–18:00", timingStatus: "planned" }, evidence: [] },
          { id: "check-out", kind: "lodging", order: 3, placeId: "hotel", title: "Check-out and luggage preparation", summary: "Prepare for airport check-in.", startTime: "18:00", endTime: "18:30", display: { timeLabel: "18:00–18:30", timingStatus: "planned" }, evidence: [] }
        ]
      }], routeSegments: []
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!.items;
    assert.deepEqual(items[0]?.externalAction, { label: "Check availability", url: "https://hotel.example/" });
    assert.ok(items[0]?.image);
    assert.equal(items[1]?.externalAction, undefined);
    assert.equal(items[1]?.image, undefined);
    assert.equal(items[2]?.externalAction, undefined);
    assert.equal(items[2]?.image, undefined);
  });

  it("keeps full itinerary titles and descriptions in the left information rail", () => {
    const description = "Check passport validity, onward itinerary, current entry requirements, and every document needed before leaving for the airport.";
    const presentation = presentationFixture({
      days: [{
        id: "departure", label: "Departure", date: "2026-10-03", city: "Los Angeles", placeIds: [],
        blocks: [{ id: "documents", kind: "flexible", order: 1, title: "Final document and entry-requirement review", summary: description, startTime: "10:00", evidence: [] }]
      }],
      routeSegments: []
    });
    const item = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!.items[0]!;
    assert.equal(item.title, "Final document and entry-requirement review");
    assert.equal(item.meta, description);
    assert.equal(item.meta?.includes("…"), false);
  });

  it("keeps the confirmed clock value while prioritizing an operating-details recheck status", () => {
    const presentation = presentationFixture({
      places: [place("airport", { name: "DPS", category: "airport", priority: "recheck" })],
      days: [{ id: "departure", label: "Departure", date: "2026-10-12", city: "Bali", placeIds: ["airport"], blocks: [{ id: "flight", kind: "event", order: 1, placeId: "airport", title: "Departure from DPS", startTime: "17:10", display: { timeLabel: "17:10", meta: "Confirmed time", timingStatus: "confirmed" }, operationalConditions: [{ kind: "recheck", note: "Reconfirm terminal and carrier details before travel." }], evidence: [] }] }],
      routeSegments: []
    });
    const item = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!.items[0]!;
    assert.equal(item.timeLabel, "17:10");
    assert.equal(item.statusLabel, "Needs recheck");
    assert.match(item.meta ?? "", /Recheck operating details: Reconfirm terminal and carrier details/i);
  });

  it("suppresses a semantic transfer when the same endpoints have a formal route", () => {
    const presentation = presentationFixture({
      places: [place("museum", { name: "Museum Puri Lukisan" }), place("dinner", { name: "Hujan Locale", category: "restaurant" })],
      days: [{
        id: "d",
        label: "Day",
        date: "2026-10-08",
        city: "Bali",
        placeIds: ["museum", "dinner"],
        blocks: [
          { id: "museum", kind: "stop", order: 1, placeId: "museum", title: "Museum Puri Lukisan", evidence: [] },
          { id: "duplicate", kind: "transfer", order: 2, title: "Museum Puri Lukisan to Hujan Locale", evidence: [] },
          { id: "dinner", kind: "meal", order: 3, placeId: "dinner", title: "Hujan Locale", evidence: [] }
        ]
      }],
      routeSegments: [{ id: "route", dayId: "d", originPlaceId: "museum", destinationPlaceId: "dinner", mode: "walking", verification: "verified", durationMinutes: 10, distanceMeters: 698, display: { showAsFormalRoute: true, mapLineState: "formal" }, sourceRefs: [] }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;
    assert.deepEqual(itinerary.items.map((item) => item.title), ["Museum Puri Lukisan", "Hujan Locale"]);
    assert.deepEqual(itineraryTimelineNodesForItems(itinerary.items).map((node) => node.kind === "movement" ? node.label : node.item.title), ["Museum Puri Lukisan", "10 min walk", "Hujan Locale"]);
  });
});

describe("compact Timeline presentation", () => {
  const hotel = place("hotel", { name: "Bisma Eight Hotel", category: "hotel", accommodation: { state: "recommended" } });
  const attraction = place("ridge", { name: "Campuhan Ridge Walk", category: "walking attraction" });
  const cookingClass = place("jala", { name: "Jala Cooking Academy", category: "cooking class experience" });
  const tastingMenu = place("locavore", { name: "Locavore NXT", category: "tasting menu restaurant" });

  it("derives point, range, and none without mutating complete timing data", () => {
    const cases: Array<[BlueprintItineraryBlock, PlanPlace | undefined, { mode: "point" | "range" | "none"; label?: string }]> = [
      [{ id: "depart", kind: "lodging", order: 1, placeId: "hotel", title: "Depart the Ubud base", startTime: "07:15", endTime: "07:30", durationMinutes: 15, evidence: [] }, hotel, { mode: "point", label: "07:15" }],
      [{ id: "return", kind: "lodging", order: 1, placeId: "hotel", title: "Return to the Ubud base", startTime: "20:15", evidence: [] }, hotel, { mode: "point", label: "20:15" }],
      [{ id: "walk", kind: "stop", order: 1, placeId: "ridge", title: "Walk", startTime: "07:45", endTime: "09:15", durationMinutes: 90, evidence: [] }, attraction, { mode: "range", label: "07:45–09:15" }],
      [{ id: "breakfast", kind: "meal", order: 1, title: "Breakfast recovery", startTime: "09:30", endTime: "10:30", durationMinutes: 60, evidence: [] }, undefined, { mode: "point", label: "09:30" }],
      [{ id: "lunch", kind: "meal", order: 1, title: "Driver-assisted lunch in the return corridor", startTime: "12:30", endTime: "14:30", durationMinutes: 120, evidence: [] }, undefined, { mode: "point", label: "12:30" }],
      [{ id: "rest", kind: "rest", order: 1, title: "Hotel rest during the hottest part of the afternoon", startTime: "15:00", endTime: "16:30", durationMinutes: 90, evidence: [] }, undefined, { mode: "point", label: "15:00" }],
      [{ id: "class", kind: "meal", order: 1, placeId: "jala", title: "Cooking class", startTime: "09:30", endTime: "13:30", durationMinutes: 240, evidence: [] }, cookingClass, { mode: "range", label: "09:30–13:30" }],
      [{ id: "menu", kind: "meal", order: 1, placeId: "locavore", title: "Tasting menu", startTime: "18:00", endTime: "21:00", durationMinutes: 180, evidence: [] }, tastingMenu, { mode: "range", label: "18:00–21:00" }],
      [{ id: "move", kind: "transfer", order: 1, title: "Walk to museum", startTime: "10:34", endTime: "10:45", durationMinutes: 11, evidence: [] }, undefined, { mode: "none" }]
    ];
    for (const [block, concretePlace, expected] of cases) {
      const before = structuredClone(block);
      assert.deepEqual(deriveTimelineTimeDisplay(block, concretePlace), expected);
      assert.deepEqual(block, before);
    }
  });

  it("uses canonical place names and deterministic short supporting titles", () => {
    assert.equal(deriveTimelineTitle({ id: "place", kind: "stop", order: 1, placeId: "ridge", title: "Visit Campuhan Ridge Walk", evidence: [] }, attraction), "Campuhan Ridge Walk");
    assert.equal(deriveTimelineTitle({ id: "start", kind: "lodging", order: 1, title: "Depart the Ubud base", evidence: [] }, hotel), "Bisma Eight Hotel");
    assert.equal(deriveTimelineTitle({ id: "return", kind: "lodging", order: 1, title: "End at the Ubud base", evidence: [] }, hotel), "Bisma Eight Hotel");
    assert.equal(deriveTimelineTitle({ id: "breakfast", kind: "meal", order: 1, title: "Breakfast and packing", evidence: [] }, hotel), "Bisma Eight Hotel");
    assert.equal(deriveTimelineTitle({ id: "rest", kind: "rest", order: 1, title: "Hotel rest during the hottest part of the afternoon", evidence: [] }), "Hotel rest");
    assert.equal(deriveTimelineTitle({ id: "lunch", kind: "meal", order: 1, title: "Driver-assisted lunch in the Tampaksiring or return corridor", evidence: [] }), "Lunch");
    assert.equal(deriveTimelineTitle({ id: "processing", kind: "transfer", order: 1, title: "International check-in, security, and departure processing", evidence: [] }), "Airport processing");
    assert.equal(deriveTimelineTitle({ id: "arrival", kind: "transfer", order: 1, title: "Transfer and admission procedures at Uluwatu", evidence: [] }), "Uluwatu arrival");
  });

  it("hides planned labels, exposes material timing statuses, and keeps ordinary lodging compact", () => {
    const presentation = presentationFixture({
      places: [hotel],
      days: [{ id: "d", label: "Day", date: "2026-10-06", city: "Bali", placeIds: [], startContext: { label: "Bisma Eight Hotel", status: "recommended_property", placeId: "hotel" }, endContext: { label: "Bisma Eight Hotel", status: "recommended_property", placeId: "hotel" }, blocks: [
        { id: "start", kind: "lodging", order: 1, placeId: "hotel", title: "Depart the Ubud base", startTime: "07:15", endTime: "07:30", display: { timeLabel: "07:15–07:30", meta: "Planned time", timingStatus: "planned" }, evidence: [] },
        { id: "estimated", kind: "rest", order: 2, title: "Rest", startTime: "12:00", display: { timingStatus: "estimated" }, evidence: [] },
        { id: "confirmed", kind: "event", order: 3, title: "Departure", startTime: "17:10", display: { timeLabel: "17:10", timingStatus: "confirmed" }, evidence: [] },
        { id: "recheck", kind: "event", order: 4, title: "Performance", startTime: "19:00", display: { timeLabel: "19:00", timingStatus: "recheck" }, evidence: [] },
        { id: "return", kind: "lodging", order: 5, placeId: "hotel", title: "Return to the Ubud base", startTime: "20:15", display: { timingStatus: "planned" }, evidence: [] }
      ] }],
      routeSegments: []
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!.items;
    assert.deepEqual(items.map((item) => item.statusLabel), ["Recommended · Not booked", "Estimated", "Confirmed", "Needs recheck", undefined]);
    assert.equal(items[0]?.meta, undefined);
    assert.equal(items[0]?.image, undefined);
    assert.equal(items[0]?.externalAction, undefined);
    assert.equal(items[4]?.image, undefined);
  });

  it("keeps every clock range on one line in the fixed-width time column", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(css, /--timeline-time-column:\s*72px/);
    assert.match(css, /\.blueprint-itinerary-time\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.blueprint-itinerary-time\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  });
});

function placeWithoutCoordinates(id: string, patch: Partial<PlanPlace> = {}): PlanPlace {
  const { coordinates: _coordinates, ...value } = place(id, patch);
  return value;
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
    assert.deepEqual(display.itineraries[0]?.items.map((item) => item.meta), ["Central · Kyoto", "Central · Kyoto", "Central · Kyoto"]);
    assert.deepEqual(display.itineraries[0]?.placementOptions.map((option) => option.id), ["start", "after-temple", "after-lunch", "after-craft", "end"]);
    assert.equal(display.guideCards.length, 3);
    assert.equal(display.details.length, 3);
    assert.equal(detailDisplayForWorkspacePlace(display, "lunch")?.title, "lunch");
    assert.equal(scheduledDayIdForPlace(display, "craft"), "day-1");
    assert.equal("candidates" in (display.days[0] as unknown as Record<string, unknown>), false);
    assert.equal("placeIds" in (display.days[0] as unknown as Record<string, unknown>), false);
    assert.equal(/"category"|"sourceRefs"|"evidenceSources"|"whyWorthIt"|"blocks"|"stops"|"candidates"|"placeIds"/.test(JSON.stringify(display)), false);
  });

  it("classifies itinerary guide material into sub-branches", () => {
    const presentation = presentationFixture({
      places: [
        place("a", { category: "landmark" }),
        place("b", { category: "local dining restaurant" }),
        place("c", { category: "shopping arcade" }),
        place("d", { category: "tea ceremony experience" }),
        place("h", { name: "Hotel A", category: "accommodation hotel" }),
        place("i", { name: "Kyoto Station", category: "rail station transport" }),
        place("e", { category: "shrine", plan: "Visit quietly without blocking worshippers." }),
        place("f", { name: "Kyoto Tower Observation Deck", category: "landmark", plan: "Visit after lunch if the route still feels relaxed." }),
        place("g", { category: "coffee cafe", plan: "Use as a pause after the garden." })
      ],
      days: []
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const typeById = new Map(workspace.guideCards.map((card) => [card.placeId, card.type]));
    assert.equal(typeById.get("a"), "attraction");
    assert.equal(typeById.get("b"), "dining");
    assert.equal(typeById.get("c"), "shopping");
    assert.equal(typeById.get("d"), "experience");
    assert.equal(typeById.has("h"), false);
    assert.equal(typeById.has("i"), false);
    assert.equal(workspace.places.find((item) => item.id === "h")?.markerType, "stay");
    assert.equal(workspace.places.find((item) => item.id === "i")?.markerType, "transport");
    assert.equal(typeById.get("e"), "attraction");
    assert.equal(typeById.get("f"), "attraction");
    assert.equal(typeById.get("g"), "dining");
  });

  it("keeps transport and stay nodes in the itinerary model without Explore tabs or cards", () => {
    const presentation = presentationFixture({
      places: [
        place("hotel", { name: "Hotel A", locationLabel: "1 Rue Example, Paris", category: "confirmed hotel accommodation", priority: "booked", whyWorthIt: "The overnight base for the next morning's route.", plan: "Start the covered mornings from this stay." }),
        place("airport", { name: "Charles de Gaulle Airport", locationLabel: "Roissy-en-France", category: "international airport terminal", priority: "must", whyWorthIt: "Arrival and departure transport node.", plan: "Use as the fixed flight node." }),
        place("station", { name: "Kyoto Station", locationLabel: "Shimogyo, Kyoto", category: "rail station transport", priority: "preferred", whyWorthIt: "Rail connection for the city transfer.", plan: "Use as the transfer node." })
      ],
      days: [{ id: "day-1", label: "October 1", date: "2026-10-01", city: "Paris", placeIds: ["hotel", "airport"], stops: [{ placeId: "hotel", order: 1, time: "09:00" }, { placeId: "airport", order: 2, time: "12:00" }] }]
    });
    const display = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    assert.deepEqual(display.guideFilters, ["attraction", "dining", "shopping", "experience"]);
    assert.deepEqual(display.guideCards, []);
    assert.equal(display.places.find((item) => item.id === "hotel")?.locationLabel, "1 Rue Example, Paris");
    assert.equal(display.places.find((item) => item.id === "hotel")?.markerType, "stay");
    assert.equal(display.places.find((item) => item.id === "airport")?.markerType, "transport");
    assert.equal(display.places.find((item) => item.id === "station")?.markerType, "transport");
  });

  it("renders concrete airports, stations, hotels, and restaurants as place cards with transport between them", () => {
    const image: NonNullable<PlanPlace["images"]>[number] = { url: "https://example.com/card.jpg", alt: "Place photo", sourceId: "source-photo", usage: ["card"] };
    const presentation = presentationFixture({
      places: [
        place("airport", { name: "I Gusti Ngurah Rai International Airport", locationLabel: "Denpasar", city: "Bali", category: "international airport", images: [image] }),
        place("hotel", { name: "Four Seasons Resort Bali at Sayan", locationLabel: "Ubud", city: "Bali", category: "hotel resort", images: [image] }),
        place("tokyo-station", { name: "Tokyo Station", locationLabel: "Marunouchi", city: "Tokyo", category: "rail station", images: [image] }),
        place("kyoto-station", { name: "Kyoto Station", locationLabel: "Shimogyo", city: "Kyoto", category: "rail station", images: [image] }),
        place("forest", { name: "Sacred Monkey Forest Sanctuary", locationLabel: "Ubud", city: "Bali", category: "sanctuary attraction", images: [image] }),
        place("restaurant", { name: "Nusantara by Locavore", locationLabel: "Ubud", city: "Bali", category: "restaurant", images: [image], reservation: { requirement: "required", verification: "verified", note: "Reservation 12:30." } })
      ],
      days: [{
        id: "day-arrival",
        label: "Arrival",
        date: "2026-10-01",
        city: "Bali",
        placeIds: ["airport", "hotel"],
        stops: [{ placeId: "airport", order: 1, time: "13:50" }, { placeId: "hotel", order: 2 }],
        blocks: [
          { id: "arrive", kind: "stop", order: 1, placeId: "airport", startTime: "13:50", title: "Arrive in Bali", evidence: [] },
          { id: "checkin", kind: "lodging", order: 2, placeId: "hotel", title: "Check in", display: { routeAnchor: true }, evidence: [] }
        ]
      }, {
        id: "day-rail",
        label: "Rail day",
        date: "2026-10-02",
        city: "Kyoto",
        placeIds: ["tokyo-station", "kyoto-station"],
        stops: [{ placeId: "tokyo-station", order: 1, time: "09:00" }, { placeId: "kyoto-station", order: 2, time: "11:10" }]
      }, {
        id: "day-places",
        label: "Ubud",
        date: "2026-10-03",
        city: "Bali",
        placeIds: ["forest", "restaurant"],
        stops: [{ placeId: "forest", order: 1, time: "09:00" }, { placeId: "restaurant", order: 2, time: "12:30", role: "lunch" }]
      }],
      routeSegments: [
        { id: "arrival-transfer", dayId: "day-arrival", originPlaceId: "airport", destinationPlaceId: "hotel", mode: "driving", verification: "verified", durationMinutes: 80, sourceRefs: [] },
        { id: "rail", dayId: "day-rail", originPlaceId: "tokyo-station", destinationPlaceId: "kyoto-station", mode: "rail", verification: "verified", durationMinutes: 130, label: "Shinkansen", sourceRefs: [] },
        { id: "walk", dayId: "day-places", originPlaceId: "forest", destinationPlaceId: "restaurant", mode: "walking", verification: "verified", durationMinutes: 6, distanceMeters: 469, sourceRefs: [] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => ({ title: item.title, role: item.timelineRole, meta: item.meta, type: item.type, hasImage: Boolean(item.image) })), [
      { title: "I Gusti Ngurah Rai International Airport", role: "place", meta: "Arrive in Bali", type: "transport", hasImage: true },
      { title: "Four Seasons Resort Bali at Sayan", role: "place", meta: "Check in", type: "stay", hasImage: true }
    ]);
    assert.equal(workspace.itineraries[0]?.items[0]?.routeAfterLabel, "1h 20m drive");
    assert.equal(workspace.itineraries[0]?.items[0]?.routeAfterDetail, "I Gusti Ngurah Rai International Airport -> Four Seasons Resort Bali at Sayan");
    assert.deepEqual(workspace.itineraries[1]?.items.map((item) => item.timelineRole), ["place", "place"]);
    assert.equal(workspace.itineraries[1]?.items[0]?.routeAfterLabel, "2h 10m by rail");
    assert.deepEqual(workspace.itineraries[2]?.items.map((item) => ({ title: item.title, role: item.timelineRole, status: item.statusLabel })), [
      { title: "Sacred Monkey Forest Sanctuary", role: "place", status: undefined },
      { title: "Nusantara by Locavore", role: "place", status: "Reservation required" }
    ]);
    assert.equal(workspace.itineraries[2]?.items[0]?.routeAfterLabel, "6 min walk");
    assert.equal(workspace.itineraries[2]?.items[0]?.routeAfterDetail, "Sacred Monkey Forest -> Nusantara by Locavore · 469 m");
  });

  it("renders movement rows between their formal endpoints without swallowing light rows", () => {
    const presentation = presentationFixture({
      places: [
        place("museum", { name: "Museum Pasifika", category: "museum" }),
        place("jenggala", { name: "Jenggala Jimbaran", category: "ceramics experience" })
      ],
      days: [{
        id: "south-bali",
        label: "Oct 10",
        date: "2026-10-10",
        city: "Bali",
        placeIds: ["museum", "jenggala"],
        stops: [{ placeId: "museum", order: 1, time: "10:00" }, { placeId: "jenggala", order: 2, time: "14:15" }],
        blocks: [
          { id: "museum", kind: "stop", order: 1, placeId: "museum", title: "Museum Pasifika", startTime: "10:00", display: { timeLabel: "10:00-12:00", meta: "Planned time" }, evidence: [] },
          { id: "lunch", kind: "meal", order: 2, title: "Nusa Dua lunch", startTime: "12:15", display: { timeLabel: "12:15-13:30", meta: "Planned time" }, evidence: [] },
          { id: "jenggala", kind: "stop", order: 3, placeId: "jenggala", title: "Jenggala ceramics experience", startTime: "14:15", display: { timeLabel: "14:15-16:15", meta: "Timing needs recheck" }, evidence: [] }
        ]
      }],
      routeSegments: [{ id: "route-1", dayId: "south-bali", originPlaceId: "museum", destinationPlaceId: "jenggala", mode: "driving", verification: "verified", durationMinutes: 24, sourceRefs: [] }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;
    const nodes = itineraryTimelineNodesForItems(itinerary.items);

    assert.deepEqual(nodes.map((node) => node.kind === "item" ? node.item.title : node.label), [
      "Museum Pasifika",
      "Lunch",
      "24 min drive",
      "Jenggala Jimbaran"
    ]);
    assert.deepEqual(nodes.map((node) => node.kind === "item" ? node.item.timelineRole : node.state), ["place", "activity", "confirmed", "place"]);
    assert.equal(itinerary.items[0]?.routeAfterDestinationPlaceId, "jenggala");
    assert.equal(itinerary.items[1]?.routeAfterLabel, undefined);
    assert.equal(itinerary.items[1]?.statusLabel, undefined);
  });

  it("keeps route refresh changes on the movement row without changing semantic item order", () => {
    const basePresentation = presentationFixture({
      places: [
        place("gwk", { name: "Garuda Wisnu Kencana Cultural Park", category: "cultural park" }),
        place("uluwatu", { name: "Uluwatu Temple", category: "temple" })
      ],
      days: [{
        id: "south-bali",
        label: "Oct 11",
        date: "2026-10-11",
        city: "Bali",
        placeIds: ["gwk", "uluwatu"],
        stops: [{ placeId: "gwk", order: 1, time: "11:00" }, { placeId: "uluwatu", order: 2, time: "15:15" }],
        blocks: [
          { id: "gwk", kind: "stop", order: 1, placeId: "gwk", title: "GWK", startTime: "11:00", display: { timeLabel: "11:00-13:00" }, evidence: [] },
          { id: "lunch", kind: "meal", order: 2, title: "Bukit lunch and break", startTime: "13:00", display: { timeLabel: "13:00-14:30", meta: "Planned time" }, evidence: [] },
          { id: "uluwatu", kind: "stop", order: 3, placeId: "uluwatu", title: "Uluwatu Temple and cliff walk", startTime: "15:15", display: { timeLabel: "15:15-17:15" }, evidence: [] }
        ]
      }],
      routeSegments: [{ id: "route-1", dayId: "south-bali", originPlaceId: "gwk", destinationPlaceId: "uluwatu", mode: "driving", verification: "needs_verification", display: { showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] }]
    });
    const refreshedPresentation = {
      ...basePresentation,
      routeSegments: [{ ...basePresentation.routeSegments[0]!, verification: "verified" as const, durationMinutes: 38, display: { showAsFormalRoute: true, mapLineState: "formal" as const } }]
    };
    const before = itineraryTimelineNodesForItems(buildBlueprintWorkspaceDisplay(planFixture(basePresentation), basePresentation).itineraries[0]!.items);
    const after = itineraryTimelineNodesForItems(buildBlueprintWorkspaceDisplay(planFixture(refreshedPresentation), refreshedPresentation).itineraries[0]!.items);
    const semanticTitles = (nodes: ReturnType<typeof itineraryTimelineNodesForItems>) => nodes.map((node) => node.kind === "item" ? node.item.title : "ROUTE");

    assert.deepEqual(semanticTitles(before), ["Garuda Wisnu Kencana Cultural Park", "Lunch", "ROUTE", "Uluwatu Temple"]);
    assert.deepEqual(semanticTitles(after), semanticTitles(before));
    assert.deepEqual(before.map((node) => node.kind === "movement" ? [node.label, node.state] : [node.item.title, node.item.timelineRole]), [
      ["Garuda Wisnu Kencana Cultural Park", "place"],
      ["Lunch", "activity"],
      ["Travel time will be checked automatically.", "pending"],
      ["Uluwatu Temple", "place"]
    ]);
    assert.deepEqual(after.map((node) => node.kind === "movement" ? [node.label, node.state] : [node.item.title, node.item.timelineRole]), [
      ["Garuda Wisnu Kencana Cultural Park", "place"],
      ["Lunch", "activity"],
      ["38 min drive", "confirmed"],
      ["Uluwatu Temple", "place"]
    ]);
  });

  it("does not expose precise route duration labels for unverified movements without evidence", () => {
    const presentation = presentationFixture({
      places: [
        place("forest", { name: "Sacred Monkey Forest Sanctuary", category: "sanctuary attraction" }),
        place("museum", { name: "Museum Puri Lukisan", category: "museum" }),
        place("temple", { name: "Uluwatu Temple", category: "temple" })
      ],
      days: [{
        id: "day-1",
        label: "Oct 8",
        date: "2026-10-08",
        city: "Bali",
        placeIds: ["forest", "museum", "temple"],
        stops: [{ placeId: "forest", order: 1, time: "09:00" }, { placeId: "museum", order: 2, time: "11:00" }, { placeId: "temple", order: 3, time: "15:30" }]
      }],
      routeSegments: [
        { id: "unsupported", dayId: "day-1", originPlaceId: "forest", destinationPlaceId: "museum", mode: "driving", verification: "needs_verification", durationMinutes: 35, sourceRefs: [] },
        { id: "supported", dayId: "day-1", originPlaceId: "museum", destinationPlaceId: "temple", mode: "driving", verification: "needs_verification", durationMinutes: 70, sourceRefs: [], evidence: [{ sourceId: "guide", status: "recheck" }] }
      ],
      sourceCatalog: [{ id: "guide", title: "Route note", authority: "Guide", url: "https://example.com/route", retrievedAt: "2026-09-01", status: "recheck" }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.equal(itinerary.routeSegments[0]?.durationLabel, undefined);
    assert.equal(itinerary.routeSegments[0]?.label, "Travel time to confirm");
    assert.equal(itinerary.routeSegments[1]?.durationLabel, "~70 min");
    assert.equal(itinerary.routeSegments[1]?.label, "~70 min by car");
  });

  it("filters low-value filler blocks while keeping actionable dependencies visible", () => {
    const presentation = presentationFixture({
      places: [],
      days: [{
        id: "day-1",
        label: "Loose day",
        date: "2026-10-01",
        city: "Bali",
        placeIds: [],
        stops: [],
        blocks: [
          { id: "slow", kind: "rest", order: 1, title: "Slow morning", summary: "Jet lag recovery.", evidence: [] },
          { id: "lunch", kind: "meal", order: 2, title: "Lunch near hotel", summary: "Pick something close once the hotel is known.", evidence: [] },
          { id: "dinner", kind: "meal", order: 3, title: "Dinner", summary: "Restaurant TBD", evidence: [] },
          { id: "hotel", kind: "lodging", order: 4, title: "Accommodation", summary: "Hotel not selected", evidence: [] },
          { id: "transfer", kind: "transfer", order: 5, title: "Airport transfer", summary: "Travel mode and time depend on the selected accommodation and live traffic.", evidence: [] }
        ]
      }]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items.map((item) => ({ title: item.title, role: item.timelineRole, type: item.type, meta: item.meta, time: item.timeLabel })), [
      { title: "Dinner", role: "pending_place", type: "dining", meta: "Restaurant TBD", time: "Dinner window" },
      { title: "Accommodation", role: "rest", type: "stay", meta: "Hotel not selected", time: "" },
      { title: "Airport transfer", role: "transport", type: "transport", meta: "Confirm once lodging is set.", time: "" }
    ]);
    assert.deepEqual(presentation.days[0]?.blocks?.map((block) => block.id), ["slow", "lunch", "dinner", "hotel", "transfer"]);
    assert.deepEqual(presentation.days[0]?.stops, []);
    assert.deepEqual(presentation.days[0]?.placeIds, []);
    assert.deepEqual(presentation.routeSegments, []);
    assert.equal(items.some((item) => item.image), false);
    assert.equal(items.some((item) => item.routeAnchor), false);
  });

  it("keeps legacy stop fallback only when day blocks are missing", () => {
    const presentation = presentationFixture({
      places: [place("temple", { name: "Kiyomizu-dera", category: "temple" })],
      days: [{
        id: "day-1",
        label: "Legacy day",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["temple"],
        stops: [{ placeId: "temple", order: 1, time: "09:00" }]
      }]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items.map((item) => ({ title: item.title, time: item.timeLabel, role: item.timelineRole })), [
      { title: "Kiyomizu-dera", time: "09:00", role: "place" }
    ]);
  });

  it("treats explicit empty day blocks as an authoritative empty timeline", () => {
    const presentation = presentationFixture({
      places: [place("temple", { name: "Kiyomizu-dera", category: "temple" })],
      days: [{
        id: "day-1",
        label: "Open day",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["temple"],
        stops: [{ placeId: "temple", order: 1, time: "09:00" }],
        blocks: []
      }]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items, []);
  });

  it("shows day context for context-only travel days without fabricating itinerary items", () => {
    const presentation = presentationFixture({
      places: [],
      days: [{
        id: "day-1",
        label: "Oct 5",
        date: "2026-10-05",
        city: "Bali",
        title: "Arrival and transfer to Ubud",
        summary: "Arrival, immigration, baggage, private transfer, check-in, and recovery.",
        startContext: { label: "DPS", status: "transport_node" },
        endContext: { label: "Ubud accommodation", status: "planned_base_pending_property" },
        placeIds: [],
        stops: [],
        blocks: []
      }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.deepEqual(itinerary.items, []);
    assert.deepEqual(itinerary.dayContext, {
      startLabel: "DPS",
      endLabel: "Ubud accommodation",
      summary: "Arrival, immigration, baggage, private transfer, check-in, and recovery."
    });
    assert.deepEqual(itinerary.routePlaces, []);
    assert.deepEqual(itinerary.markers, []);
  });

  it("groups a three-date transit stage while preserving real date sections and Add target dates", () => {
    const presentation = presentationFixture({
      places: [place("cafe", { name: "Ubud Cafe", category: "cafe", schedulingEligibility: { decision: "schedulable", reason: "Arrival evening only.", suitableDayIds: ["day-arrival"] } })],
      days: [{
        id: "day-departure",
        label: "Oct 3",
        shortLabel: "10/3",
        date: "2026-10-03",
        city: "Los Angeles",
        title: "Departure",
        summary: "Depart from LAX and begin the long-haul journey.",
        startContext: { label: "Los Angeles International Airport (LAX)", status: "transport_node" },
        endContext: { label: "In transit to Singapore on SQ37", status: "in_transit" },
        placeIds: [],
        stops: [],
        blocks: [{ id: "depart", kind: "transfer", order: 1, title: "Depart LAX", startTime: "23:40", evidence: [] }]
      }, {
        id: "day-transit",
        label: "Oct 4",
        shortLabel: "10/4",
        date: "2026-10-04",
        city: "In transit",
        title: "International transit",
        summary: "In flight and date-line crossing.",
        startContext: { label: "In transit to Singapore on SQ37", status: "in_transit" },
        endContext: { label: "In transit to Bali via Singapore", status: "in_transit" },
        placeIds: [],
        stops: [],
        blocks: []
      }, {
        id: "day-arrival",
        label: "Oct 5",
        shortLabel: "10/5",
        date: "2026-10-05",
        city: "Ubud",
        title: "Arrival and settling",
        summary: "Arrive at DPS at 13:50, transfer to Ubud, check in, and keep the evening light.",
        startContext: { label: "I Gusti Ngurah Rai International Airport (DPS)", status: "transport_node" },
        endContext: { label: "Ubud accommodation", status: "planned_base_pending_property" },
        placeIds: [],
        stops: [],
        blocks: [
          { id: "arrival", kind: "transfer", order: 1, title: "DPS arrival and pickup", startTime: "13:50", summary: "Immigration, baggage, pickup, and transfer.", evidence: [] },
          { id: "checkin", kind: "lodging", order: 2, title: "Check in and settle", summary: "Rest near the hotel.", evidence: [] },
          { id: "walk", kind: "flexible", order: 3, title: "Short orientation walk", durationMinutes: 45, planRole: "planned", evidence: [] }
        ]
      }, {
        id: "day-ubud",
        label: "Oct 6",
        shortLabel: "10/6",
        date: "2026-10-06",
        city: "Ubud",
        title: "Ubud",
        summary: "Normal local day.",
        placeIds: ["temple"],
        stops: [{ placeId: "temple", order: 1, time: "09:00" }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.deepEqual(workspace.days.map((day) => ({ label: day.shortLabel, tab: day.tabLabel ?? day.city, ids: day.dayIds })), [
      { label: "10/3-10/5", tab: "Transit", ids: ["day-departure", "day-transit", "day-arrival"] },
      { label: "10/6", tab: "Ubud", ids: undefined }
    ]);
    assert.deepEqual(workspace.placementDays.map((day) => day.id), ["day-departure", "day-transit", "day-arrival", "day-ubud"]);
    const transit = itineraryDisplayForWorkspace(workspace, workspace.days[0]!.id);
    assert.deepEqual(transit.sections?.map((section) => ({ heading: section.heading, items: section.items.map((item) => ({ title: item.title, time: item.timeLabel })) })), [
      { heading: "10/3 · Departure", items: [{ title: "Depart LAX", time: "23:40" }] },
      { heading: "10/4 · In transit", items: [] },
      { heading: "10/5 · Arrival", items: [{ title: "DPS arrival", time: "13:50" }, { title: "Check in and settle", time: "" }, { title: "Short orientation walk", time: "Flexible time" }] }
    ]);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "cafe", { dayId: "day-arrival", positionId: "end" });
    assert.equal(edit.dayId, "day-arrival");
    assert.equal(edit.dayLabel, "10/5");
    const withPending = itineraryDisplayForWorkspace(workspace, workspace.days[0]!.id, edit);
    assert.equal(withPending.sections?.find((section) => section.dayId === "day-arrival")?.items.at(-1)?.title, "Ubud Cafe");
    assert.equal(withPending.sections?.find((section) => section.dayId === "day-transit")?.items.length, 0);
  });

  it("keeps a complete arrival local day as its own area tab", () => {
    const presentation = presentationFixture({
      places: [
        place("museum", { name: "Museum Puri Lukisan", category: "museum" }),
        place("forest", { name: "Sacred Monkey Forest Sanctuary", category: "sanctuary" })
      ],
      days: [{
        id: "day-flight",
        label: "Oct 3",
        shortLabel: "10/3",
        date: "2026-10-03",
        city: "In transit",
        title: "Departure",
        summary: "Departure and flight.",
        startContext: { label: "LAX", status: "transport_node" },
        endContext: { label: "In transit", status: "in_transit" },
        placeIds: [],
        stops: [],
        blocks: []
      }, {
        id: "day-arrival-local",
        label: "Oct 4",
        shortLabel: "10/4",
        date: "2026-10-04",
        city: "Ubud",
        title: "Ubud arrival and local day",
        summary: "Morning arrival followed by a full local itinerary.",
        startContext: { label: "DPS", status: "transport_node" },
        endContext: { label: "Ubud accommodation", status: "planned_base_pending_property" },
        placeIds: ["forest", "museum"],
        stops: [{ placeId: "forest", order: 1, time: "09:30" }, { placeId: "museum", order: 2, time: "14:00" }],
        blocks: [
          { id: "arrive", kind: "transfer", order: 1, title: "DPS arrival", startTime: "06:30", evidence: [] },
          { id: "forest", kind: "stop", order: 2, placeId: "forest", startTime: "09:30", durationMinutes: 150, planRole: "planned", evidence: [] },
          { id: "museum", kind: "stop", order: 3, placeId: "museum", startTime: "14:00", durationMinutes: 120, planRole: "planned", evidence: [] }
        ]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.deepEqual(workspace.days.map((day) => ({ label: day.shortLabel, tab: day.tabLabel ?? day.city })), [
      { label: "10/3", tab: "In transit" },
      { label: "10/4", tab: "Ubud" }
    ]);
    assert.deepEqual(itineraryDisplayForWorkspace(workspace, "day-arrival-local").items.map((item) => ({ title: item.title, time: item.timeLabel })), [
      { title: "DPS arrival", time: "06:30" },
      { title: "Sacred Monkey Forest Sanctuary", time: "09:30" },
      { title: "Museum Puri Lukisan", time: "14:00" }
    ]);
  });

  it("does not reuse airport times across dates that share a place id", () => {
    const presentation = presentationFixture({
      places: [place("airport", { name: "I Gusti Ngurah Rai International Airport", category: "international airport" })],
      days: [{
        id: "day-1",
        label: "Oct 3",
        shortLabel: "10/3",
        date: "2026-10-03",
        city: "Transit",
        title: "Departure",
        placeIds: ["airport"],
        stops: [{ placeId: "airport", order: 1, time: "23:40" }],
        blocks: [{ id: "depart", kind: "stop", order: 1, placeId: "airport", title: "Depart LAX", startTime: "23:40", evidence: [] }]
      }, {
        id: "day-2",
        label: "Oct 5",
        shortLabel: "10/5",
        date: "2026-10-05",
        city: "Bali",
        title: "Arrival",
        placeIds: ["airport"],
        stops: [{ placeId: "airport", order: 1, time: "13:50" }],
        blocks: [{ id: "arrive", kind: "stop", order: 1, placeId: "airport", title: "Arrive DPS", startTime: "13:50", evidence: [] }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.equal(itineraryDisplayForWorkspace(workspace, "day-1").items[0]?.timeLabel, "23:40");
    assert.equal(itineraryDisplayForWorkspace(workspace, "day-2").items[0]?.timeLabel, "13:50");
    assert.equal(scheduledDayIdForPlace(workspace, "airport"), "day-1");
  });

  it("shows base-change context on days with normal itinerary content", () => {
    const presentation = presentationFixture({
      places: [place("jatiluwih", { name: "Jatiluwih Rice Terraces", category: "rice terraces" })],
      days: [{
        id: "day-1",
        label: "Oct 9",
        date: "2026-10-09",
        city: "Bali",
        title: "Jatiluwih and move to Jimbaran",
        summary: "Transfer base after the rice terraces.",
        startContext: { label: "Ubud accommodation", status: "planned_base_pending_property" },
        endContext: { label: "Jimbaran accommodation", status: "planned_base_pending_property" },
        placeIds: ["jatiluwih"],
        stops: [],
        blocks: [{ id: "jatiluwih", kind: "stop", order: 1, placeId: "jatiluwih", startTime: "08:30", evidence: [] }]
      }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.deepEqual(itinerary.items.map((item) => item.title), ["Jatiluwih Rice Terraces"]);
    assert.deepEqual(itinerary.dayContext, {
      startLabel: "Ubud accommodation",
      endLabel: "Jimbaran accommodation"
    });
  });

  it("does not show repetitive same-base context on ordinary sightseeing days", () => {
    const presentation = presentationFixture({
      days: [{
        id: "day-1",
        label: "Oct 7",
        date: "2026-10-07",
        city: "Bali",
        title: "Ubud temples and museums",
        summary: "A normal local sightseeing day; keep the final airport transfer in mind but do not move base.",
        startContext: { label: "Ubud accommodation", status: "planned_base_pending_property" },
        endContext: { label: "Ubud accommodation", status: "planned_base_pending_property" },
        placeIds: ["temple"],
        stops: [],
        blocks: [{ id: "temple", kind: "stop", order: 1, placeId: "temple", startTime: "09:00", evidence: [] }]
      }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.equal(itinerary.dayContext, undefined);
    assert.deepEqual(itinerary.items.map((item) => item.title), ["temple"]);
  });

  it("renders explicit visible place blocks without falling back to stops", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { name: "Kiyomizu-dera", category: "temple" }),
        place("market", { name: "Nishiki Market", category: "food market" })
      ],
      days: [{
        id: "day-1",
        label: "Block day",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["temple", "market"],
        stops: [{ placeId: "temple", order: 1, time: "09:00" }, { placeId: "market", order: 2 }],
        blocks: [{ id: "temple-block", kind: "stop", order: 1, placeId: "temple", startTime: "10:00", title: "Temple visit", evidence: [] }]
      }]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items.map((item) => ({ title: item.title, meta: item.meta, time: item.timeLabel })), [
      { title: "Kiyomizu-dera", meta: "Temple visit", time: "10:00" }
    ]);
  });

  it("keeps explicit rest constraints visible instead of treating every rest block as filler", () => {
    const presentation = presentationFixture({
      places: [],
      days: [{
        id: "day-1",
        label: "Loose day",
        date: "2026-10-01",
        city: "Bali",
        placeIds: [],
        stops: [],
        blocks: [
          { id: "medicine-rest", kind: "rest", order: 1, title: "Medication rest window", summary: "Return to the room for a required health break.", startTime: "15:00", durationMinutes: 45, evidence: [] },
          { id: "free-evening", kind: "flexible", order: 2, title: "Free evening window", summary: "Leave this open.", evidence: [] }
        ]
      }]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items.map((item) => ({ title: item.title, role: item.timelineRole, time: item.timeLabel, meta: item.meta })), [
      { title: "Medication rest", role: "rest", time: "15:00", meta: "Return to the room for a required health break." }
    ]);
  });

  it("shows timed meal and rest blocks that make a full day executable", () => {
    const presentation = presentationFixture({
      places: [],
      days: [{
        id: "day-1",
        label: "Ubud day",
        date: "2026-10-06",
        city: "Bali",
        placeIds: [],
        stops: [],
        blocks: [
          { id: "breakfast", kind: "meal", order: 1, title: "Breakfast near the Ubud base", summary: "Start close to the suggested accommodation area.", startTime: "08:00", durationMinutes: 45, display: { timingStatus: "planned" }, evidence: [] },
          { id: "lunch", kind: "meal", order: 2, title: "Lunch in Central Ubud", summary: "Use a central Ubud lunch window before the afternoon activity.", startTime: "12:30", durationMinutes: 75, display: { timingStatus: "planned" }, evidence: [] },
          { id: "rest", kind: "rest", order: 3, title: "Rest near Ubud accommodation", summary: "Timed shade and heat buffer before dinner.", startTime: "15:30", durationMinutes: 60, display: { timingStatus: "planned" }, evidence: [] },
          { id: "free", kind: "flexible", order: 4, title: "Free time", summary: "Relax.", startTime: "17:00", durationMinutes: 60, evidence: [] }
        ]
      }]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items.map((item) => ({ title: item.title, role: item.timelineRole, time: item.timeLabel, meta: item.meta })), [
      { title: "Breakfast", role: "activity", time: "08:00", meta: "Start close to the suggested accommodation area." },
      { title: "Lunch", role: "activity", time: "12:30", meta: "Use a central Ubud lunch window before the afternoon activity." },
      { title: "Hotel rest", role: "rest", time: "15:30", meta: "Timed shade and heat buffer before dinner." }
    ]);
  });

  it("shows planned unresolved experiences while keeping optional and replacement blocks out of the main timeline", () => {
    const presentation = presentationFixture({
      places: [
        place("waterbom", { name: "Waterbom Bali", category: "water park" }),
        place("uluwatu", { name: "Uluwatu Temple", category: "temple" }),
        place("kecak", { name: "Uluwatu Kecak", category: "performance" })
      ],
      days: [{
        id: "day-1",
        label: "Oct 11",
        date: "2026-10-11",
        city: "Bali",
        placeIds: ["uluwatu", "kecak"],
        stops: [{ placeId: "uluwatu", order: 1, time: "15:30" }, { placeId: "kecak", order: 2, time: "18:00" }],
        blocks: [
          { id: "jimbaran-planned", kind: "flexible", order: 1, title: "Jimbaran Beach", summary: "Use this as the morning beach window.", startTime: "09:30", durationMinutes: 120, planRole: "planned", evidence: [] },
          { id: "uluwatu", kind: "stop", order: 2, placeId: "uluwatu", startTime: "15:30", planRole: "planned", evidence: [] },
          { id: "kecak", kind: "event", order: 3, placeId: "kecak", startTime: "18:00", planRole: "planned", primaryExperience: true, operationalConditions: [{ kind: "session" }, { kind: "reservation" }], evidence: [] },
          { id: "taman-ayun", kind: "flexible", order: 4, title: "Taman Ayun", planRole: "optional", evidence: [] },
          { id: "jimbaran-replacement", kind: "flexible", order: 5, title: "Jimbaran Beach", planRole: "replacement", replacementFor: "Waterbom Bali", replacementForBlockId: "waterbom", evidence: [] }
        ]
      }, {
        id: "day-2",
        label: "Oct 10",
        date: "2026-10-10",
        city: "Bali",
        placeIds: ["waterbom"],
        stops: [{ placeId: "waterbom", order: 1, time: "10:00" }],
        blocks: [
          { id: "waterbom", kind: "stop", order: 1, placeId: "waterbom", startTime: "10:00", planRole: "planned", primaryExperience: true, operationalConditions: [{ kind: "access" }, { kind: "reservation" }], evidence: [] }
        ]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const oct11Items = workspace.itineraries.find((day) => day.dayId === "day-1")?.items ?? [];

    assert.deepEqual(oct11Items.map((item) => ({ title: item.title, role: item.timelineRole, placeId: item.placeId, time: item.timeLabel })), [
      { title: "Jimbaran Beach", role: "activity", placeId: "", time: "09:30" },
      { title: "Uluwatu Temple", role: "place", placeId: "uluwatu", time: "15:30" },
      { title: "Uluwatu Kecak", role: "place", placeId: "kecak", time: "18:00" }
    ]);
    assert.equal(oct11Items.some((item) => item.title === "Taman Ayun"), false);
    assert.equal(oct11Items.filter((item) => item.title === "Jimbaran Beach").length, 1);
    assert.deepEqual(workspace.itineraries.find((day) => day.dayId === "day-1")?.dayAlternatives.map((item) => ({ title: item.title, kind: item.kind, replacementFor: item.replacementFor })), [
      { title: "Taman Ayun", kind: "optional", replacementFor: undefined },
      { title: "Jimbaran Beach", kind: "replacement", replacementFor: "Waterbom Bali" }
    ]);
    assert.deepEqual(presentation.days[0]?.blocks?.find((block) => block.id === "kecak")?.operationalConditions?.map((condition) => condition.kind), ["session", "reservation"]);
  });

  it("keeps day-local alternatives attached to their day without fake place identity", () => {
    const presentation = presentationFixture({
      places: [place("waterbom", { name: "Waterbom Bali", category: "water park" })],
      days: [{
        id: "day-1",
        label: "Oct 9",
        date: "2026-10-09",
        city: "Bali",
        placeIds: [],
        stops: [],
        blocks: [
          { id: "taman-ayun", kind: "flexible", order: 1, title: "Taman Ayun", summary: "Use only if the transfer route and energy allow.", planRole: "optional", operationalConditions: [{ kind: "route", note: "Check route after hotel selection." }], evidence: [] }
        ]
      }, {
        id: "day-2",
        label: "Oct 10",
        date: "2026-10-10",
        city: "Bali",
        placeIds: ["waterbom"],
        stops: [{ placeId: "waterbom", order: 1, time: "09:30" }],
        blocks: [
          { id: "waterbom", kind: "stop", order: 1, placeId: "waterbom", startTime: "09:30", planRole: "planned", evidence: [] },
          { id: "jimbaran", kind: "flexible", order: 2, title: "Jimbaran Beach", summary: "Replace the water park if the group wants a beach day.", planRole: "replacement", replacementFor: "Waterbom Bali", operationalConditions: [{ kind: "traveler_choice", note: "Use only if travelers reject the water-park plan." }], evidence: [] }
        ]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const oct9 = workspace.itineraries.find((day) => day.dayId === "day-1")!;
    const oct10 = workspace.itineraries.find((day) => day.dayId === "day-2")!;

    assert.deepEqual(oct9.items, []);
    assert.deepEqual(oct9.dayAlternatives.map((item) => ({ title: item.title, kind: item.kind, condition: item.condition, hasPlaceId: "placeId" in item })), [
      { title: "Taman Ayun", kind: "optional", condition: "Check route after hotel selection.", hasPlaceId: false }
    ]);
    assert.deepEqual(oct10.items.map((item) => item.title), ["Waterbom Bali"]);
    assert.deepEqual(oct10.dayAlternatives.map((item) => ({ title: item.title, kind: item.kind, replacementFor: item.replacementFor, condition: item.condition, hasPlaceId: "placeId" in item })), [
      { title: "Jimbaran Beach", kind: "replacement", replacementFor: "Waterbom Bali", condition: "Use only if travelers reject the water-park plan.", hasPlaceId: false }
    ]);
  });

  it("keeps intentional exclusions out of the timeline as plan-level rationale", () => {
    const presentation = presentationFixture({
      alternatives: [{ kind: "excluded", title: "Nusa Penida", summary: "Left out because it would add too much boat-transfer burden." }],
      days: [{
        id: "day-1",
        label: "Oct 10",
        date: "2026-10-10",
        city: "Bali",
        placeIds: ["temple"],
        stops: [{ placeId: "temple", order: 1, time: "09:00" }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.equal(workspace.itineraries[0]?.items.some((item) => item.title === "Nusa Penida"), false);
    assert.deepEqual(workspace.planAlternatives.map((item) => ({ title: item.title, kind: item.kind, summary: item.summary })), [
      { title: "Nusa Penida", kind: "excluded", summary: "Left out because it would add too much boat-transfer burden." }
    ]);
  });

  it("maps visible timeline items onto converged visual primitives without changing the visible set", () => {
    const image: NonNullable<PlanPlace["images"]>[number] = { url: "https://example.test/airport.jpg", alt: "Airport", sourceId: "source-guide", usage: ["detail"], status: "verified" };
    const presentation = presentationFixture({
      places: [
        place("airport", { name: "I Gusti Ngurah Rai International Airport", category: "airport transport", images: [image] }),
        place("museum", { name: "Museum Puri Lukisan", category: "museum" }),
        place("hotel", { name: "Hotel not selected", category: "hotel accommodation" }),
        place("restaurant", { name: "Paon Bali Cooking Class", category: "cooking class restaurant" })
      ],
      days: [{
        id: "day-1",
        label: "Primitive day",
        date: "2026-10-06",
        city: "Bali",
        placeIds: ["airport", "museum", "hotel", "restaurant"],
        stops: [
          { placeId: "airport", order: 1, time: "09:00" },
          { placeId: "museum", order: 2, time: "13:30" },
          { placeId: "hotel", order: 3 },
          { placeId: "restaurant", order: 4 }
        ],
        blocks: [
          { id: "airport", kind: "stop", order: 1, placeId: "airport", startTime: "09:00", title: "Arrival", evidence: [] },
          { id: "pickup", kind: "transfer", order: 1.5, title: "Pickup / meeting arrangement", summary: "Confirm pickup point.", evidence: [] },
          { id: "museum", kind: "stop", order: 2, placeId: "museum", startTime: "13:30", evidence: [] },
          { id: "hotel", kind: "lodging", order: 3, placeId: "hotel", evidence: [] },
          { id: "restaurant", kind: "event", order: 4, placeId: "restaurant", evidence: [] },
          { id: "free-evening", kind: "flexible", order: 5, title: "Free evening window", summary: "Leave this open.", evidence: [] }
        ]
      }],
      routeSegments: [
        { id: "walk", dayId: "day-1", originPlaceId: "airport", destinationPlaceId: "museum", mode: "walking", verification: "verified", durationMinutes: 28, sourceRefs: [] }
      ],
      actionRequirements: [
        { id: "cooking-class-reservation", kind: "reservation", title: "Reserve cooking class", description: "Reserve the cooking class before the trip.", accountableParty: "traveler", completionCondition: "Cooking class reserved.", placeId: "restaurant", evidence: [] }
      ]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items.map((item) => item.title), [
      "I Gusti Ngurah Rai International Airport",
      "Pickup / meeting arrangement",
      "Museum Puri Lukisan",
      "Hotel not selected",
      "Paon Bali Cooking Class"
    ]);
    assert.deepEqual(items.map((item) => timelineVisualPrimitiveForItem(item)), ["place", "movement", "place", "place", "place"]);
    assert.deepEqual(items.map((item) => item.timelineRole), ["place", "transport", "place", "place", "place"]);
    assert.equal(items.find((item) => item.title === "Paon Bali Cooking Class")?.statusLabel, "Reservation required");
    assert.equal(items.filter((item) => item.statusLabel === "Reservation required").length, 1);
    assert.equal(items.find((item) => item.title === "Museum Puri Lukisan")?.image, undefined);
    assert.equal(items[0]?.routeAfterLabel, "28 min walk");
  });

  it("keeps pending places on the place primitive and lightweight constraints off the place skeleton", () => {
    const presentation = presentationFixture({
      places: [],
      days: [{
        id: "day-1",
        label: "Dependency day",
        date: "2026-10-01",
        city: "Bali",
        placeIds: [],
        stops: [],
        blocks: [
          { id: "hotel", kind: "lodging", order: 1, title: "Accommodation", summary: "Hotel not selected", evidence: [] },
          { id: "medication", kind: "rest", order: 2, title: "Medication rest window", summary: "Required health break.", evidence: [] }
        ]
      }]
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]?.items ?? [];

    assert.deepEqual(items.map((item) => ({ title: item.title, role: item.timelineRole, primitive: timelineVisualPrimitiveForItem(item) })), [
      { title: "Accommodation", role: "rest", primitive: "action" },
      { title: "Medication rest", role: "rest", primitive: "action" }
    ]);
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

  it("uses Blueprint workspace signals before Web status inference", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("timed", {
          category: "museum",
          priority: "recheck",
          durationMinutes: 240,
          display: {
            type: "attraction",
            workspaceSignals: {
              reservation: "none",
              needsRecheck: false,
              longStop: false,
              itineraryStatusLabel: "Flexible confirmed slot"
            }
          },
          reservation: { requirement: "required", verification: "needs_recheck", note: "Legacy reservation state should not drive the workspace." },
          evidenceSources: [{ title: "Old source", url: "https://old.example", status: "stale" }],
          sourceRefs: ["https://old.example"]
        }),
        place("strict", {
          category: "gallery",
          display: { type: "attraction", workspaceSignals: { reservation: "required", needsRecheck: true, longStop: true } }
        })
      ],
      days: [{
        id: "day-1",
        label: "October 1",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["temple", "timed", "strict"],
        stops: [{ placeId: "temple", order: 1 }, { placeId: "timed", order: 2 }, { placeId: "strict", order: 3 }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const timedPlace = workspace.places.find((item) => item.id === "timed");
    const strictPlace = workspace.places.find((item) => item.id === "strict");
    assert.deepEqual(timedPlace?.placementSignals, { reservation: "none", needsRecheck: false, longStop: false });
    assert.deepEqual(strictPlace?.placementSignals, { reservation: "required", needsRecheck: true, longStop: true });
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => ({ id: item.placeId, status: item.statusLabel, reorderable: Boolean(item.reorderable) })), [
      { id: "temple", status: undefined, reorderable: true },
      { id: "timed", status: "Flexible confirmed slot", reorderable: true },
      { id: "strict", status: undefined, reorderable: false }
    ]);
  });

  it("adds Guide Catalog context to concrete place cards", () => {
    const presentation = presentationFixture({
      places: [
        place("lunch", { category: "restaurant", display: { type: "dining" } }),
        place("craft", { category: "craft shop", display: { type: "shopping" } }),
        place("tea", { category: "tea ceremony", display: { type: "experience" }, durationMinutes: 90 }),
        place("unlinked-restaurant", { category: "restaurant", display: { type: "dining" } })
      ],
      days: [],
      sourceCatalog: [{ id: "source-food", title: "Kyoto food guide", authority: "Official guide", url: "https://guide.example/food", retrievedAt: "2026-09-02", status: "verified" }],
      localFoods: [
        { id: "food-soba", title: "Seasonal soba", description: "Local noodle stop.", context: "Lunch", diningPlaceIds: ["lunch"], evidence: [{ sourceId: "source-food", status: "verified", supports: ["seasonal soba"], checkedAt: "2026-09-02" }] },
        { id: "food-ramen", title: "Unlinked ramen", description: "A restaurant category alone should not attach this.", context: "Dinner", diningPlaceIds: ["missing"], evidence: [] }
      ],
      localProducts: [{ id: "product-paper", title: "Washi paper", description: "Small paper goods.", context: "Craft browsing", purchasePlaceIds: ["craft"], evidence: [] }],
      experienceThemes: [{ id: "experience-tea", title: "Tea practice", description: "A concrete tea provider.", context: "Afternoon", offeringPlaceIds: ["tea"], evidence: [] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const tagsByPlace = new Map(workspace.guideCards.map((card) => [card.placeId, card.tags]));
    assert.deepEqual(tagsByPlace.get("lunch"), ["Seasonal soba"]);
    assert.deepEqual(tagsByPlace.get("craft"), ["Washi paper"]);
    assert.deepEqual(tagsByPlace.get("tea"), ["90 min", "Tea practice"]);
    assert.deepEqual(detailDisplayForWorkspacePlace(workspace, "lunch")?.guideContext.map((item) => ({ label: item.label, title: item.title, description: item.description, context: item.context, source: item.sources[0]?.summary })), [{
      label: "Local food",
      title: "Seasonal soba",
      description: "Local noodle stop.",
      context: "Lunch",
      source: "Kyoto food guide · Official guide · 2026-09-02 · seasonal soba · checked 2026-09-02"
    }]);
    assert.deepEqual(detailDisplayForWorkspacePlace(workspace, "craft")?.guideContext.map((item) => ({ label: item.label, title: item.title, description: item.description, context: item.context })), [{
      label: "Local find",
      title: "Washi paper",
      description: "Small paper goods.",
      context: "Craft browsing"
    }]);
    assert.deepEqual(detailDisplayForWorkspacePlace(workspace, "tea")?.guideContext.map((item) => ({ label: item.label, title: item.title, description: item.description, context: item.context })), [{
      label: "Experience",
      title: "Tea practice",
      description: "A concrete tea provider.",
      context: "Afternoon"
    }]);
    assert.deepEqual(detailDisplayForWorkspacePlace(workspace, "unlinked-restaurant")?.guideContext, []);
    assert.equal(/candidate|schema|graph/i.test(JSON.stringify(detailDisplayForWorkspacePlace(workspace, "lunch")?.guideContext)), false);
  });

  it("keeps unlinked guide catalog themes browsable as unschedulable informational topics", () => {
    const presentation = presentationFixture({
      sourceCatalog: [{ id: "guide", title: "Kyoto guide", authority: "Visitor bureau", url: "https://guide.example", retrievedAt: "2026-09-01", status: "verified" }],
      localFoods: [{ id: "food-seasonal", title: "Seasonal sweets", description: "Look for small seasonal sweets in neighborhood cafes.", context: "Use this as food background rather than a destination.", diningPlaceIds: [], evidence: [{ sourceId: "guide", status: "verified", supports: ["seasonal sweets"] }] }],
      localProducts: [{ id: "product-paper", title: "Washi paper", description: "Washi is a compact local find to notice while browsing.", context: "Buy only from shops already on the route.", purchasePlaceIds: [], evidence: [] }],
      experienceThemes: [{ id: "experience-tea", title: "Tea practice", description: "Tea practice is worth understanding before choosing a concrete venue.", context: "Add a venue only after Landi has a specific place.", offeringPlaceIds: [], evidence: [] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const topicCards = workspace.guideCards.filter((card) => card.placeId.startsWith("topic:"));
    assert.deepEqual(topicCards.map((card) => ({ id: card.placeId, type: card.type, state: card.state, canAdd: card.canAdd, action: card.actionLabel })), [
      { id: "topic:food:food-seasonal", type: "dining", state: "informational", canAdd: false, action: "Background note" },
      { id: "topic:product:product-paper", type: "shopping", state: "informational", canAdd: false, action: "Background note" },
      { id: "topic:experience:experience-tea", type: "experience", state: "informational", canAdd: false, action: "Background note" }
    ]);
    assert.equal(workspace.places.some((place) => place.id.startsWith("topic:")), false);
    assert.equal(workspace.itineraries.some((itinerary) => itinerary.markers.some((marker) => marker.placeId.startsWith("topic:"))), false);
    const foodDetail = detailDisplayForWorkspacePlace(workspace, "topic:food:food-seasonal")!;
    assert.equal(foodDetail.title, "Seasonal sweets");
    assert.equal(foodDetail.leadTitle, "Local food");
    assert.equal(foodDetail.canAdd, false);
    assert.equal(foodDetail.scheduled, false);
    assert.deepEqual(foodDetail.priorityActions, []);
    assert.equal(foodDetail.sources[0]?.summary.includes("seasonal sweets"), true);
    assert.deepEqual(filterGuideCards(workspace.guideCards, { type: "dining", state: "informational" }).map((card) => card.placeId), ["topic:food:food-seasonal"]);
  });

  it("uses Blueprint guide display intent before Web copy inference", () => {
    const presentation = presentationFixture({
      places: [
        place("anchor", { category: "landmark", name: "Anchor Museum" }),
        place("tea", {
          category: "museum",
          display: { type: "experience" },
          guideDisplay: {
            showInGuide: true,
            state: "unscheduled",
            cardSummary: "Blueprint-authored short card copy.",
            tags: ["75 min", "Quiet"],
            footerNote: "Good after the garden.",
            primaryActionLabel: "Add this tea stop",
            addActionLabel: "Add tea",
            detailLeadTitle: "Why this belongs",
            detailPlanTitle: "How to place it",
            detailSourceTitle: "Evidence",
            comparisonTitle: "Compare quiet options",
            comparisonRows: [{
              id: "row-anchor",
              relatedPlaceId: "anchor",
              area: "Central",
              routeFit: "Same direction",
              timing: "Late morning",
              effort: "Easy swap",
              sourceState: "Verified source"
            }]
          }
        }),
        place("context", { category: "museum", guideDisplay: { state: "informational", footerNote: "Use as background only." } }),
        place("hidden", { category: "museum", guideDisplay: { showInGuide: false } })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["anchor"], stops: [{ placeId: "anchor", order: 1 }] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const cardById = new Map(workspace.guideCards.map((card) => [card.placeId, card]));
    assert.deepEqual(workspace.guideCards.map((card) => card.placeId), ["anchor", "tea", "context"]);
    assert.equal(cardById.get("tea")?.summary, "Blueprint-authored short card copy.");
    assert.deepEqual(cardById.get("tea")?.tags, ["75 min", "Quiet"]);
    assert.equal(cardById.get("tea")?.footerNote, undefined);
    assert.equal(cardById.get("tea")?.actionLabel, "Add tea");
    assert.equal(workspace.places.find((item) => item.id === "tea")?.placementNote, "Good after the garden.");
    assert.deepEqual(buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "end" }).advisories[0], { tone: "attention", text: "Good after the garden." });
    assert.equal(cardById.get("context")?.state, "informational");
    assert.equal(cardById.get("context")?.footerNote, "Use as background only.");
    const detail = detailDisplayForWorkspacePlace(workspace, "tea")!;
    assert.equal(detail.leadTitle, "Why this belongs");
    assert.equal(detail.planTitle, "How to place it");
    assert.equal(detail.sourceTitle, "Evidence");
    assert.equal(detail.primaryActionLabel, "Add this tea stop");
    assert.equal(detail.comparisonTitle, "Compare quiet options");
    assert.deepEqual(detail.comparisonRows, [{
      id: "anchor",
      name: "Anchor Museum",
      area: "Central",
      routeFit: "Same direction",
      timing: "Late morning",
      effort: "Easy swap",
      sourceState: "Verified source"
    }]);
  });

  it("derives Explore plan fit and practical signals from existing plan context", () => {
    const presentation = presentationFixture({
      places: [
        place("monkey", { name: "Sacred Monkey Forest Sanctuary", category: "forest sanctuary", area: "Ubud", durationMinutes: 120, whyWorthIt: "Shaded forest, temples, and macaques make this a concrete Ubud anchor." }),
        place("paon", { name: "Paon Bali Cooking Class", category: "cooking class", area: "Ubud", durationMinutes: 240, whyWorthIt: "A hands-on Balinese cooking class in a family compound." }),
        place("kecak", { name: "Uluwatu Kecak and Fire Dance", category: "performance", area: "Uluwatu", priority: "recheck", durationMinutes: 90, whyWorthIt: "A conditional sunset performance option." }),
        place("walk", { name: "Campuhan Ridge Walk", category: "walk", area: "Ubud", durationMinutes: 90, whyWorthIt: "An easy greenery walk that can flex around weather." }),
        place("waterbom", { name: "Waterbom Bali", category: "water park", area: "Kuta", whyWorthIt: "A low-logistics leisure backup." })
      ],
      days: [
        { id: "day-1", label: "Oct 6", date: "2026-10-06", city: "Ubud", placeIds: ["monkey"], stops: [{ placeId: "monkey", order: 1, time: "09:00" }], candidates: ["walk"] },
        { id: "day-arrival", label: "Oct 3", title: "Arrival day", summary: "Airport arrival and hotel transfer.", city: "Bali", placeIds: [], stops: [], candidates: ["waterbom"] }
      ],
      actionRequirements: [
        { id: "reserve-paon", kind: "reservation", title: "Reserve Paon", description: "Reserve the class before the trip.", accountableParty: "traveler", completionCondition: "Class reserved.", placeId: "paon", evidence: [] },
        { id: "check-kecak", kind: "time_sensitive_recheck", title: "Check Kecak schedule", description: "Confirm the performance schedule and ticket status.", accountableParty: "traveler", completionCondition: "Schedule checked.", placeId: "kecak", evidence: [] }
      ],
      guideRelationshipGraph: {
        relationships: [
          { id: "rain-walk", kind: "rainy_day_alternative", fromPlaceId: "walk", toPlaceId: "monkey", rationale: "Use as a flexible Ubud weather swap.", dayIds: ["day-1"], evidence: [] }
        ]
      }
    });
    const cards = new Map(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards.map((card) => [card.placeId, card]));

    assert.equal(cards.get("monkey")?.planFitLabel, "In your plan · Oct 6, 09:00");
    assert.equal(cards.get("monkey")?.practicalSignal, "~2h");
    assert.equal(cards.get("paon")?.planFitLabel, "Add after booking check");
    assert.equal(cards.get("paon")?.practicalSignal, "Reservation required");
    assert.equal(cards.get("kecak")?.planFitLabel, "Add after schedule check");
    assert.equal(cards.get("kecak")?.practicalSignal, "Needs schedule check");
    assert.equal(cards.get("walk")?.planFitLabel, "Rainy-day option for Oct 6");
    assert.equal(cards.get("waterbom")?.planFitLabel, "Not currently in your plan");
    assert.equal(cards.get("waterbom")?.image, undefined);
  });

  it("suppresses logistics-day candidate fit while keeping sightseeing candidates available", () => {
    const presentation = presentationFixture({
      places: [
        place("museum", { name: "Museum", category: "museum" }),
        place("arrival-spa", { name: "Arrival spa", category: "spa" }),
        place("departure-cafe", { name: "Departure cafe", category: "cafe" })
      ],
      days: [
        { id: "sightseeing", label: "Oct 6", title: "Ubud day", city: "Ubud", placeIds: ["temple"], stops: [{ placeId: "temple", order: 1 }], candidates: ["museum"] },
        { id: "arrival", label: "Oct 3", title: "Arrival day", summary: "Airport arrival and transfer.", city: "Bali", placeIds: [], stops: [], candidates: ["arrival-spa"] },
        { id: "departure", label: "Oct 12", title: "Departure day", summary: "Check out and flight out.", city: "Bali", placeIds: ["lunch"], stops: [{ placeId: "lunch", order: 1 }], candidates: ["departure-cafe"] }
      ]
    });
    const cards = new Map(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards.map((card) => [card.placeId, card]));

    assert.equal(cards.get("museum")?.planFitLabel, "Fits your Ubud day");
    assert.equal(cards.get("arrival-spa")?.planFitLabel, "Not currently in your plan");
    assert.equal(cards.get("departure-cafe")?.planFitLabel, "Not currently in your plan");
  });

  it("keeps conditional event blocks from looking committed in Explore", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { name: "Uluwatu Temple", category: "temple" }),
        place("kecak", { name: "Uluwatu Kecak", category: "performance", priority: "recheck" })
      ],
      days: [{
        id: "day-1",
        label: "Oct 11",
        date: "2026-10-11",
        city: "Uluwatu",
        placeIds: ["temple"],
        stops: [{ placeId: "temple", order: 1, time: "15:30" }],
        blocks: [
          { id: "temple", kind: "stop", order: 1, placeId: "temple", startTime: "15:30", evidence: [] },
          { id: "kecak-note", kind: "event", order: 2, placeId: "kecak", title: "Kecak if schedule works", display: { routeAnchor: false, timeLabel: "Flexible afternoon" }, evidence: [] }
        ]
      }],
      actionRequirements: [{ id: "check-kecak", kind: "time_sensitive_recheck", title: "Check Kecak schedule", description: "Confirm the performance schedule.", accountableParty: "traveler", completionCondition: "Schedule checked.", placeId: "kecak", evidence: [] }]
    });
    const cards = new Map(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards.map((card) => [card.placeId, card]));

    assert.equal(cards.get("temple")?.planFitLabel, "In your plan · Oct 11, 15:30");
    assert.equal(cards.get("kecak")?.state, "unscheduled");
    assert.equal(cards.get("kecak")?.planFitLabel, "Add after schedule check");
    assert.equal(cards.get("kecak")?.practicalSignal, "Needs schedule check");
    assert.equal(cards.get("kecak")?.timeline, undefined);
  });

  it("builds Place Detail as visit guidance with itinerary context and lower-priority sources", () => {
    const presentation = presentationFixture({
      sourceCatalog: [{ id: "guide", title: "Official guide", authority: "Museum", url: "https://museum.example", retrievedAt: "2026-09-01", status: "verified" }],
      places: [
        place("monkey", { name: "Sacred Monkey Forest Sanctuary", category: "forest sanctuary", area: "Ubud", city: "Ubud", locationLabel: "Ubud, Bali", durationMinutes: 120, whyWorthIt: "Shaded forest, temples, and macaques make this a concrete Ubud anchor.", plan: "Go early, keep loose items secured, and continue after lunch if energy is good.", sourceRefs: ["guide"] }),
        place("museum", { name: "Museum Puri Lukisan", category: "museum", area: "Ubud", city: "Ubud", locationLabel: "Ubud, Bali", durationMinutes: 90, whyWorthIt: "A focused Balinese art museum." })
      ],
      days: [{ id: "day-1", label: "Oct 6", date: "2026-10-06", city: "Ubud", placeIds: ["monkey", "museum"], stops: [{ placeId: "monkey", order: 1, time: "09:00" }, { placeId: "museum", order: 2, time: "13:30" }] }],
      routeSegments: [{ id: "walk", dayId: "day-1", originPlaceId: "monkey", destinationPlaceId: "museum", mode: "walking", verification: "verified", durationMinutes: 28, sourceRefs: [] }]
    });
    const detail = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation), "monkey")!;

    assert.deepEqual(detail.heroMeta, ["Forest Sanctuary", "Ubud", "Ubud, Bali"]);
    assert.deepEqual(detail.visitFacts, ["Allow ~2h"]);
    assert.equal(detail.itineraryContext?.body, "Oct 6 · 09:00");
    assert.deepEqual(detail.itineraryContext?.items, ["Planned stay · ~2h", "Next: Museum Puri Lukisan", "28 min walk · verified"]);
    assert.equal(detail.sources.length, 1);
    assert.equal(detail.sourceTitle, undefined);
  });

  it("keeps scheduling constraints out of left guide card summaries", () => {
    const presentation = presentationFixture({
      places: [
        place("market", {
          category: "food market",
          whyWorthIt: "A neighborhood market that adds a concrete local food stop.",
          plan: "Do not schedule it after a tiring cross-city day. Use it only after Landi replans the route.",
          detailSections: [{
            title: "How to experience it",
            body: "Route refresh required before execution. Notice the seasonal counters before choosing lunch.",
            items: ["Candidate backup for the route order.", "Ask vendors what arrived today."]
          }],
          guideDisplay: {
            comparisonRows: [{
              id: "tea-row",
              relatedPlaceId: "tea",
              area: "Central",
              routeFit: "Do not schedule this after a tiring cross-city day.",
              timing: "Needs replanning before this route order is safe.",
              effort: "A quiet nearby option.",
              sourceState: "Referenced"
            }]
          },
          schedulingEligibility: {
            decision: "high_impact",
            reason: "Do not schedule it after a tiring cross-city day.",
            highImpactReasons: ["Late cross-city route"]
          }
        }),
        place("tea", {
          category: "tea",
          whyWorthIt: "",
          plan: "Do not schedule this after a tiring cross-city day. A quiet tea counter with hands-on preparation.",
          schedulingEligibility: { decision: "schedulable", reason: "Fits the day." }
        })
      ],
      days: []
    });
    const cards = guideCardsForWorkspace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation));
    const cardById = new Map(cards.map((card) => [card.placeId, card]));
    assert.equal(cardById.get("market")?.summary, "A neighborhood market that adds a concrete local food stop.");
    assert.equal(cardById.get("tea")?.summary, "A quiet tea counter with hands-on preparation.");
    assert.equal(cards.some((card) => /do not schedule|tiring cross-city|replan/i.test(card.summary)), false);
    const detail = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation), "market")!;
    assert.equal(detail.leadBody, "A neighborhood market that adds a concrete local food stop.");
    assert.equal(detail.planBody, undefined);
    assert.deepEqual(detail.comparisonRows.map((row) => ({ routeFit: row.routeFit, timing: row.timing, effort: row.effort })), [{
      routeFit: "Same area",
      timing: "Flexible timing",
      effort: "A quiet nearby option."
    }]);
    assert.deepEqual(detail.detailSections, [{
      title: "How to experience it",
      body: "Notice the seasonal counters before choosing lunch.",
      items: ["Ask vendors what arrived today."]
    }]);
    assert.equal(/do not schedule|tiring cross-city|replan/i.test(JSON.stringify(detail)), false);
  });

  it("keeps internal workflow language out of tips and preparation", () => {
    const presentation = presentationFixture({
      travelTips: [
        {
          id: "tip-good",
          title: "Route refresh note",
          body: "Route refresh is required before execution. Carry small cash for neighborhood food counters.",
          theme: "payment",
          context: "Workspace candidate notes",
          evidence: []
        },
        {
          id: "tip-internal",
          title: "Schema note",
          body: "JSON schema candidate state needs replanning.",
          theme: "local_norms",
          context: "Workspace",
          evidence: []
        }
      ],
      preparationChecklist: [
        {
          id: "prep-phone",
          title: "Workspace token setup",
          description: "Check eSIM coverage before departure. Route refresh before execution.",
          completionCondition: "Schema state reviewed.",
          group: "phone_payments",
          evidence: []
        }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    assert.deepEqual(workspace.tipGroups.flatMap((group) => group.tips).map((tip) => ({
      title: tip.title,
      body: tip.body,
      context: tip.context
    })), [{
      title: "Carry small cash for neighborhood food counters.",
      body: "Carry small cash for neighborhood food counters.",
      context: "Trip tip"
    }]);
    assert.deepEqual(workspace.preparationGroups.flatMap((group) => group.items).map((item) => ({
      title: item.title,
      description: item.description
    })), [{
      title: "Check eSIM coverage before departure.",
      description: undefined
    }]);
    assert.equal(/workspace|schema|json|candidate|route refresh|execution|replan/i.test(JSON.stringify({
      tips: workspace.tipGroups,
      preparation: workspace.preparationGroups
    })), false);
  });

  it("keeps direct revision roles out of saved itinerary cards", () => {
    const presentation = presentationFixture({
      places: [place("museum", { name: "Museum Puri Lukisan", category: "museum" })],
      days: [{
        id: "day-1",
        label: "Oct 8",
        date: "2026-10-08",
        city: "Ubud",
        placeIds: ["museum"],
        stops: [{ placeId: "museum", order: 1, role: "direct_addition" }],
        blocks: [{ id: "museum-direct", kind: "stop", order: 1, placeId: "museum", role: "direct_addition", evidence: [] }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.equal(workspace.itineraries[0]?.items[0]?.meta, "Central · Kyoto");
    assert.equal(/direct_addition/i.test(JSON.stringify(workspace.itineraries)), false);
  });

  it("uses Blueprint travel tips and preparation checklist before plan inference", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple", tip: "Temple etiquette: keep voices low near worship halls." }),
        place("lunch", { category: "restaurant", plan: "Eat near the market without turning the card into a full guide." }),
        place("craft", { category: "shopping craft store" })
      ],
      travelTips: [{
        id: "tip-cash",
        title: "Carry small cash",
        body: "Small temple-side shops may prefer cash during busy hours.",
        theme: "payment",
        context: "Kyoto temple areas",
        placeId: "temple",
        evidence: []
      }],
      preparationChecklist: [{
        id: "prep-passport",
        title: "Check passport validity",
        description: "Confirm passport validity before departure.",
        group: "documents",
        completionCondition: "Passport validity is confirmed.",
        requirementId: "passport-validity",
        evidence: []
      }]
    });
    const display = buildBlueprintWorkspaceDisplay(planFixture(presentation, {
      stages: [{
        id: "legacy",
        title: "Legacy prep",
        description: "Old compiled plan tasks.",
        tasks: [
          { id: "legacy-tip", title: "Local payment tip", description: "Carry cash near temple markets because small local shops may not accept cards.", owner: "assistant", status: "ready", dueLabel: "Anytime" },
          { id: "passport-task", title: "Old passport task", owner: "user", status: "completed", dueLabel: "Before departure", preparationCategory: "documents", requirementId: "passport-validity" }
        ]
      }]
    }), presentation);
    assert.deepEqual(display.tipGroups, [{
      theme: "Payment",
      tips: [{ id: "tip-cash", title: "Carry small cash", body: "Small temple-side shops may prefer cash during busy hours.", context: "Kyoto temple areas", theme: "payment" }]
    }]);
    assert.deepEqual(display.preparationGroups, [{
      title: "Documents",
      items: [{ id: "prep-passport", taskId: "passport-task", requirementId: "passport-validity", checklistItemId: "prep-passport", title: "Check passport validity", description: "Confirm passport validity before departure.", completion: "Passport validity is confirmed.", role: "general", checked: true, checkable: true }]
    }]);
  });

  it("adds one contextual tip to itinerary cards from Blueprint and place signals", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple", tip: "Fallback temple etiquette should not win." }),
        place("lunch", { category: "restaurant", tip: "Ask what is seasonal before ordering." }),
        place("craft", { category: "shopping craft store", reservation: { requirement: "recommended", verification: "verified", note: "Reserve a short workshop slot if this becomes a priority." } }),
        place("tea", { category: "tea ceremony experience", tip: "Book a quiet tea slot before adding it to the day." })
      ],
      days: [{
        ...presentationFixture().days[0]!,
        placeIds: ["temple", "lunch", "craft"],
        stops: [{ placeId: "temple", order: 1 }, { placeId: "lunch", order: 2 }, { placeId: "craft", order: 3 }],
        candidates: ["tea"]
      }],
      travelTips: [{
        id: "tip-temple",
        title: "Temple timing",
        body: "Arrive before the late-morning crowd.",
        theme: "timing",
        context: "Temple morning",
        placeId: "temple",
        dayId: "day-1",
        evidence: []
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const tipsByPlace = new Map(workspace.itineraries[0]?.items.map((item) => [item.placeId, item.contextualTip]));
    assert.equal(tipsByPlace.get("temple"), "Arrive before the late-morning crowd.");
    assert.equal(tipsByPlace.get("lunch"), "Ask what is seasonal before ordering.");
    assert.equal(tipsByPlace.get("craft"), "Reserve a short workshop slot if this becomes a priority.");

    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "end" });
    const preview = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.equal(preview.items.find((item) => item.placeId === "tea")?.contextualTip, "Book a quiet tea slot before adding it to the day.");
  });

  it("treats explicit empty Blueprint tips and preparation checklist as authoritative", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple", tip: "Temple etiquette: keep voices low near worship halls." }),
        place("lunch", { category: "restaurant" }),
        place("craft", { category: "shopping craft store" })
      ],
      travelTips: [],
      preparationChecklist: []
    });
    const display = buildBlueprintWorkspaceDisplay(planFixture(presentation, {
      stages: [{
        id: "legacy",
        title: "Legacy local safety tip",
        description: "Old compiled plan tasks.",
        tasks: [
          { id: "legacy-tip", title: "Local safety tip", description: "Use extra care around busy temple markets and local cash-only shops.", owner: "assistant", status: "ready", dueLabel: "Anytime" },
          { id: "legacy-prep", title: "Pack passport", owner: "user", status: "ready", dueLabel: "Before departure", preparationCategory: "documents" }
        ]
      }]
    }), presentation);
    assert.deepEqual(display.tipGroups, []);
    assert.deepEqual(display.preparationGroups, []);
  });

  it("resolves Blueprint source catalog without falling back to Plan source guesses", () => {
    const presentation = presentationFixture({
      sourceCatalog: [
        { id: "source-guide", title: "Official guide", authority: "Kyoto City", url: "https://guide.example", retrievedAt: "2026-09-01", status: "verified" },
        { id: "source-local", title: "Local manners note", authority: "Visitor bureau", url: "https://manners.example", retrievedAt: "2026-09-02", status: "verified" }
      ],
      fieldEvidence: [{ path: "guideTheme.title", status: "verified", evidence: [{ sourceId: "source-guide", status: "verified", supports: ["theme"] }] }],
      guideRelationshipGraph: { relationships: [{ id: "rel-temple-lunch", kind: "meal_support", fromPlaceId: "temple", toPlaceId: "lunch", rationale: "Lunch works after the temple.", evidence: [{ sourceId: "source-guide", status: "verified", supports: ["relationship"] }] }] },
      travelTips: [{ id: "tip-manners", title: "Step aside near temple gates", body: "Use the side of the approach when checking bags or phones.", theme: "etiquette", context: "Temple approaches", evidence: [{ sourceId: "source-local", status: "verified", supports: ["etiquette"] }] }],
      preparationChecklist: [{ id: "prep-ticket", title: "Check ticket window", group: "bookings_departure", completionCondition: "Ticket window is checked.", evidence: [{ sourceId: "source-guide", status: "verified", supports: ["booking window"] }] }],
      events: [{ id: "event-a", title: "Evening light-up", description: "Crowds may affect the route.", placeId: "temple", sourceRefs: ["source-guide"] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [] }), presentation);
    assert.deepEqual(workspace.sources.map((source) => source.summary), ["Official guide · Kyoto City · 2026-09-01", "Local manners note · Visitor bureau · 2026-09-02"]);
    assert.equal(detailDisplayForWorkspacePlace(workspace, "temple")?.relatedEvents[0]?.sources[0]?.summary, "Official guide · Kyoto City · 2026-09-01");
  });

  it("uses Blueprint module identity, scheduling eligibility, typed blocks, and relationships before inference", () => {
    const presentation = presentationFixture({
      moduleIdentity: { primaryModule: "itinerary", enabledModules: [{ id: "itinerary", title: "Itinerary", source: "blueprint" }, { id: "tips", title: "Tips", source: "blueprint" }] },
      guideRelationshipGraph: { relationships: [{ id: "rel-tea-lunch", kind: "meal_support", fromPlaceId: "tea", toPlaceId: "lunch", rationale: "Tea works as a softer break after lunch.", dayIds: ["day-1"], evidence: [{ sourceId: "guide", status: "verified" }] }] },
      places: [
        place("temple", { category: "temple", display: { type: "attraction" }, guideDisplay: { scheduledActionLabel: "Open scheduled temple" } }),
        place("lunch", { category: "restaurant", display: { type: "dining" } }),
        place("tea", { category: "ceremony", display: { type: "experience" }, guideDisplay: { primaryActionLabel: "Add the tea practice", addActionLabel: "Add tea" }, schedulingEligibility: { decision: "schedulable", reason: "Fits the first day.", suitableDayIds: ["day-1"] } }),
        place("context", { category: "food notes", display: { type: "dining" }, guideDisplay: { informationalActionLabel: "Read as local context" }, schedulingEligibility: { decision: "informational", reason: "Use this as background, not a stop." } }),
        place("hotel-shift", { category: "neighborhood dinner", display: { type: "dining" }, guideDisplay: { blockedActionLabel: "Ask Landi to rework dinner", addBlockedLabel: "Needs hotel-side redesign" }, schedulingEligibility: { decision: "high_impact", reason: "It changes the hotel-side evening plan.", highImpactReasons: ["Late cross-town route"] } }),
        place("closed", { category: "museum", display: { type: "attraction" }, guideDisplay: { blockedActionLabel: "Cannot fit this trip" }, schedulingEligibility: { decision: "blocked", reason: "Closed during the trip." } })
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
      { title: "temple", time: "09:30", meta: "Central · Kyoto", placeId: "temple" },
      { title: "lunch", time: "Around lunch", meta: "Lunch", placeId: "lunch" }
    ]);
    assert.deepEqual(workspace.itineraries[0]?.routePlaces.map((place) => place.placeId), ["temple", "lunch"]);
    assert.deepEqual(workspace.itineraries[0]?.placementOptions.map((option) => option.id), ["start", "after-temple", "after-lunch", "end"]);
    const cardById = new Map(workspace.guideCards.map((card) => [card.placeId, card]));
    assert.equal(cardById.get("tea")?.canAdd, true);
    assert.equal(cardById.get("tea")?.actionLabel, "Add tea");
    assert.equal(cardById.get("context")?.state, "informational");
    assert.equal(cardById.get("hotel-shift")?.canAdd, true);
    assert.equal(cardById.get("hotel-shift")?.footerNote, undefined);
    assert.equal(cardById.get("closed")?.footerNote, "Cannot fit this trip");
    const teaEdit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-2", positionId: "end" });
    assert.equal(teaEdit.dayId, "day-1");
    assert.deepEqual(teaEdit.position, { kind: "end" });
    const detail = detailDisplayForWorkspacePlace(workspace, "tea");
    assert.equal(detail?.canAdd, true);
    assert.deepEqual(detail?.comparisonRows.map((row) => ({ id: row.id, route: row.routeFit, timing: row.timing, effort: row.effort, source: row.sourceState })), [
      { id: "lunch", route: "Meal support", timing: "October 1", effort: "Tea works as a softer break after lunch.", source: "Verified connection" }
    ]);
    assert.equal(detailDisplayForWorkspacePlace(workspace, "hotel-shift")?.canAdd, true);
    assert.equal(detailDisplayForWorkspacePlace(workspace, "temple")?.primaryActionLabel, "Open scheduled temple");
    assert.equal(detailDisplayForWorkspacePlace(workspace, "tea")?.primaryActionLabel, "Add the tea practice");
    assert.equal(detailDisplayForWorkspacePlace(workspace, "context")?.primaryActionLabel, "Read as local context");
    assert.equal(detailDisplayForWorkspacePlace(workspace, "hotel-shift")?.primaryActionLabel, "Add to itinerary");
  });

  it("uses typed blocks as display copy without treating contextual places as route anchors", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("lunch", { category: "restaurant", display: { type: "dining" } }),
        place("tea", { category: "tea ceremony", display: { type: "experience" } }),
        place("festival", { category: "festival", display: { type: "experience" } })
      ],
      days: [{
        id: "day-1",
        label: "October 1",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["temple", "lunch"],
        stops: [{ placeId: "temple", order: 1, time: "09:30" }, { placeId: "lunch", order: 2 }],
        blocks: [
          { id: "block-temple", kind: "stop", order: 1, placeId: "temple", startTime: "09:30", title: "Quiet temple start", summary: "Use the gate visit as the morning anchor.", evidence: [] },
          { id: "block-rest", kind: "rest", order: 2, title: "Return for a short pause", summary: "Keep this visible instead of hiding rest in the summary.", durationMinutes: 30, evidence: [] },
          { id: "block-tea", kind: "flexible", order: 3, placeId: "tea", title: "Optional tea window", summary: "Only use this if the morning runs early.", evidence: [] },
          { id: "block-event", kind: "event", order: 4, placeId: "festival", eventId: "festival-event", title: "Evening festival note", summary: "This is context, not a scheduled route marker.", evidence: [] },
          { id: "block-lunch", kind: "meal", order: 5, placeId: "lunch", startTime: "12:30", title: "Lunch near the market", summary: "Eat before crossing to the next area.", evidence: [] }
        ]
      }],
      routeSegments: [
        { id: "route-formal", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "needs_verification", sourceRefs: [] },
        { id: "route-context", dayId: "day-1", originPlaceId: "tea", destinationPlaceId: "lunch", mode: "walking", verification: "verified", sourceRefs: [] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const itinerary = workspace.itineraries[0]!;
    assert.deepEqual(itinerary.items.map((item) => ({ title: item.title, placeId: item.placeId, routeAnchor: Boolean(item.routeAnchor), reorderable: Boolean(item.reorderable) })), [
      { title: "temple", placeId: "temple", routeAnchor: true, reorderable: true },
      { title: "tea", placeId: "tea", routeAnchor: false, reorderable: false },
      { title: "festival", placeId: "festival", routeAnchor: false, reorderable: false },
      { title: "lunch", placeId: "lunch", routeAnchor: true, reorderable: true }
    ]);
    assert.deepEqual(itinerary.routePlaces.map((place) => place.placeId), ["temple", "lunch"]);
    assert.deepEqual(itinerary.markers.map((marker) => marker.placeId), ["temple", "lunch"]);
    assert.deepEqual(itinerary.placementOptions.map((option) => option.id), ["start", "after-temple", "after-lunch", "end"]);
    assert.deepEqual(itinerary.routeSegments.map((segment) => segment.id), ["route-formal"]);
    assert.equal(scheduledDayIdForPlace(workspace, "tea"), undefined);
    assert.equal(buildPendingItineraryMoveForWorkspace(workspace, { dayId: "day-1", placeId: "tea", position: { kind: "end" } }), undefined);
  });

  it("uses Blueprint itinerary block display intent before timeline inference", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("note", { category: "neighborhood context", display: { type: "attraction" } }),
        place("lunch", { category: "restaurant", display: { type: "dining" } })
      ],
      days: [{
        id: "day-1",
        label: "October 1",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["temple", "lunch"],
        stops: [{ placeId: "temple", order: 1, time: "09:30" }, { placeId: "lunch", order: 2 }],
        blocks: [
          { id: "block-temple", kind: "stop", order: 1, placeId: "temple", startTime: "09:30", summary: "Legacy summary", display: { timeLabel: "Opening queue", meta: "Blueprint-authored route start", routeAnchor: true, reorderable: false }, evidence: [] },
          { id: "block-note", kind: "stop", order: 2, placeId: "note", display: { timeLabel: "Background context", meta: "Read this without adding a map marker", routeAnchor: false, reorderable: false }, evidence: [] },
          { id: "block-lunch", kind: "meal", order: 3, placeId: "lunch", role: "lunch", display: { timeLabel: "Lunch booking window", meta: "Keep after the morning anchor", routeAnchor: true, reorderable: true }, evidence: [] }
        ]
      }]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;
    assert.deepEqual(itinerary.items.map((item) => ({ id: item.placeId, time: item.timeLabel, meta: item.meta, routeAnchor: Boolean(item.routeAnchor), reorderable: Boolean(item.reorderable) })), [
      { id: "temple", time: "Opening queue", meta: "Blueprint-authored route start", routeAnchor: true, reorderable: false },
      { id: "note", time: "Background context", meta: "Read this without adding a map marker", routeAnchor: false, reorderable: false },
      { id: "lunch", time: "Lunch booking window", meta: "Keep after the morning anchor", routeAnchor: true, reorderable: true }
    ]);
    assert.deepEqual(itinerary.routePlaces.map((item) => item.placeId), ["temple", "lunch"]);
    assert.deepEqual(itinerary.markers.map((item) => item.placeId), ["temple", "lunch"]);
    assert.deepEqual(itinerary.placementOptions.map((option) => option.id), ["start", "after-temple", "after-lunch", "end"]);
    assert.equal(buildPendingItineraryMoveForWorkspace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation), { dayId: "day-1", placeId: "temple", position: { kind: "end" } }), undefined);
  });

  it("keeps observation landmarks in Explore while retaining transport nodes only as map data", () => {
    const presentation = presentationFixture({
      places: [
        place("view", { name: "Kyoto Tower Observation Deck", category: "landmark" }),
        place("station", { name: "Kyoto Station", category: "station transfer" })
      ],
      days: []
    });
    const cards = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards;
    assert.deepEqual(cards.map((card) => card.placeId), ["view"]);
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

  it("uses formal occurrences for scheduled state and preserves optional and replacement meaning", () => {
    const presentation = presentationFixture({
      places: [
        place("planned", { name: "Planned stop" }),
        place("optional", { name: "Optional workshop", category: "workshop experience" }),
        place("replacement", { name: "Rainy-day museum" }),
        place("research-only", { name: "Neighborhood cafe", category: "cafe" })
      ],
      days: [{
        id: "day-1",
        label: "Oct 1",
        date: "2026-10-01",
        city: "Kyoto",
        placeIds: ["planned"],
        stops: [{ placeId: "planned", order: 1 }],
        candidates: ["research-only"],
        blocks: [
          { id: "planned", kind: "stop", order: 1, placeId: "planned", planRole: "planned", evidence: [] },
          { id: "optional", kind: "event", order: 2, placeId: "optional", planRole: "optional", evidence: [] },
          { id: "replacement", kind: "stop", order: 3, placeId: "replacement", planRole: "replacement", replacementFor: "Planned stop", evidence: [] }
        ]
      }],
      routeSegments: []
    });
    const cards = new Map(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards.map((card) => [card.placeId, card]));
    assert.equal(cards.get("planned")?.state, "scheduled");
    assert.equal(cards.get("optional")?.state, "optional");
    assert.equal(cards.get("replacement")?.state, "replacement");
    assert.equal(cards.get("replacement")?.planFitLabel, "Alternative to Planned stop · Oct 1");
    assert.equal(cards.get("research-only")?.state, "unscheduled");
    assert.equal(cards.get("research-only")?.canAdd, true);
  });

  it("prioritizes selected-day plan-outside choices without filtering other trip areas", () => {
    const presentation = presentationFixture({
      places: [
        place("planned", { name: "Planned stop" }),
        place("day-two", { name: "Day two choice", schedulingEligibility: { decision: "schedulable", reason: "Fits day two.", suitableDayIds: ["day-2"] } }),
        place("day-one", { name: "Day one choice", schedulingEligibility: { decision: "schedulable", reason: "Fits day one.", suitableDayIds: ["day-1"] } })
      ],
      days: [
        { id: "day-1", label: "Oct 1", date: "2026-10-01", city: "Kyoto", placeIds: ["planned"], stops: [{ placeId: "planned", order: 1 }] },
        { id: "day-2", label: "Oct 2", date: "2026-10-02", city: "Kyoto", placeIds: [], stops: [] }
      ],
      routeSegments: []
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const cards = guideCardsForWorkspace(workspace, [], "day-1");
    assert.deepEqual(cards.map((card) => card.placeId), ["day-one", "day-two", "planned"]);
    assert.equal(cards.some((card) => card.placeId === "day-two"), true);
  });

  it("offers high-impact choices through the existing assisted Add workflow", () => {
    const presentation = presentationFixture({
      places: [place("island-day", { schedulingEligibility: { decision: "high_impact", reason: "Needs a full-day route review." } })],
      days: [{ id: "day-1", label: "Oct 1", date: "2026-10-01", city: "Kyoto", placeIds: [], stops: [] }],
      routeSegments: []
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    assert.equal(workspace.guideCards[0]?.canAdd, true);
    assert.equal(detailDisplayForWorkspacePlace(workspace, "island-day")?.canAdd, true);
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
      { id: "temple", canAdd: false, actionLabel: undefined, footerNote: undefined },
      { id: "tea", canAdd: true, actionLabel: "Add", footerNote: undefined },
      { id: "context", canAdd: false, actionLabel: undefined, footerNote: undefined }
    ]);
    assert.equal(cards.find((card) => card.placeId === "temple")?.planFitLabel, "In your plan · October 1, 09:00");
    assert.equal(cards.some((card) => /available|informational|in itinerary/i.test([card.footerNote, card.actionLabel].filter(Boolean).join(" "))), false);
    assert.equal(cards.some((card) => /Higashiyama|Kyoto/i.test(card.tags.join(" "))), false);
  });

  it("uses trip area fallback map view and blocks direct add for places without coordinates", () => {
    const presentation = presentationFixture({
      summary: "Bali plan.",
      cities: ["Bali, Indonesia"],
      places: [
        placeWithoutCoordinates("temple", { city: "Ubud", locationLabel: "Ubud" }),
        placeWithoutCoordinates("bath", { city: "South Kuta", locationLabel: "South Kuta", category: "spa experience", schedulingEligibility: { decision: "schedulable", reason: "Legacy draft marked it schedulable before map data was available." } }),
        place("kecak", { city: "Uluwatu", locationLabel: "Uluwatu", category: "performance", coordinates: [-8.8306, 115.0854] })
      ],
      days: [{ ...presentationFixture().days[0]!, city: "Ubud", placeIds: ["temple"], stops: [{ placeId: "temple", order: 1 }] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, { title: "Bali Vacation Blueprint", location: "Bali, Indonesia" }), presentation);
    const bathCard = workspace.guideCards.find((card) => card.placeId === "bath")!;
    assert.deepEqual(workspace.mapFallback, { center: [-8.4095, 115.1889], zoom: 10, label: "Bali" });
    assert.equal(workspace.itineraries[0]?.markers.length, 0);
    assert.equal(workspace.itineraries[0]?.routePlaces.length, 0);
    assert.equal(bathCard.canAdd, false);
    assert.equal(bathCard.footerNote, "Location needs to be confirmed before adding.");
    assert.equal(detailDisplayForWorkspacePlace(workspace, "bath")?.primaryActionLabel, "Location needs to be confirmed before adding.");
  });

  it("builds direct place status actions without making scheduled archive a one-click edit", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple", priority: "must" }),
        place("tea", { category: "tea ceremony experience", priority: "nearby" })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["temple"], stops: [{ placeId: "temple", order: 1 }] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const cardById = new Map(workspace.guideCards.map((card) => [card.placeId, card]));
    assert.equal(cardById.get("temple")?.priorityLabel, "Must go");
    assert.equal(cardById.get("tea")?.priorityLabel, "Nearby");
    assert.equal(workspace.itineraries[0]?.markers[0]?.priority, "must");
    const scheduled = detailDisplayForWorkspacePlace(workspace, "temple")!;
    const unscheduled = detailDisplayForWorkspacePlace(workspace, "tea")!;
    assert.equal(scheduled.priorityLabel, "Must go");
    assert.equal(scheduled.priorityActions.find((action) => action.priority === "archive")?.disabled, true);
    assert.match(scheduled.priorityBlockedNote ?? "", /remove action/i);
    assert.equal(unscheduled.priorityActions.find((action) => action.priority === "archive")?.disabled, undefined);
    assert.equal(unscheduled.priorityActions.find((action) => action.priority === "nearby")?.active, true);
  });

  it("previews removing a scheduled place without deleting the guide item", () => {
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(), presentationFixture());
    const detail = detailDisplayForWorkspacePlace(workspace, "lunch")!;
    assert.equal(detail.scheduled, true);
    assert.equal(detail.canRemoveFromDay, true);
    assert.equal(detail.removeActionLabel, "Remove from day");
    const edit = buildPendingItineraryRemoveForWorkspace(workspace, { dayId: "day-1", placeId: "lunch" });
    assert.ok(edit);
    assert.equal(edit.kind, "remove_place_from_day");
    assert.equal(edit.dayLabel, "2026-10-01");
    assert.match(pendingItineraryEditRequest(edit), /Remove lunch from 2026-10-01/);
    assert.doesNotMatch(pendingItineraryEditRequest(edit), /conversation|review changes/i);
    const preview = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.deepEqual(preview.items.map((item) => item.placeId), ["temple", "craft"]);
    assert.deepEqual(preview.markers.map((marker) => marker.placeId), ["temple", "craft"]);
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => item.placeId), ["temple", "lunch", "craft"]);
    assert.equal(workspace.guideCards.some((card) => card.placeId === "lunch"), true);
    assert.equal(preview.routeRefresh?.actionable, false);
    assert.match(preview.routeRefresh?.summary ?? "", /unsaved itinerary change/);
  });

  it("keeps guide cards and details aligned with pending remove drafts", () => {
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(), presentationFixture());
    const edit = buildPendingItineraryRemoveForWorkspace(workspace, { dayId: "day-1", placeId: "lunch" })!;
    const pendingCard = guideCardsForWorkspace(workspace, [edit]).find((card) => card.placeId === "lunch")!;
    assert.equal(pendingCard.state, "unscheduled");
    assert.equal(pendingCard.canAdd, true);
    assert.equal(pendingCard.actionLabel, "Add");
    assert.equal(pendingCard.draftActionLabel, "Undo draft");
    assert.match(pendingCard.footerNote ?? "", /Removed from 2026-10-01 \(not saved\)/);
    assert.equal(pendingCard.timeline, undefined);

    const pendingDetail = detailDisplayForWorkspacePlace(workspace, "lunch", [edit])!;
    assert.equal(pendingDetail.scheduled, false);
    assert.equal(pendingDetail.canAdd, true);
    assert.equal(pendingDetail.canRemoveFromDay, false);
    assert.equal(pendingDetail.removeActionLabel, undefined);
    assert.equal(pendingDetail.draftActionLabel, "Undo draft");
    assert.match(pendingDetail.itineraryDraftNote ?? "", /Removed from 2026-10-01 \(not saved\)/);
    assert.equal(pendingDetail.priorityActions.find((action) => action.priority === "archive")?.disabled, undefined);

    const savedCard = guideCardsForWorkspace(workspace, []).find((card) => card.placeId === "lunch")!;
    const savedDetail = detailDisplayForWorkspacePlace(workspace, "lunch")!;
    assert.equal(savedCard.state, "scheduled");
    assert.equal(savedCard.canAdd, false);
    assert.equal(savedCard.draftActionLabel, undefined);
    assert.equal(savedDetail.scheduled, true);
    assert.equal(savedDetail.canRemoveFromDay, true);
    assert.equal(savedDetail.draftActionLabel, undefined);
  });

  it("does not stage direct removal for fixed booking places", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("lunch", { category: "restaurant", priority: "booked" }),
        place("craft", { category: "shopping craft store" })
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const detail = detailDisplayForWorkspacePlace(workspace, "lunch")!;
    assert.equal(detail.canRemoveFromDay, false);
    assert.equal(detail.removeBlockedReason, "Fixed booking");
    assert.equal(buildPendingItineraryRemoveForWorkspace(workspace, { dayId: "day-1", placeId: "lunch" }), undefined);
  });

  it("treats standalone hard booking constraints as fixed itinerary commitments", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("fado", { name: "Fado night", category: "evening experience" }),
        place("craft", { category: "shopping craft store" })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["temple", "fado", "craft"], stops: [{ placeId: "temple", order: 1 }, { placeId: "fado", order: 2 }, { placeId: "craft", order: 3 }] }],
      bookingConstraints: [{
        id: "booking-fado",
        type: "event",
        title: "Fado night",
        status: "confirmed",
        sourceLabel: "Email",
        importedAt: "2026-09-01T00:00:00.000Z",
        constraintStrength: "hard",
        segments: [{ id: "segment-fado", segmentType: "event_window", title: "Fado night", startAtLocal: "2026-10-01T20:00", startTimeZone: "Asia/Tokyo", location: "Fado night", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const detail = detailDisplayForWorkspacePlace(workspace, "fado")!;
    const item = itineraryDisplayForWorkspace(workspace, "day-1").items.find((candidate) => candidate.placeId === "fado");
    assert.equal(detail.canRemoveFromDay, false);
    assert.equal(detail.removeBlockedReason, "Fixed booking");
    assert.equal(item?.reorderable, undefined);
    assert.equal(buildPendingItineraryMoveForWorkspace(workspace, { dayId: "day-1", placeId: "fado", position: { kind: "start" } }), undefined);
    assert.equal(buildPendingItineraryRemoveForWorkspace(workspace, { dayId: "day-1", placeId: "fado" }), undefined);
  });

  it("uses Blueprint place requirements for reservation and recheck read surfaces", () => {
    const presentation = presentationFixture({
      places: [place("ticket", { category: "museum", durationMinutes: 90 })],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["ticket"], stops: [{ placeId: "ticket", order: 1, time: "10:00" }] }],
      actionRequirements: [
        { id: "ticket-slot", kind: "reservation", title: "Choose museum entry slot", description: "Choose the current timed-entry slot before visiting.", accountableParty: "traveler", completionCondition: "Entry slot selected.", placeId: "ticket", evidence: [] },
        { id: "ticket-hours", kind: "time_sensitive_recheck", title: "Check evening hours", description: "Check official opening hours close to the visit date.", accountableParty: "assistant", completionCondition: "Opening hours checked.", placeId: "ticket", evidence: [{ sourceId: "guide", status: "recheck" }] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const placeDisplay = workspace.places.find((place) => place.id === "ticket");
    const card = workspace.guideCards.find((item) => item.placeId === "ticket");
    const item = workspace.itineraries[0]?.items[0];
    const detail = detailDisplayForWorkspacePlace(workspace, "ticket")!;

    assert.deepEqual(placeDisplay?.placementSignals, { reservation: "required", needsRecheck: true, longStop: false });
    assert.equal(card?.practicalSignal, "Reservation required");
    assert.equal(item?.statusLabel, "Reservation required");
    assert.equal(item?.reorderable, undefined);
    assert.equal(detail.reservationNote, "Choose the current timed-entry slot before visiting.");
    assert.deepEqual(detail.visitNotes, [{ id: "visit-note-2", title: "Check evening hours", body: "Check official opening hours close to the visit date.", completion: "Opening hours checked." }]);
    assert.equal(detail.canRemoveFromDay, false);
    assert.equal(detail.removeBlockedReason, "Fixed booking");
    assert.doesNotMatch(JSON.stringify({ card, detail, placeDisplay }), /time_sensitive_recheck|accountableParty|traveler|assistant|ticket-slot|ticket-hours|sourceId/i);
  });

  it("keeps requirement copy while routing high-impact Add through assisted planning", () => {
    const presentation = presentationFixture({
      places: [place("dinner", { category: "restaurant", schedulingEligibility: { decision: "high_impact", reason: "Late cross-town route", highImpactReasons: ["Hotel timing"] } })],
      days: [],
      actionRequirements: [
        { id: "dinner-timing", kind: "preparation", title: "Settle hotel timing first", description: "Use this dinner only after the hotel-side evening timing is settled.", accountableParty: "traveler", completionCondition: "Hotel timing settled.", placeId: "dinner", evidence: [] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const card = workspace.guideCards.find((item) => item.placeId === "dinner")!;
    const detail = detailDisplayForWorkspacePlace(workspace, "dinner")!;

    assert.equal(card.canAdd, true);
    assert.equal(card.footerNote, undefined);
    assert.equal(card.addBlockedReason, undefined);
    assert.equal(detail.primaryActionLabel, "Add to itinerary");
    assert.deepEqual(detail.visitNotes, [{ id: "visit-note-1", title: "Settle hotel timing first", body: "Use this dinner only after the hotel-side evening timing is settled.", completion: "Hotel timing settled." }]);
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
    assert.equal(preview.items.find((item) => item.placeId === "tea")?.draftActionLabel, "Undo draft");
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
    assert.deepEqual(preview.items.map((item) => item.timeLabel), ["09:30", "Around lunch", "Flexible afternoon"]);
    assert.equal(preview.items.find((item) => item.placeId === "craft")?.statusLabel, "Not saved");
    assert.equal(preview.items.find((item) => item.placeId === "craft")?.editState, "moved");
    assert.equal(preview.items.find((item) => item.placeId === "craft")?.draftActionLabel, "Undo draft");
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => item.placeId), ["temple", "lunch", "craft"]);
  });

  it("keeps map-refreshed scheduled places editable when only synthetic no-coordinate eligibility is stale", () => {
    const presentation = presentationFixture({
      places: presentationFixture().places.map((candidate) => candidate.id === "craft"
        ? { ...candidate, schedulingEligibility: { decision: "informational", reason: MAP_COORDINATES_PENDING_WORKSPACE_REASON } }
        : candidate)
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    assert.equal(buildPendingItineraryMoveForWorkspace(workspace, { dayId: "day-1", placeId: "craft", position: { kind: "start" } })?.kind, "move_place_within_day");
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
    assert.deepEqual(dayOne.markers.find((marker) => marker.placeId === "tea"), { placeId: "tea", title: "Tea Studio", type: "experience", coordinates: [35.15, 135.15], markerState: "pending", priority: "preferred" });
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
    assert.equal(/candidate|best|default recommendation|scheduled stop|optional flexible stop|refresh|execution|replan/i.test(request), false);
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
    assert.doesNotMatch(request, /replacement draft|review changes|refresh|execution|replan/i);
  });

  it("keeps repeated local draft edits as one replaceable item before apply", () => {
    const presentation = presentationFixture({
      places: [
        ...presentationFixture().places,
        place("tea", { name: "Tea Studio", category: "tea ceremony experience", coordinates: [35.15, 135.15] })
      ],
      days: [
        presentationFixture().days[0]!,
        { id: "day-2", label: "October 2", date: "2026-10-02", city: "Kyoto", placeIds: [], stops: [], candidates: ["tea"] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const firstPlacement = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const revisedPlacement = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-2", positionId: "end" });
    const draft = mergePendingItineraryEdit([firstPlacement], revisedPlacement);
    assert.deepEqual(draft.map((edit) => [edit.placeId, edit.dayId]), [["tea", "day-2"]]);
    assert.deepEqual(itineraryDisplayForWorkspace(workspace, "day-1", draft).items.map((item) => item.placeId), ["temple", "lunch", "craft"]);
    assert.deepEqual(itineraryDisplayForWorkspace(workspace, "day-2", draft).items.map((item) => item.kind === "pending" ? `pending:${item.placeId}` : item.placeId), ["pending:tea"]);
  });

  it("summarizes compacted itinerary drafts by affected days", () => {
    const presentation = presentationFixture({
      places: [
        ...presentationFixture().places,
        place("tea", { name: "Tea Studio", category: "tea ceremony experience" }),
        place("garden", { name: "Moss Garden", category: "garden" })
      ],
      days: [
        presentationFixture().days[0]!,
        { id: "day-2", label: "October 2", date: "2026-10-02", city: "Kyoto", placeIds: [], stops: [], candidates: ["garden"] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edits = [
      buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" }),
      buildPendingItineraryEditForWorkspace(workspace, "garden", { dayId: "day-2", positionId: "end" }),
      buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "end" })
    ];
    assert.equal(compactPendingItineraryEdits(edits).length, 2);
    assert.deepEqual(pendingItineraryDraftSummary(edits), { changeLabel: "2 unsaved changes", affectedDayLabel: "2026-10-01, 2026-10-02" });
    assert.match(pendingItineraryEditBatchRequest(edits), /Apply these 2 confirmed itinerary edits directly to the plan in one update/);
  });

  it("summarizes applied itinerary revisions from backend metadata", () => {
    const presentation = presentationFixture({
      days: [
        presentationFixture().days[0]!,
        { id: "day-2", label: "October 2", date: "2026-10-02", city: "Kyoto", placeIds: [], stops: [], candidates: [] }
      ]
    });
    const revision: DirectBlueprintRevisionBatchMetadata = {
      id: "direct-revision-batch-blueprint-1-v1-to-v3",
      baseBlueprintVersion: 1,
      appliedBlueprintVersion: 3,
      createdAt: "2026-10-01T00:00:00.000Z",
      revisionCount: 2,
      kinds: ["add_place_to_day", "move_place_within_day"],
      affectedDayIds: ["day-1", "day-2"],
      affectedPlaceIds: ["tea", "craft"],
      routeRefresh: {
        dayIds: ["day-1", "day-2"],
        movementIds: ["movement-day-1-1", "movement-day-1-2", "movement-day-2-1"],
        reason: "These itinerary days were edited directly."
      },
      routeImpact: {
        days: [
          {
            dayId: "day-1",
            addedPlaceIds: ["tea"],
            removedPlaceIds: [],
            movedPlaceIds: [],
            movementIds: ["movement-day-1-1", "movement-day-1-2"],
            requiresRouteRefresh: true,
            requiresTimingReview: true,
            requiresMealRestSpacingReview: true,
            capacityRisk: false,
            backtrackingRisk: false,
            fixedTimeRisk: false,
            readiness: "ready_for_route_refresh",
            reasons: []
          },
          {
            dayId: "day-2",
            addedPlaceIds: [],
            removedPlaceIds: [],
            movedPlaceIds: ["craft"],
            movementIds: ["movement-day-2-1"],
            requiresRouteRefresh: true,
            requiresTimingReview: true,
            requiresMealRestSpacingReview: false,
            capacityRisk: true,
            backtrackingRisk: false,
            fixedTimeRisk: false,
            readiness: "ready_for_route_refresh",
            reasons: []
          }
        ]
      },
      replanReadiness: {
        status: "ready_for_route_refresh",
        dayIds: ["day-1", "day-2"],
        reason: "These direct itinerary edits are saved, but affected routes and timing still need refresh before execution."
      },
      undo: {
        previousBlueprintVersion: 1,
        previousDays: [],
        previousMovements: [],
        previousPlaces: []
      },
      revisions: []
    };

    assert.deepEqual(appliedItineraryRevisionSummary(revision, presentation), {
      updateLabel: "2 itinerary updates",
      affectedDayLabel: "2026-10-01, 2026-10-02",
      routeRefreshLabel: "3 travel legs need checking",
      statusText: "Applied 2 itinerary updates for 2026-10-01, 2026-10-02. 3 travel legs need checking; review timing, meal/rest spacing, day pacing before the itinerary is finalized."
    });
    assert.doesNotMatch(JSON.stringify(appliedItineraryRevisionSummary(revision, presentation)), /\brefresh\b|\bexecution\b|\breplan/i);
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

  it("marks unsaved itinerary drafts as needing travel-time checks after confirmation", () => {
    const presentation = presentationFixture({ places: [...presentationFixture().places, place("tea", { name: "Tea Studio", category: "tea ceremony experience" })] });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.deepEqual(display.routeRefresh, {
      segmentCount: 1,
      segmentIds: [],
      dayLabel: "2026-10-01",
      summary: "1 unsaved itinerary change will have travel times checked after you confirm.",
      impactNotes: [
        "Travel time and timing will be checked after confirmation.",
        "Added places may affect meal spacing, opening windows, and route order.",
        "Landi will check route fit and timing before saving this edit."
      ],
      request: "After you confirm the itinerary draft for 2026-10-01, check travel times, timing, meal spacing, and opening constraints before marking this day ready.",
      actionable: false
    });
    assert.deepEqual(display.items.map((item) => item.routeAfterLabel), [undefined, undefined, undefined, undefined]);
    assert.deepEqual(display.items.map((item) => item.routeAfterStatusLabel), [
      "Travel time will be checked after confirm.",
      "Travel time will be checked after confirm.",
      "Travel time will be checked after confirm.",
      undefined
    ]);
    assert.doesNotMatch(JSON.stringify(display.routeRefresh), /\brefresh\b|\bexecution\b|\breplan/i);
  });

  it("calls out capacity when an added place makes a day dense", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("lunch", { category: "restaurant" }),
        place("craft", { category: "shopping craft store" }),
        place("garden", { category: "garden" }),
        place("dinner", { category: "restaurant", area: "Gion" })
      ],
      days: [{
        ...presentationFixture().days[0]!,
        placeIds: ["temple", "lunch", "craft", "garden"],
        stops: [{ placeId: "temple", order: 1 }, { placeId: "lunch", order: 2 }, { placeId: "craft", order: 3 }, { placeId: "garden", order: 4 }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "dinner", { dayId: "day-1", positionId: "end" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.ok(display.routeRefresh?.impactNotes?.includes("This preview has 5 planned stops, so pacing may be tight."));
    assert.equal(display.routeRefresh?.impactNotes?.includes("Added places may affect meal spacing, opening windows, and route order."), false);
  });

  it("calls out removed meal anchors when no dining stop remains", () => {
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(), presentationFixture());
    const edit = buildPendingItineraryRemoveForWorkspace(workspace, { dayId: "day-1", placeId: "lunch" })!;
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.ok(display.routeRefresh?.impactNotes?.includes("Removing this stop leaves the day without a clear meal or rest anchor."));
    assert.equal(display.routeRefresh?.impactNotes?.includes("Removed stops stay in Explore and may leave a gap in the day."), false);
  });

  it("calls out area backtracking in pending itinerary previews", () => {
    const presentation = presentationFixture({
      places: [
        place("east-temple", { area: "East", category: "temple" }),
        place("central-lunch", { area: "Central", category: "restaurant" }),
        place("west-craft", { area: "West", category: "shopping craft store" }),
        place("east-tea", { area: "East", category: "tea ceremony experience" })
      ],
      days: [{
        ...presentationFixture().days[0]!,
        placeIds: ["east-temple", "central-lunch", "west-craft"],
        stops: [{ placeId: "east-temple", order: 1 }, { placeId: "central-lunch", order: 2 }, { placeId: "west-craft", order: 3 }]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "east-tea", { dayId: "day-1", positionId: "after-central-lunch" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.ok(display.routeRefresh?.impactNotes?.includes("The previewed order revisits an area, so it may create backtracking."));
  });

  it("merges day-level impact notes for multiple pending edits", () => {
    const presentation = presentationFixture({
      places: [
        ...presentationFixture().places,
        place("osaka-dinner", { city: "Osaka", area: "Namba", category: "restaurant", reservation: { requirement: "required", verification: "needs_recheck", note: "Book ahead." }, durationMinutes: 150 }),
        place("tea", { name: "Tea Studio", category: "tea ceremony experience" })
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const add = buildPendingItineraryEditForWorkspace(workspace, "osaka-dinner", { dayId: "day-1", positionId: "after-lunch" });
    const remove = buildPendingItineraryRemoveForWorkspace(workspace, { dayId: "day-1", placeId: "lunch" })!;
    const move = buildPendingItineraryMoveForWorkspace(workspace, { dayId: "day-1", placeId: "craft", position: { kind: "after", afterPlaceId: "temple" } })!;
    const display = itineraryDisplayForWorkspace(workspace, "day-1", [add, remove, move]);
    assert.equal(display.routeRefresh?.summary, "3 unsaved itinerary changes will have travel times checked after you confirm.");
    assert.deepEqual(display.routeRefresh?.impactNotes, [
      "Travel time and timing will be checked after confirmation.",
      "Added places may affect meal spacing, opening windows, and route order.",
      "This edit reaches Osaka, while Kyoto is the day base.",
      "Removed stops stay in Explore and may leave a gap in the day.",
      "Moved stops keep their current time labels until timing is checked."
    ]);
  });

  it("does not expose saved route refresh actions while a day has unsaved drafts", () => {
    const presentation = presentationFixture({
      places: [...presentationFixture().places, place("tea", { name: "Tea Studio", category: "tea ceremony experience" })],
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "unknown", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    assert.equal(workspace.itineraries[0]?.routeRefresh?.actionable, undefined);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.equal(display.routeRefresh?.actionable, false);
    assert.deepEqual(display.routeRefresh?.segmentIds, []);
    assert.match(display.routeRefresh?.summary ?? "", /unsaved itinerary change/);
    assert.match(display.routeRefresh?.summary ?? "", /after you confirm/);
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
      sourceCatalog: [{ id: "route-source", title: "Rain route guide", authority: "Guide", url: "https://guide.example", retrievedAt: "2026-09-02", status: "verified" }],
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "verified", label: "Short walk", detail: "Use the covered shopping lane if it rains.", durationMinutes: 12, evidence: [{ sourceId: "route-source", status: "verified", supports: ["covered walking lane"], checkedAt: "2026-09-02" }], sourceRefs: ["route-source", "https://guide.example?legacy=1", "https://backup.example"] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [
      { title: "Legacy route guide", url: "https://guide.example?legacy=1", authority: "Old guide", retrievedAt: "2026-09-01" },
      { title: "Backup route note", url: "https://backup.example", authority: "Local guide", retrievedAt: "2026-09-01" }
    ] }), presentation);
    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => item.routeAfterLabel), ["12 min walk", undefined, undefined]);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);
    assert.deepEqual(display.items.map((item) => item.title), ["Kiyomizu-dera Temple · 清水寺", "lunch", "tea", "craft"]);
    assert.deepEqual(display.items.map((item) => item.timeLabel), ["09:30", "Around lunch", "Draft", "Flexible afternoon"]);
    assert.deepEqual(display.items.map((item) => item.kind === "pending" ? item.statusLabel : undefined), [undefined, undefined, "Not saved", undefined]);
    assert.deepEqual(display.items.map((item) => item.routeAfterLabel), [undefined, undefined, undefined, undefined]);
    assert.deepEqual(display.routePlaces.map((item) => item.id), ["temple", "lunch", "craft"]);
    assert.deepEqual(display.routeSegments.map((segment) => segment.id), ["route-1"]);
    assert.deepEqual(display.routeSegments.map((segment) => ({ detail: segment.detail, sources: segment.sources.map((source) => source.summary) })), [{
      detail: "Use the covered shopping lane if it rains.",
      sources: [
        "Rain route guide · Guide · 2026-09-02 · covered walking lane · checked 2026-09-02",
        "Backup route note · Local guide · 2026-09-01"
      ]
    }]);
    assert.doesNotMatch(JSON.stringify(display.routeSegments[0]?.sources), /route-source|legacy=1|fieldEvidence|schema|candidate/i);
    assert.deepEqual(display.markers.map((marker) => ({ id: marker.placeId, state: marker.markerState, type: marker.type, coordinates: marker.coordinates, hasLabel: "label" in marker })), [
      { id: "temple", state: "on-day", type: "attraction", coordinates: [35.0, 135.0], hasLabel: false },
      { id: "lunch", state: "on-day", type: "dining", coordinates: [35.1, 135.1], hasLabel: false },
      { id: "craft", state: "on-day", type: "shopping", coordinates: [35.2, 135.2], hasLabel: false },
      { id: "tea", state: "pending", type: "experience", coordinates: [35.15, 135.15], hasLabel: false }
    ]);
  });

  it("hides saved route readouts while an itinerary draft changes the day sequence", () => {
    const presentation = presentationFixture({
      places: [
        place("temple", { category: "temple" }),
        place("lunch", { category: "restaurant" }),
        place("craft", { category: "shopping craft store" }),
        place("tea", { category: "tea ceremony experience" })
      ],
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "verified", label: "12 min walk", durationMinutes: 12, sourceRefs: [] }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);
    const edit = buildPendingItineraryEditForWorkspace(workspace, "tea", { dayId: "day-1", positionId: "after-lunch" });
    const display = itineraryDisplayForWorkspace(workspace, "day-1", edit);

    assert.deepEqual(workspace.itineraries[0]?.items.map((item) => item.routeAfterLabel), ["12 min walk", undefined, undefined]);
    assert.deepEqual(display.items.map((item) => item.routeAfterLabel), [undefined, undefined, undefined, undefined]);
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

  it("uses Blueprint requirements to make preparation checklist items traveler-facing", () => {
    const presentation = presentationFixture({
      places: [place("temple", { name: "Nezu Shrine", localizedName: "根津神社" })],
      actionRequirements: [{
        id: "entry-check",
        kind: "travel_authorization",
        title: "Check Japan entry rules",
        description: "Review official entry rules for the traveler passport before departure.",
        accountableParty: "traveler",
        completionCondition: "Entry rules reviewed.",
        relevantAt: "Before departure",
        placeId: "temple",
        evidence: []
      }],
      preparationChecklist: [{
        id: "prep-entry",
        title: "Travel authorization",
        group: "documents",
        completionCondition: "Entry rules reviewed.",
        requirementId: "entry-check",
        evidence: []
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, {
      stages: [{
        id: "legacy",
        title: "Travel authorization",
        description: "Legacy task stage.",
        tasks: [{ id: "legacy-prep", title: "Old visa task", description: "Old task.", owner: "user", status: "completed", dueLabel: "2026-09-25", preparationCategory: "documents" }]
      }]
    }), presentation);
    const item = workspace.preparationGroups[0]?.items[0] as unknown as Record<string, unknown>;
    assert.equal(workspace.preparationGroups[0]?.title, "Action Required");
    assert.equal(item.title, "Check Japan entry rules");
    assert.equal(item.description, "Review official entry rules for the traveler passport before departure.");
    assert.equal(item.completion, "Entry rules reviewed.");
    assert.equal(item.context, "For Nezu Shrine · 根津神社 · Before departure");
    assert.equal(item.role, "action");
    assert.equal(item.checked, false);
    assert.equal(item.checkable, false);
    assert.equal(item.requirementId, "entry-check");
    assert.equal("taskId" in item, false);
    const text = JSON.stringify(workspace.preparationGroups);
    assert.equal(/authorization|dueLabel|relevantAt|accountableParty|travel_authorization|legacy/i.test(text), false);
  });

  it("maps action requirements to stable task ids without using display text", () => {
    const presentation = presentationFixture({
      preparationChecklist: [],
      actionRequirements: [{
        id: "confirm-pickup",
        kind: "transport",
        title: "Confirm driver pickup",
        description: "Confirm the hotel pickup time.",
        accountableParty: "traveler",
        completionCondition: "Pickup time is confirmed.",
        evidence: []
      }, {
        id: "confirm-dropoff",
        kind: "transport",
        title: "Confirm driver dropoff",
        description: "Confirm the airport dropoff time.",
        accountableParty: "traveler",
        completionCondition: "Dropoff time is confirmed.",
        evidence: []
      }]
    });
    const display = buildBlueprintWorkspaceDisplay(planFixture(presentation, {
      id: "plan-a",
      stages: [{
        id: "transport",
        title: "Transport preparation",
        description: "Transport tasks.",
        tasks: [
          { id: "task-pickup", requirementId: "confirm-pickup", title: "Confirm driver pickup", owner: "user", status: "completed", dueLabel: "Before departure", preparationCategory: "booking" },
          { id: "task-dropoff", requirementId: "confirm-dropoff", title: "Confirm driver dropoff", owner: "user", status: "waiting_user", dueLabel: "Before departure", preparationCategory: "booking" }
        ]
      }]
    }), presentation);

    assert.deepEqual(display.preparationGroups[0]?.items.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      requirementId: item.requirementId,
      checked: item.checked,
      checkable: item.checkable
    })), [
      { id: "confirm-pickup", taskId: "task-pickup", requirementId: "confirm-pickup", checked: true, checkable: true },
      { id: "confirm-dropoff", taskId: "task-dropoff", requirementId: "confirm-dropoff", checked: false, checkable: true }
    ]);
  });

  it("keeps completion state isolated by Plan task identity", () => {
    const presentation = presentationFixture({
      preparationChecklist: [],
      actionRequirements: [{
        id: "shared-requirement",
        kind: "preparation",
        title: "Confirm ticket readiness",
        description: "Make sure the ticket is ready.",
        accountableParty: "traveler",
        completionCondition: "Ticket readiness is handled.",
        evidence: []
      }]
    });
    const planA = planFixture(presentation, {
      id: "plan-a",
      stages: [{ id: "prep-a", title: "Before departure", description: "A", tasks: [{ id: "task-a", requirementId: "shared-requirement", title: "Confirm ticket readiness", owner: "user", status: "completed", dueLabel: "Before departure", preparationCategory: "other_predeparture" }] }]
    });
    const planB = planFixture(presentation, {
      id: "plan-b",
      stages: [{ id: "prep-b", title: "Before departure", description: "B", tasks: [{ id: "task-b", requirementId: "shared-requirement", title: "Confirm ticket readiness", owner: "user", status: "waiting_user", dueLabel: "Before departure", preparationCategory: "other_predeparture" }] }]
    });

    assert.equal(buildBlueprintWorkspaceDisplay(planA, presentation).preparationGroups[0]?.items[0]?.checked, true);
    assert.equal(buildBlueprintWorkspaceDisplay(planB, presentation).preparationGroups[0]?.items[0]?.checked, false);
  });

  it("puts action requirements before general preparation and deduplicates matching checklist items", () => {
    const longDescription = "Reserve the exact class date, session time, menu, pickup details, allergy notes, cancellation terms, and written capacity confirmation for all travelers before relying on this activity as the day anchor.";
    const presentation = presentationFixture({
      actionRequirements: [{
        id: "reserve-class",
        kind: "reservation",
        title: "Confirm cooking class booking",
        description: longDescription,
        accountableParty: "traveler",
        completionCondition: "The class confirms date, time, menu, pickup details, and capacity.",
        relevantAt: "Before the selected class date",
        evidence: []
      }, {
        id: "assistant-route-check",
        kind: "time_sensitive_recheck",
        title: "Verify route durations",
        description: "Assistant should refresh route durations.",
        accountableParty: "assistant",
        completionCondition: "Routes refreshed.",
        evidence: []
      }],
      preparationChecklist: [{
        id: "prep-class",
        title: "Confirm cooking class booking",
        description: longDescription,
        group: "bookings_departure",
        completionCondition: "The class confirms date, time, menu, pickup details, and capacity.",
        evidence: []
      }, {
        id: "prep-pack",
        title: "Pack rain gear",
        description: "Bring light rain shells and shoes suitable for wet paths.",
        group: "packing",
        completionCondition: "Rain gear is packed.",
        evidence: []
      }]
    });
    const groups = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).preparationGroups;

    assert.deepEqual(groups.map((group) => group.title), ["Action Required", "Packing"]);
    assert.deepEqual(groups[0]?.items.map((item) => ({ title: item.title, role: item.role, description: item.description })), [{
      title: "Confirm cooking class booking",
      role: "action",
      description: longDescription
    }]);
    assert.deepEqual(groups[1]?.items.map((item) => ({ title: item.title, role: item.role })), [{ title: "Pack rain gear", role: "general" }]);
    assert.equal(JSON.stringify(groups).includes("Verify route durations"), false);
    assert.equal(groups.flatMap((group) => group.items).filter((item) => item.title === "Confirm cooking class booking").length, 1);
  });

  it("keeps text-only guide cards free of source marker fields", () => {
    const presentation = presentationFixture({
      places: [place("sourced", { evidenceSources: [{ title: "Official hours", url: "https://example.com", role: "Opening hours", status: "verified", checkedAt: "2026-09-01" }] })],
      days: []
    });
    const card = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).guideCards[0] as unknown as Record<string, unknown>;
    assert.equal("source" in card, false);
  });

  it("exposes sourced detail images without creating placeholders for missing images", () => {
    const presentation = presentationFixture({
      places: [
        place("with-image", {
          images: [{ url: "https://example.com/place.jpg", alt: "Tea studio entry", sourceId: "photo-source", caption: "Studio entry", usage: ["detail"], status: "verified" }]
        }),
        place("without-image")
      ],
      sourceCatalog: [{ id: "photo-source", title: "Official gallery", authority: "Tea Studio", url: "https://example.com/gallery", retrievedAt: "2026-09-03", status: "verified" }],
      days: []
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.deepEqual(detailDisplayForWorkspacePlace(workspace, "with-image")?.image, {
      url: "https://example.com/place.jpg",
      alt: "Tea studio entry",
      caption: "Studio entry",
      source: {
        label: "Image source",
        summary: "Official gallery · Tea Studio · 2026-09-03",
        url: "https://example.com/gallery",
        contexts: ["Image for with-image"]
      }
    });
    assert.equal(detailDisplayForWorkspacePlace(workspace, "without-image")?.image, undefined);
  });

  it("lists detail sources without duplicating matching source refs", () => {
    const presentation = presentationFixture({
      places: [place("sourced", {
        fieldEvidence: [{ path: "places.sourced.whyWorthIt", status: "verified", evidence: [{ sourceId: "source-place", status: "verified", supports: ["why it belongs"], checkedAt: "2026-09-03" }] }],
        evidenceSources: [{ title: "Official hours", url: "https://example.com/?utm=legacy#hours", role: "Opening hours", status: "verified", checkedAt: "2026-09-01" }],
        sourceRefs: ["source-place", "https://example.com?utm=source-ref", "https://guide.example"]
      })],
      sourceCatalog: [{ id: "source-place", title: "Official place guide", authority: "City guide", url: "https://example.com", retrievedAt: "2026-09-03", status: "verified" }],
      days: []
    });
    const sources = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [{ title: "Guide article", url: "https://guide.example", authority: "Guide", retrievedAt: "2026-09-02" }] }), presentation), "sourced")?.sources ?? [];
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.summary, "Official place guide · City guide · 2026-09-03 · why it belongs · checked 2026-09-03");
    assert.equal(sources[1]?.summary, "Guide article · Guide · 2026-09-02");
    assert.equal(/places\.sourced\.whyWorthIt|fieldEvidence/i.test(JSON.stringify(sources)), false);
  });

  it("does not repeat source-attached wording in the sources list", () => {
    const plan = planFixture(presentationFixture(), { sources: [{ title: "Official guide", url: "https://example.com", authority: "Official", retrievedAt: "2026-09-01" }] });
    assert.deepEqual(buildBlueprintWorkspaceDisplay(plan, plan.presentation!).sources.map((source) => source.summary), ["Official guide · Official · 2026-09-01"]);
  });

  it("uses Blueprint sources before legacy plan sources in the sources list", () => {
    const presentation = presentationFixture({
      sourceCatalog: [
        { id: "source-place", title: "Blueprint place guide", authority: "City guide", url: "https://example.com/place", retrievedAt: "2026-09-03", status: "verified" },
        { id: "source-event", title: "Festival calendar", authority: "Official events", url: "https://events.example/festival", retrievedAt: "2026-09-04", status: "verified" }
      ],
      fieldEvidence: [{ path: "summary", status: "verified", evidence: [{ sourceId: "source-place", status: "verified", supports: ["trip theme"], checkedAt: "2026-09-03" }] }],
      places: [place("sourced", {
        fieldEvidence: [{ path: "places.sourced.plan", status: "verified", evidence: [{ sourceId: "source-place", status: "verified", supports: ["visit plan"], checkedAt: "2026-09-03" }] }],
        evidenceSources: [{ title: "Legacy place evidence", url: "https://example.com/place?legacy=1#hours", role: "Opening hours", status: "verified" }],
        sourceRefs: ["source-place"]
      })],
      routeSegments: [{ id: "route-1", originPlaceId: "sourced", destinationPlaceId: "nearby", mode: "walking", verification: "verified", dayId: "day-1", sourceRefs: [], evidence: [{ sourceId: "source-place", status: "verified", supports: ["checked walking sequence"], checkedAt: "2026-09-03" }] }],
      travelTips: [{ id: "tip-cash", title: "Carry cash", body: "Small shops may prefer cash.", theme: "payment", context: "Temple shopping", evidence: [{ sourceId: "source-place", status: "verified", supports: ["temple-side cash"] }] }],
      preparationChecklist: [{ id: "prep-passport", title: "Check passport", group: "documents", completionCondition: "Passport checked.", evidence: [{ sourceId: "source-place", status: "verified", supports: ["passport reminder"] }] }],
      actionRequirements: [{ id: "reserve-entry", kind: "reservation", title: "Choose entry time", description: "Choose the current entry time.", accountableParty: "traveler", completionCondition: "Entry time chosen.", placeId: "sourced", evidence: [{ sourceId: "source-place", status: "verified", supports: ["timed entry"] }] }],
      events: [{ id: "festival", title: "Festival", description: "Nearby event.", evidence: [{ sourceId: "source-event", status: "stale", supports: ["festival date"], checkedAt: "2026-09-04" }], sourceRefs: ["source-event"] }],
      days: []
    });
    const plan = planFixture(presentation, {
      sources: [
        { title: "Old saved source", url: "https://example.com/place?utm=old", authority: "Legacy", retrievedAt: "2026-09-01" },
        { title: "Independent guide", url: "https://guide.example", authority: "Guide", retrievedAt: "2026-09-02" }
      ]
    });
    const sources = buildBlueprintWorkspaceDisplay(plan, presentation).sources;

    assert.deepEqual(sources.map((source) => source.summary), [
      "Blueprint place guide · City guide · 2026-09-03",
      "Festival calendar · Official events · 2026-09-04",
      "Independent guide · Guide · 2026-09-02"
    ]);
    assert.ok(sources[0]?.contexts?.includes("Supports trip planning details"));
    assert.ok(sources[0]?.contexts?.includes("Supports route timing"));
    assert.ok(sources[0]?.contexts?.includes("Supports payment tip"));
    assert.ok(sources[0]?.contexts?.includes("Supports travel preparation"));
    assert.ok(sources[0]?.contexts?.includes("Supports reservation planning"));
    assert.ok(sources[0]?.contexts?.includes("Supports timed entry"));
    assert.ok(sources[1]?.contexts?.includes("Supports event timing"));
    assert.ok(sources[1]?.contexts?.includes("Needs confirmation close to the trip"));
    assert.ok(sources[1]?.contexts?.includes("Checked 2026-09-04"));
    assert.equal(/fieldEvidence|source-place|places\.sourced|schema|candidate|reserve-entry|accountableParty/i.test(JSON.stringify(sources)), false);
  });

  it("groups Sources by recheck and grounded evidence without losing structured sources", () => {
    const longEntryUrl = "https://official.example/travel/entry-requirements/indonesia/visa-on-arrival?utm_source=planner&very_long_tracking_parameter=abcdefghijklmnopqrstuvwxyz";
    const presentation = presentationFixture({
      sourceCatalog: [
        { id: "entry-official", title: "Official entry requirements", authority: "Immigration authority", url: longEntryUrl, retrievedAt: "2026-09-03", status: "verified" },
        { id: "kecak-calendar", title: "Kecak performance calendar", authority: "Uluwatu operator", url: "https://operator.example/uluwatu/kecak", retrievedAt: "2026-09-04", status: "verified" },
        { id: "same-publisher-monkey", title: "Monkey Forest visitor information", authority: "Bali Tourism", url: "https://tourism.example/places/monkey-forest", retrievedAt: "2026-09-01", status: "verified" },
        { id: "same-publisher-jatiluwih", title: "Jatiluwih visitor information", authority: "Bali Tourism", url: "https://tourism.example/places/jatiluwih", retrievedAt: "2026-09-01", status: "verified" }
      ],
      fieldEvidence: [{ path: "summary", status: "verified", evidence: [{ sourceId: "entry-official", status: "verified", supports: ["entry requirements"], checkedAt: "2026-09-03" }] }],
      actionRequirements: [
        { id: "confirm-kecak", kind: "time_sensitive_recheck", title: "Confirm Kecak time", description: "Confirm the October performance time.", accountableParty: "traveler", completionCondition: "Performance time confirmed.", evidence: [{ sourceId: "kecak-calendar", status: "recheck", supports: ["October Kecak session"], checkedAt: "2026-09-04" }] }
      ],
      places: [
        place("monkey", { name: "Monkey Forest", fieldEvidence: [{ path: "places.monkey.plan", status: "verified", evidence: [{ sourceId: "same-publisher-monkey", status: "verified", supports: ["visitor information"] }] }] }),
        place("jatiluwih", { name: "Jatiluwih", fieldEvidence: [{ path: "places.jatiluwih.plan", status: "verified", evidence: [{ sourceId: "same-publisher-jatiluwih", status: "verified", supports: ["visitor information"] }] }] })
      ],
      researchGrounding: ["Narrative targeted research note without a structured source identity."],
      days: []
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, {
      sources: [
        { title: "Legacy duplicate entry source", url: "https://official.example/travel/entry-requirements/indonesia/visa-on-arrival?utm_campaign=old", authority: "Legacy", retrievedAt: "2026-09-01" },
        { title: "Independent planning article", url: "https://independent.example/bali/planning", authority: "Independent guide", retrievedAt: "2026-09-02" }
      ]
    }), presentation);

    assert.equal(workspace.sources.length, 5);
    assert.deepEqual(workspace.sourceGroups.map((group) => group.id), ["needs_recheck", "verified", "other"]);
    assert.equal(workspace.sourceGroups.flatMap((group) => group.sources).length, workspace.sources.length);
    assert.deepEqual(workspace.sourceGroups[0]?.sources.map((source) => source.title), ["Kecak performance calendar"]);
    assert.equal(workspace.sourceGroups.flatMap((group) => group.sources).filter((source) => source.url?.startsWith("https://official.example/travel/entry-requirements")).length, 1);
    assert.deepEqual(workspace.sourceGroups.flatMap((group) => group.sources).filter((source) => source.publisher === "Bali Tourism").map((source) => source.title).sort(), ["Jatiluwih visitor information", "Monkey Forest visitor information"]);
    assert.equal(workspace.sourceGroups.flatMap((group) => group.sources).find((source) => source.url === longEntryUrl)?.title, "Official entry requirements");
    assert.deepEqual(workspace.researchGrounding, ["Narrative targeted research note without a structured source identity."]);
    assert.equal(JSON.stringify(workspace.sourceGroups).includes("Narrative targeted research note"), false);
    assert.equal(/entry-official|kecak-calendar|same-publisher/i.test(JSON.stringify(workspace.sourceGroups)), false);
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

  it("uses Blueprint relationship graph before display rows or inferred same-type comparisons", () => {
    const presentation = presentationFixture({
      guideRelationshipGraph: {
        relationships: [
          { id: "rel-meal", kind: "meal_support", fromPlaceId: "selected", toPlaceId: "lunch", rationale: "Lunch keeps the garden morning easy.", dayIds: ["day-1"], evidence: [{ sourceId: "guide", status: "verified" }] },
          { id: "rel-alt", kind: "alternative", fromPlaceId: "selected", toPlaceId: "museum", rationale: "Use this when the main stop is crowded.", evidence: [] },
          { id: "rel-direction", kind: "same_direction", fromPlaceId: "market", toPlaceId: "selected", rationale: "This stays on the same east-side route.", dayIds: ["day-1"], evidence: [{ sourceId: "guide", status: "recheck" }] },
          { id: "rel-rain", kind: "rainy_day_alternative", fromPlaceId: "selected", toPlaceId: "arcade", rationale: "Refresh this route before execution.", evidence: [{ sourceId: "guide", status: "recheck" }] }
        ]
      },
      places: [
        place("selected", {
          category: "garden",
          area: "East",
          guideDisplay: {
            comparisonRows: [{
              id: "display-row",
              relatedPlaceId: "fallback",
              area: "West",
              routeFit: "Display fallback",
              timing: "Display timing",
              effort: "Display effort",
              sourceState: "Display source"
            }]
          }
        }),
        place("lunch", { category: "restaurant", area: "East" }),
        place("museum", { category: "museum", area: "North" }),
        place("market", { category: "market", area: "East" }),
        place("arcade", { category: "shopping arcade", area: "Central", evidenceSources: [{ title: "Arcade guide", url: "https://arcade.example", status: "verified" }] }),
        place("fallback", { category: "garden", area: "West", officialUrl: "https://fallback.example" })
      ]
    });
    const rows = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation), "selected")?.comparisonRows ?? [];

    assert.deepEqual(rows.map((row) => ({ id: row.id, route: row.routeFit, timing: row.timing, effort: row.effort, source: row.sourceState })), [
      { id: "lunch", route: "Meal support", timing: "October 1", effort: "Lunch keeps the garden morning easy.", source: "Verified connection" },
      { id: "museum", route: "Alternative", timing: "Flexible timing", effort: "Use this when the main stop is crowded.", source: "No source listed" },
      { id: "market", route: "Same direction", timing: "October 1", effort: "This stays on the same east-side route.", source: "Referenced connection" },
      { id: "arcade", route: "Rain option", timing: "Flexible timing", effort: "Rain option", source: "Referenced connection" }
    ]);
    assert.equal(rows.some((row) => row.id === "display-row" || row.id === "fallback"), false);
    assert.doesNotMatch(JSON.stringify(rows), /\bcandidate\b|\bschema\b|\bjson\b|\broute refresh\b|\bexecution\b|\breplan\b/i);
  });

  it("deduplicates nearby alternatives by related place identity", () => {
    const presentation = presentationFixture({
      guideRelationshipGraph: {
        relationships: [
          { id: "rel-rain", kind: "rainy_day_alternative", fromPlaceId: "selected", toPlaceId: "museum", rationale: "Use the museum if rain changes the walk.", dayIds: ["day-1"], evidence: [{ sourceId: "guide", status: "verified" }] },
          { id: "rel-area", kind: "same_area", fromPlaceId: "selected", toPlaceId: "museum", rationale: "Both fit the same Ubud area.", dayIds: ["day-1"], evidence: [] },
          { id: "rel-energy", kind: "low_energy_alternative", fromPlaceId: "selected", toPlaceId: "garden", rationale: "Use the garden when energy is low.", evidence: [] }
        ]
      },
      places: [
        place("selected", { category: "walk", area: "Ubud" }),
        place("museum", { name: "Museum Puri Lukisan", category: "museum", area: "Ubud" }),
        place("garden", { name: "Quiet Garden", category: "garden", area: "Ubud" })
      ]
    });
    const rows = detailDisplayForWorkspacePlace(buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation), "selected")?.comparisonRows ?? [];

    assert.deepEqual(rows.map((row) => ({ id: row.id, routeFit: row.routeFit, timing: row.timing, sourceState: row.sourceState })), [
      { id: "museum", routeFit: "Rain option", timing: "October 1", sourceState: "Verified connection" },
      { id: "garden", routeFit: "Low-energy option", timing: "Flexible timing", sourceState: "No source listed" }
    ]);
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
    assert.equal(itinerary.items[0]?.routeAfterStatusLabel, undefined);
    assert.equal("routeStatusLabel" in itinerary.items[0]!, false);
    assert.equal(itinerary.routeRefresh, undefined);
    assert.equal(itinerary.routeSegments[0]?.verification, "needs_verification");
    assert.equal(itinerary.routeSegments[0]?.needsRefresh, false);
    assert.equal(itinerary.routeSegments[0]?.mapLineState, "formal");
  });

  it("uses Blueprint route display intent before route prose inference", () => {
    const presentation = presentationFixture({
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "needs_verification", label: "Old route label", detail: "Keep this adjacent leg in the itinerary order.", display: { routeLabel: "Blueprint route label", refreshReason: "Refresh this leg after direct itinerary edits.", refreshScope: { dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", reason: "direct_itinerary_edit" }, showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] },
        { id: "route-2", dayId: "day-1", originPlaceId: "lunch", destinationPlaceId: "craft", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This hidden context route was edited directly.", display: { showAsFormalRoute: false, mapLineState: "reference", refreshReason: "Hidden route context only." }, sourceRefs: [] }
      ]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;
    assert.deepEqual(itinerary.routeSegments.map((segment) => ({ id: segment.id, label: segment.label, needsRefresh: segment.needsRefresh, mapLineState: segment.mapLineState, refreshReason: segment.refreshReason })), [
      { id: "route-1", label: "Blueprint route label", needsRefresh: true, mapLineState: "needs_refresh", refreshReason: "Check travel time after this stop." }
    ]);
    assert.equal(itinerary.items[0]?.routeAfterStatusLabel, "Travel time will be checked automatically.");
    assert.equal(itinerary.items[1]?.routeAfterStatusLabel, undefined);
    assert.equal(itinerary.items.some((item) => "routeStatusLabel" in item), false);
    assert.doesNotMatch(JSON.stringify({
      routeSegments: itinerary.routeSegments.map((segment) => ({ label: segment.label, detail: segment.detail, reason: segment.refreshReason })),
      routeReadouts: itinerary.items.map((item) => item.routeAfterStatusLabel)
    }), /\brefresh\b|\bexecution\b|\breplan/i);
  });

  it("does not expose a route refresh action for verified route legs", () => {
    const presentation = presentationFixture({
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "verified", label: "Old route label", detail: "Verified route detail.", display: { routeLabel: "Blueprint route label", refreshReason: "Should not show.", refreshScope: { dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", reason: "direct_itinerary_edit" }, showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] }
      ]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;
    assert.equal(itinerary.routeRefresh, undefined);
    assert.equal(itinerary.routeSegments[0]?.needsRefresh, false);
    assert.equal(itinerary.routeSegments[0]?.mapLineState, "formal");
    assert.equal(itinerary.items[0]?.routeAfterStatusLabel, undefined);
    assert.equal("routeStatusLabel" in itinerary.items[0]!, false);
  });

  it("keeps verified route labels natural when old refresh intent remains in data", () => {
    const presentation = presentationFixture({
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "verified", durationMinutes: 12, label: "Route needs refresh", detail: "This day was edited directly. Refresh routing before execution.", display: { routeLabel: "Route needs refresh", refreshReason: "Refresh this route leg after direct itinerary edits.", refreshScope: { dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", reason: "direct_itinerary_edit" }, showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] }
      ]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.equal(itinerary.routeRefresh, undefined);
    assert.equal(itinerary.routeSegments[0]?.label, "12 min walk");
    assert.equal(itinerary.routeSegments[0]?.detail, undefined);
    assert.equal(itinerary.routeSegments[0]?.needsRefresh, false);
    assert.equal(itinerary.routeSegments[0]?.mapLineState, "formal");
  });

  it("surfaces direct edit route refresh without marking unrelated routes", () => {
    const presentation = presentationFixture({
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "unknown", verification: "needs_verification", label: "Walk toward lunch", detail: "Keep this adjacent leg in the itinerary order.", display: { routeLabel: "Walk toward lunch", refreshReason: "Refresh this route leg after direct itinerary edits.", showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] },
        { id: "route-2", dayId: "day-1", originPlaceId: "lunch", destinationPlaceId: "craft", mode: "walking", verification: "verified", label: "Short walk", sourceRefs: [] }
      ]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;
    assert.equal(itinerary.routeSegments[0]?.needsRefresh, true);
    assert.equal(itinerary.routeSegments[1]?.needsRefresh, false);
    assert.deepEqual(itinerary.routeRefresh, {
      segmentCount: 1,
      segmentIds: ["route-1"],
      dayLabel: "2026-10-01",
      summary: "1 travel leg on 2026-10-01 will be checked automatically.",
      request: "Check travel times for 2026-10-01. Review the affected travel leg, timing, meal spacing, and opening constraints before marking this itinerary ready."
    });
    assert.deepEqual(itinerary.items.map((item) => item.routeAfterStatusLabel), ["Travel time will be checked automatically.", undefined, undefined]);
    assert.equal(itinerary.items.some((item) => "routeStatusLabel" in item), false);
    assert.doesNotMatch(JSON.stringify({
      travelNotice: itinerary.routeRefresh,
      routeReadouts: itinerary.items.map((item) => item.routeAfterStatusLabel)
    }), /\brefresh\b|\bexecution\b|\breplan/i);
  });

  it("keeps partially refreshed days split between confirmed readouts and route checks", () => {
    const presentation = presentationFixture({
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "verified", label: "9 min walk", detail: "Walk from temple to lunch; allow about 9 minutes.", display: { routeLabel: "9 min walk", showAsFormalRoute: true, mapLineState: "formal" }, sourceRefs: ["google_maps"] },
        { id: "route-2", dayId: "day-1", originPlaceId: "lunch", destinationPlaceId: "craft", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Route needs refresh.", display: { routeLabel: "Route needs refresh", refreshReason: "Check this walk after the itinerary edit.", showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] }
      ]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.deepEqual(itinerary.items.map((item) => item.routeAfterLabel), ["9 min walk", undefined, undefined]);
    assert.deepEqual(itinerary.items.map((item) => item.routeAfterStatusLabel), [undefined, "Travel time will be checked automatically.", undefined]);
    assert.equal(itinerary.items.some((item) => "routeStatusLabel" in item), false);
    assert.deepEqual(itinerary.routeSegments.map((segment) => [segment.id, segment.needsRefresh, segment.mapLineState]), [
      ["route-1", false, "formal"],
      ["route-2", true, "needs_refresh"]
    ]);
    assert.deepEqual(itinerary.routeRefresh?.segmentIds, ["route-2"]);
  });

  it("shows confirmed travel readouts after every checked route leg succeeds", () => {
    const presentation = presentationFixture({
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "verified", durationMinutes: 9, label: "9 min walk", detail: "Walk from temple to lunch; allow about 9 minutes.", display: { routeLabel: "9 min walk", showAsFormalRoute: true, mapLineState: "formal" }, sourceRefs: ["google_maps"] },
        { id: "route-2", dayId: "day-1", originPlaceId: "lunch", destinationPlaceId: "craft", mode: "walking", verification: "verified", durationMinutes: 7, label: "7 min walk", detail: "Walk from lunch to craft; allow about 7 minutes.", display: { routeLabel: "7 min walk", showAsFormalRoute: true, mapLineState: "formal" }, sourceRefs: ["google_maps"] }
      ]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.equal(itinerary.routeRefresh, undefined);
    assert.deepEqual(itinerary.items.map((item) => item.routeAfterLabel), ["9 min walk", "7 min walk", undefined]);
    assert.deepEqual(itinerary.items.map((item) => item.routeAfterStatusLabel), [undefined, undefined, undefined]);
    assert.equal(itinerary.items.some((item) => "routeStatusLabel" in item), false);
    assert.deepEqual(itinerary.routeSegments.map((segment) => [segment.id, segment.needsRefresh, segment.mapLineState]), [
      ["route-1", false, "formal"],
      ["route-2", false, "formal"]
    ]);
  });

  it("keeps unchecked travel legs out of confirmed readouts when no route check succeeds", () => {
    const presentation = presentationFixture({
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Route needs refresh.", display: { routeLabel: "Route needs refresh", refreshReason: "Refresh this route leg after direct itinerary edits.", showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] },
        { id: "route-2", dayId: "day-1", originPlaceId: "lunch", destinationPlaceId: "craft", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Route needs refresh.", display: { routeLabel: "Route needs refresh", refreshReason: "Refresh this route leg after direct itinerary edits.", showAsFormalRoute: true, mapLineState: "needs_refresh" }, sourceRefs: [] }
      ]
    });
    const itinerary = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!;

    assert.deepEqual(itinerary.items.map((item) => item.routeAfterLabel), [undefined, undefined, undefined]);
    assert.deepEqual(itinerary.items.map((item) => item.routeAfterStatusLabel), [
      "Travel time will be checked automatically.",
      "Travel time will be checked automatically.",
      undefined
    ]);
    assert.equal(itinerary.items.some((item) => "routeStatusLabel" in item), false);
    assert.deepEqual(itinerary.routeRefresh?.segmentIds, ["route-1", "route-2"]);
    assert.deepEqual(itinerary.routeSegments.map((segment) => [segment.id, segment.needsRefresh, segment.mapLineState]), [
      ["route-1", true, "needs_refresh"],
      ["route-2", true, "needs_refresh"]
    ]);
    assert.doesNotMatch(JSON.stringify({
      travelNotice: itinerary.routeRefresh,
      routeStatusReadouts: itinerary.items.map((item) => item.routeAfterStatusLabel),
      confirmedReadouts: itinerary.items.map((item) => item.routeAfterLabel)
    }), /\brefresh\b|\bexecution\b|\breplan/i);
  });

  it("scopes direct edit route refresh controls to the visible itinerary day", () => {
    const presentation = presentationFixture({
      places: [
        ...presentationFixture().places,
        place("station", { name: "Station", category: "transport" }),
        place("market", { name: "Market", category: "market" })
      ],
      days: [
        presentationFixture().days[0]!,
        { id: "day-2", label: "October 2", date: "2026-10-02", city: "Kyoto", placeIds: ["station", "market"], stops: [{ placeId: "station", order: 1, time: "10:00" }, { placeId: "market", order: 2, time: "12:00" }], candidates: [] }
      ],
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] },
        { id: "route-2", dayId: "day-1", originPlaceId: "lunch", destinationPlaceId: "craft", mode: "walking", verification: "verified", label: "Short walk", sourceRefs: [] },
        { id: "route-3", dayId: "day-2", originPlaceId: "station", destinationPlaceId: "market", mode: "transit", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }
      ]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation);

    assert.deepEqual(workspace.itineraries[0]?.routeRefresh, {
      segmentCount: 1,
      segmentIds: ["route-1"],
      dayLabel: "2026-10-01",
      summary: "1 travel leg on 2026-10-01 will be checked automatically.",
      request: "Check travel times for 2026-10-01. Review the affected travel leg, timing, meal spacing, and opening constraints before marking this itinerary ready."
    });
    assert.deepEqual(workspace.itineraries[1]?.routeRefresh, {
      segmentCount: 1,
      segmentIds: ["route-3"],
      dayLabel: "2026-10-02",
      summary: "1 travel leg on 2026-10-02 will be checked automatically.",
      request: "Check travel times for 2026-10-02. Review the affected travel leg, timing, meal spacing, and opening constraints before marking this itinerary ready."
    });
    assert.doesNotMatch(JSON.stringify(workspace.itineraries.map((itinerary) => itinerary.routeRefresh?.summary)), /\brefresh\b|\bexecution\b|\breplan/i);
    assert.doesNotMatch(JSON.stringify(workspace.itineraries.map((itinerary) => itinerary.routeRefresh?.request)), /\brefresh\b|\bexecution\b|\breplan/i);
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
      sourceCatalog: [{ id: "event-source", title: "Event guide", authority: "Guide", url: "https://guide.example", retrievedAt: "2026-09-02", status: "verified" }],
      events: [{
        id: "festival",
        title: "Local festival",
        description: "Expect nearby evening crowds.",
        startDate: "2026-10-01",
        locationLabel: "Central Kyoto",
        placeId: "temple",
        evidence: [{ sourceId: "event-source", status: "verified", supports: ["event timing"], checkedAt: "2026-09-02" }],
        sourceRefs: ["event-source", "https://guide.example?legacy=1", "https://backup.example"]
      }]
    });
    const workspace = buildBlueprintWorkspaceDisplay(planFixture(presentation, { sources: [
      { title: "Legacy event guide", url: "https://guide.example?legacy=1", authority: "Old guide", retrievedAt: "2026-09-01" },
      { title: "Backup event guide", url: "https://backup.example", authority: "Guide", retrievedAt: "2026-09-01" }
    ] }), presentation);
    const detail = detailDisplayForWorkspacePlace(workspace, "temple")!;
    assert.deepEqual(detail.relatedEvents.map((event) => ({ title: event.title, dateLabel: event.dateLabel, sources: event.sources.map((source) => source.summary) })), [{
      title: "Local festival",
      dateLabel: "2026-10-01",
      sources: [
        "Event guide · Guide · 2026-09-02 · event timing · checked 2026-09-02",
        "Backup event guide · Guide · 2026-09-01"
      ]
    }]);
    assert.equal(workspace.itineraries[0]?.items.some((item) => item.placeId === "festival"), false);
    assert.equal(workspace.sources.some((source) => source.summary === "Event guide · Guide · 2026-09-02"), true);
    assert.doesNotMatch(JSON.stringify(detail.relatedEvents), /event-source|legacy=1|fieldEvidence|schema|candidate/i);
  });
});

describe("Timeline place card information", () => {
  const cardImage = { url: "https://images.example/threads.jpg", alt: "Threads of Life textiles", sourceId: "threads-photo", usage: ["card" as const] };
  const places = [
    place("threads", {
      name: "Threads of Life Store",
      city: "Ubud",
      area: "Central Ubud",
      category: "Indonesian textile gallery and shop",
      visitRole: "Craft-focused Central Ubud browse",
      whyWorthIt: "Learn how Indonesian weaving, natural dyes, motifs, and maker communities relate to finished textiles; purchases are optional.",
      plan: "Browse the gallery and shop after the museum.",
      images: [cardImage]
    }),
    place("museum", { name: "Museum Puri Lukisan", city: "Ubud", area: "Central Ubud", category: "art museum focused on Balinese painting and woodcarving", whyWorthIt: "A long collection overview that belongs in the detail panel rather than the Timeline." }),
    place("campuhan", { name: "Campuhan Ridge Walk", city: "Ubud", area: "Campuhan", category: "scenic ridge walk", whyWorthIt: "A long explanation of the valleys and walking conditions that should stay in details." }),
    place("hujan", { name: "Hujan Locale", city: "Ubud", area: "Central Ubud", category: "Indonesian restaurant", reservation: { requirement: "recommended", verification: "verified", note: "Reserve if retaining this lunch time." }, whyWorthIt: "A substantial regional Indonesian lunch provides a seated break and broader food context." }),
    place("jala", { name: "Jala Cooking Academy", city: "Bali", area: "Jimbaran Bay", category: "Balinese cooking class", whyWorthIt: "A complete hands-on class with market and dietary details that belong outside the Timeline." }),
    place("uluwatu", { name: "Uluwatu Temple", city: "Bali", area: "Uluwatu", category: "clifftop sea temple", whyWorthIt: "A long cultural and landscape explanation that belongs in the detail panel." })
  ];
  const blocks: BlueprintItineraryBlock[] = [
    { id: "threads-block", kind: "stop", order: 1, placeId: "threads", startTime: "16:45", endTime: "17:45", summary: "Learn how Indonesian weaving, natural dyes, motifs, and maker communities relate to finished textiles; purchases are optional.", planRole: "planned", operationalConditions: [{ kind: "access", note: "Recheck current opening hours before visiting." }], display: { timingStatus: "planned" }, evidence: [] },
    { id: "museum-block", kind: "stop", order: 2, placeId: "museum", startTime: "10:00", endTime: "12:00", summary: "Use the collection and garden to understand Balinese painting and woodcarving across several generations.", primaryExperience: true, planRole: "planned", operationalConditions: [{ kind: "access", note: "Confirm current opening hours." }], display: { timingStatus: "planned" }, evidence: [] },
    { id: "campuhan-block", kind: "stop", order: 3, placeId: "campuhan", startTime: "07:00", endTime: "08:30", summary: "Take a scenic walk with broad views along the ridge between two river valleys.", primaryExperience: true, planRole: "planned", display: { timingStatus: "planned" }, evidence: [] },
    { id: "hujan-block", kind: "meal", order: 4, placeId: "hujan", startTime: "12:30", endTime: "14:00", summary: "A substantial regional Indonesian lunch provides a seated break and broader food context.", planRole: "planned", display: { timingStatus: "planned" }, evidence: [] },
    { id: "jala-block", kind: "event", order: 5, placeId: "jala", startTime: "09:00", endTime: "13:00", summary: "Join the full cooking program with detailed market, dietary, cancellation, and group-size information.", primaryExperience: true, planRole: "planned", display: { timingStatus: "recheck" }, evidence: [] },
    { id: "uluwatu-block", kind: "stop", order: 6, placeId: "uluwatu", startTime: "16:00", endTime: "17:30", summary: "Visit the clifftop sea temple for cultural context and coastal views before sunset.", primaryExperience: true, planRole: "planned", display: { timingStatus: "planned" }, evidence: [] }
  ];

  function baliCards() {
    const presentation = presentationFixture({
      places,
      days: [{ id: "bali-day", label: "Bali", date: "2026-10-08", city: "Bali", placeIds: places.map((item) => item.id), blocks }],
      routeSegments: [],
      actionRequirements: [{ id: "reserve-jala", kind: "reservation", title: "Reserve Jala", description: "Choose and reserve the cooking class session.", accountableParty: "traveler", completionCondition: "The class is confirmed.", placeId: "jala", evidence: [] }]
    });
    const before = structuredClone(presentation);
    const cards = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!.items;
    assert.deepEqual(presentation, before);
    return cards;
  }

  it("derives concise type and area labels without changing source categories", () => {
    assert.deepEqual(deriveTimelinePlaceMeta(places[0]!), { typeLabel: "Textiles", areaLabel: "Central Ubud", label: "Textiles · Central Ubud" });
    assert.deepEqual(deriveTimelinePlaceMeta(places[1]!), { typeLabel: "Art museum", areaLabel: "Central Ubud", label: "Art museum · Central Ubud" });
    assert.deepEqual(deriveTimelinePlaceMeta(places[4]!), { typeLabel: "Cooking class", areaLabel: "Jimbaran Bay", label: "Cooking class · Jimbaran Bay" });
    assert.equal(places[0]!.category, "Indonesian textile gallery and shop");
  });

  it("uses one stable feature-card hierarchy for the Bali place, dining, and experience cards", () => {
    const cards = baliCards();
    const compact = Object.fromEntries(cards.map((card) => [card.placeId, card]));
    assert.deepEqual([compact.threads?.title, compact.threads?.placeMeta, compact.threads?.purpose, compact.threads?.statusLabel], ["Threads of Life Store", "Textiles · Central Ubud", "Explore Indonesian weaving and natural-dye textiles.", "Hours need recheck"]);
    assert.deepEqual([compact.museum?.title, compact.museum?.placeMeta, compact.museum?.purpose, compact.museum?.statusLabel], ["Museum Puri Lukisan", "Art museum · Central Ubud", "Explore Balinese painting and woodcarving.", "Hours need recheck"]);
    assert.deepEqual([compact.campuhan?.title, compact.campuhan?.placeMeta, compact.campuhan?.purpose], ["Campuhan Ridge Walk", "Ridge walk · Campuhan", "Walk a scenic ridge between river valleys."]);
    assert.deepEqual([compact.hujan?.title, compact.hujan?.placeMeta, compact.hujan?.purpose, compact.hujan?.statusLabel], ["Hujan Locale", "Indonesian dining · Central Ubud", "Explore regional Indonesian cooking.", "Reservation recommended"]);
    assert.deepEqual([compact.jala?.title, compact.jala?.placeMeta, compact.jala?.purpose, compact.jala?.statusLabel], ["Jala Cooking Academy", "Cooking class · Jimbaran Bay", "Try a hands-on Balinese cooking experience.", "Reservation required"]);
    assert.deepEqual([compact.uluwatu?.title, compact.uluwatu?.placeMeta, compact.uluwatu?.purpose, compact.uluwatu?.statusLabel], ["Uluwatu Temple", "Temple · Uluwatu", "Explore a clifftop Balinese temple setting.", undefined]);
    for (const card of cards) {
      assert.ok((card.purpose?.length ?? 0) <= 70);
      assert.doesNotMatch(card.purpose ?? "", /\.\.\.|…|\b\d{1,2}:\d{2}\b|\bmin\b|walk from|transfer from|\b\d+\s*m\b/i);
      assert.notEqual(card.statusLabel, "Planned");
      assert.ok(card.featurePlaceCard);
    }
    assert.deepEqual(compact.threads?.featurePlaceCard?.chips.map((chip) => chip.label), ["Textiles", "Craft", "Culture"]);
    assert.deepEqual(compact.museum?.featurePlaceCard?.chips.map((chip) => chip.label), ["Art museum", "Art", "Indoor"]);
    assert.deepEqual(compact.hujan?.featurePlaceCard?.chips.map((chip) => chip.label), ["Indonesian dining", "Local food"]);
    assert.deepEqual(compact.uluwatu?.featurePlaceCard?.chips.map((chip) => chip.label), ["Temple", "Culture", "Scenic spot"]);
    assert.equal(compact.threads?.featurePlaceCard?.title, "Threads of Life Store");
    assert.equal(compact.museum?.featurePlaceCard?.imageAvailable, false);
    assert.equal(compact.threads?.featurePlaceCard?.imageAvailable, true);
  });

  it("keeps supporting accommodation rows out of the feature-card model", () => {
    const card = deriveTimelineFeaturePlaceCardModel(blocks[1], places[1]!);
    assert.equal(card.title, "Museum Puri Lukisan");
    assert.equal(card.summary, "Explore Balinese painting and woodcarving.");
    assert.equal(card.clickable, true);
    const component = readFileSync(new URL("./LandiBlueprintWorkspace.tsx", import.meta.url), "utf8");
    assert.match(component, /featurePlaceCard \? <>/);
    assert.doesNotMatch(component, /ChevronRight|blueprint-itinerary-arrow|featurePlaceCard[^\n]*&gt;/);
  });

  it("does not upgrade transport endpoints or supporting rows into destination feature cards", () => {
    const image = { url: "https://images.example/airport.jpg", alt: "Airport", sourceId: "airport-photo", usage: ["card" as const] };
    const presentation = presentationFixture({
      places: [place("airport", { name: "I Gusti Ngurah Rai International Airport", category: "airport transport", images: [image] })],
      days: [{ id: "arrival", label: "Arrival", date: "2026-10-05", city: "Bali", placeIds: ["airport"], blocks: [{ id: "arrival-block", kind: "stop", order: 1, placeId: "airport", startTime: "10:35", planRole: "planned", evidence: [] }, { id: "meal", kind: "meal", order: 2, title: "Lunch", startTime: "12:30", planRole: "planned", evidence: [] }] }],
      routeSegments: []
    });
    const items = buildBlueprintWorkspaceDisplay(planFixture(presentation), presentation).itineraries[0]!.items;
    assert.equal(items.find((item) => item.placeId === "airport")?.featurePlaceCard, undefined);
    assert.equal(items.find((item) => item.title === "Lunch")?.featurePlaceCard, undefined);
  });

  it("tries each candidate and removes the image node and slot after all URLs fail", () => {
    const threads = baliCards().find((card) => card.placeId === "threads")!;
    assert.deepEqual(itineraryCardImageForRender(threads.image), { url: cardImage.url, alt: cardImage.alt });
    assert.equal(itineraryCardImageForRender(threads.image, cardImage.url), undefined);
    const candidates = [{ url: "https://images.example/first.jpg", alt: "First" }, { url: "https://images.example/second.jpg", alt: "Second" }];
    assert.deepEqual(itineraryCardImageCandidateForRender(candidates), candidates[0]);
    assert.deepEqual(itineraryCardImageCandidateForRender(candidates, [candidates[0]!.url]), candidates[1]);
    assert.equal(itineraryCardImageCandidateForRender(candidates, candidates.map((image) => image.url)), undefined);
    assert.equal(threads.imageFallback, "text_only");
    const component = readFileSync(new URL("./LandiBlueprintWorkspace.tsx", import.meta.url), "utf8");
    assert.match(component, /image \? <img className=\{imageClassName\} src=\{image\.url\} alt=\{image\.alt\}/s);
    assert.match(component, /onLoad=\{\(\) => setLoadedImageUrl\(image\.url\)\} onError=\{failImage\}/s);
    assert.match(component, /featurePlaceCard \? image \? "with-image" : "text-only"/);
    assert.doesNotMatch(component, /visibility:\s*hidden/);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(css, /\.blueprint-itinerary-thumbnail\.loading\s*\{[^}]*opacity:\s*0/s);
  });

  it("owns compact line limits and selected-only green emphasis in CSS", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(css, /\.blueprint-itinerary-block\.primitive-place strong\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    assert.match(css, /\.blueprint-itinerary-place-purpose\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    assert.match(css, /\.blueprint-itinerary-place-meta\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.blueprint-itinerary-card-main\s*\{[^}]*border:\s*1px solid #edf1f1/s);
    assert.match(css, /\.blueprint-itinerary-block\.selected \.blueprint-itinerary-card-main\s*\{[^}]*border-color:\s*#8bbeb3/s);
    assert.match(css, /\.blueprint-itinerary-block\.feature-place-card\.with-image \.blueprint-itinerary-card-main\s*\{[^}]*grid-template-columns:\s*112px minmax\(0,1fr\)/s);
    assert.match(css, /\.blueprint-itinerary-place-chips\s*\{[^}]*flex-wrap:\s*wrap/s);
    assert.match(css, /\.blueprint-itinerary-grid\s*\{[^}]*grid-template-columns:\s*minmax\(500px,1\.3fr\)/s);
  });
});
