import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { ConnectorResult, GeocodedPlaceFact, RouteFact } from "@c-assistant/connectors";
import { compileTripBlueprint, MAP_COORDINATES_PENDING_SCHEDULING_REASON, TRIP_BLUEPRINT_SCHEMA_VERSION, type ResearchSet, type TripBlueprint } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { registerPlanPresentationRoutes } from "./plan-presentation-routes.js";
import type { PlanRouteMaps } from "./plan-route-refresh.js";

type PresentationRouteMaps = PlanRouteMaps & { configurationStatus(): { status: string } };

function available<T>(data: T): ConnectorResult<T> {
  return { status: "available", provider: "google_maps", observedAt: "2026-09-04T08:00:00.000Z", data };
}

function unavailable<T>(): ConnectorResult<T> {
  return { status: "unavailable", provider: "google_maps", observedAt: "2026-09-04T08:00:00.000Z", failure: { code: "unavailable", message: "offline", retryable: true } };
}

function routeRefreshPlan(store: SqliteWorkspaceStore) {
  return store.createGeneratedPlan({
    title: "Tokyo route refresh",
    location: "Tokyo",
    dates: "October 2026",
    knownInformation: [],
    assumptions: [],
    nextAction: "Refresh routes.",
    presentation: {
      kind: "itinerary",
      summary: "One mapped day.",
      startDate: "2026-10-04",
      endDate: "2026-10-04",
      cities: ["Tokyo"],
      days: [{
        id: "day-1",
        label: "2026-10-04",
        date: "2026-10-04",
        city: "Tokyo",
        placeIds: ["museum", "garden", "coffee", "shopping"],
        stops: [
          { placeId: "museum", order: 1, time: "09:00" },
          { placeId: "garden", order: 2, time: "10:30" },
          { placeId: "coffee", order: 3, time: "12:00" },
          { placeId: "shopping", order: 4, time: "16:30" }
        ]
      }],
      places: [
        { id: "museum", name: "Fukagawa Edo Museum", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.681, 139.797], category: "museum", priority: "must", whyWorthIt: "Compact history.", plan: "Visit.", durationMinutes: 60, detailSections: [], sourceRefs: [] },
        { id: "garden", name: "Kiyosumi Gardens", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.682, 139.798], category: "garden", priority: "preferred", whyWorthIt: "Calm walk.", plan: "Visit.", durationMinutes: 45, detailSections: [], sourceRefs: [] },
        { id: "coffee", name: "ARiSE Coffee Roasters", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.683, 139.799], category: "coffee", priority: "preferred", whyWorthIt: "Coffee break.", plan: "Visit.", durationMinutes: 30, detailSections: [], sourceRefs: [] },
        { id: "shopping", name: "Kagurazaka", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.703, 139.740], category: "shopping", priority: "preferred", whyWorthIt: "Browse.", plan: "Visit.", durationMinutes: 60, detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "museum", destinationPlaceId: "garden", mode: "walking", verification: "needs_verification", detail: "This day was edited directly. Route needs refresh.", sourceRefs: [] },
        { id: "route-2", dayId: "day-1", originPlaceId: "garden", destinationPlaceId: "coffee", mode: "walking", verification: "needs_verification", detail: "This day was edited directly. Route needs refresh.", sourceRefs: [] },
        { id: "route-3", dayId: "day-1", originPlaceId: "coffee", destinationPlaceId: "shopping", mode: "walking", verification: "needs_verification", detail: "This day was edited directly. Route needs refresh.", sourceRefs: [] }
      ]
    },
    stages: [{ title: "Itinerary", description: "Mapped day.", presentationKind: "itinerary", tasks: [{ title: "Tour Tokyo", owner: "user", dueLabel: "2026-10-04" }] }]
  }).activePlan;
}

