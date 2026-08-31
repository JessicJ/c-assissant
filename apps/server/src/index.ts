import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeRuntimeAdapter, CodexRuntimeAdapter, RuntimeAdapterError } from "@c-assistant/agent-adapters";
import { createUberRideHandoff, GoogleMapsConnector, GoogleWeatherConnector, OfficialSourceConnector, TelegramConnector, WhatsAppConnector, type ConnectorResult, type GeocodedPlaceFact, type PlaceFact, type RouteFact, type TelegramReplyMarkup, type WhatsAppIncomingMessage } from "@c-assistant/connectors";
import { runFoodNearbySkill, runHousingAreaRecommendationSkill, type PolicyApplicabilitySkillResult } from "@c-assistant/china-country-pack";
import { chinaSkillRegistry } from "@c-assistant/china-country-pack/registry";
import { createChinaReferenceCatalog } from "@c-assistant/china-country-pack/reference-catalog";
import { runJapanPolicyApplicabilitySkill } from "@c-assistant/japan-country-pack";
import {
  compileTripBlueprint,
  importSkillItinerary,
  importSkillResearchBatches,
  mergeResearchSetCheckpoint,
  resolveCurrentPlanDestination,
  type AgentRuntimeKind,
  type BlueprintBookingConstraint,
  type BlueprintGeneration,
  type BlueprintGenerationStage,
  type GeneratedPlanDraft,
  type BookingConstraintStrength,
  type BookingImportInput,
  type BookingImportPreview,
  type BookingSegment,
  type TravelBooking,
  type TravelBookingStatus,
  type TravelBookingType,
  type Plan,
  type PlanAccommodationInput,
  type PlanArrivalInput,
  type PlanTransportPreferenceInput,
  type PlanTravelContextInput,
  type PlanningFact,
  type PlanningSession,
  type ProfileUpdate,
  type ResearchSet,
  type RuntimeSelectionUpdate
} from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { arrivalInstant, formatArrivalReminder, isArrivalLocationPromptDue, isArrivalReminderDue, shouldRenewExpiredArrivalLocationRequest } from "./arrival-reminder.js";
import { arrivalRouteDestination, formatArrivalRoute, selectArrivalTransport } from "./arrival-route.js";
import { createMovementActionCard } from "./movement-action-card.js";
import { selectNextPlannedStop } from "./next-planned-stop.js";
import { DEFAULT_HANDOFF_SAFETY_SECONDS, DEFAULT_HANDOFF_WAIT_SECONDS, HANDOFF_DELAY_SECONDS, expectedArrivalAt, formatExpectedArrivalGuidance } from "./route-handoff.js";
import { createOfficialSourceService, parseOfficialSourceRegistry } from "./official-sources.js";
import { planRefinementState } from "./plan-refinement.js";
import { previewPlanChange } from "./plan-change-impact.js";
import { PlanRouteRefreshError, refreshGeneratedPlanRoutes, refreshPlanRouteFacts } from "./plan-route-refresh.js";
import { formatTransportChoiceAcknowledgement, parseTelegramCommand, shouldGenerateCompletePlan } from "./telegram-commands.js";
import { formatTelegramNearbyFood, parseTelegramFoodPartyCallback, telegramFoodPartyMarkup } from "./telegram-food.js";
import { formatTelegramMovementActionCard, formatTelegramMovementLocationRequest, formatTelegramMovementStaleConfirmation, parseTelegramMovementGoStaleCallback } from "./telegram-movement-card.js";
import { completedTasksForRevision, formatTelegramPlanChangeProposal, formatTelegramPlanPages, formatTelegramWorkspacePlanPages, parseTelegramPlanChangeAction, planDraftForRevision, telegramExecutionContinuityNotice, telegramPlanChangeMarkup, telegramPlanConfirmationDecision, telegramPlanConfirmationMarkup, telegramPlanRequestMode } from "./telegram-plan.js";
import { formatTelegramProfile, parseTelegramProfileCallback, telegramProfileChoiceMarkup, telegramProfileMarkup, telegramProfileTextPrompt, updateProfileText } from "./telegram-profile.js";
import { fetchTelegramPlanWeather, formatTelegramWeather } from "./telegram-weather.js";
import { assertWebAgentPlanUnchanged, formatWebAgentPlanReply, parseWebAgentTurn } from "./web-agent.js";
import { dueTaskReminders, formatTaskReminder } from "./task-reminder.js";
import { refreshTaskReminderWeather, taskReminderNeedsWeather, type TaskReminderWeatherContext } from "./task-reminder-weather.js";
import { createChinaArrivalFactCollector } from "./china-arrival-facts.js";
import { createChinaArrivalCompilationService } from "./china-plan-compilation.js";
import { createChinaPlanWorkflow } from "./china-plan-workflow.js";
import { presentChinaPlanPreparation } from "./china-plan-presentation.js";
import { createChinaSourcePreparationService } from "./china-source-preparation.js";
import { createJapanArrivalFactCollector } from "./japan-arrival-facts.js";
import { createJapanCompilationService } from "./japan-plan-compilation.js";
import { createJapanSourcePreparationService } from "./japan-source-preparation.js";
import { resolveCountryPack, type CountryPackId } from "./country-pack-resolver.js";
import { assessSetupReadiness } from "./setup-readiness.js";
import { fetchUserWeather } from "./user-weather.js";
import { normalizeWhatsAppUserNumber, whatsappActionFallback } from "./whatsapp-channel.js";
import { applyAgentPlanningTurn, applyExternalPlanningFacts, applyPlanningTurn, planningArrivalLocalDateTime, planningGenerationReuse, planningPartySize, planningRequestForGenerationWithBookings, planningResearchScopes, planningTransportPreference, prepareConfirmedPlanningSession } from "./planning-session.js";
import { prepareAccommodationDepartures } from "./accommodation-departure.js";
import { checkPlanCurrentWeather } from "./plan-weather-monitor.js";
import { checkPlanVenueStatuses } from "./plan-venue-monitor.js";
import { resolvePlanArrivalTimeZone } from "./plan-arrival-timezone.js";
import { dueItineraryDepartureReminders, formatItineraryDepartureReminder, itineraryPlaceMapUrl, itineraryReminderCandidateCities, normalizeCity } from "./itinerary-departure-reminder.js";

const server = Fastify({ logger: true });
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const officialSourceRegistryPath = resolve(projectRoot, "country-packs", "china", "sources", "official-source-registry.json");
const japanOfficialSourceRegistryPath = resolve(projectRoot, "country-packs", "japan", "sources", "official-source-registry.json");
const webDistPath = resolve(projectRoot, "apps", "web", "dist");
const webAssetsPath = resolve(webDistPath, "assets");
const webTripMapPath = resolve(webDistPath, "trip-map");
const webIndexPath = resolve(webDistPath, "index.html");
if (existsSync(envPath)) process.loadEnvFile(envPath);
const databasePath = process.env.C_ASSISTANT_DATA_PATH || resolve(projectRoot, "data", "c-assistant.sqlite");
const blueprintGenerationEnabled = process.env.LANDI_BLUEPRINT_GENERATION !== "0";
const store = new SqliteWorkspaceStore(databasePath);
let maps = new GoogleMapsConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
let googleWeather = new GoogleWeatherConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
let telegram = new TelegramConnector({ botToken: process.env.TELEGRAM_BOT_TOKEN });
let whatsapp = createWhatsAppConnectorFromEnvironment();
const officialSources = createOfficialSourceService(new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(officialSourceRegistryPath, "utf8")) as unknown) }), store);
const japanOfficialSources = createOfficialSourceService(new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(japanOfficialSourceRegistryPath, "utf8")) as unknown) }), store);
const chinaFactCollector = createChinaArrivalFactCollector({
  maps: {
    geocodeAddress: (input) => maps.geocodeAddress(input),
    nearbyAccommodation: (input) => maps.nearbyAccommodation(input),
    drivingRoute: (input) => maps.drivingRoute(input),
    walkingRoute: (input) => maps.walkingRoute(input),
    reverseGeocode: (input) => maps.reverseGeocode(input),
    transitRoute: (input) => maps.transitRoute(input)
  },
  weather: { weather: (input) => googleWeather.weather(input) },
  sourceSnapshots: () => store.getWorkspace().sourceSnapshots,
  referenceCatalog: (locationName) => createChinaReferenceCatalog({ snapshots: store.getWorkspace().sourceSnapshots, locationName })
});
const chinaCompilation = createChinaArrivalCompilationService({ store, factCollector: chinaFactCollector });
const chinaSourcePreparation = createChinaSourcePreparationService({ store, refresher: { refresh: (input) => officialSources.refresh(input) } });
const chinaPlanWorkflow = createChinaPlanWorkflow({ sourcePreparation: chinaSourcePreparation, compilation: chinaCompilation });
const japanFactCollector = createJapanArrivalFactCollector({
  maps: {
    geocodeAddress: (input) => maps.geocodeAddress(input),
    nearbyAccommodation: (input) => maps.nearbyAccommodation(input),
    drivingRoute: (input) => maps.drivingRoute(input),
    walkingRoute: (input) => maps.walkingRoute(input),
    reverseGeocode: (input) => maps.reverseGeocode(input),
    transitRoute: (input) => maps.transitRoute(input)
  },
  weather: { weather: (input) => googleWeather.weather(input) },
  sourceSnapshots: () => store.getWorkspace().sourceSnapshots
});
const japanCompilation = createJapanCompilationService({ store, factCollector: japanFactCollector });
const japanSourcePreparation = createJapanSourcePreparationService({ store, refresher: { refresh: (input) => japanOfficialSources.refresh(input) } });
const codex = new CodexRuntimeAdapter();
const claudeCode = new ClaudeCodeRuntimeAdapter();
let generatingPlan = false;
type PlanGenerationJob = {
  runId: string;
  sessionId: string;
  generationKey: string;
  stage: BlueprintGenerationStage | "failed" | "cancelled";
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  scopeLabel?: string | undefined;
  savedPlaceCount?: number;
  failureCode?: string;
  message?: string;
  controller: AbortController;
};
const planningGenerationJobs = new Map<string, PlanGenerationJob>();
let pollingTelegram = false;
let checkingArrivalReminder = false;
let checkingTaskReminders = false;
let checkingPlanWeather = false;
let checkingPlanVenues = false;
let checkingArrivalLocationPrompt = false;
let checkingRouteHandoffGuidance = false;
let checkingItineraryDepartureReminders = false;
let requestingArrivalLocation = false;
let requestingFoodLocation = false;
let requestingMovementGoLocation = false;
let creatingBackup = false;
const itineraryCityTimeZones = new Map<string, { timeZone: string; expiresAt: number }>();
const movementGoLocationSessions = new Map<string, { planVersion: number; stopId: string; confirmedStale: boolean }>();

const localWebOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
await server.register(cors, {
  origin: (origin, callback) => callback(null, !origin || localWebOrigin.test(origin))
});
if (existsSync(webAssetsPath)) {
  await server.register(fastifyStatic, {
    root: webAssetsPath,
    prefix: "/assets/"
  });
}
if (existsSync(webTripMapPath)) {
  await server.register(fastifyStatic, {
    root: webTripMapPath,
    prefix: "/trip-map/",
    decorateReply: false
  });
}
server.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && !localWebOrigin.test(origin)) return reply.code(403).send({ error: "This local instance accepts browser changes only from its local Web workspace." });
});

server.get("/", async (_request, reply) => {
  if (!existsSync(webIndexPath)) {
    return reply.code(503).type("text/plain; charset=utf-8").send("The Landi Web workspace has not been built. Run pnpm build first.");
  }
  return reply.type("text/html; charset=utf-8").send(readFileSync(webIndexPath, "utf8"));
});

server.get("/health", async () => ({
  status: "ok",
  service: "c-assistant-core",
  mode: "local"
}));

