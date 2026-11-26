import type { MaintenanceControl } from "./maintenance-control.js";
import { createAgentEmailSchedule } from "./email-agent-timing.js";
import { enqueuePendingReview, enqueueConfirmedReview, consumeTravelAdjustmentHandoffs, createEmailReviewDelivery } from "./email-plan-review.js";
import { createEmailAttentionMonitor } from "./email-attention-monitor.js";
import { createEmailExecutionWorker } from "./email-execution-worker.js";
import { createEmailContentBuilder } from "./email-content.js";
import { createEmailTransportFromEnvironment } from "./email-transport.js";
import type { EmailTimingRequest, EmailTimingResult, EmailResearchRequest, EmailResearchResult } from "@c-assistant/agent-adapters";
import type { EmailTransport } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ConnectorBundle } from "./connector-bundle.js";
import { compileExecutionItinerary } from "./execution-itinerary.js";
import { itineraryReminderCandidateCities, normalizeCity } from "./itinerary-departure-reminder.js";

export interface EmailPlanMonitoringService {
  runItineraryDepartureReminders(): Promise<void>;
  runPlanWeatherMonitor(): Promise<void>;
  runPlanVenueMonitor(): Promise<void>;
  startActivePlanMonitoring(): void;
}

export function createEmailPlanMonitoringService(dependencies: {
  maintenance?: MaintenanceControl;
  store: SqliteWorkspaceStore;
  getConnectors: () => Pick<ConnectorBundle, "maps" | "googleWeather">;
  getEmailTransport?: () => EmailTransport;
  emailTiming?: (request: EmailTimingRequest) => Promise<EmailTimingResult>;
  emailResearch?: (request: EmailResearchRequest) => Promise<EmailResearchResult>;
  logWarning: (details: Record<string, unknown>, message: string) => void;
}): EmailPlanMonitoringService {
  const { store, getConnectors, logWarning } = dependencies;
  const itineraryCityTimeZones = new Map<string, { timeZone: string; expiresAt: number }>();
  let checkingItineraryDepartureReminders = false;
  const emailWorker = createEmailExecutionWorker({ ...(dependencies.maintenance ? { maintenance: dependencies.maintenance } : {}), store, schedule: createAgentEmailSchedule(store, dependencies.emailTiming), getTransport: dependencies.getEmailTransport ?? createEmailTransportFromEnvironment, prepareDelivery: createEmailReviewDelivery(store), render: createEmailContentBuilder({ store, getConnectors, timeZoneForCity: city => emailZones().get(normalizeCity(city)), ...(dependencies.emailResearch ? { research: dependencies.emailResearch } : {}) }) });
  const emailAttention = createEmailAttentionMonitor({ store, getConnectors });
  const emailZones = () => new Map([...itineraryCityTimeZones.entries()].map(([city, value]) => [city, value.timeZone]));
  async function runEmailMonitor(mode: "journey" | "venue", zones: Map<string, string>): Promise<void> {
    try { await emailAttention.run(mode, zones); }
    catch { logWarning({ code: "email_monitor_unavailable", mode }, "Travel change evidence is unavailable"); }
  }
  async function runItineraryDepartureReminders(): Promise<void> {
    // 前次来源查询仍在等待时，也先投递已持久化的变化通知。
    consumeTravelAdjustmentHandoffs(store);
    enqueuePendingReview(store, undefined);
    enqueueConfirmedReview(store);
    await emailWorker.drain();
    if (checkingItineraryDepartureReminders) return;
    checkingItineraryDepartureReminders = true;
    let planId: string | undefined;
    try {
      const plan = store.getExecutionPlan();
      planId = plan?.id;
      const recipient = store.email.settings();
      if (!plan || plan.status !== "active" || plan.presentation?.kind !== "itinerary" || !recipient.enabled || !recipient.verified || !store.email.usesEmail(plan.id, plan.version)) return;
      const { maps, googleWeather } = getConnectors();
      const cities = [...new Set([...itineraryReminderCandidateCities(plan), ...compileExecutionItinerary(plan).activities.filter(activity => activity.date>=new Date(Date.now()-86_400_000).toISOString().slice(0,10)).map(activity => activity.city)])];
      if (!cities.length) { await emailWorker.tick(new Map()); return; }
      const timeZones = new Map<string, string>();
      const savedZones = (store.getExecutionAssistantState(plan.id, plan.version)?.data as { timeZones?: Record<string, string> } | undefined)?.timeZones ?? {};
      for (const city of cities) {
        const key = normalizeCity(city);
        const arrivalDay = plan.presentation?.days.find(day => day.date === plan.configuration.arrival.expectedAtLocal?.slice(0,10));
        const savedZone = store.email.settings().cityTimeZones[key] ?? savedZones[key] ?? (arrivalDay?.city && normalizeCity(arrivalDay.city) === key ? plan.configuration.arrival.timeZone : undefined);
        if (savedZone && isValidIanaTimeZone(savedZone)) {
          timeZones.set(key, savedZone);
          continue;
        }
        const cached = itineraryCityTimeZones.get(key);
        if (cached && cached.expiresAt > Date.now()) {
          timeZones.set(key, cached.timeZone);
          continue;
        }
        const geocoded = await maps.geocodeAddress({ address: city });
        if (geocoded.status !== "available" || !geocoded.data) continue;
        const weather = await googleWeather.weather({ coordinates: geocoded.data.location, locationName: geocoded.data.formattedAddress });
        const timeZone = weather.status === "available" ? weather.data?.location.timezone.trim() : undefined;
        if (!timeZone || !isValidIanaTimeZone(timeZone)) continue;
        itineraryCityTimeZones.set(key, { timeZone, expiresAt: Date.now() + 24 * 60 * 60_000 });
        timeZones.set(key, timeZone);
      }
      for (const [city,timeZone] of timeZones) {
        if (itineraryCityTimeZones.get(city)?.timeZone !== timeZone) itineraryCityTimeZones.set(city,{timeZone,expiresAt:Date.now()+24*60*60_000});
      }
      await runEmailMonitor("venue",timeZones);
      await runEmailMonitor("journey",timeZones);
      await emailWorker.tick(timeZones);
    } catch {
      logWarning({ code: "travel_schedule_unavailable", planId }, "Travel assistance scheduling failed");
    } finally {
      checkingItineraryDepartureReminders = false;
    }
  }

  async function runPlanWeatherMonitor(): Promise<void> { await runEmailMonitor("journey", emailZones()); }
  async function runPlanVenueMonitor(): Promise<void> { await runEmailMonitor("venue", emailZones()); }
  dependencies.maintenance?.cover('background');
  const tracked = (operation: () => Promise<void>) => () => {
    if (dependencies.maintenance && !dependencies.maintenance.accepting()) return Promise.resolve();
    return dependencies.maintenance ? dependencies.maintenance.run('background', operation) : operation();
  };
  const reminders = tracked(runItineraryDepartureReminders);
  const weather = tracked(runPlanWeatherMonitor);
  const venues = tracked(runPlanVenueMonitor);
  function startActivePlanMonitoring(): void {
    for (const operation of [reminders, weather, venues]) {
      void operation().catch(() => logWarning({ code: 'background_monitor_failed' }, 'Background monitoring failed'));
    }
  }
  return { runItineraryDepartureReminders: reminders, runPlanWeatherMonitor: weather, runPlanVenueMonitor: venues, startActivePlanMonitoring };
}

function isValidIanaTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date()); return true; }
  catch { return false; }
}
