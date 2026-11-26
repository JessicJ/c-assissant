import nodemailer, { type SendMailOptions } from "nodemailer";
import { openDirectSmtpConnection, type DirectSmtpConfiguration } from "./email-direct-socket.js";

export interface EmailMessage { to: string; subject: string; html: string; text: string; messageId: string; attachments?:import("@c-assistant/core").EmailInlineAttachment[] }
export type EmailSendResult =
  | { status: "accepted"; messageId: string }
  | { status: "not_configured" | "rejected" | "uncertain"; code: string; retryable: boolean };
export interface EmailTransport {
  configured(): boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
  verify(): Promise<{ ready: boolean; code?: string }>;
}
export interface SmtpConfiguration { host?: string | undefined; port?: number | undefined; user?: string | undefined; password?: string | undefined; from?: string | undefined; direct?: DirectSmtpConfiguration | undefined }
type Client = { sendMail(input: SendMailOptions): Promise<{ messageId: string; accepted?: unknown[] }>; verify(): Promise<unknown> };

export function validEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(value);
}

/** SMTP acceptance is not inbox delivery. Unknown outcomes must not be blindly retried. */
export class SmtpEmailConnector implements EmailTransport {
  constructor(private readonly config: SmtpConfiguration, private readonly injectedClient?: Client) {}
  configured(): boolean {
    return Boolean(this.config.host && /^[a-z0-9.-]+$/i.test(this.config.host) && [465, 587].includes(this.config.port ?? 587) && this.config.user && this.config.password && this.config.from && validEmailAddress(this.config.from));
  }
  private client(): Client {
    return this.injectedClient ?? nodemailer.createTransport({ host: this.config.host, port: this.config.port ?? 587, secure: this.config.port === 465, requireTLS: this.config.port !== 465,
      auth: { user: this.config.user!, pass: this.config.password! }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: this.config.host }, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      ...(this.config.direct ? { getSocket: (_options: unknown, callback: (error: Error | null, socketOptions: object) => void) => {
        void openDirectSmtpConnection(this.config.host!, this.config.port ?? 587, this.config.direct!).then(
          connection => callback(null, { connection, secured: false }),
          error => callback(error as Error, {})
        );
      } } : {}) });
  }
  async verify(): Promise<{ ready: boolean; code?: string }> {
    if (!this.configured()) return { ready: false, code: "smtp_not_configured" };
    try { await this.client().verify(); return { ready: true }; }
    catch (error) {
      const failure=error as {code?:string;command?:string};
      if(failure?.code==="EAUTH")return {ready:false,code:"smtp_authorization_failed"};
      if(failure?.command==="CONN" || ["EDNS","ECONNECTION","ETIMEDOUT","ECONNRESET","ECONNREFUSED","ESOCKET"].includes(failure?.code ?? ""))return {ready:false,code:"smtp_connection_failed"};
      return {ready:false,code:"smtp_verification_failed"};
    }
  }
  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.configured()) return { status: "not_configured", code: "smtp_not_configured", retryable: false };
    if (!validEmailAddress(message.to) || /[\r\n]/.test(message.subject) || !/^<[a-f0-9-]+@landi\.local>$/.test(message.messageId)) return { status: "rejected", code: "invalid_email_message", retryable: false };
    let attachments: NonNullable<SendMailOptions["attachments"]> = [];
    try {
      const refs = [...message.html.matchAll(/src="cid:([^"<>]+)"/g)].map(match => match[1]!);
      const cids = new Set<string>(); let total = 0;
      if ((message.attachments?.length ?? 0) > 24) throw new Error();
      attachments = (message.attachments ?? []).map(asset => {
        const png=asset.contentType==="image/png",jpeg=asset.contentType==="image/jpeg";
        if (!/^[a-z0-9.-]+@landi\.assets$/.test(asset.cid) || cids.has(asset.cid) || !(png?/^[a-z0-9-]+\.png$/:jpeg?/^[a-z0-9-]+\.jpg$/:/a^/).test(asset.filename) || asset.contentBase64.length > (jpeg?400000:90000) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.contentBase64)) throw new Error();
        const content = Buffer.from(asset.contentBase64, "base64"); total += content.length;
        const valid=png?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):jpeg&&content[0]===255&&content[1]===216&&content.at(-2)===255&&content.at(-1)===217;
        if (!valid || content.length < 24 || total > 512000) throw new Error();
        cids.add(asset.cid);
        return { filename: asset.filename, cid: asset.cid, content, contentType: asset.contentType, contentDisposition: "inline" as const };
      });
      if (refs.some(cid => !cids.has(cid)) || [...cids].some(cid => !refs.includes(cid))) throw new Error();
    } catch { return { status: "rejected", code: "invalid_email_attachments", retryable: false }; }
    try {
      const result = await this.client().sendMail({ from: { name: "Landi", address: this.config.from! }, to: message.to, subject: message.subject, html: message.html, text: message.text, messageId: message.messageId, attachments, disableFileAccess: true, disableUrlAccess: true });
      if (result.accepted?.some(address => typeof address === "string" && address.toLowerCase() === message.to.toLowerCase())) return { status: "accepted", messageId: message.messageId };
      return { status: "uncertain", code: "smtp_acceptance_unconfirmed", retryable: false };
    } catch (error) {
      const failure = error as { command?: string; responseCode?: number; code?: string };
      // Explicit negative replies establish non-acceptance. A timeout during DATA does not.
      if (failure.responseCode && failure.responseCode >= 400 && failure.responseCode < 600) return { status: "rejected", code: "smtp_rejected", retryable: failure.responseCode < 500 };
      if (failure.command === "CONN" || ["EDNS", "ECONNECTION", "EAUTH"].includes(failure.code ?? "")) return { status: "rejected", code: "smtp_connection_or_authorization_failed", retryable: failure.code !== "EAUTH" };
      return { status: "uncertain", code: "smtp_delivery_unknown", retryable: false };
    }
  }
}
