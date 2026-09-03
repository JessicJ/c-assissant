import type { TelegramConnector, TelegramIncomingUpdate } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { shouldRenewExpiredArrivalLocationRequest } from "./arrival-reminder.js";
import type { MessagingCommandReply } from "./messaging-replies.js";
import { planRefinementState } from "./plan-refinement.js";
import { HANDOFF_DELAY_SECONDS } from "./route-handoff.js";
import { parseTelegramFoodPartyCallback } from "./telegram-food.js";
import type { TelegramLocationActions } from "./telegram-location-actions-contract.js";
import { parseTelegramMovementGoStaleCallback } from "./telegram-movement-card.js";
import {
  formatTelegramPlanPages,
  parseTelegramPlanChangeAction,
  telegramPlanConfirmationDecision,
  telegramPlanConfirmationMarkup
} from "./telegram-plan.js";
import type { TelegramPlanChangeCallbackAction } from "./telegram-plan-change-handler.js";
import type { ActivePlanMonitoringService } from "./active-plan-monitoring-service.js";
import {
  formatTelegramProfile,
  parseTelegramProfileCallback,
  telegramProfileChoiceMarkup,
  telegramProfileMarkup,
  telegramProfileTextPrompt,
  updateProfileText
} from "./telegram-profile.js";