function multiDayRouteRefreshPlan(store: SqliteWorkspaceStore) {
  return store.createGeneratedPlan({
    title: "Tokyo route refresh",
    location: "Tokyo",
    dates: "October 2026",
    knownInformation: [],
    assumptions: [],
    nextAction: "Refresh routes.",
    presentation: {
      kind: "itinerary",
      summary: "Two mapped days.",
      startDate: "2026-10-04",
      endDate: "2026-10-05",
      cities: ["Tokyo"],
      days: [
        {
          id: "day-1",
          label: "2026-10-04",
          date: "2026-10-04",
          city: "Tokyo",
          placeIds: ["museum", "garden", "coffee"],
          stops: [{ placeId: "museum", order: 1, time: "09:00" }, { placeId: "garden", order: 2, time: "10:30" }, { placeId: "coffee", order: 3, time: "12:00" }]
        },
        {
          id: "day-2",
          label: "2026-10-05",
          date: "2026-10-05",
          city: "Tokyo",
          placeIds: ["coffee", "shopping"],
          stops: [{ placeId: "coffee", order: 1, time: "10:00" }, { placeId: "shopping", order: 2, time: "14:00" }]
        }
      ],
      places: [
        { id: "museum", name: "Fukagawa Edo Museum", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.681, 139.797], category: "museum", priority: "must", whyWorthIt: "Compact history.", plan: "Visit.", durationMinutes: 60, detailSections: [], sourceRefs: [] },
        { id: "garden", name: "Kiyosumi Gardens", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.682, 139.798], category: "garden", priority: "preferred", whyWorthIt: "Calm walk.", plan: "Visit.", durationMinutes: 45, detailSections: [], sourceRefs: [] },
        { id: "coffee", name: "ARiSE Coffee Roasters", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.683, 139.799], category: "coffee", priority: "preferred", whyWorthIt: "Coffee break.", plan: "Visit.", durationMinutes: 30, detailSections: [], sourceRefs: [] },
        { id: "shopping", name: "Kagurazaka", locationLabel: "Tokyo", city: "Tokyo", coordinates: [35.703, 139.740], category: "shopping", priority: "preferred", whyWorthIt: "Browse.", plan: "Visit.", durationMinutes: 60, detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [
        { id: "route-1", dayId: "day-1", originPlaceId: "museum", destinationPlaceId: "garden", mode: "walking", verification: "needs_verification", detail: "This day was edited directly. Route needs refresh.", sourceRefs: [] },
        { id: "route-2", dayId: "day-1", originPlaceId: "garden", destinationPlaceId: "coffee", mode: "walking", verification: "needs_verification", detail: "This day was edited directly. Route needs refresh.", sourceRefs: [] },
        { id: "route-3", dayId: "day-2", originPlaceId: "coffee", destinationPlaceId: "shopping", mode: "walking", verification: "needs_verification", detail: "This day was edited directly. Route needs refresh.", sourceRefs: [] }
      ]
    },
    stages: [{ title: "Itinerary", description: "Mapped day.", presentationKind: "itinerary", tasks: [{ title: "Tour Tokyo", owner: "user", dueLabel: "2026-10-04" }] }]
  }).activePlan;
}

function routeMaps(failingRouteIds = new Set<string>()): { maps: PresentationRouteMaps; geocodeCalls: string[]; routeCalls: string[] } {
  const coordinates = new Map([
    ["Fukagawa Edo Museum, Tokyo", "139.797,35.681"],
    ["Kiyosumi Gardens, Tokyo", "139.798,35.682"],
    ["ARiSE Coffee Roasters, Tokyo", "139.799,35.683"],
    ["Kagurazaka, Tokyo", "139.740,35.703"],
    ["a, Tokyo", "139.760,35.680"],
    ["b, Tokyo", "139.762,35.682"],
    ["c, Tokyo", "139.761,35.681"]
  ]);
  const routeByCoordinates = new Map([
    ["139.797,35.681->139.798,35.682", "route-1"],
    ["139.798,35.682->139.799,35.683", "route-2"],
    ["139.799,35.683->139.740,35.703", "route-3"],
    ["139.760,35.680->139.761,35.681", "movement-d1-1"]
  ]);
  const geocodeCalls: string[] = [];
  const routeCalls: string[] = [];
  const maps: PresentationRouteMaps = {
    configurationStatus: () => ({ status: "available" }),
    geocodeAddress: async ({ address }) => {
      geocodeCalls.push(address);
      return available<GeocodedPlaceFact>({ provider: "google_maps", formattedAddress: address, location: coordinates.get(address) ?? "139.7,35.6", province: "", city: "Tokyo", district: "", level: "place" });
    },
    drivingRoute: async () => { throw new Error("wrong mode"); },
    transitRoute: async () => { throw new Error("wrong mode"); },
    walkingRoute: async (input) => {
      const routeId = routeByCoordinates.get(`${input.origin}->${input.destination}`) ?? "unknown";
      routeCalls.push(routeId);
      if (failingRouteIds.has(routeId)) return unavailable<RouteFact>();
      return available<RouteFact>({ provider: "google_maps", mode: "walking", origin: input.origin, destination: input.destination, distanceMeters: routeId === "route-2" ? 950 : 700, durationSeconds: routeId === "route-2" ? 780 : 540, geometry: [input.origin.split(",").map(Number) as [number, number], input.destination.split(",").map(Number) as [number, number]], strategy: "google_maps_recommended" });
    }
  };
  return { maps, geocodeCalls, routeCalls };
}

