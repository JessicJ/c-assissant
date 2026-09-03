import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
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
