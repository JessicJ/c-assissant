import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromDraft, type Plan } from "@c-assistant/core";
import { selectNextPlannedStop } from "./next-planned-stop.js";

function plan(): Plan {
  const draft = createPlanFromDraft({
    title: "Bali movement",
    location: "Bali, Indonesia",
    dates: "2026-09-10",
    knownInformation: [],
    assumptions: [],
    nextAction: "Go",
    presentation: {
      kind: "itinerary",
      summary: "One Bali route.",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      days: [{ id: "bali-day", label: "Sep 10", date: "2026-09-10", city: "Bali", placeIds: ["ubud-palace"], stops: [{ placeId: "ubud-palace", order: 1, time: "10:30" }] }],
      places: [
        { id: "lodging", name: "Ubud stay", locationLabel: "Ubud, Bali", coordinates: [-8.514, 115.262], city: "Bali", area: "Ubud", category: "lodging", priority: "booked", whyWorthIt: "Stay", plan: "Sleep", detailSections: [], sourceRefs: [] },
        { id: "ubud-palace", name: "Ubud Palace", locationLabel: "Jl. Raya Ubud, Bali", coordinates: [-8.5069, 115.2625], city: "Bali", area: "Ubud", category: "sight", priority: "must", whyWorthIt: "Visit", plan: "Visit", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: []
    },
    stages: [{ title: "Itinerary", description: "Move", tasks: [{ title: "Visit Ubud Palace", owner: "user", dueLabel: "During trip" }] }]
  });
  return { ...draft, status: "active" };
}

test("selects the next timed stop deterministically", () => {
  const result = selectNextPlannedStop(plan(), { localDate: "2026-09-10", localTime: "10:00" });
  assert.equal(result.status, "selected");
  if (result.status === "selected") assert.equal(result.place.id, "ubud-palace");
});

test("keeps a stop within the past 60 minutes actionable but degraded", () => {
  const result = selectNextPlannedStop(plan(), { localDate: "2026-09-10", localTime: "10:55" });
  assert.equal(result.status, "selected");
  if (result.status === "selected") assert.deepEqual(result.degradedReasons, ["planned_time_within_past_60_minutes"]);
});

test("requires confirmation instead of skipping a stale stop", () => {
  const result = selectNextPlannedStop(plan(), { localDate: "2026-09-10", localTime: "12:00" });
  assert.equal(result.status, "stale_confirmation_required");
  if (result.status === "stale_confirmation_required") assert.equal(result.place.id, "ubud-palace");
});

test("blocks ambiguous untimed stops", () => {
  const current = plan();
  delete current.presentation!.days[0]!.stops;
  current.presentation!.days[0]!.placeIds = ["ubud-palace", "ubud-market"];
  current.presentation!.places.push({ id: "ubud-market", name: "Ubud Market", locationLabel: "Ubud, Bali", coordinates: [-8.506, 115.263], city: "Bali", area: "Ubud", category: "market", priority: "preferred", whyWorthIt: "Browse", plan: "Browse", detailSections: [], sourceRefs: [] });
  const result = selectNextPlannedStop(current, { localDate: "2026-09-10", localTime: "10:00" });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.deepEqual(result.blockingReasons, ["ambiguous_untimed_stops"]);
});
