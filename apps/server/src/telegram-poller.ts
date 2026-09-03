import type { TelegramConnector } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { TelegramUpdateHandler } from "./telegram-update-handler-contract.js";

export function createTelegramPoller(dependencies: {
  store: SqliteWorkspaceStore;
  getTelegram: () => TelegramConnector;
  updateHandler: TelegramUpdateHandler;
  logWarning: (details: Record<string, unknown>, message: string) => void;
}) {
  const { store, getTelegram, updateHandler, logWarning } = dependencies;
  let pollingTelegram = false;

  async function pollTelegram(): Promise<void> {
    if (pollingTelegram) return;
    const pairing = store.getTelegramPairingStatus();
    if (pairing.state !== "paired" || !pairing.binding) return;
    pollingTelegram = true;
    try {
      const telegram = getTelegram();
      const offset = store.getTelegramUpdateOffset();
      const updates = await telegram.getUpdates({ ...(offset === undefined ? {} : { offset }), timeoutSeconds: 5 });
      if (updates.status !== "available" || !updates.data) return;
      for (const update of updates.data.updates) {
        if (update.chatType !== "private" || update.chatId !== pairing.binding.chatId || update.userId !== pairing.binding.userId) continue;
        if (!store.claimTelegramUpdate(update.updateId)) continue;
        await updateHandler.handleTelegramUpdate(pairing.binding.chatId, update);
      }
      if (updates.data.nextOffset !== undefined) store.advanceTelegramUpdateOffset(updates.data.nextOffset);
    } catch (error) {
      logWarning({ error }, "Telegram polling failed");
    } finally {
      pollingTelegram = false;
    }
  }

  return { pollTelegram };
}
