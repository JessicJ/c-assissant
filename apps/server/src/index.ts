import cors from "@fastify/cors";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexRuntimeAdapter, RuntimeAdapterError } from "@c-assistant/agent-adapters";
import { AmapConnector, QWeatherConnector, TelegramConnector } from "@c-assistant/connectors";
import type { CreatePlanInput, ProfileUpdate } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";

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

function connectorResponseStatus(status: "available" | "degraded" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "unsupported"): number {
  if (status === "available") return 200;
  if (status === "not_configured" || status === "unavailable") return 503;
  if (status === "unauthorized") return 401;
  if (status === "rate_limited") return 429;
  return 400;
}

const port = Number(process.env.C_ASSISTANT_PORT ?? 8787);
const host = process.env.C_ASSISTANT_HOST ?? "127.0.0.1";

await server.listen({ port, host });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    store.close();
    void server.close().finally(() => process.exit(0));
  });
}