export function createTelegramUpdateHandler(dependencies: {
  store: SqliteWorkspaceStore;
  getTelegram: () => TelegramConnector;
  activePlanMonitoring: ActivePlanMonitoringService;
  telegramLocationActions: TelegramLocationActions;
  sendCommandReplies: (chatId: string, replies: MessagingCommandReply[]) => Promise<void>;
  commandResponse: (text: string | undefined, trigger: "telegram") => Promise<MessagingCommandReply[] | undefined>;
  handlePlanChangeCallback: (chatId: string, callbackId: string, action: TelegramPlanChangeCallbackAction) => Promise<void>;
}) {
  const {
    store,
    getTelegram,
    activePlanMonitoring,
    telegramLocationActions,
    sendCommandReplies,
    commandResponse,
    handlePlanChangeCallback
  } = dependencies;

  async function handleTelegramUpdate(chatId: string, update: TelegramIncomingUpdate): Promise<void> {
    const telegram = getTelegram();
    if (update.kind === "callback") {
      if (!update.callbackId) return;
      if (await handleCallback(chatId, update)) return;
      return;
    }
    if (update.location) {
      await handleLocation(chatId, update);
      return;
    }
    const pendingProfileField = store.getTelegramProfileTextEdit();
    if (pendingProfileField && update.text && !update.text.startsWith("/")) {
      try {
        const updated = store.updateProfile(updateProfileText(store.getWorkspace().profile, pendingProfileField, update.text));
        store.clearTelegramProfileTextEdit();
        await telegram.sendMessage({ chatId, text: formatTelegramProfile(updated.profile), replyMarkup: telegramProfileMarkup() });
      } catch (error) {
        await telegram.sendMessage({ chatId, text: `${error instanceof Error ? error.message : "That Profile value could not be saved."}\n\n${telegramProfileTextPrompt(pendingProfileField)}` });
      }
      return;
    }
    const responses = await commandResponse(update.text, "telegram");
    if (responses) await sendCommandReplies(chatId, responses);
  }

  async function handleCallback(chatId: string, update: TelegramIncomingUpdate): Promise<boolean> {
    const telegram = getTelegram();
    const callbackId = update.callbackId;
    if (!callbackId) return false;

    const staleGo = parseTelegramMovementGoStaleCallback(update.callbackData);
    if (staleGo) {
      const executionPlan = store.getExecutionPlan();
      if (!executionPlan || executionPlan.id !== staleGo.planId || executionPlan.version !== staleGo.version || executionPlan.status !== "active") {
        await telegram.answerCallbackQuery({ callbackId, text: "That /go confirmation is out of date. Send /go again." });
      } else {
        telegramLocationActions.rememberMovementGoLocationSession(executionPlan.id, { planVersion: executionPlan.version, stopId: staleGo.stopId, confirmedStale: true });
        await telegram.answerCallbackQuery({ callbackId, text: "Share your location to continue /go." });
        await telegramLocationActions.requestMovementGoLocation(chatId, executionPlan.id, executionPlan.presentation?.places.find((place) => place.id === staleGo.stopId)?.name ?? "that stop");
      }
      return true;
    }

    const planChangeAction = parseTelegramPlanChangeAction(update.callbackData);
    if (planChangeAction.action !== "not_change") {
      await handlePlanChangeCallback(chatId, callbackId, planChangeAction);
      return true;
    }

    const foodParty = parseTelegramFoodPartyCallback(update.callbackData);
    if (foodParty) {
      const workspace = store.getWorkspace();
      const plan = workspace.activePlan.id === foodParty.planId ? workspace.activePlan : store.getExecutionPlan();
      if (!plan || plan.id !== foodParty.planId || plan.version !== foodParty.version) {
        await telegram.answerCallbackQuery({ callbackId, text: "That Plan choice is out of date. Send /food again." });
      } else {
        store.updatePlanTravelContext(plan.id, { partySize: foodParty.partySize, luggage: plan.configuration.travelContext.luggage });
        await telegram.answerCallbackQuery({ callbackId, text: `Party size saved: ${foodParty.partySize}.` });
        await telegramLocationActions.requestFoodLocation(chatId);
      }
      return true;
    }

    const profileAction = parseTelegramProfileCallback(update.callbackData);
    if (profileAction.type !== "unknown") {
      if (profileAction.type === "edit_text") {
        store.startTelegramProfileTextEdit(profileAction.field);
        await telegram.answerCallbackQuery({ callbackId, text: "Send the value as your next message." });
        await telegram.sendMessage({ chatId, text: telegramProfileTextPrompt(profileAction.field) });
      } else if (profileAction.type === "choose") {
        store.clearTelegramProfileTextEdit();
        await telegram.answerCallbackQuery({ callbackId, text: "Choose the value you want to save." });
        await telegram.sendMessage({ chatId, text: profileAction.field === "gender" ? "Choose your gender setting. You may leave it unspecified." : "Choose the China visa or residence status you currently know. This is user-provided context, not a policy conclusion.", replyMarkup: telegramProfileChoiceMarkup(profileAction.field) });
      } else {
        store.clearTelegramProfileTextEdit();
        const current = store.getWorkspace().profile;
        const updated = store.updateProfile(profileAction.type === "set_gender" ? { ...current, gender: profileAction.value } : { ...current, immigrationStatus: profileAction.value });
        await telegram.answerCallbackQuery({ callbackId, text: "Profile saved locally." });
        await telegram.sendMessage({ chatId, text: formatTelegramProfile(updated.profile), replyMarkup: telegramProfileMarkup() });
      }
      return true;
    }

    const confirmation = telegramPlanConfirmationDecision(store.getWorkspace().activePlan, update.callbackData);
    if (confirmation !== "not_confirmation") {
      if (confirmation === "confirm") {
        const refinement = planRefinementState(store.getWorkspace().activePlan);
        if (refinement.followUpQuestion) {
          await telegram.answerCallbackQuery({ callbackId, text: "The Plan still needs one critical answer." });
          await telegram.sendMessage({ chatId, text: `Before final confirmation, answer this one question:\n\n${refinement.followUpQuestion}` });
          return true;
        }
        const previousExecution = store.getExecutionPlan();
        const confirmed = store.confirmPlan(store.getWorkspace().activePlan.id);
        activePlanMonitoring.startActivePlanMonitoring();
        await telegram.answerCallbackQuery({ callbackId, text: "Plan activated." });
        const profileNext = confirmed.profile.status === "incomplete" ? "\n\nYour Plan is active, but some policy-routing basics are still missing. Send /profile when convenient; this does not block other Plan work." : "";
        const switched = previousExecution && previousExecution.id !== confirmed.activePlan.id ? `\n\nThe previous executing Plan “${previousExecution.title}” is now in history. Its unfinished reminders no longer run.` : "";
        await telegram.sendMessage({ chatId, text: `Plan activated\n${confirmed.activePlan.title}\n\nApproved reminders and read-only preparation are now eligible to run. No booking, payment, ride, or other external action was started.${switched}${profileNext}` });
      } else if (confirmation === "already_active") {
        await telegram.answerCallbackQuery({ callbackId, text: "This Plan is already active." });
      } else {
        const currentPlan = store.getWorkspace().activePlan;
        const replyMarkup = telegramPlanConfirmationMarkup(currentPlan);
        await telegram.answerCallbackQuery({ callbackId, text: "That Plan version is no longer current." });
        const pages = formatTelegramPlanPages(currentPlan);
        const replies = pages.map((page, index): MessagingCommandReply => {
          const isLastPage = index === pages.length - 1;
          return { text: index === 0 ? `That confirmation button is out of date. Review the current Plan below.\n\n${page}` : page, ...(isLastPage && replyMarkup ? { replyMarkup } : {}) };
        });
        await sendCommandReplies(chatId, replies);
      }
      return true;
    }

    if (update.callbackData === "arrival_not_here") {
      await telegram.answerCallbackQuery({ callbackId, text: "Share your location only if you want route help." });
      await telegramLocationActions.requestArrivalLocation(chatId, "If you want route help for this arrival, tap the button below to share your current location.");
      return true;
    }

    const delayedRoutePlanId = update.callbackData?.match(/^route_not_arrived:(plan-[0-9a-f-]{36})$/)?.[1];
    if (delayedRoutePlanId) {
      const executionPlan = store.getExecutionPlan();
      if (executionPlan?.id !== delayedRoutePlanId) {
        await telegram.answerCallbackQuery({ callbackId, text: "That route timeline is no longer current." });
      } else {
        const delayed = store.delayTelegramRouteArrivalGuidance(executionPlan.id, new Date().toISOString(), HANDOFF_DELAY_SECONDS);
        await telegram.answerCallbackQuery({ callbackId, text: delayed ? "Arrival guidance delayed by 15 minutes." : "This delay was already recorded." });
        if (delayed) await telegramLocationActions.requestArrivalLocation(chatId, "No problem. Landi has delayed the next arrival guidance by 15 minutes. To recalculate from current conditions, share your location once below.", true);
      }
      return true;
    }

    const completedTaskId = update.callbackData?.match(/^arrival_task_complete:(task-[0-9a-f-]{36})$/)?.[1];
    if (completedTaskId) {
      const executionPlan = store.getExecutionPlan();
      const completed = executionPlan ? store.completeReadyTask(executionPlan.id, completedTaskId) : undefined;
      await telegram.answerCallbackQuery({ callbackId, text: completed ? "Task marked complete." : "That task is not ready to complete." });
      if (completed) await telegram.sendMessage({ chatId, text: `Completed by your confirmation: ${completed.title}\n\nNo external completion was inferred by Landi.` });
      return true;
    }
    return false;
  }

  async function handleLocation(chatId: string, update: TelegramIncomingUpdate): Promise<void> {
    const telegram = getTelegram();
    if (!update.location) return;
    const intent = store.getTelegramLocationIntent();
    store.clearTelegramLocationIntent();
    const workspace = store.getWorkspace();
    const executionPlan = store.getExecutionPlan();
    const acceptedPlanIds = new Set([workspace.activePlan.id, executionPlan?.id].filter((id): id is string => Boolean(id)));
    if (!intent || !acceptedPlanIds.has(intent.planId)) {
      const checkin = executionPlan ? store.getTelegramArrivalCheckin(executionPlan.id) : undefined;
      if (executionPlan && shouldRenewExpiredArrivalLocationRequest(executionPlan.status, checkin)) {
        await telegramLocationActions.requestArrivalLocation(chatId, "The earlier location request expired, so those coordinates were not used or saved. Tap below to share again now.");
      } else {
        await telegram.sendMessage({ chatId, text: "There is no active location request for the current Plan. Send /food for nearby food, or use the arrival route action when it appears. These coordinates were not used or saved." });
      }
    } else if (intent.purpose === "nearby_food") {
      await telegramLocationActions.sendNearbyFoodFromSharedLocation(chatId, update.location, intent.planId);
    } else if (intent.purpose === "movement_go") {
      await telegramLocationActions.sendMovementGoFromSharedLocation(chatId, update.location, intent.planId);
    } else if (intent.purpose === "uber_test") {
      await telegramLocationActions.sendUberTestFromSharedLocation(chatId, update.location, intent.planId);
    } else {
      await telegramLocationActions.sendArrivalRouteFromSharedLocation(chatId, update.location, intent.planId, intent.transportOverride);
    }
  }

  return { handleTelegramUpdate };
}
