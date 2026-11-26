import assert from "node:assert/strict";
import test from "node:test";
import type { PlanningSession, TripBlueprint } from "@c-assistant/core";
import { normalizeUnverifiedBookedTimes, reviewItineraryQuality } from "./itinerary-quality-review.js";

const hotel = { id: "hotel", name: "Hotel", city: "Christchurch", category: "hotel" };
const tour = { id: "tour", name: "Whale boat tour", city: "Kaikōura", category: "whale-watching boat tour", operationalFacts: { entry: { booking: { requirement: "required" } } } };

function blueprint(overrides: Partial<TripBlueprint> = {}): TripBlueprint {
  return {
    summary: "A coast trip.",
    places: [hotel, tour], movements: [],
    days: [{ id: "day", date: "2026-12-19", kind: "scheduled", city: "Kaikōura", title: "Whales", summary: "A boat trip", stops: [{ placeId: "tour", order: 1, time: "09:00" }], candidatePlaceIds: [], blocks: [{ id: "tour-block", kind: "stop", order: 1, placeId: "tour", startTime: "09:00", durationMinutes: 180, evidence: [] }] }],
    ...overrides
  } as unknown as TripBlueprint;
}

const session = { facts: [] } as unknown as PlanningSession;

test("unbooked tour time becomes provisional when no dated session verifies it", () => {
  const original = blueprint();
  const normalized = normalizeUnverifiedBookedTimes(original);
  assert.equal(normalized.days[0]!.blocks![0]!.startTime, undefined);
  assert.equal(normalized.days[0]!.stops[0]!.time, undefined);
  assert.equal(normalized.days[0]!.blocks![0]!.display?.timingStatus, "recheck");
  assert.equal(original.days[0]!.blocks![0]!.startTime, "09:00");
  assert.equal(reviewItineraryQuality(normalized, session).some((finding) => finding.code === "unverified_booked_time"), false);
});

test("final review rejects an exact booked tour time without a verified applicable session", () => {
  const findings = reviewItineraryQuality(blueprint(), session);
  assert.deepEqual(findings.map((finding) => finding.code), ["unverified_booked_time"]);
  const withSession = blueprint({ places: [hotel, { ...tour, operationalFacts: { ...tour.operationalFacts, sessions: [{ startsAt: "09:00", status: "verified", evidence: [{ sourceId: "official", status: "verified" }] }] } }] as TripBlueprint["places"] });
  assert.equal(reviewItineraryQuality(withSession, session).length, 0);
});

