import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createConnectorServices } from "./connector-services.js";
import { createCountryPackServices } from "./country-pack-services.js";
import { createGeneratedPlanEvidencePreparer } from "./generated-plan-evidence.js";
import { createMessagingServices } from "./messaging-services.js";
import { createRuntimeServices } from "./runtime-services.js";
import type { SemanticShadowConfig } from "./semantic-shadow.js";
import type { SemanticDraftCanaryConfig } from "./semantic-draft-canary.js";

export function createAppServices(dependencies: {
  projectRoot: string;
  store: SqliteWorkspaceStore;
  semanticShadow: SemanticShadowConfig;
  semanticDraftCanary: SemanticDraftCanaryConfig;
  uberClientId: () => string | undefined;
  allowedWhatsAppUserNumber: () => string | undefined;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
  logWarning: (details: Record<string, unknown>, message: string) => void;
  logWarningMessage: (message: string) => void;
}) {
  const {
    projectRoot,
    store,
    semanticShadow,
    semanticDraftCanary,
    uberClientId,
    allowedWhatsAppUserNumber,
    logGenerationFailure,
    logWarning,
    logWarningMessage
  } = dependencies;
  const connectorServices = createConnectorServices();
  const countryPackServices = createCountryPackServices({
    projectRoot,
    store,
    getConnectors: connectorServices.getConnectors
  });
  const {
    chinaSourcePreparation,
    japanSourcePreparation,
    resolvePlanCountryPack
  } = countryPackServices;
  const runtimeServices = createRuntimeServices({ store, semanticShadow, semanticDraftCanary, logGenerationFailure });
  const prepareGeneratedPlanEvidence = createGeneratedPlanEvidencePreparer({
    store,
    getMaps: () => connectorServices.getConnectors().maps,
    getWeather: () => connectorServices.getConnectors().googleWeather,
    resolvePlanCountryPack,
    sourcePreparation: {
      china: chinaSourcePreparation,
      japan: japanSourcePreparation
    }
  });
  const messagingServices = createMessagingServices({
    store,
    getConnectors: connectorServices.getConnectors,
    runtimeServices,
    countryPackServices,
    uberClientId,
    allowedWhatsAppUserNumber,
    logWarning,
    logWarningMessage
  });

  return {
    connectorServices,
    countryPackServices,
    runtimeServices,
    messagingServices,
    prepareGeneratedPlanEvidence
  };
}
