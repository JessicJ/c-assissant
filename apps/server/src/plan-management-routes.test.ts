import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import { compileTripBlueprint, TRIP_BLUEPRINT_SCHEMA_VERSION, type ResearchSet, type TripBlueprint } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { registerPlanManagementRoutes } from "./plan-management-routes.js";
import type { PlanRouteMaps } from "./plan-route-refresh.js";
import { activateReviewedPlan, PlanActivationError } from "./plan-activation.js";

const maps = {
  geocodeAddress: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" }),
  drivingRoute: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" }),
  walkingRoute: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" }),
  transitRoute: async () => ({ status: "unavailable" as const, provider: "google_maps" as const, observedAt: "2026-09-01T00:00:00.000Z" })
} satisfies PlanRouteMaps;

test("确认版本变化与已确认状态不误导旅行者修正日期路线", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const plan = store.getWorkspace().activePlan;
    assert.throws(() => activateReviewedPlan(store, { planId: plan.id, expectedVersion: plan.version + 1 }), (error: unknown) => error instanceof PlanActivationError && error.code === "version_conflict");
    const active = store.confirmPlan(plan.id).activePlan;
    assert.throws(() => activateReviewedPlan(store, { planId: active.id, expectedVersion: active.version }), (error: unknown) => error instanceof PlanActivationError && error.code === "confirmation_unavailable");
  } finally { store.close(); }
});

test("编辑辅助交接与确认的忙碌拒绝都进入稳定协议", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    registerPlanManagementRoutes(server, { store, getMaps: () => maps, startActivePlanMonitoring() {}, getGeneratingPlan: () => true });
    const plan = store.getWorkspace().activePlan;
    for (const suffix of ["blueprint-revisions/direct", "blueprint-revisions/assisted-replanning", "blueprint-revisions/fictional-revision/undo", "confirm"]) {
      const response = await server.inject({ method: "POST", url: `/api/plans/${plan.id}/${suffix}`, payload: { expectedVersion: plan.version } });
      assert.equal(response.statusCode, 409); assert.equal(response.json().code, "generation_busy");
    }
  } finally { await server.close(); store.close(); }
});

test("真实Store的历史保护、丢弃、结束与草稿修改拒绝保持不同业务动作", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    registerPlanManagementRoutes(server, { store, getMaps: () => maps, startActivePlanMonitoring() {} });
    const draft = store.createGeneratedPlan({ title: "虚构隔离行程", location: "虚构海湾", dates: "2026-12-01", knownInformation: [], assumptions: [], nextAction: "审阅", stages: [{ title: "虚构日程", description: "仅供测试", tasks: [{ title: "虚构甲", owner: "user", dueLabel: "当天" }, { title: "虚构乙", owner: "user", dueLabel: "当天" }] }] }).activePlan;
    const before = store.getWorkspace();
    for (const [method, url, code] of [["POST", `/api/plans/${draft.id}/abandon`, "active_plan_required"], ["DELETE", `/api/plans/${draft.id}/history`, "history_plan_protected"]] as const) {
      const response = await server.inject({ method, url });
      assert.equal(response.statusCode, 409); assert.equal(response.json().code, code);
      assert.equal(response.body.includes("辅助重规划"), false);
      assert.deepEqual(store.getWorkspace(), before);
    }
    const active = store.confirmPlan(draft.id).activePlan;
    const activeState = store.getWorkspace();
    const cases = [
      { method: "DELETE", url: `/api/plans/${active.id}`, code: "unconfirmed_draft_required" },
      { method: "POST", url: `/api/plans/${active.id}/changes`, payload: { kind: "reorder_task", taskId: active.stages[0]!.tasks[0]!.id, direction: "down", expectedVersion: active.version }, code: "draft_required" },
      { method: "POST", url: `/api/plans/${active.id}/changes/fictional-change/undo`, payload: { expectedVersion: active.version }, code: "draft_required" },
      { method: "POST", url: `/api/plans/${active.id}/accommodation/linked`, payload: { expectedVersion: active.version, name: "虚构住宿", address: "虚构地区" }, code: "draft_required" }
    ] as const;
    for (const { code, ...options } of cases) {
      const response = await server.inject(options);
      assert.equal(response.statusCode, 409); assert.equal(response.json().code, code);
      assert.equal(response.body.includes("辅助重规划"), false);
      assert.deepEqual(store.getWorkspace(), activeState);
    }
  } finally { await server.close(); store.close(); }
});

