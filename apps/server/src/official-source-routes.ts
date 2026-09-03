import type { FastifyInstance } from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { connectorResponseStatus } from "./connector-bundle.js";
import type { CountryPackId, CountryPackResolution } from "./country-pack-resolver.js";
import type { OfficialSourceService } from "./official-source-service.js";

export function registerOfficialSourceRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  resolvePlanCountryPack: (planId: string) => Promise<CountryPackResolution>;
  sources: Record<CountryPackId, OfficialSourceService>;
}): void {
  const { store, resolvePlanCountryPack, sources } = dependencies;

  server.get<{ Querystring: { topic?: string } }>("/api/official-sources", async (request, reply) => {
    const current = store.getWorkspace().activePlan;
    const resolution = await resolvePlanCountryPack(current.id);
    if (resolution.status !== "resolved") return reply.code(422).send({ ...resolution, data: [] });
    return sources[resolution.countryPackId].discover(request.query.topic);
  });

  server.post<{ Params: { sourceId: string }; Body: { url?: string } }>("/api/official-sources/:sourceId/refresh", async (request, reply) => {
    const current = store.getWorkspace().activePlan;
    const resolution = await resolvePlanCountryPack(current.id);
    if (resolution.status !== "resolved") return reply.code(422).send(resolution);
    const result = await sources[resolution.countryPackId].refresh({ sourceId: request.params.sourceId, url: request.body?.url });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });
}
