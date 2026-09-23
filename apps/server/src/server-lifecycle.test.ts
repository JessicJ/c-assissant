import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle } from "./connector-bundle.js";
import { createActivePlanMonitoringService } from "./active-plan-monitoring.js";
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
  store.createTelegramPairingRequest({ code: "lifecycle-pair", expiresAt: "2027-01-01T00:00:00.000Z" });
  store.claimTelegramPairing({ code: "lifecycle-pair", chatId: "capture-chat", userId: "capture-user", firstName: "Capture" });
  store.confirmPlan(workspace.activePlan.id);
  store.close();
}

function capturedMonitoring(store: SqliteWorkspaceStore, captures: Array<Record<string, unknown>>) {
  const connectors = {
    maps: { geocodeAddress: async ({ address }: { address: string }) => ({ status: "available", provider: "google_maps", observedAt: new Date().toISOString(), data: { provider: "google_maps", formattedAddress: address, location: "2.34,48.86", city: "Paris", country: "France", district: "" } }) },
    googleWeather: { weather: async ({ locationName }: { locationName: string }) => ({ status: "available", provider: "google_weather", observedAt: new Date().toISOString(), data: { provider: "google_weather", location: { id: locationName, name: locationName, latitude: 48.86, longitude: 2.34, timezone: "Europe/Paris" }, current: { observedAt: new Date().toISOString(), temperatureC: 18, apparentTemperatureC: 18, condition: "Clear", conditionCode: "clear", precipitationMm: 0, windSpeedKph: 5 }, daily: [] } }) },
    telegram: { sendMessage: async (input: Record<string, unknown>) => { captures.push(structuredClone(input)); return { status: "available", provider: "telegram", observedAt: new Date().toISOString(), data: { chatId: String(input.chatId), messageId: captures.length } }; } }
  } as unknown as ConnectorBundle;
  const actual = createActivePlanMonitoringService({
    store,
    getConnectors: () => connectors,
    telegramLocationActions: {
      rememberMovementGoLocationSession() {}, async requestArrivalLocation() {}, async requestFoodLocation() {}, async requestMovementGoLocation() {}, async sendArrivalRouteFromSharedLocation() {}, async sendMovementGoFromSharedLocation() {}, async sendNearbyFoodFromSharedLocation() {}, async sendUberTestFromSharedLocation() {}
    },
    logWarning: () => {}
  });
  const noOp = async () => {};
  return { ...actual, runArrivalLocationPrompt: noOp, runArrivalReminder: noOp, runPlanVenueMonitor: noOp, runPlanWeatherMonitor: noOp, runRouteHandoffGuidance: noOp, runTaskReminders: noOp };
}

async function runLifecycle(path: string, now: string, captures: Array<Record<string, unknown>>, fireDueTimer: boolean) {
  return withFixedNow(now, async () => {
    const store = new SqliteWorkspaceStore(path);
    const scheduler = new ControlledScheduler();
    const server = Fastify({ logger: false });
    const lifecycle = await startServerLifecycle({
      server, store, port: 0, host: "127.0.0.1", pollTelegram: async () => {}, activePlanMonitoring: capturedMonitoring(store, captures), abortGenerationJobs: () => {}, scheduler, installSignalHandlers: false
    });
    if (fireDueTimer) {
      scheduler.fire(60_000);
      scheduler.fire(60_000);
    }
    await lifecycle.stop();
    assert.equal(scheduler.activeCount(), 0);
  });
}

test("server lifecycle captures due itinerary reminders once and preserves dedupe across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-lifecycle-"));
  const path = join(directory, "workspace.sqlite");
  const captures: Array<Record<string, unknown>> = [];
  try {
    createReminderFixture(path);
    await runLifecycle(path, "2026-11-10T08:00:00.000Z", captures, true);
    assert.equal(captures.length, 0);

    await runLifecycle(path, "2026-11-10T08:30:00.000Z", captures, true);
    assert.equal(captures.length, 1);
    assert.match(String(captures[0]?.text), /Next: Museum at 10:00/);

    await runLifecycle(path, "2026-11-10T08:30:00.000Z", captures, true);
    assert.equal(captures.length, 1);

    const reopened = new SqliteWorkspaceStore(path);
    assert.equal(reopened.getExecutionPlan()?.status, "active");
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