test("真实Store拒绝经HTTP响应和实际Web客户端保留精确可行动文案", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  const originalFetch = globalThis.fetch;
  const api = await import(new URL("../../web/src/api-client.ts", import.meta.url).href);
  try {
    registerPlanManagementRoutes(server, { store, getMaps: () => maps, startActivePlanMonitoring() {} });
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const response = await server.inject({ method: (init?.method ?? "GET") as "GET" | "POST" | "DELETE", url: String(url), ...(typeof init?.body === "string" ? { payload: JSON.parse(init.body) } : {}) });
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const draft = store.getWorkspace().activePlan;
    await assert.rejects(() => api.abandonActivePlan(draft.id), (error: unknown) => {
      assert.ok(error instanceof api.ApiRequestError);
      assert.equal((error as { code?: string }).code, "active_plan_required");
      assert.equal(api.safePlanError(error), "Only the executing itinerary can be ended. Return to the current itinerary and check its status."); return true;
    });
    const active = store.confirmPlan(draft.id).activePlan;
    const before = store.getWorkspace();
    for (const [operation, code, message] of [
      [() => api.deleteHistoricalPlan(active.id), "history_plan_protected", "The current or executing itinerary cannot be deleted from history. Choose an archived itinerary."],
      [() => api.deletePlan(active.id), "unconfirmed_draft_required", "Only unconfirmed drafts can be discarded. Use End trip for an approved itinerary."],
      [() => api.linkPlanAccommodation(active.id, { expectedVersion: active.version, name: "虚构住宿", address: "虚构地区", status: "candidate" }), "draft_required", "Create a replacement draft before adjusting the approved itinerary."]
    ] as const) {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof api.ApiRequestError);
        assert.equal((error as { code?: string }).code, code); assert.equal(api.safePlanError(error), message);
        assert.equal(api.safePlanError(error).includes("辅助重规划"), false); return true;
      });
      assert.deepEqual(store.getWorkspace(), before);
    }
  } finally { globalThis.fetch = originalFetch; await server.close(); store.close(); }
});

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
    assert.equal(response.json().code, "unconfirmed_draft_required");
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
      payload: {
        requestId: randomUUID(), kind: "add_place_to_day", expectedVersion: compiled.version, expectedBlueprintVersion: 1, placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "a" } }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.equal(payload.activeBlueprint.version, 2);
    const workspace = payload.workspace;
    assert.equal(workspace.activeBlueprint.version, 2);
    assert.deepEqual(workspace.activeBlueprint.days[0].stops.map((stop: { placeId: string }) => stop.placeId), ["a", "b"]);
    assert.equal(payload.revision.revisionCount, 1);
    assert.deepEqual(payload.revision.affectedDayIds, ["d1"]);
    assert.deepEqual(payload.revision.affectedPlaceIds, ["b", "a"]);
    assert.deepEqual(payload.revision.routeImpact.days.map((day: { dayId: string; addedPlaceIds: string[]; movementIds: string[]; requiresTimingReview: boolean; requiresMealRestSpacingReview: boolean; readiness: string }) => ({
      dayId: day.dayId,
      addedPlaceIds: day.addedPlaceIds,
      movementIds: day.movementIds,
      requiresTimingReview: day.requiresTimingReview,
      requiresMealRestSpacingReview: day.requiresMealRestSpacingReview,
      readiness: day.readiness
    })), [{
      dayId: "d1",
      addedPlaceIds: ["b"],
      movementIds: ["movement-d1-1"],
      requiresTimingReview: true,
      requiresMealRestSpacingReview: true,
      readiness: "ready_for_route_refresh"
    }]);
    assert.deepEqual(payload.revision.replanReadiness, {
      status: "ready_for_route_refresh",
      dayIds: ["d1"],
      reason: "These direct itinerary edits are saved, but affected routes and timing still need refresh before execution."
    });
    assert.equal(store.getPlanBlueprintLineage(workspace.activePlan.id)?.blueprintVersion, 2);
    const refreshedWorkspace = store.getWorkspace();
    assert.deepEqual(refreshedWorkspace.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);

    const duplicateAddResponse = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(), kind: "add_place_to_day", expectedVersion: workspace.activePlan.version, expectedBlueprintVersion: 2, placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "a" } }
    });
    assert.equal(duplicateAddResponse.statusCode, 409, duplicateAddResponse.body);
    assert.equal(duplicateAddResponse.json().code, "already_scheduled");
    assert.equal(store.getWorkspace().activeBlueprint?.version, 2);

    const priorityResponse = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(), kind: "update_place_priority", expectedVersion: workspace.activePlan.version, expectedBlueprintVersion: 2, placeId: "b", priority: "must" }
    });
    assert.equal(priorityResponse.statusCode, 200, priorityResponse.body);
    const priorityPayload = priorityResponse.json();
    assert.equal(priorityPayload.workspace.activeBlueprint.version, 3);
    assert.equal(priorityPayload.workspace.activeBlueprint.places.find((place: { id: string; priority: string }) => place.id === "b")?.priority, "must");
    assert.deepEqual(priorityPayload.revision.routeRefresh.movementIds, []);
    assert.equal(store.getPlanBlueprintLineage(priorityPayload.workspace.activePlan.id)?.blueprintVersion, 3);

    const removeResponse = await server.inject({
      method: "POST",
      url: `/api/plans/${priorityPayload.workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(), kind: "remove_place_from_day", expectedVersion: priorityPayload.workspace.activePlan.version, expectedBlueprintVersion: 3, placeId: "b", dayId: "d1" }
    });
    assert.equal(removeResponse.statusCode, 409, removeResponse.body);
    assert.equal(removeResponse.json().code,"high_impact_confirmation_required");
    const confirmedRemoval=await server.inject({method:"POST",url:`/api/plans/${priorityPayload.workspace.activePlan.id}/blueprint-revisions/direct`,payload:{requestId:randomUUID(),kind:"remove_place_from_day",expectedVersion:priorityPayload.workspace.activePlan.version,expectedBlueprintVersion:3,placeId:"b",dayId:"d1",highImpactConfirmation:removeResponse.json().impact.id}});
    assert.equal(confirmedRemoval.statusCode,200,confirmedRemoval.body);
    const removePayload = confirmedRemoval.json();
    assert.equal(removePayload.workspace.activeBlueprint.version, 4);
    assert.deepEqual(removePayload.workspace.activeBlueprint.days[0].stops.map((stop: { placeId: string }) => stop.placeId), ["a"]);
    assert.deepEqual(removePayload.workspace.activeBlueprint.days[0].candidatePlaceIds, ["b"]);
    assert.deepEqual(removePayload.revision.kinds, ["remove_place_from_day"]);
    assert.equal(store.getPlanBlueprintLineage(removePayload.workspace.activePlan.id)?.blueprintVersion, 4);
  } finally {
    await server.close();
    store.close();
  }
});

test("direct Blueprint Revision route applies batched add and move edits once", async () => {
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
      days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "Three stops", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: ["b", "c"] }],
      movements: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:02:00.000Z"
    };
    store.saveTripBlueprint(blueprint);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${compiled.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(),
        expectedVersion: compiled.version,
        expectedBlueprintVersion: 1,
        revisions: [
          { kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "a" } },
          { kind: "add_place_to_day", placeId: "c", dayId: "d1", position: { kind: "end" } },
          { kind: "move_place_within_day", placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "c" } }
        ]
      }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.equal(payload.activeBlueprint.version, 2);
    const workspace = payload.workspace;
    assert.deepEqual(workspace.activeBlueprint.days[0].stops.map((stop: { placeId: string }) => stop.placeId), ["a", "c", "b"]);
    assert.deepEqual(workspace.activeBlueprint.days[0].candidatePlaceIds, []);
    assert.deepEqual(workspace.activePlan.presentation.routeSegments.map((segment: { id: string; mode: string; verification: string }) => [segment.id, segment.mode, segment.verification]), [["movement-d1-1", "walking", "needs_verification"], ["movement-d1-2", "walking", "needs_verification"]]);
    assert.equal(payload.revision.revisionCount, 3);
    assert.deepEqual(payload.revision.affectedDayIds, ["d1"]);
    assert.deepEqual(payload.revision.routeRefresh.movementIds, ["movement-d1-1", "movement-d1-2"]);
    assert.equal(store.getPlanBlueprintLineage(workspace.activePlan.id)?.blueprintVersion, 2);

    const failed = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(),
        expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version ?? 1,
        expectedVersion: workspace.activePlan.version,
        revisions: [
          { kind: "move_place_within_day", placeId: "c", dayId: "d1", position: { kind: "start" } },
          { kind: "move_place_within_day", placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "missing-place" } }
        ]
      }
    });
    assert.equal(failed.statusCode, 400, failed.body);
    assert.equal(failed.json().workspace, undefined);
    const afterFailed = store.getWorkspace();
    assert.equal(afterFailed.activeBlueprint?.version, 2);
    assert.deepEqual(afterFailed.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["a", "c", "b"]);

    const stale = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(),
        expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version ?? 1,
        expectedVersion: workspace.activePlan.version + 1,
        revisions: [{ kind: "move_place_within_day", placeId: "a", dayId: "d1", position: { kind: "end" } }]
      }
    });
    assert.equal(stale.statusCode, 409, stale.body);

    const staleBlueprint = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(),
        expectedVersion: workspace.activePlan.version,
        expectedBlueprintVersion: 3,
        revisions: [{ kind: "move_place_within_day", placeId: "a", dayId: "d1", position: { kind: "end" } }]
      }
    });
    assert.equal(staleBlueprint.statusCode, 409, staleBlueprint.body);
    assert.equal(staleBlueprint.json().code, "version_conflict");

    const empty = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(),
        expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version ?? 1, expectedVersion: workspace.activePlan.version, revisions: [] }
    });
    assert.equal(empty.statusCode, 400, empty.body);
    assert.equal(empty.json().code, "empty_edits");

    const oversized = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(),
        expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version ?? 1,
        expectedVersion: workspace.activePlan.version,
        revisions: Array.from({ length: 37 }, () => ({ kind: "move_place_within_day", placeId: "a", dayId: "d1", position: { kind: "end" } }))
      }
    });
    assert.equal(oversized.statusCode, 400, oversized.body);
    assert.equal(oversized.json().code, "too_many_edits");

    const malformed = await server.inject({
      method: "POST",
      url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(),
        expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version ?? 1,
        expectedVersion: workspace.activePlan.version,
        revisions: [{ kind: "move_place_within_day", placeId: "a", dayId: "d1" }]
      }
    });
    assert.equal(malformed.statusCode, 400, malformed.body);
    assert.equal(malformed.json().code, "invalid_placement");

    const afterInvalidRequests = store.getWorkspace();
    assert.equal(afterInvalidRequests.activeBlueprint?.version, workspace.activeBlueprint.version);
    assert.equal(afterInvalidRequests.activePlan.version, workspace.activePlan.version);
    assert.deepEqual(afterInvalidRequests.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["a", "c", "b"]);
  } finally {
    await server.close();
    store.close();
  }
});

test("direct Blueprint Revision route returns structured assisted replanning requirements", async () => {
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
    const places = ["a", "b"].map((id) => ({
      id,
      name: id === "a" ? "Morning anchor" : "Faraway dinner",
      locationLabel: "Tokyo",
      city: "Tokyo",
      category: id === "a" ? "sight" : "restaurant",
      priority: "preferred" as const,
      coordinates: [35.68, 139.76] as [number, number],
      whyWorthIt: `Why ${id}`,
      plan: `Visit ${id}`,
      ...(id === "b" ? { schedulingEligibility: { decision: "high_impact" as const, reason: "Requires another city day.", highImpactReasons: ["Different city"] } } : {}),
      evidence: []
    }));
    const research: ResearchSet = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "research-tokyo-structured-replan",
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "completed",
      batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
      places,
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
      id: "blueprint-tokyo-structured-replan",
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
      places,
      events: [],
      sources: [],
      days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "One stop", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: ["b"] }],
      movements: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:02:00.000Z"
    };
    store.saveTripBlueprint(blueprint);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;

    const response = await server.inject({
      method: "POST",
      url: `/api/plans/${compiled.id}/blueprint-revisions/direct`,
      payload: {
        requestId: randomUUID(), kind: "add_place_to_day", expectedVersion: compiled.version, expectedBlueprintVersion: 1, placeId: "b", dayId: "d1", position: { kind: "end" } }
    });

    assert.equal(response.statusCode, 409, response.body);
    const payload = response.json();
    assert.equal(payload.code, "assisted_replanning_required");
    assert.equal(payload.replanRequirement.status, "assisted_replanning_required");
    assert.equal(payload.replanRequirement.reasonCode, "high_impact_place");
    assert.equal(payload.replanRequirement.editKind, "add_place_to_day");
    assert.deepEqual(payload.replanRequirement.affectedDayIds, ["d1"]);
    assert.deepEqual(payload.replanRequirement.affectedPlaceIds, ["b", "a"]);
    assert.match(payload.replanRequirement.explanation, /needs to replan/i);
    assert.match(payload.replanRequirement.suggestedRequest, /Replan the affected itinerary day/i);
    assert.equal(payload.workspace, undefined);
    assert.equal(store.getWorkspace().activeBlueprint?.version, 1);

    const assisted = await server.inject({
      method: "POST",
      url: `/api/plans/${compiled.id}/blueprint-revisions/assisted-replanning`,
      payload: {
        expectedVersion: compiled.version,
        expectedBlueprintVersion: 1,
        replanRequirement: payload.replanRequirement,
        revisions: [{ kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "end" } }]
      }
    });
    assert.equal(assisted.statusCode, 200, assisted.body);
    const assistedPayload = assisted.json();
    assert.equal(assistedPayload.workspace.activeBlueprint.version, 1);
    assert.equal(assistedPayload.handoff.status, "ready_for_assisted_replanning");
    assert.equal(assistedPayload.handoff.baseBlueprintVersion, 1);
    assert.deepEqual(assistedPayload.handoff.affectedDayIds, ["d1"]);
    assert.deepEqual(assistedPayload.handoff.affectedPlaceIds, ["b", "a"]);
    assert.match(assistedPayload.handoff.request, /Replan the affected itinerary day for Tokyo/);
    assert.match(assistedPayload.handoff.request, /Add Faraway dinner at the end of the day on 2026-09-01/);
    assert.equal(store.getWorkspace().activeBlueprint?.version, 1);

    const stalePlan = await server.inject({
      method: "POST",
      url: `/api/plans/${compiled.id}/blueprint-revisions/assisted-replanning`,
      payload: {
        expectedVersion: compiled.version + 1,
        expectedBlueprintVersion: 1,
        replanRequirement: payload.replanRequirement,
        revisions: [{ kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "end" } }]
      }
    });
    assert.equal(stalePlan.statusCode, 409, stalePlan.body);
    assert.equal(stalePlan.json().code, "version_conflict");

    const staleBlueprint = await server.inject({
      method: "POST",
      url: `/api/plans/${compiled.id}/blueprint-revisions/assisted-replanning`,
      payload: {
        expectedVersion: compiled.version,
        expectedBlueprintVersion: 2,
        replanRequirement: payload.replanRequirement,
        revisions: [{ kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "end" } }]
      }
    });
    assert.equal(staleBlueprint.statusCode, 409, staleBlueprint.body);
    assert.equal(staleBlueprint.json().code, "version_conflict");
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
      payload: {
        requestId: randomUUID(),
        expectedBlueprintVersion: store.getWorkspace().activeBlueprint?.version ?? 1, kind: "move_place_within_day", expectedVersion: compiled.version, placeId: "c", dayId: "d1", position: { kind: "start" } }
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    assert.equal(payload.activeBlueprint.version, 2);
    const workspace = payload.workspace;
    assert.equal(workspace.activeBlueprint.version, 2);
    assert.deepEqual(workspace.activeBlueprint.days[0].stops.map((stop: { placeId: string }) => stop.placeId), ["c", "a", "b"]);
    assert.deepEqual(workspace.activeBlueprint.days[0].stops.map((stop: { time?: string }) => stop.time), ["09:00", "10:30", "12:00"]);
    assert.deepEqual(workspace.activeBlueprint.movements.map((movement: { status: string }) => movement.status), ["recheck", "recheck"]);
    assert.deepEqual(workspace.activePlan.presentation.routeSegments.map((segment: { id: string; mode: string; verification: string }) => [segment.id, segment.mode, segment.verification]), [["movement-d1-1", "walking", "needs_verification"], ["movement-d1-2", "walking", "needs_verification"]]);
    assert.equal(payload.revision.revisionCount, 1);
    assert.deepEqual(payload.revision.affectedPlaceIds, ["c", "a", "b"]);
  } finally {
    await server.close();
    store.close();
  }
});

test("activation rejects invalid activity times before starting reminders", async () => {
  const store = new SqliteWorkspaceStore(":memory:"); const server = Fastify(); let starts = 0;
  registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring:()=>{starts++;}});
  const plan = store.createGeneratedPlan({title:"Incomplete itinerary",location:"Auckland",dates:"November",knownInformation:[],assumptions:[],nextAction:"Review",stages:[],presentation:{kind:"itinerary",summary:"Review",startDate:"2026-11-02",endDate:"2026-11-02",places:[],routeSegments:[],days:[{id:"day",date:"2026-11-02",label:"Departure",city:"Auckland",placeIds:[],blocks:[{id:"prepare",kind:"event",order:1,title:"Get ready",startTime:"25:00",evidence:[]}]}]}}).activePlan;
  const response=await server.inject({method:"POST",url:`/api/plans/${plan.id}/confirm`,payload:{expectedVersion:plan.version}});
  assert.equal(response.statusCode,409,response.body);assert.equal(starts,0);assert.equal(store.getExecutionPlan(),undefined);
  await server.close();store.close();
});

// 独立 SQLite + 真正监听的 HTTP，关系事实必须由普通 API 审阅生产。
function prepareRelationshipHttpBlueprint(store: SqliteWorkspaceStore, configure?: (blueprint:TripBlueprint)=>void): void {
  const session = store.createPlanningSession("travel");
  store.savePlanningSession({ ...session, status: "proposal_ready", proposal: { version: 1, title: "虚构关系验收", objective: "隔离测试", theme: "旅行", segments: ["虚构海湾"], skeleton: ["2026-12-01"], tradeoffs: [], assumptions: [], decisionPoints: [] } });
  store.confirmPlanningSession(session.id, 1);
  const createdAt = "2026-11-01T00:00:00Z";
  const blueprint: TripBlueprint = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: "http-relationship-blueprint", version: 1, generationKey: "http-relationship-generation",
    proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" }, researchSetId: "http-relationship-research",
    title: "虚构关系验收", summary: "独立数据", language: "zh", destinations: ["虚构海湾"], startDate: "2026-12-01", endDate: "2026-12-01",
    places: ["a", "b"].map(id => ({ id, name: id === "a" ? "虚构景点" : "虚构公园", locationLabel: "虚构海湾", category: "sight", priority: id === "a" ? "must" : "preferred", coordinates: [35.68, 139.76], whyWorthIt: "隔离测试", plan: "游览", evidence: [] })),
    events: [], sources: [], days: [{ id: "d", date: "2026-12-01", kind: "scheduled", city: "虚构海湾", title: "第一天", summary: "测试", stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }], candidatePlaceIds: [] }], movements: [{ id: "http-movement", dayId: "d", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "recheck", evidence: [] }], actionRequirements: [], createdAt
  };
  configure?.(blueprint);
  store.saveBlueprintGeneration({ generationKey: blueprint.generationKey, proposalRef: blueprint.proposalRef, skillLineage: blueprint.skillLineage, stage: "ready", status: "completed", createdAt, updatedAt: createdAt });
  store.saveResearchSet({ schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: blueprint.researchSetId, generationKey: blueprint.generationKey, proposalRef: blueprint.proposalRef, skillLineage: blueprint.skillLineage, status: "completed", batches: [], places: blueprint.places, events: [], sources: [], actionRequirements: [], createdAt, updatedAt: createdAt });
  store.saveTripBlueprint(blueprint);
  store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt }));
}

test("真实 HTTP SQLite 审阅生产、预览取消、原子确认、回执和重启撤销保留执行连续", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { workspaceMutationDigestInput } = await import("@c-assistant/core");
  const { registerBookingRoutes } = await import("./booking-routes.js");
  const directory = mkdtempSync(join(tmpdir(), "landi-booking-http-"));
  const file = join(directory, "test.sqlite");
  let store = new SqliteWorkspaceStore(file);
  let server = Fastify({ logger: false });
  const start = async () => {
    registerPlanManagementRoutes(server, { store, getMaps: () => maps, startActivePlanMonitoring() {} });
    registerBookingRoutes(server, { store });
    return server.listen({ port: 0, host: "127.0.0.1" });
  };
  let address = "";
  const http = async (method: string, path: string, payload?: unknown) => {
    const response = await fetch(`${address}${path}`, { method, ...(payload !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    prepareRelationshipHttpBlueprint(store);
    const execution = store.confirmPlan(store.getWorkspace().activePlan.id).activePlan;
    address = await start();
    const beforeImportPreview = store.getWorkspace();
    const preview = await http("POST", `/api/plans/${execution.id}/bookings/import-preview`, { content: "虚构测试预订 门票 2026-12-01", source: "pasted_text" });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(store.getWorkspace(), beforeImportPreview);
    const importContext = (await http("GET",`/api/plans/${execution.id}/booking-relationship-review`)).body;
    const importPayload = {
      requestId:randomUUID(),expectedVersion: execution.version,expectedBlueprintVersion:importContext.blueprintVersion,expectedSourceSetDigest:importContext.sourceSetDigest,
      booking: { type: "ticket", status: "needs_review", title: "虚构活动凭证", source: "user", sourceHash: "http-synthetic-source", sourceLabel: "旅行者测试声明", constraintStrength: "soft", segments: ["一", "二"].map(label => ({ segmentType: "event_window", title: `虚构分段${label}`, status: "needs_review", constraintStrength: "soft", fixedCommitment: false, needsReviewReasons: [] })) }
    };
    const imported = await http("POST", `/api/plans/${execution.id}/bookings/import-confirm`, importPayload);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    const importedId=imported.body.booking.id;
    const importReplay=await http("POST",`/api/plans/${execution.id}/bookings/import-confirm`,importPayload);assert.equal(importReplay.status,200,JSON.stringify(importReplay.body));assert.equal(importReplay.body.booking.id,importedId);
    let workspace = store.getWorkspace();
    assert.equal(workspace.executionPlan?.id, execution.id);
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(workspace.activePlan.id).length, 1);
    const contextResult = await http("GET", `/api/plans/${workspace.activePlan.id}/booking-relationship-review`);
    assert.equal(contextResult.status, 200);
    const context = contextResult.body;
    assert.equal(context.units.length, 2);
    const assessment = {
      schemaVersion: 1, blueprintId: context.blueprintId, blueprintVersion: context.blueprintVersion, universeDigest: context.universeDigest, status: "reviewed",
      units: context.units.map((unit: any, index: number) => ({ ...unit, coverage: "complete", rationale: "已逐项考虑直接、间接及跨日依赖", evidenceRefs: ["traveler-declaration"], relations: index ? [] : [{ id: "http-relation", scope: "occurrence", targets: [{ kind: "occurrence", dayId: "d", placeId: "a" }], role: "itinerary_context", operations: ["remove"], rationale: "该凭证需要复核地点安排", evidenceRefs: ["traveler-declaration"] }] })),
      decision: { source: "traveler", actorId: "local-traveler", decidedAt: "2026-11-01T00:00:00Z", rationale: "已核对全量行程及所有预订分段", evidenceRefs: ["traveler-declaration"], obligations: ["考虑直接、间接及跨日依赖"] }
    };
    const reviewRequest = { expectedVersion: workspace.activePlan.version, expectedBlueprintVersion: workspace.activeBlueprint!.version, requestId: randomUUID(), revisions: [{ kind: "review_booking_relationships", assessment,expectedSourceSetDigest:context.sourceSetDigest }] };
    const reviewed = await http("POST", `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`, reviewRequest);
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.deepEqual(reviewed.body.beforeIdentity,{planId:workspace.activePlan.id,planVersion:workspace.activePlan.version,blueprintId:workspace.activeBlueprint!.id,blueprintVersion:workspace.activeBlueprint!.version});
    const reviewOrigin = workspace.activePlan.id;
    workspace = store.getWorkspace();
    assert.equal(workspace.activeBlueprint!.bookingRelationshipAssessment!.decision.actorId, "local-traveler");
    assert.equal((await http("POST", `/api/plans/${reviewOrigin}/blueprint-revisions/direct`, reviewRequest)).status, 200);
    assert.equal((await http("POST", `/api/plans/${reviewOrigin}/blueprint-revisions/direct`, { ...reviewRequest, revisions: [{ ...reviewRequest.revisions[0], assessment: { ...assessment, universeDigest: "different" } }] })).status, 409);
    const noteContext=(await http("GET",`/api/plans/${workspace.activePlan.id}/booking-relationship-review`)).body;
    const noteSource=store.listCurrentTravelBookingSourcesForPlan(workspace.activePlan.id)[0]!;
    const notePayload={requestId:randomUUID(),expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:workspace.activeBlueprint!.version,expectedSourceSetDigest:noteContext.sourceSetDigest,expectedRecordDigest:noteContext.sourceRecords[0].recordDigest,booking:{...noteSource,notes:"虚构非结构补充说明"}};
    const noteSaved=await http("POST",`/api/plans/${workspace.activePlan.id}/bookings/import-confirm`,notePayload);assert.equal(noteSaved.status,200,JSON.stringify(noteSaved.body));
    assert.equal(store.getWorkspace().activeBlueprint!.version,workspace.activeBlueprint!.version);assert.equal(store.getWorkspace().activeBlueprint!.bookingRelationshipAssessment?.status,"reviewed");
    assert.equal((await http("POST",`/api/plans/${workspace.activePlan.id}/bookings/import-confirm`,{...notePayload,requestId:randomUUID(),booking:{...notePayload.booking,notes:"另一份并发非结构说明"}})).status,409);
    const beforePreview = store.getWorkspace();
    const edits = [{ kind: "remove_place_from_day", placeId: "a", dayId: "d" }];
    const editIdentity = { expectedVersion: workspace.activePlan.version, expectedBlueprintVersion: workspace.activeBlueprint!.version, requestId: randomUUID(), revisions: edits };
    const impact = await http("POST", `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`, editIdentity);
    assert.equal(impact.status, 409, JSON.stringify(impact.body));
    const {checkedBlueprintImpact}=await import(new URL("../../web/src/blueprint-impact-review.ts",import.meta.url).href);assert.ok(checkedBlueprintImpact(impact.body.impact,beforePreview.activeBlueprint,beforePreview.activePlan,edits));
    assert.equal(impact.body.impact.bookingImpact.affected.length, 1);
    assert.equal(impact.body.impact.bookingImpact.unaffected.length, 1);
    assert.equal(impact.body.impact.bookingImpact.unknown.length, 0);
    assert.deepEqual(store.getWorkspace(), beforePreview); // 返回草稿/取消没有后续写入。
    const confirmedRequest = { ...editIdentity, requestId: randomUUID(), highImpactConfirmation: impact.body.impact.id };
    const originPlanId = workspace.activePlan.id;
    const originalSave = store.saveTripBlueprint.bind(store);
    store.saveTripBlueprint = ((...args: Parameters<typeof store.saveTripBlueprint>) => { originalSave(...args); throw new Error("synthetic_atomic_failure"); }) as typeof store.saveTripBlueprint;
    const failed = await http("POST", `/api/plans/${originPlanId}/blueprint-revisions/direct`, confirmedRequest);
    assert.equal(failed.status, 500);
    assert.deepEqual(store.getWorkspace(), beforePreview);
    store.saveTripBlueprint = originalSave;
    const confirmed = await http("POST", `/api/plans/${originPlanId}/blueprint-revisions/direct`, confirmedRequest);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const revisionId = confirmed.body.revision.id;
    workspace = store.getWorkspace();
    assert.equal(workspace.activeBlueprint!.days[0]!.stops.some(stop => stop.placeId === "a"), false);
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(workspace.activePlan.id)[0]?.segments.length, 2);
    assert.equal(workspace.executionPlan?.id, execution.id);
    assert.equal((await http("POST", `/api/plans/${originPlanId}/blueprint-revisions/direct`, confirmedRequest)).status, 200);
    const requestDigest = createHash("sha256").update(workspaceMutationDigestInput("save", originPlanId, confirmedRequest)).digest("hex");
    const receiptQuery = new URLSearchParams({ operation: "save", expectedVersion: String(confirmedRequest.expectedVersion), expectedBlueprintVersion: String(confirmedRequest.expectedBlueprintVersion), requestDigest });
    await server.close(); store.close();
    store = new SqliteWorkspaceStore(file); server = Fastify({ logger: false }); address = await start();
    const importRestartReplay=await http("POST",`/api/plans/${execution.id}/bookings/import-confirm`,importPayload);assert.equal(importRestartReplay.status,200,JSON.stringify(importRestartReplay.body));assert.equal(importRestartReplay.body.booking.id,importedId);assert.equal(store.listCurrentTravelBookingSourcesForPlan(store.getWorkspace().activePlan.id).length,1);
    const receipt = await http("GET", `/api/plans/${originPlanId}/blueprint-revisions/receipts/${confirmedRequest.requestId}?${receiptQuery}`);
    assert.equal(receipt.status, 200, JSON.stringify(receipt.body)); assert.equal(receipt.body.status, "committed");
    workspace = store.getWorkspace();
    const undo = await http("POST", `/api/plans/${workspace.activePlan.id}/blueprint-revisions/${revisionId}/undo`, { expectedVersion: workspace.activePlan.version, expectedBlueprintVersion: workspace.activeBlueprint!.version, requestId: randomUUID() });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.equal(store.getWorkspace().activeBlueprint!.days[0]!.stops.some(stop => stop.placeId === "a"), true);
    assert.equal(store.getWorkspace().activeBlueprint!.bookingRelationshipAssessment?.status, "reviewed");
    assert.equal(store.getExecutionPlan()?.id, execution.id);
    const current = store.getWorkspace();
    const sourceContext = (await http("GET",`/api/plans/${current.activePlan.id}/booking-relationship-review`)).body;
    const actualSource = store.listCurrentTravelBookingSourcesForPlan(current.activePlan.id)[0]!;
    const changedSource = { ...actualSource, notes:"虚构非结构资料",segments:actualSource.segments.map((segment,index)=>index?segment:{...segment,status:"cancelled"}) };
    const correction = {requestId:randomUUID(),expectedVersion:current.activePlan.version,expectedBlueprintVersion:current.activeBlueprint!.version,expectedSourceSetDigest:sourceContext.sourceSetDigest,expectedRecordDigest:sourceContext.sourceRecords[0].recordDigest,booking:changedSource};
    const sourceCorrected = await http("POST",`/api/plans/${current.activePlan.id}/bookings/import-confirm`,correction);
    assert.equal(sourceCorrected.status,200,JSON.stringify(sourceCorrected.body));
    const corrected = store.getWorkspace();
    assert.equal(corrected.activeBlueprint!.bookingRelationshipAssessment?.status,"invalidated");
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(corrected.activePlan.id)[0]!.planId,execution.id);
    assert.equal(store.getExecutionPlan()?.id,execution.id);
    assert.deepEqual(store.listApprovedBookingConstraintsForPlan(execution.id),[]);
    assert.equal((await http("POST",`/api/plans/${current.activePlan.id}/bookings/import-confirm`,correction)).status,200);
    assert.equal(store.getWorkspace().activeBlueprint!.version,corrected.activeBlueprint!.version);
    assert.equal((await http("POST",`/api/plans/${current.activePlan.id}/bookings/import-confirm`,{...correction,booking:{...changedSource,title:"异载荷"}})).status,409);
    const receiptDigest=(await import("@c-assistant/core")).bookingRelationshipDigest({scope:current.activePlan.id,body:correction});
    const correctionIdentity={operation:"import_booking",targetKind:"plan",targetId:current.activePlan.id,expectedVersion:correction.expectedVersion,expectedBlueprintVersion:correction.expectedBlueprintVersion,expectedSourceSetDigest:correction.expectedSourceSetDigest,expectedRecordDigest:correction.expectedRecordDigest,bookingId:changedSource.id};
    const bookingReceiptQuery=new URLSearchParams({requestDigest:receiptDigest,identity:JSON.stringify(correctionIdentity)});
    const correctionReceipt=await http("GET",`/api/booking-mutations/receipts/${correction.requestId}?${bookingReceiptQuery}`);assert.equal(correctionReceipt.body.status,"committed");assert.deepEqual(correctionReceipt.body.originalResult.beforeIdentity,{planId:current.activePlan.id,planVersion:current.activePlan.version,blueprintId:current.activeBlueprint!.id,blueprintVersion:current.activeBlueprint!.version});
    const wrongScope=new URLSearchParams({requestDigest:receiptDigest,identity:JSON.stringify({...correctionIdentity,targetId:execution.id})});
    assert.equal((await http("GET",`/api/booking-mutations/receipts/${correction.requestId}?${wrongScope}`)).status,409);
    const staleUndo = await http("POST",`/api/plans/${current.activePlan.id}/blueprint-revisions/${revisionId}/undo`,{expectedVersion:current.activePlan.version,expectedBlueprintVersion:current.activeBlueprint!.version,requestId:randomUUID()});
    assert.equal(staleUndo.status,409);
    await server.close();store.close();store=new SqliteWorkspaceStore(file);server=Fastify({logger:false});address=await start();
    const restartedReplay=await http("POST",`/api/plans/${current.activePlan.id}/bookings/import-confirm`,correction);
    assert.equal(restartedReplay.status,200,JSON.stringify(restartedReplay.body));assert.equal(restartedReplay.body.originalResult.planId,corrected.activePlan.id);
    assert.equal(store.getWorkspace().activeBlueprint!.version,corrected.activeBlueprint!.version);
  } finally { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("关系审阅 API 不接受自称 Agent 身份且旅客请求保持原请求幂等", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const server = Fastify({ logger: false });
  try {
    prepareRelationshipHttpBlueprint(store);
    registerPlanManagementRoutes(server, { store, getMaps: () => maps, startActivePlanMonitoring() {} });
    const workspace = store.getWorkspace();
    const context = (await server.inject({ method: "GET", url: `/api/plans/${workspace.activePlan.id}/booking-relationship-review` })).json();
    const recoveryBinding={schemaVersion:1,draftDigest:"a".repeat(64),seedDigest:"b".repeat(64)};
    const payload = { expectedVersion: workspace.activePlan.version, expectedBlueprintVersion: workspace.activeBlueprint!.version, requestId: randomUUID(), recoveryBinding,revisions: [{ kind: "review_booking_relationships",expectedSourceSetDigest:context.sourceSetDigest, assessment: { schemaVersion: 1, blueprintId: context.blueprintId, blueprintVersion: context.blueprintVersion, universeDigest: context.universeDigest, units: [], status: "reviewed", decision: { source: "agent", actorId: "forged-agent", model: "forged-model", decidedAt: "2026-11-01T00:00:00Z", rationale: "测试完整审阅", evidenceRefs: ["traveler-declaration"], obligations: ["考虑全部直接和间接依赖"] } } }] };
    const rejected = await server.inject({ method: "POST", url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`, payload });
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.deepEqual(store.getWorkspace(), workspace);
    payload.revisions[0]!.assessment.decision.source = "traveler";
    const invalidActor = { ...payload.revisions[0]!.assessment.decision } as { [key: string]: unknown }; delete invalidActor.model;
    for (const decision of [payload.revisions[0]!.assessment.decision, { ...payload.revisions[0]!.assessment.decision, actorId: "local-traveler" }, invalidActor]) {
      const invalid = await server.inject({ method: "POST", url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`, payload: { ...payload, revisions: [{ ...payload.revisions[0], assessment: { ...payload.revisions[0]!.assessment, decision } }] } });
      assert.equal(invalid.statusCode, 400, invalid.body);
    }
    payload.revisions[0]!.assessment.decision.actorId = "local-traveler";
    delete (payload.revisions[0]!.assessment.decision as {model?:string}).model;
    const saved = await server.inject({ method: "POST", url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`, payload });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().workspace.activeBlueprint.bookingRelationshipAssessment.decision.actorId, "local-traveler");
    assert.equal(saved.json().workspace.activeBlueprint.bookingRelationshipAssessment.decision.model, undefined);
    assert.deepEqual(saved.json().originalResult.recoveryBinding,recoveryBinding);
    const replay = await server.inject({ method: "POST", url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().revision.id, saved.json().revision.id);
    const changedBinding=await server.inject({method:"POST",url:`/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,payload:{...payload,recoveryBinding:{...recoveryBinding,draftDigest:"c".repeat(64)}}});assert.equal(changedBinding.statusCode,409);
    const { createHash } = await import("node:crypto");
    const { workspaceMutationDigestInput } = await import("@c-assistant/core");
    const requestDigest = createHash("sha256").update(workspaceMutationDigestInput("save", workspace.activePlan.id, payload)).digest("hex");
    const query = new URLSearchParams({ operation: "save", expectedVersion: String(payload.expectedVersion), expectedBlueprintVersion: String(payload.expectedBlueprintVersion), requestDigest });
    const receipt = await server.inject({ method: "GET", url: `/api/plans/${workspace.activePlan.id}/blueprint-revisions/receipts/${payload.requestId}?${query}` });
    assert.equal(receipt.statusCode, 200, receipt.body); assert.equal(receipt.json().status, "committed");
    assert.deepEqual(receipt.json().originalResult.recoveryBinding,recoveryBinding);
  } finally { await server.close(); store.close(); }
});

test("旧无映射预订经真实 API 先选择来源再独立审阅，跨旅行来源不能借用",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");const server=Fastify({logger:false});
  try{
    prepareRelationshipHttpBlueprint(store,blueprint=>{
      store.saveTravelBooking({id:"legacy-source",planningSessionId:blueprint.proposalRef.sessionId,type:"ticket",status:"needs_review",title:"虚构历史凭证",source:"user",sourceHash:"legacy-synthetic",sourceLabel:"旅行者测试声明",importedAt:blueprint.createdAt,updatedAt:blueprint.createdAt,constraintStrength:"soft",segments:[{id:"legacy-segment",segmentType:"event_window",title:"虚构历史分段",status:"needs_review",constraintStrength:"soft",fixedCommitment:false,needsReviewReasons:[]}]});
      blueprint.bookingConstraints=[{id:"old-constraint",type:"ticket",title:"历史约束",status:"needs_review",sourceLabel:"历史测试",importedAt:blueprint.createdAt,constraintStrength:"soft",segments:[]}];
    });
    registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});
    const before=store.getWorkspace();
    const context=(await server.inject({method:"GET",url:`/api/plans/${before.activePlan.id}/booking-relationship-review`})).json();
    assert.ok(context.sourceIssues.length);assert.equal(context.sourceCandidates[0].bookingId,"legacy-source");
    assert.equal(JSON.stringify(context).includes("legacy-synthetic"),false);
    const selection={expectedVersion:before.activePlan.version,expectedBlueprintVersion:before.activeBlueprint!.version,requestId:randomUUID(),revisions:[{kind:"select_booking_sources",sourceBookingIds:["legacy-source"],expectedSourceSetDigest:context.sourceSetDigest}]};
    const bad=await server.inject({method:"POST",url:`/api/plans/${before.activePlan.id}/blueprint-revisions/direct`,payload:{...selection,requestId:randomUUID(),revisions:[{...selection.revisions[0],sourceBookingIds:["other-trip-source"]}]}});
    assert.equal(bad.statusCode,400,bad.body);assert.deepEqual(store.getWorkspace(),before);
    const selected=await server.inject({method:"POST",url:`/api/plans/${before.activePlan.id}/blueprint-revisions/direct`,payload:selection});
    assert.equal(selected.statusCode,200,selected.body);
    const workspace=store.getWorkspace();assert.equal(workspace.activeBlueprint!.version,2);assert.equal(workspace.activeBlueprint!.bookingRelationshipAssessment,undefined);
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(workspace.activePlan.id)[0]?.planningSessionId,before.activeBlueprint!.proposalRef.sessionId);
    assert.deepEqual(store.getTripBlueprint(before.activeBlueprint!.id,1),before.activeBlueprint);
    const next=(await server.inject({method:"GET",url:`/api/plans/${workspace.activePlan.id}/booking-relationship-review`})).json();
    const assessment={schemaVersion:1,blueprintId:next.blueprintId,blueprintVersion:next.blueprintVersion,universeDigest:next.universeDigest,status:"reviewed",units:next.units.map((unit:any)=>({...unit,coverage:"complete",relations:[],rationale:"逐项核对直接、间接和跨日关系后明确无关联",evidenceRefs:["traveler-declaration"]})),decision:{source:"traveler",actorId:"local-traveler",decidedAt:"2026-11-01T00:00:00Z",rationale:"完整核对所有来源与目标",evidenceRefs:["traveler-declaration"],obligations:["考虑直接、间接和跨日依赖"]}};
    const reviewed=await server.inject({method:"POST",url:`/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,payload:{expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:2,requestId:randomUUID(),revisions:[{kind:"review_booking_relationships",expectedSourceSetDigest:next.sourceSetDigest,assessment}]}});
    assert.equal(reviewed.statusCode,200,reviewed.body);assert.equal(store.getWorkspace().activeBlueprint!.bookingRelationshipAssessment?.status,"reviewed");
    assert.equal(store.listTravelBookingsForPlanningSession(before.activeBlueprint!.proposalRef.sessionId).length,1);
  }finally{await server.close();store.close();}
});

