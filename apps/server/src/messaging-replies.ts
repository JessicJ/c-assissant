import type { TelegramReplyMarkup } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle } from "./connector-bundle.js";
import { whatsappActionFallback } from "./whatsapp-channel.js";

export type MessagingCommandReply = {
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  locationIntent?: { purpose: "nearby_food" | "arrival_route" | "uber_test" | "movement_go"; planId: string; transportOverride?: "taxi" | "public_transit" | "walking" };
};

export function createMessagingReplySender(dependencies: {
  store: SqliteWorkspaceStore;
  getConnectors: () => Pick<ConnectorBundle, "telegram" | "whatsapp">;
  logWarning: (details: Record<string, unknown>, message: string) => void;
}) {
  const { store, getConnectors, logWarning } = dependencies;

  async function sendTelegramCommandReplies(chatId: string, replies: MessagingCommandReply[]): Promise<void> {
    const { telegram } = getConnectors();
    for (const reply of replies) {
      const { locationIntent, ...message } = reply;
      const receipt = await telegram.sendMessage({ chatId, ...message });
      if (receipt.status === "available") {
        if (locationIntent) store.startTelegramLocationIntent(locationIntent);
        continue;
      }
      logWarning({ status: receipt.status, code: receipt.failure?.code }, "Telegram command response could not be delivered completely");
      return;
    }
  }

  async function sendWhatsAppCommandReplies(to: string, serviceWindowExpiresAt: string, replies: MessagingCommandReply[]): Promise<void> {
    const { whatsapp } = getConnectors();
    for (const reply of replies) {
      const receipt = await whatsapp.sendText({ to, text: reply.text, serviceWindowExpiresAt });
      if (receipt.status !== "available") {
        logWarning({ status: receipt.status, code: receipt.failure?.code }, "WhatsApp command response could not be delivered completely");
        return;
      }
      const actionText = whatsappActionFallback(reply.replyMarkup, Boolean(reply.locationIntent));
      if (!actionText) continue;
      const actionReceipt = await whatsapp.sendText({ to, text: actionText, serviceWindowExpiresAt });
      if (actionReceipt.status !== "available") {
        logWarning({ status: actionReceipt.status, code: actionReceipt.failure?.code }, "WhatsApp action fallback could not be delivered");
        return;
      }
    }
  }

  return { sendTelegramCommandReplies, sendWhatsAppCommandReplies };
}
