import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft } from "@c-assistant/core";
import { checkPlanVenueStatuses, upcomingVenueChecks } from "./plan-venue-monitor.js";

function venuePlan() {
  return createPlanFromDraft({
    title: "Paris",
    location: "Paris",
    dates: "October 2026",
    knownInformation: ["Travel"], assumptions: [], nextAction: "Review", stages: [],
    presentation: {
      kind: "itinerary", summary: "Paris", startDate: "2026-10-06",
      days: [{ id: "day-1", label: "Oct 6", date: "2026-10-06", city: "Paris", placeIds: ["museum", "hotel"] }],
      places: [
        { id: "museum", name: "Example Museum", locationLabel: "Paris", category: "museum", priority: "must", whyWorthIt: "Art", plan: "Visit", detailSections: [], officialUrl: "https://museum.example/", sourceRefs: [] },
        { id: "hotel", name: "Example Hotel", locationLabel: "Paris", category: "accommodation", priority: "booked", whyWorthIt: "Base", plan: "Stay", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: []
    }
  });
}

test("venue monitoring includes only important non-accommodation places in the next fourteen days", () => {
  const checks = upcomingVenueChecks(venuePlan(), new Date("2026-10-01T08:00:00Z"));
  assert.deepEqual(checks.map(({ place }) => place.id), ["museum"]);
  assert.equal(upcomingVenueChecks(venuePlan(), new Date("2026-09-01T08:00:00Z")).length, 0);
});

test("venue monitoring emits attention only for a matched closure status", async () => {
  const result = await checkPlanVenueStatuses({
    plan: venuePlan(),
    now: new Date("2026-10-01T08:00:00Z"),
    dependencies: { searchPlaces: async () => ({ status: "available", provider: "google_maps", observedAt: "2026-10-01T08:00:00Z", data: [{ provider: "google_maps", id: "g-1", name: "Example Museum", address: "Paris", location: "2.3,48.8", type: "museum", city: "Paris", district: "", businessStatus: "temporarily_closed" }] }) }
  });
  assert.equal(result.checked, 1);
  assert.equal(result.attentions[0]?.status, "temporarily_closed");
  assert.equal(result.attentions[0]?.officialUrl, "https://museum.example/");
});