test("源更正持久保存未决候选，旧执行快照与邮件批准事实不被替换草稿覆盖",async()=>{
  const {blueprintBookingConstraintsFromTravelBookings}=await import("@c-assistant/core");
  const {registerBookingRoutes}=await import("./booking-routes.js");
  const {createEmailAttentionMonitor}=await import("./email-attention-monitor.js");
  const {createEmailContentBuilder}=await import("./email-content.js");
  const {verifiedEmailFixture}=await import("./email.fixture.test.js");
  const store=new SqliteWorkspaceStore(":memory:");const server=Fastify({logger:false});
  try{
    prepareRelationshipHttpBlueprint(store,blueprint=>{
      const booking:import("@c-assistant/core").TravelBooking={id:"approved-source",planningSessionId:blueprint.proposalRef.sessionId,type:"ticket",status:"confirmed",title:"虚构批准凭证",source:"user",sourceHash:"approved-synthetic",sourceLabel:"旅行者测试声明",importedAt:blueprint.createdAt,updatedAt:blueprint.createdAt,constraintStrength:"soft",segments:[{id:"approved-segment",segmentType:"event_window",title:"虚构批准分段",status:"confirmed",startAtLocal:"2026-12-01T10:00",startTimeZone:"UTC",constraintStrength:"soft",fixedCommitment:false,needsReviewReasons:[]}]};
      store.saveTravelBooking(booking);blueprint.bookingConstraints=blueprintBookingConstraintsFromTravelBookings([booking]);
    });
    const execution=store.confirmPlan(store.getWorkspace().activePlan.id).activePlan;verifiedEmailFixture(store);
    registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});registerBookingRoutes(server,{store});
    const connectors={maps:{},googleWeather:{weather:async()=>({status:"unavailable"})}} as unknown as import("./connector-bundle.js").ConnectorBundle;
    let instant=new Date("2026-11-30T08:00:00Z");const now=()=>instant;const zones=new Map([["虚构海湾","UTC"]]);
    const monitor=createEmailAttentionMonitor({store,getConnectors:()=>connectors,now});
    await monitor.run("journey",zones);assert.equal(store.email.list().length,0);
    const context=store.getBookingRelationshipReviewContext(execution.id);const source=store.listCurrentTravelBookingSourcesForPlan(execution.id)[0]!;
    const payload={requestId:randomUUID(),expectedVersion:execution.version,expectedBlueprintVersion:context.blueprintVersion,expectedSourceSetDigest:context.sourceSetDigest,expectedRecordDigest:context.sourceRecords[0]!.recordDigest,booking:{...source,segments:source.segments.map(segment=>({...segment,startAtLocal:"2026-12-01T12:00"}))}};
    const changed=await server.inject({method:"POST",url:`/api/plans/${execution.id}/bookings/import-confirm`,payload});assert.equal(changed.statusCode,200,changed.body);
    assert.equal(store.getExecutionPlan()?.id,execution.id);assert.equal(store.listApprovedBookingConstraintsForPlan(execution.id)[0]!.segments[0]!.startAtLocal,"2026-12-01T10:00");
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(execution.id)[0]!.segments[0]!.startAtLocal,"2026-12-01T12:00");
    instant=new Date("2026-11-30T08:06:00Z");await monitor.run("journey",zones);
    const jobs=store.email.list().filter(job=>job.kind==="change");assert.equal(jobs.length,0);
    const observations=store.listTravelAdjustmentObservations(execution.id,execution.version);
    const saved=observations.find(item=>item.observation.key==="booking:approved-source:approved-segment")!;
    assert.ok(saved);assert.equal(saved.observation.status,"unknown");assert.equal(saved.lastReliable,null);
    assert.equal(saved.observation.candidate?.kind,"saved_booking");
    if(saved.observation.candidate?.kind==="saved_booking")assert.equal(saved.observation.candidate.startAtLocal,"2026-12-01T12:00");
    assert.ok(saved.observation.sourceRevision);assert.match(saved.observation.reason,/非实时供应商核实/);
    await monitor.run("journey",zones);
    assert.equal(store.email.list().filter(job=>job.kind==="change").length,0);
    assert.deepEqual(store.listTravelAdjustmentObservations(execution.id,execution.version),observations);
    const rendered=await createEmailContentBuilder({store,getConnectors:()=>connectors,now})(execution,{id:"synthetic-morning",planId:execution.id,planVersion:execution.version,recipientRevision:store.email.settings().revision,kind:"morning",date:"2026-12-01",dueAt:now().toISOString(),status:"pending",attempts:0,retryAt:now().toISOString()} as import("@c-assistant/storage").EmailJob);
    assert.match(rendered.text,/Verify the change with your booking provider before reviewing your itinerary/);assert.doesNotMatch(rendered.text,/Confirmed bookings are recorded/);
    assert.equal(store.listApprovedBookingConstraintsForPlan(store.getWorkspace().activePlan.id)[0]!.segments[0]!.startAtLocal,"2026-12-01T12:00");
    assert.deepEqual(store.getExecutionPlan(),execution);
  }finally{await server.close();store.close();}
});