test("final review catches an overloaded regional day and an unsupported budget assumption", () => {
  const overloaded = blueprint({ summary: "The RMB 10,000 budget is assumed to exclude international flights.", days: [{ ...blueprint().days[0]!, blocks: [{ id: "tour-block", kind: "stop", order: 1, placeId: "tour", durationMinutes: 540, evidence: [] }], stops: [{ placeId: "tour", order: 1 }] }] });
  assert.deepEqual(reviewItineraryQuality(overloaded, session).map((finding) => finding.code), ["unsupported_budget_scope", "overplanned_day"]);
  const instruction = reviewItineraryQuality(overloaded, session).find((finding) => finding.code === "overplanned_day")?.repairInstruction;
  assert.match(instruction ?? "", /unbooked optional ferry, excursion, or other flexible stop may move/);
  assert.match(instruction ?? "", /do not shorten an operator's actual package duration/i);
});

test("final review identifies a flight whose origin airport is absent from the route", () => {
  const plan = blueprint({
    places: [hotel, { id: "wlg", name: "Wellington Airport", city: "Wellington", category: "airport" }] as TripBlueprint["places"],
    days: [{ id: "flight-day", date: "2026-12-23", kind: "transit", city: "Christchurch and Wellington", title: "Fly to Wellington", summary: "Return", stops: [{ placeId: "wlg", order: 1 }], candidatePlaceIds: [], blocks: [
      { id: "hotel-block", kind: "lodging", order: 1, placeId: "hotel", evidence: [] },
      { id: "flight", kind: "transfer", order: 2, title: "Christchurch–Wellington flight", evidence: [] },
      { id: "arrival", kind: "stop", order: 3, placeId: "wlg", evidence: [] }
    ] }]
  });
  assert.equal(reviewItineraryQuality(plan, session).find((finding) => finding.code === "missing_flight_origin")?.date, "2026-12-23");
});

test("final review catches a visit that has not ended before the next timed block", () => {
  const plan = blueprint({ places: [hotel, { ...tour, durationMinutes: 180 }] as TripBlueprint["places"], days: [{ ...blueprint().days[0]!, blocks: [
    { id: "visit", kind: "stop", order: 1, placeId: "tour", startTime: "09:00", evidence: [] },
    { id: "next", kind: "lodging", order: 2, placeId: "hotel", startTime: "10:00", evidence: [] }
  ] }] });
  assert.equal(reviewItineraryQuality(plan, session).find((finding) => finding.code === "time_sequence_conflict")?.blocking, true);
});

test("final review blocks an ignored researched hotel and reports an unavailable recommendation", () => {
  const plan = blueprint({ endDate: "2026-12-20", days: [{ ...blueprint().days[0]!, blocks: [
    { id: "visit", kind: "stop", order: 1, placeId: "tour", evidence: [] },
    { id: "stay", kind: "lodging", order: 2, title: "Overnight accommodation to select", evidence: [] }
  ] }] });
  assert.equal(reviewItineraryQuality(plan, session).find((finding) => finding.code === "missing_overnight_base")?.blocking, false);
  const withHotel = blueprint({ ...plan, places: [...plan.places, { id: "recommended-hotel", name: "Lodge", city: "Kaikōura", category: "hotel", accommodation: { state: "recommended" } }] as TripBlueprint["places"] });
  assert.equal(reviewItineraryQuality(withHotel, session).find((finding) => finding.code === "missing_overnight_base")?.blocking, true);
});

test("a country trip cannot silently collapse to its entry and exit city", () => {
  const gatewaySession = { facts: [{ key: "destination", value: "New Zealand, with Wellington as the entry and exit city", confirmed: true }] } as PlanningSession;
  const wellington = { id: "waterfront", name: "Wellington Waterfront", city: "Wellington", category: "attraction" };
  const days = Array.from({ length: 8 }, (_, index) => ({ id: `day-${index}`, date: `2026-12-${String(index + 14).padStart(2, "0")}`, kind: "scheduled" as const, city: "Wellington", title: "City day", summary: "Waterfront", stops: [{ placeId: "waterfront", order: 1 }], candidatePlaceIds: [], blocks: [{ id: `block-${index}`, kind: "stop" as const, order: 1, placeId: "waterfront", durationMinutes: 180, evidence: [] }] }));
  const collapsed = blueprint({ places: [wellington] as TripBlueprint["places"], days });
  assert.equal(reviewItineraryQuality(collapsed, gatewaySession).find((finding) => finding.code === "destination_scope_collapse")?.blocking, true);
  const cityOnly = { facts: [...gatewaySession.facts, { key: "constraints", value: "Only Wellington", confirmed: true }] } as PlanningSession;
  assert.equal(reviewItineraryQuality(collapsed, cityOnly).some((finding) => finding.code === "destination_scope_collapse"), false);
  const regionalPlace = { id: "garden", name: "Christchurch Botanic Gardens", city: "Christchurch", category: "garden" };
  const regional = blueprint({ ...collapsed, places: [wellington, regionalPlace] as TripBlueprint["places"], days: days.map((day, index) => index === 4 || index === 5 ? { ...day, city: "Christchurch", stops: [{ placeId: "garden", order: 1 }], blocks: [{ id: `regional-${index}`, kind: "stop", order: 1, placeId: "garden", durationMinutes: 180, evidence: [] }] } : day) });
  assert.equal(reviewItineraryQuality(regional, gatewaySession).some((finding) => finding.code === "destination_scope_collapse"), false);
});

test("review flags several thin sightseeing days at one base as a route allocation problem", () => {
  const shortWalk = { id: "walk", name: "Short Walk", city: "Aoraki / Mount Cook", category: "walk", durationMinutes: 60 };
  const days = Array.from({ length: 8 }, (_, index) => ({
    id: `day-${index}`, date: `2026-11-${String(index + 4).padStart(2, "0")}`,
    kind: index < 3 ? "scheduled" as const : "transit" as const,
    city: index < 3 ? "Aoraki / Mount Cook" : "South Island",
    title: index < 3 ? "Short walk" : "Transfer", summary: "Day plan",
    stops: index < 3 ? [{ placeId: "walk", order: 1 }] : [],
    candidatePlaceIds: [], blocks: index < 3 ? [{ id: `stop-${index}`, kind: "stop" as const, order: 1, placeId: "walk", durationMinutes: 60, evidence: [] }] : []
  }));
  const findings = reviewItineraryQuality(blueprint({ places: [shortWalk] as TripBlueprint["places"], days }), session);
  assert.equal(findings.find((finding) => finding.code === "overextended_base")?.blocking, true);
  const twoThinFourAtBase = days.map((day, index) => index === 2
    ? { ...day, kind: "transit" as const }
    : index === 3 ? { ...day, city: "Aoraki / Mount Cook" } : day);
  assert.equal(reviewItineraryQuality(blueprint({ places: [shortWalk] as TripBlueprint["places"], days: twoThinFourAtBase }), session)
    .some((finding) => finding.code === "overextended_base"), true);
});

test("saved coordinate-only travel estimates are removed while sourced durations remain", () => {
  const original = blueprint({ movements: [
    { id: "estimated", dayId: "day", originPlaceId: "hotel", destinationPlaceId: "tour", mode: "driving", status: "recheck", durationMinutes: 75, detail: "Allow about 75 minutes. This is a conservative planning estimate; refresh live route conditions.", evidence: [] },
    { id: "sourced", dayId: "day", originPlaceId: "tour", destinationPlaceId: "hotel", mode: "driving", status: "recheck", durationMinutes: 120, detail: "Operator baseline", evidence: [{ sourceId: "operator", status: "recheck" }] }
  ] as TripBlueprint["movements"] });
  const normalized = normalizeUnverifiedBookedTimes(original);
  assert.equal(normalized.movements[0]?.durationMinutes, undefined);
  assert.match(normalized.movements[0]?.detail ?? "", /live route/);
  assert.equal(normalized.movements[1]?.durationMinutes, 120);
  assert.equal(original.movements[0]?.durationMinutes, 75);
});