function compiledBlueprintRoutePlan(store: SqliteWorkspaceStore) {
  const generationKey = "generation-tokyo-route-refresh";
  const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
  const proposal = { version: 1, title: "Tokyo", objective: "Plan Tokyo.", theme: "Route refresh", segments: ["Tokyo"], skeleton: ["2026-09-01"], tradeoffs: [], assumptions: [], decisionPoints: [] };
  store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
  store.confirmPlanningSession(session.id, 1);
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
    id: "research-tokyo-route-refresh",
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
    id: "blueprint-tokyo-route-refresh",
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
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "Two stops", stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }], candidatePlaceIds: ["c"] }],
    movements: [{ id: "m1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "unknown", status: "recheck", evidence: [] }],
    actionRequirements: [],
    createdAt: "2026-08-26T00:02:00.000Z"
  };
  delete blueprint.places[0]!.coordinates;
  blueprint.places[0]!.schedulingEligibility = { decision: "informational", reason: MAP_COORDINATES_PENDING_SCHEDULING_REASON };
  store.saveTripBlueprint(blueprint);
  const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;
  return store.applyDirectBlueprintRevision({
    expectedPlanId: compiled.id,
    expectedVersion: compiled.version,
    revision: { kind: "add_place_to_day", placeId: "c", dayId: "d1", position: { kind: "after", afterPlaceId: "a" }, createdAt: "2026-08-26T00:03:00.000Z" }
  }).activePlan;
}

test("presentation route refresh endpoint saves only requested route legs in one update", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps, routeCalls } = routeMaps();
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = routeRefreshPlan(store);

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, segmentIds: ["route-2", "route-1", "route-1"] }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.equal(payload.workspace.activePlan.version, plan.version + 1);
    assert.deepEqual(payload.routeRefresh.segmentIds, ["route-2", "route-1"]);
    assert.deepEqual(new Set(payload.routeRefresh.refreshedSegmentIds), new Set(["route-1", "route-2"]));
    assert.deepEqual(new Set(routeCalls), new Set(["route-1", "route-2"]));
    const segments = payload.workspace.activePlan.presentation.routeSegments;
    const route1 = segments.find((segment: { id: string }) => segment.id === "route-1");
    const route2 = segments.find((segment: { id: string }) => segment.id === "route-2");
    const route3 = segments.find((segment: { id: string }) => segment.id === "route-3");
    assert.equal(route1.verification, "verified");
    assert.equal(route1.label, "9 min walk");
    assert.equal(route1.detail, "Walk from Fukagawa Edo Museum to Kiyosumi Gardens; allow about 9 minutes, about 700 m.");
    assert.equal(route1.display.mapLineState, "formal");
    assert.equal(route1.display.refreshReason, undefined);
    assert.equal(/Google Maps|route refresh|before execution/i.test(route1.detail), false);
    assert.equal(route2.verification, "verified");
    assert.equal(route2.label, "13 min walk");
    assert.equal(route3.verification, "needs_verification");
  } finally {
    await server.close();
    store.close();
  }
});

