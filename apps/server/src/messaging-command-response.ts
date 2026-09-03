import type { ClaudeCodeRuntimeAdapter, CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import type { ConnectorResult, GeocodedPlaceFact } from "@c-assistant/connectors";
import {
  resolveCurrentPlanDestination,
  type AgentRuntimeKind,
  type GeneratedPlanDraft,
  type Plan
} from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ChinaPlanWorkflowResult } from "./china-plan-workflow.js";
import type { PreparedJapanPlan } from "./country-pack-service-contract.js";
import { presentChinaPlanPreparation } from "./china-plan-presentation.js";
import type { CountryPackResolution } from "./country-pack-resolver.js";
import {
  messagingHelpText,
  messagingStartText,
  unknownCommandText,
  webWorkbenchPlanGenerationText
} from "./messaging-command-copy.js";
import type { MessagingCommandReply } from "./messaging-replies.js";
import { selectNextPlannedStop } from "./next-planned-stop.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import { planRefinementState } from "./plan-refinement.js";
import { previewPlanChange } from "./plan-change-impact.js";
import { formatTransportChoiceAcknowledgement, parseTelegramCommand, shouldGenerateCompletePlan } from "./telegram-commands.js";
import { telegramFoodPartyMarkup } from "./telegram-food.js";
import type { TelegramLocationActions } from "./telegram-location-actions-contract.js";
import { formatTelegramMovementLocationRequest, formatTelegramMovementStaleConfirmation } from "./telegram-movement-card.js";
import {
  completedTasksForRevision,
  formatTelegramPlanChangeProposal,
  formatTelegramWorkspacePlanPages,
  planDraftForRevision,
  telegramPlanChangeMarkup,
  telegramPlanConfirmationMarkup,
  telegramPlanRequestMode
} from "./telegram-plan.js";
import { telegramPlanReplies, withTelegramExecutionContinuity } from "./telegram-plan-replies.js";
import { formatTelegramProfile, telegramProfileMarkup } from "./telegram-profile.js";
import { fetchTelegramPlanWeather, formatTelegramWeather } from "./telegram-weather.js";
import { runtimeName } from "./runtime-display.js";
import { fetchUserWeather, type UserWeatherSnapshot } from "./user-weather.js";

type RuntimeAdapter = CodexRuntimeAdapter | ClaudeCodeRuntimeAdapter;

