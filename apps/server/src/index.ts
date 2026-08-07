import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeRuntimeAdapter, CodexRuntimeAdapter, RuntimeAdapterError } from "@c-assistant/agent-adapters";
import { AmapConnector, OfficialSourceConnector, QWeatherConnector, TelegramConnector, type AmapPlace, type AmapRoute, type TelegramReplyMarkup } from "@c-assistant/connectors";
import { runFoodNearbySkill } from "@c-assistant/china-country-pack";
import { assessPolicyPreparation, type AgentRuntimeKind, type CreatePlanInput, type GeneratedPlanDraft, type PlanAccommodationInput, type PlanArrivalInput, type PlanTransportPreferenceInput, type PlanTravelContextInput, type ProfileUpdate, type RuntimeSelectionUpdate } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { arrivalInstant, formatArrivalReminder, isArrivalLocationPromptDue, isArrivalReminderDue } from "./arrival-reminder.js";
import { arrivalRouteDestination, formatArrivalRoute, selectArrivalTransport } from "./arrival-route.js";
import { createOfficialSourceService, parseOfficialSourceRegistry } from "./official-sources.js";
import { parseTelegramCommand } from "./telegram-commands.js";
import { formatTelegramNearbyFood, parseTelegramFoodPartyCallback, telegramFoodPartyMarkup } from "./telegram-food.js";
import { createTelegramPlan, formatTelegramPlanCreationPages, formatTelegramPlanPages, planDraftForRevision, telegramPlanConfirmationDecision, telegramPlanConfirmationMarkup, telegramPlanRequestMode } from "./telegram-plan.js";
import { formatTelegramProfile, parseTelegramProfileCallback, telegramProfileChoiceMarkup, telegramProfileMarkup, telegramProfileTextPrompt, updateProfileText } from "./telegram-profile.js";
import { fetchTelegramPlanWeather, formatTelegramWeather } from "./telegram-weather.js";
import { assertWebAgentPlanUnchanged, formatWebAgentPlanReply, parseWebAgentTurn } from "./web-agent.js";
import { dueTaskReminders, formatTaskReminder } from "./task-reminder.js";
import { refreshTaskReminderWeather, taskReminderNeedsWeather, type TaskReminderWeatherContext } from "./task-reminder-weather.js";

const server = Fastify({ logger: true });
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const officialSourceRegistryPath = resolve(projectRoot, "country-packs", "china", "sources", "official-source-registry.json");
if (existsSync(envPath)) process.loadEnvFile(envPath);
const databasePath = process.env.C_ASSISTANT_DATA_PATH || resolve(projectRoot, "data", "c-assistant.sqlite");
const store = new SqliteWorkspaceStore(databasePath);
const amap = new AmapConnector({ apiKey: process.env.AMAP_API_KEY });
const qweather = new QWeatherConnector({ apiKey: process.env.QWEATHER_API_KEY, apiHost: process.env.QWEATHER_API_HOST });
const telegram = new TelegramConnector({ botToken: process.env.TELEGRAM_BOT_TOKEN });
const officialSources = createOfficialSourceService(new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(officialSourceRegistryPath, "utf8")) as unknown) }), store);
const codex = new CodexRuntimeAdapter();
const claudeCode = new ClaudeCodeRuntimeAdapter();
let generatingPlan = false;
let pollingTelegram = false;
let checkingArrivalReminder = false;
let checkingTaskReminders = false;
let checkingArrivalLocationPrompt = false;
let requestingArrivalLocation = false;
let requestingFoodLocation = false;

await server.register(cors, { origin: true });

server.get("/health", async () => ({
  status: "ok",
  service: "c-assistant-core",
  mode: "local"
}));

server.get("/api/workspace", async () => store.getWorkspace());
server.get("/api/runs", async () => store.listRecentAgentRuns());
server.get("/api/runs/task-reminders", async () => store.listRecentTaskReminderRuns());

server.get("/api/policy-applicability", async () => {
  const workspace = store.getWorkspace();
  return assessPolicyPreparation({
    profile: workspace.profile,
    plan: workspace.activePlan,
    sourceSnapshots: workspace.sourceSnapshots
  });
});

server.post<{ Params: { planId: string; snapshotId: string } }>("/api/plans/:planId/sources/:snapshotId", async (request, reply) => {
  try {
    return store.linkSourceSnapshotToPlan(request.params.planId, request.params.snapshotId);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The official evidence could not be linked to this Plan." });
  }
});

server.post<{ Params: { planId: string } }>("/api/plans/:planId/confirm", async (request, reply) => {
  try {
    return store.confirmPlan(request.params.planId);
  } catch (error) {
    return reply.code(404).send({
      error: error instanceof Error ? error.message : "Plan was not found."
    });
  }
});

server.post<{ Params: { planId: string; taskId: string } }>("/api/plans/:planId/tasks/:taskId/reminder/cancel", async (request, reply) => {
  try {
    return store.cancelTaskReminder(request.params.planId, request.params.taskId);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The Task reminder could not be cancelled." });
  }
});

server.put<{ Params: { planId: string }; Body: PlanAccommodationInput }>("/api/plans/:planId/accommodation", async (request, reply) => {
  try {
    return store.updatePlanAccommodation(request.params.planId, request.body);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The accommodation candidate could not be saved."
    });
  }
});

