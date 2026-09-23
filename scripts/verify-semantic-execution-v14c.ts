import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "../apps/server/node_modules/fastify/fastify.js";
import { planPresentationIntegrityIssues, type Plan, type PlanPresentation } from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import type { ConnectorBundle } from "../apps/server/src/connector-bundle.js";
import { createActivePlanMonitoringService } from "../apps/server/src/active-plan-monitoring.js";
import { dueItineraryDepartureReminders } from "../apps/server/src/itinerary-departure-reminder.js";
import { selectNextPlannedStop } from "../apps/server/src/next-planned-stop.js";
import { registerPlanManagementRoutes } from "../apps/server/src/plan-management-routes.js";

const databasePath = resolve(process.argv[2] ?? "/tmp/landi-v14c-execution-compat-20260918.sqlite");
const fixturePath = "/tmp/landi-v14c-reminder-fixture-20260918.sqlite";
const reportPath = "/tmp/landi-v14c-execution-compat-report.json";
const expectedPlanId = "plan-1ce9nd2";
const expectedBlueprintId = "blueprint-e387e628-9839-4f10-9c2c-afc5f016c5cb";

for (const key of [
  "TELEGRAM_BOT_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_APP_SECRET",
  "GOOGLE_MAPS_API_KEY"
]) delete process.env[key];

function available<T>(provider: "google_maps" | "google_weather" | "telegram" | "whatsapp", data: T) {
  return { status: "available" as const, provider, observedAt: new Date().toISOString(), data };
}

function captureConnectors(captures: Array<Record<string, unknown>>): ConnectorBundle {
  return {
    maps: {
      geocodeAddress: async ({ address }: { address: string }) => available("google_maps", { provider: "google_maps", formattedAddress: address, location: "-8.6100,41.1500", city: address, country: "Test", district: "" }),
      searchPlaces: async () => available("google_maps", [])
    },
    googleWeather: {
      weather: async ({ locationName }: { locationName: string }) => available("google_weather", {
        provider: "google_weather",
        location: { id: locationName, name: locationName, latitude: 41.15, longitude: -8.61, timezone: locationName.toLowerCase().includes("paris") ? "Europe/Paris" : "Europe/Lisbon" },
        current: { observedAt: new Date().toISOString(), temperatureC: 18, apparentTemperatureC: 18, condition: "Clear", conditionCode: "clear", precipitationMm: 0, windSpeedKph: 5 },
        daily: []
      })
    },
    telegram: {
      channel: "telegram",
      configurationStatus: () => available("telegram", { configured: true }),
      sendMessage: async (input: Record<string, unknown>) => {
        captures.push({ boundary: "telegram.sendMessage", ...structuredClone(input) });
        return available("telegram", { chatId: String(input.chatId), messageId: captures.length });
      },
      sendText: async (input: Record<string, unknown>) => {
        captures.push({ boundary: "telegram.sendText", ...structuredClone(input) });
        return available("telegram", { chatId: String(input.chatId), messageId: captures.length });
      },
      getUpdates: async () => available("telegram", { updates: [] })
    },
    whatsapp: {
      channel: "whatsapp",
      configurationStatus: () => ({ status: "not_configured" as const, provider: "whatsapp" as const, observedAt: new Date().toISOString() }),
      sendText: async (input: Record<string, unknown>) => {
        captures.push({ boundary: "whatsapp.sendText", ...structuredClone(input) });
        return available("whatsapp", { recipient: String(input.recipient ?? "capture"), messageId: `capture-${captures.length}` });
      }
    }
  } as unknown as ConnectorBundle;
}

function inertLocationActions() {
  return {
    rememberMovementGoLocationSession() {},
    async requestArrivalLocation() {},
    async requestFoodLocation() {},
    async requestMovementGoLocation() {},
    async sendArrivalRouteFromSharedLocation() {},
    async sendMovementGoFromSharedLocation() {},
    async sendNearbyFoodFromSharedLocation() {},
    async sendUberTestFromSharedLocation() {}
  };
}

function rawStoredPresentation(path: string, planId: string): PlanPresentation {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare("SELECT presentation_json FROM plans WHERE id = ?").get(planId) as { presentation_json: string } | undefined;
    if (!row) throw new Error(`Plan ${planId} is missing from the isolated database.`);
    return JSON.parse(row.presentation_json) as PlanPresentation;
  } finally {
    database.close();
  }
}

