import type { GenerationAdmission } from './generation-admission.js';
import { registerPlanningReturnCheckRoute } from "./planning-return-check.js";
import { registerPlanningWorkStatusRoute } from "./planning-work-status.js";
import type { FastifyInstance } from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { PlanningGenerationService } from "./planning-generation-service.js";

export function registerPlanningSessionRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  generation: PlanningGenerationService;
  generationAdmission?: GenerationAdmission;
}): void {
  const { store, generation } = dependencies;

  server.get<{ Params: { sessionId: string }; Querystring: { revision?: string; proposalVersion?: string } }>('/api/planning-sessions/:sessionId/generation-admission', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const revision = Number(request.query.revision), proposalVersion = Number(request.query.proposalVersion);
    if (!/^[0-9]+$/.test(request.query.revision ?? '') || !/^[0-9]+$/.test(request.query.proposalVersion ?? '')
      || !Number.isSafeInteger(revision) || !Number.isSafeInteger(proposalVersion) || proposalVersion < 1
      || Object.keys(request.query).some(key => !['revision', 'proposalVersion'].includes(key))) {
      return reply.code(400).send({ code: 'generation_identity_required' });
    }
    const identity = { sessionId: request.params.sessionId, revision, proposalVersion };
    return dependencies.generationAdmission ? dependencies.generationAdmission.check(identity)
      : { ...identity, ready: false, validUntil: Date.now() + 15000, code: 'public_mah_contract_unverified' };
  });

  registerPlanningReturnCheckRoute(server, store);
  registerPlanningWorkStatusRoute(server, store);

  server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId/revision", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    return session ? { revision: store.getPlanningRevision(session.id) } : reply.code(404).send({ error: "The planning session was not found." });
  });

  server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    return session ?? reply.code(404).send({ error: "The planning session was not found." });
  });

  server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId/generation", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "The planning session was not found." });
    const job = generation.jobs.get(request.params.sessionId);
    const generationKey = session.confirmedProposalVersion ? generation.blueprintGenerationKey(session.id, session.confirmedProposalVersion) : undefined;
    const snapshot = generationKey ? store.getBlueprintGeneration(generationKey) : undefined;
    return {
      sessionStatus: session.status,
      ...(session.outputPlanId ? { outputPlanId: session.outputPlanId } : {}),
      generation: job ? generation.publicGenerationJob(job) : snapshot ? generation.publicPersistedGeneration(snapshot) : null,
      snapshot: snapshot ?? null,
      events: generationKey ? store.getBlueprintGenerationEvents(generationKey) : []
    };
  });

  server.get<{ Params: { sessionId: string }; Querystring: { after?: string } }>("/api/planning-sessions/:sessionId/generation/events", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    if (!session?.confirmedProposalVersion) return reply.code(404).send({ error: "The Blueprint Generation was not found." });
    const generationKey = generation.blueprintGenerationKey(session.id, session.confirmedProposalVersion);
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
    const job = generation.jobs.get(request.params.sessionId);
    const generationKey = session.confirmedProposalVersion ? generation.blueprintGenerationKey(session.id, session.confirmedProposalVersion) : undefined;
    if (job?.status === "running") {
      generation.updateGenerationJob(job, { stage: "cancelled", status: "cancelled", failureCode: "cancelled", message: "Plan generation was cancelled. Saved research remains available." });
      await generation.cancelGeneration(job.generationKey, "Plan generation was cancelled. Saved research remains available.");
      job.controller.abort();
    } else if (generationKey) {
      await generation.cancelGeneration(generationKey, "Plan generation was cancelled. Saved research remains available.");
    }
    if (job && generation.imageContinuations?.has(job.generationKey)) job.controller.abort();
    if (session.status === "generating" || session.status === "proposal_confirmed") store.updatePlanningSessionStatus(session.id, "proposal_ready");
    return { sessionStatus: store.getPlanningSessionById(session.id)?.status, generation: job ? generation.publicGenerationJob(job) : null };
  });

  server.delete<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId", async (request, reply) => {
    try {
      const job = generation.jobs.get(request.params.sessionId);
      if (job?.status === "running") {
        generation.updateGenerationJob(job, { stage: "cancelled", status: "cancelled", failureCode: "cancelled", message: "Plan generation was cancelled. Saved research remains available." });
        await generation.cancelGeneration(job.generationKey, "Plan generation was cancelled. Saved research remains available.");
        job.controller.abort();
      } else {
        const session = store.getPlanningSessionById(request.params.sessionId);
        if (session?.confirmedProposalVersion) await generation.cancelGeneration(generation.blueprintGenerationKey(session.id, session.confirmedProposalVersion), "Plan generation was cancelled. Saved research remains available.");
      }
      if (job && generation.imageContinuations?.has(job.generationKey)) job.controller.abort();
      store.abandonPlanningSession(request.params.sessionId);
      return store.getWorkspace();
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "The planning session could not be abandoned." });
    }
  });
}