test("presentation route refresh endpoint preserves other days that still need refresh", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps, routeCalls } = routeMaps();
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = multiDayRouteRefreshPlan(store);

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, segmentIds: ["route-1"] }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.deepEqual(payload.routeRefresh.segmentIds, ["route-1"]);
    assert.deepEqual(payload.routeRefresh.refreshedSegmentIds, ["route-1"]);
    assert.deepEqual(routeCalls, ["route-1"]);
    const segments = payload.workspace.activePlan.presentation.routeSegments;
    assert.deepEqual(segments.map((segment: { id: string; dayId?: string; verification: string }) => [segment.id, segment.dayId, segment.verification]), [
      ["route-1", "day-1", "verified"],
      ["route-2", "day-1", "needs_verification"],
      ["route-3", "day-2", "needs_verification"]
    ]);
    assert.equal(payload.workspace.activePlan.version, plan.version + 1);
  } finally {
    await server.close();
    store.close();
  }
});

test("presentation route refresh endpoint rejects invalid batch requests before Maps", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps, geocodeCalls, routeCalls } = routeMaps();
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = routeRefreshPlan(store);

    const stale = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version + 1, segmentIds: ["route-1"] }
    });
    assert.equal(stale.statusCode, 409, stale.body);

    const empty = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, segmentIds: [] }
    });
    assert.equal(empty.statusCode, 400, empty.body);

    const tooMany = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, segmentIds: Array.from({ length: 37 }, (_, index) => `route-${index + 1}`) }
    });
    assert.equal(tooMany.statusCode, 400, tooMany.body);

    const unknown = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, segmentIds: ["route-1", "other-plan-route"] }
    });
    assert.equal(unknown.statusCode, 404, unknown.body);
    assert.equal(unknown.json().code, "missing_segment");
    assert.deepEqual(geocodeCalls, []);
    assert.deepEqual(routeCalls, []);
    assert.equal(store.getWorkspace().activePlan.version, plan.version);
  } finally {
    await server.close();
    store.close();
  }
});

test("presentation route refresh endpoint writes route facts back to the Trip Blueprint", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps } = routeMaps();
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = compiledBlueprintRoutePlan(store);

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version, segmentIds: ["movement-d1-1"] }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.equal(payload.workspace.activePlan.id, plan.id);
    assert.equal(payload.workspace.activePlan.version, plan.version + 1);
    assert.equal(payload.workspace.activeBlueprint.version, 3);
    assert.deepEqual(payload.workspace.activeBlueprint.movements.map((movement: { id: string; status: string; durationMinutes?: number; distanceMeters?: number }) => [movement.id, movement.status, movement.durationMinutes, movement.distanceMeters]), [["movement-d1-1", "verified", 9, 700], ["movement-d1-2", "recheck", undefined, undefined]]);
    assert.deepEqual(payload.workspace.activeBlueprint.movements.map((movement: { id: string; label?: string; detail?: string }) => [movement.id, movement.label, movement.detail]), [
      ["movement-d1-1", "9 min walk", "Walk from a to c; allow about 9 minutes, about 700 m."],
      ["movement-d1-2", "Route needs refresh", "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution."]
    ]);
    assert.deepEqual(payload.workspace.activeBlueprint.movements.map((movement: { id: string; display?: { mapLineState?: string; refreshReason?: string } }) => [movement.id, movement.display?.mapLineState, movement.display?.refreshReason ?? ""]), [
      ["movement-d1-1", "formal", ""],
      ["movement-d1-2", "needs_refresh", "Refresh this route leg after direct itinerary edits."]
    ]);
    assert.equal(payload.workspace.activeBlueprint.movements[0].evidence[0].sourceId, "google_maps");
    assert.equal(payload.workspace.activePlan.presentation.routeSegments[0].verification, "verified");
    assert.equal(payload.workspace.activePlan.presentation.routeSegments[0].display.mapLineState, "formal");
    assert.equal(payload.workspace.activeBlueprint.places.find((place: { id: string }) => place.id === "a").schedulingEligibility.decision, "schedulable");
    assert.equal(store.getPlanBlueprintLineage(plan.id)?.blueprintVersion, 3);
  } finally {
    await server.close();
    store.close();
  }
});