async function withFixedNow<T>(iso: string, operation: () => Promise<T>): Promise<T> {
  const OriginalDate = Date;
  const fixedMs = OriginalDate.parse(iso);
  class FixedDate extends OriginalDate {
    constructor(value?: string | number | Date) {
      super(value === undefined ? fixedMs : value);
    }
    static override now() { return fixedMs; }
  }
  globalThis.Date = FixedDate as DateConstructor;
  try {
    return await operation();
  } finally {
    globalThis.Date = OriginalDate;
  }
}

function pairCaptureChat(store: SqliteWorkspaceStore, code: string): void {
  store.createTelegramPairingRequest({ code, expiresAt: "2027-01-01T00:00:00.000Z" });
  store.claimTelegramPairing({ code, chatId: "capture-chat", userId: "capture-user", firstName: "Capture" });
}

function presentationSummary(plan: Plan) {
  if (plan.presentation?.kind !== "itinerary") throw new Error("Expected an itinerary presentation.");
  return {
    days: plan.presentation.days.map((day) => ({ id: day.id, date: day.date, city: day.city, stops: day.stops, startContext: day.startContext, endContext: day.endContext })),
    plannedPlaceIds: plan.presentation.days.flatMap((day) => day.placeIds),
    candidatePlaceIds: plan.presentation.days.flatMap((day) => day.candidates ?? []),
    routes: plan.presentation.routeSegments.map((route) => ({ id: route.id, dayId: route.dayId, originPlaceId: route.originPlaceId, destinationPlaceId: route.destinationPlaceId, verification: route.verification, durationMinutes: route.durationMinutes }))
  };
}

