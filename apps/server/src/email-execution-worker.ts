import type { MaintenanceControl } from "./maintenance-control.js";
import type { SqliteWorkspaceStore, EmailJob } from "@c-assistant/storage";
import type { EmailTransport } from "@c-assistant/connectors";
import { bookingRelationshipDigest, type Plan } from "@c-assistant/core";
import type { RenderedEmail } from "./email-templates/types.js";

export function createEmailExecutionWorker(dependencies: {
  maintenance?: MaintenanceControl;
  store: SqliteWorkspaceStore; getTransport: () => EmailTransport;
  render: (plan: Plan, job: EmailJob, signal?: AbortSignal) => Promise<RenderedEmail>;
  now?: () => Date;
  schedule?: (plan:Plan,zones:Map<string,string>,now:Date)=>Promise<Array<Omit<EmailJob,"status"|"attempts"|"retryAt">>>;
  prepareDelivery?: (job:EmailJob,content:RenderedEmail,now:Date)=>RenderedEmail|undefined;
}) {
  let busy = false;
  let scheduling = false;
  dependencies.maintenance?.cover("delivery");
  async function drain(): Promise<void> {
    if (busy || dependencies.maintenance && !dependencies.maintenance.accepting()) return;
    const { store } = dependencies;
    const plan = store.getExecutionPlan(); const settings = store.email.settings();
    const now = dependencies.now?.() ?? new Date();
    if (!plan || plan.status !== "active") { store.email.cancelObsolete("", 0, now.toISOString()); return; }
    store.email.cancelObsolete(plan.id, plan.version, now.toISOString());
    if (!settings.enabled || !settings.verified || !dependencies.getTransport().configured()) return;
    busy = true;
    try {
      // Bounded work per tick avoids an outage producing a burst of messages.
      for (let count = 0; count < 4; count++) {
        if (dependencies.maintenance && !dependencies.maintenance.accepting()) break;
        const claimTime = dependencies.now?.() ?? new Date();
        const job = store.email.claim(plan.id, plan.version, claimTime.toISOString());
        if (!job?.lease) break;
        const authorizationDigest = bookingRelationshipDigest(store.email.settings());
        let sendStarted = false;
        const finishDelivery = dependencies.maintenance?.begin("delivery");
        try {
          const signal = AbortSignal.timeout(80_000);
          const content = job.content ?? await Promise.race([
            dependencies.render(plan, job, signal),
            new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("Email assembly expired")), { once: true }))
          ]);
          if (!job.content) store.email.saveContent(job.id, job.lease, content);
          const current = store.getExecutionPlan(); const recipient = store.email.settings();
          const sendTime = dependencies.now?.() ?? new Date();
          if (!current || current.status !== "active" || current.id !== plan.id || current.version !== plan.version || !recipient.enabled || !recipient.verified || recipient.revision !== job.recipientRevision || bookingRelationshipDigest(recipient) !== authorizationDigest || (content.authorizationDigest !== undefined && content.authorizationDigest !== authorizationDigest) || !store.email.canSend(job.id, job.lease, sendTime.toISOString())) {
            store.email.settle(job.id, job.lease, "cancelled", sendTime.toISOString(), "delivery_scope_changed"); continue;
          }
          const delivery=dependencies.prepareDelivery ? dependencies.prepareDelivery(job,content,sendTime) : (content.review ? undefined : content);
          if(!delivery){store.email.settle(job.id,job.lease,"cancelled",sendTime.toISOString(),"email_review_retired");continue;}
          // 投递准备可能同步撤销授权或替换执行版本。
          const finalPlan = store.getExecutionPlan(); const finalRecipient = store.email.settings();
          const finalTime = dependencies.now?.() ?? new Date();
          if (!finalPlan || finalPlan.status !== "active" || finalPlan.id !== plan.id || finalPlan.version !== plan.version || bookingRelationshipDigest(finalRecipient) !== authorizationDigest || !finalRecipient.enabled || !finalRecipient.verified || finalRecipient.revision !== job.recipientRevision || !store.email.canSend(job.id, job.lease, finalTime.toISOString())) {
            store.email.settle(job.id, job.lease, "cancelled", finalTime.toISOString(), "delivery_scope_changed"); continue;
          }
          sendStarted = true;
          const result = await dependencies.getTransport().send({ ...delivery, to: finalRecipient.recipient, messageId: `<${job.id}@landi.local>` });
          const retryAt = new Date(sendTime.getTime() + Math.min(15, 2 ** job.attempts) * 60_000).toISOString();
          if (result.status === "uncertain") dependencies.maintenance?.markUncertain("delivery_outcome_unknown");
          const status = result.status === "accepted" ? "accepted" : result.status === "uncertain" ? "uncertain" : result.retryable && job.attempts < 3 && retryAt < job.expiresAt ? "retry" : "failed";
          store.email.settle(job.id, job.lease, status, retryAt, result.status === "accepted" ? undefined : result.code);
        } catch {
          if (sendStarted) dependencies.maintenance?.markUncertain("delivery_outcome_unknown");
          const at = dependencies.now?.() ?? new Date();
          const retry = new Date(at.getTime() + 60_000).toISOString();
          store.email.settle(job.id, job.lease, sendStarted ? "uncertain" : job.attempts < 3 && retry < job.expiresAt ? "retry" : "failed", retry, sendStarted ? "email_delivery_unknown" : "email_generation_failed");
        } finally { finishDelivery?.(); }
      }
    } finally { busy = false; }
  }
  async function tick(zones: Map<string, string>): Promise<void> {
    await drain();
    if (scheduling || dependencies.maintenance && !dependencies.maintenance.accepting()) return;
    const plan = dependencies.store.getExecutionPlan(); const settings = dependencies.store.email.settings();
    if (!plan || plan.status !== "active" || !settings.enabled || !settings.verified || !dependencies.getTransport().configured()) return;
    const authorizationDigest = bookingRelationshipDigest(settings);
    scheduling = true;
    try {
      const now = dependencies.now?.() ?? new Date();
      const scheduled = await dependencies.schedule?.(plan, zones, now) ?? [];
      const current = dependencies.store.getExecutionPlan();
      if (dependencies.maintenance && !dependencies.maintenance.accepting() || current?.id !== plan.id || current.version !== plan.version || bookingRelationshipDigest(dependencies.store.email.settings()) !== authorizationDigest) return;
      for (const job of scheduled) dependencies.store.email.enqueue(job);
    } catch {
      // 安排生产者保存其可恢复的持久失败状态。
    } finally { scheduling = false; }
    await drain();
  }
  return { tick, drain };
}
