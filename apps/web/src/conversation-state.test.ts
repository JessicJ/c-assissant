import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanningSession } from "@c-assistant/core";
import { conversationFromPlanningSession, conversationStorageKey, loadConversation } from "./conversation-state.js";

class ReadStorage {
  constructor(private readonly values: Record<string, string | null>) {}
  getItem(key: string): string | null { return this.values[key] ?? null; }
}

describe("conversation state", () => {
  it("loads valid saved conversation data", () => {
    const storage = new ReadStorage({ chat: JSON.stringify([{ id: "m1", role: "user", text: "Kyoto" }]) });

    assert.deepEqual(loadConversation(storage, "chat", "Welcome"), [{ id: "m1", role: "user", text: "Kyoto" }]);
  });

  it("falls back to welcome copy for malformed saved data", () => {
    const storage = new ReadStorage({ chat: JSON.stringify([{ id: "m1", role: "system", text: "No" }]) });

    assert.deepEqual(loadConversation(storage, "chat", "Welcome"), [{ id: "welcome", role: "assistant", text: "Welcome" }]);
  });

  it("uses planning session messages before welcome copy", () => {
    const session = { messages: [{ id: "m1", role: "assistant", text: "Question", createdAt: "2026-09-01T00:00:00.000Z" }] } as PlanningSession;

    assert.deepEqual(conversationFromPlanningSession(session, "Welcome"), [{ id: "m1", role: "assistant", text: "Question" }]);
  });

  it("builds stable conversation keys", () => {
    assert.equal(conversationStorageKey("new_plan"), "landi.conversation.new_plan.new");
    assert.equal(conversationStorageKey("revise_plan", "plan-1"), "landi.conversation.revise_plan.plan-1");
  });
});