test("presentation route refresh endpoint rejects stale Trip Blueprint versions before Maps", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps, geocodeCalls, routeCalls } = routeMaps();
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = compiledBlueprintRoutePlan(store);
    const blueprintVersion = store.getWorkspace().activeBlueprint?.version;
    assert.ok(blueprintVersion !== undefined);
    assert.equal(blueprintVersion, 2);

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, expectedBlueprintVersion: blueprintVersion - 1, segmentIds: ["movement-d1-1"] }
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.match(response.json().error, /Trip Blueprint changed/i);
    assert.deepEqual(geocodeCalls, []);
    assert.deepEqual(routeCalls, []);
    const workspace = store.getWorkspace();
    assert.equal(workspace.activePlan.version, plan.version);
    assert.equal(workspace.activeBlueprint?.version, blueprintVersion);
  } finally {
    await server.close();
    store.close();
  }
});

test("single presentation route refresh endpoint writes route facts back to the Trip Blueprint", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps } = routeMaps();
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = compiledBlueprintRoutePlan(store);

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/movement-d1-1/refresh`,
      payload: { expectedVersion: plan.version, expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.equal(payload.workspace.activePlan.version, plan.version + 1);
    assert.equal(payload.workspace.activeBlueprint.version, 3);
    assert.equal(payload.workspace.activeBlueprint.movements[0].status, "verified");
    assert.equal(payload.workspace.activeBlueprint.movements[0].durationMinutes, 9);
    assert.equal(payload.workspace.activeBlueprint.movements[0].label, "9 min walk");
    assert.equal(payload.workspace.activeBlueprint.movements[0].detail, "Walk from a to c; allow about 9 minutes, about 700 m.");
    assert.equal(payload.workspace.activeBlueprint.movements[0].display.mapLineState, "formal");
    assert.equal(payload.workspace.activePlan.presentation.routeSegments[0].verification, "verified");
    assert.equal(payload.workspace.activePlan.presentation.routeSegments[0].label, "9 min walk");
    assert.equal(payload.workspace.activePlan.presentation.routeSegments[0].detail, "Walk from a to c; allow about 9 minutes, about 700 m.");
    assert.equal(payload.workspace.activePlan.presentation.routeSegments[0].display.mapLineState, "formal");
    assert.equal(payload.segment.verification, "verified");
    assert.equal(payload.segment.label, "9 min walk");
    assert.equal(payload.segment.display.mapLineState, "formal");
    assert.equal(store.getPlanBlueprintLineage(plan.id)?.blueprintVersion, 3);
  } finally {
    await server.close();
    store.close();
  }
});

test("presentation route refresh endpoint saves successful legs when only part of the batch fails", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps } = routeMaps(new Set(["route-2"]));
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = routeRefreshPlan(store);

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, segmentIds: ["route-1", "route-2"] }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.deepEqual(payload.routeRefresh.segmentIds, ["route-1", "route-2"]);
    assert.deepEqual(payload.routeRefresh.refreshedSegmentIds, ["route-1"]);
    assert.deepEqual(payload.routeRefresh.failedSegmentIds, ["route-2"]);
    assert.equal(payload.workspace.activePlan.version, plan.version + 1);
    const current = payload.workspace.activePlan;
    assert.deepEqual(current.presentation?.routeSegments.map((segment: { id: string; verification: string; display?: { mapLineState?: string } }) => [segment.id, segment.verification, segment.display?.mapLineState ?? ""]), [
      ["route-1", "verified", "formal"],
      ["route-2", "needs_verification", ""],
      ["route-3", "needs_verification", ""]
    ]);
  } finally {
    await server.close();
    store.close();
  }
});

test("presentation route refresh endpoint preserves the Plan when every requested leg fails", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const { maps } = routeMaps(new Set(["route-1", "route-2"]));
  try {
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    const plan = routeRefreshPlan(store);

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/presentation/routes/refresh`,
      payload: { expectedVersion: plan.version, segmentIds: ["route-1", "route-2"] }
    });

    assert.equal(response.statusCode, 424, response.body);
    assert.deepEqual(response.json().failedSegmentIds, ["route-1", "route-2"]);
    const current = store.getWorkspace().activePlan;
    assert.equal(current.version, plan.version);
    assert.deepEqual(current.presentation?.routeSegments.map((segment) => segment.verification), ["needs_verification", "needs_verification", "needs_verification"]);
  } finally {
    await server.close();
    store.close();
  }
});
