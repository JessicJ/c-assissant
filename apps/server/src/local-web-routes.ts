import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import type { ProfileUpdate } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { planOperationRouteOptions } from "./plan-operation-error.js";

const localWebOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

export async function registerLocalWebRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  emailReviewOrigin?: () => string | undefined;
  webAssetsPath: string;
  webTripMapPath: string;
  webIndexPath: string;
  instanceHealth?: {
    service: string;
    protocolVersion: string;
    proof: string;
  };
}) {
  const { store, webAssetsPath, webTripMapPath, webIndexPath } = dependencies;

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
    const host=request.headers.host ?? "";
    const localHost=/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    if(!localHost)return reply.code(403).send({error:"Open the local Landi workspace."});
    if (origin && !localWebOrigin.test(origin)) return reply.code(403).send({ error: "This local instance accepts browser changes only from its local Web workspace." });
  });

  server.get("/", async (_request, reply) => {
    if (!existsSync(webIndexPath)) {
      return reply.code(503).type("text/plain; charset=utf-8").send("The Landi Web workspace has not been built. Run pnpm build first.");
    }
    return reply.type("text/html; charset=utf-8").send(readFileSync(webIndexPath, "utf8"));
  });

  server.get("/health", async () => dependencies.instanceHealth ? {
    status: "ok",
    service: dependencies.instanceHealth.service,
    mode: "local_package",
    protocolVersion: dependencies.instanceHealth.protocolVersion,
    instanceProof: dependencies.instanceHealth.proof
  } : {
    status: "ok",
    service: "c-assistant-core",
    mode: "local"
  });

  server.get("/api/workspace", planOperationRouteOptions, async () => {
    const workspace = store.getWorkspace();
    return workspace;
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
}
