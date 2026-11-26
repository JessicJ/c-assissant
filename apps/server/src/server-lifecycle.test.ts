import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle } from "./connector-bundle.js";
import { createEmailPlanMonitoringService } from "./email-plan-monitoring.js";
import { createRuntimeServices } from "./runtime-services.js";
import { emailTimingFixture, verifiedEmailFixture } from "./email.fixture.test.js";
import { startServerLifecycle } from "./server-lifecycle.js";

class ControlledScheduler {
  private readonly entries: Array<{ callback: () => void; intervalMs: number; active: boolean }> = [];
  setInterval(callback: () => void, intervalMs: number): unknown {
    const entry = { callback, intervalMs, active: true };
    this.entries.push(entry);
    return entry;
  }
  clearInterval(handle: unknown): void {
    (handle as { active: boolean }).active = false;
  }
  fire(intervalMs: number): void {
    for (const entry of this.entries) if (entry.active && entry.intervalMs === intervalMs) entry.callback();
  }
  activeCount(): number {
    return this.entries.filter((entry) => entry.active).length;
  }
}

async function withFixedNow<T>(iso: string, operation: () => Promise<T>): Promise<T> {
  const OriginalDate = Date;
  const fixedMs = OriginalDate.parse(iso);
  class FixedDate extends OriginalDate {
    constructor(value?: string | number | Date) { super(value === undefined ? fixedMs : value); }
    static override now() { return fixedMs; }
  }
  globalThis.Date = FixedDate as DateConstructor;
  try { return await operation(); }
  finally { globalThis.Date = OriginalDate; }
}

function createReminderFixture(path: string): void {
  const store = new SqliteWorkspaceStore(path);
  const workspace = store.createGeneratedPlan({
    title: "Lifecycle reminder fixture", location: "Paris", dates: "2026-11-10", knownInformation: [], assumptions: [], nextAction: "Review",
    presentation: {
      kind: "itinerary", summary: "One fixed visit.", startDate: "2026-11-10", endDate: "2026-11-10",
      days: [{ id: "day-1", label: "Nov 10", date: "2026-11-10", city: "Paris", title: "Museum", summary: "Use the verified route to a booked visit.", placeIds: ["cafe", "museum"], stops: [{ placeId: "cafe", order: 1, time: "08:30" }, { placeId: "museum", order: 2, time: "10:00", role: "fixed anchor" }], routeReview: { sequenceRationale: "Use the verified route to the booked visit." } }],
      places: [
        { id: "cafe", name: "Cafe", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.34], category: "food", priority: "preferred", durationMinutes: 30, whyWorthIt: "Breakfast", plan: "Eat", detailSections: [], sourceRefs: [] },
        { id: "museum", name: "Museum", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "booked", durationMinutes: 90, whyWorthIt: "Booked visit", plan: "Arrive on time", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "cafe", destinationPlaceId: "museum", mode: "walking", durationMinutes: 20, verification: "verified", label: "Walk 20 min", detail: "Verified fixture route.", sourceRefs: [] }]
    }, stages: []
  });
  verifiedEmailFixture(store);
  store.confirmPlan(workspace.activePlan.id);
  store.close();
}

function capturedMonitoring(store: SqliteWorkspaceStore, captures: Array<Record<string, unknown>>) {
  const connectors = {
    maps: { searchPlaces: async ({query}: {query:string}) => ({status:"available",provider:"google_maps",observedAt:new Date().toISOString(),data:[{id:query,name:query,city:"Paris",location:"2.34,48.86",businessStatus:"operational"}]}), geocodeAddress: async ({ address }: { address: string }) => ({ status: "available", provider: "google_maps", observedAt: new Date().toISOString(), data: { provider: "google_maps", formattedAddress: address, location: "2.34,48.86", city: "Paris", country: "France", district: "" } }) },
    googleWeather: { weather: async ({ locationName }: { locationName: string }) => ({ status: "available", provider: "google_weather", observedAt: new Date().toISOString(), data: { provider: "google_weather", location: { id: locationName, name: locationName, latitude: 48.86, longitude: 2.34, timezone: "Europe/Paris" }, current: { observedAt: new Date().toISOString(), temperatureC: 18, apparentTemperatureC: 18, condition: "Clear", conditionCode: "clear", precipitationMm: 0, windSpeedKph: 5 }, daily: [] } }) }
  } as unknown as ConnectorBundle;
  const actual = createEmailPlanMonitoringService({
    store,
    getConnectors: () => connectors,
    getEmailTransport: () => ({ configured: () => true, verify: async () => ({ ready: true }), send: async message => { captures.push({ ...message }); return { status: "accepted", messageId: message.messageId }; } }),
    emailTiming: async request=>emailTimingFixture(request),
    logWarning: () => {}
  });
  return actual;
}

