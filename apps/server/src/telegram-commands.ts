export type TelegramCommand =
  | { type: "empty" }
  | { type: "help" }
  | { type: "plan" }
  | { type: "start" }
  | { type: "create_plan"; request: string; explicit: boolean }
  | { type: "unknown_command" };

/** Keeps normal chat expressive while reserving slash commands for controls. */
export function parseTelegramCommand(text: string | undefined): TelegramCommand {
  const normalized = text?.trim();
  if (!normalized) return { type: "empty" };
  if (/^\/help(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "help" };
  if (/^\/plan(?:@[-_A-Za-z0-9]+)?$/i.test(normalized)) return { type: "plan" };
  if (/^\/start(?:@[-_A-Za-z0-9]+)?(?:\s|$)/i.test(normalized)) return { type: "start" };
  const explicit = normalized.match(/^\/new(?:@[-_A-Za-z0-9]+)?\s+(.+)$/is)?.[1]?.trim();
  if (explicit) return { type: "create_plan", request: explicit, explicit: true };
  if (normalized.startsWith("/")) return { type: "unknown_command" };
  return { type: "create_plan", request: normalized, explicit: false };
}