export function createMessagingCommandResponder(dependencies: {
  store: SqliteWorkspaceStore;
  getGeneratingPlan: () => boolean;
  setGeneratingPlan: (running: boolean) => void;
  selectedRuntimeAdapter: (kind: AgentRuntimeKind) => RuntimeAdapter;
  planningGeneration: PlanningGenerationService;
  telegramLocationActions: TelegramLocationActions;
  resolvePlanCountryPack: (planId: string) => Promise<CountryPackResolution>;
  prepareJapanPlan: (planId: string) => Promise<PreparedJapanPlan>;
  chinaPlanWorkflow: { prepareCurrentPlan(options: { planId: string; now?: string }): Promise<ChinaPlanWorkflowResult> };
  geocodeAddress: (input: { address: string }) => Promise<ConnectorResult<GeocodedPlaceFact>>;
  weather: (input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }) => Promise<ConnectorResult<UserWeatherSnapshot>>;
}) {
  const {
    store,
    getGeneratingPlan,
    setGeneratingPlan,
    selectedRuntimeAdapter,
    planningGeneration,
    telegramLocationActions,
    resolvePlanCountryPack,
    prepareJapanPlan,
    chinaPlanWorkflow,
    geocodeAddress,
    weather
  } = dependencies;

  return async function messagingCommandResponse(text: string | undefined, trigger: "telegram" | "whatsapp"): Promise<MessagingCommandReply[] | undefined> {
    const command = parseTelegramCommand(text);
    if (command.type === "empty") return undefined;
    if (command.type === "help") return [{ text: messagingHelpText() }];
    if (command.type === "plan") {
      const workspace = store.getWorkspace();
      const plan = workspace.activePlan;
      const replyMarkup = telegramPlanConfirmationMarkup(plan);
      const pages = formatTelegramWorkspacePlanPages(workspace);
      return pages.map((page, index) => ({ text: page, ...(index === pages.length - 1 && replyMarkup ? { replyMarkup } : {}) }));
    }
    if (command.type === "prepare") {
      const current = store.getWorkspace().activePlan;
      if (current.status !== "draft") return [{ text: "The current Plan is already active. Create or revise a draft before preparing another Country Pack proposal." }];
      const resolution = await resolvePlanCountryPack(current.id);
      if (resolution.status !== "resolved") return [{ text: `${resolution.message}\n\nThe destination country could not be verified from normalized map facts, so no Country Pack was selected.` }];
      if (resolution.countryPackId === "japan") {
        const prepared = await prepareJapanPlan(current.id);
        if (prepared.status === "blocked") return [{ text: `Japan Pack preparation needs attention\n\n${prepared.message}\n\nThe current draft was preserved. Confirm the missing traveler facts or source evidence, then send /prepare again.` }];
        return telegramPlanReplies(prepared.workspace.activePlan, withTelegramExecutionContinuity(prepared.workspace, `Japan Pack prepared a new complete draft with ${prepared.taskCount} Tasks and ${prepared.reminderCount} Reminders. Review every page before confirming.`));
      }
      const presented = presentChinaPlanPreparation(await chinaPlanWorkflow.prepareCurrentPlan({ planId: current.id }));
      if (presented.status === "blocked") {
        const actions = presented.actionItems.map((item) => `• ${item}`).join("\n");
        return [{ text: `China Pack preparation needs attention\n\n${presented.message}${actions ? `\n\n${actions}` : ""}\n\nThe current draft was preserved. Update the missing details in Telegram or Web, then send /prepare again.` }];
      }
      return telegramPlanReplies(presented.workspace.activePlan, withTelegramExecutionContinuity(presented.workspace, `China Pack prepared a new complete draft with ${presented.taskCount} Tasks and ${presented.reminderCount} Reminders. Review every page before confirming.`));
    }
    if (command.type === "profile") {
      store.clearTelegramProfileTextEdit();
      return [{ text: formatTelegramProfile(store.getWorkspace().profile), replyMarkup: telegramProfileMarkup() }];
    }
    if (command.type === "arrival_update") {
      const workspace = store.getWorkspace();
      const plan = store.getExecutionPlan() ?? workspace.activePlan;
      try {
        const arrival = store.recordPlanDestinationArrival({ planId: plan.id, city: command.city });
        return [{ text: `Arrival confirmed: ${arrival.city}.\n\nLandi will now use ${arrival.city} for current weather and location-aware assistance. This is a Plan-scoped confirmation; continuous location tracking remains off.` }];
      } catch (error) {
        return [{ text: `${error instanceof Error ? error.message : "That arrival could not be matched to the active Plan."}\n\nYour current destination was not changed. If the Plan destination is wrong, request a Plan change instead.` }];
      }
    }
    if (command.type === "go") {
      const plan = store.getExecutionPlan();
      if (!plan || plan.status !== "active") return [{ text: "Send /go after you activate a Plan. Movement guidance only runs from the current Execution Plan." }];
      const selection = selectNextPlannedStop(plan, { now: new Date(), ...(plan.configuration.arrival.timeZone ? { timeZone: plan.configuration.arrival.timeZone } : {}) });
      if (selection.status === "blocked") return [{ text: `${selection.recoveryMessage}\n\nNo booking, ride, payment, route start, or Plan change was made.` }];
      if (selection.status === "stale_confirmation_required") return [formatTelegramMovementStaleConfirmation(selection)];
      telegramLocationActions.rememberMovementGoLocationSession(plan.id, { planVersion: plan.version, stopId: selection.place.id, confirmedStale: false });
      return [{ ...formatTelegramMovementLocationRequest(selection.place.name), locationIntent: { purpose: "movement_go", planId: plan.id } }];
    }
    if (command.type === "weather") {
      const workspace = store.getWorkspace();
      const plan = store.getExecutionPlan() ?? workspace.activePlan;
      const result = await fetchTelegramPlanWeather({
        location: currentPlanDestination(store, plan),
        language: "en",
        dependencies: {
          geocodeAddress,
          weather: (input) => fetchUserWeather({
            ...input,
            dependencies: { weather }
          })
        }
      });
      return [{ text: result.status === "available" ? formatTelegramWeather(result.data) : `Weather is unavailable for the current Plan. ${result.message}\nFailure stage: ${result.stage}${result.connectorStatus ? ` · status: ${result.connectorStatus}` : ""}\n\nNo weather was guessed, no reminder was created, and your Plan was not changed.` }];
    }
    if (command.type === "food") {
      const workspace = store.getWorkspace();
      const plan = store.getExecutionPlan() ?? workspace.activePlan;
      if (command.partySize !== undefined) {
        if (!Number.isInteger(command.partySize) || command.partySize < 1 || command.partySize > 20) return [{ text: "Party size must be a whole number from 1 to 20. For example: /food 2" }];
        store.updatePlanTravelContext(plan.id, { partySize: command.partySize, luggage: plan.configuration.travelContext.luggage });
        return [{ text: `Party size saved in this Plan: ${command.partySize}.\n\nTap below to share your current location for this one nearby food check. It expires after 15 minutes and will not be saved.`, replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true }, locationIntent: { purpose: "nearby_food", planId: plan.id } }];
      }
      if (!plan.configuration.travelContext.partySize) {
        return [{ text: "How many people are eating? Choose 1–6 below, or send /food followed by any whole number up to 20, for example /food 8.", replyMarkup: telegramFoodPartyMarkup(plan.id, plan.version) }];
      }
      return [{ text: `This Plan currently has ${plan.configuration.travelContext.partySize} ${plan.configuration.travelContext.partySize === 1 ? "person" : "people"}.\n\nTap below to share your current location for this one nearby food check. It expires after 15 minutes and will not be saved.`, replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true }, locationIntent: { purpose: "nearby_food", planId: plan.id } }];
    }
    if (command.type === "transport_choice") {
      const workspace = store.getWorkspace();
      const plan = store.getExecutionPlan() ?? workspace.activePlan;
      const accommodation = plan.configuration.accommodation;
      const checkin = store.getTelegramArrivalCheckin(plan.id);
      const offersCurrentRoute = plan.status === "active"
        && (accommodation.status === "candidate" || accommodation.status === "confirmed")
        && Boolean(accommodation.location && checkin?.checkInSentAt);
      const resolvedScope = offersCurrentRoute && command.scope !== "plan" ? "current_action" : "plan";
      if (resolvedScope === "plan" && plan.configuration.transport.preference !== command.preference) store.updatePlanTransportPreference(plan.id, { preference: command.preference });
      return [{
        text: formatTransportChoiceAcknowledgement(command.preference, resolvedScope, offersCurrentRoute),
        ...(offersCurrentRoute ? {
          replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true },
          locationIntent: { purpose: "arrival_route" as const, planId: plan.id, ...(resolvedScope === "current_action" ? { transportOverride: command.preference } : {}) }
        } : {})
      }];
    }
    if (command.type === "create_plan") {
      const existingWorkspace = store.getWorkspace();
      if (trigger === "telegram" && existingWorkspace.activePlan.status === "active" && !command.explicit) {
        if (command.request.length > 1_500) return [{ text: "Keep a Plan change request under 1,500 characters, then send it again." }];
        const impact = previewPlanChange(existingWorkspace.activePlan, command.request);
        const proposal = store.createTelegramPlanChangeProposal({ planId: existingWorkspace.activePlan.id, baseVersion: existingWorkspace.activePlan.version, request: command.request, impact });
        return [{ text: formatTelegramPlanChangeProposal(command.request, impact), replyMarkup: telegramPlanChangeMarkup(proposal.id) }];
      }
      if (!shouldGenerateCompletePlan(existingWorkspace.activePlan.status, command.request, command.explicit)) {
        return [{ text: `I kept the active Plan “${existingWorkspace.activePlan.title}” unchanged because this looks like a current request, not an instruction to replace the complete Plan.\n\nFor a separate complete Plan, use /new. To replace the whole Plan, say that explicitly. Current V1 direct actions include transport preferences such as “I prefer taxi”, /weather, and /food.` }];
      }
      if (command.request.length > 1_500) return [{ text: "Keep a new Plan request under 1,500 characters, then send it again." }];
      if (getGeneratingPlan()) return [{ text: "A Plan draft is already being prepared. Please wait for it before sending another request." }];
      setGeneratingPlan(true);
      try {
        const workspace = store.getWorkspace();
        if (workspace.profile.status !== "ready") return [{ text: "Complete your required long-term Profile before creating a Plan. Send /profile, fill in nationality and China visa or residence status, then send your Plan request again." }];
        const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
        const revising = telegramPlanRequestMode(workspace, command.explicit) === "revise";
        if (!revising) {
          return [{ text: webWorkbenchPlanGenerationText() }];
        }
        if (workspace.activeBlueprint) {
          return telegramPlanReplies(workspace.activePlan, "This Plan is backed by a Trip Blueprint. Landi kept it unchanged because Assisted Replanning is not enabled yet. Start a new planning conversation in the Web workbench for now.");
        }
        const run = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger });
        let runtimeFailureCode = "generation_failed";
        if (revising) {
          let draft: GeneratedPlanDraft;
          try {
            draft = await runtime.generatePlanDraft({
              request: command.request,
              currentPlan: planDraftForRevision(workspace.activePlan),
              completedTasks: completedTasksForRevision(workspace.activePlan),
              profile: { preferredLanguage: workspace.profile.preferredLanguage, nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus }
            });
          } catch (error) {
            runtimeFailureCode = planningGeneration.planGenerationFailureCode(error);
            store.finishPlanGenerationRun({ runId: run.id, status: "failed", failureCode: runtimeFailureCode });
            const currentPlan = store.getWorkspace().activePlan;
            return telegramPlanReplies(currentPlan, `${runtimeName(workspace.runtime.selectedKind)} could not revise the Plan, so the current draft was left unchanged. Retry your correction or use /new for a separate Plan.`);
          }
          let revised;
          try {
            revised = store.reviseGeneratedPlan({ draft, runtime: workspace.runtime.selectedKind, expectedPlanId: workspace.activePlan.id, expectedVersion: workspace.activePlan.version });
          } catch (error) {
            runtimeFailureCode = planningGeneration.planGenerationFailureCode(error);
            store.finishPlanGenerationRun({ runId: run.id, status: "failed", failureCode: runtimeFailureCode });
            const currentPlan = store.getWorkspace().activePlan;
            return telegramPlanReplies(currentPlan, "The Plan changed while the revision was being prepared, so the older result was not saved. Review the current Plan below.");
          }
          store.finishPlanGenerationRun({ runId: run.id, status: "succeeded", outputPlanId: revised.activePlan.id });
          const refinement = planRefinementState(revised.activePlan);
          if (refinement.followUpQuestion) {
            return [{ text: withTelegramExecutionContinuity(revised, `${runtimeName(workspace.runtime.selectedKind)} updated the Plan skeleton from your answer.\n\n${refinement.followUpQuestion}`) }];
          }
          return telegramPlanReplies(revised.activePlan, withTelegramExecutionContinuity(revised, `${runtimeName(workspace.runtime.selectedKind)} revised the current Plan from your correction.`));
        }
        throw new Error("Unreachable Telegram Plan generation mode.");
      } finally {
        setGeneratingPlan(false);
      }
    }
    if (command.type === "start") return [{ text: messagingStartText(trigger) }];
    return [{ text: unknownCommandText() }];
  };
}

function currentPlanDestination(store: SqliteWorkspaceStore, plan: Plan): string {
  if (!plan.presentation || plan.presentation.kind !== "itinerary") return plan.location;
  return resolveCurrentPlanDestination(plan.presentation, { arrivals: store.listPlanDestinationArrivals(plan.id) })?.city ?? plan.location;
}
