import cors from "@fastify/cors";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AmapConnector } from "@c-assistant/connectors";
import type { CreatePlanInput, ProfileUpdate } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";

const server = Fastify({ logger: true });
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const databasePath = process.env.C_ASSISTANT_DATA_PATH || resolve(projectRoot, "data", "c-assistant.sqlite");
const store = new SqliteWorkspaceStore(databasePath);
const amap = new AmapConnector({ apiKey: process.env.AMAP_API_KEY });

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

server.get<{ Querystring: { query?: string; region?: string } }>("/api/amap/places", async (request, reply) => {
  const result = await amap.searchPlaces({ query: request.query.query ?? "", region: request.query.region });
  return reply.code(result.status === "available" ? 200 : result.status === "not_configured" ? 503 : 400).send(result);
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

const port = Number(process.env.C_ASSISTANT_PORT ?? 8787);
const host = process.env.C_ASSISTANT_HOST ?? "127.0.0.1";

await server.listen({ port, host });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    store.close();
    void server.close().finally(() => process.exit(0));
  });
}
