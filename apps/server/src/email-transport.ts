import { SmtpEmailConnector, type EmailTransport } from "@c-assistant/connectors";

/** Credentials are read only when composing the runtime transport. Never project them. */
export function createEmailTransportFromEnvironment(): EmailTransport {
  const interfaceName = process.env.LANDI_SMTP_DIRECT_INTERFACE?.trim() ?? "";
  const dnsServers = (process.env.LANDI_SMTP_DIRECT_DNS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const dnsHttpsProxy = process.env.LANDI_SMTP_DNS_HTTPS_PROXY?.trim();
  return new SmtpEmailConnector({ host: process.env.LANDI_SMTP_HOST, port: Number(process.env.LANDI_SMTP_PORT ?? 587), user: process.env.LANDI_SMTP_USER, password: process.env.LANDI_SMTP_PASSWORD, from: process.env.LANDI_EMAIL_FROM,
    ...(interfaceName || dnsServers.length || dnsHttpsProxy ? { direct: { interfaceName, dnsServers, ...(dnsHttpsProxy ? { dnsHttpsProxy } : {}) } } : {}) });
}
