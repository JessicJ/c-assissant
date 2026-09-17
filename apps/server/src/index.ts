import Fastify from "fastify";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { startServerLifecycle } from "./server-lifecycle.js";
import { registerAppRoutes } from "./app-routes.js";
import { loadServerConfig } from "./server-config.js";
import { createAppServices } from "./app-services.js";

const server = Fastify({ logger: true });
const {
  projectRoot,
  envPath,
  databasePath,
  blueprintGenerationEnabled,
  semanticShadow,
  webAssetsPath,
  webTripMapPath,
  webIndexPath,
  port,
  host
} = loadServerConfig(import.meta.url);
const store = new SqliteWorkspaceStore(databasePath);
const {
  connectorServices,
  countryPackServices,
  runtimeServices,
  messagingServices,
  prepareGeneratedPlanEvidence
} = createAppServices({
  projectRoot,
  store,
  semanticShadow,
  uberClientId: () => process.env.UBER_CLIENT_ID,
  allowedWhatsAppUserNumber: () => process.env.WHATSAPP_ALLOWED_USER_NUMBER,
  logGenerationFailure: (details, message) => server.log.error(details, message),
  logWarning: (details, message) => server.log.warn(details, message),
  logWarningMessage: (message) => server.log.warn(message)
});

await registerAppRoutes(server, {
  store,
  envPath,
  webAssetsPath,
  webTripMapPath,
  webIndexPath,
  blueprintGenerationEnabled,
  getConnectors: connectorServices.getConnectors,
  replaceConnectors: connectorServices.replaceConnectors,
  runtimeServices,
  messagingServices,
  countryPackServices,
  getLocalConfiguration: connectorServices.getLocalConfiguration,
  prepareGeneratedPlanEvidence
});

await startServerLifecycle({
  server,
  store,
  port,
  host,
  pollTelegram: () => messagingServices.pollTelegram(),
  activePlanMonitoring: messagingServices.activePlanMonitoring,
  abortGenerationJobs: runtimeServices.abortGenerationJobs
});
