import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ActivePlanMonitoringService } from "./active-plan-monitoring-service.js";
import { createActivePlanMonitoringService } from "./active-plan-monitoring.js";
import type { ConnectorBundle } from "./connector-bundle.js";
import type { CountryPackServices } from "./country-pack-service-contract.js";
import { createMessagingCommandResponder } from "./messaging-command-response.js";
import { createMessagingReplySender } from "./messaging-replies.js";
import type { MessagingServices } from "./messaging-services-contract.js";
import type { RuntimeServices } from "./runtime-services-contract.js";
import { createTelegramLocationActions } from "./telegram-location-actions.js";
import { createTelegramPlanChangeCallbackHandler } from "./telegram-plan-change-handler.js";
import { telegramPlanReplies, withTelegramExecutionContinuity } from "./telegram-plan-replies.js";
import { createTelegramPoller } from "./telegram-poller.js";
import { createTelegramUpdateHandler } from "./telegram-update-handler.js";
import { createWhatsAppWebhookHandler } from "./whatsapp-webhook-handler.js";

export function createMessagingServices(dependencies: {
  store: SqliteWorkspaceStore;
  getConnectors: () => ConnectorBundle;
  runtimeServices: RuntimeServices;
  countryPackServices: CountryPackServices;
  uberClientId: () => string | undefined;
  allowedWhatsAppUserNumber: () => string | undefined;
  logWarning: (details: Record<string, unknown>, message: string) => void;
  logWarningMessage: (message: string) => void;
}): MessagingServices {
  const {
    store,
    getConnectors,
    runtimeServices,
    countryPackServices,
    uberClientId,
    allowedWhatsAppUserNumber,
    logWarning,
    logWarningMessage
  } = dependencies;
  const telegramLocationActions = createTelegramLocationActions({
    store,
    getConnectors: () => getConnectors(),
    uberClientId,
    logWarning
  });
  const activePlanMonitoring = createActivePlanMonitoringService({
    store,
    getConnectors: () => getConnectors(),
    telegramLocationActions,
    logWarning
  });
  const messagingReplies = createMessagingReplySender({
    store,
    getConnectors: () => getConnectors(),
    logWarning
  });
  const messagingCommandResponse = createMessagingCommandResponder({
    store,
    getGeneratingPlan: runtimeServices.getGeneratingPlan,
    setGeneratingPlan: runtimeServices.setGeneratingPlan,
    selectedRuntimeAdapter: runtimeServices.selectedRuntimeAdapter,
    planningGeneration: runtimeServices.planningGeneration,
    telegramLocationActions,
    resolvePlanCountryPack: countryPackServices.resolvePlanCountryPack,
    prepareJapanPlan: countryPackServices.prepareJapanPlan,
    chinaPlanWorkflow: countryPackServices.chinaPlanWorkflow,
    geocodeAddress: (input) => getConnectors().maps.geocodeAddress(input),
    weather: (input) => getConnectors().googleWeather.weather(input)
  });
  const processWhatsAppWebhook = createWhatsAppWebhookHandler({
    store,
    getConnectors: () => getConnectors(),
    allowedUserNumber: allowedWhatsAppUserNumber,
    commandResponse: messagingCommandResponse,
    sendCommandReplies: messagingReplies.sendWhatsAppCommandReplies,
    logWarning: logWarningMessage
  });
  const handleTelegramPlanChangeCallback = createTelegramPlanChangeCallbackHandler({
    store,
    getTelegram: () => getConnectors().telegram,
    getGeneratingPlan: runtimeServices.getGeneratingPlan,
    setGeneratingPlan: runtimeServices.setGeneratingPlan,
    selectedRuntimeAdapter: runtimeServices.selectedRuntimeAdapter,
    planningGeneration: runtimeServices.planningGeneration,
    sendCommandReplies: messagingReplies.sendTelegramCommandReplies,
    planReplies: telegramPlanReplies,
    withExecutionContinuity: withTelegramExecutionContinuity
  });
  const telegramUpdateHandler = createTelegramUpdateHandler({
    store,
    getTelegram: () => getConnectors().telegram,
    activePlanMonitoring,
    telegramLocationActions,
    sendCommandReplies: messagingReplies.sendTelegramCommandReplies,
    commandResponse: messagingCommandResponse,
    handlePlanChangeCallback: handleTelegramPlanChangeCallback
  });
  const telegramPoller = createTelegramPoller({
    store,
    getTelegram: () => getConnectors().telegram,
    updateHandler: telegramUpdateHandler,
    logWarning
  });

  return {
    activePlanMonitoring,
    processWhatsAppWebhook,
    pollTelegram: telegramPoller.pollTelegram
  };
}
export type { ActivePlanMonitoringService };
