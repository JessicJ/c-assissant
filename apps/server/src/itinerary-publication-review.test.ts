import assert from "node:assert/strict";
import test from "node:test";
import type { BlueprintItineraryBlock, BlueprintItineraryDay, BlueprintPlace, PlanningSession, TripBlueprint } from "@c-assistant/core";
import { reviewItineraryForPublication } from "./itinerary-publication-review.js";
import { materializeProposedHotelDepartures } from "./proposed-departure-times.js";

const dates = Array.from({ length: 16 }, (_, index) => `2026-11-${String(index + 2).padStart(2, "0")}`);
const hotel = (id: string, city: string): BlueprintPlace => ({ id, name: `${city} Hotel`, city, category: "hotel", accommodation: { state: "recommended" } }) as BlueprintPlace;
const places: BlueprintPlace[] = [
  hotel("hotel-akl", "Auckland"), hotel("hotel-rot", "Rotorua"), hotel("hotel-que", "Queenstown"),
  { id: "airport", name: "Auckland Airport", city: "Auckland", category: "airport" },
  { id: "museum", name: "Auckland Museum", city: "Auckland", category: "museum", durationMinutes: 240 },
  { id: "geothermal", name: "Rotorua Geothermal Valley", city: "Rotorua", category: "geothermal", durationMinutes: 240 },
  { id: "lake", name: "Queenstown Lake Walk", city: "Queenstown", category: "walk", durationMinutes: 240 },
  { id: "milford", name: "Milford Coach and Cruise", city: "Queenstown", category: "full-day excursion", durationMinutes: 780 },
  { id: "ferry", name: "Waiheke Island Ferry", city: "Auckland", category: "ferry day trip", durationMinutes: 480 }
] as BlueprintPlace[];

function block(id: string, kind: BlueprintItineraryBlock["kind"], order: number, placeId?: string, durationMinutes?: number): BlueprintItineraryBlock {
  return { id, kind, order, ...(placeId ? { placeId } : {}), ...(durationMinutes ? { durationMinutes } : {}), evidence: [] } as BlueprintItineraryBlock;
}

function sightseeing(index: number, city: string, hotelId: string, placeId: string): BlueprintItineraryDay {
  return { id: `day-${dates[index]}`, date: dates[index]!, kind: "scheduled", city, title: `${city} day`, summary: `Visit ${city}`, stops: [{ placeId, order: 1, time: "09:00" }], candidatePlaceIds: [], blocks: [
    block(`start-${index}`, "lodging", 1, hotelId),
    { ...block(`visit-${index}`, "stop", 2, placeId, 240), startTime: "09:00" },
    block(`end-${index}`, "lodging", 3, hotelId)
  ] };
}

function transfer(index: number, from: string, to: string, city: string): BlueprintItineraryDay {
  return { id: `day-${dates[index]}`, date: dates[index]!, kind: "transit", city, title: "Change base", summary: "Travel between bases", stops: [], candidatePlaceIds: [], blocks: [
    block(`start-${index}`, "lodging", 1, from), block(`move-${index}`, "transfer", 2), block(`end-${index}`, "lodging", 3, to)
  ] };
}

function sixteenDayBlueprint(): TripBlueprint {
  const days: BlueprintItineraryDay[] = dates.map((date, index) => {
    if (index < 2) return { id: `day-${date}`, date, kind: "transit", city: "International transit", title: "In transit", summary: "Overnight international flight", stops: [], candidatePlaceIds: [], blocks: [] };
    if (index === 2) return { id: `day-${date}`, date, kind: "transit", city: "Auckland", title: "Arrive", summary: "Arrival and check-in", stops: [{ placeId: "airport", order: 1 }], candidatePlaceIds: [], blocks: [block("arrival-airport", "stop", 1, "airport"), block("arrival-hotel", "lodging", 2, "hotel-akl")] };
    if (index === 5) return transfer(index, "hotel-akl", "hotel-rot", "Auckland to Rotorua");
    if (index === 8) return transfer(index, "hotel-rot", "hotel-que", "Rotorua to Queenstown");
    if (index === 12) return transfer(index, "hotel-que", "hotel-akl", "Queenstown to Auckland");
    if (index === 15) return { id: `day-${date}`, date, kind: "transit", city: "Auckland", title: "Depart", summary: "Airport departure", stops: [{ placeId: "airport", order: 1 }], candidatePlaceIds: [], blocks: [block("depart-hotel", "lodging", 1, "hotel-akl"), block("depart-airport", "stop", 2, "airport")] };
    if (index === 9) return { id: `day-${date}`, date, kind: "scheduled", city: "Queenstown", title: "Milford full-day excursion", summary: "Coach and cruise from Queenstown", stops: [{ placeId: "milford", order: 1 }], candidatePlaceIds: [], blocks: [
      block("milford-start", "lodging", 1, "hotel-que"), block("milford-out", "transfer", 2, undefined, 300),
      block("milford-cruise", "stop", 3, "milford", 120), block("milford-back", "transfer", 4, undefined, 300),
      block("milford-hotel", "lodging", 5, "hotel-que")
    ] };
    if (index === 6 || index === 7) return sightseeing(index, "Rotorua", "hotel-rot", "geothermal");
    if (index === 10 || index === 11) return sightseeing(index, "Queenstown", "hotel-que", "lake");
    return sightseeing(index, "Auckland", "hotel-akl", "museum");
  });
  return materializeProposedHotelDepartures({ title: "New Zealand", summary: "A multi-region journey", language: "en", destinations: ["New Zealand"], startDate: dates[0]!, endDate: dates.at(-1)!, places, days, movements: [], bookingConstraints: [] } as unknown as TripBlueprint, session);
}

