import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { compileTripBlueprint, TRIP_BLUEPRINT_SCHEMA_VERSION, type ResearchSet, type TripBlueprint } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { registerPlanManagementRoutes } from "./plan-management-routes.js";
import type { PlanRouteMaps } from "./plan-route-refresh.js";

const maps = {
  geocodeAddress: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" }),
  drivingRoute: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" }),
  walkingRoute: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" }),
  transitRoute: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" })
} satisfies PlanRouteMaps;

test("active Plan can be abandoned without clearing historical Plans", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    registerPlanManagementRoutes(server, {
      store,
      getMaps: () => maps,
      startActivePlanMonitoring: () => {}
    });
    const generated = store.createGeneratedPlan({
      title: "Kyoto trip",
      location: "Kyoto, Japan",
      dates: "October 2026",
      knownInformation: ["Three travellers."],
      assumptions: [],
      nextAction: "Review the Plan.",
      stages: [{ title: "Daily itinerary", description: "A compact itinerary.", tasks: [{ title: "Walk Gion", owner: "assistant", dueLabel: "Day 1" }] }]
    });
    const confirmed = store.confirmPlan(generated.activePlan.id).activePlan;

    const response = await server.inject({ method: "POST", url: `/api/plans/${confirmed.id}/abandon` });

    assert.equal(response.statusCode, 200, response.body);
    const workspace = response.json();
    assert.equal(workspace.activePlan.title, "Attend an exhibition in Shanghai");
    assert.equal(workspace.activePlan.status, "draft");
    assert.equal(store.getExecutionPlan(), undefined);
    const history = store.listHistoricalPlans();
    assert.equal(history.some((plan) => plan.id === confirmed.id && plan.status === "cancelled"), true);
  } finally {
    await server.close();
    store.close();
  }
});

test("draft discard route still rejects an active Plan", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    registerPlanManagementRoutes(server, {
      store,
      getMaps: () => maps,
      startActivePlanMonitoring: () => {}
    });
    const generated = store.createGeneratedPlan({
      title: "Paris trip",
      location: "Paris, France",
      dates: "October 2026",
      knownInformation: [],
      assumptions: [],
      nextAction: "Review the Plan.",
      stages: [{ title: "Daily itinerary", description: "A compact itinerary.", tasks: [{ title: "Arrive", owner: "assistant", dueLabel: "Day 1" }] }]
    });
    const confirmed = store.confirmPlan(generated.activePlan.id).activePlan;

    const response = await server.inject({ method: "DELETE", url: `/api/plans/${confirmed.id}` });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /unconfirmed draft/i);
    assert.equal(store.getWorkspace().activePlan.id, confirmed.id);
    assert.equal(store.getExecutionPlan()?.id, confirmed.id);
  } finally {
    await server.close();
    store.close();
  }
});

