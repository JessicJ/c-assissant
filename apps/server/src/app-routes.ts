import type { FastifyInstance } from "fastify";
import type { WorkspaceSnapshot } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle, LocalConfigurationSnapshot } from "./connector-bundle.js";
import { registerConnectorRoutes } from "./connector-routes.js";
import type { CountryPackServices } from "./country-pack-service-contract.js";
import { registerBookingRoutes } from "./booking-routes.js";
import { registerCountryPackRoutes } from "./country-pack-routes.js";
import type { MessagingServices } from "./messaging-services-contract.js";
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
  envPath: string;
  webAssetsPath: string;
  webTripMapPath: string;
  webIndexPath: string;
  blueprintGenerationEnabled: boolean;
  getConnectors: () => ConnectorBundle;
  replaceConnectors: (connectors: ConnectorBundle) => void;
  runtimeServices: RuntimeServices;
  messagingServices: MessagingServices;
  countryPackServices: CountryPackServices;
  getLocalConfiguration: () => LocalConfigurationSnapshot;
  prepareGeneratedPlanEvidence: (planId: string) => Promise<{ workspace: WorkspaceSnapshot; status: "verified" | "partial" }>;
}) {
  const {
    store,
    envPath,
    webAssetsPath,
    webTripMapPath,
    webIndexPath,
    blueprintGenerationEnabled,
    getConnectors,
    replaceConnectors,
    runtimeServices,
    messagingServices,
    countryPackServices,
    getLocalConfiguration,
    prepareGeneratedPlanEvidence
  } = dependencies;

  await registerLocalWebRoutes(server, { store, webAssetsPath, webTripMapPath, webIndexPath });
  registerPlanningSessionRoutes(server, { store, generation: runtimeServices.planningGeneration });
  registerPlanManagementRoutes(server, { store, getMaps: () => getConnectors().maps, startActivePlanMonitoring: messagingServices.activePlanMonitoring.startActivePlanMonitoring, getGeneratingPlan: runtimeServices.getGeneratingPlan });
  registerBookingRoutes(server, { store });
  registerMaintenanceRoutes(server, { store });

  registerCountryPackRoutes(server, {
    store,
    resolvePlanCountryPack: countryPackServices.resolvePlanCountryPack,
    chinaPlanWorkflow: countryPackServices.chinaPlanWorkflow,
    prepareJapanPlan: countryPackServices.prepareJapanPlan
  });

  registerRuntimeRoutes(server, { store, runtimes: runtimeServices.runtimes, getLocalConfiguration });

  registerWebAgentRoutes(server, {
    store,
    blueprintGenerationEnabled,
    generation: runtimeServices.planningGeneration,
    getGeneratingPlan: runtimeServices.getGeneratingPlan,
    setGeneratingPlan: runtimeServices.setGeneratingPlan,
    selectedRuntimeAdapter: runtimeServices.selectedRuntimeAdapter,
    prepareGeneratedPlanEvidence
  });

  await registerConnectorRoutes(server, {
    store,
    envPath,
    getConnectors,
    replaceConnectors,
    processWhatsAppWebhook: messagingServices.processWhatsAppWebhook
  });

  registerOfficialSourceRoutes(server, {
    store,
    resolvePlanCountryPack: countryPackServices.resolvePlanCountryPack,
    sources: { china: countryPackServices.officialSources, japan: countryPackServices.japanOfficialSources }
  });

  registerPlanPresentationRoutes(server, { store, getMaps: () => getConnectors().maps });
}
