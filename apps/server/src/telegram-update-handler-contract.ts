import type { TelegramIncomingUpdate } from "@c-assistant/connectors";

export interface TelegramUpdateHandler {
  handleTelegramUpdate(chatId: string, update: TelegramIncomingUpdate): Promise<void>;
}