test("direct Blueprint Revision route adds a place without using assisted replanning", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    registerPlanManagementRoutes(server, {
      store,
      getMaps: () => maps,
      startActivePlanMonitoring: () => {},
      getGeneratingPlan: () => false
    });
    const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
    const proposal = { version: 1, title: "Tokyo", objective: "Visit Tokyo", theme: "Culture", segments: ["Tokyo"], skeleton: ["2026-09-01"], tradeoffs: [], assumptions: [], decisionPoints: [] };
    store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
    store.confirmPlanningSession(session.id, 1);
    const generationKey = `${session.id}:1:interactive-trip-planner@0.2.0`;
    store.saveBlueprintGeneration({
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "running",
      stage: "research",
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:00:02.000Z"
    });
    const research: ResearchSet = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "research-tokyo",
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "completed",
      batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
      places: ["a", "b"].map((id) => ({ id, name: id, locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred" as const, coordinates: [35.68, 139.76] as [number, number], whyWorthIt: `Why ${id}`, plan: `Visit ${id}`, evidence: [] })),
      events: [],
      sources: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:01:00.000Z",
      completedAt: "2026-08-26T00:01:00.000Z"
    };
    store.saveResearchSet(research);
    const blueprint: TripBlueprint = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "blueprint-tokyo",
      version: 1,
      generationKey,
      proposalRef: research.proposalRef,
      skillLineage: research.skillLineage,
      researchSetId: research.id,
      title: "Tokyo",
      summary: "Tokyo plan",
      language: "en",
      destinations: ["Tokyo"],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      places: research.places,
      events: [],
      sources: [],
      days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "Two stops", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: ["b"] }],
      movements: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:02:00.000Z"
    };
    store.saveTripBlueprint(blueprint);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${compiled.id}/blueprint-revisions/direct`,
      payload: { kind: "add_place_to_day", expectedVersion: compiled.version, placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "a" } }
    });

    assert.equal(response.statusCode, 200, response.body);
    const workspace = response.json();
    assert.equal(workspace.activeBlueprint.version, 2);
    assert.deepEqual(workspace.activeBlueprint.days[0].stops.map((stop: { placeId: string }) => stop.placeId), ["a", "b"]);
    assert.equal(store.getPlanBlueprintLineage(workspace.activePlan.id)?.blueprintVersion, 2);
  } finally {
    await server.close();
    store.close();
  }
});

test("direct Blueprint Revision route moves a place within the same day", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    registerPlanManagementRoutes(server, {
      store,
      getMaps: () => maps,
      startActivePlanMonitoring: () => {},
      getGeneratingPlan: () => false
    });
    const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
    const proposal = { version: 1, title: "Tokyo", objective: "Visit Tokyo", theme: "Culture", segments: ["Tokyo"], skeleton: ["2026-09-01"], tradeoffs: [], assumptions: [], decisionPoints: [] };
    store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
    store.confirmPlanningSession(session.id, 1);
    const generationKey = `${session.id}:1:interactive-trip-planner@0.2.0`;
    store.saveBlueprintGeneration({
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "running",
      stage: "research",
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:00:02.000Z"
    });
    const research: ResearchSet = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "research-tokyo",
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "completed",
      batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b", "c"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
      places: ["a", "b", "c"].map((id) => ({ id, name: id, locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred" as const, coordinates: [35.68, 139.76] as [number, number], whyWorthIt: `Why ${id}`, plan: `Visit ${id}`, evidence: [] })),
      events: [],
      sources: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:01:00.000Z",
      completedAt: "2026-08-26T00:01:00.000Z"
    };
    store.saveResearchSet(research);
    const blueprint: TripBlueprint = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "blueprint-tokyo",
      version: 1,
      generationKey,
      proposalRef: research.proposalRef,
      skillLineage: research.skillLineage,
      researchSetId: research.id,
      title: "Tokyo",
      summary: "Tokyo plan",
      language: "en",
      destinations: ["Tokyo"],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      places: research.places,
      events: [],
      sources: [],
      days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "Three stops", stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2, time: "10:30" }, { placeId: "c", order: 3, time: "12:00" }], candidatePlaceIds: [] }],
      movements: [{ id: "m1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "verified", evidence: [] }, { id: "m2", dayId: "d1", originPlaceId: "b", destinationPlaceId: "c", mode: "walking", status: "verified", evidence: [] }],
      actionRequirements: [],
      createdAt: "2026-08-26T00:02:00.000Z"
    };
    store.saveTripBlueprint(blueprint);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${compiled.id}/blueprint-revisions/direct`,
      payload: { kind: "move_place_within_day", expectedVersion: compiled.version, placeId: "c", dayId: "d1", position: { kind: "start" } }
    });

    assert.equal(response.statusCode, 200, response.body);
    const workspace = response.json();
    assert.equal(workspace.activeBlueprint.version, 2);
    assert.deepEqual(workspace.activeBlueprint.days[0].stops.map((stop: { placeId: string }) => stop.placeId), ["c", "a", "b"]);
    assert.deepEqual(workspace.activeBlueprint.days[0].stops.map((stop: { time?: string }) => stop.time), ["09:00", "10:30", "12:00"]);
    assert.deepEqual(workspace.activeBlueprint.movements.map((movement: { status: string }) => movement.status), ["recheck", "recheck"]);
  } finally {
    await server.close();
    store.close();
  }
});
