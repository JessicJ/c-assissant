import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorResult, TelegramConnector, TelegramIncomingUpdate, TelegramUpdateBatch } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createTelegramPoller } from "./telegram-poller.js";

test("Telegram poller claims only paired private updates and advances the offset", async () => {
  const handled: Array<{ chatId: string; updateId: number }> = [];
  const getUpdatesInputs: unknown[] = [];
  let advancedOffset: number | undefined;
  const claimed = new Set<number>();
  const pairedUpdate: TelegramIncomingUpdate = {
    updateId: 41,
    kind: "message",
    chatId: "chat-1",
    chatType: "private",
    userId: "user-1",
    firstName: "Avery",
    text: "/help"
  };
  const ignoredWrongChat: TelegramIncomingUpdate = { ...pairedUpdate, updateId: 42, chatId: "chat-2" };
  const ignoredGroup: TelegramIncomingUpdate = { ...pairedUpdate, updateId: 43, chatType: "group" };
  const batch: ConnectorResult<TelegramUpdateBatch> = {
    status: "available",
    provider: "telegram",
    observedAt: "2026-08-07T00:00:00.000Z",
    data: { updates: [pairedUpdate, ignoredWrongChat, ignoredGroup], nextOffset: 44 }
  };
  const store = {
    getTelegramPairingStatus: () => ({ state: "paired", binding: { chatId: "chat-1", userId: "user-1" } }),
    getTelegramUpdateOffset: () => 40,
    claimTelegramUpdate: (updateId: number) => {
      if (claimed.has(updateId)) return false;
      claimed.add(updateId);
      return true;
    },
    advanceTelegramUpdateOffset: (nextOffset: number) => { advancedOffset = nextOffset; }
  } as unknown as SqliteWorkspaceStore;
  const telegram = {
    getUpdates: async (input: unknown) => {
      getUpdatesInputs.push(input);
      return batch;
    }
  } as unknown as TelegramConnector;
  const poller = createTelegramPoller({
    store,
    getTelegram: () => telegram,
    updateHandler: {
      handleTelegramUpdate: async (chatId, update) => {
        handled.push({ chatId, updateId: update.updateId });
      }
    },
    logWarning: () => undefined
  });

  await poller.pollTelegram();
  await poller.pollTelegram();

  assert.deepEqual(getUpdatesInputs, [{ offset: 40, timeoutSeconds: 5 }, { offset: 40, timeoutSeconds: 5 }]);
  assert.deepEqual(handled, [{ chatId: "chat-1", updateId: 41 }]);
  assert.equal(advancedOffset, 44);
});

test("Telegram poller does nothing while unpaired", async () => {
  let getUpdatesCalled = false;
  const store = {
    getTelegramPairingStatus: () => ({ state: "not_configured" })
  } as unknown as SqliteWorkspaceStore;
  const poller = createTelegramPoller({
    store,
    getTelegram: () => ({ getUpdates: async () => {
      getUpdatesCalled = true;
      return { status: "available", provider: "telegram", observedAt: "2026-08-07T00:00:00.000Z", data: { updates: [] } };
    } }) as unknown as TelegramConnector,
    updateHandler: { handleTelegramUpdate: async () => undefined },
    logWarning: () => undefined
  });

  await poller.pollTelegram();

  assert.equal(getUpdatesCalled, false);
});
