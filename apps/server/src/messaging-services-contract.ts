import type { WhatsAppIncomingMessage } from "@c-assistant/connectors";
import type { ActivePlanMonitoringService } from "./active-plan-monitoring-service.js";

export interface MessagingServices {
  activePlanMonitoring: ActivePlanMonitoringService;
  processWhatsAppWebhook(messages: WhatsAppIncomingMessage[]): Promise<void>;
  pollTelegram(): Promise<void>;
}
