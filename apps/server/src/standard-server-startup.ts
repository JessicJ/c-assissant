import { assertIsolatedGenerationDatabase } from './generation-admission.js';
import { createMaintenanceControl } from "./maintenance-control.js";
import { registerMaintenanceControl } from "./maintenance-control-routes.js";
import { createMahReadonlySnapshots } from "./mah-readonly-snapshots.js";
import { resolveMahProjectRoot } from "./mah-project-root.js";
import Fastify from "fastify";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { startServerLifecycle } from "./server-lifecycle.js";
import { registerAppRoutes } from "./app-routes.js";
import { loadServerConfig } from "./server-config.js";
import { createAppServices } from "./app-services.js";

export async function startStandardServer(entryModuleUrl: string, validation?: { databasePath: string; sessionId: string; port: number }) {
const server = Fastify({ logger: true });
const maintenanceToken = process.env.LANDI_MAINTENANCE_TOKEN;
const maintenance = maintenanceToken ? createMaintenanceControl() : undefined;
if (maintenance && maintenanceToken) {
  registerMaintenanceControl(server, maintenance, maintenanceToken);
  server.log.info({ maintenanceInstanceId: maintenance.instanceId }, 'Process-local maintenance diagnostics enabled');
}
const {
  projectRoot,
  envPath,
  databasePath: configuredDatabasePath,
  blueprintGenerationEnabled,
  semanticShadow,
  semanticDraftCanary,
  webAssetsPath,
  webTripMapPath,
  webIndexPath,
  instanceHealth,
  port,
  host
} = loadServerConfig(entryModuleUrl);
const databasePath = validation
  ? assertIsolatedGenerationDatabase(validation.databasePath, projectRoot, resolveMahProjectRoot(projectRoot)) : configuredDatabasePath;
const store = new SqliteWorkspaceStore(databasePath);
const {
  connectorServices,
  destinationResearch,
  runtimeServices,
  activePlanMonitoring,
  prepareGeneratedPlanEvidence
} = createAppServices({
  ...(maintenance ? { maintenance } : {}),
  projectRoot,
  databasePath,
  ...(validation ? { generationValidationSessionId: validation.sessionId } : {}),
  store,
  semanticShadow,
  semanticDraftCanary,
  logGenerationFailure: (details, message) => server.log.error(details, message),
  logWarning: (details, message) => server.log.warn(details, message),
});

await registerAppRoutes(server, {
  getMahDiagnostics: createMahReadonlySnapshots({ projectRoot: () => resolveMahProjectRoot(projectRoot) }),
  store,
  envPath,
  webAssetsPath,
  webTripMapPath,
  webIndexPath,
  ...(instanceHealth ? { instanceHealth } : {}),
  blueprintGenerationEnabled,
  getConnectors: connectorServices.getConnectors,
  replaceConnectors: connectorServices.replaceConnectors,
  runtimeServices,
  activePlanMonitoring,
  destinationResearch,
  getLocalConfiguration: connectorServices.getLocalConfiguration,
  prepareGeneratedPlanEvidence
});

await startServerLifecycle({
  ...(maintenance ? { maintenance } : {}),
  server,
  store,
  port: validation?.port ?? port,
  host: validation ? '127.0.0.1' : host,
  activePlanMonitoring,
  recoverMahGenerations: runtimeServices.recoverMahGenerations,
  abortGenerationJobs: runtimeServices.abortGenerationJobs
});

}
