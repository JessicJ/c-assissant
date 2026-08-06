import cors from "@fastify/cors";
import Fastify from "fastify";
import { confirmPlan, createDemoWorkspace, type WorkspaceSnapshot } from "@c-assistant/core";

const server = Fastify({ logger: true });
let workspace: WorkspaceSnapshot = createDemoWorkspace();

await server.register(cors, { origin: true });

server.get("/health", async () => ({
  status: "ok",
  service: "c-assistant-core",
  mode: "demo"
}));

server.get("/api/workspace", async () => workspace);

server.post<{ Params: { planId: string } }>("/api/plans/:planId/confirm", async (request, reply) => {
  try {
    workspace = confirmPlan(workspace, request.params.planId);
    return workspace;
  } catch (error) {
    return reply.code(404).send({
      error: error instanceof Error ? error.message : "Plan was not found."
    });
  }
});

const port = Number(process.env.C_ASSISTANT_PORT ?? 8787);
const host = process.env.C_ASSISTANT_HOST ?? "127.0.0.1";

await server.listen({ port, host });