test("真实 HTTP 预订确认在每个持久边界失败全部回滚",async()=>{
  const {mkdtempSync,rmSync}=await import("node:fs");const {tmpdir}=await import("node:os");const {join}=await import("node:path");const {DatabaseSync}=await import("node:sqlite");const {registerBookingRoutes}=await import("./booking-routes.js");
  const directory=mkdtempSync(join(tmpdir(),"landi-booking-atomic-http-"));const file=join(directory,"isolated.sqlite");const store=new SqliteWorkspaceStore(file);const server=Fastify({logger:false});let database:InstanceType<typeof DatabaseSync>|undefined;
  try{
    prepareRelationshipHttpBlueprint(store);registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});registerBookingRoutes(server,{store});const address=await server.listen({port:0,host:"127.0.0.1"});
    const before=store.getWorkspace();const context=store.getBookingRelationshipReviewContext(before.activePlan.id);
    const payload={requestId:randomUUID(),expectedVersion:before.activePlan.version,expectedBlueprintVersion:context.blueprintVersion,expectedSourceSetDigest:context.sourceSetDigest,booking:{id:"atomic-source",type:"ticket",status:"needs_review",title:"虚构原子凭证",source:"user",sourceHash:"atomic-synthetic",sourceLabel:"旅行者测试声明",importedAt:"2026-11-01T00:00:00Z",updatedAt:"2026-11-01T00:00:00Z",constraintStrength:"soft",segments:[]},sourceContent:"虚构隔离保护材料"};
    database=new DatabaseSync(file);
    for(const table of ["travel_bookings","protected_booking_attachments","trip_blueprints","plans","plan_blueprint_lineage","booking_mutation_receipts"]){
      database.exec(`CREATE TRIGGER isolated_booking_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'隔离预订保存失败'); END`);
      const response=await fetch(`${address}/api/plans/${before.activePlan.id}/bookings/import-confirm`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});assert.equal(response.status,500,`${table}: ${await response.text()}`);
      assert.deepEqual(store.getWorkspace(),before);assert.equal(store.listCurrentTravelBookingSourcesForPlan(before.activePlan.id).length,0);assert.equal(store.countProtectedBookingAttachments("atomic-source"),0);assert.equal(database.prepare("SELECT COUNT(*) AS value FROM booking_mutation_receipts").get()!.value,0);
      database.exec("DROP TRIGGER isolated_booking_failure");
    }
    const response=await fetch(`${address}/api/plans/${before.activePlan.id}/bookings/import-confirm`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});assert.equal(response.status,200,await response.text());assert.equal(store.countProtectedBookingAttachments("atomic-source"),1);assert.equal(store.getWorkspace().activeBlueprint!.version,2);
  }finally{database?.close();await server.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test("真实旧投影的两预订全部分段经真实HTTP明确绑定，固定差异拒绝且独立审阅可恢复",async()=>{
  const {readFileSync,mkdtempSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
  const fixture=JSON.parse(readFileSync(new URL("../../../packages/storage/test-fixtures/booking-source-old-projection.json",import.meta.url),"utf8")) as {sources:import("@c-assistant/core").TravelBooking[];constraints:NonNullable<TripBlueprint["bookingConstraints"]>};
  const directory=mkdtempSync(join(tmpdir(),"landi-fixed-old-http-")),file=join(directory,"isolated.sqlite");let store=new SqliteWorkspaceStore(file),server=Fastify({logger:false});
  try{
    prepareRelationshipHttpBlueprint(store,blueprint=>{blueprint.bookingConstraints=structuredClone(fixture.constraints);for(const source of fixture.sources)store.saveTravelBooking({...source,planningSessionId:blueprint.proposalRef.sessionId});});
    registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});const address=await server.listen({port:0,host:"127.0.0.1"});
    const http=async(path:string,payload?:unknown)=>{const response=await fetch(address+path,payload===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});return {status:response.status,body:await response.json()};};
    const before=store.getWorkspace(),path=`/api/plans/${before.activePlan.id}/blueprint-revisions/direct`,context=(await http(`/api/plans/${before.activePlan.id}/booking-relationship-review`)).body;
    const bindings=[{bookingConstraintId:"booking-虚构旧住宿源",sourceBookingId:"虚构旧住宿源",segments:[{segmentId:"segment-虚构住宿段",sourceSegmentId:"虚构住宿段"},{segmentId:"segment-虚构行李段",sourceSegmentId:"虚构行李段"}],rationale:"本人逐分段明确恢复原住宿与行李资料",evidenceRefs:["traveler-declaration"]},{bookingConstraintId:"booking-虚构旧车辆源",sourceBookingId:"虚构旧车辆源",segments:[{segmentId:"segment-虚构取车段",sourceSegmentId:"虚构取车段"},{segmentId:"segment-虚构还车段",sourceSegmentId:"虚构还车段"}],rationale:"本人逐分段明确恢复原取还车资料",evidenceRefs:["traveler-declaration"]}];
    const revision={kind:"select_booking_sources",sourceBookingIds:["虚构旧住宿源","虚构旧车辆源"],expectedSourceSetDigest:context.sourceSetDigest,legacyBindings:bindings};
    const payload={expectedVersion:before.activePlan.version,expectedBlueprintVersion:before.activeBlueprint!.version,requestId:randomUUID(),revisions:[revision]};
    for(const changed of [[],[{...bindings[0],segments:bindings[0]!.segments.slice(0,1)},bindings[1]],[bindings[0],{...bindings[1],segments:bindings[1]!.segments.slice(0,1)}],[bindings[0],{...bindings[1],sourceBookingId:bindings[0]!.sourceBookingId}],[{...bindings[0],segments:[bindings[0]!.segments[1],bindings[0]!.segments[1]]},bindings[1]]]){
      const rejected=await http(path,{...payload,requestId:randomUUID(),revisions:[{...revision,legacyBindings:changed}]});assert.ok([400,409].includes(rejected.status),JSON.stringify(rejected.body));assert.deepEqual(store.getWorkspace(),before);
    }
    const stale=await http(path,{...payload,requestId:randomUUID(),revisions:[{...revision,expectedSourceSetDigest:"a".repeat(64)}]});assert.equal(stale.status,409);
    const accepted=await http(path,payload);assert.equal(accepted.status,200,JSON.stringify(accepted.body));assert.deepEqual(accepted.body.beforeIdentity,{planId:before.activePlan.id,planVersion:before.activePlan.version,blueprintId:before.activeBlueprint!.id,blueprintVersion:1});
    assert.deepEqual(accepted.body.revision.sourceSelectionAudit.legacyBindings,bindings);assert.equal(accepted.body.revision.sourceSelectionAudit.decision.actorId,"local-traveler");
    const replay=await http(path,payload);assert.equal(replay.status,200);assert.equal(replay.body.originalResult.planId,accepted.body.originalResult.planId);
    const changed=structuredClone(payload);changed.revisions[0]!.legacyBindings[0]!.rationale="同身份另一明确理由";assert.equal((await http(path,changed)).status,409);
    let current=store.getWorkspace();const next=(await http(`/api/plans/${current.activePlan.id}/booking-relationship-review`)).body;assert.equal(next.sourceIssues.length,0);assert.equal(next.units.length,4);assert.equal(next.sourceCandidates[1].segments.length,2);
    const assessment={schemaVersion:1,blueprintId:next.blueprintId,blueprintVersion:next.blueprintVersion,universeDigest:next.universeDigest,status:"reviewed",units:next.units.map((unit:Record<string,unknown>)=>({...unit,coverage:"complete",relations:[],rationale:"完整核对直接间接及跨日依赖后明确无关联",evidenceRefs:["traveler-declaration"]})),decision:{source:"traveler",actorId:"local-traveler",decidedAt:"2026-11-01T00:00:00Z",rationale:"本人完整核对所有来源与目标",evidenceRefs:["traveler-declaration"],obligations:["考虑全部直接间接及跨日依赖"]}};
    const reviewed=await http(`/api/plans/${current.activePlan.id}/blueprint-revisions/direct`,{expectedVersion:current.activePlan.version,expectedBlueprintVersion:current.activeBlueprint!.version,requestId:randomUUID(),revisions:[{kind:"review_booking_relationships",assessment,expectedSourceSetDigest:next.sourceSetDigest}]});assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
    current=store.getWorkspace();assert.equal(current.activeBlueprint!.bookingConstraints![1]!.segments[1]!.constraintStrength,"ignored");assert.deepEqual(store.getTripBlueprint(before.activeBlueprint!.id,1),before.activeBlueprint);
    await server.close();store.close();store=new SqliteWorkspaceStore(file);server=Fastify({logger:false});assert.equal(store.getWorkspace().activeBlueprint!.bookingRelationshipAssessment!.status,"reviewed");assert.equal(store.listTravelBookingsForPlanningSession(before.activeBlueprint!.proposalRef.sessionId).length,2);
  }finally{await server.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test("旧固定来源缺映射时不能通过选择无关软预订消除固定承诺",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");const server=Fastify({logger:false});
  try{
    prepareRelationshipHttpBlueprint(store,blueprint=>{
      store.saveTravelBooking({id:"unrelated-soft-source",planningSessionId:blueprint.proposalRef.sessionId,type:"ticket",status:"needs_review",title:"虚构无关软凭证",source:"user",sourceHash:"unrelated-synthetic",sourceLabel:"旅行者测试声明",importedAt:blueprint.createdAt,updatedAt:blueprint.createdAt,constraintStrength:"soft",segments:[]});
      blueprint.bookingConstraints=[{id:"legacy-fixed",type:"ticket",title:"虚构固定凭证",status:"confirmed",sourceLabel:"历史测试",importedAt:blueprint.createdAt,constraintStrength:"hard",segments:[{id:"legacy-fixed-segment",segmentType:"event_window",title:"虚构固定分段",status:"confirmed",startAtLocal:"2026-12-01T10:00",startTimeZone:"UTC",location:"虚构固定场馆",constraintStrength:"hard",fixedCommitment:true,needsReviewReasons:[]}]}];
    });
    registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});
    const before=store.getWorkspace();const context=store.getBookingRelationshipReviewContext(before.activePlan.id);
    const response=await server.inject({method:"POST",url:`/api/plans/${before.activePlan.id}/blueprint-revisions/direct`,payload:{expectedVersion:before.activePlan.version,expectedBlueprintVersion:before.activeBlueprint!.version,requestId:randomUUID(),revisions:[{kind:"select_booking_sources",sourceBookingIds:["unrelated-soft-source"],expectedSourceSetDigest:context.sourceSetDigest}]}});
    assert.equal(response.statusCode,409,response.body);assert.deepEqual(store.getWorkspace(),before);
  }finally{await server.close();store.close();}
});

