import { appendFileSync, chmodSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import Fastify from "../apps/server/node_modules/fastify/fastify.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { createAppServices } from "../apps/server/src/app-services.js";
import { registerAppRoutes } from "../apps/server/src/app-routes.js";
import { createConnectorBundleFromEnvironment, type ConnectorBundle } from "../apps/server/src/connector-bundle.js";
import { startServerLifecycle } from "../apps/server/src/server-lifecycle.js";

const databaseArgument = process.argv[2];
if (!databaseArgument || !isAbsolute(databaseArgument)) throw new Error("Pass the absolute path of an isolated pilot database as the first argument.");
const databasePath = databaseArgument;
const port = Number(process.argv[3] ?? 8896);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Pass a valid local port as the second argument.");
const capturePath = `${databasePath}.captures.jsonl`;
const projectRoot = resolve(import.meta.dirname, "..");
const envPath = resolve(projectRoot, ".env");
const pilotEnvPath = `${databasePath}.env`;
if (existsSync(envPath)) process.loadEnvFile(envPath);

for (const key of [
  "TELEGRAM_BOT_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_APP_SECRET"
]) delete process.env[key];

const captures: Array<Record<string, unknown>> = [];
appendFileSync(capturePath, "", { mode: 0o600 });
chmodSync(capturePath, 0o600);
const capture = (entry: Record<string, unknown>) => {
  captures.push(entry);
  appendFileSync(capturePath, `${JSON.stringify(entry)}\n`);
};
const environmentConnectors = createConnectorBundleFromEnvironment();
const captureTelegram = {
  channel: "telegram",
  configurationStatus: () => ({ status: "available", provider: "telegram", observedAt: new Date().toISOString(), data: { configured: true } }),
  getUpdates: async () => ({ status: "available", provider: "telegram", observedAt: new Date().toISOString(), data: { updates: [] } }),
  sendMessage: async (input: Record<string, unknown>) => {
    capture({ boundary: "telegram.sendMessage", ...structuredClone(input) });
    return { status: "available", provider: "telegram", observedAt: new Date().toISOString(), data: { chatId: String(input.chatId), messageId: captures.length } };
  },
  sendText: async (input: Record<string, unknown>) => {
    capture({ boundary: "telegram.sendText", ...structuredClone(input) });
    return { status: "available", provider: "telegram", observedAt: new Date().toISOString(), data: { chatId: String(input.chatId), messageId: captures.length } };
  }
};
const captureWhatsApp = {
  channel: "whatsapp",
  configurationStatus: () => ({ status: "not_configured", provider: "whatsapp", observedAt: new Date().toISOString() }),
  sendText: async (input: Record<string, unknown>) => {
    capture({ boundary: "whatsapp.sendText", ...structuredClone(input) });
    return { status: "available", provider: "whatsapp", observedAt: new Date().toISOString(), data: { recipient: String(input.recipient ?? "capture"), messageId: `capture-${captures.length}` } };
  }
};
const captureSafeConnectors = (next: ConnectorBundle) => ({
  maps: next.maps,
  googleWeather: next.googleWeather,
  telegram: captureTelegram,
  whatsapp: captureWhatsApp
}) as unknown as ConnectorBundle;
const connectors = captureSafeConnectors(environmentConnectors);

const webDistPath = resolve(projectRoot, "apps/web/dist");
const semanticCanaryEnabled = process.env.LANDI_SEMANTIC_DRAFT_CANARY === "1";
const semanticCanarySessionIds = (process.env.LANDI_SEMANTIC_DRAFT_CANARY_SESSION_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (semanticCanaryEnabled && semanticCanarySessionIds.length === 0) {
  throw new Error("Controlled local pilot requires at least one explicit LANDI_SEMANTIC_DRAFT_CANARY_SESSION_IDS entry when Canary is enabled.");
}
const store = new SqliteWorkspaceStore(databasePath);
const server = Fastify({ logger: true });
const services = createAppServices({
  projectRoot,
  store,
  semanticShadow: { enabled: false, sampleRate: 0, timeoutMs: 600_000 },
  semanticDraftCanary: { enabled: semanticCanaryEnabled, localEnvironment: true, allowedSessionIds: semanticCanarySessionIds },
  uberClientId: () => undefined,
  allowedWhatsAppUserNumber: () => undefined,
  logGenerationFailure: (details, message) => server.log.error(details, message),
  logWarning: (details, message) => server.log.warn(details, message),
  logWarningMessage: (message) => server.log.warn(message)
});

services.connectorServices.replaceConnectors(connectors);
await registerAppRoutes(server, {
  store,
  envPath: pilotEnvPath,
  webAssetsPath: resolve(webDistPath, "assets"),
  webTripMapPath: resolve(webDistPath, "trip-map"),
  webIndexPath: resolve(webDistPath, "index.html"),
  blueprintGenerationEnabled: true,
  getConnectors: services.connectorServices.getConnectors,
  replaceConnectors: (next) => services.connectorServices.replaceConnectors(captureSafeConnectors(next)),
  runtimeServices: services.runtimeServices,
  messagingServices: services.messagingServices,
  countryPackServices: services.countryPackServices,
  getLocalConfiguration: services.connectorServices.getLocalConfiguration,
  prepareGeneratedPlanEvidence: services.prepareGeneratedPlanEvidence
});

await startServerLifecycle({
  server,
  store,
  port,
  host: "127.0.0.1",
  pollTelegram: () => services.messagingServices.pollTelegram(),
  activePlanMonitoring: services.messagingServices.activePlanMonitoring,
  abortGenerationJobs: services.runtimeServices.abortGenerationJobs
});
server.log.info({ databasePath, capturePath, pilotEnvPath, port, planId: store.getWorkspace().activePlan.id, semanticCanaryEnabled, semanticCanarySessionIds, externalMessaging: "capture_only", mapsAndWeather: "environment_configuration" }, "Controlled local pilot ready");