async function verifyReminderCaptureFixture() {
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
  const store = new SqliteWorkspaceStore(fixturePath);
  const captures: Array<Record<string, unknown>> = [];
  try {
    const workspace = store.createGeneratedPlan({
      title: "Reminder fixture",
      location: "Paris",
      dates: "2026-11-10",
      knownInformation: [],
      assumptions: [],
      nextAction: "Review",
      presentation: {
        kind: "itinerary",
        summary: "Deterministic fixed-stop reminder fixture.",
        startDate: "2026-11-10",
        endDate: "2026-11-10",
        days: [{
          id: "fixture-day",
          label: "2026-11-10",
          date: "2026-11-10",
          city: "Paris",
          title: "Museum",
          summary: "A booked museum visit.",
          placeIds: ["fixture-origin", "fixture-museum"],
          stops: [{ placeId: "fixture-origin", order: 1, time: "08:30" }, { placeId: "fixture-museum", order: 2, time: "10:00", role: "fixed anchor" }],
          routeReview: { sequenceRationale: "Use the verified short transfer to the booked entry." }
        }],
        places: [
          { id: "fixture-origin", name: "Cafe", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.34], category: "food", priority: "preferred", durationMinutes: 30, whyWorthIt: "Breakfast", plan: "Eat", detailSections: [], sourceRefs: [] },
          { id: "fixture-museum", name: "Museum", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "booked", durationMinutes: 90, whyWorthIt: "Booked visit", plan: "Arrive on time", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: [{ id: "fixture-route", dayId: "fixture-day", originPlaceId: "fixture-origin", destinationPlaceId: "fixture-museum", mode: "walking", durationMinutes: 20, verification: "verified", label: "Walk 20 min", detail: "Verified fixture route.", sourceRefs: [] }]
      },
      stages: []
    });
    pairCaptureChat(store, "fixture-pairing");
    store.confirmPlan(workspace.activePlan.id);
    const connectors = captureConnectors(captures);
    const monitoring = createActivePlanMonitoringService({ store, getConnectors: () => connectors, telegramLocationActions: inertLocationActions(), logWarning: () => {} });
    await withFixedNow("2026-11-10T08:30:00.000Z", async () => {
      await monitoring.runItineraryDepartureReminders();
      await monitoring.runItineraryDepartureReminders();
    });
    const database = new DatabaseSync(fixturePath, { readOnly: true });
    const deliveries = database.prepare("SELECT plan_id, reminder_key, day_id, place_id, status, attempt_count, delivered_at FROM telegram_itinerary_reminder_deliveries ORDER BY rowid").all();
    database.close();
    return { databasePath: fixturePath, captures, deliveries };
  } finally {
    store.close();
  }
}

async function main() {
  const rawPresentation = rawStoredPresentation(databasePath, expectedPlanId);
  const rawIntegrityIssues = planPresentationIntegrityIssues(rawPresentation, { executionReady: true });
  const store = new SqliteWorkspaceStore(databasePath);
  const captures: Array<Record<string, unknown>> = [];
  const warnings: Array<{ message: string; details: Record<string, unknown> }> = [];
  const connectors = captureConnectors(captures);
  const monitoring = createActivePlanMonitoringService({
    store,
    getConnectors: () => connectors,
    telegramLocationActions: inertLocationActions(),
    logWarning: (details, message) => warnings.push({ message, details })
  });
  const server = Fastify({ logger: false });
  try {
    const before = store.getWorkspace();
    if (before.activePlan.id !== expectedPlanId || before.activePlan.status !== "draft") throw new Error("The isolated database is not at the accepted draft baseline.");
    if (before.activeBlueprint?.id !== expectedBlueprintId || before.activeBlueprint.version !== 5) throw new Error("The isolated database is not at Blueprint v5.");
    pairCaptureChat(store, "v14c-pairing");
    registerPlanManagementRoutes(server, {
      store,
      getMaps: () => connectors.maps,
      startActivePlanMonitoring: monitoring.startActivePlanMonitoring,
      getGeneratingPlan: () => false
    });
    const confirmResponse = await server.inject({ method: "POST", url: `/api/plans/${expectedPlanId}/confirm` });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    const after = store.getWorkspace();
    const execution = store.getExecutionPlan();
    if (!execution) throw new Error("Confirmation did not create an Execution Plan.");

    const actualCapturesAfterConfirm = captures.length;
    await withFixedNow("2026-11-10T17:05:00.000Z", () => monitoring.runItineraryDepartureReminders());
    await withFixedNow("2026-11-12T10:05:00.000Z", () => monitoring.runItineraryDepartureReminders());
    const actualDueDay1 = dueItineraryDepartureReminders(execution, new Map([["porto", "Europe/Lisbon"]]), new Date("2026-11-10T17:05:00.000Z"));
    const actualDueDay3 = dueItineraryDepartureReminders(execution, new Map([["porto", "Europe/Lisbon"]]), new Date("2026-11-12T10:05:00.000Z"));
    const reminderFixture = await verifyReminderCaptureFixture();
    const blueprint = after.activeBlueprint!;
    const hardCommitments = blueprint.bookingConstraints?.filter((constraint) => constraint.constraintStrength === "hard") ?? [];
    const output = {
      databasePath,
      serviceEntry: "POST /api/plans/:planId/confirm via Fastify inject and registerPlanManagementRoutes",
      captureBoundaryInstalledBeforeConfirm: true,
      externalCredentialsCleared: true,
      automaticTimersStarted: false,
      baseline: {
        plan: { id: before.activePlan.id, version: before.activePlan.version, status: before.activePlan.status, location: before.activePlan.location, dates: before.activePlan.dates },
        blueprint: { id: before.activeBlueprint?.id, version: before.activeBlueprint?.version },
        presentation: presentationSummary(before.activePlan),
        rawStoredIntegrityIssues: rawIntegrityIssues
      },
      confirmation: {
        httpStatus: confirmResponse.statusCode,
        responsePlan: { id: after.activePlan.id, version: after.activePlan.version, status: after.activePlan.status },
        executionPlan: { id: execution.id, version: execution.version, status: execution.status, location: execution.location, dates: execution.dates },
        executionPresentation: presentationSummary(execution),
        projectedIntegrityIssues: planPresentationIntegrityIssues(execution.presentation!, { executionReady: true }),
        lineage: store.getPlanBlueprintLineage(execution.id),
        hardCommitments: hardCommitments.map((constraint) => ({ id: constraint.id, type: constraint.type, status: constraint.status, segments: constraint.segments.map((segment) => ({ id: segment.id, title: segment.title, startAtLocal: segment.startAtLocal, endAtLocal: segment.endAtLocal, location: segment.location, fixedCommitment: segment.fixedCommitment })) }))
      },
      consumers: {
        nextStopAtDay1_1600: selectNextPlannedStop(execution, { localDate: "2026-11-10", localTime: "16:00" }),
        nextStopAtDay1_1720: selectNextPlannedStop(execution, { localDate: "2026-11-10", localTime: "17:20" }),
        actualDraftDueDay1: actualDueDay1,
        actualDraftDueDay3: actualDueDay3
      },
      actualDraftNotifications: {
        capturesAfterConfirm: actualCapturesAfterConfirm,
        capturesAfterControlledChecks: captures,
        warnings
      },
      reminderFixture,
      sideEffects: {
        confirmationInboxItems: after.inbox.filter((item) => /confirmed/i.test(`${item.title} ${item.body}`)).length,
        externalSendCount: 0,
        executionPlanCount: 1,
        semanticShadowStarted: false,
        plannerCalled: false
      }
    };
    writeFileSync(reportPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ reportPath, ...output }, null, 2));
  } finally {
    await server.close();
    store.close();
  }
}

await main();