test("真实 HTTP 优先级跨日投影与未排程全局确认闭环", async () => {
  const {mkdtempSync,rmSync} = await import("node:fs");
  const {tmpdir} = await import("node:os");
  const {join} = await import("node:path");
  const {blueprintBookingConstraintsFromTravelBookings} = await import("@c-assistant/core");
  const {checkedBlueprintImpact} = await import(new URL("../../web/src/blueprint-impact-review.ts",import.meta.url).href);
  const directory = mkdtempSync(join(tmpdir(),"landi-priority-http-"));
  const store = new SqliteWorkspaceStore(join(directory,"workspace.sqlite"));
  const server = Fastify({logger:false});
  const source = (id:string,owner:{planningSessionId:string}|{planId:string}) => ({id,...owner,type:"ticket" as const,status:"pending" as const,title:"虚构软双分段凭证",source:"user" as const,sourceHash:`fictional-${id}`,sourceLabel:"虚构旅行者声明",importedAt:"2026-11-01T00:00:00Z",updatedAt:"2026-11-01T00:00:00Z",constraintStrength:"soft" as const,segments:["一","二"].map(label=>({id:`${id}-${label}`,segmentType:"event_window" as const,title:`虚构分段${label}`,status:"pending" as const,constraintStrength:"soft" as const,fixedCommitment:false,needsReviewReasons:[]}))});
  try {
    prepareRelationshipHttpBlueprint(store,blueprint=>{
      const record = source("已采用软源",{planningSessionId:blueprint.proposalRef.sessionId});
      store.saveTravelBooking(record);
      blueprint.bookingConstraints = blueprintBookingConstraintsFromTravelBookings([record]);
      blueprint.endDate = "2026-12-03";
      blueprint.movements = [];
      blueprint.places.push(...["g","k"].map(id=>({...structuredClone(blueprint.places[1]!),id,name:id==="g"?"全局软候选":"明确无关候选"})));
      blueprint.days[0]!.stops = [{placeId:"a",order:1}];
      blueprint.days[0]!.blocks = [{id:"首次",kind:"stop",order:1,placeId:"a",evidence:[]},{id:"再次",kind:"stop",order:2,placeId:"a",evidence:[]}];
      blueprint.days.push(
        {...structuredClone(blueprint.days[0]!),id:"d2",date:"2026-12-02",stops:[{placeId:"b",order:1}],blocks:[{id:"无关日",kind:"stop",order:1,placeId:"b",evidence:[]}]},
        {...structuredClone(blueprint.days[0]!),id:"d3",date:"2026-12-03",blocks:[{id:"跨日出现",kind:"stop",order:1,placeId:"a",evidence:[]}]}
      );
    });
    registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});
    const address = await server.listen({port:0,host:"127.0.0.1"});
    const http = async(method:string,path:string,payload?:unknown)=>{const response=await fetch(`${address}${path}`,{method,...(payload===undefined?{}:{headers:{"content-type":"application/json"},body:JSON.stringify(payload)})});return {status:response.status,body:await response.json() as any};};
    const save = async(revisions:unknown[],token?:string)=>{const workspace=store.getWorkspace();return http("POST",`/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,{requestId:randomUUID(),expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:workspace.activeBlueprint!.version,revisions,...(token?{highImpactConfirmation:token}:{})});};
    const priority = [{kind:"update_place_priority",placeId:"a",priority:"preferred"}];
    const unknown = await save(priority);
    assert.equal(unknown.status,409,JSON.stringify(unknown.body));
    assert.deepEqual(unknown.body.impact.dayIds,["d","d3"]);assert.deepEqual(unknown.body.impact.dates,["2026-12-01","2026-12-03"]);assert.equal(unknown.body.impact.bookingImpact.canConfirm,false);
    assert.ok(checkedBlueprintImpact(unknown.body.impact,store.getWorkspace().activeBlueprint,store.getWorkspace().activePlan,priority));
    const globalRevision = [{kind:"update_place_priority",placeId:"g",priority:"must"}];
    let workspace = store.getWorkspace();
    const review = async()=>{
      workspace=store.getWorkspace();
      const current=(await http("GET",`/api/plans/${workspace.activePlan.id}/booking-relationship-review`)).body;
      const assessment={schemaVersion:1,blueprintId:current.blueprintId,blueprintVersion:current.blueprintVersion,universeDigest:current.universeDigest,status:"reviewed",units:current.units.map((unit:any,index:number)=>({...unit,coverage:"complete",rationale:"逐项核对全部直接、间接及跨日依赖；候选k明确无关",evidenceRefs:["traveler-declaration"],relations:index?[]:["a","g"].map(placeId=>({id:`全局-${placeId}`,scope:"place_global",targets:[{kind:"place_global",placeId}],role:"itinerary_context",operations:["priority"],rationale:"本人明确此整体优先级与软凭证关联",evidenceRefs:["traveler-declaration"]}))})),decision:{source:"traveler",actorId:"local-traveler",decidedAt:"2026-11-01T00:00:00Z",rationale:"完整核对所有来源与目标",evidenceRefs:["traveler-declaration"],obligations:["考虑全部直接、间接和跨日依赖"]}};
      const result=await save([{kind:"review_booking_relationships",expectedSourceSetDigest:current.sourceSetDigest,assessment}]);
      assert.equal(result.status,200,JSON.stringify(result.body));
    };
    await review();
    const safe=await save([{kind:"update_place_priority",placeId:"k",priority:"archive"}]);
    assert.equal(safe.status,200,JSON.stringify(safe.body));
    assert.equal(store.getWorkspace().activeBlueprint!.places.find(place=>place.id==="k")!.priority,"archive");
    await review();
    const global=await save(globalRevision);
    assert.equal(global.status,409,JSON.stringify(global.body));assert.deepEqual(global.body.impact.dates,[]);assert.deepEqual(global.body.impact.dayIds,[]);assert.equal(global.body.impact.bookingImpact.canConfirm,true);assert.equal(global.body.impact.bookingImpact.affected.length,1);
    assert.ok(checkedBlueprintImpact(global.body.impact,store.getWorkspace().activeBlueprint,store.getWorkspace().activePlan,globalRevision));
    const wrongBatch=await save(priority,global.body.impact.id);assert.equal(wrongBatch.status,409);
    const confirmed=await save(globalRevision,global.body.impact.id);assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
    assert.equal(store.getWorkspace().activeBlueprint!.places.find(place=>place.id==="g")!.priority,"must");
    await review();
    const scheduled=await save(priority);assert.equal(scheduled.status,409,JSON.stringify(scheduled.body));assert.deepEqual(scheduled.body.impact.dayIds,["d","d3"]);
    const mixed=[...priority,{kind:"remove_place_from_day",placeId:"b",dayId:"d2"}];
    const mixedPreview=await save(mixed);assert.equal(mixedPreview.status,409,JSON.stringify(mixedPreview.body));assert.deepEqual(mixedPreview.body.impact.dayIds,["d","d2","d3"]);
    assert.equal((await save(mixed,scheduled.body.impact.id)).status,409);
    const scheduledSaved=await save(priority,scheduled.body.impact.id);assert.equal(scheduledSaved.status,200,JSON.stringify(scheduledSaved.body));assert.deepEqual(scheduledSaved.body.revision.affectedDayIds,["d","d3"]);
    assert.equal((await save([{kind:"update_place_priority",placeId:"a",priority:"must"}],scheduled.body.impact.id)).status,409);
  } finally {await server.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test("真实 HTTP 优先级待采用来源保持未知且准确区分有无排程日期", async () => {
  const {mkdtempSync,rmSync} = await import("node:fs");
  const {tmpdir} = await import("node:os");
  const {join} = await import("node:path");
  const {initializeWorkspaceFixture} = await import(new URL("../../../tests/browser/isolated-workspace-fixture.mjs",import.meta.url).href);
  const {checkedBlueprintImpact} = await import(new URL("../../web/src/blueprint-impact-review.ts",import.meta.url).href);
  const directory=mkdtempSync(join(tmpdir(),"landi-priority-pending-http-"));
  const file=join(directory,"workspace.sqlite");
  initializeWorkspaceFixture(file,{scenario:"empty-source-snapshot"});
  const store=new SqliteWorkspaceStore(file);const server=Fastify({logger:false});
  try {
    registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});
    const address=await server.listen({port:0,host:"127.0.0.1"});
    const workspace=store.getWorkspace();
    for(const [placeId,dayIds,dates] of [["fixture-place-2",["fixture-day-1","fixture-day-2"],["2026-12-01","2026-12-02"]],["fixture-place-7",[],[]]] as const) {
      const revisions=[{kind:"update_place_priority",placeId,priority:"must"}];
      const response=await fetch(`${address}/api/plans/${workspace.activePlan.id}/blueprint-revisions/direct`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:randomUUID(),expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:workspace.activeBlueprint!.version,revisions})});
      const body=await response.json() as any;
      assert.equal(response.status,409,JSON.stringify(body));assert.deepEqual(body.impact.dayIds,dayIds);assert.deepEqual(body.impact.dates,dates);assert.equal(body.impact.bookingImpact.canConfirm,false);
      assert.deepEqual(body.impact.sourceContext.pendingSources.map((item:any)=>item.sourceBookingId).sort(),["fixture-source-fixed","fixture-source-soft"]);
      assert.equal(body.impact.bookingImpact.unknown.filter((item:any)=>item.kind==="source_obligation").length,2);
      assert.ok(checkedBlueprintImpact(body.impact,workspace.activeBlueprint,workspace.activePlan,revisions));
    }
    assert.deepEqual(store.getWorkspace(),workspace);
  }finally{await server.close();store.close();rmSync(directory,{recursive:true,force:true});}
});


test("真实HTTP撤销恢复软目标且保留无关硬承诺，变源与命中硬承诺拒绝并事务不写",async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {DatabaseSync}=await import('node:sqlite');
  const {blueprintBookingConstraintsFromTravelBookings}=await import('@c-assistant/core');
  for(const scenario of ['safe','changed','fixed']) {
    const directory=mkdtempSync(join(tmpdir(),'landi-undo-fixed-http-'));const file=join(directory,'isolated.sqlite');let store=new SqliteWorkspaceStore(file);const server=Fastify({logger:false});let database:InstanceType<typeof DatabaseSync>|undefined;
    try {
      prepareRelationshipHttpBlueprint(store,blueprint=>{
        blueprint.endDate='2026-12-02';blueprint.days.push({...structuredClone(blueprint.days[0]!),id:'d2',date:'2026-12-02',kind:'free_time',stops:[],candidatePlaceIds:[]});
        const records:import('@c-assistant/core').TravelBooking[]=['soft','fixed'].map(kind=>({id:'undo-source-'+kind,planningSessionId:blueprint.proposalRef.sessionId,type:'ticket',status:'confirmed',title:'虚构撤销凭证'+kind,source:'user',sourceHash:'synthetic-'+kind,sourceLabel:'旅行者测试声明',importedAt:blueprint.createdAt,updatedAt:blueprint.createdAt,constraintStrength:kind==='fixed'?'hard':'soft',segments:[{id:'undo-segment-'+kind,segmentType:'event_window',title:'虚构分段',status:'confirmed',startAtLocal:'2026-12-01T10:00',startTimeZone:'UTC',location:'虚构场馆',constraintStrength:kind==='fixed'?'hard':'soft',fixedCommitment:kind==='fixed',needsReviewReasons:[]}]}));
        for(const record of records)store.saveTravelBooking(record);blueprint.bookingConstraints=blueprintBookingConstraintsFromTravelBookings(records);
      });
      const execution=store.confirmPlan(store.getWorkspace().activePlan.id).activePlan;
      registerPlanManagementRoutes(server,{store,getMaps:()=>maps,startActivePlanMonitoring(){}});const address=await server.listen({port:0,host:'127.0.0.1'});
      const post=async(path:string,payload:unknown)=>{const response=await fetch(address+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return {status:response.status,body:await response.json() as any};};
      let workspace=store.getWorkspace();const context=store.getBookingRelationshipReviewContext(workspace.activePlan.id);
      const assessment={schemaVersion:1,blueprintId:context.blueprintId,blueprintVersion:context.blueprintVersion,universeDigest:context.universeDigest,status:'reviewed',units:context.units.map(unit=>({...unit,coverage:'complete',rationale:'完整核对直接间接跨日义务',evidenceRefs:['traveler-declaration'],relations:unit.bookingConstraintId==='booking-undo-source-'+(scenario==='fixed'?'fixed':'soft')?[{id:'undo-relation',scope:scenario==='fixed'?'place_global':'occurrence',targets:[scenario==='fixed'?{kind:'place_global',placeId:'b'}:{kind:'occurrence',dayId:'d',placeId:'a'}],role:scenario==='fixed'?'direct_commitment':'itinerary_context',operations:scenario==='fixed'?['remove']:['remove','add'],rationale:'旅行者明确审阅',evidenceRefs:['traveler-declaration']}]:[]})),decision:{source:'traveler',actorId:'local-traveler',decidedAt:'2026-11-16T00:00:00Z',rationale:'完整核对',evidenceRefs:['traveler-declaration'],obligations:['核对全部直接间接跨日依赖']}};
      const review=await post('/api/plans/'+workspace.activePlan.id+'/blueprint-revisions/direct',{expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:workspace.activeBlueprint!.version,requestId:randomUUID(),revisions:[{kind:'review_booking_relationships',assessment,expectedSourceSetDigest:context.sourceSetDigest}]});assert.equal(review.status,200,JSON.stringify(review.body));workspace=store.getWorkspace();
      const revisions=scenario==='fixed'?[{kind:'add_place_to_day',placeId:'b',dayId:'d2',position:{kind:'end'}}]:[{kind:'remove_place_from_day',placeId:'a',dayId:'d'}];
      const body={expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:workspace.activeBlueprint!.version,requestId:randomUUID(),revisions};let saved=await post('/api/plans/'+workspace.activePlan.id+'/blueprint-revisions/direct',body);
      if(saved.status===409){assert.equal(saved.body.code,'high_impact_confirmation_required');saved=await post('/api/plans/'+workspace.activePlan.id+'/blueprint-revisions/direct',{...body,requestId:randomUUID(),highImpactConfirmation:saved.body.impact.id});}
      assert.equal(saved.status,200,JSON.stringify(saved.body));workspace=store.getWorkspace();database=new DatabaseSync(file);
      if(scenario==='changed') {
        // 仅隔离夹具模拟Plan未变而真实来源已更正，验证事务内重新读取来源；不走生产写入旁路。
        const row=database.prepare("SELECT content_json FROM travel_bookings WHERE id='undo-source-soft'").get() as {content_json:string};const record=JSON.parse(row.content_json);record.segments[0].startAtLocal='2026-12-01T12:00';database.prepare("UPDATE travel_bookings SET content_json=? WHERE id='undo-source-soft'").run(JSON.stringify(record));
      }
      const before=store.getWorkspace();const sourceFacts=store.listCurrentTravelBookingSourcesForPlan(workspace.activePlan.id);
      const undo={expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:workspace.activeBlueprint!.version,requestId:randomUUID()};const path='/api/plans/'+workspace.activePlan.id+'/blueprint-revisions/'+saved.body.revision.id+'/undo';
      const result=await post(path,undo);
      if(scenario==='safe') {
        assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.activeBlueprint.days[0].stops.some((stop:any)=>stop.placeId==='a'),true);assert.equal(result.body.activeBlueprint.version,4);assert.equal(result.body.executionPlan.id,execution.id);
        const replay=await post(path,undo);assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.activeBlueprint.version,4);assert.equal(database.prepare('SELECT count(*) AS total FROM direct_blueprint_undos').get()!.total,1);
      } else {
        assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.code,scenario==='fixed'?'assisted_replanning_required':'booking_source_review_required');assert.deepEqual(store.getWorkspace(),before);assert.equal(database.prepare('SELECT count(*) AS total FROM direct_blueprint_undos').get()!.total,0);assert.equal(database.prepare('SELECT undone FROM direct_blueprint_edits WHERE id=?').get(saved.body.revision.id)!.undone,0);
      }
      assert.deepEqual(store.listCurrentTravelBookingSourcesForPlan(store.getWorkspace().activePlan.id),sourceFacts);assert.equal(store.getExecutionPlan()!.id,execution.id);
      database.close();database=undefined;store.close();store=new SqliteWorkspaceStore(file);assert.equal(store.getWorkspace().activeBlueprint!.version,scenario==='safe'?4:3);assert.equal(store.getExecutionPlan()!.id,execution.id);
    } finally {database?.close();await server.close();store.close();rmSync(directory,{recursive:true,force:true});}
  }
});
