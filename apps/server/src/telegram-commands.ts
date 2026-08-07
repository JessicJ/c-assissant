export type TelegramCommand =
  | { type: "empty" }
  | { type: "help" }
  | { type: "plan" }
  | { type: "profile" }
  | { type: "weather" }
  | { type: "food"; partySize?: number }
  | { type: "start" }
  | { type: "create_plan"; request: string; explicit: boolean }
  | { type: "unknown_command" };

/** Keeps normal chat expressive while reserving slash commands for controls. */
export function parseTelegramCommand(text: string | undefined): TelegramCommand {
  const normalized = text?.trim();
  if (!normalized) return { type: "empty" };
  if (/^\/help(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "help" };
  if (/^\/plan(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "plan" };
  if (/^\/profile(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "profile" };
  if (/^\/weather(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "weather" };
  const food = normalized.match(/^\/food(?:@[-_A-Za-z0-9]+)?(?:\s+(\d+))?$/i);
  if (food) return { type: "food", ...(food[1] ? { partySize: Number(food[1]) } : {}) };
  if (/^\/start(?:@[-_A-Za-z0-9]+)?(?:\s|$)/i.test(normalized)) return { type: "start" };
  const explicit = normalized.match(/^\/new(?:@[-_A-Za-z0-9]+)?\s+(.+)$/is)?.[1]?.trim();
  if (explicit) return { type: "create_plan", request: explicit, explicit: true };
  if (normalized.startsWith("/")) return { type: "unknown_command" };
  return { type: "create_plan", request: normalized, explicit: false };
}