async function runLifecycle(path: string, now: string, captures: Array<Record<string, unknown>>, fireDueTimer: boolean) {
  return withFixedNow(now, async () => {
    const store = new SqliteWorkspaceStore(path);
    const scheduler = new ControlledScheduler();
    const server = Fastify({ logger: false });
    const actual = capturedMonitoring(store, captures);
    const pending: Promise<void>[] = [];
    const tracked = (operation: () => Promise<void>) => () => {
      const result = operation();pending.push(result);return result;
    };
    const lifecycle = await startServerLifecycle({
      server, store, port: 0, host: "127.0.0.1", activePlanMonitoring: {
        ...actual,
        runItineraryDepartureReminders: tracked(actual.runItineraryDepartureReminders),
        runPlanWeatherMonitor: tracked(actual.runPlanWeatherMonitor),
        runPlanVenueMonitor: tracked(actual.runPlanVenueMonitor)
      }, abortGenerationJobs: () => {}, scheduler, installSignalHandlers: false
    });
    // 真实计时器在启动检查结束后触发；等待原服务，避免把同一微任务中的 busy 跳过当成下一轮。
    await Promise.all(pending);
    if (fireDueTimer) {
      scheduler.fire(60_000);
      await Promise.all(pending);
      scheduler.fire(60_000);
      await Promise.all(pending);
    }
    await lifecycle.stop();
    assert.equal(scheduler.activeCount(), 0);
  });
}

function readLifecycleState(path: string) {
  const store = new SqliteWorkspaceStore(path);
  try {
    const plan = store.getExecutionPlan()!;
    return {jobs: store.email.list(), observations: store.listTravelAdjustmentObservations(plan.id, plan.version)};
  } finally {store.close();}
}

test("未决来源不阻断常规定时邮件，服务器重启保持投递去重", async () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-lifecycle-"));
  const path = join(directory, "workspace.sqlite");
  const captures: Array<Record<string, unknown>> = [];
  try {
    createReminderFixture(path);
    await runLifecycle(path, "2026-11-10T06:00:00.000Z", captures, true);
    assert.equal(captures.length, 0);

    await runLifecycle(path, "2026-11-10T08:30:00.000Z", captures, true);
    assert.equal(captures.length, 2);
    const saved = readLifecycleState(path);
    assert.deepEqual(saved.jobs.map(job=>job.kind).sort(),["morning","transfer","transfer"]);
    assert.equal(saved.jobs.filter(job=>job.status==="accepted").length,2);
    assert.ok(saved.observations.some(item=>item.observation.candidate?.kind==="weather_current"&&item.observation.status==="unknown"));
    assert.ok(saved.observations.some(item=>item.observation.candidate?.kind==="venue"&&item.observation.status==="unknown"));
    assert.ok(saved.observations.every(item=>item.lastReliable===null));
    const candidates=saved.observations.filter(item=>item.observation.candidate?.kind==="weather_current" || item.observation.candidate?.kind==="venue");
    assert.ok(candidates.length>0);
    assert.ok(candidates.every(item=>item.observation.status==="unknown" && item.lastReliable===null));
    assert.match(String(captures[1]?.html), /Museum/);
    assert.match(String(captures[1]?.html), /10:00/);

    await runLifecycle(path, "2026-11-10T08:30:00.000Z", captures, true);
    assert.equal(captures.length, 2);
    const restarted = readLifecycleState(path);
    assert.deepEqual(restarted.jobs,saved.jobs);
    assert.deepEqual(restarted.observations,saved.observations);

    const reopened = new SqliteWorkspaceStore(path);
    assert.equal(reopened.getExecutionPlan()?.status, "active");
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shutdown cancels background photos for a ready plan without treating the plan as failed", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const runtime = createRuntimeServices({ store, semanticShadow: { enabled: false, sampleRate: 0, timeoutMs: 1 }, semanticDraftCanary: { enabled: false, localEnvironment: false, allowedSessionIds: [] }, logGenerationFailure: () => {} });
    for (const id of ["running", "photos", "finished"]) {
      runtime.planningGeneration.jobs.set(id, { runId: id, sessionId: id, generationKey: id, strategy: "legacy", stage: "ready", status: id === "running" ? "running" : "succeeded", startedAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", controller: new AbortController() });
    }
    runtime.planningGeneration.imageContinuations!.set("photos", new Promise(() => {}));
    runtime.abortGenerationJobs();
    assert.equal(runtime.planningGeneration.jobs.get("running")!.controller.signal.aborted, true);
    assert.equal(runtime.planningGeneration.jobs.get("photos")!.controller.signal.aborted, true);
    assert.equal(runtime.planningGeneration.jobs.get("photos")!.status, "succeeded");
    assert.equal(runtime.planningGeneration.jobs.get("finished")!.controller.signal.aborted, false);
  } finally { store.close(); }
});