server.post<{ Params: { planId: string }; Body: { name?: string; address?: string; status?: "candidate" | "confirmed" } }>("/api/plans/:planId/accommodation/manual", async (request, reply) => {
  const name = request.body?.name?.trim() ?? "";
  const address = request.body?.address?.trim() ?? "";
  if (!name || !address) return reply.code(400).send({ error: "Enter both the accommodation name and its address or area." });

  const resolved = await amap.geocodeAddress({ address });
  if (resolved.status !== "available") return reply.code(connectorResponseStatus(resolved.status)).send(resolved);
  if (!resolved.data) return reply.code(404).send({ error: "Amap could not resolve that accommodation address." });

  try {
    return store.updatePlanAccommodation(request.params.planId, {
      status: request.body.status === "confirmed" ? "confirmed" : "candidate",
      name,
      address: resolved.data.formattedAddress,
      location: resolved.data.location,
      source: "user"
    });
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The accommodation could not be saved."
    });
  }
});

server.put<{ Params: { planId: string }; Body: PlanTransportPreferenceInput }>("/api/plans/:planId/transport-preference", async (request, reply) => {
  try {
    return store.updatePlanTransportPreference(request.params.planId, request.body);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The transport preference could not be saved."
    });
  }
});

server.put<{ Params: { planId: string }; Body: PlanTravelContextInput }>("/api/plans/:planId/travel-context", async (request, reply) => {
  try {
    return store.updatePlanTravelContext(request.params.planId, request.body);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The travel context could not be saved."
    });
  }
});

server.put<{ Params: { planId: string }; Body: PlanArrivalInput }>("/api/plans/:planId/arrival", async (request, reply) => {
  try {
    return store.updatePlanArrival(request.params.planId, request.body);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The expected arrival could not be saved."
    });
  }
});

server.post<{ Body: CreatePlanInput }>("/api/plans", async (request, reply) => {
  try {
    return store.createPlan(request.body);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The Plan could not be created."
    });
  }
});

server.get("/api/runtimes/codex", async () => codex.check());
server.get("/api/runtimes/claude-code", async () => claudeCode.check());
server.get("/api/runtimes", async () => Promise.all([codex.check(), claudeCode.check()]));

server.put<{ Body: RuntimeSelectionUpdate }>("/api/runtime", async (request, reply) => {
  try {
    return store.updateRuntimeSelection(request.body);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The Plan runtime could not be selected." });
  }
});

server.post<{ Body: CreatePlanInput }>("/api/plans/generate", async (request, reply) => {
  if (generatingPlan) return reply.code(409).send({ error: "Another Plan generation is already running." });
  generatingPlan = true;
  let runId: string | undefined;
  try {
    const workspace = store.getWorkspace();
    runId = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "web" }).id;
    const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
    const draft = await runtime.generatePlanDraft({
      request: request.body.request,
      profile: {
        preferredLanguage: workspace.profile.preferredLanguage,
        nationality: workspace.profile.nationality,
        gender: workspace.profile.gender,
        immigrationStatus: workspace.profile.immigrationStatus
      }
    });
    const updated = store.createGeneratedPlan(draft, workspace.runtime.selectedKind);
    store.finishPlanGenerationRun({ runId, status: "succeeded", outputPlanId: updated.activePlan.id });
    return updated;
  } catch (error) {
    if (runId) store.finishPlanGenerationRun({ runId, status: "failed", failureCode: planGenerationFailureCode(error) });
    return reply.code(error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated") ? 503 : 400).send({
      error: error instanceof Error ? error.message : "The selected runtime could not generate a Plan draft."
    });
  } finally {
    generatingPlan = false;
  }
});

server.post<{ Body: unknown }>("/api/agent/chat", async (request, reply) => {
  let turn: ReturnType<typeof parseWebAgentTurn>;
  try {
    turn = parseWebAgentTurn(request.body);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The Agent request is invalid." });
  }
  if (generatingPlan) return reply.code(409).send({ error: "The Agent is already working on a Plan. Please wait for that response." });

  generatingPlan = true;
  let runId: string | undefined;
  try {
    const workspace = store.getWorkspace();
    if (turn.mode === "revise_plan" && workspace.activePlan.status !== "draft") {
      return reply.code(400).send({ error: "Only a draft Plan can be revised. Start a new Plan or review the active Plan first." });
    }
    runId = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "web" }).id;
    const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
    const draft = await runtime.generatePlanDraft({
      request: turn.message,
      ...(turn.mode === "revise_plan" ? { currentPlan: planDraftForRevision(workspace.activePlan) } : {}),
      profile: {
        preferredLanguage: workspace.profile.preferredLanguage,
        nationality: workspace.profile.nationality,
        gender: workspace.profile.gender,
        immigrationStatus: workspace.profile.immigrationStatus
      }
    });
    assertWebAgentPlanUnchanged(workspace.activePlan, store.getWorkspace().activePlan);
    const updated = turn.mode === "revise_plan"
      ? store.reviseGeneratedPlan({ draft, runtime: workspace.runtime.selectedKind, expectedPlanId: workspace.activePlan.id, expectedVersion: workspace.activePlan.version })
      : store.createGeneratedPlan(draft, workspace.runtime.selectedKind);
    store.finishPlanGenerationRun({ runId, status: "succeeded", outputPlanId: updated.activePlan.id });
    return {
      reply: formatWebAgentPlanReply({ runtimeName: runtimeName(workspace.runtime.selectedKind), mode: turn.mode, plan: updated.activePlan }),
      workspace: updated
    };
  } catch (error) {
    if (runId) store.finishPlanGenerationRun({ runId, status: "failed", failureCode: planGenerationFailureCode(error) });
    return reply.code(error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated") ? 503 : 400).send({
      error: error instanceof Error ? error.message : "The Agent could not respond right now."
    });
  } finally {
    generatingPlan = false;
  }
});

