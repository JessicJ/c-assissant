import { type EmailReviewConfiguration } from "./email-review-capability.js";
import { registerEmailReviewRoutes } from "./email-review-routes.js";
import type { FastifyInstance } from "fastify";
import { randomInt, randomUUID } from "node:crypto";
import { validEmailAddress, type EmailTransport } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createEmailTransportFromEnvironment } from "./email-transport.js";
import { saveLocalConfiguration } from "./connector-configuration.js";

export function registerEmailExecutionRoutes(server: FastifyInstance, dependencies: { store: SqliteWorkspaceStore; envPath: string; getTransport?: () => EmailTransport; getReviewConfiguration?:()=>EmailReviewConfiguration|undefined; startActivePlanMonitoring?:()=>void; getGeneratingPlan?:()=>boolean }) {
  const { store } = dependencies;
  registerEmailReviewRoutes(server,{store});
  const transport = dependencies.getTransport ?? createEmailTransportFromEnvironment;
  const senderSettings=()=>({host:process.env.LANDI_SMTP_HOST ?? "",port:Number(process.env.LANDI_SMTP_PORT ?? 587),user:process.env.LANDI_SMTP_USER ?? "",from:process.env.LANDI_EMAIL_FROM ?? "",passwordSaved:Boolean(process.env.LANDI_SMTP_PASSWORD)});
  const snapshot = () => ({sender:senderSettings(),timing:store.getExecutionPlan()?store.email.timingStatus(store.getExecutionPlan()!.id,store.getExecutionPlan()!.version):"no_plan", settings: store.email.settings(), senderConfigured: transport().configured(), review: {configured:false,baseUrl:""}, deliveries: store.email.list(30).map(({ id, kind, date, dueAt, status, attempts, failureCode, content }) => ({ id, kind, date, dueAt, status, attempts, contentStatus: content?.research?.status ?? "pending", ...(failureCode ? { failureCode } : {}) })) });
  const allowedMutation = (origin: string | undefined, host: string | undefined): boolean => { if (!origin) return true; try { return new URL(origin).host === host; } catch { return false; } };
  server.get("/api/email-execution", async () => snapshot());
  server.put<{ Body: { recipient?: string; cityTimeZones?: Record<string,string> } }>("/api/email-execution/settings", async (request, reply) => {
    if (!allowedMutation(request.headers.origin, request.headers.host)) return reply.code(403).send({ error: "Open Landi before changing email settings." });
    const body = request.body;
    if(typeof body?.recipient!=="string" || !validEmailAddress(body.recipient.trim()) || Object.keys(body).some(key=>!["recipient","cityTimeZones"].includes(key)))return reply.code(400).send({error:"Enter a valid recipient. Email timing is arranged from your approved itinerary."});
    if (body.cityTimeZones !== undefined) {
      if (!body.cityTimeZones || Array.isArray(body.cityTimeZones) || typeof body.cityTimeZones !== "object" || Object.keys(body.cityTimeZones).length > 30) return reply.code(400).send({error:"Choose a valid time zone for each destination."});
      try { for (const [city,zone] of Object.entries(body.cityTimeZones)) { if (!city.trim() || city.length > 120 || typeof zone !== "string") throw new Error();new Intl.DateTimeFormat("en",{timeZone:zone}).format(new Date()); } }
      catch { return reply.code(400).send({error:"Choose a valid time zone for each destination."}); }
    }
    store.email.updateSettings({ recipient: body.recipient.trim(), ...(body.cityTimeZones ? {cityTimeZones:Object.fromEntries(Object.entries(body.cityTimeZones).map(([city,zone])=>[city.trim().toLowerCase(),zone]))} : {}) });
    return snapshot();
  });
  server.put<{ Body: { host?: string; port?: number; user?: string; password?: string; from?: string } }>("/api/email-execution/sender", async (request, reply) => {
    if (!allowedMutation(request.headers.origin, request.headers.host)) return reply.code(403).send({ error: "Open Landi before configuring the sender." });
    const input = request.body;
    if (!input || typeof input.host !== "string" || !/^[a-z0-9.-]+$/i.test(input.host) || ![465, 587].includes(input.port ?? 0) || typeof input.user !== "string" || !input.user.trim() || /[\r\n]/.test(input.user) || typeof input.from !== "string" || !validEmailAddress(input.from.trim()) || input.password !== undefined && (typeof input.password !== "string" || /[\r\n]/.test(input.password))) return reply.code(400).send({ error: "Enter the SMTP server, secure port, account and sender address." });
    if(!input.password?.trim() && (!senderSettings().passwordSaved || input.user.trim()!==senderSettings().user))return reply.code(400).send({error:"Enter an app password for this sender account."});
    try {
      saveLocalConfiguration(dependencies.envPath, { smtpHost: input.host, smtpPort: input.port!, smtpUser: input.user.trim(), ...(input.password?.trim() ? { smtpPassword: input.password.trim() } : {}), emailFrom: input.from.trim() });
      return snapshot();
    } catch { return reply.code(500).send({ error: "The sender configuration could not be saved." }); }
  });
  server.put("/api/email-execution/review",async(_request,reply)=>reply.code(410).send({code:"email_review_retired",error:"Review and confirm itinerary changes in your Landi workspace."}));
  server.post("/api/email-execution/timing/retry",async(request,reply)=>{
    if(!allowedMutation(request.headers.origin,request.headers.host))return reply.code(403).send({error:"Open Landi before arranging emails."});
    const plan=store.getExecutionPlan();if(plan)store.email.retryTiming(plan.id,plan.version);
    return snapshot();
  });
  server.post("/api/email-execution/sender/check", async (request, reply) => {
    if (!allowedMutation(request.headers.origin, request.headers.host)) return reply.code(403).send({ error: "Open Landi before checking the sender." });
    const result = await transport().verify();
    const error=result.code==="smtp_connection_failed"
      ? "A secure connection to the mail server could not be completed. Check your network or proxy and try again. Account authorization has not been confirmed."
      : result.code==="smtp_authorization_failed"
        ? "The mail server rejected account authorization. Check the sender account and its app password."
        : "The sender could not be verified. Check the saved configuration and try again.";
    return result.ready ? { ready: true } : reply.code(503).send({ error, code: result.code });
  });
  server.post("/api/email-execution/verification", async (request, reply) => {
    if (!allowedMutation(request.headers.origin, request.headers.host)) return reply.code(403).send({ error: "Open Landi before sending a verification email." });
    const settings = store.email.settings();
    if (!transport().configured() || !validEmailAddress(settings.recipient)) return reply.code(409).send({ error: "Save the sender and recipient before requesting verification." });
    const code = String(randomInt(100000, 1000000));
    if (!store.email.beginVerification(code, new Date(Date.now() + 15 * 60_000).toISOString())) return reply.code(429).send({ error: "A verification request is already pending. Use its code or wait until it expires." });
    let result;
    try { result = await transport().send({ to: settings.recipient, subject: "Landi · Verify your travel email", text: `Your verification code is ${code}. It expires in 15 minutes.`, html: `<p>Your Landi verification code: <strong>${code}</strong></p><p>It expires in 15 minutes.</p>`, messageId: `<${randomUUID()}@landi.local>` }); }
    catch { result = { status: "uncertain" as const, code: "verification_delivery_unknown", retryable: false }; }
    store.email.finishVerificationSend(settings.revision, result.status === "accepted" ? "accepted" : result.status === "uncertain" ? "uncertain" : "failed");
    return result.status === "accepted" ? { accepted: true } : reply.code(503).send({ error: result.status === "uncertain" ? "Delivery could not be confirmed. Wait before requesting another code." : "The verification email could not be accepted. Check sender configuration." });
  });
  server.post<{ Body: { code?: string } }>("/api/email-execution/verify", async (request, reply) => {
    if (!allowedMutation(request.headers.origin, request.headers.host)) return reply.code(403).send({ error: "Open Landi before verifying the recipient." });
    if (!/^\d{6}$/.test(request.body?.code ?? "") || !store.email.verifyRecipient(request.body.code!, new Date().toISOString())) return reply.code(400).send({ error: "The code is incorrect, expired or no longer valid. Request a new code when the pending request expires." });
    return snapshot();
  });
  server.post<{ Body: { enabled?: boolean } }>("/api/email-execution/activation", async (request, reply) => {
    if (!allowedMutation(request.headers.origin, request.headers.host)) return reply.code(403).send({ error: "Open Landi before changing email delivery." });
    if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ error: "Choose whether to enable email delivery." });
    if (request.body.enabled && (!transport().configured() || !store.email.settings().verified)) return reply.code(409).send({ error: "Configure the sender and verify the recipient first." });
    store.email.setEnabled(request.body.enabled);
    return snapshot();
  });
}
