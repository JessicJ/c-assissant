import type { TelegramReplyMarkup } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { arrivalInstant, formatArrivalReminder, isArrivalLocationPromptDue, isArrivalReminderDue } from "./arrival-reminder.js";
import type { ConnectorBundle } from "./connector-bundle.js";
import { dueItineraryDepartureReminders, formatItineraryDepartureReminder, itineraryPlaceMapUrl, itineraryReminderCandidateCities, normalizeCity } from "./itinerary-departure-reminder.js";
import { checkPlanVenueStatuses } from "./plan-venue-monitor.js";
import { checkPlanCurrentWeather } from "./plan-weather-monitor.js";
import { formatExpectedArrivalGuidance } from "./route-handoff.js";
import { dueTaskReminders, formatTaskReminder } from "./task-reminder.js";
import { refreshTaskReminderWeather, taskReminderNeedsWeather, type TaskReminderWeatherContext } from "./task-reminder-weather.js";
import type { ActivePlanMonitoringService } from "./active-plan-monitoring-service.js";
import type { TelegramLocationActions } from "./telegram-location-actions-contract.js";

export function createActivePlanMonitoringService(dependencies: {
  store: SqliteWorkspaceStore;
  getConnectors: () => Pick<ConnectorBundle, "maps" | "googleWeather" | "telegram">;
  telegramLocationActions: TelegramLocationActions;
  logWarning: (details: Record<string, unknown>, message: string) => void;
}): ActivePlanMonitoringService {
  const { store, getConnectors, telegramLocationActions, logWarning } = dependencies;
  const itineraryCityTimeZones = new Map<string, { timeZone: string; expiresAt: number }>();
  let checkingArrivalReminder = false;
  let checkingTaskReminders = false;
  let checkingPlanWeather = false;
  let checkingPlanVenues = false;
  let checkingArrivalLocationPrompt = false;
  let checkingRouteHandoffGuidance = false;
  let checkingItineraryDepartureReminders = false;

  async function runArrivalReminder(): Promise<void> {
    if (checkingArrivalReminder) return;
    const { telegram } = getConnectors();
    const pairing = store.getTelegramPairingStatus();
    if (pairing.state !== "paired" || !pairing.binding) return;
    const plan = store.getExecutionPlan();
    if (!plan) return;
    const expectedAtLocal = plan.configuration.arrival.expectedAtLocal;
    const timeZone = plan.configuration.arrival.timeZone;
    if (plan.status !== "active" || !expectedAtLocal || !timeZone) return;
    const dueAt = arrivalInstant(expectedAtLocal, timeZone);
    if (!dueAt || !isArrivalReminderDue(dueAt)) return;
    checkingArrivalReminder = true;
    try {
      const claimed = store.claimTelegramReminder({ planId: plan.id, reminderKey: "arrival-check-in", dueAt: dueAt.toISOString() });
      if (!claimed) return;
      const arrivalTask = store.activateArrivalTask(plan.id);
      const updatedPlan = store.getExecutionPlan() ?? plan;
      const buttons: Array<{ text: string; callback_data: string }> = [{ text: "I haven't arrived", callback_data: "arrival_not_here" }];
      if (arrivalTask) buttons.push({ text: "I completed this step", callback_data: `arrival_task_complete:${arrivalTask.id}` });
      const receipt = await telegram.sendMessage({ chatId: pairing.binding.chatId, text: formatArrivalReminder(updatedPlan, arrivalTask), replyMarkup: { inline_keyboard: [buttons] } });
      if (receipt.status === "available") store.recordTelegramArrivalCheckin({ planId: plan.id, checkInSentAt: new Date().toISOString() });
      else logWarning({ status: receipt.status, code: receipt.failure?.code }, "Telegram arrival reminder could not be delivered");
    } catch (error) {
      logWarning({ error }, "Telegram arrival reminder failed");
    } finally {
      checkingArrivalReminder = false;
    }
  }

  async function runRouteHandoffGuidance(): Promise<void> {
    if (checkingRouteHandoffGuidance) return;
    const { telegram } = getConnectors();
    const pairing = store.getTelegramPairingStatus();
    if (pairing.state !== "paired" || !pairing.binding) return;
    const plan = store.getExecutionPlan();
    if (!plan || plan.status !== "active") return;
    checkingRouteHandoffGuidance = true;
    const claimTime = new Date().toISOString();
    try {
      const handoff = store.claimTelegramRouteArrivalGuidance(plan.id, claimTime);
      if (!handoff) return;
      const receipt = await telegram.sendMessage({
        chatId: pairing.binding.chatId,
        text: formatExpectedArrivalGuidance(plan),
        replyMarkup: { inline_keyboard: [[{ text: "I haven't arrived", callback_data: `route_not_arrived:${plan.id}` }]] }
      });
      if (receipt.status !== "available") {
        store.releaseTelegramRouteArrivalGuidance(plan.id, handoff.guidanceSentAt ?? claimTime);
        logWarning({ status: receipt.status, code: receipt.failure?.code }, "Telegram expected-arrival guidance could not be delivered");
      }
    } catch (error) {
      store.releaseTelegramRouteArrivalGuidance(plan.id, claimTime);
      logWarning({ error }, "Telegram expected-arrival guidance failed");
    } finally {
      checkingRouteHandoffGuidance = false;
    }
  }

  async function runTaskReminders(): Promise<void> {
    if (checkingTaskReminders) return;
    const { maps, googleWeather, telegram } = getConnectors();
    const pairing = store.getTelegramPairingStatus();
    if (pairing.state !== "paired" || !pairing.binding) return;
    const plan = store.getExecutionPlan();
    if (!plan) return;
    const due = dueTaskReminders(plan);
    if (!due.length) return;
    checkingTaskReminders = true;
    try {
      for (const item of due) {
        const attempt = store.claimTelegramTaskReminderAttempt({ planId: plan.id, reminderKey: item.reminderKey, taskId: item.task.id, dueAt: item.dueAt.toISOString(), reminder: item.reminder });
        if (!attempt.claimed) continue;
        const run = store.startTaskReminderRun({ planId: plan.id, taskId: item.task.id, reminderKey: item.reminderKey, dueAt: item.dueAt.toISOString(), attemptNumber: attempt.attemptNumber ?? 1 });
        let weather: TaskReminderWeatherContext | undefined;
        if (taskReminderNeedsWeather(item.reminder)) {
          try {
            const refreshed = await refreshTaskReminderWeather({
              plan,
              reminder: item.reminder,
              language: "en",
              dependencies: {
                geocodeAddress: (input) => maps.geocodeAddress(input),
                weather: (input) => googleWeather.weather(input)
              }
            });
            if (refreshed.status === "available") {
              weather = refreshed.data;
              store.recordTaskReminderRunWeather({ runId: run.id, status: "available" });
            } else {
              store.recordTaskReminderRunWeather({ runId: run.id, status: "unavailable", stage: "pipeline", failureCode: `${refreshed.stage}:${refreshed.code}` });
              logWarning({ stage: refreshed.stage, code: refreshed.code, taskId: item.task.id }, "Task reminder weather context was unavailable");
            }
          } catch (error) {
            store.recordTaskReminderRunWeather({ runId: run.id, status: "unavailable", stage: "pipeline", failureCode: "unexpected_error" });
            logWarning({ error, taskId: item.task.id }, "Task reminder weather refresh failed unexpectedly");
          }
        }
        const receipt = await telegram.sendMessage({ chatId: pairing.binding.chatId, text: formatTaskReminder(plan, item.task, weather) });
        if (receipt.status === "available") {
          store.recordTelegramTaskReminderDelivered({ planId: plan.id, reminderKey: item.reminderKey, taskId: item.task.id, taskTitle: item.task.title, reminder: item.reminder });
          store.recordTaskReminderRunDelivery({ runId: run.id, status: "succeeded" });
        } else {
          const outcome = store.recordTelegramTaskReminderFailure({
            planId: plan.id,
            reminderKey: item.reminderKey,
            taskId: item.task.id,
            reminder: item.reminder,
            failureCode: receipt.failure?.code ?? "unknown_failure",
            retryable: receipt.failure?.retryable ?? false
          });
          store.recordTaskReminderRunDelivery({
            runId: run.id,
            status: outcome.status === "retry_scheduled" ? "retry_wait" : outcome.status,
            failureCode: outcome.status === "cancelled" ? "reminder_cancelled" : receipt.failure?.code ?? "unknown_failure"
          });
          logWarning({ status: receipt.status, code: receipt.failure?.code, taskId: item.task.id, attempt: attempt.attemptNumber, outcome: outcome.status }, "Telegram Task reminder could not be delivered");
        }
      }
    } catch (error) {
      logWarning({ error }, "Telegram Task reminder failed");
    } finally {
      checkingTaskReminders = false;
    }
  }

  async function runItineraryDepartureReminders(): Promise<void> {
    if (checkingItineraryDepartureReminders) return;
    const { maps, googleWeather, telegram } = getConnectors();
    const pairing = store.getTelegramPairingStatus();
    if (pairing.state !== "paired" || !pairing.binding) return;
    const plan = store.getExecutionPlan();
    if (!plan || plan.status !== "active" || plan.presentation?.kind !== "itinerary") return;
    const cities = itineraryReminderCandidateCities(plan);
    if (!cities.length) return;
    checkingItineraryDepartureReminders = true;
    try {
      const timeZones = new Map<string, string>();
      for (const city of cities) {
        const key = normalizeCity(city);
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
      for (const item of dueItineraryDepartureReminders(plan, timeZones)) {
        const delivery = { planId: plan.id, reminderKey: item.reminderKey, dayId: item.dayId, placeId: item.place.id, scheduledTime: item.scheduledTime, dueAt: item.leaveAt.toISOString() };
        const attempt = store.claimTelegramItineraryReminderAttempt(delivery);
        if (!attempt.claimed) continue;
        const mapUrl = itineraryPlaceMapUrl(item.place);
        const receipt = await telegram.sendMessage({
          chatId: pairing.binding.chatId,
          text: formatItineraryDepartureReminder(plan, item),
          ...(mapUrl ? { replyMarkup: { inline_keyboard: [[{ text: "Open in Google Maps", url: mapUrl }]] } as TelegramReplyMarkup } : {})
        });
        if (receipt.status === "available") {
          store.recordTelegramItineraryReminderDelivered(delivery);
        } else {
          const outcome = store.recordTelegramItineraryReminderFailure({ ...delivery, failureCode: receipt.failure?.code ?? "unknown_failure", retryable: receipt.failure?.retryable ?? false });
          logWarning({ status: receipt.status, code: receipt.failure?.code, dayId: item.dayId, placeId: item.place.id, attempt: attempt.attemptNumber, outcome: outcome.status }, "Telegram itinerary departure reminder could not be delivered");
        }
      }
    } catch (error) {
      logWarning({ error, planId: plan.id }, "Telegram itinerary departure reminders failed");
    } finally {
      checkingItineraryDepartureReminders = false;
    }
  }

  async function runPlanWeatherMonitor(): Promise<void> {
    if (checkingPlanWeather) return;
    const { maps, googleWeather, telegram } = getConnectors();
    const plan = store.getExecutionPlan();
    if (!plan?.presentation || plan.presentation.kind !== "itinerary") return;
    checkingPlanWeather = true;
    try {
      const result = await checkPlanCurrentWeather({
        plan,
        arrivals: store.listPlanDestinationArrivals(plan.id),
        language: "en",
        dependencies: { geocodeAddress: (input) => maps.geocodeAddress(input), weather: (input) => googleWeather.weather(input) }
      });
      if (result.status !== "attention") return;
      const inserted = store.recordPlanWeatherAttention({ planId: plan.id, ...result.attention });
      if (!inserted) return;
      const pairing = store.getTelegramPairingStatus();
      if (pairing.state === "paired" && pairing.binding) {
        const receipt = await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `Landi weather attention\n${result.attention.title}\n\n${result.attention.body}\n\nOpen the current Plan to review today's route and alternatives.` });
        if (receipt.status !== "available") logWarning({ status: receipt.status, code: receipt.failure?.code }, "Plan weather attention could not be delivered to Telegram");
      }
    } catch (error) {
      logWarning({ error, planId: plan.id }, "Plan weather monitoring failed");
    } finally {
      checkingPlanWeather = false;
    }
  }

  async function runPlanVenueMonitor(): Promise<void> {
    if (checkingPlanVenues) return;
    const { maps, telegram } = getConnectors();
    const plan = store.getExecutionPlan();
    if (!plan?.presentation || plan.presentation.kind !== "itinerary") return;
    checkingPlanVenues = true;
    try {
      const result = await checkPlanVenueStatuses({ plan, dependencies: { searchPlaces: (input) => maps.searchPlaces(input) } });
      if (!result.attentions.length) return;
      const pairing = store.getTelegramPairingStatus();
      for (const attention of result.attentions) {
        const inserted = store.recordPlanVenueAttention({ planId: plan.id, placeId: attention.placeId, status: attention.status, observedAt: attention.observedAt, title: attention.title, body: attention.body });
        if (!inserted || pairing.state !== "paired" || !pairing.binding) continue;
        const receipt = await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `Landi venue attention\n${attention.title}\n\n${attention.body}${attention.officialUrl ? `\n\nOfficial entry: ${attention.officialUrl}` : ""}\n\nNo booking or itinerary change has been made.` });
        if (receipt.status !== "available") logWarning({ status: receipt.status, code: receipt.failure?.code, placeId: attention.placeId }, "Plan venue attention could not be delivered to Telegram");
      }
    } catch (error) {
      logWarning({ error, planId: plan.id }, "Plan venue monitoring failed");
    } finally {
      checkingPlanVenues = false;
    }
  }

  function startActivePlanMonitoring(): void {
    void runItineraryDepartureReminders();
    void runPlanWeatherMonitor();
    void runPlanVenueMonitor();
  }

  async function runArrivalLocationPrompt(): Promise<void> {
    if (checkingArrivalLocationPrompt) return;
    const pairing = store.getTelegramPairingStatus();
    if (pairing.state !== "paired" || !pairing.binding) return;
    const plan = store.getExecutionPlan();
    if (!plan || plan.status !== "active") return;
    const checkin = store.getTelegramArrivalCheckin(plan.id);
    if (!checkin || checkin.locationRequestedAt || checkin.locationReceivedAt || !isArrivalLocationPromptDue(checkin.checkInSentAt)) return;
    checkingArrivalLocationPrompt = true;
    try {
      await telegramLocationActions.requestArrivalLocation(pairing.binding.chatId, "We have not received an arrival update. If you want route help, tap the button below to share your current location.");
    } finally {
      checkingArrivalLocationPrompt = false;
    }
  }

  return {
    runArrivalLocationPrompt,
    runArrivalReminder,
    runItineraryDepartureReminders,
    runPlanVenueMonitor,
    runPlanWeatherMonitor,
    runRouteHandoffGuidance,
    runTaskReminders,
    startActivePlanMonitoring
  };
}

function isValidIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
