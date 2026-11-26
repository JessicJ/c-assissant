import type { FastifyInstance } from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { connectorResponseStatus } from "./connector-bundle.js";
import type { DestinationCatalogId, DestinationResolution } from "./destination-research.js";
import type { OfficialSourceService } from "./official-source-service.js";

export function registerOfficialSourceRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  resolvePlanDestination: (planId: string) => Promise<DestinationResolution>;
  sources: Record<DestinationCatalogId, OfficialSourceService>;
}): void {
  const { store, resolvePlanDestination, sources } = dependencies;

  server.get<{ Querystring: { topic?: string } }>("/api/official-sources", async (request, reply) => {
    const current = store.getWorkspace().activePlan;
    const resolution = await resolvePlanDestination(current.id);
    if (resolution.status !== "resolved") return reply.code(422).send({ ...resolution, data: [] });
    return sources[resolution.catalogId].discover(request.query.topic);
  });

  server.post<{ Params: { sourceId: string }; Body: { url?: string } }>("/api/official-sources/:sourceId/refresh", async (request, reply) => {
    const current = store.getWorkspace().activePlan;
    const resolution = await resolvePlanDestination(current.id);
    if (resolution.status !== "resolved") return reply.code(422).send(resolution);
    const result = await sources[resolution.catalogId].refresh({ sourceId: request.params.sourceId, url: request.body?.url });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });
}