server.put<{ Body: ProfileUpdate }>("/api/profile", async (request, reply) => {
  try {
    return store.updateProfile(request.body);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The Profile could not be saved."
    });
  }
});

server.get("/api/connectors/amap", async () => amap.configurationStatus());

server.get("/api/connectors/qweather", async () => qweather.configurationStatus());

server.get<{ Querystring: { topic?: string } }>("/api/official-sources", async (request) => officialSources.discover(request.query.topic));

server.post<{ Params: { sourceId: string }; Body: { url?: string } }>("/api/official-sources/:sourceId/refresh", async (request, reply) => {
  const result = await officialSources.refresh({ sourceId: request.params.sourceId, url: request.body?.url });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: { location?: string; language?: string } }>("/api/weather", async (request, reply) => {
  const configuration = qweather.configurationStatus();
  if (configuration.status !== "available") return reply.code(connectorResponseStatus(configuration.status)).send(configuration);
  const requestedLocation = request.query.location?.trim() ?? "";
  if (!requestedLocation) return reply.code(400).send({ error: "A weather check needs a city or region name." });
  const placeFacts = await amap.geocodeAddress({ address: requestedLocation });
  if (placeFacts.status !== "available") return reply.code(connectorResponseStatus(placeFacts.status)).send(placeFacts);
  if (!placeFacts.data) return reply.code(404).send({ error: "Amap could not resolve that city or region." });
  const place = placeFacts.data;
  const result = await qweather.weather({
    coordinates: place.location,
    locationName: place.formattedAddress,
    adminArea: place.district || place.city || place.province,
    country: "China",
    language: request.query.language === "zh" ? "zh" : "en"
  });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get("/api/connectors/telegram", async () => telegram.configurationStatus());

server.post("/api/connectors/telegram/verify", async (_request, reply) => {
  const result = await telegram.getMe();
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get("/api/connectors/telegram/pairing", async () => store.getTelegramPairingStatus());

server.delete("/api/connectors/telegram/pairing", async () => store.unpairTelegram());

server.post("/api/connectors/telegram/pairing/start", async (_request, reply) => {
  const identity = await telegram.getMe();
  if (identity.status !== "available" || !identity.data?.username) return reply.code(connectorResponseStatus(identity.status)).send(identity);
  const pairing = store.getTelegramPairingStatus();
  if (pairing.state === "paired") return pairing;
  const code = `pair_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const pending = store.createTelegramPairingRequest({ code, expiresAt });
  return {
    state: pending.state,
    code,
    expiresAt,
    botUsername: identity.data.username,
    deepLink: `https://t.me/${identity.data.username}?start=${code}`
  };
});

server.post<{ Body: { code?: string } }>("/api/connectors/telegram/pairing/complete", async (request, reply) => {
  const code = request.body?.code?.trim() ?? "";
  if (!code) return reply.code(400).send({ error: "A Telegram pairing code is required." });
  const pending = store.getTelegramPairingStatus();
  if (pending.state === "paired") return pending;
  if (pending.state !== "waiting_for_start") return reply.code(400).send({ error: "Start a new Telegram pairing from the Web workspace." });
  const updates = await telegram.getUpdates();
  if (updates.status !== "available") return reply.code(connectorResponseStatus(updates.status)).send(updates);
  const startUpdate = updates.data?.updates.find((update) => update.chatType === "private" && pairingCodeFromStart(update.text) === code);
  if (!startUpdate) return { state: "waiting_for_start", expiresAt: pending.expiresAt, foundStart: false };
  try {
    const paired = store.claimTelegramPairing({
      code,
      chatId: startUpdate.chatId,
      userId: startUpdate.userId,
      firstName: startUpdate.firstName,
      ...(startUpdate.username ? { username: startUpdate.username } : {})
    });
    store.advanceTelegramUpdateOffset(startUpdate.updateId + 1);
    const receipt = await telegram.sendMessage({ chatId: startUpdate.chatId, text: "C-assistant is connected to this Telegram account. You will control future reminders and actions from your Plan. Send /profile whenever you want to complete or change your basic long-term settings." });
    return { ...paired, confirmationMessageSent: receipt.status === "available" };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Telegram could not be paired." });
  }
});

server.get<{ Querystring: { query?: string; region?: string } }>("/api/amap/places", async (request, reply) => {
  const result = await amap.searchPlaces({ query: request.query.query ?? "", region: request.query.region });
  return reply.code(result.status === "available" ? 200 : result.status === "not_configured" ? 503 : 400).send(result);
});

server.get<{ Querystring: { location?: string } }>("/api/amap/nearby/restaurants", async (request, reply) => {
  const result = await amap.nearbyRestaurants({ location: request.query.location ?? "" });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: { location?: string } }>("/api/amap/nearby/accommodation", async (request, reply) => {
  const result = await amap.nearbyAccommodation({ location: request.query.location ?? "" });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/amap/routes/driving", async (request, reply) => {
  const result = await amap.drivingRoute({
    origin: request.query.origin ?? "",
    destination: request.query.destination ?? "",
    originId: request.query.originId,
    destinationId: request.query.destinationId
  });
  return reply.code(result.status === "available" ? 200 : result.status === "not_configured" ? 503 : 400).send(result);
});

server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/amap/routes/walking", async (request, reply) => {
  const result = await amap.walkingRoute({
    origin: request.query.origin ?? "",
    destination: request.query.destination ?? "",
    originId: request.query.originId,
    destinationId: request.query.destinationId
  });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: { origin?: string; destination?: string; originCityCode?: string; destinationCityCode?: string } }>("/api/amap/routes/transit", async (request, reply) => {
  const result = await amap.transitRoute({
    origin: request.query.origin ?? "",
    destination: request.query.destination ?? "",
    originCityCode: request.query.originCityCode,
    destinationCityCode: request.query.destinationCityCode
  });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

function connectorResponseStatus(status: "available" | "degraded" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "unsupported"): number {
  if (status === "available") return 200;
  if (status === "not_configured" || status === "unavailable") return 503;
  if (status === "unauthorized") return 401;
  if (status === "rate_limited") return 429;
  return 400;
}

function pairingCodeFromStart(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^\/start(?:@[-_A-Za-z0-9]+)?\s+([A-Za-z0-9_-]{12,96})$/);
  return match?.[1];
}

async function pollTelegram(): Promise<void> {
  if (pollingTelegram) return;
  const pairing = store.getTelegramPairingStatus();
  if (pairing.state !== "paired" || !pairing.binding) return;
  pollingTelegram = true;
  try {
    const offset = store.getTelegramUpdateOffset();
    const updates = await telegram.getUpdates({ ...(offset === undefined ? {} : { offset }), timeoutSeconds: 5 });
    if (updates.status !== "available" || !updates.data) return;
    for (const update of updates.data.updates) {
      if (update.chatType !== "private" || update.chatId !== pairing.binding.chatId || update.userId !== pairing.binding.userId) continue;
      if (!store.claimTelegramUpdate(update.updateId)) continue;
      if (update.kind === "callback") {
        const foodParty = parseTelegramFoodPartyCallback(update.callbackData);
        if (foodParty && update.callbackId) {
          const plan = store.getWorkspace().activePlan;
          if (plan.id !== foodParty.planId || plan.version !== foodParty.version) {
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "That Plan choice is out of date. Send /food again." });
          } else {
            store.updatePlanTravelContext(plan.id, { partySize: foodParty.partySize, luggage: plan.configuration.travelContext.luggage });
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: `Party size saved: ${foodParty.partySize}.` });
            await requestTelegramFoodLocation(pairing.binding.chatId);
          }
          continue;
        }
        const profileAction = parseTelegramProfileCallback(update.callbackData);
        if (profileAction.type !== "unknown" && update.callbackId) {
          if (profileAction.type === "edit_text") {
            store.startTelegramProfileTextEdit(profileAction.field);
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Send the value as your next message." });
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: telegramProfileTextPrompt(profileAction.field) });
          } else if (profileAction.type === "choose") {
            store.clearTelegramProfileTextEdit();
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Choose the value you want to save." });
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: profileAction.field === "gender" ? "Choose your gender setting. You may leave it unspecified." : "Choose the China visa or residence status you currently know. This is user-provided context, not a policy conclusion.", replyMarkup: telegramProfileChoiceMarkup(profileAction.field) });
          } else {
            store.clearTelegramProfileTextEdit();
            const current = store.getWorkspace().profile;
            const updated = store.updateProfile(profileAction.type === "set_gender" ? { ...current, gender: profileAction.value } : { ...current, immigrationStatus: profileAction.value });
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Profile saved locally." });
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: formatTelegramProfile(updated.profile), replyMarkup: telegramProfileMarkup() });
          }
          continue;
        }
        const confirmation = telegramPlanConfirmationDecision(store.getWorkspace().activePlan, update.callbackData);
        if (confirmation !== "not_confirmation" && update.callbackId) {
          if (confirmation === "confirm") {
            const confirmed = store.confirmPlan(store.getWorkspace().activePlan.id);
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Plan activated." });
            const profileNext = confirmed.profile.status === "incomplete" ? "\n\nYour Plan is active, but some policy-routing basics are still missing. Send /profile when convenient; this does not block other Plan work." : "";
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `Plan activated\n${confirmed.activePlan.title}\n\nApproved reminders and read-only preparation are now eligible to run. No booking, payment, ride, or other external action was started.${profileNext}` });
          } else if (confirmation === "already_active") {
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "This Plan is already active." });
          } else {
            const currentPlan = store.getWorkspace().activePlan;
            const replyMarkup = telegramPlanConfirmationMarkup(currentPlan);
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "That Plan version is no longer current." });
            const pages = formatTelegramPlanPages(currentPlan);
            const replies = pages.map((page, index): TelegramCommandReply => {
              const isLastPage = index === pages.length - 1;
              return { text: index === 0 ? `That confirmation button is out of date. Review the current Plan below.\n\n${page}` : page, ...(isLastPage && replyMarkup ? { replyMarkup } : {}) };
            });
            await sendTelegramCommandReplies(pairing.binding.chatId, replies);
          }
          continue;
        }
        if (update.callbackData === "arrival_not_here" && update.callbackId) {
          await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Share your location only if you want route help." });
          await requestTelegramArrivalLocation(pairing.binding.chatId, "If you want route help for this arrival, tap the button below to share your current location.");
        }
        const completedTaskId = update.callbackData?.match(/^arrival_task_complete:(task-[0-9a-f-]{36})$/)?.[1];
        if (completedTaskId && update.callbackId) {
          const completed = store.completeReadyTask(store.getWorkspace().activePlan.id, completedTaskId);
          await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: completed ? "Task marked complete." : "That task is not ready to complete." });
          if (completed) await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `Completed by your confirmation: ${completed.title}\n\nNo external completion was inferred by C-assistant.` });
        }
        continue;
      }
      if (update.location) {
        const intent = store.getTelegramLocationIntent();
        store.clearTelegramLocationIntent();
        const currentPlan = store.getWorkspace().activePlan;
        if (!intent || intent.planId !== currentPlan.id) {
          await telegram.sendMessage({ chatId: pairing.binding.chatId, text: "There is no active location request for the current Plan. Send /food for nearby food, or use the arrival route action when it appears. These coordinates were not used or saved." });
        } else if (intent.purpose === "nearby_food") {
          await sendNearbyFoodFromSharedLocation(pairing.binding.chatId, update.location);
        } else {
          await sendArrivalRouteFromSharedLocation(pairing.binding.chatId, update.location);
        }
        continue;
      }
      const pendingProfileField = store.getTelegramProfileTextEdit();
      if (pendingProfileField && update.text && !update.text.startsWith("/")) {
        try {
          const updated = store.updateProfile(updateProfileText(store.getWorkspace().profile, pendingProfileField, update.text));
          store.clearTelegramProfileTextEdit();
          await telegram.sendMessage({ chatId: pairing.binding.chatId, text: formatTelegramProfile(updated.profile), replyMarkup: telegramProfileMarkup() });
        } catch (error) {
          await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `${error instanceof Error ? error.message : "That Profile value could not be saved."}\n\n${telegramProfileTextPrompt(pendingProfileField)}` });
        }
        continue;
      }
      const responses = await telegramCommandResponse(update.text);
      if (responses) await sendTelegramCommandReplies(pairing.binding.chatId, responses);
    }
    if (updates.data.nextOffset !== undefined) store.advanceTelegramUpdateOffset(updates.data.nextOffset);
  } catch (error) {
    server.log.warn({ error }, "Telegram polling failed");
  } finally {
    pollingTelegram = false;
  }
}