server.get("/api/workspace", async () => store.getWorkspace());
server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId", async (request, reply) => {
  const session = store.getPlanningSessionById(request.params.sessionId);
  return session ?? reply.code(404).send({ error: "The planning session was not found." });
});
server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId/bookings", async (request, reply) => {
  const session = store.getPlanningSessionById(request.params.sessionId);
  if (!session) return reply.code(404).send({ error: "The planning session was not found." });
  return { bookings: store.listTravelBookingsForPlanningSession(session.id) };
});
server.post<{ Body: BookingImportInput }>("/api/planning-sessions/bookings/import-preview", async (request, reply) => {
  try {
    return previewBookingImport(request.body, {});
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be previewed." });
  }
});
server.post<{ Body: { booking?: TravelBooking; sourceContent?: string } }>("/api/planning-sessions/bookings/import-confirm", async (request, reply) => {
  try {
    const session = store.getPlanningSession() ?? store.createPlanningSession("travel");
    const booking = normalizeAcceptedBooking(request.body.booking, { planningSessionId: session.id });
    store.saveTravelBooking(booking);
    saveProtectedBookingAttachment(booking, request.body.sourceContent);
    applyBookingFactsToPlanningSession(session.id, booking);
    return { workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(session.id), booking };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be saved." });
  }
});
server.post<{ Params: { sessionId: string }; Body: BookingImportInput }>("/api/planning-sessions/:sessionId/bookings/import-preview", async (request, reply) => {
  const session = store.getPlanningSessionById(request.params.sessionId);
  if (!session) return reply.code(404).send({ error: "The planning session was not found." });
  try {
    return previewBookingImport(request.body, { planningSessionId: session.id });
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be previewed." });
  }
});
server.post<{ Params: { sessionId: string }; Body: { booking?: TravelBooking; sourceContent?: string } }>("/api/planning-sessions/:sessionId/bookings/import-confirm", async (request, reply) => {
  const session = store.getPlanningSessionById(request.params.sessionId);
  if (!session) return reply.code(404).send({ error: "The planning session was not found." });
  try {
    const booking = normalizeAcceptedBooking(request.body.booking, { planningSessionId: session.id });
    store.saveTravelBooking(booking);
    saveProtectedBookingAttachment(booking, request.body.sourceContent);
    applyBookingFactsToPlanningSession(session.id, booking);
    return { workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(session.id), booking };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be saved." });
  }
});
server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId/generation", async (request, reply) => {
  const session = store.getPlanningSessionById(request.params.sessionId);
  if (!session) return reply.code(404).send({ error: "The planning session was not found." });
  const job = planningGenerationJobs.get(request.params.sessionId);
  const generationKey = session.confirmedProposalVersion ? blueprintGenerationKey(session.id, session.confirmedProposalVersion) : undefined;
  const snapshot = generationKey ? store.getBlueprintGeneration(generationKey) : undefined;
  return {
    sessionStatus: session.status,
    generation: job ? publicGenerationJob(job) : snapshot ? publicPersistedGeneration(snapshot) : null,
    snapshot: snapshot ?? null,
    events: generationKey ? store.getBlueprintGenerationEvents(generationKey) : []
  };
});
server.get<{ Params: { sessionId: string }; Querystring: { after?: string } }>("/api/planning-sessions/:sessionId/generation/events", async (request, reply) => {
  const session = store.getPlanningSessionById(request.params.sessionId);
  if (!session?.confirmedProposalVersion) return reply.code(404).send({ error: "The Blueprint Generation was not found." });
  const generationKey = blueprintGenerationKey(session.id, session.confirmedProposalVersion);
  if (!store.getBlueprintGeneration(generationKey)) return reply.code(404).send({ error: "The Blueprint Generation was not found." });
  let sequence = Number.isInteger(Number(request.query.after)) && Number(request.query.after) >= 0 ? Number(request.query.after) : 0;
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  const push = () => {
    for (const event of store.getBlueprintGenerationEvents(generationKey, sequence)) {
      sequence = event.sequence;
      reply.raw.write(`id: ${event.sequence}\nevent: generation\ndata: ${JSON.stringify(event)}\n\n`);
    }
  };
  push();
  const heartbeat = setInterval(() => { push(); reply.raw.write(": keep-alive\n\n"); }, 2_000);
  request.raw.once("close", () => clearInterval(heartbeat));
});
server.post<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId/generation/cancel", async (request, reply) => {
  const session = store.getPlanningSessionById(request.params.sessionId);
  if (!session) return reply.code(404).send({ error: "The planning session was not found." });
  const job = planningGenerationJobs.get(request.params.sessionId);
  if (job?.status === "running") {
    updateGenerationJob(job, { stage: "cancelled", status: "cancelled", failureCode: "cancelled", message: "Plan generation was cancelled. Saved research remains available." });
    job.controller.abort();
  } else if (session.confirmedProposalVersion) {
    markPersistedGenerationCancelled(blueprintGenerationKey(session.id, session.confirmedProposalVersion), "Plan generation was cancelled. Saved research remains available.");
  }
  if (session.status === "generating" || session.status === "proposal_confirmed") store.updatePlanningSessionStatus(session.id, "proposal_ready");
  return { sessionStatus: store.getPlanningSessionById(session.id)?.status, generation: job ? publicGenerationJob(job) : null };
});
server.delete<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId", async (request, reply) => {
  try {
    const job = planningGenerationJobs.get(request.params.sessionId);
    if (job?.status === "running") {
      updateGenerationJob(job, { stage: "cancelled", status: "cancelled", failureCode: "cancelled", message: "Plan generation was cancelled. Saved research remains available." });
      job.controller.abort();
    }
    store.abandonPlanningSession(request.params.sessionId);
    return store.getWorkspace();
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : "The planning session could not be abandoned." });
  }
});
server.delete("/api/plans", async () => store.resetPlansToEmptyState());
server.delete<{ Params: { planId: string } }>("/api/plans/:planId", async (request, reply) => {
  try {
    return store.discardCurrentDraft(request.params.planId);
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : "The current draft Plan could not be discarded." });
  }
});
server.get("/api/plans/history", async () => store.listHistoricalPlans());
server.delete("/api/plans/history", async () => ({ deleted: store.clearHistoricalPlans() }));
server.delete<{ Params: { planId: string } }>("/api/plans/:planId/history", async (request, reply) => {
  try {
    if (!store.deleteHistoricalPlan(request.params.planId)) return reply.code(404).send({ error: "The historical Plan was not found." });
    return { deleted: true };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The historical Plan could not be deleted." });
  }
});
server.get<{ Params: { planId: string } }>("/api/plans/:planId/bookings", async (request, reply) => {
  const plan = store.getWorkspace().activePlan.id === request.params.planId ? store.getWorkspace().activePlan : undefined;
  if (!plan && !store.listHistoricalPlans().some((item) => item.id === request.params.planId)) return reply.code(404).send({ error: "The Plan was not found." });
  return { bookings: store.listTravelBookingsForPlan(request.params.planId) };
});
server.post<{ Params: { planId: string }; Body: BookingImportInput }>("/api/plans/:planId/bookings/import-preview", async (request, reply) => {
  const workspace = store.getWorkspace();
  if (workspace.activePlan.id !== request.params.planId && workspace.executionPlan?.id !== request.params.planId) return reply.code(404).send({ error: "The Plan was not found." });
  try {
    return previewBookingImport(request.body, { planId: request.params.planId });
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be previewed." });
  }
});
server.post<{ Params: { planId: string }; Body: { booking?: TravelBooking; expectedVersion?: number; sourceContent?: string } }>("/api/plans/:planId/bookings/import-confirm", async (request, reply) => {
  const workspace = store.getWorkspace();
  const plan = workspace.activePlan.id === request.params.planId ? workspace.activePlan : workspace.executionPlan?.id === request.params.planId ? workspace.executionPlan : undefined;
  if (!plan) return reply.code(404).send({ error: "The Plan was not found." });
  if (request.body.expectedVersion !== undefined && request.body.expectedVersion !== plan.version) return reply.code(409).send({ error: "The Plan changed while the booking was being reviewed. Reopen the import preview." });
  try {
    const booking = normalizeAcceptedBooking(request.body.booking, { planId: plan.id, planVersionCreated: plan.version });
    store.saveTravelBooking(booking);
    saveProtectedBookingAttachment(booking, request.body.sourceContent);
    const requiresBlueprintRevision = plan.status === "active" && booking.segments.some((segment) => segment.constraintStrength === "hard");
    const workspace = store.applyTravelBookingToCurrentPlan(booking, plan.version);
    return { workspace, booking, requiresBlueprintRevision };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be saved." });
  }
});
server.post<{ Params: { planId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/replacement/undo", async (request, reply) => {
  if (typeof request.body?.expectedVersion !== "number") return reply.code(400).send({ error: "Undo needs the expected active Plan version." });
  try {
    return store.undoLatestPlanReplacement({ expectedPlanId: request.params.planId, expectedVersion: request.body.expectedVersion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The latest Plan replacement could not be undone.";
    return reply.code(/changed before|no latest|no longer available/i.test(message) ? 409 : 400).send({ error: message });
  }
});
server.patch<{ Params: { planId: string; taskId: string }; Body: { checked?: boolean } }>("/api/plans/:planId/tasks/:taskId/check", async (request, reply) => {
  if (typeof request.body?.checked !== "boolean") return reply.code(400).send({ error: "A checklist update requires checked=true or checked=false." });
  try {
    return store.setPlanTaskChecked(request.params.planId, request.params.taskId, request.body.checked);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The checklist item could not be updated." });
  }
});
server.post<{ Params: { planId: string }; Body: { kind?: string; taskId?: string; direction?: string; expectedVersion?: number } }>("/api/plans/:planId/changes", async (request, reply) => {
  if (request.body?.kind !== "reorder_task" || typeof request.body.taskId !== "string" || (request.body.direction !== "up" && request.body.direction !== "down") || typeof request.body.expectedVersion !== "number") {
    return reply.code(400).send({ error: "A Plan reorder needs a task, direction, and expected Plan version." });
  }
  try {
    return store.reorderPlanTask({ planId: request.params.planId, taskId: request.body.taskId, direction: request.body.direction, expectedVersion: request.body.expectedVersion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Plan change could not be applied.";
    return reply.code(/changed before/i.test(message) ? 409 : 400).send({ error: message });
  }
});
server.post<{ Params: { planId: string; changeId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/changes/:changeId/undo", async (request, reply) => {
  if (typeof request.body?.expectedVersion !== "number") return reply.code(400).send({ error: "Undo needs the expected Plan version." });
  try {
    return store.undoPlanChange({ planId: request.params.planId, changeId: request.params.changeId, expectedVersion: request.body.expectedVersion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Plan change could not be undone.";
    return reply.code(/changed before|latest Plan change/i.test(message) ? 409 : 400).send({ error: message });
  }
});
server.post<{ Params: { planId: string }; Body: { message?: string; expectedVersion?: number } }>("/api/plans/:planId/change-impact", async (request, reply) => {
  if (typeof request.body?.message !== "string" || typeof request.body.expectedVersion !== "number") return reply.code(400).send({ error: "A change-impact preview needs a message and expected Plan version." });
  const plan = store.getWorkspace().activePlan;
  if (plan.id !== request.params.planId || plan.version !== request.body.expectedVersion) return reply.code(409).send({ error: "The Plan changed before its impact could be reviewed." });
  try { return previewPlanChange(plan, request.body.message); }
  catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "The Plan change could not be previewed." }); }
});
server.get("/api/runs", async () => store.listRecentAgentRuns());
server.get("/api/runs/task-reminders", async () => store.listRecentTaskReminderRuns());
server.get("/api/runs/plan-compilations", async () => store.listRecentPlanCompilationRuns());
server.get("/api/runs/country-pack-skills", async () => store.listRecentCountryPackSkillRuns());
server.get("/api/maintenance", async () => store.getDatabaseMaintenanceStatus());
server.post("/api/backups", async (_request, reply) => {
  if (creatingBackup) return reply.code(409).send({ error: "A local backup is already being created." });
  try {
    creatingBackup = true;
    return store.createBackup();
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : "The local backup could not be created." });
  } finally {
    creatingBackup = false;
  }
});

server.get("/api/policy-applicability", async () => {
  const workspace = store.getWorkspace();
  const resolution = await resolvePlanCountryPack(workspace.activePlan.id);
  if (resolution.status !== "resolved") return { status: "needs_input", knownInformation: [], missingInformation: [{ field: "plan.country", reason: resolution.message }], evidence: [], nextAction: resolution.message, warning: "No Country Pack was selected." };
  if (resolution.countryPackId === "japan") {
    const plan = workspace.activePlan;
    const linked = new Map(plan.sources.flatMap((item) => item.sourceSnapshotId && item.contentHash ? [[item.sourceSnapshotId, item.contentHash] as const] : []));
    const dates = plan.dates.match(/\d{4}-\d{2}-\d{2}/g);
    const purpose = plan.knownInformation.map((item) => /^purpose\s*:\s*(.+)$/i.exec(item)?.[1]?.trim()).find(Boolean);
    const passport = plan.knownInformation.map((item) => /^passport confirmed\s*:\s*(.+)$/i.exec(item)?.[1]?.trim()).find(Boolean);
    const result = runJapanPolicyApplicabilitySkill({
      nationality: workspace.profile.nationality,
      ...(purpose ? { travelPurpose: purpose } : {}),
      ...(dates?.[0] && dates[1] ? { departureDate: dates[0], arrivalDate: dates[0], stayDays: Math.max(1, Math.round((Date.parse(`${dates[1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000)) } : {}),
      ...(passport ? { passportConfirmed: /^(?:yes|true|confirmed)$/i.test(passport) } : {}),
      evidence: workspace.sourceSnapshots.filter((item) => item.sourceId.startsWith("jp-") && linked.get(item.id) === item.contentHash).map((item) => ({ id: item.id, sourceId: item.sourceId, authority: item.authority, titleOriginal: item.titleOriginal, url: item.url, retrievedAt: item.retrievedAt, contentHash: item.contentHash })),
      now: new Date().toISOString()
    });
    return { status: result.preparationState, knownInformation: result.facts, missingInformation: result.needsInput, evidence: result.sources, nextAction: result.nextAction, warning: result.warnings.join(" "), skill: result.skill };
  }
  const result = await chinaSkillRegistry.invoke("policy-applicability", {
    ...(workspace.profile.nationality ? { nationality: workspace.profile.nationality } : {}),
    immigrationStatus: workspace.profile.immigrationStatus,
    location: workspace.activePlan.location,
    dates: workspace.activePlan.dates,
    evidence: workspace.sourceSnapshots.map((snapshot) => ({ id: snapshot.id, sourceId: snapshot.sourceId, authority: snapshot.authority, titleOriginal: snapshot.titleOriginal, url: snapshot.url, retrievedAt: snapshot.retrievedAt, contentHash: snapshot.contentHash })),
    now: new Date().toISOString()
  }) as PolicyApplicabilitySkillResult;
  return {
    status: result.status === "success" ? "ready_for_review" : result.status === "blocked" && result.reasonCode === "needs_evidence" ? "needs_evidence" : result.status,
    knownInformation: result.facts,
    missingInformation: result.needsInput,
    evidence: result.sources,
    nextAction: result.nextAction,
    warning: result.warnings.join(" "),
    skill: result.skill
  };
});

server.post<{ Params: { planId: string; snapshotId: string } }>("/api/plans/:planId/sources/:snapshotId", async (request, reply) => {
  try {
    return store.linkSourceSnapshotToPlan(request.params.planId, request.params.snapshotId);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The official evidence could not be linked to this Plan." });
  }
});

server.post<{ Params: { planId: string } }>("/api/plans/:planId/china/prepare", async (request, reply) => {
  const resolution = await resolvePlanCountryPack(request.params.planId);
  if (resolution.status !== "resolved" || resolution.countryPackId !== "china") return reply.code(409).send({ status: "blocked", reasonCode: "country_pack_mismatch", message: "The normalized destination country does not select the China Country Pack." });
  const result = await chinaPlanWorkflow.prepareCurrentPlan({ planId: request.params.planId });
  if (result.status === "blocked") {
    const statusCode = result.reasonCode === "critical_source_unavailable" || result.reasonCode === "fact_collection_failed" ? 503 : result.reasonCode === "plan_not_draft" || result.reasonCode === "plan_changed" ? 409 : 422;
    return reply.code(statusCode).send(presentChinaPlanPreparation(result));
  }
  return presentChinaPlanPreparation(result);
});

server.post<{ Params: { planId: string } }>("/api/plans/:planId/japan/prepare", async (request, reply) => {
  const resolution = await resolvePlanCountryPack(request.params.planId);
  if (resolution.status !== "resolved" || resolution.countryPackId !== "japan") return reply.code(409).send({ status: "blocked", reasonCode: "country_pack_mismatch", message: "The normalized destination country does not select the Japan Country Pack." });
  const result = await prepareJapanPlan(request.params.planId);
  return reply.code(result.status === "saved" ? 200 : result.reasonCode === "critical_source_unavailable" || result.reasonCode === "fact_collection_failed" ? 503 : result.reasonCode === "plan_changed" || result.reasonCode === "plan_not_draft" ? 409 : 422).send(result);
});

server.post<{ Params: { planId: string } }>("/api/plans/:planId/country-pack/prepare", async (request, reply) => {
  const resolution = await resolvePlanCountryPack(request.params.planId);
  if (resolution.status !== "resolved") return reply.code(422).send({ ...resolution, preparationStatus: "blocked" });
  if (resolution.countryPackId === "china") {
    const result = await chinaPlanWorkflow.prepareCurrentPlan({ planId: request.params.planId });
    return reply.code(result.status === "saved" ? 200 : 422).send(presentChinaPlanPreparation(result));
  }
  const result = await prepareJapanPlan(request.params.planId);
  return reply.code(result.status === "saved" ? 200 : 422).send(result);
});

server.post<{ Params: { planId: string } }>("/api/plans/:planId/confirm", async (request, reply) => {
  try {
    const current = store.getWorkspace().activePlan;
    // Confirmation is intentionally not gated by unanswered assumptions. The
    // Plan keeps those facts visible as pending confirmation items, while the
    // user remains free to stop refining and activate the usable draft.
    const confirmed = store.confirmPlan(request.params.planId);
    startActivePlanMonitoring();
    return confirmed;
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

  const resolved = await maps.geocodeAddress({ address });
  if (resolved.status !== "available") return reply.code(connectorResponseStatus(resolved.status)).send(resolved);
  if (!resolved.data) return reply.code(404).send({ error: "Google Maps could not resolve that accommodation address." });

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

server.post<{ Params: { planId: string }; Body: { expectedVersion?: number; name?: string; address?: string; status?: "candidate" | "confirmed" } }>("/api/plans/:planId/accommodation/linked", async (request, reply) => {
  const expectedVersion = Number(request.body?.expectedVersion);
  const name = request.body?.name?.trim() ?? "";
  const address = request.body?.address?.trim() ?? "";
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0 || !name || !address) return reply.code(400).send({ error: "Saving accommodation needs the current Plan version, name, and address." });
  const current = store.getWorkspace().activePlan;
  if (current.id !== request.params.planId || current.version !== expectedVersion) return reply.code(409).send({ error: "The Plan changed before this accommodation update started." });
  if (current.status !== "draft") return reply.code(409).send({ error: "An active Plan must use a replacement draft before changing accommodation." });

  const resolved = await maps.geocodeAddress({ address });
  if (resolved.status !== "available") return reply.code(connectorResponseStatus(resolved.status)).send(resolved);
  if (!resolved.data) return reply.code(404).send({ error: "Google Maps could not resolve that accommodation address." });
  const departures = await prepareAccommodationDepartures({
    plan: current,
    accommodationName: name,
    accommodationAddress: resolved.data.formattedAddress,
    accommodationLocation: resolved.data.location,
    maps: {
      geocodeAddress: (input) => maps.geocodeAddress(input),
      drivingRoute: (input) => maps.drivingRoute(input),
      walkingRoute: (input) => maps.walkingRoute(input),
      transitRoute: (input) => maps.transitRoute(input)
    }
  });
  try {
    const workspace = store.saveDraftAccommodationLinkage({
      planId: request.params.planId,
      expectedVersion,
      accommodation: { status: request.body.status === "candidate" ? "candidate" : "confirmed", name, address: resolved.data.formattedAddress, location: resolved.data.location, source: "user" },
      departures
    });
    const verified = departures.filter((item) => item.departure.verification === "verified").length;
    return { workspace, impact: { affectedDays: departures.length, verifiedDays: verified, pendingDays: departures.length - verified } };
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : "Accommodation could not be linked to this Plan." });
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

server.get("/api/runtimes/codex", async () => codex.check());
server.get("/api/runtimes/claude-code", async () => claudeCode.check());
server.get("/api/runtimes", async () => Promise.all([codex.check(), claudeCode.check()]));
server.post<{ Params: { kind: string } }>("/api/runtimes/:kind/test", async (request, reply) => {
  if (request.params.kind !== "codex" && request.params.kind !== "claude-code") return reply.code(400).send({ error: "Unsupported runtime." });
  try {
    const runtime = selectedRuntimeAdapter(request.params.kind);
    const health = await runtime.check();
    if (!health.installed) throw new RuntimeAdapterError("not_installed", health.message ?? `${runtimeName(request.params.kind)} is not installed.`);
    if (!health.authenticated) throw new RuntimeAdapterError("not_authenticated", health.message ?? `${runtimeName(request.params.kind)} is not authenticated.`);
    return {
      ok: true,
      message: request.params.kind === "codex"
        ? "Codex is installed and authenticated. Blueprint generation will verify the Interactive Trip Planner Skill when a confirmed proposal starts."
        : "Claude Code is installed and authenticated. Blueprint generation currently requires Codex and will not fall back to the legacy Plan generator."
    };
  } catch (error) {
    return reply.code(error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated") ? 503 : 400).send({ error: error instanceof Error ? error.message : "Runtime test failed." });
  }
});

server.get("/api/setup-readiness", async () => {
  const workspace = store.getWorkspace();
  const configuration = localConfigurationSnapshot();
  const runtimeChecks = await Promise.all([codex.check(), claudeCode.check()]);
  return assessSetupReadiness({
    profileStatus: workspace.profile.status,
    selectedRuntime: workspace.runtime.selectedKind,
    runtimeChecks,
    googleConfigured: configuration.google.configured,
    telegramConfigured: configuration.telegram.configured,
    telegramPaired: store.getTelegramPairingStatus().state === "paired"
  });
});

server.put<{ Body: RuntimeSelectionUpdate }>("/api/runtime", async (request, reply) => {
  try {
    return store.updateRuntimeSelection(request.body);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "The Plan runtime could not be selected." });
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

  if (turn.mode === "new_plan") {
    generatingPlan = true;
    let backgroundQueued = false;
    try {
      const workspace = store.getWorkspace();
      if (workspace.profile.status !== "ready") return reply.code(409).send({ error: "Complete the required Profile basics before creating or revising a Plan." });
      const current = workspace.planningSession && workspace.planningSession.status !== "draft_ready" && workspace.planningSession.status !== "failed"
        ? workspace.planningSession
        : store.createPlanningSession("travel");
      const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
      const agentTurn = await runtime.continuePlanningConversation({
        message: turn.message,
        session: current,
        profile: { preferredLanguage: workspace.profile.preferredLanguage, nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus }
      });
      const result = applyAgentPlanningTurn(current, turn.message, agentTurn);
      store.savePlanningSession(result.session);
      if (result.session.status === "proposal_confirmed" && result.session.unresolved.length === 0) {
        const job = enqueuePlanningSessionGeneration(result.session, workspace);
        backgroundQueued = true;
        return reply.code(202).send({ reply: result.reply, workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(result.session.id), planningStatus: "generating", generated: false, accepted: true, generation: publicGenerationJob(job) });
      }
      const updated = store.getWorkspace();
      return {
        reply: result.reply,
        workspace: updated,
        planningSession: result.session,
        planningStatus: result.session.status,
        generated: false
      };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The planning session could not be updated." });
    } finally {
      if (!backgroundQueued) generatingPlan = false;
    }
  }

  generatingPlan = true;
  let runId: string | undefined;
  try {
    const workspace = store.getWorkspace();
    if (workspace.profile.status !== "ready") return reply.code(409).send({ error: "Complete the required Profile basics before creating or revising a Plan." });
    let changeImpact;
    if (turn.mode === "revise_plan") {
      if (turn.expectedPlanId !== workspace.activePlan.id || turn.expectedVersion !== workspace.activePlan.version) return reply.code(409).send({ error: "The Plan changed before this revision could start. Refresh the workspace and review the latest version." });
      if (workspace.activeBlueprint) return reply.code(409).send({
        error: "This Plan is backed by a Trip Blueprint. Assisted Replanning is not enabled yet, so Landi kept the Blueprint and current Plan unchanged. Start a new planning conversation for now."
      });
      changeImpact = previewPlanChange(workspace.activePlan, turn.message);
      if (changeImpact.requiresConfirmation && !turn.impactConfirmed) return reply.code(409).send({ error: "This high-impact Plan change needs explicit confirmation before replanning.", impactPreview: changeImpact });
    }
    runId = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "web" }).id;
    const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
    const draft = await runtime.generatePlanDraft({
      request: turn.message,
      ...(turn.mode === "revise_plan" ? {
        currentPlan: planDraftForRevision(workspace.activePlan),
        completedTasks: completedTasksForRevision(workspace.activePlan)
      } : {}),
      profile: {
        preferredLanguage: workspace.profile.preferredLanguage,
        nationality: workspace.profile.nationality,
        gender: workspace.profile.gender,
        immigrationStatus: workspace.profile.immigrationStatus
      }
    });
    assertWebAgentPlanUnchanged(workspace.activePlan, store.getWorkspace().activePlan);
    let updated = turn.mode === "revise_plan"
      ? store.reviseGeneratedPlan({ draft, runtime: workspace.runtime.selectedKind, expectedPlanId: workspace.activePlan.id, expectedVersion: workspace.activePlan.version, ...(changeImpact ? { changeImpact } : {}) })
      : store.createGeneratedPlan(draft, workspace.runtime.selectedKind);
    const evidence = await prepareGeneratedPlanEvidence(updated.activePlan.id);
    updated = evidence.workspace;
    store.finishPlanGenerationRun({ runId, status: "succeeded", outputPlanId: updated.activePlan.id });
    const refinement = planRefinementState(updated.activePlan);
    return {
      reply: formatWebAgentPlanReply({ runtimeName: runtimeName(workspace.runtime.selectedKind), mode: turn.mode, plan: updated.activePlan, ...(refinement.followUpQuestion ? { followUpQuestion: refinement.followUpQuestion } : {}) }),
      workspace: updated,
      readyForReview: refinement.readyForReview,
      evidenceStatus: evidence.status,
      ...(refinement.followUpQuestion ? { followUpQuestion: refinement.followUpQuestion } : {})
    };
  } catch (error) {
    if (runId) store.finishPlanGenerationRun({ runId, status: "failed", failureCode: planGenerationFailureCode(error) });
    return reply.code(error instanceof RuntimeAdapterError && error.code === "timed_out" ? 504 : error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated") ? 503 : 400).send({
      error: error instanceof Error ? error.message : "The Agent could not respond right now."
    });
  } finally {
    generatingPlan = false;
  }
});

server.post<{ Params: { sessionId: string }; Body: { proposalVersion?: number } }>("/api/planning-sessions/:sessionId/confirm", async (request, reply) => {
  if (!blueprintGenerationEnabled) return reply.code(503).send({ error: "Blueprint generation is disabled for this local instance. Landi will not fall back to the legacy Plan generator." });
  const existingJob = planningGenerationJobs.get(request.params.sessionId);
  if (existingJob?.status === "running") {
    return reply.code(202).send({
      reply: "This confirmed proposal is already being generated.",
      workspace: store.getWorkspace(),
      planningSession: store.getPlanningSessionById(request.params.sessionId),
      planningStatus: "generating",
      generated: false,
      accepted: true,
      reused: true,
      generation: publicGenerationJob(existingJob)
    });
  }
  if (generatingPlan) return reply.code(409).send({ error: "Another Plan generation is already running." });
  let backgroundQueued = false;
  try {
    const proposalVersion = request.body?.proposalVersion;
    if (typeof proposalVersion !== "number" || !Number.isInteger(proposalVersion)) return reply.code(400).send({ error: "Confirm the latest planning proposal version." });
    const existing = store.getPlanningSessionById(request.params.sessionId);
    if (!existing) return reply.code(404).send({ error: "The planning session was not found." });
    const current = store.getWorkspace();
    const reuse = planningGenerationReuse(existing, current.activePlan.id);
    if (reuse === "conflict") return reply.code(409).send({ error: "This proposal was already generated, but a newer Plan is now current." });
    if (reuse === "reuse") {
      return { reply: "A complete plan already exists for this proposal, so no duplicate was created.", workspace: current, generated: true, reused: true };
    }
    const workspace = current;
    if (workspace.profile.status !== "ready") return reply.code(409).send({ error: "Complete the required Profile basics before creating or revising a Plan." });
    const confirmed = store.confirmPlanningSession(request.params.sessionId, proposalVersion);
    let prepared = prepareConfirmedPlanningSession(confirmed);
    if (prepared.session.unresolved.length) {
      generatingPlan = true;
      try {
        const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
        const agentTurn = await runtime.continuePlanningConversation({
          message: "The user has just confirmed the plan direction. Continue naturally and ask only for the single most important missing detail. Reply in English only.",
          session: prepared.session,
          profile: { preferredLanguage: workspace.profile.preferredLanguage, nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus }
        });
        const messages = [...prepared.session.messages];
        const last = messages.at(-1);
        if (last?.role === "assistant") messages[messages.length - 1] = { ...last, text: agentTurn.reply };
        prepared = { reply: agentTurn.reply, session: { ...prepared.session, messages } };
      } catch {
        // Keep the deterministic question only as an availability fallback.
      }
    }
    store.savePlanningSession(prepared.session);
    if (prepared.session.unresolved.length) {
      return {
        reply: prepared.reply,
        workspace: store.getWorkspace(),
        planningSession: prepared.session,
        planningStatus: prepared.session.status,
        proposal: prepared.session.proposal,
        generated: false
      };
    }
    generatingPlan = true;
    const job = enqueuePlanningSessionGeneration(prepared.session, workspace);
    backgroundQueued = true;
    return reply.code(202).send({
      reply: "Your details are confirmed. Landi is generating the complete plan now.",
      workspace: store.getWorkspace(),
      planningSession: store.getPlanningSessionById(prepared.session.id),
      planningStatus: "generating",
      generated: false,
      accepted: true,
      generation: publicGenerationJob(job)
    });
  } catch (error) {
    try {
      const session = store.getPlanningSessionById(request.params.sessionId);
      if (session?.status === "generating" || session?.status === "proposal_confirmed") store.updatePlanningSessionStatus(request.params.sessionId, "proposal_ready");
    } catch { /* Preserve the original generation error. */ }
    return reply.code(error instanceof RuntimeAdapterError && error.code === "timed_out" ? 504 : error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated") ? 503 : 400).send({
      error: error instanceof Error ? error.message : "The selected runtime could not generate a Plan draft."
    });
  } finally {
    if (!backgroundQueued) generatingPlan = false;
  }
});

async function prepareGeneratedPlanEvidence(planId: string): Promise<{ workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>; status: "verified" | "partial" }> {
  let sourcesVerified = false;
  try {
    const resolution = await resolvePlanCountryPack(planId);
    if (resolution.status === "resolved") {
      const result = resolution.countryPackId === "japan"
        ? await japanSourcePreparation.prepareCurrentPlan({ planId })
        : await chinaSourcePreparation.prepareCurrentPlan({ planId });
      sourcesVerified = result.status === "ready";
    }
  } catch { /* Route enrichment can still proceed when destination evidence is partial. */ }
  let routesVerified = true;
  try {
    const workspace = store.getWorkspace();
    const timeZone = await resolvePlanArrivalTimeZone(workspace.activePlan, { geocodeAddress: (input) => maps.geocodeAddress(input), weather: (input) => googleWeather.weather(input) });
    if (timeZone) store.saveGeneratedPlanArrivalTimeZone({ planId, expectedVersion: workspace.activePlan.version, timeZone });
  } catch { /* An unresolved timezone safely leaves arrival reminders disabled. */ }
  try {
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan;
    const eligibleRoutes = plan.id === planId && plan.presentation?.kind === "itinerary"
      ? plan.presentation.routeSegments.filter((segment) => segment.mode === "driving" || segment.mode === "walking" || segment.mode === "transit")
      : [];
    if (eligibleRoutes.length && maps.configurationStatus().status === "available") {
      const routeResult = await refreshGeneratedPlanRoutes(plan, {
        geocodeAddress: (input) => maps.geocodeAddress(input),
        drivingRoute: (input) => maps.drivingRoute(input),
        walkingRoute: (input) => maps.walkingRoute(input),
        transitRoute: (input) => maps.transitRoute(input)
      });
      const savedRoutes = routeResult.refreshed.length
        ? store.saveGeneratedPlanRouteRefresh({ planId, expectedVersion: plan.version, provider: "google_maps", routes: routeResult.refreshed })
        : undefined;
      routesVerified = routeResult.failedSegmentIds.length === 0
        && routeResult.refreshed.length === eligibleRoutes.length
        && !savedRoutes?.scheduleConflictDayIds.length;
    } else if (eligibleRoutes.length) {
      routesVerified = false;
    }
  } catch {
    routesVerified = false;
  }
  return { workspace: store.getWorkspace(), status: sourcesVerified && routesVerified ? "verified" : "partial" };
}

async function resolvePlanCountryPack(planId: string) {
  const plan = store.getWorkspace().activePlan;
  if (plan.id !== planId) return { status: "needs_confirmation" as const, reasonCode: "missing_country" as const, message: "The requested Plan is not the current Plan." };
  const destination = await maps.geocodeAddress({ address: plan.location });
  if (destination.status !== "available" || !destination.data?.country) return resolveCountryPack(undefined);
  return resolveCountryPack(destination.data.country);
}

async function prepareJapanPlan(planId: string) {
  const sources = await japanSourcePreparation.prepareCurrentPlan({ planId });
  if (sources.status === "blocked") return { status: "blocked" as const, stage: "source_preparation" as const, reasonCode: sources.reasonCode, message: sources.message, sources: sources.sources };
  const compilation = await japanCompilation.compileCurrentPlan();
  if (compilation.status === "blocked") return { status: "blocked" as const, stage: "compilation" as const, reasonCode: compilation.reasonCode, message: compilation.message, sources: sources.sources };
  return { status: "saved" as const, message: "The Japan Pack prepared a new complete draft. Review every Task, Reminder, limitation, and source before confirming it.", workspace: compilation.workspace, taskCount: compilation.taskCount, reminderCount: compilation.reminderCount, sources: sources.sources };
}

server.put<{ Body: ProfileUpdate }>("/api/profile", async (request, reply) => {
  try {
    return store.updateProfile(request.body);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "The Profile could not be saved."
    });
  }
});

type LocalConfigurationUpdate = {
  googleMapsApiKey?: string;
  uberClientId?: string;
  telegramBotToken?: string;
  whatsappAccessToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  whatsappAppSecret?: string;
  whatsappVerifyToken?: string;
  whatsappAllowedUserNumber?: string;
  whatsappReminderTemplateName?: string;
  whatsappGraphApiVersion?: string;
};

function localConfigurationSnapshot() {
  const whatsappStatus = whatsapp.configurationStatus();
  return {
    google: { configured: Boolean(process.env.GOOGLE_MAPS_API_KEY) },
    uber: { configured: Boolean(process.env.UBER_CLIENT_ID) },
    amap: { configured: false },
    qweather: { configured: false, host: "" },
    telegram: { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN) },
    whatsapp: {
      configured: whatsappStatus.status !== "not_configured",
      state: whatsappStatus.data?.state ?? "not_configured",
      paired: Boolean(normalizeWhatsAppUserNumber(process.env.WHATSAPP_ALLOWED_USER_NUMBER))
    }
  };
}

async function geocodeWeatherAddress(input: { address: string }): Promise<ConnectorResult<GeocodedPlaceFact>> {
  return maps.geocodeAddress(input);
}

function saveLocalConfiguration(update: LocalConfigurationUpdate): void {
  const values: Record<string, string> = {};
  if (update.googleMapsApiKey?.trim()) values.GOOGLE_MAPS_API_KEY = update.googleMapsApiKey.trim();
  if (update.uberClientId?.trim()) values.UBER_CLIENT_ID = update.uberClientId.trim();
  if (update.telegramBotToken?.trim()) values.TELEGRAM_BOT_TOKEN = update.telegramBotToken.trim();
  if (update.whatsappAccessToken?.trim()) values.WHATSAPP_ACCESS_TOKEN = update.whatsappAccessToken.trim();
  if (update.whatsappPhoneNumberId?.trim()) values.WHATSAPP_PHONE_NUMBER_ID = update.whatsappPhoneNumberId.trim();
  if (update.whatsappBusinessAccountId?.trim()) values.WHATSAPP_BUSINESS_ACCOUNT_ID = update.whatsappBusinessAccountId.trim();
  if (update.whatsappAppSecret?.trim()) values.WHATSAPP_APP_SECRET = update.whatsappAppSecret.trim();
  if (update.whatsappVerifyToken?.trim()) values.WHATSAPP_VERIFY_TOKEN = update.whatsappVerifyToken.trim();
  if (update.whatsappAllowedUserNumber?.trim()) {
    const normalized = normalizeWhatsAppUserNumber(update.whatsappAllowedUserNumber);
    if (!normalized) throw new Error("WhatsApp user number must include a valid international country code.");
    values.WHATSAPP_ALLOWED_USER_NUMBER = normalized;
  }
  if (update.whatsappReminderTemplateName?.trim()) values.WHATSAPP_REMINDER_TEMPLATE_NAME = update.whatsappReminderTemplateName.trim();
  if (update.whatsappGraphApiVersion?.trim()) values.WHATSAPP_GRAPH_API_VERSION = update.whatsappGraphApiVersion.trim();
  if (!Object.keys(values).length) return;

  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value.replaceAll(/\r?\n/g, "")}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
    process.env[key] = value;
  }
  writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });
  maps = new GoogleMapsConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
  googleWeather = new GoogleWeatherConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
  telegram = new TelegramConnector({ botToken: process.env.TELEGRAM_BOT_TOKEN });
  whatsapp = createWhatsAppConnectorFromEnvironment();
}

function createWhatsAppConnectorFromEnvironment(): WhatsAppConnector {
  return new WhatsAppConnector({
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    reminderTemplateName: process.env.WHATSAPP_REMINDER_TEMPLATE_NAME,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION
  });
}

server.get("/api/configuration", async () => localConfigurationSnapshot());

server.put<{ Body: LocalConfigurationUpdate }>("/api/configuration", async (request, reply) => {
  try {
    saveLocalConfiguration(request.body ?? {});
    return localConfigurationSnapshot();
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Local configuration could not be saved." });
  }
});

server.get("/api/connectors/google", async () => ({ maps: maps.configurationStatus(), weather: googleWeather.configurationStatus() }));
server.get("/api/connectors/uber", async () => ({ status: "available", provider: "uber", observedAt: new Date().toISOString(), configured: Boolean(process.env.UBER_CLIENT_ID) }));
server.get("/api/connectors/amap", async () => ({ status: "unsupported", provider: "amap", observedAt: new Date().toISOString(), failure: { code: "disabled", message: "Amap is paused; Landi uses Google Maps Platform.", retryable: false } }));
server.get("/api/connectors/qweather", async () => ({ status: "unsupported", provider: "qweather", observedAt: new Date().toISOString(), failure: { code: "disabled", message: "QWeather is paused; Landi uses Google Weather.", retryable: false } }));

server.get<{ Querystring: { topic?: string } }>("/api/official-sources", async (request, reply) => {
  const current = store.getWorkspace().activePlan;
  const resolution = await resolvePlanCountryPack(current.id);
  if (resolution.status !== "resolved") return reply.code(422).send({ ...resolution, data: [] });
  return (resolution.countryPackId === "japan" ? japanOfficialSources : officialSources).discover(request.query.topic);
});

server.post<{ Params: { sourceId: string }; Body: { url?: string } }>("/api/official-sources/:sourceId/refresh", async (request, reply) => {
  const current = store.getWorkspace().activePlan;
  const resolution = await resolvePlanCountryPack(current.id);
  if (resolution.status !== "resolved") return reply.code(422).send(resolution);
  const service = resolution.countryPackId === "japan" ? japanOfficialSources : officialSources;
  const result = await service.refresh({ sourceId: request.params.sourceId, url: request.body?.url });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: { location?: string; coordinates?: string; language?: string } }>("/api/weather", async (request, reply) => {
  const requestedLocation = request.query.location?.trim() ?? "";
  const requestedCoordinates = request.query.coordinates?.trim() ?? "";
  if (!requestedLocation && !requestedCoordinates) return reply.code(400).send({ error: "A weather check needs a city, region, or coordinates." });
  const place = requestedCoordinates ? undefined : await geocodeWeatherAddress({ address: requestedLocation });
  if (place && place.status !== "available") return reply.code(connectorResponseStatus(place.status)).send(place);
  if (place && !place.data) return reply.code(404).send({ error: "Google Maps could not resolve that city or region." });
  const coordinates = requestedCoordinates || place?.data?.location;
  if (!coordinates || !validLongitudeLatitude(coordinates)) return reply.code(400).send({ error: "A weather check needs valid longitude,latitude coordinates." });
  const result = await fetchUserWeather({
    coordinates,
    locationName: place?.data?.formattedAddress ?? requestedLocation,
    adminArea: place?.data ? place.data.district || place.data.city || place.data.province : requestedLocation,
    country: "",
    language: "en",
    dependencies: { weather: (input) => googleWeather.weather(input) }
  });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get("/api/connectors/telegram", async () => telegram.configurationStatus());

server.get("/api/connectors/whatsapp", async () => whatsapp.configurationStatus());

server.post("/api/connectors/whatsapp/verify", async (_request, reply) => {
  const result = await whatsapp.verifyPhoneNumber();
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: Record<string, string | undefined> }>("/api/connectors/whatsapp/webhook", async (request, reply) => {
  const result = whatsapp.verifyWebhookChallenge({ mode: request.query["hub.mode"], verifyToken: request.query["hub.verify_token"], challenge: request.query["hub.challenge"] });
  if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
  return reply.type("text/plain; charset=utf-8").send(result.data);
});

await server.register(async (whatsappWebhookServer) => {
  whatsappWebhookServer.removeContentTypeParser("application/json");
  whatsappWebhookServer.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  whatsappWebhookServer.post<{ Body: Buffer }>("/api/connectors/whatsapp/webhook", async (request, reply) => {
    const signatureHeader = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const result = whatsapp.receiveWebhook({ rawBody: request.body, signature });
    if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
    try {
      await processWhatsAppWebhook(result.data.messages);
    } catch (error) {
      server.log.error({ error }, "WhatsApp webhook processing failed");
    }
    return reply.code(200).send({ received: true });
  });
});

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
    const receipt = await telegram.sendMessage({ chatId: startUpdate.chatId, text: "Landi is connected to this Telegram account. You will control future reminders and actions from your Plan. Send /profile whenever you want to complete or change your basic long-term settings." });
    return { ...paired, confirmationMessageSent: receipt.status === "available" };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Telegram could not be paired." });
  }
});

server.get<{ Querystring: { query?: string; region?: string } }>("/api/maps/places", async (request, reply) => {
  const result = await maps.searchPlaces({ query: request.query.query ?? "", region: request.query.region });
  return reply.code(result.status === "available" ? 200 : result.status === "not_configured" ? 503 : 400).send(result);
});

server.get<{ Querystring: { location?: string } }>("/api/maps/nearby/restaurants", async (request, reply) => {
  const result = await maps.nearbyRestaurants({ location: request.query.location ?? "" });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: { location?: string; name?: string } }>("/api/maps/nearby/accommodation", async (request, reply) => {
  const result = await maps.nearbyAccommodation({ location: request.query.location ?? "" });
  if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
  const skill = runHousingAreaRecommendationSkill({ ...(request.query.name ? { centreName: request.query.name } : {}), candidates: result.data, observedAt: result.observedAt, provider: "google_maps" });
  return reply.send({ ...result, skill });
});

server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/maps/routes/driving", async (request, reply) => {
  const result = await maps.drivingRoute({
    origin: request.query.origin ?? "",
    destination: request.query.destination ?? "",
    originId: request.query.originId,
    destinationId: request.query.destinationId
  });
  return reply.code(result.status === "available" ? 200 : result.status === "not_configured" ? 503 : 400).send(result);
});

server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/maps/routes/walking", async (request, reply) => {
  const result = await maps.walkingRoute({
    origin: request.query.origin ?? "",
    destination: request.query.destination ?? "",
    originId: request.query.originId,
    destinationId: request.query.destinationId
  });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.get<{ Querystring: { origin?: string; destination?: string; originCityCode?: string; destinationCityCode?: string } }>("/api/maps/routes/transit", async (request, reply) => {
  const result = await maps.transitRoute({
    origin: request.query.origin ?? "",
    destination: request.query.destination ?? "",
    originCityCode: request.query.originCityCode,
    destinationCityCode: request.query.destinationCityCode
  });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

server.post<{ Params: { planId: string; segmentId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/presentation/routes/:segmentId/refresh", async (request, reply) => {
  const expectedVersion = Number(request.body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) return reply.code(400).send({ error: "A route refresh needs the current Plan version." });
  const workspace = store.getWorkspace();
  if (workspace.activePlan.id !== request.params.planId || workspace.activePlan.version !== expectedVersion) return reply.code(409).send({ error: "The Plan changed before this route refresh started. Review the latest version and try again." });
  try {
    const facts = await refreshPlanRouteFacts(workspace.activePlan, request.params.segmentId, {
      geocodeAddress: (input) => maps.geocodeAddress(input),
      drivingRoute: (input) => maps.drivingRoute(input),
      walkingRoute: (input) => maps.walkingRoute(input),
      transitRoute: (input) => maps.transitRoute(input)
    });
    const { segmentId: _segmentId, geometry: _geometry, ...routeFacts } = facts;
    const updated = store.savePlanRouteRefresh({ planId: request.params.planId, segmentId: request.params.segmentId, expectedVersion, provider: "google_maps", ...routeFacts });
    return { workspace: updated, segment: updated.activePlan.presentation?.routeSegments.find((segment) => segment.id === request.params.segmentId) };
  } catch (error) {
    if (!(error instanceof PlanRouteRefreshError)) return reply.code(409).send({ error: error instanceof Error ? error.message : "The route refresh could not be saved." });
    const status = error.connectorStatus ? connectorResponseStatus(error.connectorStatus) : error.code === "unsupported_mode" ? 422 : error.code === "missing_segment" ? 404 : 400;
    return reply.code(status).send({ error: error.message, code: error.code });
  }
});

server.patch<{ Params: { planId: string }; Body: { expectedVersion?: number; assignments?: Record<string, string>; priorities?: Record<string, string>; orders?: Record<string, string[]> } }>("/api/plans/:planId/presentation", async (request, reply) => {
  const expectedVersion = Number(request.body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0 || !request.body?.assignments || !request.body?.priorities || !request.body?.orders) return reply.code(400).send({ error: "Itinerary edits need the current Plan version and complete map state." });
  try {
    const saved = store.savePlanPresentationEdits({ planId: request.params.planId, expectedVersion, assignments: request.body.assignments, priorities: request.body.priorities, orders: request.body.orders });
    const plan = saved.activePlan;
    const pendingRoutes = plan.presentation?.kind === "itinerary" ? plan.presentation.routeSegments.filter((segment) => segment.verification === "needs_verification" && ["driving", "walking", "transit"].includes(segment.mode)) : [];
    if (!pendingRoutes.length || maps.configurationStatus().status !== "available") return saved;
    try {
      const refreshed = await refreshGeneratedPlanRoutes(plan, {
        geocodeAddress: (input) => maps.geocodeAddress(input),
        drivingRoute: (input) => maps.drivingRoute(input),
        walkingRoute: (input) => maps.walkingRoute(input),
        transitRoute: (input) => maps.transitRoute(input)
      });
      if (!refreshed.refreshed.length) return saved;
      return store.saveGeneratedPlanRouteRefresh({ planId: plan.id, expectedVersion: plan.version, provider: "google_maps", routes: refreshed.refreshed }).workspace;
    } catch (error) {
      server.log.warn({ error, planId: plan.id }, "Edited itinerary routes could not be refreshed automatically");
      return saved;
    }
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : "The itinerary edits could not be saved." });
  }
});

// Temporary aliases for the separately migrated Web workspace. Remove after it uses /api/maps/*.
server.get<{ Querystring: { query?: string; region?: string } }>("/api/amap/places", async (request, reply) => {
  const result = await maps.searchPlaces({ query: request.query.query ?? "", region: request.query.region });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});
server.get<{ Querystring: { location?: string } }>("/api/amap/nearby/restaurants", async (request, reply) => {
  const result = await maps.nearbyRestaurants({ location: request.query.location ?? "" });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});
server.get<{ Querystring: { location?: string; name?: string } }>("/api/amap/nearby/accommodation", async (request, reply) => {
  const result = await maps.nearbyAccommodation({ location: request.query.location ?? "" });
  if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
  const skill = runHousingAreaRecommendationSkill({ ...(request.query.name ? { centreName: request.query.name } : {}), candidates: result.data, observedAt: result.observedAt, provider: "google_maps" });
  return reply.send({ ...result, skill });
});
server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/amap/routes/driving", async (request, reply) => {
  const result = await maps.drivingRoute({ origin: request.query.origin ?? "", destination: request.query.destination ?? "", originId: request.query.originId, destinationId: request.query.destinationId });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});
server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/amap/routes/walking", async (request, reply) => {
  const result = await maps.walkingRoute({ origin: request.query.origin ?? "", destination: request.query.destination ?? "", originId: request.query.originId, destinationId: request.query.destinationId });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});
server.get<{ Querystring: { origin?: string; destination?: string; originCityCode?: string; destinationCityCode?: string } }>("/api/amap/routes/transit", async (request, reply) => {
  const result = await maps.transitRoute({ origin: request.query.origin ?? "", destination: request.query.destination ?? "", originCityCode: request.query.originCityCode, destinationCityCode: request.query.destinationCityCode });
  return reply.code(connectorResponseStatus(result.status)).send(result);
});

function connectorResponseStatus(status: "available" | "degraded" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "unsupported"): number {
  if (status === "available") return 200;
  if (status === "not_configured" || status === "unavailable") return 503;
  if (status === "unauthorized") return 401;
  if (status === "rate_limited") return 429;
  return 400;
}

function validLongitudeLatitude(value: string): boolean {
  const [longitude, latitude, extra] = value.split(",");
  if (extra || longitude === undefined || latitude === undefined) return false;
  const lng = Number(longitude);
  const lat = Number(latitude);
  return Number.isFinite(lng) && lng >= -180 && lng <= 180 && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function pairingCodeFromStart(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^\/start(?:@[-_A-Za-z0-9]+)?\s+([A-Za-z0-9_-]{12,96})$/);
  return match?.[1];
}

async function processWhatsAppWebhook(messages: WhatsAppIncomingMessage[]): Promise<void> {
  const allowedUser = normalizeWhatsAppUserNumber(process.env.WHATSAPP_ALLOWED_USER_NUMBER);
  if (!allowedUser) {
    if (messages.length) server.log.warn("A signed WhatsApp message was ignored because this instance has no paired WhatsApp user number.");
    return;
  }
  for (const message of messages) {
    if (message.from !== allowedUser || !store.claimWhatsAppMessage(message.messageId)) continue;
    if (message.kind === "location") {
      await whatsapp.sendText({ to: message.from, serviceWindowExpiresAt: message.serviceWindowExpiresAt, text: "Location was received but not used or saved. WhatsApp location actions are not connected in this release; use Telegram for nearby food or arrival-route location sharing." });
      continue;
    }
    if (message.kind !== "text" || !message.text) {
      await whatsapp.sendText({ to: message.from, serviceWindowExpiresAt: message.serviceWindowExpiresAt, text: "This WhatsApp interaction is not available yet. Send a text request or /help. Plan confirmation and location buttons remain available in Web or Telegram." });
      continue;
    }
    const responses = await messagingCommandResponse(message.text, "whatsapp");
    if (responses) await sendWhatsAppCommandReplies(message.from, message.serviceWindowExpiresAt, responses);
  }
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
        const staleGo = parseTelegramMovementGoStaleCallback(update.callbackData);
        if (staleGo && update.callbackId) {
          const executionPlan = store.getExecutionPlan();
          if (!executionPlan || executionPlan.id !== staleGo.planId || executionPlan.version !== staleGo.version || executionPlan.status !== "active") {
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "That /go confirmation is out of date. Send /go again." });
          } else {
            movementGoLocationSessions.set(executionPlan.id, { planVersion: executionPlan.version, stopId: staleGo.stopId, confirmedStale: true });
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Share your location to continue /go." });
            await requestTelegramMovementGoLocation(pairing.binding.chatId, executionPlan.id, executionPlan.version, executionPlan.presentation?.places.find((place) => place.id === staleGo.stopId)?.name ?? "that stop");
          }
          continue;
        }
        const planChangeAction = parseTelegramPlanChangeAction(update.callbackData);
        if (planChangeAction.action !== "not_change" && update.callbackId) {
          const proposal = store.getTelegramPlanChangeProposal(planChangeAction.proposalId);
          if (!proposal || proposal.status !== "pending") {
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "That Plan change proposal is no longer pending." });
            continue;
          }
          if (planChangeAction.action === "cancel") {
            store.resolveTelegramPlanChangeProposal(proposal.id, "cancelled");
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Current Plan kept unchanged." });
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: "The proposed change was cancelled. Your current Plan and its active reminders are unchanged." });
            continue;
          }
          const workspace = store.getWorkspace();
          if (workspace.activePlan.id !== proposal.planId || workspace.activePlan.version !== proposal.baseVersion || workspace.activePlan.status !== "active") {
            store.resolveTelegramPlanChangeProposal(proposal.id, "stale");
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "That proposal is out of date." });
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: "The Plan changed after this suggestion was created, so the older suggestion was not applied. Send the request again and Landi will reassess it against the latest Plan." });
            continue;
          }
          if (workspace.activeBlueprint) {
            store.resolveTelegramPlanChangeProposal(proposal.id, "cancelled");
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Blueprint replanning is not enabled yet." });
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: "This Plan is backed by a Trip Blueprint. Landi kept it unchanged because Assisted Replanning is not enabled yet. Use the Web workbench to start a new planning conversation." });
            continue;
          }
          if (generatingPlan) {
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Another Plan draft is already being prepared." });
            continue;
          }
          await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Preparing a replacement draft…" });
          generatingPlan = true;
          let runId: string | undefined;
          try {
            const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
            runId = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "telegram" }).id;
            const draft = await runtime.generatePlanDraft({
              request: proposal.request,
              currentPlan: planDraftForRevision(workspace.activePlan),
              completedTasks: completedTasksForRevision(workspace.activePlan),
              profile: { preferredLanguage: workspace.profile.preferredLanguage, nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus }
            });
            const revised = store.reviseGeneratedPlan({ draft, runtime: workspace.runtime.selectedKind, expectedPlanId: proposal.planId, expectedVersion: proposal.baseVersion, changeImpact: proposal.impact });
            store.resolveTelegramPlanChangeProposal(proposal.id, "applied");
            store.finishPlanGenerationRun({ runId, status: "succeeded", outputPlanId: revised.activePlan.id });
            await sendTelegramCommandReplies(pairing.binding.chatId, telegramPlanReplies(revised.activePlan, withTelegramExecutionContinuity(revised, "Landi prepared a complete replacement draft from your request. The existing Plan remains active until you confirm this draft.")));
          } catch (error) {
            if (runId) store.finishPlanGenerationRun({ runId, status: "failed", failureCode: planGenerationFailureCode(error) });
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: "Landi could not prepare the replacement draft, so the current Plan remains unchanged. You can use the same proposal button to retry while its Plan version is still current." });
          } finally {
            generatingPlan = false;
          }
          continue;
        }
        const foodParty = parseTelegramFoodPartyCallback(update.callbackData);
        if (foodParty && update.callbackId) {
          const workspace = store.getWorkspace();
          const plan = workspace.activePlan.id === foodParty.planId ? workspace.activePlan : store.getExecutionPlan();
          if (!plan || plan.id !== foodParty.planId || plan.version !== foodParty.version) {
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
            const refinement = planRefinementState(store.getWorkspace().activePlan);
            if (refinement.followUpQuestion) {
              await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "The Plan still needs one critical answer." });
              await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `Before final confirmation, answer this one question:\n\n${refinement.followUpQuestion}` });
              continue;
            }
            const previousExecution = store.getExecutionPlan();
            const confirmed = store.confirmPlan(store.getWorkspace().activePlan.id);
            startActivePlanMonitoring();
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "Plan activated." });
            const profileNext = confirmed.profile.status === "incomplete" ? "\n\nYour Plan is active, but some policy-routing basics are still missing. Send /profile when convenient; this does not block other Plan work." : "";
            const switched = previousExecution && previousExecution.id !== confirmed.activePlan.id ? `\n\nThe previous executing Plan “${previousExecution.title}” is now in history. Its unfinished reminders no longer run.` : "";
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `Plan activated\n${confirmed.activePlan.title}\n\nApproved reminders and read-only preparation are now eligible to run. No booking, payment, ride, or other external action was started.${switched}${profileNext}` });
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
        const delayedRoutePlanId = update.callbackData?.match(/^route_not_arrived:(plan-[0-9a-f-]{36})$/)?.[1];
        if (delayedRoutePlanId && update.callbackId) {
          const executionPlan = store.getExecutionPlan();
          if (executionPlan?.id !== delayedRoutePlanId) {
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: "That route timeline is no longer current." });
          } else {
            const delayed = store.delayTelegramRouteArrivalGuidance(executionPlan.id, new Date().toISOString(), HANDOFF_DELAY_SECONDS);
            await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: delayed ? "Arrival guidance delayed by 15 minutes." : "This delay was already recorded." });
            if (delayed) await requestTelegramArrivalLocation(pairing.binding.chatId, "No problem. Landi has delayed the next arrival guidance by 15 minutes. To recalculate from current conditions, share your location once below.", true);
          }
          continue;
        }
        const completedTaskId = update.callbackData?.match(/^arrival_task_complete:(task-[0-9a-f-]{36})$/)?.[1];
        if (completedTaskId && update.callbackId) {
          const executionPlan = store.getExecutionPlan();
          const completed = executionPlan ? store.completeReadyTask(executionPlan.id, completedTaskId) : undefined;
          await telegram.answerCallbackQuery({ callbackId: update.callbackId, text: completed ? "Task marked complete." : "That task is not ready to complete." });
          if (completed) await telegram.sendMessage({ chatId: pairing.binding.chatId, text: `Completed by your confirmation: ${completed.title}\n\nNo external completion was inferred by Landi.` });
        }
        continue;
      }
      if (update.location) {
        const intent = store.getTelegramLocationIntent();
        store.clearTelegramLocationIntent();
        const workspace = store.getWorkspace();
        const executionPlan = store.getExecutionPlan();
        const acceptedPlanIds = new Set([workspace.activePlan.id, executionPlan?.id].filter((id): id is string => Boolean(id)));
        if (!intent || !acceptedPlanIds.has(intent.planId)) {
          const checkin = executionPlan ? store.getTelegramArrivalCheckin(executionPlan.id) : undefined;
          if (executionPlan && shouldRenewExpiredArrivalLocationRequest(executionPlan.status, checkin)) {
            await requestTelegramArrivalLocation(pairing.binding.chatId, "The earlier location request expired, so those coordinates were not used or saved. Tap below to share again now.");
          } else {
            await telegram.sendMessage({ chatId: pairing.binding.chatId, text: "There is no active location request for the current Plan. Send /food for nearby food, or use the arrival route action when it appears. These coordinates were not used or saved." });
          }
        } else if (intent.purpose === "nearby_food") {
          await sendNearbyFoodFromSharedLocation(pairing.binding.chatId, update.location, intent.planId);
        } else if (intent.purpose === "movement_go") {
          await sendMovementGoFromSharedLocation(pairing.binding.chatId, update.location, intent.planId);
        } else if (intent.purpose === "uber_test") {
          await sendUberTestFromSharedLocation(pairing.binding.chatId, update.location, intent.planId);
        } else {
          await sendArrivalRouteFromSharedLocation(pairing.binding.chatId, update.location, intent.planId, intent.transportOverride);
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
      const responses = await messagingCommandResponse(update.text, "telegram");
      if (responses) await sendTelegramCommandReplies(pairing.binding.chatId, responses);
    }
    if (updates.data.nextOffset !== undefined) store.advanceTelegramUpdateOffset(updates.data.nextOffset);
  } catch (error) {
    server.log.warn({ error }, "Telegram polling failed");
  } finally {
    pollingTelegram = false;
  }
}

async function sendMovementGoFromSharedLocation(chatId: string, location: { latitude: number; longitude: number }, planId: string): Promise<void> {
  const plan = store.getExecutionPlan();
  const session = movementGoLocationSessions.get(planId);
  movementGoLocationSessions.delete(planId);
  if (!plan || plan.id !== planId || plan.status !== "active") {
    await telegram.sendMessage({ chatId, text: "Location received, but there is no current Execution Plan for /go. No location was saved." });
    return;
  }
  const card = await createMovementActionCard({
    plan,
    currentLocation: location,
    maps: {
      convertGpsCoordinate: (input) => maps.convertGpsCoordinate(input),
      drivingRoute: (input) => maps.drivingRoute(input),
      walkingRoute: (input) => maps.walkingRoute(input),
      transitRoute: (input) => maps.transitRoute(input),
      reverseGeocode: (input) => maps.reverseGeocode(input)
    },
    weather: { weather: (input) => googleWeather.weather(input) },
    ...(session?.planVersion === plan.version && session.confirmedStale ? { confirmedStaleStopId: session.stopId } : {})
  });
  await telegram.sendMessage({ chatId, ...formatTelegramMovementActionCard(card) });
}

async function sendArrivalRouteFromSharedLocation(chatId: string, location: { latitude: number; longitude: number }, planId: string, transportOverride?: "taxi" | "public_transit" | "walking"): Promise<void> {
  const workspace = store.getWorkspace();
  const plan = workspace.activePlan.id === planId ? workspace.activePlan : store.getExecutionPlan();
  if (!plan || plan.id !== planId) return;
  store.markTelegramArrivalLocationReceived(plan.id, new Date().toISOString());
  const destination = arrivalRouteDestination(plan);
  if (!destination) {
    await telegram.sendMessage({ chatId, text: "Location received for this interaction, but this Plan does not yet contain a specific accommodation or destination. Add the hotel or destination in the Web workspace, then request route help again. The shared coordinates were not saved to your Profile or database." });
    return;
  }
  const gpsLocation = `${location.longitude},${location.latitude}`;
  const converted = await maps.convertGpsCoordinate({ location: gpsLocation });
  if (converted.status !== "available" || !converted.data) {
    await telegram.sendMessage({ chatId, text: "Location received, but Google Maps could not prepare a route from it right now. No location has been saved." });
    return;
  }
  const origin: PlaceFact = { provider: "google_maps", id: "", name: "Shared current location", address: "", location: converted.data.location, type: "Temporary location", city: "", district: "" };
  const routeFacts: RouteFact[] = [];
  const preference = transportOverride ?? plan.configuration.transport.preference;
  if (preference === "taxi") {
    const route = await maps.drivingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined });
    if (route.status === "available" && route.data) routeFacts.push(route.data);
  } else if (preference === "walking") {
    const route = await maps.walkingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined });
    if (route.status === "available" && route.data) routeFacts.push(route.data);
  } else if (preference === "public_transit") {
    const route = await arrivalTransitRoute(origin, destination);
    if (route) routeFacts.push(route);
  } else if (preference === "plan_recommended") {
    const [driving, walking, transit] = await Promise.all([
      maps.drivingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined }),
      maps.walkingRoute({ origin: origin.location, destination: destination.location, destinationId: destination.id || undefined }),
      arrivalTransitRoute(origin, destination)
    ]);
    if (driving.status === "available" && driving.data) routeFacts.push(driving.data);
    if (walking.status === "available" && walking.data) routeFacts.push(walking.data);
    if (transit) routeFacts.push(transit);
  }
  const transport = selectArrivalTransport(plan, routeFacts, transportOverride);
  const selectedRoute = routeFacts.find((route) => route.mode === transport);
  const result = formatArrivalRoute({
    origin,
    destination,
    transport,
    taxiRequested: preference === "taxi",
    ...(preference === "taxi" ? { uberPickup: location, uberClientId: process.env.UBER_CLIENT_ID } : {}),
    ...(selectedRoute ? { route: selectedRoute } : {})
  });
  const receipt = await telegram.sendMessage({ chatId, text: result.text, replyMarkup: { inline_keyboard: [[{ text: result.handoffLabel, url: result.handoffUrl }]] } });
  if (receipt.status === "available" && selectedRoute?.durationSeconds !== undefined) {
    const offeredAt = receipt.observedAt;
    store.recordTelegramRouteHandoffOffered({
      planId: plan.id,
      offeredAt,
      routeDurationSeconds: selectedRoute.durationSeconds,
      waitBufferSeconds: DEFAULT_HANDOFF_WAIT_SECONDS,
      safetyMarginSeconds: DEFAULT_HANDOFF_SAFETY_SECONDS,
      expectedArrivalAt: expectedArrivalAt({ basisAt: offeredAt, routeDurationSeconds: selectedRoute.durationSeconds })
    });
  }
}

async function sendUberTestFromSharedLocation(chatId: string, location: { latitude: number; longitude: number }, planId: string): Promise<void> {
  const workspace = store.getWorkspace();
  const plan = workspace.activePlan.id === planId ? workspace.activePlan : store.getExecutionPlan();
  if (!plan || plan.id !== planId) return;
  await telegram.sendMessage({ chatId, ...formatUberTestReply(plan, location) });
}

function formatUberTestReply(plan: Plan, location: { latitude: number; longitude: number }): TelegramCommandReply {
  const accommodation = plan.configuration.accommodation;
  const destination = accommodation.name && accommodation.address
    ? { name: accommodation.name, address: accommodation.address }
    : { name: currentPlanDestination(plan), address: plan.location };
  const handoff = createUberRideHandoff({
    pickup: location,
    destination,
    ...(process.env.UBER_CLIENT_ID ? { clientId: process.env.UBER_CLIENT_ID } : {})
  });
  return {
    text: `Uber test ready\nPickup: one-time test location\nDropoff: ${destination.name}\n\nTap Open Uber to check whether Uber can resolve the route, show nearby vehicles, estimate fare, and use your payment method. Landi has not requested a ride, made a booking, or started payment.`,
    replyMarkup: { inline_keyboard: [[{ text: "Open Uber", url: handoff.url }]] }
  };
}

async function sendNearbyFoodFromSharedLocation(chatId: string, location: { latitude: number; longitude: number }, planId: string): Promise<void> {
  const workspace = store.getWorkspace();
  const plan = workspace.activePlan.id === planId ? workspace.activePlan : store.getExecutionPlan();
  if (!plan || plan.id !== planId) return;
  const partySize = plan.configuration.travelContext.partySize;
  if (!partySize) {
    await telegram.sendMessage({ chatId, text: "Party size is missing from this Plan. The shared coordinates were not used or saved. Send /food followed by the number of people, for example /food 2." });
    return;
  }
  const converted = await maps.convertGpsCoordinate({ location: `${location.longitude},${location.latitude}` });
  if (converted.status !== "available" || !converted.data) {
    await telegram.sendMessage({ chatId, text: "Location received, but Google Maps could not use it for nearby discovery right now. No location was saved and no restaurant facts were guessed." });
    return;
  }
  const result = await maps.nearbyRestaurants({ location: converted.data.location, limit: 8 });
  if (result.status !== "available" || !result.data) {
    await telegram.sendMessage({ chatId, text: `Google Maps could not return nearby food right now. ${result.failure?.message ?? "The provider is unavailable."}\n\nNo location was saved, and no candidate, order, reservation, or payment was created.` });
    return;
  }
  const skillResult = runFoodNearbySkill({ partySize, candidates: result.data, observedAt: result.observedAt, provider: "google_maps" });
  await telegram.sendMessage({ chatId, ...formatTelegramNearbyFood({ result: skillResult, places: result.data, partySize }) });
}

async function arrivalTransitRoute(origin: PlaceFact, destination: PlaceFact): Promise<RouteFact | undefined> {
  const [originArea, destinationArea] = await Promise.all([
    maps.reverseGeocode({ location: origin.location }),
    maps.reverseGeocode({ location: destination.location })
  ]);
  if (originArea.status !== "available" || !originArea.data || destinationArea.status !== "available" || !destinationArea.data) return undefined;
  const route = await maps.transitRoute({
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
    if (receipt.status !== "available") server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram arrival reminder could not be delivered");
    else store.recordTelegramArrivalCheckin({ planId: plan.id, checkInSentAt: new Date().toISOString() });
  } catch (error) {
    server.log.warn({ error }, "Telegram arrival reminder failed");
  } finally {
    checkingArrivalReminder = false;
  }
}

async function runRouteHandoffGuidance(): Promise<void> {
  if (checkingRouteHandoffGuidance) return;
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
      server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram expected-arrival guidance could not be delivered");
    }
  } catch (error) {
    store.releaseTelegramRouteArrivalGuidance(plan.id, claimTime);
    server.log.warn({ error }, "Telegram expected-arrival guidance failed");
  } finally {
    checkingRouteHandoffGuidance = false;
  }
}

async function runTaskReminders(): Promise<void> {
  if (checkingTaskReminders) return;
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

async function runItineraryDepartureReminders(): Promise<void> {
  if (checkingItineraryDepartureReminders) return;
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
        ...(mapUrl ? { replyMarkup: { inline_keyboard: [[{ text: "Open in Google Maps", url: mapUrl }]] } } : {})
      });
      if (receipt.status === "available") {
        store.recordTelegramItineraryReminderDelivered(delivery);
      } else {
        const outcome = store.recordTelegramItineraryReminderFailure({ ...delivery, failureCode: receipt.failure?.code ?? "unknown_failure", retryable: receipt.failure?.retryable ?? false });
        server.log.warn({ status: receipt.status, code: receipt.failure?.code, dayId: item.dayId, placeId: item.place.id, attempt: attempt.attemptNumber, outcome: outcome.status }, "Telegram itinerary departure reminder could not be delivered");
      }
    }
  } catch (error) {
    server.log.warn({ error, planId: plan.id }, "Telegram itinerary departure reminders failed");
  } finally {
    checkingItineraryDepartureReminders = false;
  }
}

function isValidIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function runPlanWeatherMonitor(): Promise<void> {
  if (checkingPlanWeather) return;
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
      if (receipt.status !== "available") server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Plan weather attention could not be delivered to Telegram");
    }
  } catch (error) {
    server.log.warn({ error, planId: plan.id }, "Plan weather monitoring failed");
  } finally {
    checkingPlanWeather = false;
  }
}

async function runPlanVenueMonitor(): Promise<void> {
  if (checkingPlanVenues) return;
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
      if (receipt.status !== "available") server.log.warn({ status: receipt.status, code: receipt.failure?.code, placeId: attention.placeId }, "Plan venue attention could not be delivered to Telegram");
    }
  } catch (error) {
    server.log.warn({ error, planId: plan.id }, "Plan venue monitoring failed");
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
    await requestTelegramArrivalLocation(pairing.binding.chatId, "We have not received an arrival update. If you want route help, tap the button below to share your current location.");
  } finally {
    checkingArrivalLocationPrompt = false;
  }
}

async function requestTelegramArrivalLocation(chatId: string, intro: string, allowRepeat = false): Promise<void> {
  if (requestingArrivalLocation) return;
  const planId = store.getExecutionPlan()?.id;
  if (!planId) return;
  const existing = store.getTelegramArrivalCheckin(planId);
  const activeIntent = store.getTelegramLocationIntent();
  if ((!allowRepeat && existing?.locationReceivedAt) || (activeIntent?.purpose === "arrival_route" && activeIntent.planId === planId)) return;
  requestingArrivalLocation = true;
  try {
    const receipt = await telegram.sendMessage({ chatId, text: `${intro} Landi will use it only for this interaction and will not save it to your Profile.`, replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
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
  const workspace = store.getWorkspace();
  const planId = (store.getExecutionPlan() ?? workspace.activePlan).id;
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

async function requestTelegramMovementGoLocation(chatId: string, planId: string, _planVersion: number, stopName: string): Promise<void> {
  if (requestingMovementGoLocation) return;
  requestingMovementGoLocation = true;
  try {
    const reply = formatTelegramMovementLocationRequest(stopName);
    const receipt = await telegram.sendMessage({ chatId, ...reply });
    if (receipt.status === "available") store.startTelegramLocationIntent({ purpose: "movement_go", planId });
    else server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram /go location request could not be delivered");
  } finally {
    requestingMovementGoLocation = false;
  }
}

type TelegramCommandReply = { text: string; replyMarkup?: TelegramReplyMarkup; locationIntent?: { purpose: "nearby_food" | "arrival_route" | "uber_test" | "movement_go"; planId: string; transportOverride?: "taxi" | "public_transit" | "walking" } };

async function sendTelegramCommandReplies(chatId: string, replies: TelegramCommandReply[]): Promise<void> {
  for (const reply of replies) {
    const { locationIntent, ...message } = reply;
    const receipt = await telegram.sendMessage({ chatId, ...message });
    if (receipt.status === "available") {
      if (locationIntent) store.startTelegramLocationIntent(locationIntent);
      continue;
    }
    server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "Telegram command response could not be delivered completely");
    return;
  }
}

async function sendWhatsAppCommandReplies(to: string, serviceWindowExpiresAt: string, replies: TelegramCommandReply[]): Promise<void> {
  for (const reply of replies) {
    const receipt = await whatsapp.sendText({ to, text: reply.text, serviceWindowExpiresAt });
    if (receipt.status !== "available") {
      server.log.warn({ status: receipt.status, code: receipt.failure?.code }, "WhatsApp command response could not be delivered completely");
      return;
    }
    const actionText = whatsappActionFallback(reply.replyMarkup, Boolean(reply.locationIntent));
    if (!actionText) continue;
    const actionReceipt = await whatsapp.sendText({ to, text: actionText, serviceWindowExpiresAt });
    if (actionReceipt.status !== "available") {
      server.log.warn({ status: actionReceipt.status, code: actionReceipt.failure?.code }, "WhatsApp action fallback could not be delivered");
      return;
    }
  }
}

async function messagingCommandResponse(text: string | undefined, trigger: "telegram" | "whatsapp"): Promise<TelegramCommandReply[] | undefined> {
  const command = parseTelegramCommand(text);
  if (command.type === "empty") return undefined;
  if (command.type === "help") return [{ text: "Landi is connected. Talk naturally to view or change your Plan and to ask for current help. For example:\n• “What’s the weather now?”\n• “Where should we eat nearby?”\n• “Show me my current Plan”\n• “I want Italian food” — previews a Plan change before generating a replacement draft\n• “I prefer taxi” — updates the current route or Plan context\n\nControls:\n/plan — show the current Plan and confirmation control\n/prepare — prepare the current draft with connected sources and Skills\n/new <what you need to do> — create a separate complete Plan draft\n/profile — review or change your basic Profile\n/weather — check current weather for the Plan destination\n/food — find nearby food after an explicit location share\n/go — prepare a Movement Action Card for the next planned stop after an explicit location share\n/help — show this help\n\nLandi does not book, pay, order, call a ride, or start navigation." }];
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
    movementGoLocationSessions.set(plan.id, { planVersion: plan.version, stopId: selection.place.id, confirmedStale: false });
    return [{ ...formatTelegramMovementLocationRequest(selection.place.name), locationIntent: { purpose: "movement_go", planId: plan.id } }];
  }
  if (command.type === "weather") {
    const workspace = store.getWorkspace();
    const plan = store.getExecutionPlan() ?? workspace.activePlan;
    const result = await fetchTelegramPlanWeather({
      location: currentPlanDestination(plan),
      language: "en",
      dependencies: {
        geocodeAddress: (input) => geocodeWeatherAddress(input),
        weather: (input) => fetchUserWeather({
          ...input,
          dependencies: { weather: (weatherInput) => googleWeather.weather(weatherInput) }
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
    if (generatingPlan) return [{ text: "A Plan draft is already being prepared. Please wait for it before sending another request." }];
    generatingPlan = true;
    try {
      const workspace = store.getWorkspace();
      if (workspace.profile.status !== "ready") return [{ text: "Complete your required long-term Profile before creating a Plan. Send /profile, fill in nationality and China visa or residence status, then send your Plan request again." }];
      const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
      const revising = telegramPlanRequestMode(workspace, command.explicit) === "revise";
      if (!revising) {
        return [{ text: "Complete Trip Blueprint generation is currently available in the Web workbench. Landi will not use the older one-shot Plan generator or a local template fallback. Open Plan, start a planning conversation, confirm the proposal, and review the generated draft there." }];
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
        const refinement = planRefinementState(revised.activePlan);
        if (refinement.followUpQuestion) {
          return [{ text: withTelegramExecutionContinuity(revised, `${runtimeName(workspace.runtime.selectedKind)} updated the Plan skeleton from your answer.\n\n${refinement.followUpQuestion}`) }];
        }
        return telegramPlanReplies(revised.activePlan, withTelegramExecutionContinuity(revised, `${runtimeName(workspace.runtime.selectedKind)} revised the current Plan from your correction.`));
      }
      throw new Error("Unreachable Telegram Plan generation mode.");
    } finally {
      generatingPlan = false;
    }
  }
  if (command.type === "start") return [{ text: `This ${trigger === "whatsapp" ? "WhatsApp number" : "Telegram account"} is connected to Landi. Send /help to see available commands.` }];
  return [{ text: "That command is not available yet. Send /help to see what Landi can do." }];
}

function telegramPlanReplies(plan: ReturnType<SqliteWorkspaceStore["getWorkspace"]>["activePlan"], intro?: string): TelegramCommandReply[] {
  const replyMarkup = telegramPlanConfirmationMarkup(plan);
  const pages = formatTelegramPlanPages(plan);
  return pages.map((page, index) => ({
    text: index === 0 && intro ? `${intro}\n\n${page}` : page,
    ...(index === pages.length - 1 && replyMarkup ? { replyMarkup } : {})
  }));
}

function withTelegramExecutionContinuity(workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>, intro: string): string {
  const continuity = telegramExecutionContinuityNotice(workspace);
  return continuity ? `${intro}\n\n${continuity}` : intro;
}

function runtimeName(kind: AgentRuntimeKind): string {
  return kind === "claude-code" ? "Claude Code" : "Codex";
}

function currentPlanDestination(plan: Plan): string {
  if (!plan.presentation || plan.presentation.kind !== "itinerary") return plan.location;
  return resolveCurrentPlanDestination(plan.presentation, { arrivals: store.listPlanDestinationArrivals(plan.id) })?.city ?? plan.location;
}

function saveProtectedBookingAttachment(booking: TravelBooking, sourceContent: string | undefined): void {
  const contentText = normalizeImportedBookingText(sourceContent ?? "");
  if (!contentText) return;
  if (contentText.length > 80_000) throw new Error("Booking confirmation text is too large for protected attachment storage.");
  store.saveProtectedBookingAttachment({
    bookingId: booking.id,
    sourceHash: booking.sourceHash,
    sourceLabel: booking.sourceLabel,
    contentText,
    createdAt: booking.importedAt
  });
}

function blueprintBookingConstraintsFromTravelBookings(bookings: TravelBooking[]): BlueprintBookingConstraint[] {
  return bookings
    .filter((booking) => booking.status !== "cancelled")
    .map((booking): BlueprintBookingConstraint => ({
      id: `booking-${booking.id}`,
      type: booking.type,
      title: booking.title,
      status: booking.status,
      sourceLabel: booking.sourceLabel,
      importedAt: booking.importedAt,
      constraintStrength: booking.constraintStrength,
      segments: booking.segments.map((segment) => ({
        id: `segment-${segment.id}`,
        segmentType: segment.segmentType,
        title: segment.title,
        ...(segment.startAtLocal ? { startAtLocal: segment.startAtLocal } : {}),
        ...(segment.startTimeZone ? { startTimeZone: segment.startTimeZone } : {}),
        ...(segment.endAtLocal ? { endAtLocal: segment.endAtLocal } : {}),
        ...(segment.endTimeZone ? { endTimeZone: segment.endTimeZone } : {}),
        ...(segment.origin ? { origin: segment.origin } : {}),
        ...(segment.destination ? { destination: segment.destination } : {}),
        ...(segment.location ? { location: segment.location } : {}),
        constraintStrength: segment.constraintStrength,
        fixedCommitment: segment.fixedCommitment,
        needsReviewReasons: [...segment.needsReviewReasons]
      }))
    }));
}

function promotePlanningBookingsToPlan(sessionId: string, planId: string, planVersion: number): void {
  for (const booking of store.listTravelBookingsForPlanningSession(sessionId)) {
    const promoted: TravelBooking = {
      ...structuredClone(booking),
      id: `${booking.id}-plan-${planId}`,
      planId,
      planVersionCreated: planVersion,
      updatedAt: new Date().toISOString()
    };
    delete promoted.planningSessionId;
    store.saveTravelBooking(promoted);
  }
}

function applyBookingFactsToPlanningSession(sessionId: string, booking: TravelBooking): void {
  const session = store.getPlanningSessionById(sessionId);
  if (!session) throw new Error("The planning session was not found.");
  const facts = planningFactsFromBooking(booking);
  if (!facts.length) return;
  store.savePlanningSession(applyExternalPlanningFacts(session, facts));
}

function planningFactsFromBooking(booking: TravelBooking): PlanningFact[] {
  if (booking.status === "cancelled") return [];
  const timestamp = new Date().toISOString();
  const facts: PlanningFact[] = [];
  const usefulSegments = booking.segments.filter((segment) => segment.constraintStrength !== "ignored" && segment.status !== "cancelled");
  const dateValues = usefulSegments.flatMap((segment) => [dateOnly(segment.startAtLocal), dateOnly(segment.endAtLocal)]).filter((value): value is string => Boolean(value)).sort();
  if (dateValues.length) facts.push(planningFact("travel_dates", `${dateValues[0]} to ${dateValues[dateValues.length - 1]}`, timestamp));
  const accommodation = usefulSegments.find((segment) => segment.segmentType === "hotel_stay" && (segment.location || segment.destination));
  if (accommodation) {
    const location = accommodation.location ?? accommodation.destination!;
    facts.push(planningFact("accommodation", `${booking.title} at ${location}`, timestamp));
    facts.push(planningFact("destination", location, timestamp));
  }
  const transportSegments = usefulSegments.filter((segment) => segment.segmentType === "flight_leg" || segment.segmentType === "train_leg")
    .sort((left, right) => (left.startAtLocal ?? left.endAtLocal ?? "").localeCompare(right.startAtLocal ?? right.endAtLocal ?? ""));
  const firstTransport = transportSegments[0];
  if (firstTransport && (firstTransport.origin || firstTransport.destination || firstTransport.endAtLocal || firstTransport.startAtLocal)) {
    facts.push(planningFact("arrival", bookingSegmentTravelFact(firstTransport), timestamp));
    if (firstTransport.destination) facts.push(planningFact("destination", firstTransport.destination, timestamp));
  }
  const lastTransport = transportSegments.length > 1 ? transportSegments[transportSegments.length - 1] : undefined;
  if (lastTransport) facts.push(planningFact("departure", bookingSegmentTravelFact(lastTransport), timestamp));
  return facts;
}

function bookingSegmentTravelFact(segment: BookingSegment): string {
  return [
    segment.origin ? `Depart from ${segment.origin}` : "",
    segment.destination ? `arrive at ${segment.destination}` : "",
    segment.startAtLocal ? `start ${segment.startAtLocal}` : "",
    segment.endAtLocal ? `end ${segment.endAtLocal}` : ""
  ].filter(Boolean).join(", ");
}

function planningFact(key: string, value: string, updatedAt: string): PlanningFact {
  return { key, value, source: "inferred", confirmed: true, updatedAt };
}

function dateOnly(value: string | undefined): string | undefined {
  const iso = value?.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const slash = value?.match(/\b(20\d{2})[\/.](\d{1,2})[\/.](\d{1,2})\b/) ?? value?.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (!slash) return undefined;
  if (slash[1]?.length === 4) return `${slash[1]}-${slash[2]!.padStart(2, "0")}-${slash[3]!.padStart(2, "0")}`;
  return `${slash[3]}-${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
}

function previewBookingImport(input: BookingImportInput, scope: { planningSessionId?: string; planId?: string }): BookingImportPreview {
  const content = normalizeImportedBookingText(input?.content ?? "");
  if (!content) throw new Error("Paste or upload a booking confirmation before previewing it.");
  if (content.length > 80_000) throw new Error("Booking confirmation text is too large for the MVP importer.");
  const sourceHash = createHash("sha256").update(content).digest("hex");
  const sourceLabel = (input.sourceLabel?.trim() || "Imported booking confirmation").slice(0, 160);
  const duplicate = store.hasTravelBookingSourceHash(scope, sourceHash);
  const booking = createBookingFromImportedText({ content, sourceHash, sourceLabel, scope });
  return { sourceHash, sourceLabel, duplicate, possibleDuplicate: !duplicate && hasLikelyDuplicateBooking(scope, booking), bookings: [booking] };
}

function normalizeAcceptedBooking(input: TravelBooking | undefined, scope: { planningSessionId?: string; planId?: string; planVersionCreated?: number }): TravelBooking {
  if (!input) throw new Error("Choose a booking preview to accept.");
  const now = new Date().toISOString();
  const segments = (input.segments.length ? input.segments : [fallbackSegment(input.title)]).map((segment): BookingSegment => {
    const constraintStrength = normalizeConstraintStrength(segment.constraintStrength);
    const needsReviewReasons = [...new Set((segment.needsReviewReasons ?? []).map((reason) => reason.trim()).filter(Boolean))];
    if (constraintStrength === "hard" && !segmentHasStructuralAnchor(segment)) needsReviewReasons.push("Hard constraints need a usable time and location.");
    return {
      id: segment.id || randomUUID(),
      segmentType: normalizeSegmentType(segment.segmentType),
      title: segment.title?.trim().slice(0, 180) || input.title || "Imported booking segment",
      status: normalizeBookingStatus(segment.status),
      ...(segment.startAtLocal?.trim() ? { startAtLocal: segment.startAtLocal.trim().slice(0, 80) } : {}),
      ...(segment.startTimeZone?.trim() ? { startTimeZone: segment.startTimeZone.trim().slice(0, 80) } : {}),
      ...(segment.endAtLocal?.trim() ? { endAtLocal: segment.endAtLocal.trim().slice(0, 80) } : {}),
      ...(segment.endTimeZone?.trim() ? { endTimeZone: segment.endTimeZone.trim().slice(0, 80) } : {}),
      ...(segment.origin?.trim() ? { origin: segment.origin.trim().slice(0, 180) } : {}),
      ...(segment.destination?.trim() ? { destination: segment.destination.trim().slice(0, 180) } : {}),
      ...(segment.location?.trim() ? { location: segment.location.trim().slice(0, 240) } : {}),
      constraintStrength,
      fixedCommitment: constraintStrength === "hard",
      needsReviewReasons
    };
  });
  const status = segments.some((segment) => segment.needsReviewReasons.length) ? "needs_review" : normalizeBookingStatus(input.status);
  return {
    id: input.id || randomUUID(),
    ...scope,
    type: normalizeBookingType(input.type),
    status,
    title: input.title?.trim().slice(0, 180) || bookingTitleFromSegments(segments),
    ...(input.providerName?.trim() ? { providerName: input.providerName.trim().slice(0, 160) } : {}),
    source: input.source === "imported_email" || input.source === "imported_text" || input.source === "user" ? input.source : "imported_text",
    sourceHash: input.sourceHash?.trim() || createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    sourceLabel: input.sourceLabel?.trim().slice(0, 160) || "Accepted booking import",
    importedAt: input.importedAt && Number.isFinite(Date.parse(input.importedAt)) ? input.importedAt : now,
    updatedAt: now,
    constraintStrength: normalizeConstraintStrength(input.constraintStrength),
    segments,
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 2_000) } : {})
  };
}

function createBookingFromImportedText(input: { content: string; sourceHash: string; sourceLabel: string; scope: { planningSessionId?: string; planId?: string } }): TravelBooking {
  const type = detectBookingType(input.content);
  const providerName = extractProviderName(input.content, input.sourceLabel);
  const segments = extractBookingSegments(input.content, type);
  const status: TravelBookingStatus = segments.some((segment) => segment.needsReviewReasons.length) ? "needs_review" : "confirmed";
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ...input.scope,
    type,
    status,
    title: `${providerName ? `${providerName} ` : ""}${bookingTypeLabel(type)}`.trim(),
    ...(providerName ? { providerName } : {}),
    source: input.sourceLabel.toLocaleLowerCase().endsWith(".eml") || /mail|email/i.test(input.sourceLabel) ? "imported_email" : "imported_text",
    sourceHash: input.sourceHash,
    sourceLabel: input.sourceLabel,
    importedAt: now,
    updatedAt: now,
    constraintStrength: status === "confirmed" ? "hard" : "soft",
    segments,
    ...(extractConfirmationCode(input.content) ? { notes: "Confirmation code detected and kept out of generation context." } : {})
  };
}

function hasLikelyDuplicateBooking(scope: { planningSessionId?: string; planId?: string }, candidate: TravelBooking): boolean {
  const existing = [
    ...(scope.planningSessionId ? store.listTravelBookingsForPlanningSession(scope.planningSessionId) : []),
    ...(scope.planId ? store.listTravelBookingsForPlan(scope.planId) : [])
  ];
  return existing.some((booking) => likelySameBooking(booking, candidate));
}

function likelySameBooking(left: TravelBooking, right: TravelBooking): boolean {
  if (left.type !== right.type) return false;
  return left.segments.some((leftSegment) => right.segments.some((rightSegment) => likelySameBookingSegment(left.type, leftSegment, rightSegment)));
}

function likelySameBookingSegment(type: TravelBookingType, left: BookingSegment, right: BookingSegment): boolean {
  const startMatches = Boolean(left.startAtLocal && right.startAtLocal && canonicalDuplicateText(left.startAtLocal) === canonicalDuplicateText(right.startAtLocal));
  const endMatches = Boolean(left.endAtLocal && right.endAtLocal && canonicalDuplicateText(left.endAtLocal) === canonicalDuplicateText(right.endAtLocal));
  const originMatches = duplicateTextMatches(left.origin, right.origin);
  const destinationMatches = duplicateTextMatches(left.destination, right.destination);
  const locationMatches = duplicateTextMatches(left.location, right.location);
  if (type === "flight" || type === "train") return startMatches && originMatches && destinationMatches;
  if (type === "accommodation") return startMatches && endMatches && locationMatches;
  if (type === "rental_car") return startMatches && (locationMatches || originMatches);
  return startMatches && (locationMatches || destinationMatches);
}

function duplicateTextMatches(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = canonicalDuplicateText(left);
  const b = canonicalDuplicateText(right);
  return a === b || (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a)));
}

function canonicalDuplicateText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fffぁ-んァ-ヶー一-龠]+/g, "");
}

function normalizeImportedBookingText(value: string): string {
  return cleanImportedBookingText(extractReadableBookingText(value));
}

function cleanImportedBookingText(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|br|li|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractReadableBookingText(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parsed = parseMimeBlock(normalized);
  if (!parsed.headers.size) return normalized;
  const contentType = headerValue(parsed.headers, "content-type");
  const boundary = mimeBoundary(contentType);
  if (boundary) {
    const readable = splitMimeParts(parsed.body, boundary)
      .map(parseMimeBlock)
      .filter((part) => !/attachment/i.test(headerValue(part.headers, "content-disposition")))
      .map((part) => ({ part, text: extractReadableMimePart(part) }))
      .filter((item) => item.text.trim())
      .sort((left, right) => mimePartScore(right.part) - mimePartScore(left.part));
    return readable.map((item) => item.text).join("\n\n") || parsed.body;
  }
  return decodeMimeBody(parsed.body, parsed.headers);
}

function extractReadableMimePart(part: { headers: Map<string, string>; body: string }): string {
  const contentType = headerValue(part.headers, "content-type");
  const boundary = mimeBoundary(contentType);
  if (boundary) return extractReadableBookingText([`Content-Type: ${contentType}`, "", part.body].join("\n"));
  if (!/text\/(?:plain|html)/i.test(contentType || "text/plain")) return "";
  return decodeMimeBody(part.body, part.headers);
}

function mimePartScore(part: { headers: Map<string, string> }): number {
  const contentType = headerValue(part.headers, "content-type");
  if (/text\/plain/i.test(contentType)) return 3;
  if (/text\/html/i.test(contentType)) return 2;
  return 1;
}

function parseMimeBlock(value: string): { headers: Map<string, string>; body: string } {
  const separator = value.indexOf("\n\n");
  if (separator < 0) return { headers: new Map(), body: value };
  const rawHeaders = value.slice(0, separator);
  if (!/^[\w-]+:/m.test(rawHeaders)) return { headers: new Map(), body: value };
  return { headers: parseMimeHeaders(rawHeaders), body: value.slice(separator + 2) };
}

function parseMimeHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>();
  let current = "";
  for (const line of value.split("\n")) {
    if (/^\s/.test(line) && current) {
      const previous = headers.get(current) ?? "";
      headers.set(current, `${previous} ${line.trim()}`.trim());
      continue;
    }
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    current = match[1]!.toLocaleLowerCase();
    headers.set(current, decodeMimeHeader(match[2] ?? ""));
  }
  return headers;
}

function headerValue(headers: Map<string, string>, name: string): string {
  return headers.get(name.toLocaleLowerCase()) ?? "";
}

function mimeBoundary(contentType: string): string | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match?.[1] ?? match?.[2];
}

function splitMimeParts(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  return body.split(marker)
    .map((part) => part.trim())
    .filter((part) => part && part !== "--" && !part.startsWith("--"));
}

function decodeMimeBody(body: string, headers: Map<string, string>): string {
  const encoding = headerValue(headers, "content-transfer-encoding").toLocaleLowerCase();
  if (encoding === "base64") {
    try { return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return body; }
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  const input = value.replace(/=\n/g, "");
  for (let index = 0; index < input.length; index += 1) {
    const pair = input.slice(index + 1, index + 3);
    if (input[index] === "=" && /^[0-9a-f]{2}$/i.test(pair)) {
      bytes.push(Number.parseInt(pair, 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(input[index]!, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeMimeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_match, _charset: string, encoding: string, text: string) => {
    if (encoding.toLocaleLowerCase() === "b") {
      try { return Buffer.from(text, "base64").toString("utf8"); } catch { return text; }
    }
    return decodeQuotedPrintable(text.replace(/_/g, " "));
  });
}

function detectBookingType(content: string): TravelBookingType {
  const text = content.toLocaleLowerCase();
  if (/\b(rental car|car rental|pick-?up|pickup location|return location|vehicle)\b|租车|租車|レンタカー/.test(text)) return "rental_car";
  if (/\b(flight|airline|boarding|departure airport|arrival airport|gate|terminal)\b|航班|机票|機票|飛行機|航空券|フライト|便名/.test(text)) return "flight";
  if (/\b(train|rail|station|platform)\b|火车|火車|列车|列車|鉄道|電車|駅|ホーム/.test(text)) return "train";
  if (/\b(hotel|accommodation|check-?in|check-?out|property|room)\b|酒店|饭店|飯店|住宿|宾馆|賓館|ホテル|チェックイン|チェックアウト/.test(text)) return "accommodation";
  if (/\b(restaurant|table|dining)\b|餐厅|餐廳|餐馆|餐館|レストラン|食事/.test(text)) return "restaurant";
  if (/\b(tour|excursion)\b|行程|ツアー/.test(text)) return "tour";
  if (/\b(ticket|event|voucher)\b|门票|門票|票券|イベント|チケット/.test(text)) return "ticket";
  return "other";
}

function extractBookingSegments(content: string, type: TravelBookingType): BookingSegment[] {
  if (type === "flight" || type === "train") {
    const transportSegments = extractTransportBookingSegments(content, type);
    if (transportSegments.length > 1) return transportSegments;
  }
  const start = normalizeBookingDateValue(extractLabeledValue(content, ["departure", "depart", "check-in", "check in", "pickup", "pick-up", "start", "date", "出发", "出發", "出発", "入住", "チェックイン", "取车", "取車", "貸出"]));
  const end = normalizeBookingDateValue(extractLabeledValue(content, ["arrival", "arrive", "check-out", "check out", "return", "end", "到达", "到達", "到着", "退房", "チェックアウト", "还车", "還車", "返却"]));
  const origin = extractLabeledValue(content, ["departure airport", "pickup location", "pick-up location", "from", "origin", "出发机场", "出發機場", "出発空港", "取车地点", "取車地點", "貸出場所"]);
  const destination = extractLabeledValue(content, ["arrival airport", "return location", "to", "destination", "到达机场", "到達機場", "到着空港", "还车地点", "還車地點", "返却場所"]);
  const location = type === "accommodation"
    ? extractLabeledValue(content, ["property address", "address", "location", "venue", "地址", "住所", "所在地", "会場"]) ?? extractLabeledValue(content, ["property", "hotel", "酒店", "ホテル"])
    : extractLabeledValue(content, ["pickup location", "pick-up location", "return location", "address", "location", "venue", "地址", "住所", "所在地", "会場"]);
  const segmentType: BookingSegment["segmentType"] = type === "flight" ? "flight_leg" : type === "train" ? "train_leg" : type === "accommodation" ? "hotel_stay" : type === "rental_car" ? "rental_pickup" : type === "event" || type === "tour" || type === "ticket" || type === "restaurant" ? "event_window" : "other";
  const needsReviewReasons: string[] = [];
  if (!start) needsReviewReasons.push("Start date or time needs review.");
  if (!location && !origin && !destination) needsReviewReasons.push("Location needs review.");
  if ((type === "flight" || type === "train") && (!origin || !destination)) needsReviewReasons.push("Transport endpoints need review.");
  if (type === "accommodation" && !end) needsReviewReasons.push("Checkout date needs review.");
  const segment: BookingSegment = {
    id: randomUUID(),
    segmentType,
    title: bookingTypeLabel(type),
    status: needsReviewReasons.length ? "needs_review" : "confirmed",
    ...(start ? { startAtLocal: start } : {}),
    ...(end ? { endAtLocal: end } : {}),
    ...(origin ? { origin } : {}),
    ...(destination ? { destination } : {}),
    ...(location ? { location } : {}),
    constraintStrength: needsReviewReasons.length ? "soft" : "hard",
    fixedCommitment: needsReviewReasons.length === 0,
    needsReviewReasons
  };
  if (type !== "rental_car") return [segment];
  const returnNeedsReview = end ? segment.needsReviewReasons.filter((reason) => !reason.toLocaleLowerCase().includes("start")) : ["Return date or time needs review."];
  const returnLocation = destination ?? location;
  const returnSegment: BookingSegment = {
    id: randomUUID(),
    segmentType: "rental_return",
    title: "Rental car return",
    status: returnNeedsReview.length ? "needs_review" : "confirmed",
    ...(end ? { startAtLocal: end } : {}),
    ...(destination ? { origin: destination } : {}),
    ...(returnLocation ? { location: returnLocation } : {}),
    constraintStrength: returnNeedsReview.length ? "soft" : "hard",
    fixedCommitment: returnNeedsReview.length === 0,
    needsReviewReasons: returnNeedsReview
  };
  return [
    { ...segment, segmentType: "rental_pickup", title: "Rental car pickup" },
    returnSegment
  ];
}

function extractTransportBookingSegments(content: string, type: "flight" | "train"): BookingSegment[] {
  const blocks = content.split(/\n\s*\n/g).map((block) => block.trim()).filter(Boolean);
  const segmentType: BookingSegment["segmentType"] = type === "flight" ? "flight_leg" : "train_leg";
  const endpointLabels = type === "flight"
    ? { origin: ["departure airport", "from", "origin"], destination: ["arrival airport", "to", "destination"] }
    : { origin: ["departure station", "station from", "from", "origin"], destination: ["arrival station", "station to", "to", "destination"] };
  return blocks
    .map((block, index): BookingSegment | undefined => {
      const start = normalizeBookingDateValue(extractLabeledValue(block, ["departure", "depart", "出发", "出發", "出発"]));
      const end = normalizeBookingDateValue(extractLabeledValue(block, ["arrival", "arrive", "到达", "到達", "到着"]));
      const origin = extractLabeledValue(block, endpointLabels.origin);
      const destination = extractLabeledValue(block, endpointLabels.destination);
      if (!start && !end && !origin && !destination) return undefined;
      const needsReviewReasons: string[] = [];
      if (!start) needsReviewReasons.push("Start date or time needs review.");
      if (!origin || !destination) needsReviewReasons.push("Transport endpoints need review.");
      return {
        id: randomUUID(),
        segmentType,
        title: transportSegmentTitle(block, type, index),
        status: needsReviewReasons.length ? "needs_review" : "confirmed",
        ...(start ? { startAtLocal: start } : {}),
        ...(end ? { endAtLocal: end } : {}),
        ...(origin ? { origin } : {}),
        ...(destination ? { destination } : {}),
        constraintStrength: needsReviewReasons.length ? "soft" : "hard",
        fixedCommitment: needsReviewReasons.length === 0,
        needsReviewReasons
      };
    })
    .filter((segment): segment is BookingSegment => Boolean(segment));
}

function transportSegmentTitle(block: string, type: "flight" | "train", index: number): string {
  const service = extractLabeledValue(block, [type === "flight" ? "flight" : "train"]);
  const heading = block.split("\n").map((line) => line.trim()).find((line) => /outbound|return|flight|train/i.test(line) && !line.includes(":"));
  return [heading, service].filter(Boolean).join(" ") || `${bookingTypeLabel(type)} ${index + 1}`;
}

function extractLabeledValue(content: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*(?:date|time|at)?\\s*[:\\-]\\s*([^\\n]{3,90})`, "i").exec(content);
    const value = match?.[1]?.replace(/\s{2,}/g, " ").trim();
    if (value && !/^(date|time|at|from|to)$/i.test(value)) return value.slice(0, 90);
  }
  return undefined;
}

function normalizeBookingDateValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  const match = /\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T　]+(\d{1,2}):(\d{2}))?/.exec(normalized)
    ?? /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})(?:[ T　]+(\d{1,2}):(\d{2}))?/.exec(normalized);
  if (!match) return normalized;
  const year = match[1]!.length === 4 ? match[1] : match[3]!;
  const month = match[1]!.length === 4 ? match[2]! : match[1]!;
  const day = match[1]!.length === 4 ? match[3]! : match[2]!;
  const hour = match[4];
  const minute = match[5];
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return hour && minute ? `${date}T${hour.padStart(2, "0")}:${minute}` : date;
}

function extractProviderName(content: string, sourceLabel: string): string | undefined {
  const fromSubject = /^subject:\s*(.+)$/im.exec(content)?.[1]?.replace(/booking|confirmation|reservation/ig, "").trim();
  if (fromSubject && fromSubject.length >= 2) return fromSubject.slice(0, 80);
  const firstLine = content.split("\n").map((line) => line.trim()).find((line) => line.length >= 3 && line.length <= 80);
  if (firstLine && !/^from:|^to:|^date:/i.test(firstLine)) return firstLine.slice(0, 80);
  const cleanLabel = sourceLabel.replace(/\.(eml|html|txt)$/i, "").trim();
  return cleanLabel && cleanLabel !== "Imported booking confirmation" ? cleanLabel.slice(0, 80) : undefined;
}

function extractConfirmationCode(content: string): string | undefined {
  return /\b(?:confirmation|booking|reservation)\s*(?:number|code|id|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,20})\b/i.exec(content)?.[1];
}

function normalizeConstraintStrength(value: unknown): BookingConstraintStrength {
  return value === "hard" || value === "soft" || value === "ignored" ? value : "soft";
}

function normalizeBookingStatus(value: unknown): TravelBookingStatus {
  return value === "pending" || value === "confirmed" || value === "cancelled" || value === "needs_review" ? value : "needs_review";
}

function normalizeBookingType(value: unknown): TravelBookingType {
  return value === "accommodation" || value === "flight" || value === "train" || value === "rental_car" || value === "event" || value === "tour" || value === "ticket" || value === "restaurant" || value === "other" ? value : "other";
}

function normalizeSegmentType(value: unknown): BookingSegment["segmentType"] {
  return value === "flight_leg" || value === "train_leg" || value === "hotel_stay" || value === "rental_pickup" || value === "rental_return" || value === "event_window" || value === "other" ? value : "other";
}

function segmentHasStructuralAnchor(segment: BookingSegment): boolean {
  return Boolean((segment.startAtLocal || segment.endAtLocal) && (segment.location || segment.origin || segment.destination));
}

function fallbackSegment(title: string): BookingSegment {
  return { id: randomUUID(), segmentType: "other", title: title || "Imported booking", status: "needs_review", constraintStrength: "soft", fixedCommitment: false, needsReviewReasons: ["Booking details need review."] };
}

function bookingTitleFromSegments(segments: BookingSegment[]): string {
  return segments[0]?.title || "Imported booking";
}

function bookingTypeLabel(type: TravelBookingType): string {
  return type === "accommodation" ? "Accommodation booking"
    : type === "flight" ? "Flight booking"
      : type === "train" ? "Train booking"
        : type === "rental_car" ? "Rental car booking"
          : type === "restaurant" ? "Restaurant booking"
            : type === "event" ? "Event booking"
              : type === "tour" ? "Tour booking"
                : type === "ticket" ? "Ticket booking" : "Booking";
}

function selectedRuntimeAdapter(kind: AgentRuntimeKind): CodexRuntimeAdapter | ClaudeCodeRuntimeAdapter {
  return kind === "claude-code" ? claudeCode : codex;
}

function publicGenerationJob(job: PlanGenerationJob) {
  const { controller: _controller, ...safe } = job;
  return safe;
}

function publicPersistedGeneration(generation: BlueprintGeneration) {
  return {
    runId: generation.generationKey,
    sessionId: generation.proposalRef.sessionId,
    generationKey: generation.generationKey,
    stage: generation.stage,
    status: generation.status === "completed" ? "succeeded" : generation.status,
    startedAt: generation.createdAt,
    updatedAt: generation.updatedAt,
    ...(generation.failure ? { failureCode: generation.failure.code, message: generation.failure.issues[0]?.message } : {})
  };
}

function updateGenerationJob(job: PlanGenerationJob, update: Partial<Pick<PlanGenerationJob, "stage" | "status" | "scopeLabel" | "savedPlaceCount" | "failureCode" | "message">>) {
  Object.assign(job, update, { updatedAt: new Date().toISOString() });
}

const INTERACTIVE_TRIP_PLANNER_SKILL = { skillId: "interactive-trip-planner", skillVersion: "0.2.0" } as const;

function blueprintGenerationKey(sessionId: string, proposalVersion: number): string {
  return `${sessionId}:${proposalVersion}:${INTERACTIVE_TRIP_PLANNER_SKILL.skillId}@${INTERACTIVE_TRIP_PLANNER_SKILL.skillVersion}`;
}

function enqueuePlanningSessionGeneration(session: PlanningSession, workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>): PlanGenerationJob {
  if (!session.confirmedProposalVersion) throw new Error("A confirmed Proposal version is required before Blueprint generation.");
  const existing = planningGenerationJobs.get(session.id);
  if (existing?.status === "running") return existing;
  const controller = new AbortController();
  const run = store.startPlanGenerationRun({ runtimeKind: "codex", trigger: "web" });
  const now = new Date().toISOString();
  const generationKey = blueprintGenerationKey(session.id, session.confirmedProposalVersion);
  const persisted = store.getBlueprintGeneration(generationKey);
  const generation = store.saveBlueprintGeneration({
    generationKey,
    proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion },
    skillLineage: INTERACTIVE_TRIP_PLANNER_SKILL,
    status: "running",
    stage: persisted?.stage === "ready" ? "compile" : persisted?.stage ?? "queued",
    ...(persisted?.researchSetId ? { researchSetId: persisted.researchSetId } : {}),
    ...(persisted?.blueprintId ? { blueprintId: persisted.blueprintId } : {}),
    ...(persisted?.blueprintVersion ? { blueprintVersion: persisted.blueprintVersion } : {}),
    createdAt: persisted?.createdAt ?? now,
    updatedAt: now
  });
  const job: PlanGenerationJob = { runId: run.id, sessionId: session.id, generationKey, stage: generation.stage, status: "running", startedAt: generation.createdAt, updatedAt: now, controller };
  planningGenerationJobs.set(session.id, job);
  store.updatePlanningSessionStatus(session.id, "generating");
  const savedPlaceCount = store.getResearchSetByGenerationKey(generationKey)?.places.length;
  appendGenerationEvent(generationKey, generation.stage, "running", persisted ? "Resuming from the latest saved generation checkpoint." : "Confirmed proposal queued for Skill generation.", {
    ...(savedPlaceCount === undefined ? {} : { savedPlaceCount }),
    nextAction: generation.stage === "queued" ? "Start geographic place research." : "Continue from the saved checkpoint."
  });
  void executePlanningSessionGeneration(job, session, workspace);
  return job;
}

async function executePlanningSessionGeneration(job: PlanGenerationJob, session: PlanningSession, workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>) {
  try {
    if (workspace.runtime.selectedKind !== "codex") throw new RuntimeAdapterError("skill_unavailable", "The Interactive Trip Planner Skill is required for this generation path. Select Codex and try again; Landi will not fall back to the generic Plan Agent.");
    const sessionBookings = store.listTravelBookingsForPlanningSession(session.id);
    const bookingConstraints = blueprintBookingConstraintsFromTravelBookings(sessionBookings);
    const request = planningRequestForGenerationWithBookings(session, sessionBookings);
    const profile = {
      preferredLanguage: workspace.profile.preferredLanguage,
      nationality: workspace.profile.nationality,
      gender: workspace.profile.gender,
      immigrationStatus: workspace.profile.immigrationStatus
    };
    const scopes = planningResearchScopes(session);
    let research = store.getResearchSetByGenerationKey(job.generationKey);
    const completedScopes = new Set(research?.batches.filter((batch) => batch.status === "completed").map((batch) => batch.scopeLabel) ?? []);
    for (const [index, scopeLabel] of scopes.entries()) {
      if (completedScopes.has(scopeLabel)) continue;
      assertGenerationNotCancelled(job, session);
      updateGenerationJob(job, { stage: "research", scopeLabel, savedPlaceCount: research?.places.length ?? 0, message: `Researching ${scopeLabel}.` });
      updatePersistedGeneration(job.generationKey, "research", "running");
      appendGenerationEvent(job.generationKey, "research", "running", `Started Skill research for ${scopeLabel}.`, {
        scopeLabel,
        savedPlaceCount: research?.places.length ?? 0,
        nextAction: "Save this geographic batch before continuing."
      });
      const artifact = await withSingleTransientRetry(
        () => codex.generateSkillResearchBatch({ request, batch: { id: `scope-${index + 1}`, scopeLabel }, signal: job.controller.signal, profile }),
        () => appendGenerationEvent(job.generationKey, "research", "running", `Transient research failure for ${scopeLabel}; retrying this batch once.`, { scopeLabel, savedPlaceCount: research?.places.length ?? 0 })
      );
      assertGenerationNotCancelled(job, session);
      const checkpointTime = new Date().toISOString();
      const incoming = importSkillResearchBatches([artifact], {
        researchSetId: research?.id ?? `research-${randomUUID()}`,
        generationKey: job.generationKey,
        proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
        skillLineage: INTERACTIVE_TRIP_PLANNER_SKILL,
        createdAt: research?.createdAt ?? checkpointTime,
        updatedAt: checkpointTime
      });
      const remaining = scopes.slice(index + 1).some((scope) => !completedScopes.has(scope));
      research = mergeResearchSetCheckpoint(research, incoming, { status: remaining ? "researching" : "completed", updatedAt: checkpointTime });
      research = store.saveResearchSet(research);
      completedScopes.add(scopeLabel);
      updateGenerationJob(job, { savedPlaceCount: research.places.length, message: `Saved ${research.places.length} researched places.` });
      appendGenerationEvent(job.generationKey, "research", "running", `Saved ${scopeLabel} research checkpoint.`, {
        scopeLabel,
        savedPlaceCount: research.places.length,
        nextAction: remaining ? "Research the next geographic batch." : "Build the itinerary from the complete Research Set."
      });
    }
    if (!research) throw new Error("The Skill did not produce a Research Set.");
    if (research.status !== "completed") {
      research = store.saveResearchSet({ ...research, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    assertGenerationNotCancelled(job, session);
    let blueprint = store.getTripBlueprintByGenerationKey(job.generationKey);
    if (!blueprint) {
      updateGenerationJob(job, { stage: "itinerary", scopeLabel: undefined, savedPlaceCount: research.places.length, message: "Building the daily itinerary from saved places." });
      updatePersistedGeneration(job.generationKey, "itinerary", "running");
      appendGenerationEvent(job.generationKey, "itinerary", "running", "Started Skill itinerary generation from the complete Research Set.", { savedPlaceCount: research.places.length, nextAction: "Publish the Trip Blueprint after structural validation." });
      const artifact = await withSingleTransientRetry(
        () => codex.generateSkillItinerary({ request, research, signal: job.controller.signal, profile }),
        () => appendGenerationEvent(job.generationKey, "itinerary", "running", "Transient itinerary failure; retrying this stage once.", { savedPlaceCount: research!.places.length })
      );
      assertGenerationNotCancelled(job, session);
      updateGenerationJob(job, { stage: "import", message: "Validating and publishing the Trip Blueprint." });
      updatePersistedGeneration(job.generationKey, "import", "running");
      const createdAt = new Date().toISOString();
      blueprint = importSkillItinerary(research, artifact, { blueprintId: `blueprint-${randomUUID()}`, blueprintVersion: 1, createdAt, bookingConstraints });
      blueprint = store.saveTripBlueprint(blueprint);
      appendGenerationEvent(job.generationKey, "import", "running", "Trip Blueprint published with every Research Set place preserved.", { savedPlaceCount: blueprint.places.length, nextAction: "Compile deterministic execution work for review." });
    }
    if (bookingConstraints.length && JSON.stringify(blueprint.bookingConstraints ?? []) !== JSON.stringify(bookingConstraints)) {
      blueprint = store.saveTripBlueprint({ ...blueprint, bookingConstraints });
    }
    if (store.getPlanningSessionById(session.id)?.status === "abandoned" || job.controller.signal.aborted) throw new RuntimeAdapterError("cancelled", "Plan generation was cancelled.");
    updateGenerationJob(job, { stage: "compile", scopeLabel: undefined, savedPlaceCount: blueprint.places.length, message: "Compiling deterministic Plan tasks." });
    updatePersistedGeneration(job.generationKey, "compile", "running");
    appendGenerationEvent(job.generationKey, "compile", "running", "Compiling the published Blueprint without an AI repair pass.", { savedPlaceCount: blueprint.places.length, nextAction: "Save the reviewable Draft Plan and lineage atomically." });
    const completedRequirementIds = completedBlueprintRequirementIds(workspace);
    const compilation = compileTripBlueprint(blueprint, { createdAt: new Date().toISOString(), completedRequirementIds });
    const partySize = planningPartySize(session);
    const transportPreference = planningTransportPreference(session);
    const expectedArrivalAtLocal = planningArrivalLocalDateTime(session);
    if (partySize) compilation.plan.configuration.travelContext.partySize = partySize;
    if (transportPreference) compilation.plan.configuration.transport.preference = transportPreference;
    if (expectedArrivalAtLocal) compilation.plan.configuration.arrival.expectedAtLocal = expectedArrivalAtLocal;
    assertGenerationNotCancelled(job, session);
    const generatedWorkspace = store.createCompiledBlueprintPlan(compilation, "codex");
    promotePlanningBookingsToPlan(session.id, generatedWorkspace.activePlan.id, generatedWorkspace.activePlan.version);
    store.updatePlanningSessionStatus(session.id, "draft_ready", generatedWorkspace.activePlan.id);
    store.finishPlanGenerationRun({ runId: job.runId, status: "succeeded", outputPlanId: generatedWorkspace.activePlan.id });
    appendGenerationEvent(job.generationKey, "ready", "completed", "Trip Blueprint and Draft Plan are ready for review. No execution has started.", { savedPlaceCount: blueprint.places.length, nextAction: "Review the complete itinerary and confirm the Draft Plan when ready." });
    updateGenerationJob(job, { stage: "ready", status: "succeeded", message: "The complete Trip Blueprint and Draft Plan are ready for review." });
  } catch (error) {
    const failedStage: BlueprintGenerationStage = job.stage === "failed" || job.stage === "cancelled" ? "queued" : job.stage;
    const failureCode = planGenerationFailureCode(error);
    const cancelled = failureCode === "cancelled";
    const superseded = failureCode === "superseded";
    try { store.finishPlanGenerationRun({ runId: job.runId, status: "failed", failureCode }); } catch { /* The run may already have been recovered or cancelled. */ }
    try {
      const current = store.getPlanningSessionById(session.id);
      if (current && current.confirmedProposalVersion === session.confirmedProposalVersion && current.status !== "abandoned" && (current.status === "generating" || current.status === "proposal_confirmed")) store.updatePlanningSessionStatus(session.id, "proposal_ready");
    } catch { /* Preserve the generation failure. */ }
    const failureMessage = superseded ? "A newer proposal replaced this generation. Its saved checkpoints remain read-only." : cancelled ? "Plan generation was cancelled. Saved checkpoints remain available." : error instanceof Error ? error.message : "Plan generation failed.";
    try {
      const persisted = store.getBlueprintGeneration(job.generationKey);
      if (persisted) store.saveBlueprintGeneration({
        ...persisted,
        status: superseded ? "superseded" : cancelled ? "cancelled" : "failed",
        stage: failedStage,
        failure: { code: failureCode, stage: failedStage, issues: [{ path: generationFailurePath(error, failedStage), code: failureCode, message: failureMessage }], resumable: true },
        updatedAt: new Date().toISOString()
      });
      appendGenerationEvent(job.generationKey, failedStage, superseded ? "superseded" : cancelled ? "cancelled" : "failed", failureMessage, {
        scopeLabel: job.scopeLabel,
        savedPlaceCount: store.getResearchSetByGenerationKey(job.generationKey)?.places.length ?? 0,
        nextAction: superseded ? "Continue with the newer confirmed proposal." : cancelled ? "Resume this confirmed proposal when ready." : "Retry generation to resume from the latest saved checkpoint."
      });
    } catch { /* Preserve the original failure even if diagnostics cannot be persisted. */ }
    updateGenerationJob(job, { stage: cancelled || superseded ? "cancelled" : "failed", status: cancelled || superseded ? "cancelled" : "failed", failureCode, message: failureMessage });
    server.log.error({ runId: job.runId, sessionId: session.id, stage: failedStage, failureCode, message: error instanceof Error ? error.message : "Unknown generation error", diagnostic: errorDiagnostic(error) }, "Plan generation failed");
  } finally {
    generatingPlan = false;
  }
}

function updatePersistedGeneration(generationKey: string, stage: BlueprintGenerationStage, status: BlueprintGeneration["status"]) {
  const current = store.getBlueprintGeneration(generationKey);
  if (!current) throw new Error("Blueprint Generation checkpoint is missing.");
  const { failure: _failure, ...withoutFailure } = current;
  store.saveBlueprintGeneration({ ...withoutFailure, stage, status, updatedAt: new Date().toISOString() });
}

function appendGenerationEvent(generationKey: string, stage: BlueprintGenerationStage, status: BlueprintGeneration["status"], detail: string, optional: { scopeLabel?: string | undefined; savedPlaceCount?: number; nextAction?: string } = {}) {
  store.appendBlueprintGenerationEvent({
    generationKey,
    stage,
    status,
    detail,
    createdAt: new Date().toISOString(),
    ...(optional.scopeLabel === undefined ? {} : { scopeLabel: optional.scopeLabel }),
    ...(optional.savedPlaceCount === undefined ? {} : { savedPlaceCount: optional.savedPlaceCount }),
    ...(optional.nextAction === undefined ? {} : { nextAction: optional.nextAction })
  });
}

function assertGenerationNotCancelled(job: PlanGenerationJob, session: PlanningSession) {
  const current = store.getPlanningSessionById(session.id);
  if (job.controller.signal.aborted || current?.status === "abandoned") throw new RuntimeAdapterError("cancelled", "Plan generation was cancelled.");
  if (current?.confirmedProposalVersion !== session.confirmedProposalVersion) throw new RuntimeAdapterError("superseded", "A newer proposal replaced this Blueprint Generation.");
}

async function withSingleTransientRetry<T>(operation: () => Promise<T>, onRetry: () => void): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof RuntimeAdapterError) || !["timed_out", "run_failed"].includes(error.code)) throw error;
    onRetry();
    return operation();
  }
}

function completedBlueprintRequirementIds(workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>): string[] {
  return [workspace.activePlan, workspace.executionPlan]
    .filter((plan): plan is Plan => Boolean(plan))
    .flatMap((plan) => plan.stages.flatMap((stage) => stage.tasks))
    .filter((task) => task.status === "completed" && Boolean(task.requirementId))
    .map((task) => task.requirementId!);
}

function generationFailurePath(error: unknown, stage: BlueprintGenerationStage): string {
  if (error instanceof Error && /day|movement|place|source|requirement|blueprint|research/i.test(error.message)) return `${stage}.contract`;
  return stage;
}

function markPersistedGenerationCancelled(generationKey: string, message: string) {
  const current = store.getBlueprintGeneration(generationKey);
  if (!current || current.status === "completed") return;
  store.saveBlueprintGeneration({ ...current, status: "cancelled", failure: { code: "cancelled", stage: current.stage, issues: [{ path: current.stage, code: "cancelled", message }], resumable: true }, updatedAt: new Date().toISOString() });
  appendGenerationEvent(generationKey, current.stage, "cancelled", message, { savedPlaceCount: store.getResearchSetByGenerationKey(generationKey)?.places.length ?? 0, nextAction: "Resume this confirmed proposal when ready." });
}

function planGenerationFailureCode(error: unknown): string {
  return error instanceof RuntimeAdapterError ? error.code : "generation_failed";
}

function errorDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof Error) || !(error.cause instanceof Error)) return undefined;
  return error.cause.message.slice(0, 500);
}

const port = Number(process.env.C_ASSISTANT_PORT ?? 8787);
const host = process.env.C_ASSISTANT_HOST ?? "127.0.0.1";

try {
  await server.listen({ port, host });
} catch (error) {
  store.close();
  throw error;
}
const interruptedGenerationRecovery = store.recoverInterruptedPlanGenerations();
if (interruptedGenerationRecovery.runs || interruptedGenerationRecovery.sessions) {
  server.log.warn({ interruptedGenerationRecovery }, "Recovered interrupted Plan generation state");
}
const telegramPollTimer = setInterval(() => void pollTelegram(), 1_000);
const arrivalReminderTimer = setInterval(() => void runArrivalReminder(), 15_000);
const routeHandoffGuidanceTimer = setInterval(() => void runRouteHandoffGuidance(), 15_000);
const taskReminderTimer = setInterval(() => void runTaskReminders(), 15_000);
const itineraryDepartureReminderTimer = setInterval(() => void runItineraryDepartureReminders(), 60_000);
const planWeatherTimer = setInterval(() => void runPlanWeatherMonitor(), 20 * 60_000);
const planVenueTimer = setInterval(() => void runPlanVenueMonitor(), 6 * 60 * 60_000);
const arrivalLocationPromptTimer = setInterval(() => void runArrivalLocationPrompt(), 15_000);
void pollTelegram();
void runArrivalReminder();
void runRouteHandoffGuidance();
void runTaskReminders();
void runItineraryDepartureReminders();
startActivePlanMonitoring();
void runArrivalLocationPrompt();

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(telegramPollTimer);
    clearInterval(arrivalReminderTimer);
    clearInterval(routeHandoffGuidanceTimer);
    clearInterval(taskReminderTimer);
    clearInterval(itineraryDepartureReminderTimer);
    clearInterval(planWeatherTimer);
    clearInterval(planVenueTimer);
    clearInterval(arrivalLocationPromptTimer);
    for (const job of planningGenerationJobs.values()) if (job.status === "running") job.controller.abort();
    void server.close().finally(() => {
      store.close();
      process.exit(0);
    });
  });
}
