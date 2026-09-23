import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { TravelBooking } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { registerBookingRoutes } from "./booking-routes.js";
import { planningResearchScopes } from "./planning-session-generation.js";

const now = "2026-09-18T00:00:00.000Z";

test("booking route preserves a user-confirmed destination across repeated hotel imports", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const server = Fastify({ logger: false });
  registerBookingRoutes(server, { store });
  const created = store.createPlanningSession("travel");
  store.savePlanningSession({
    ...created,
    status: "proposal_ready",
    facts: [
      { key: "destination", value: "Porto, Portugal", source: "user", confirmed: true, updatedAt: now },
      { key: "travel_dates", value: "2026-11-10 to 2026-11-12", source: "user", confirmed: true, updatedAt: now },
      { key: "purpose", value: "Leisure", source: "user", confirmed: true, updatedAt: now }
    ],
    proposal: { version: 1, title: "Porto, Portugal", objective: "Leisure in Porto, Portugal", theme: "Architecture", segments: ["Porto"], skeleton: ["Porto"], tradeoffs: [], assumptions: [], decisionPoints: [] },
    updatedAt: now
  });
  const booking = hotelBooking(created.id, "Praca da Batalha, Porto, Portugal");

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await server.inject({ method: "POST", url: `/api/planning-sessions/${created.id}/bookings/import-confirm`, payload: { booking } });
      assert.equal(response.statusCode, 200, response.body);
      const session = store.getPlanningSessionById(created.id)!;
      assert.equal(session.facts.find((fact) => fact.key === "destination")?.value, "Porto, Portugal");
      assert.equal(session.facts.find((fact) => fact.key === "destination")?.source, "user");
      assert.equal(session.facts.find((fact) => fact.key === "accommodation_location")?.value, "Praca da Batalha, Porto, Portugal");
      assert.deepEqual(planningResearchScopes(session), ["Porto, Portugal"]);
      assert.equal(session.deferred.some((item) => item.key === "accommodation_destination_conflict"), false);
    }
  } finally {
    await server.close();
    store.close();
  }
});

test("booking route retains a mismatched hotel and exposes a destination conflict", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const server = Fastify({ logger: false });
  registerBookingRoutes(server, { store });
  const created = store.createPlanningSession("travel");
  store.savePlanningSession({
    ...created,
    status: "proposal_ready",
    facts: [
      { key: "destination", value: "Porto, Portugal", source: "user", confirmed: true, updatedAt: now },
      { key: "travel_dates", value: "2026-11-10 to 2026-11-12", source: "user", confirmed: true, updatedAt: now },
      { key: "purpose", value: "Leisure", source: "user", confirmed: true, updatedAt: now }
    ],
    proposal: { version: 1, title: "Porto, Portugal", objective: "Leisure in Porto, Portugal", theme: "Architecture", segments: ["Porto"], skeleton: ["Porto"], tradeoffs: [], assumptions: [], decisionPoints: [] },
    updatedAt: now
  });

  try {
    const response = await server.inject({ method: "POST", url: `/api/planning-sessions/${created.id}/bookings/import-confirm`, payload: { booking: hotelBooking(created.id, "Calle Example, Madrid, Spain") } });
    assert.equal(response.statusCode, 200, response.body);
    const session = store.getPlanningSessionById(created.id)!;
    assert.equal(session.facts.find((fact) => fact.key === "destination")?.value, "Porto, Portugal");
    assert.equal(store.listTravelBookingsForPlanningSession(created.id).length, 1);
    assert.match(session.deferred.find((item) => item.key === "accommodation_destination_conflict")?.question ?? "", /Madrid/);
  } finally {
    await server.close();
    store.close();
  }
});

function hotelBooking(planningSessionId: string, location: string): TravelBooking {
  return {
    id: "porto-hotel",
    planningSessionId,
    type: "accommodation",
    status: "confirmed",
    title: "Confirmed hotel",
    source: "user",
    sourceHash: `hotel-${location}`,
    sourceLabel: "Controlled fixture",
    importedAt: now,
    updatedAt: now,
    constraintStrength: "hard",
    segments: [{
      id: "hotel-stay",
      segmentType: "hotel_stay",
      title: "Confirmed hotel",
      status: "confirmed",
      startAtLocal: "2026-11-10T15:00",
      endAtLocal: "2026-11-12T11:00",
      location,
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}