async function sendArrivalRouteFromSharedLocation(chatId: string, location: { latitude: number; longitude: number }): Promise<void> {
  const plan = store.getWorkspace().activePlan;
  store.markTelegramArrivalLocationReceived(plan.id, new Date().toISOString());
  const destination = arrivalRouteDestination(plan);
  if (!destination) {
    await telegram.sendMessage({ chatId, text: "Location received for this interaction, but this Plan does not yet contain a specific accommodation or destination. Add the hotel or destination in the Web workspace, then request route help again. The shared coordinates were not saved to your Profile or database." });
    return;
  }
  const gpsLocation = `${location.longitude},${location.latitude}`;
  const converted = await amap.convertGpsCoordinate({ location: gpsLocation });
  if (converted.status !== "available" || !converted.data) {
    await telegram.sendMessage({ chatId, text: "Location received, but Amap could not prepare a route from it right now. No location has been saved. You can still open your Plan and use the saved destination in Amap." });
    return;
  }
  const origin: AmapPlace = { id: "", name: "Shared current location", address: "", location: converted.data.location, type: "Temporary location", city: "", district: "" };
  const routeFacts: AmapRoute[] = [];
  const preference = plan.configuration.transport.preference;
  if (preference === "taxi") {
    const route = await amap.drivingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined });
    if (route.status === "available" && route.data) routeFacts.push(route.data);
  } else if (preference === "walking") {
    const route = await amap.walkingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined });
    if (route.status === "available" && route.data) routeFacts.push(route.data);
  } else if (preference === "public_transit") {
    const route = await arrivalTransitRoute(origin, destination);
    if (route) routeFacts.push(route);
  } else if (preference === "plan_recommended") {
    const [driving, walking, transit] = await Promise.all([
      amap.drivingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined }),
      amap.walkingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined }),
      arrivalTransitRoute(origin, destination)
    ]);
    if (driving.status === "available" && driving.data) routeFacts.push(driving.data);
    if (walking.status === "available" && walking.data) routeFacts.push(walking.data);
    if (transit) routeFacts.push(transit);
  }
  const transport = selectArrivalTransport(plan, routeFacts);
  const selectedRoute = routeFacts.find((route) => route.mode === transport);
  const result = formatArrivalRoute({ origin, destination, transport, ...(selectedRoute ? { route: selectedRoute } : {}) });
  await telegram.sendMessage({ chatId, text: result.text, replyMarkup: { inline_keyboard: [[{ text: "Open route in Amap", url: result.handoffUrl }]] } });
}

