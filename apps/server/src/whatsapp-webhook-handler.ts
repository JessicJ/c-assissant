import type { WhatsAppIncomingMessage } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle } from "./connector-bundle.js";
import type { MessagingCommandReply } from "./messaging-replies.js";
import { normalizeWhatsAppUserNumber } from "./whatsapp-number.js";

export function createWhatsAppWebhookHandler(dependencies: {
  store: SqliteWorkspaceStore;
  getConnectors: () => Pick<ConnectorBundle, "whatsapp">;
  allowedUserNumber: () => string | undefined;
  commandResponse: (text: string | undefined, trigger: "whatsapp") => Promise<MessagingCommandReply[] | undefined>;
  sendCommandReplies: (to: string, serviceWindowExpiresAt: string, replies: MessagingCommandReply[]) => Promise<void>;
  logWarning: (message: string) => void;
}) {
  const { store, getConnectors, allowedUserNumber, commandResponse, sendCommandReplies, logWarning } = dependencies;

  return async function processWhatsAppWebhook(messages: WhatsAppIncomingMessage[]): Promise<void> {
    const { whatsapp } = getConnectors();
    const allowedUser = normalizeWhatsAppUserNumber(allowedUserNumber());
    if (!allowedUser) {
      if (messages.length) logWarning("A signed WhatsApp message was ignored because this instance has no paired WhatsApp user number.");
      return;
    }
    for (const message of messages) {
      if (message.from !== allowedUser || !store.claimWhatsAppMessage(message.messageId)) continue;
      if (message.kind === "location") {
        await whatsapp.sendText({ to: message.from, serviceWindowExpiresAt: message.serviceWindowExpiresAt, text: "Location was received but not used or saved. WhatsApp location actions are not connected in this release; use Telegram for nearby food or arrival-route location sharing." });
        continue;
      }
      if (message.kind !== "text" || !message.text) {
        await whatsapp.sendText({ to: message.from, serviceWindowExpiresAt: message.serviceWindowExpiresAt, text: "This WhatsApp interaction is not available yet. Send a text request or /help. Plan confirmation and location buttons remain available in Web or Telegram." });
        continue;
      }
      const responses = await commandResponse(message.text, "whatsapp");
      if (responses) await sendCommandReplies(message.from, message.serviceWindowExpiresAt, responses);
    }
  };
}
