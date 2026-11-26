import type { MahGenerationMappings } from './mah-generation-contract.js';
import { MahCliTransport } from './mah-cli-transport.js';
import { resolveMahProjectRoot } from './mah-project-root.js';
import type { MaintenanceControl } from "./maintenance-control.js";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createConnectorServices } from "./connector-services.js";
import { createDestinationResearch } from "./destination-research.js";
import { createGeneratedPlanEvidencePreparer } from "./generated-plan-evidence.js";
import { createEmailPlanMonitoringService } from "./email-plan-monitoring.js";
import { createIsolatedGenerationRuntimeServices, createRuntimeServices } from "./runtime-services.js";
import type { SemanticShadowConfig } from "./semantic-shadow.js";
import type { SemanticDraftCanaryConfig } from "./semantic-draft-canary.js";

export function createAppServices(dependencies: {
  maintenance?: MaintenanceControl;
  guarded?: boolean;
  projectRoot: string;
  databasePath: string;
  generationValidationSessionId?: string;
  store: SqliteWorkspaceStore;
  semanticShadow: SemanticShadowConfig;
  semanticDraftCanary: SemanticDraftCanaryConfig;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
  logWarning: (details: Record<string, unknown>, message: string) => void;
}) {
  const {
    projectRoot,
    databasePath,
    store,
    semanticShadow,
    semanticDraftCanary,
    logGenerationFailure,
    logWarning,
  } = dependencies;
  const connectorServices = createConnectorServices();
  const destinationResearch = createDestinationResearch({
    store,
    getConnectors: connectorServices.getConnectors
  });
  const runtimeDependencies = { ...(dependencies.maintenance ? { maintenance: dependencies.maintenance } : {}), guarded: dependencies.guarded === true, componentRoot: projectRoot, databasePath, store, semanticShadow, semanticDraftCanary, logGenerationFailure };
  const runtimeServices = dependencies.generationValidationSessionId && !dependencies.guarded
    ? createIsolatedGenerationRuntimeServices(runtimeDependencies,
      new MahCliTransport({ mahProjectRoot: () => resolveMahProjectRoot(projectRoot), store: store.generationCarriers as MahGenerationMappings }),
      { validationSessionId: dependencies.generationValidationSessionId })
    : createRuntimeServices(runtimeDependencies);
  const prepareGeneratedPlanEvidence = createGeneratedPlanEvidencePreparer({
    store,
    getMaps: () => connectorServices.getConnectors().maps,
    getWeather: () => connectorServices.getConnectors().googleWeather
  });
  const activePlanMonitoring = dependencies.guarded ? Object.freeze({ runItineraryDepartureReminders: async () => {}, runPlanWeatherMonitor: async () => {}, runPlanVenueMonitor: async () => {}, startActivePlanMonitoring: () => {} }) : createEmailPlanMonitoringService({
    ...(dependencies.maintenance ? { maintenance: dependencies.maintenance } : {}),
    store,
    getConnectors: connectorServices.getConnectors,
    emailTiming: request => runtimeServices.business.generateEmailTiming(request),
    emailResearch: request => runtimeServices.business.generateEmailResearch(request),
    logWarning
  });

  return {
    connectorServices,
    destinationResearch,
    runtimeServices,
    activePlanMonitoring,
    prepareGeneratedPlanEvidence
  };
}