async function sendNearbyFoodFromSharedLocation(chatId: string, location: { latitude: number; longitude: number }): Promise<void> {
  const plan = store.getWorkspace().activePlan;
  const partySize = plan.configuration.travelContext.partySize;
  if (!partySize) {
    await telegram.sendMessage({ chatId, text: "Party size is missing from this Plan. The shared coordinates were not used or saved. Send /food followed by the number of people, for example /food 2." });
    return;
  }
  const converted = await amap.convertGpsCoordinate({ location: `${location.longitude},${location.latitude}` });
  if (converted.status !== "available" || !converted.data) {
    await telegram.sendMessage({ chatId, text: "Location received, but Amap could not convert it for nearby discovery right now. No location was saved and no restaurant facts were guessed." });
    return;
  }
  const result = await amap.nearbyRestaurants({ location: converted.data.location, limit: 8 });
  if (result.status !== "available" || !result.data) {
    await telegram.sendMessage({ chatId, text: `Amap could not return nearby food right now. ${result.failure?.message ?? "The provider is unavailable."}\n\nNo location was saved, and no candidate, order, reservation, or payment was created.` });
    return;
  }
  const skillResult = runFoodNearbySkill({ partySize, candidates: result.data, observedAt: result.observedAt });
  await telegram.sendMessage({ chatId, ...formatTelegramNearbyFood({ result: skillResult, places: result.data, partySize }) });
}

