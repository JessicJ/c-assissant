import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexRuntimeAdapter, RuntimeAdapterError } from "@c-assistant/agent-adapters";
import { AmapConnector, QWeatherConnector, TelegramConnector, type AmapPlace, type AmapRoute } from "@c-assistant/connectors";
import type { CreatePlanInput, PlanAccommodationInput, PlanArrivalInput, PlanTransportPreferenceInput, PlanTravelContextInput, ProfileUpdate } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { arrivalInstant, formatArrivalReminder, isArrivalLocationPromptDue, isArrivalReminderDue } from "./arrival-reminder.js";
import { arrivalRouteDestination, formatArrivalRoute, selectArrivalTransport } from "./arrival-route.js";
import { parseTelegramCommand } from "./telegram-commands.js";

const server = Fastify({ logger: true });
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const databasePath = process.env.C_ASSISTANT_DATA_PATH || resolve(projectRoot, "data", "c-assistant.sqlite");
const store = new SqliteWorkspaceStore(databasePath);
const amap = new AmapConnector({ apiKey: process.env.AMAP_API_KEY });
const qweather = new QWeatherConnector({ apiKey: process.env.QWEATHER_API_KEY, apiHost: process.env.QWEATHER_API_HOST });
const telegram = new TelegramConnector({ botToken: process.env.TELEGRAM_BOT_TOKEN });
const codex = new CodexRuntimeAdapter();
let generatingPlan = false;
let pollingTelegram = false;
let checkingArrivalReminder = false;
let checkingArrivalLocationPrompt = false;
let requestingArrivalLocation = false;

await server.register(cors, { origin: true });

server.get("/health", async () => ({
  status: "ok",
  service: "c-assistant-core",
  mode: "local"
}));

server.get("/api/workspace", async () => store.getWorkspace());

server.post<{ Params: { planId: string } }>("/api/plans/:planId/confirm", async (request, reply) => {
  try {
    return store.confirmPlan(request.params.planId);
  } catch (error) {
    return reply.code(404).send({
      error: error instanceof Error ? error.message : "Plan was not found."
    });
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

server.post<{ Body: CreatePlanInput }>("/api/plans/generate", async (request, reply) => {
  if (generatingPlan) return reply.code(409).send({ error: "Another Plan generation is already running." });
  generatingPlan = true;
  try {
    const workspace = store.getWorkspace();
    const draft = await codex.generatePlanDraft({
      request: request.body.request,
      profile: {
        preferredLanguage: workspace.profile.preferredLanguage,
        nationality: workspace.profile.nationality
      }
    });
    return store.createGeneratedPlan(draft);
  } catch (error) {
    return reply.code(error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated") ? 503 : 400).send({
      error: error instanceof Error ? error.message : "Codex could not generate a Plan draft."
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
    const receipt = await telegram.sendMessage({ chatId: startUpdate.chatId, text: "C-assistant is connected to this Telegram account. You will control future reminders and actions from your Plan." });
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
        if (update.callbackData === "arrival_not_here" && update.callbackId) {
          await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Share your location only if you want route help." });
          await requestTelegramArrivalLocation(pairing.binding.chatId, "If you want route help for this arrival, tap the button below to share your current location.");
        }
        continue;
      }
      if (update.location) {
        await sendArrivalRouteFromSharedLocation(pairing.binding.chatId, update.location);
        continue;
      }
      const response = telegramCommandResponse(update.text);
      if (response) await telegram.sendMessage({ chatId: pairing.binding.chatId, text: response });
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
  } else if (preference === "plan_recommended") {
    const [driving, walking] = await Promise.all([
      amap.drivingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined }),
      amap.walkingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined })
    ]);
    if (driving.status === "available" && driving.data) routeFacts.push(driving.data);
    if (walking.status === "available" && walking.data) routeFacts.push(walking.data);
  }
  const transport = selectArrivalTransport(plan, routeFacts);
  const selectedRoute = routeFacts.find((route) => route.mode === transport);
  const result = formatArrivalRoute({ origin, destination, transport, ...(selectedRoute ? { route: selectedRoute } : {}) });
  await telegram.sendMessage({ chatId, text: result.text, replyMarkup: { inline_keyboard: [[{ text: "Open route in Amap", url: result.handoffUrl }]] } });
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
    const receipt = await telegram.sendMessage({ chatId: pairing.binding.chatId, text: formatArrivalReminder(plan), replyMarkup: { inline_keyboard: [[{ text: "I haven't arrived", callback_data: "arrival_not_here" }]] } });
    if (receipt.status !== "available") server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram arrival reminder could not be delivered");
    else store.recordTelegramArrivalCheckin({ planId: plan.id, checkInSentAt: new Date().toISOString() });
  } catch (error) {
    server.log.warn({ error }, "Telegram arrival reminder failed");
  } finally {
    checkingArrivalReminder = false;
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
  if (existing?.locationRequestedAt || existing?.locationReceivedAt) return;
  requestingArrivalLocation = true;
  try {
    const receipt = await telegram.sendMessage({ chatId, text: `${intro} C-assistant will use it only for this interaction and will not save it to your Profile.`, replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
    if (receipt.status === "available") store.markTelegramArrivalLocationRequested(planId, new Date().toISOString());
    else server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram arrival location request could not be delivered");
  } finally {
    requestingArrivalLocation = false;
  }
}

function telegramCommandResponse(text: string | undefined): string | undefined {
  const command = parseTelegramCommand(text);
  if (command.type === "empty") return undefined;
  if (command.type === "help") return "C-assistant is connected. Send a normal message to create a draft Plan, or use:\n/plan — show the current Plan\n/new <what you need to do> — create a draft Plan\n/help — show this help\n\nReminders, location requests, bookings, and payments are not enabled.";
  if (command.type === "plan") {
    const plan = store.getWorkspace().activePlan;
    return `Current Plan\n${plan.title}\n${plan.location} · ${plan.dates}\nStatus: ${plan.status}\nNext: ${plan.nextAction}\n\nUse the Web workspace to review or confirm the complete Plan.`;
  }
  if (command.type === "create_plan") {
    if (command.request.length > 1_500) return "Keep a new Plan request under 1,500 characters, then send it again.";
    const workspace = store.createPlan({ request: command.request });
    return `A new draft Plan is ready for review:\n${workspace.activePlan.title}\n${workspace.activePlan.location} · ${workspace.activePlan.dates}\n\nReview and confirm the complete Plan in the Web workspace before any future automation.`;
  }
  if (command.type === "start") return "This Telegram account is already connected to C-assistant. Send /help to see available commands.";
  return "That command is not available yet. Send /help to see what C-assistant can do.";
}

const port = Number(process.env.C_ASSISTANT_PORT ?? 8787);
const host = process.env.C_ASSISTANT_HOST ?? "127.0.0.1";

await server.listen({ port, host });
const telegramPollTimer = setInterval(() => void pollTelegram(), 1_000);
const arrivalReminderTimer = setInterval(() => void runArrivalReminder(), 15_000);
const arrivalLocationPromptTimer = setInterval(() => void runArrivalLocationPrompt(), 15_000);
void pollTelegram();
void runArrivalReminder();
void runArrivalLocationPrompt();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(telegramPollTimer);
    clearInterval(arrivalReminderTimer);
    clearInterval(arrivalLocationPromptTimer);
    store.close();
    void server.close().finally(() => process.exit(0));
  });
}