const session = { facts: [
  { key: "destination", value: "New Zealand", confirmed: true },
  { key: "arrival", value: "Auckland Airport", confirmed: true },
  { key: "departure", value: "Auckland Airport", confirmed: true }
] } as PlanningSession;

test("16-day multi-region itinerary passes whole-trip publication review with a long Milford excursion", () => {
  const blueprint = sixteenDayBlueprint();
  assert.equal(blueprint.days.length, 16);
  assert.deepEqual(reviewItineraryForPublication(blueprint, session), []);
});

test("whole-trip review catches an overloaded ferry day and accepts the feasible replacement", () => {
  const blueprint = sixteenDayBlueprint();
  const day = blueprint.days[14]!;
  day.stops.push({ placeId: "ferry", order: 2 });
  day.blocks!.splice(2, 0, block("ferry", "stop", 3, "ferry", 480));
  day.blocks![3]!.order = 4;
  assert.ok(reviewItineraryForPublication(blueprint, session).some((finding) => finding.code === "overplanned_day" && finding.date === day.date));
  day.stops.pop();
  day.blocks!.splice(2, 1);
  assert.deepEqual(reviewItineraryForPublication(blueprint, session), []);
});

test("whole-trip review catches empty days and overnight hotel discontinuity", () => {
  const blueprint = sixteenDayBlueprint();
  blueprint.days[13]!.stops = [];
  blueprint.days[13]!.blocks = [block("only-start", "lodging", 1, "hotel-akl"), block("only-end", "lodging", 2, "hotel-akl")];
  blueprint.days[14]!.blocks![0]!.placeId = "hotel-que";
  const findings = reviewItineraryForPublication(blueprint, session);
  assert.ok(findings.some((finding) => finding.code === "empty_destination_day" && finding.date === dates[13]));
  assert.ok(findings.some((finding) => finding.code === "overnight_anchor_mismatch" && finding.date === dates[14]));
});

test("whole-trip review does not publish a normal sightseeing day still flagged as under-planned", () => {
  const blueprint = sixteenDayBlueprint();
  const day = blueprint.days[4]!;
  day.blocks!.find((block) => block.kind === "stop")!.durationMinutes = 90;
  assert.ok(reviewItineraryForPublication(blueprint, session).some((finding) => finding.code === "underplanned_sightseeing_day" && finding.date === day.date));
});

test("whole-trip review rejects a hotel departure that is too late for an international flight", () => {
  const blueprint = sixteenDayBlueprint();
  const finalDay = blueprint.days.at(-1)!;
  finalDay.summary = "International departure to Los Angeles";
  finalDay.blocks!.splice(1, 0, { ...block("airport-transfer", "transfer", 2, "airport"), startTime: "14:15" });
  finalDay.blocks![2]!.order = 3;
  finalDay.blocks![2]!.endTime = "15:00";
  const findings = reviewItineraryForPublication(blueprint, session);
  assert.ok(findings.some((finding) => finding.code === "insufficient_international_airport_buffer" && finding.date === "2026-11-17"));
  finalDay.blocks![1]!.startTime = "10:30";
  assert.ok(!reviewItineraryForPublication(blueprint, session).some((finding) => finding.code === "insufficient_international_airport_buffer"));
});


test("same-day no-lodging trip is not forced to select a researched hotel at publication", () => {
  const facts = [
    { key: 'travel_dates', value: '2026-12-12 to 2026-12-12', source: 'user', confirmed: true },
    { key: 'accommodation', value: '当天不需要住宿', source: 'user', confirmed: true }
  ] as PlanningSession['facts'];
  const blueprint = { title: 'Kyoto day trip', summary: 'Temples and tea', language: 'en', destinations: ['Kyoto'],
    startDate: '2026-12-12', endDate: '2026-12-12', places: [hotel('kyoto-hotel', 'Kyoto')], movements: [], bookingConstraints: [],
    days: [{ id: 'kyoto', date: '2026-12-12', city: 'Kyoto', kind: 'rest', title: 'Day trip', summary: 'Day trip', stops: [], candidatePlaceIds: [],
      blocks: [{ id: 'unrequested-stay', kind: 'lodging', order: 1, title: 'Hotel not selected', evidence: [] }] }]
  } as unknown as TripBlueprint;
  assert.equal(reviewItineraryForPublication(blueprint, { facts }).some(finding => finding.code === 'unselected_accommodation'), false);
  const requestedStay = { facts: facts.map(fact => fact.key === 'accommodation' ? { ...fact, value: 'A day-use room is requested' } : fact) };
  assert.equal(reviewItineraryForPublication(blueprint, requestedStay).some(finding => finding.code === 'unselected_accommodation'), true);
  const overnight = { facts: facts.map(fact => fact.key === 'travel_dates' ? { ...fact, value: '2026-12-12 to 2026-12-13' } : fact) };
  assert.equal(reviewItineraryForPublication(blueprint, overnight).some(finding => finding.code === 'unselected_accommodation'), true);
});
