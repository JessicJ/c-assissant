import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft, type BlueprintPlace, type PlanningSession, type TripBlueprint } from "@c-assistant/core";
import { materializeOutboundDeparture } from "./outbound-departure.js";
import { activityDueAt, compileExecutionItinerary } from "./execution-itinerary.js";

const airport: BlueprintPlace = { id: "lax", name: "Los Angeles International Airport (LAX)", city: "Los Angeles", locationLabel: "Los Angeles, United States", category: "airport", priority: "must", coordinates: [33.94, -118.4], whyWorthIt: "Departure airport", plan: "Check ticket", evidence: [] };
const session = { facts: [{ key: "arrival_origin", value: airport.name, confirmed: true, source: "user", updatedAt: "2026-10-08" }] } as Pick<PlanningSession, "facts">;
function fixture(): TripBlueprint {
  return { places: [], events: [], days: [
    { id: "departure", date: "2026-11-02", kind: "transit", city: "Los Angeles / in flight", title: "Depart Los Angeles", summary: "The outbound flight leaves LAX at approximately 22:00.", stops: [], blocks: [], candidatePlaceIds: [] },
    { id: "transit", date: "2026-11-03", kind: "transit", city: "In flight", title: "Transpacific flight", summary: "International date-line crossing.", stops: [], blocks: [], candidatePlaceIds: [] }
  ] } as unknown as TripBlueprint;
}

test("confirmed origin materializes preparation, airport journey, check-in, departure and in-flight blocks", () => {
  const original = fixture();
  const repaired = materializeOutboundDeparture(original, session, { places: [airport] });
  assert.equal(original.days[0]!.blocks!.length, 0);
  assert.equal(repaired.days[0]!.blocks!.length, 4);
  assert.equal(repaired.days[1]!.blocks!.length, 1);
  assert.equal(repaired.days[0]!.city, "Los Angeles");
  assert.equal(repaired.days[0]!.blocks![3]!.display!.timingStatus, "recheck");
  assert.equal(repaired.days[0]!.blocks![3]!.startTime, "22:00");
  assert.ok(repaired.days[0]!.blocks!.slice(0, 3).every(block => !block.startTime));
  assert.equal(materializeOutboundDeparture(repaired, session, { places: [airport] }), repaired);
});

test("missing or ambiguous source airports never invent departure details or overwrite existing activities", () => {
  const blueprint = fixture();
  assert.equal(materializeOutboundDeparture(blueprint, { facts: [] }, { places: [airport] }), blueprint);
  assert.equal(materializeOutboundDeparture(blueprint, session, { places: [] }), blueprint);
  assert.equal(materializeOutboundDeparture(blueprint, session, { places: [airport, { ...airport, id: "another" }] }), blueprint);
  blueprint.days[0]!.blocks!.push({ id: "existing", kind: "rest", order: 1, title: "Traveler's existing step", evidence: [] });
  assert.equal(materializeOutboundDeparture(blueprint, session, { places: [airport] }), blueprint);
});

test("execution retains distinct step titles and reminds on the day before departure in origin local time", () => {
  const repaired = materializeOutboundDeparture(fixture(), session, { places: [airport] });
  const plan = createPlanFromDraft({ title: "Outbound test", location: "New Zealand", dates: "2026-11-02 – 2026-11-03", knownInformation: [], assumptions: [], nextAction: "Review", stages: [],
    presentation: { kind: "itinerary", summary: "Outbound", startDate: "2026-11-02", endDate: "2026-11-03", places: [{ ...airport, detailSections: [], sourceRefs: [] }], routeSegments: [], days: repaired.days.map(day => ({ id: day.id, label: day.title, date: day.date, city: day.city, placeIds: day.stops.map(stop => stop.placeId), blocks: day.blocks ?? [] })) } });
  const compiled = compileExecutionItinerary(plan);
  assert.equal(compiled.activities.length, 6);
  assert.equal(compiled.activities[0]!.date, "2026-11-01");
  assert.equal(activityDueAt(compiled.activities[0]!, "America/Los_Angeles")!.toISOString(), "2026-11-01T17:00:00.000Z");
  assert.equal(compiled.activities[2]!.needsMovement, true);
  assert.match(compiled.activities[3]!.title, /Check in/);
  assert.equal(compiled.activities[3]!.needsMovement, false);
  assert.equal(compiled.activities[4]!.timeStatus, "recheck");
});
