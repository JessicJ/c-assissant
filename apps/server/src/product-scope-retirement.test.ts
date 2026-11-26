import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerConnectorRoutes } from "./connector-routes.js";
import { createConnectorBundleFromEnvironment } from "./connector-bundle.js";
import { createEmailPlanMonitoringService } from "./email-plan-monitoring.js";
import { startServerLifecycle } from "./server-lifecycle.js";

test("retired chat endpoints are absent and mixed settings cannot write credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-retirement-"));
  const envPath = join(directory, "isolated.env");
  const server = Fastify();
  try {
    await registerConnectorRoutes(server, {
      store: {} as never,
      envPath,
      getConnectors: () => { throw new Error("No external service should be accessed"); },
      replaceConnectors: () => { throw new Error("Rejected settings must not replace connectors"); }
    });
    for (const request of [
      { method: "GET", url: "/api/connectors/telegram" },
      { method: "POST", url: "/api/connectors/telegram/verify" },
      { method: "POST", url: "/api/connectors/telegram/pairing/start" },
      { method: "GET", url: "/api/connectors/whatsapp" },
      { method: "POST", url: "/api/connectors/whatsapp/verify" },
      { method: "GET", url: "/api/connectors/whatsapp/webhook" },
      { method: "POST", url: "/api/connectors/whatsapp/webhook" }
    ] as const) {
      assert.equal((await server.inject(request)).statusCode, 404, request.url);
    }
    const response = await server.inject({ method: "PUT", url: "/api/configuration", payload: { googleMapsApiKey: "fixture-only", telegramBotToken: "retired-fixture" } });
    assert.equal(response.statusCode, 400);
    assert.equal(existsSync(envPath), false);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing chat environment credentials cannot activate retired connectors", () => {
  const keys = ["TELEGRAM_BOT_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"] as const;
  const previous = keys.map(key => [key, process.env[key]] as const);
  try {
    for (const key of keys) process.env[key] = "retired-fixture";
    const connectors = createConnectorBundleFromEnvironment();
    assert.equal("telegram" in connectors, false);
    assert.equal("whatsapp" in connectors, false);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("a previously active non-email plan cannot trigger new monitoring or delivery", async () => {
  let externalCalls = 0;
  const monitoring = createEmailPlanMonitoringService({
    store: {
      getExecutionPlan: () => ({ id: "old-plan", version: 1, status: "active", presentation: { kind: "itinerary" } }),
      email: { settings: () => ({ enabled: true, verified: true }), usesEmail: () => false }
    } as never,
    getConnectors: () => { externalCalls++; throw new Error("No provider calls permitted"); },
    getEmailTransport: () => { externalCalls++; throw new Error("No delivery permitted"); },
    logWarning: () => {}
  });
  await monitoring.runItineraryDepartureReminders();
  await monitoring.runPlanWeatherMonitor();
  await monitoring.runPlanVenueMonitor();
  assert.equal(externalCalls, 0);
});

test("startup schedules only email work after recovery and clears all timers on stop", async () => {
  const intervals: number[] = [];
  const order: string[] = [];
  const cleared: unknown[] = [];
  const lifecycle = await startServerLifecycle({
    server: { listen: async () => {}, close: async () => {}, log: { warn: () => {} } } as never,
    store: { recoverInterruptedPlanGenerations: () => ({ runs: 0, sessions: 0 }), close: () => {} } as never,
    port: 0, host: "127.0.0.1", installSignalHandlers: false,
    recoverMahGenerations: async () => { order.push("recover"); },
    abortGenerationJobs: () => {},
    activePlanMonitoring: {
      startActivePlanMonitoring: () => {},
      runItineraryDepartureReminders: async () => { order.push("email"); },
      runPlanWeatherMonitor: async () => { order.push("weather"); },
      runPlanVenueMonitor: async () => { order.push("venue"); }
    },
    scheduler: { setInterval: (_callback, interval) => { intervals.push(interval); return interval; }, clearInterval: handle => { cleared.push(handle); } }
  });
  assert.deepEqual(intervals, [60_000, 300_000, 1_800_000]);
  assert.deepEqual(order, ["recover", "email", "weather", "venue"]);
  await lifecycle.stop();
  assert.equal(cleared.length, 3);
});
