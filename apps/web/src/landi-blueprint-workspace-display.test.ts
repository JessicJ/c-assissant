import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plan, PlanPlace, PlanPresentation } from "@c-assistant/core";
import { comparisonRowsForPlace, filterGuideCards, groupTipsByTheme, guideCardsForPresentation, guideStateForPlace, guideTypeForPlace, localTipsForPlan, roughTimeLabel, sourceMarkerForPlace, sourceMarkersForPlan, sourceSummariesForPlace, timelineBlocksForDay } from "./landi-blueprint-workspace-display.js";

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

describe("Landi Blueprint workspace display helpers", () => {
  it("classifies itinerary guide material into sub-branches", () => {
    assert.equal(guideTypeForPlace(place("a", { category: "landmark" })), "attraction");
    assert.equal(guideTypeForPlace(place("b", { category: "local dining restaurant" })), "dining");
    assert.equal(guideTypeForPlace(place("c", { category: "shopping arcade" })), "shopping");
    assert.equal(guideTypeForPlace(place("d", { category: "tea ceremony experience" })), "experience");
  });

  it("keeps flexible blocks ordered and labels them with rough time", () => {
    const blocks = timelineBlocksForDay(presentationFixture(), presentationFixture().days[0]!);
    assert.deepEqual(blocks.map((block) => block.timeLabel), ["09:30", "Around lunch", "Flexible afternoon"]);
    assert.deepEqual(blocks.map((block) => block.place.id), ["temple", "lunch", "craft"]);
  });

  it("marks scheduled, unscheduled, and informational guide cards without candidate wording", () => {
    const scheduled = new Set(["temple"]);
    assert.equal(guideStateForPlace(place("temple"), scheduled), "scheduled");
    assert.equal(guideStateForPlace(place("shop", { category: "shopping" }), scheduled), "unscheduled");
    assert.equal(guideStateForPlace(place("food-theme", { category: "local food theme" }), scheduled), "informational");
    assert.deepEqual(guideCardsForPresentation(presentationFixture()).map((card) => card.state), ["scheduled", "scheduled", "scheduled"]);
  });

  it("filters guide cards by sub-branch and state", () => {
    const cards = guideCardsForPresentation(presentationFixture({
      places: [
        place("temple", { category: "temple", area: "Higashiyama" }),
        place("ramen", { category: "restaurant ramen", area: "Central" }),
        place("product", { category: "local product theme", area: "Central" })
      ],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["temple"], stops: [{ placeId: "temple", order: 1 }] }]
    }));
    assert.deepEqual(filterGuideCards(cards, { type: "dining", state: "unscheduled" }).map((card) => card.place.id), ["ramen"]);
    assert.deepEqual(filterGuideCards(cards, { type: "all", state: "informational" }).map((card) => card.place.id), ["product"]);
  });

  it("builds compact source markers from place evidence", () => {
    const marker = sourceMarkerForPlace(place("sourced", {
      evidenceSources: [{ title: "Official hours", url: "https://example.com", role: "Opening hours", status: "verified", checkedAt: "2026-09-01" }]
    }), []);
    assert.equal(marker?.label, "i");
    assert.match(marker?.summary ?? "", /Source verified/);
    assert.match(marker?.summary ?? "", /Official hours/);
    assert.match(marker?.summary ?? "", /Opening hours/);
  });

  it("lists detail sources without duplicating matching source refs", () => {
    const sources = sourceSummariesForPlace(place("sourced", {
      evidenceSources: [{ title: "Official hours", url: "https://example.com", role: "Opening hours", status: "verified", checkedAt: "2026-09-01" }],
      sourceRefs: ["https://example.com", "https://guide.example"]
    }), [{ title: "Guide article", url: "https://guide.example", authority: "Guide", retrievedAt: "2026-09-02" }]);
    assert.equal(sources.length, 2);
    assert.match(sources[0]?.summary ?? "", /Official hours/);
    assert.equal(sources[1]?.summary, "Guide article · Guide · 2026-09-02");
  });

  it("does not repeat source-attached wording in the sources list", () => {
    const plan = {
      id: "plan-1",
      version: 1,
      title: "Kyoto",
      location: "Kyoto",
      dates: "October 2026",
      status: "draft",
      knownInformation: [],
      assumptions: [],
      nextAction: "Review.",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
      stages: [],
      sources: [{ title: "Official guide", url: "https://example.com", authority: "Official", retrievedAt: "2026-09-01" }],
      createdAt: "2026-09-01T00:00:00.000Z",
      presentation: presentationFixture()
    } satisfies Plan;
    assert.deepEqual(sourceMarkersForPlan(plan).map((source) => source.summary), ["Official guide · Official · 2026-09-01"]);
  });

  it("filters tips to destination-relevant practical cautions", () => {
    const localTip = "Temple etiquette is quiet; check local photo rules before entering, avoid blocking the approach, and step aside before adjusting bags or umbrellas near the gate.";
    const plan = {
      id: "plan-1",
      version: 1,
      title: "Kyoto",
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
      presentation: presentationFixture({ places: [
        place("local", { tip: localTip }),
        place("generic", { tip: "Rest early and enjoy the journey." })
      ] })
    } satisfies Plan;
    const tips = localTipsForPlan(plan);
    assert.equal(tips.length, 1);
    assert.match(tips[0]?.body ?? "", /Temple etiquette/);
    assert.equal(tips[0]?.body, localTip);
  });

  it("groups destination tips by practical theme", () => {
    const groups = groupTipsByTheme([
      { id: "pay", title: "Cash helps", body: "Cash is useful at small local counters.", context: "Kyoto" },
      { id: "rail", title: "Train exits", body: "Train stations use numbered exits.", context: "Kyoto" }
    ]);
    assert.deepEqual(groups.map((group) => group.theme), ["Payment", "Transport"]);
  });

  it("keeps comparison rows factual and includes effort signals", () => {
    const rows = comparisonRowsForPlace(presentationFixture({ places: [
      place("selected", { category: "restaurant", area: "Central" }),
      place("recheck", { category: "restaurant", area: "Central", priority: "recheck" }),
      place("official", { category: "restaurant", area: "North", officialUrl: "https://example.com" })
    ] }), place("selected", { category: "restaurant", area: "Central" }));
    assert.deepEqual(rows.map((row) => row.effort), ["Recheck before use", "Official link saved"]);
    assert.deepEqual(rows.map((row) => row.routeFit), ["Same area", "Same city"]);
  });

  it("does not invent precise times for flexible blocks", () => {
    assert.equal(roughTimeLabel(undefined, undefined, place("market", { category: "shopping market" }), 3), "Flexible afternoon");
    assert.equal(roughTimeLabel(undefined, "dinner", place("meal", { category: "restaurant" }), 2), "Dinner window");
  });

  it("keeps route verification out of itinerary card status", () => {
    const presentation = presentationFixture({
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "temple", destinationPlaceId: "lunch", mode: "walking", verification: "needs_verification", sourceRefs: [] }]
    });
    const block = timelineBlocksForDay(presentation, presentation.days[0]!)[0];
    assert.equal(block?.status, undefined);
    assert.equal(block?.routeAfter?.verification, "needs_verification");
  });

  it("keeps only action-relevant itinerary card status", () => {
    const presentation = presentationFixture({
      places: [place("reserved", { reservation: { requirement: "required", verification: "verified", note: "Timed entry." } })],
      days: [{ ...presentationFixture().days[0]!, placeIds: ["reserved"], stops: [{ placeId: "reserved", order: 1 }] }]
    });
    assert.equal(timelineBlocksForDay(presentation, presentation.days[0]!)[0]?.status, "Reservation required");
  });
});
