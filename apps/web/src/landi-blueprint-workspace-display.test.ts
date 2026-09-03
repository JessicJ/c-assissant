import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plan, PlanPlace, PlanPresentation } from "@c-assistant/core";
import { guideCardsForPresentation, guideStateForPlace, guideTypeForPlace, localTipsForPlan, roughTimeLabel, sourceMarkerForPlace, sourceMarkersForPlan, timelineBlocksForDay } from "./landi-blueprint-workspace-display.js";

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

  it("builds compact source markers from place evidence", () => {
    const marker = sourceMarkerForPlace(place("sourced", {
      evidenceSources: [{ title: "Official hours", url: "https://example.com", role: "Opening hours", status: "verified", checkedAt: "2026-09-01" }]
    }), []);
    assert.equal(marker?.label, "i");
    assert.match(marker?.summary ?? "", /Source verified/);
    assert.match(marker?.summary ?? "", /Official hours/);
    assert.match(marker?.summary ?? "", /Opening hours/);
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
        place("local", { tip: "Temple etiquette is quiet; check local photo rules before entering." }),
        place("generic", { tip: "Rest early and enjoy the journey." })
      ] })
    } satisfies Plan;
    const tips = localTipsForPlan(plan);
    assert.equal(tips.length, 1);
    assert.match(tips[0]?.body ?? "", /Temple etiquette/);
  });

  it("does not invent precise times for flexible blocks", () => {
    assert.equal(roughTimeLabel(undefined, undefined, place("market", { category: "shopping market" }), 3), "Flexible afternoon");
    assert.equal(roughTimeLabel(undefined, "dinner", place("meal", { category: "restaurant" }), 2), "Dinner window");
  });
});