async function arrivalTransitRoute(origin: AmapPlace, destination: AmapPlace): Promise<AmapRoute | undefined> {
  const [originArea, destinationArea] = await Promise.all([
    amap.reverseGeocode({ location: origin.location }),
    amap.reverseGeocode({ location: destination.location })
  ]);
  if (originArea.status !== "available" || !originArea.data || destinationArea.status !== "available" || !destinationArea.data) return undefined;
  const route = await amap.transitRoute({
    origin: origin.location,
    destination: destination.location,
    originCityCode: originArea.data.cityCode,
    destinationCityCode: destinationArea.data.cityCode
  });
  return route.status === "available" && route.data ? route.data : undefined;
}

async function runArrivalReminder(): Promise<void> {
  if (checkingArrivalReminder) return;
  const pairing = store.getTelegramPairingStatus();
  if (pairing.state !== "paired" || !pairing.binding) return;
  const workspace = store.getWorkspace();
  const plan = workspace.activePlan;
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
    const updatedPlan = store.getWorkspace().activePlan;
    const buttons: Array<{ text: string; callback_data: string }> = [{ text: "I haven't arrived", callback_data: "arrival_not_here" }];
    if (arrivalTask) buttons.push({ text: "I completed this step", callback_data: `arrival_task_complete:${arrivalTask.id}` });
    const receipt = await telegram.sendMessage({ chatId: pairing.binding.chatId, text: formatArrivalReminder(updatedPlan, arrivalTask), replyMarkup: { inline_keyboard: [buttons] } });
    if (receipt.status !== "available") server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram arrival reminder could not be delivered");
    else store.recordTelegramArrivalCheckin({ planId: plan.id, checkInSentAt: new Date().toISOString() });
  } catch (error) {
    server.log.warn({ error }, "Telegram arrival reminder failed");
  } finally {
    checkingArrivalReminder = false;
  }
}

async function runTaskReminders(): Promise<void> {
  if (checkingTaskReminders) return;
  const pairing = store.getTelegramPairingStatus();
  if (pairing.state !== "paired" || !pairing.binding) return;
  const plan = store.getWorkspace().activePlan;
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
            language: /^zh|chinese/i.test(store.getWorkspace().profile.preferredLanguage) ? "zh" : "en",
            dependencies: {
              geocodeAddress: (input) => amap.geocodeAddress(input),
              weather: (input) => qweather.weather(input)
            }
          });
          if (refreshed.status === "available") {
            weather = refreshed.data;
            store.recordTaskReminderRunWeather({ runId: run.id, status: "available" });
          } else {
            store.recordTaskReminderRunWeather({ runId: run.id, status: "unavailable", stage: refreshed.stage, failureCode: refreshed.code });
            server.log.warn({ stage: refreshed.stage, code: refreshed.code, taskId: item.task.id }, "Task reminder weather context was unavailable");
          }
        } catch (error) {
          store.recordTaskReminderRunWeather({ runId: run.id, status: "unavailable", stage: "pipeline", failureCode: "unexpected_error" });
          server.log.warn({ error, taskId: item.task.id }, "Task reminder weather refresh failed unexpectedly");
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
        server.log.warn({ status: receipt.status, code: receipt.failure?.code, taskId: item.task.id, attempt: attempt.attemptNumber, outcome: outcome.status }, "Telegram Task reminder could not be delivered");
      }
    }
  } catch (error) {
    server.log.warn({ error }, "Telegram Task reminder failed");
  } finally {
    checkingTaskReminders = false;
  }
}

