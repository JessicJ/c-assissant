import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft } from "@c-assistant/core";
import { dueItineraryDepartureReminders, formatItineraryDepartureReminder, itineraryReminderCandidateCities } from "./itinerary-departure-reminder.js";

function plan() {
  const result = createPlanFromDraft({
    title: "Paris and London",
    location: "Europe",
    dates: "August 18-19, 2026",
    knownInformation: [], assumptions: [], nextAction: "Review",
    presentation: {
      kind: "itinerary", summary: "Two-city trip", startDate: "2026-08-18", endDate: "2026-08-19",
      days: [{
        id: "paris", label: "Aug 18", date: "2026-08-18", city: "Paris", title: "Paris", summary: "Timed museum visit",
        placeIds: ["cafe", "louvre"], stops: [{ placeId: "cafe", order: 1, time: "08:30" }, { placeId: "louvre", order: 2, time: "10:00", role: "fixed anchor" }],
        routeReview: { sequenceRationale: "A short transfer to the booked museum slot." }
      }, {
        id: "london", label: "Aug 19", date: "2026-08-19", city: "London", title: "London", summary: "Flexible day",
        placeIds: ["park"], stops: [{ placeId: "park", order: 1, time: "10:00" }]
      }],
      places: [
        { id: "cafe", name: "Cafe", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.34], category: "food", priority: "preferred", whyWorthIt: "Breakfast", plan: "Eat", detailSections: [], sourceRefs: [] },
        { id: "louvre", name: "Louvre Museum", locationLabel: "Paris", city: "Paris", coordinates: [48.8606, 2.3376], category: "museum", priority: "booked", whyWorthIt: "Art", plan: "Visit", detailSections: [], sourceRefs: [] },
        { id: "park", name: "Park", locationLabel: "London", city: "London", coordinates: [51.5, -0.1], category: "park", priority: "preferred", whyWorthIt: "Walk", plan: "Visit", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [{ id: "to-louvre", dayId: "paris", originPlaceId: "cafe", destinationPlaceId: "louvre", mode: "walking", durationMinutes: 20, verification: "verified", label: "Walk · 20 min", detail: "Verified route", sourceRefs: [] }]
    },
    stages: []
  });
  result.status = "active";
  return result;
}

test("only a key stop becomes due and uses its destination city timezone", () => {
  const due = dueItineraryDepartureReminders(plan(), new Map([["paris", "Europe/Paris"], ["london", "Europe/London"]]), new Date("2026-08-18T07:35:00.000Z"));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.place.id, "louvre");
  assert.equal(due[0]?.leaveAt.toISOString(), "2026-08-18T07:30:00.000Z");
  assert.match(formatItineraryDepartureReminder(plan(), due[0]!), /Leave by 09:30/);
  assert.match(formatItineraryDepartureReminder(plan(), due[0]!), /No booking, ride, payment/);
});

test("ordinary itinerary stops do not create notification noise", () => {
  const due = dueItineraryDepartureReminders(plan(), new Map([["london", "Europe/London"]]), new Date("2026-08-19T08:30:00.000Z"));
  assert.deepEqual(due, []);
});

test("narrative visit roles do not turn ordinary sightseeing into fixed-stop reminders", () => {
  const ordinary = plan();
  ordinary.presentation!.places.find((place) => place.id === "park")!.visitRole = "arrival-day architectural introduction";
  ordinary.presentation!.days[1]!.accommodationDeparture = {
    accommodationName: "Test hotel",
    accommodationAddress: "London",
    destinationPlaceId: "park",
    mode: "walking",
    durationMinutes: 20,
    verification: "verified"
  };
  const due = dueItineraryDepartureReminders(ordinary, new Map([["london", "Europe/London"]]), new Date("2026-08-19T08:30:00.000Z"));
  assert.deepEqual(due, []);
});

test("unverified route duration never becomes a precise departure reminder", () => {
  const unverified = plan();
  unverified.presentation!.routeSegments[0]!.verification = "needs_verification";
  const due = dueItineraryDepartureReminders(unverified, new Map([["paris", "Europe/Paris"]]), new Date("2026-08-18T07:35:00.000Z"));
  assert.deepEqual(due, []);
});

test("timezone lookup is restricted to itinerary cities near the current UTC date", () => {
  assert.deepEqual(itineraryReminderCandidateCities(plan(), new Date("2026-08-18T12:00:00.000Z")), ["Paris", "London"]);
});
