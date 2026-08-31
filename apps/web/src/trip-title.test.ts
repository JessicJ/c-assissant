import assert from "node:assert/strict";
import test from "node:test";
import type { PlanPresentation } from "@c-assistant/core";
import { displayTripTitle } from "./trip-title.js";

test("Web summarizes itinerary titles from duration, destinations, and trip themes", () => {
  const presentation: PlanPresentation = {
    kind: "itinerary",
    summary: "Neighborhoods, culture, cafes, and bathing.",
    startDate: "2026-10-03",
    endDate: "2026-10-10",
    cities: ["Tokyo, Kyoto", "Kyoto / Tokyo"],
    days: [
      { id: "d1", label: "Day 1", date: "2026-10-03", city: "Tokyo", title: "Arrival", placeIds: [] },
      { id: "d2", label: "Day 2", date: "2026-10-04", city: "Tokyo", title: "Museum and cafes", placeIds: ["museum", "cafe"] },
      { id: "d3", label: "Day 3", date: "2026-10-05", city: "Kyoto", title: "Temple morning", placeIds: ["temple", "bath"] }
    ],
    places: [
      { id: "museum", name: "Museum of Contemporary Art Tokyo", locationLabel: "Tokyo", city: "Tokyo", category: "art", priority: "must", whyWorthIt: "Culture", plan: "Visit galleries.", detailSections: [], sourceRefs: [] },
      { id: "cafe", name: "Classic cafe", locationLabel: "Tokyo", city: "Tokyo", category: "coffee", priority: "preferred", whyWorthIt: "Cafe break", plan: "Pause for coffee.", detailSections: [], sourceRefs: [] },
      { id: "bath", name: "Spa LaQua", locationLabel: "Tokyo", city: "Tokyo", category: "spa", priority: "preferred", whyWorthIt: "Bathing", plan: "Evening bath.", detailSections: [], sourceRefs: [] }
    ],
    routeSegments: []
  };

  assert.equal(displayTripTitle(presentation, "Landi Plan: Tokyo and Kyoto Neighborhoods, Culture, Cafes, and Bathing"), "8-Day Tokyo-Kyoto Culture, Cafes, and Bathing");
});