async function runArrivalLocationPrompt(): Promise<void> {
  if (checkingArrivalLocationPrompt) return;
  const pairing = store.getTelegramPairingStatus();
  if (pairing.state !== "paired" || !pairing.binding) return;
  const plan = store.getWorkspace().activePlan;
  if (plan.status !== "active") return;
  const checkin = store.getTelegramArrivalCheckin(plan.id);
  if (!checkin || checkin.locationRequestedAt || checkin.locationReceivedAt || !isArrivalLocationPromptDue(checkin.checkInSentAt)) return;
  checkingArrivalLocationPrompt = true;
  try {
    await requestTelegramArrivalLocation(pairing.binding.chatId, "We have not received an arrival update. If you want route help, tap the button below to share your current location.");
  } finally {
    checkingArrivalLocationPrompt = false;
  }
}

async function requestTelegramArrivalLocation(chatId: string, intro: string): Promise<void> {
  if (requestingArrivalLocation) return;
  const planId = store.getWorkspace().activePlan.id;
  const existing = store.getTelegramArrivalCheckin(planId);
  const activeIntent = store.getTelegramLocationIntent();
  if (existing?.locationReceivedAt || (activeIntent?.purpose === "arrival_route" && activeIntent.planId === planId)) return;
  requestingArrivalLocation = true;
  try {
    const receipt = await telegram.sendMessage({ chatId, text: `${intro} C-assistant will use it only for this interaction and will not save it to your Profile.`, replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
    if (receipt.status === "available") {
      store.markTelegramArrivalLocationRequested(planId, new Date().toISOString());
      store.startTelegramLocationIntent({ purpose: "arrival_route", planId });
    }
    else server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram arrival location request could not be delivered");
  } finally {
    requestingArrivalLocation = false;
  }
}

async function requestTelegramFoodLocation(chatId: string): Promise<void> {
  if (requestingFoodLocation) return;
  requestingFoodLocation = true;
  const planId = store.getWorkspace().activePlan.id;
  try {
    const receipt = await telegram.sendMessage({
      chatId,
      text: "Tap below to share your current location for this nearby food check. It will be used once, expires after 15 minutes, and will not be saved to your Profile or database.",
      replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true }
    });
    if (receipt.status === "available") store.startTelegramLocationIntent({ purpose: "nearby_food", planId });
    else server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram food location request could not be delivered");
  } finally {
    requestingFoodLocation = false;
  }
}

type TelegramCommandReply = { text: string; replyMarkup?: TelegramReplyMarkup; locationIntent?: { purpose: "nearby_food"; planId: string } };

async function sendTelegramCommandReplies(chatId: string, replies: TelegramCommandReply[]): Promise<void> {
  for (const reply of replies) {
    const { locationIntent, ...message } = reply;
    const receipt = await telegram.sendMessage({ chatId, ...message });
    if (receipt.status === "available") {
      if (locationIntent && store.getWorkspace().activePlan.id === locationIntent.planId) store.startTelegramLocationIntent(locationIntent);
      continue;
    }
    server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram command response could not be delivered completely");
    return;
  }
}

async function telegramCommandResponse(text: string | undefined): Promise<TelegramCommandReply[] | undefined> {
  const command = parseTelegramCommand(text);
  if (command.type === "empty") return undefined;
  if (command.type === "help") return [{ text: "C-assistant is connected. Send a normal message to create or revise a Plan draft with your selected local runtime, or use:\n/plan — show the current Plan and confirmation control\n/new <what you need to do> — create a separate Plan draft\n/profile — review or change your basic Profile\n/weather — check current weather for the Plan location\n/food — find nearby food after an explicit location share\n/help — show this help\n\nReview the complete Plan in Telegram or Web before confirming it. Bookings and payments are not enabled." }];
  if (command.type === "plan") {
    const plan = store.getWorkspace().activePlan;
    const replyMarkup = telegramPlanConfirmationMarkup(plan);
    const pages = formatTelegramPlanPages(plan);
    return pages.map((page, index) => ({ text: page, ...(index === pages.length - 1 && replyMarkup ? { replyMarkup } : {}) }));
  }
  if (command.type === "profile") {
    store.clearTelegramProfileTextEdit();
    return [{ text: formatTelegramProfile(store.getWorkspace().profile), replyMarkup: telegramProfileMarkup() }];
  }
  if (command.type === "weather") {
    const workspace = store.getWorkspace();
    const weatherConfiguration = qweather.configurationStatus();
    if (weatherConfiguration.status !== "available") return [{ text: `Weather is unavailable for the current Plan. ${weatherConfiguration.failure?.message ?? "QWeather is not configured on this instance."}\n\nAmap was not called, no reminder was created, and your Plan was not changed.` }];
    const result = await fetchTelegramPlanWeather({
      location: workspace.activePlan.location,
      language: /^zh|chinese/i.test(workspace.profile.preferredLanguage) ? "zh" : "en",
      dependencies: {
        geocodeAddress: (input) => amap.geocodeAddress(input),
        weather: (input) => qweather.weather(input)
      }
    });
    return [{ text: result.status === "available" ? formatTelegramWeather(result.data) : `Weather is unavailable for the current Plan. ${result.message}\nFailure stage: ${result.stage}${result.connectorStatus ? ` · status: ${result.connectorStatus}` : ""}\n\nNo weather was guessed, no reminder was created, and your Plan was not changed.` }];
  }
  if (command.type === "food") {
    const plan = store.getWorkspace().activePlan;
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
  if (command.type === "create_plan") {
    if (command.request.length > 1_500) return [{ text: "Keep a new Plan request under 1,500 characters, then send it again." }];
    if (generatingPlan) return [{ text: "A Plan draft is already being prepared. Please wait for it before sending another request." }];
    generatingPlan = true;
    try {
      const workspace = store.getWorkspace();
      const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
      const run = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "telegram" });
      let runtimeFailureCode = "generation_failed";
      const revising = telegramPlanRequestMode(workspace, command.explicit) === "revise";
      if (revising) {
        let draft: GeneratedPlanDraft;
        try {
          draft = await runtime.generatePlanDraft({
            request: command.request,
            currentPlan: planDraftForRevision(workspace.activePlan),
            profile: { preferredLanguage: workspace.profile.preferredLanguage, nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus }
          });
        } catch (error) {
          runtimeFailureCode = planGenerationFailureCode(error);
          store.finishPlanGenerationRun({ runId: run.id, status: "failed", failureCode: runtimeFailureCode });
          const currentPlan = store.getWorkspace().activePlan;
          return telegramPlanReplies(currentPlan, `${runtimeName(workspace.runtime.selectedKind)} could not revise the Plan, so the current draft was left unchanged. Retry your correction or use /new for a separate Plan.`);
        }
        let revised;
        try {
          revised = store.reviseGeneratedPlan({ draft, runtime: workspace.runtime.selectedKind, expectedPlanId: workspace.activePlan.id, expectedVersion: workspace.activePlan.version });
        } catch (error) {
          runtimeFailureCode = planGenerationFailureCode(error);
          store.finishPlanGenerationRun({ runId: run.id, status: "failed", failureCode: runtimeFailureCode });
          const currentPlan = store.getWorkspace().activePlan;
          return telegramPlanReplies(currentPlan, "The Plan changed while the revision was being prepared, so the older result was not saved. Review the current Plan below.");
        }
        store.finishPlanGenerationRun({ runId: run.id, status: "succeeded", outputPlanId: revised.activePlan.id });
        return telegramPlanReplies(revised.activePlan, `${runtimeName(workspace.runtime.selectedKind)} revised the current Plan from your correction.`);
      }
      const result = await createTelegramPlan({
        request: command.request,
        runtime: workspace.runtime.selectedKind,
        generate: async () => {
          try {
            return await runtime.generatePlanDraft({ request: command.request, profile: { preferredLanguage: workspace.profile.preferredLanguage, nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus } });
          } catch (error) {
            runtimeFailureCode = planGenerationFailureCode(error);
            throw error;
          }
        },
        saveGenerated: (draft) => store.createGeneratedPlan(draft, workspace.runtime.selectedKind),
        saveTemplate: () => store.createPlan({ request: command.request })
      });
      store.finishPlanGenerationRun(result.source === "runtime"
        ? { runId: run.id, status: "succeeded", outputPlanId: result.workspace.activePlan.id }
        : { runId: run.id, status: "fallback", failureCode: runtimeFailureCode });
      const replyMarkup = telegramPlanConfirmationMarkup(result.workspace.activePlan);
      const pages = formatTelegramPlanCreationPages(result);
      return pages.map((page, index) => ({ text: page, ...(index === pages.length - 1 && replyMarkup ? { replyMarkup } : {}) }));
    } finally {
      generatingPlan = false;
    }
  }
  if (command.type === "start") return [{ text: "This Telegram account is already connected to C-assistant. Send /help to see available commands." }];
  return [{ text: "That command is not available yet. Send /help to see what C-assistant can do." }];
}

