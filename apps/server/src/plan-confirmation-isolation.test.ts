import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createInitialWorkspace, type WorkspaceSnapshot } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { activateReviewedPlan } from "./plan-activation.js";
import { registerPlanManagementRoutes } from "./plan-management-routes.js";
import { createEmailPlanMonitoringService } from "./email-plan-monitoring.js";

// In-memory collaborators only: no SQLite store, mail transport, environment or MAH.
function fixture() {
  let current = createInitialWorkspace();
  current = { ...current, activePlan: { ...current.activePlan, id: "fictional-plan", version: 1, status: "draft" } };
  let commits = 0, enqueues = 0;
  const store = {
    getTravelAdjustmentReceiptForPlan: () => undefined,
    getWorkspace: () => current,
    getExecutionPlan: () => current.activePlan.status === "active" ? current.activePlan : undefined,
    confirmPlan: () => { commits++; current = { ...current, activePlan: { ...current.activePlan, status: "active" } }; return current; },
    email: {
      settings: () => ({ verified: true, enabled: true, revision: 1 }),
      planConfirmation: () => ({ confirmedAt: "2026-10-22T00:00:00Z" }),
      enqueue: () => { enqueues++; throw new Error("Fictional queue outage"); }
    }
  };
  return { store: store as unknown as SqliteWorkspaceStore, commits: () => commits, enqueues: () => enqueues };
}

test("committed activation survives confirmation notification queue failure and reports a separate warning", () => {
  const f = fixture(), warnings: Record<string, unknown>[] = [];
  const confirmed = activateReviewedPlan(f.store, { planId: "fictional-plan", expectedVersion: 1 }, new Date("2026-10-22T00:00:00Z"), (details) => { warnings.push(details); });
  assert.equal(confirmed.activePlan.status, "active");
  assert.equal(f.commits(), 1); assert.equal(f.enqueues(), 1);
  assert.equal(warnings[0]?.code, "plan_confirmation_notification_unavailable");
  assert.throws(() => activateReviewedPlan(f.store, { planId: "fictional-plan", expectedVersion: 1 }), /no longer waiting/);
  assert.equal(f.commits(), 1); assert.equal(f.enqueues(), 1);
});

test("pre-commit version conflict still rejects without activation or notification", () => {
  const f = fixture();
  assert.throws(() => activateReviewedPlan(f.store, { planId: "fictional-plan", expectedVersion: 2 }), /changed/);
  assert.equal(f.commits(), 0); assert.equal(f.enqueues(), 0);
});

test("confirm route returns the committed workspace even if notification queue and monitoring startup fail", async (t) => {
  const f = fixture(), server = Fastify();
  t.after(() => server.close());
  registerPlanManagementRoutes(server, { store: f.store, getMaps: () => { throw new Error("No maps access"); }, startActivePlanMonitoring: () => { throw new Error("Fictional startup failure"); } });
  const response = await server.inject({ method: "POST", url: "/api/plans/fictional-plan/confirm", payload: { expectedVersion: 1 } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json<WorkspaceSnapshot>().activePlan.status, "active");
  assert.equal(f.commits(), 1); assert.equal(f.enqueues(), 1);
});

test("background enqueue and early storage failures are caught, release the guard and do not obtain a mail transport", async () => {
  const initial = createInitialWorkspace();
  const plan = { ...initial.activePlan, id: "fictional-plan", status: "active", presentation: { kind: "itinerary", days: [], places: [] } };
  let unavailable = false, queueAttempts = 0, transports = 0;
  const warnings: Record<string, unknown>[] = [];
  const store = {
    listPendingTravelAdjustmentHandoffs: () => [],
    getExecutionPlan: () => { if (unavailable) throw new Error("Fictional read outage"); return plan; },
    getWorkspace: () => ({ ...initial, activePlan: plan }),
    getTravelAdjustmentReceiptForPlan: () => undefined,
    email: { settings: () => ({ enabled: true, verified: true }), usesEmail: () => true,
      planConfirmation: () => ({ confirmedAt: "2026-10-22T00:00:00Z" }),
      enqueue: () => { queueAttempts++; throw new Error("Fictional enqueue outage"); } }
  } as unknown as SqliteWorkspaceStore;
  const monitoring = createEmailPlanMonitoringService({ store, getConnectors: () => ({ maps: {}, googleWeather: {} }) as any,
    getEmailTransport: () => { transports++; throw new Error("Must not obtain a mail transport"); },
    logWarning: (details) => { warnings.push(details); } });
  await assert.doesNotReject(monitoring.runItineraryDepartureReminders());
  await assert.doesNotReject(monitoring.runItineraryDepartureReminders());
  assert.equal(queueAttempts, 2);
  unavailable = true;
  await assert.doesNotReject(monitoring.runItineraryDepartureReminders());
  assert.equal(warnings.length, 3); assert.equal(transports, 0);
  assert.ok(warnings.every((warning) => warning.code === "travel_schedule_unavailable"));
});
