import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { normalizeWhatsAppUserNumber } from "./whatsapp-number.js";

export type LocalConfigurationUpdate = {
  googleMapsApiKey?: string;
  uberClientId?: string;
  telegramBotToken?: string;
  whatsappAccessToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  whatsappAppSecret?: string;
  whatsappVerifyToken?: string;
  whatsappAllowedUserNumber?: string;
  whatsappReminderTemplateName?: string;
  whatsappGraphApiVersion?: string;
};

export function saveLocalConfiguration(envPath: string, update: LocalConfigurationUpdate): void {
  const values: Record<string, string> = {};
  if (update.googleMapsApiKey?.trim()) values.GOOGLE_MAPS_API_KEY = update.googleMapsApiKey.trim();
  if (update.uberClientId?.trim()) values.UBER_CLIENT_ID = update.uberClientId.trim();
  if (update.telegramBotToken?.trim()) values.TELEGRAM_BOT_TOKEN = update.telegramBotToken.trim();
  if (update.whatsappAccessToken?.trim()) values.WHATSAPP_ACCESS_TOKEN = update.whatsappAccessToken.trim();
  if (update.whatsappPhoneNumberId?.trim()) values.WHATSAPP_PHONE_NUMBER_ID = update.whatsappPhoneNumberId.trim();
  if (update.whatsappBusinessAccountId?.trim()) values.WHATSAPP_BUSINESS_ACCOUNT_ID = update.whatsappBusinessAccountId.trim();
  if (update.whatsappAppSecret?.trim()) values.WHATSAPP_APP_SECRET = update.whatsappAppSecret.trim();
  if (update.whatsappVerifyToken?.trim()) values.WHATSAPP_VERIFY_TOKEN = update.whatsappVerifyToken.trim();
  if (update.whatsappAllowedUserNumber?.trim()) {
    const normalized = normalizeWhatsAppUserNumber(update.whatsappAllowedUserNumber);
    if (!normalized) throw new Error("WhatsApp user number must include a valid international country code.");
    values.WHATSAPP_ALLOWED_USER_NUMBER = normalized;
  }
  if (update.whatsappReminderTemplateName?.trim()) values.WHATSAPP_REMINDER_TEMPLATE_NAME = update.whatsappReminderTemplateName.trim();
  if (update.whatsappGraphApiVersion?.trim()) values.WHATSAPP_GRAPH_API_VERSION = update.whatsappGraphApiVersion.trim();
  if (!Object.keys(values).length) return;

  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value.replaceAll(/\r?\n/g, "")}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
    process.env[key] = value;
  }
  writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });
}