function telegramPlanReplies(plan: ReturnType<SqliteWorkspaceStore["getWorkspace"]>["activePlan"], intro?: string): TelegramCommandReply[] {
  const replyMarkup = telegramPlanConfirmationMarkup(plan);
  const pages = formatTelegramPlanPages(plan);
  return pages.map((page, index) => ({
    text: index === 0 && intro ? `${intro}\n\n${page}` : page,
    ...(index === pages.length - 1 && replyMarkup ? { replyMarkup } : {})
  }));
}

function runtimeName(kind: AgentRuntimeKind): string {
  return kind === "claude-code" ? "Claude Code" : "Codex";
}

function selectedRuntimeAdapter(kind: AgentRuntimeKind): CodexRuntimeAdapter | ClaudeCodeRuntimeAdapter {
  return kind === "claude-code" ? claudeCode : codex;
}

function planGenerationFailureCode(error: unknown): string {
  return error instanceof RuntimeAdapterError ? error.code : "generation_failed";
}

const port = Number(process.env.C_ASSISTANT_PORT ?? 8787);
const host = process.env.C_ASSISTANT_HOST ?? "127.0.0.1";

await server.listen({ port, host });
const telegramPollTimer = setInterval(() => void pollTelegram(), 1_000);
const arrivalReminderTimer = setInterval(() => void runArrivalReminder(), 15_000);
const taskReminderTimer = setInterval(() => void runTaskReminders(), 15_000);
const arrivalLocationPromptTimer = setInterval(() => void runArrivalLocationPrompt(), 15_000);
void pollTelegram();
void runArrivalReminder();
void runTaskReminders();
void runArrivalLocationPrompt();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(telegramPollTimer);
    clearInterval(arrivalReminderTimer);
    clearInterval(taskReminderTimer);
    clearInterval(arrivalLocationPromptTimer);
    store.close();
    void server.close().finally(() => process.exit(0));
  });
}
