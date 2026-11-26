import type { FastifyInstance } from "fastify";
import type { WorkspaceSnapshot } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle, LocalConfigurationSnapshot } from "./connector-bundle.js";
import { registerConnectorRoutes } from "./connector-routes.js";
import type { DestinationResearch } from "./destination-research.js";
import { registerBookingRoutes } from "./booking-routes.js";
import type { EmailPlanMonitoringService } from "./email-plan-monitoring.js";
import { registerLocalWebRoutes } from "./local-web-routes.js";
import { registerMaintenanceRoutes } from "./maintenance-routes.js";
import { registerOfficialSourceRoutes } from "./official-source-routes.js";
import { registerPlanManagementRoutes } from "./plan-management-routes.js";
import { registerPlanPresentationRoutes } from "./plan-presentation-routes.js";
import { registerPlanningSessionRoutes } from "./planning-session-routes.js";
import type { RuntimeServices } from "./runtime-services-contract.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { registerWebAgentRoutes } from "./web-agent-routes.js";

export async function registerAppRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  getMahDiagnostics?: NonNullable<Parameters<typeof registerRuntimeRoutes>[1]["getMahDiagnostics"]>;
  envPath: string;
  webAssetsPath: string;
  webTripMapPath: string;
  webIndexPath: string;
  instanceHealth?: {
    service: string;
    protocolVersion: string;
    proof: string;
  };
  blueprintGenerationEnabled: boolean;
  getConnectors: () => ConnectorBundle;
  replaceConnectors: (connectors: ConnectorBundle) => void;
  runtimeServices: RuntimeServices;
  activePlanMonitoring: EmailPlanMonitoringService;
  destinationResearch: DestinationResearch;
  getLocalConfiguration: () => LocalConfigurationSnapshot;
  prepareGeneratedPlanEvidence: (planId: string) => Promise<{ workspace: WorkspaceSnapshot; status: "verified" | "partial" }>;
}) {
  const {
    store,
    envPath,
    webAssetsPath,
    webTripMapPath,
    webIndexPath,
    instanceHealth,
    blueprintGenerationEnabled,
    getConnectors,
    replaceConnectors,
    runtimeServices,
    activePlanMonitoring,
    destinationResearch,
    getLocalConfiguration,
    prepareGeneratedPlanEvidence
  } = dependencies;

  await registerLocalWebRoutes(server, { store, webAssetsPath, webTripMapPath, webIndexPath, ...(instanceHealth ? { instanceHealth } : {}) });
  registerPlanningSessionRoutes(server, { store, generation: runtimeServices.planningGeneration,
    ...(runtimeServices.generationAdmission ? { generationAdmission: runtimeServices.generationAdmission } : {}) });
  registerPlanManagementRoutes(server, { store, getMaps: () => getConnectors().maps, startActivePlanMonitoring: activePlanMonitoring.startActivePlanMonitoring, getGeneratingPlan: runtimeServices.getGeneratingPlan });
  registerBookingRoutes(server, { store });
  registerMaintenanceRoutes(server, { store });

  registerRuntimeRoutes(server, { conversationSubmissionConfigured: Boolean(runtimeServices.planningConversation), store, runtimes: runtimeServices.runtimes, getLocalConfiguration, ...(dependencies.getMahDiagnostics ? { getMahDiagnostics: dependencies.getMahDiagnostics } : {}) });

  registerWebAgentRoutes(server, {
    ...(runtimeServices.generationAdmission ? { generationAdmission: runtimeServices.generationAdmission } : {}),
    store,
    blueprintGenerationEnabled,
    generation: runtimeServices.planningGeneration,
    ...(runtimeServices.itineraryContentReview ? { itineraryContentReview: runtimeServices.itineraryContentReview } : {}),
    getGeneratingPlan: runtimeServices.getGeneratingPlan,
    setGeneratingPlan: runtimeServices.setGeneratingPlan,
    business: runtimeServices.business,
    ...(runtimeServices.planningConversation ? { planningConversation: runtimeServices.planningConversation } : {}),
    prepareGeneratedPlanEvidence
  });

  await registerConnectorRoutes(server, {
    store,
    envPath,
    getConnectors,
    replaceConnectors,
    startActivePlanMonitoring:activePlanMonitoring.startActivePlanMonitoring,
    getGeneratingPlan:runtimeServices.getGeneratingPlan
  });

  registerOfficialSourceRoutes(server, {
    store,
    resolvePlanDestination: destinationResearch.resolvePlanDestination,
    sources: { china: destinationResearch.officialSources, japan: destinationResearch.japanOfficialSources }
  });

  registerPlanPresentationRoutes(server, { store, getMaps: () => getConnectors().maps });
}
