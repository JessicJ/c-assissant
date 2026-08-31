import type { TelegramReplyMarkup } from "@c-assistant/connectors";

export function normalizeWhatsAppUserNumber(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^\+/, "").replace(/[\s()-]/g, "");
  return normalized && /^\d{7,15}$/.test(normalized) ? normalized : undefined;
}

export function whatsappActionFallback(replyMarkup: TelegramReplyMarkup | undefined, hasLocationIntent: boolean): string | undefined {
  const lines: string[] = [];
  if (replyMarkup && "inline_keyboard" in replyMarkup) {
    for (const row of replyMarkup.inline_keyboard) for (const button of row) {
      if ("url" in button) lines.push(`${button.text}: ${button.url}`);
      else lines.push(`${button.text}: open Landi Web or Telegram to use this action.`);
    }
  }
  if (hasLocationIntent || (replyMarkup && "keyboard" in replyMarkup)) lines.push("Location sharing for this action is currently available through Telegram. A WhatsApp location sent now will not be used or saved.");
  return lines.length ? lines.join("\n") : undefined;
}
