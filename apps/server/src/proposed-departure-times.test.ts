import assert from "node:assert/strict";
import test from "node:test";
import type { PlanningSession, TripBlueprint } from "@c-assistant/core";
import { materializeProposedHotelDepartures, missingProposedHotelDepartureDates } from "./proposed-departure-times.js";

const session = { facts: [{ key: "departure", value: "Depart Osaka Kansai at 17:30 on 2026-11-16", confirmed: true }] } as PlanningSession;
const blueprint = { endDate: "2026-11-16", days: [
  { id: "rail", date: "2026-11-08", blocks: [
    { id: "rail-hotel", kind: "lodging", order: 1, placeId: "tokyo-hotel" },
    { id: "rail-transfer", kind: "transfer", order: 2, title: "Tokyo to Kanazawa by rail" },
    { id: "rail-night", kind: "lodging", order: 3, placeId: "kanazawa-hotel" }
  ] },
  { id: "market", date: "2026-11-15", blocks: [
    { id: "market-hotel", kind: "lodging", order: 1, placeId: "kyoto-hotel" },
    { id: "market-transfer", kind: "transfer", order: 2, title: "Kyoto to market" },
    { id: "market-stop", kind: "stop", order: 3, placeId: "market", startTime: "11:00" }
  ] },
  { id: "flight", date: "2026-11-16", blocks: [
    { id: "flight-hotel", kind: "lodging", order: 1, placeId: "airport-hotel" },
    { id: "flight-transfer", kind: "transfer", order: 2, title: "Walk to terminal", endTime: "17:30" },
    { id: "airport", kind: "stop", order: 3, placeId: "kix" }
  ] }
] } as unknown as TripBlueprint;

test("hotel-origin days receive proposed departures without inventing a train or airport arrival time", () => {
  assert.deepEqual(missingProposedHotelDepartureDates(blueprint), ["2026-11-08", "2026-11-15", "2026-11-16"]);
  const timed = materializeProposedHotelDepartures(blueprint, session);
  assert.deepEqual(timed.days.map((day) => day.blocks![1]!.startTime), ["09:00", "10:15", "13:30"]);
  assert.deepEqual(missingProposedHotelDepartureDates(timed), []);
  assert.equal(timed.days[2]!.blocks![2]!.startTime, undefined);
  assert.match(timed.days[0]!.blocks![1]!.summary ?? "", /Proposed departure/);
  assert.equal(blueprint.days[0]!.blocks![1]!.startTime, undefined);
  assert.deepEqual(materializeProposedHotelDepartures(timed, session), timed);
});

test("an untimed morning excursion prevents a later lunch from pushing the hotel departure to 11:45", () => {
  const b = structuredClone(blueprint);
  b.days = [{ ...b.days[0]!, blocks: [
    { ...b.days[0]!.blocks![0]! },
    { ...b.days[0]!.blocks![1]!, title: "Hotel to cave operator boarding point" },
    { id: "cave", kind: "stop", order: 3, placeId: "cave", durationMinutes: 150, evidence: [] },
    { id: "lunch", kind: "meal", order: 4, startTime: "12:30", endTime: "13:30", evidence: [] }
  ] }];
  const next = materializeProposedHotelDepartures(b, session);
  assert.equal(next.days[0]!.blocks![1]!.startTime, "09:00");
  assert.equal(next.days[0]!.blocks![2]!.startTime, undefined);
  assert.equal(next.days[0]!.blocks![3]!.startTime, "12:30");
});

test("proposed rail departure respects preceding checkout and meal, repairs old defaults and preserves supplied times", () => {
  const b = structuredClone(blueprint);
  b.days = [{ ...b.days[0]!, blocks: [
    { ...b.days[0]!.blocks![0]!, endTime: "11:00" },
    { id: "lunch", kind: "meal", order: 2, durationMinutes: 60, evidence: [] },
    { ...b.days[0]!.blocks![1]!, order: 3 },
    { ...b.days[0]!.blocks![2]!, order: 4 }
  ] }];
  const next = materializeProposedHotelDepartures(b, session);
  assert.equal(next.days[0]!.blocks![2]!.startTime, "12:00");
  const old = structuredClone(next);
  old.days[0]!.blocks![2]!.startTime = "09:00";
  old.days[0]!.blocks![2]!.summary = "Proposed departure from the overnight base at 09:00; confirm the actual service and route before travel.";
  assert.equal(materializeProposedHotelDepartures(old, session).days[0]!.blocks![2]!.startTime, "12:00");
  old.days[0]!.blocks![2]!.summary = "Traveler-confirmed departure at 09:00.";
  assert.equal(materializeProposedHotelDepartures(old, session).days[0]!.blocks![2]!.startTime, "09:00");
  assert.deepEqual(materializeProposedHotelDepartures(next, session), next);
});


