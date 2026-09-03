import type { PlanningSession } from "@c-assistant/core";

export type ChatMessage = { id: string; role: "assistant" | "user"; text: string };
export type ConversationMode = "new_plan" | "revise_plan";
export type ConversationStorage = Pick<Storage, "getItem">;

export function loadConversation(storage: ConversationStorage, key: string, welcome: string): ChatMessage[] {
  try {
    const saved = JSON.parse(storage.getItem(key) ?? "null") as ChatMessage[] | null;
    if (Array.isArray(saved) && saved.length && saved.every((message) => message && (message.role === "assistant" || message.role === "user") && typeof message.text === "string")) return saved;
  } catch { /* Ignore malformed local conversation data and start clean. */ }
  return [{ id: "welcome", role: "assistant", text: welcome }];
}

export function conversationFromPlanningSession(session: PlanningSession | undefined, welcome: string): ChatMessage[] {
  if (session?.messages.length) return session.messages.map((message) => ({ id: message.id, role: message.role, text: message.text }));
  return [{ id: "welcome", role: "assistant", text: welcome }];
}

export function conversationStorageKey(mode: ConversationMode, planId?: string): string {
  return `landi.conversation.${mode}.${planId ?? "new"}`;
}
