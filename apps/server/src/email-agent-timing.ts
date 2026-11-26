import { compileExecutionItinerary } from "./execution-itinerary.js";
import { bookingRelationshipDigest, type Plan } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { parseEmailTiming, type EmailTimingRequest, type EmailTimingResult } from "@c-assistant/agent-adapters";
import { emailJobId, emailTimingOpportunities, validateEmailTiming, scheduledEmailJobs } from "./email-schedule.js";

/** 应用交接与安排生产者共用同一持久身份。 */
export function prepareAgentEmailTiming(store: SqliteWorkspaceStore, plan: Plan, zones: Map<string, string>, now: Date): { id: string; request: EmailTimingRequest } {
  const activities = compileExecutionItinerary(plan).activities;
  const request = { opportunities: emailTimingOpportunities(plan, zones), now: now.toISOString(), itinerary: (plan.presentation?.days ?? []).filter(day => day.date && day.city).map(day => ({ date: day.date!, city: day.city!, activities: activities.filter(activity => activity.dayId === day.id).map(activity => ({ title: activity.title, ...(activity.time ? { time: activity.time } : {}), timeKind: activity.timeStatus ?? (activity.time ? "planned" : "flexible") })) })) };
  const id = emailJobId(["agent-timing", plan.id, plan.version, request.opportunities]);
  store.email.ensureTiming(id, plan.id, plan.version, now.toISOString(), request.opportunities.length ? undefined : "timing_context_unavailable");
  return { id, request };
}

export function createAgentEmailSchedule(store: SqliteWorkspaceStore, generate?: (request: EmailTimingRequest) => Promise<EmailTimingResult>, clock = () => new Date()) {
  return async (plan: Plan, zones: Map<string, string>, now: Date) => {
    const originalSettings = store.email.settings();
    const { id, request } = prepareAgentEmailTiming(store, plan, zones, now);
    if (!request.opportunities.length) return [];
    let record = store.email.timing(id);
    if (record?.status !== "ready") {
      const lease = store.email.claimTiming(id, plan.id, plan.version, now.toISOString());
      if (lease) {
        if (!generate) {
          store.email.failTiming(id, lease, now.toISOString(), "timing_provider_unavailable");
          return [];
        }
        try {
          const signal = AbortSignal.timeout(65_000);
          const result = await Promise.race([generate({ ...request, signal }), new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("发送安排生成超时")), { once: true }))]);
          validateEmailTiming(request, result);
          const current = store.getExecutionPlan(); const settings = store.email.settings(); const savedAt = clock();
          if (current?.id === plan.id && current.version === plan.version && current.status === "active" && store.email.currentTiming(plan.id, plan.version)?.id === id && settings.enabled && settings.verified && bookingRelationshipDigest(settings) === bookingRelationshipDigest(originalSettings)) {
            store.email.saveTiming(id, lease, savedAt.toISOString(), { ...result, producer: { runtimeKind: store.getWorkspace().runtime.selectedKind, modelId: null, modelIdentity: "Not reported by runtime", arrangedAt: savedAt.toISOString(), planId: plan.id, planVersion: plan.version } });
          } else store.email.failTiming(id, lease, savedAt.toISOString(), "timing_scope_changed");
        } catch { store.email.failTiming(id, lease, clock().toISOString(), "timing_generation_failed"); }
        record = store.email.timing(id);
      }
    }
    const currentTiming = store.email.currentTiming(plan.id, plan.version);
    if (record?.status !== "ready" || currentTiming?.id !== id || currentTiming.status !== "ready") return [];
    const timing = parseEmailTiming(JSON.stringify(record.result), request);
    return scheduledEmailJobs(plan, store.email.settings(), zones, now, timing);
  };
}