test("unknown travel to another hotel cannot use a local 45-minute estimate; known route legs are counted once", () => {
  const b = structuredClone(blueprint);
  b.days = [{ ...b.days[0]!, blocks: [
    { ...b.days[0]!.blocks![0]! }, { ...b.days[0]!.blocks![1]! },
    { ...b.days[0]!.blocks![2]! },
    { id: "walk", kind: "transfer", order: 4, evidence: [] },
    { id: "gion", kind: "stop", order: 5, placeId: "gion", startTime: "16:00", evidence: [] }
  ] }];
  const provisional = materializeProposedHotelDepartures(b, session);
  assert.equal(provisional.days[0]!.blocks![1]!.startTime, "09:00");
  provisional.days[0]!.blocks![1]!.startTime = "15:15";
  provisional.days[0]!.blocks![1]!.summary = "Proposed departure from the overnight base at 15:15; confirm the actual service and route before travel.";
  assert.equal(materializeProposedHotelDepartures(provisional, session).days[0]!.blocks![1]!.startTime, "09:00");
  b.movements = [
    { id: "rail", dayId: "rail", originPlaceId: "tokyo-hotel", destinationPlaceId: "kanazawa-hotel", mode: "rail", status: "recheck", durationMinutes: 180, evidence: [] },
    { id: "walk", dayId: "rail", originPlaceId: "kanazawa-hotel", destinationPlaceId: "gion", mode: "walking", status: "recheck", durationMinutes: 30, evidence: [] }
  ];
  b.days[0]!.blocks![1]!.durationMinutes = 180;
  b.days[0]!.blocks![3]!.durationMinutes = 30;
  assert.equal(materializeProposedHotelDepartures(b, session).days[0]!.blocks![1]!.startTime, "12:30");
  b.days[0]!.blocks![2]!.durationMinutes = 30;
  assert.equal(materializeProposedHotelDepartures(b, session).days[0]!.blocks![1]!.startTime, "12:00");
  b.days[0]!.blocks![1]!.startTime = "15:00";
  assert.equal(materializeProposedHotelDepartures(b, session).days[0]!.blocks![1]!.startTime, "15:00", "Supplied times stay subject to review rather than silent replacement.");
});


test("airport defaults allow four hours or longer known ground travel and do not clamp early flights to 06:00", () => {
  const b = structuredClone(blueprint);
  b.days = [b.days[2]!];
  b.days[0]!.blocks![1]!.durationMinutes = 150;
  assert.equal(materializeProposedHotelDepartures(b, session).days[0]!.blocks![1]!.startTime, "12:00");
  delete b.days[0]!.blocks![1]!.durationMinutes;
  const early = { facts: [{ key: "departure", value: "2026-11-16 flight at 07:00", confirmed: true }] } as PlanningSession;
  assert.equal(materializeProposedHotelDepartures(b, early).days[0]!.blocks![1]!.startTime, "03:00");
});

test("airport budget includes later ground legs and a luggage stop without double-counting route estimates", () => {
  const b = structuredClone(blueprint);
  b.days = [{ ...b.days[2]!, blocks: [
    { id: "base", kind: "lodging", order: 1, placeId: "airport-hotel", evidence: [] },
    { id: "first-leg", kind: "transfer", order: 2, durationMinutes: 30, evidence: [] },
    { id: "bags", kind: "lodging", order: 3, placeId: "bag-store", durationMinutes: 30, evidence: [] },
    { id: "airport-leg", kind: "transfer", order: 4, durationMinutes: 150, evidence: [] },
    { id: "airport", kind: "stop", order: 5, placeId: "kix", evidence: [] }
  ] }];
  b.movements = [
    { id: "to-bags", dayId: "flight", originPlaceId: "airport-hotel", destinationPlaceId: "bag-store", mode: "transit", status: "recheck", durationMinutes: 30, evidence: [] },
    { id: "to-airport", dayId: "flight", originPlaceId: "bag-store", destinationPlaceId: "kix", mode: "transit", status: "recheck", durationMinutes: 150, evidence: [] }
  ];
  assert.equal(materializeProposedHotelDepartures(b, session).days[0]!.blocks![1]!.startTime, "11:00");
});
