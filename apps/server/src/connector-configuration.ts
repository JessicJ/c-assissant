import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type LocalConfigurationUpdate = {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpDirectInterface?: string;
  smtpDirectDns?: string;
  smtpDnsHttpsProxy?: string;
  emailFrom?: string;
  emailReviewBaseUrl?: string;
  emailActionSecret?: string;
  googleMapsApiKey?: string;
  uberClientId?: string;
};

export function saveLocalConfiguration(envPath: string, update: LocalConfigurationUpdate): void {
  if (Object.keys(update).some(key => key.startsWith("telegram") || key.startsWith("whatsapp"))) {
    throw new Error("Chat channels are retired. Configure email assistance instead.");
  }
  const values: Record<string, string> = {};
  if (update.smtpHost) values.LANDI_SMTP_HOST = update.smtpHost;
  if (update.smtpPort) values.LANDI_SMTP_PORT = String(update.smtpPort);
  if (update.smtpUser) values.LANDI_SMTP_USER = update.smtpUser;
  if (update.smtpPassword) values.LANDI_SMTP_PASSWORD = update.smtpPassword;
  if (update.smtpDirectInterface !== undefined) values.LANDI_SMTP_DIRECT_INTERFACE = update.smtpDirectInterface;
  if (update.smtpDirectDns !== undefined) values.LANDI_SMTP_DIRECT_DNS = update.smtpDirectDns;
  if (update.smtpDnsHttpsProxy !== undefined) values.LANDI_SMTP_DNS_HTTPS_PROXY = update.smtpDnsHttpsProxy;
  if (update.emailReviewBaseUrl !== undefined) values.LANDI_EMAIL_REVIEW_BASE_URL=update.emailReviewBaseUrl;
  if (update.emailActionSecret) values.LANDI_EMAIL_ACTION_SECRET=update.emailActionSecret;
  if (update.emailFrom) values.LANDI_EMAIL_FROM = update.emailFrom;
  if (update.googleMapsApiKey?.trim()) values.GOOGLE_MAPS_API_KEY = update.googleMapsApiKey.trim();
  if (update.uberClientId?.trim()) values.UBER_CLIENT_ID = update.uberClientId.trim();
  if (!Object.keys(values).length) return;

  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${key === "LANDI_SMTP_PASSWORD" ? JSON.stringify(value) : value.replaceAll(/\r?\n/g, "")}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    content = pattern.test(content) ? content.replace(pattern, () => line) : `${content.trimEnd()}\n${line}\n`;
    process.env[key] = value;
  }
  writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });
}
