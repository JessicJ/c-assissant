import type { GenerationAdmission } from './generation-admission.js';
import { MahCarrierError } from './mah-generation-contract.js';
import { MahBusinessTaskReadbackError } from './mah-business-gateway.js';
import { MahBusinessContractError } from './mah-business-contract.js';
import { planOperationError, planOperationRouteOptions, planOperationRejection } from "./plan-operation-error.js";
import { WorkspaceMutationError } from "@c-assistant/core";
import { productionReadiness } from "./production-readiness.js";
import type { BusinessRuntime } from "./agent-work-contract.js";
import { AgentExecutionBlocked } from "./agent-work-contract.js";
import { AgentWorkError } from "@c-assistant/storage";
import { personalityMessage } from "./personality-messages.js";
import type { FastifyInstance } from "fastify";
import { RuntimeAdapterError, type CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import { prepareDirectBlueprintAssistedReplanningHandoff, type DirectBlueprintAssistedReplanningHandoff, type PlanChangeImpactPreview, type TripBlueprint } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { previewPlanChange } from "./plan-change-impact.js";
import { applyAgentPlanningTurn, prepareConfirmedPlanningSession } from "./planning-session.js";
import { planningGenerationReuse } from "./planning-session-generation.js";
import { assistedBlueprintReplan } from "./assisted-blueprint-replanning.js";
import { missingGenerationQuestions, missingQuestions } from "./planning-session-facts.js";
import { parseWebAgentTurn } from "./web-agent.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import type { MahPlanningConversationService } from "./mah-planning-conversation.js";
import type { RuntimeServices } from "./runtime-services-contract.js";
import { isIsolatedGenerationRuntimeServices } from "./runtime-services.js";


type WebAgentRouteDependencies = {
  store: SqliteWorkspaceStore;
  blueprintGenerationEnabled: boolean;
  itineraryContentReview?: (request: Parameters<CodexRuntimeAdapter["reviewSkillItinerary"]>[0]) => ReturnType<CodexRuntimeAdapter["reviewSkillItinerary"]>;
  generation: PlanningGenerationService;
  generationAdmission?: GenerationAdmission;
  getGeneratingPlan: () => boolean;
  setGeneratingPlan: (running: boolean) => void;
  business: BusinessRuntime;
  planningConversation?: MahPlanningConversationService;
  prepareGeneratedPlanEvidence: (planId: string) => Promise<{ workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>; status: "verified" | "partial" }>;
};

export function registerWebAgentRoutes(server: FastifyInstance, dependencies: WebAgentRouteDependencies): void {
  registerRoutes(server, dependencies, false);
}

/** 隔离服务身份由内部工厂持有，不能由请求或配置反序列化取得。 */
export function registerIsolatedGenerationWebAgentRoutes(server: FastifyInstance, dependencies: WebAgentRouteDependencies, services: RuntimeServices): void {
  if (!isIsolatedGenerationRuntimeServices(services) || dependencies.generation !== services.planningGeneration
    || dependencies.business !== services.business) throw new Error("隔离生成服务的组合身份不一致。");
  registerRoutes(server, dependencies, true);
}

function registerRoutes(server: FastifyInstance, dependencies: WebAgentRouteDependencies, isolatedGeneration: boolean): void {
  const {
    store,
    blueprintGenerationEnabled,
    generation,
    getGeneratingPlan,
    setGeneratingPlan,
    business,
    prepareGeneratedPlanEvidence
  } = dependencies;

  server.post<{ Body: unknown }>("/api/agent/chat", planOperationRouteOptions, async (request, reply) => {
    let turn: ReturnType<typeof parseWebAgentTurn>;
    try {
      turn = parseWebAgentTurn(request.body);
    } catch (error) {
      return reply.code(planOperationError(error).status).send(planOperationError(error).body);
    }
    if (getGeneratingPlan()) return reply.code(409).send(planOperationRejection("generation_busy"));

    if (turn.mode === "new_plan") {
      let saved: ReturnType<SqliteWorkspaceStore['savePlanningMessage']> | undefined;
      try {
        const body = request.body as Record<string, unknown>;
        if (Object.keys(body).some(key => !['mode', 'message', 'sessionId', 'messageId', 'expectedRevision', 'checkResultOnly'].includes(key))
          || (body.checkResultOnly !== undefined && typeof body.checkResultOnly !== 'boolean')) {
          return reply.code(400).send({ code: 'planning_request_invalid', error: 'Refresh the workspace before submitting this request.' });
        }
        if (typeof body.messageId !== "string" || !Number.isSafeInteger(body.expectedRevision) || (body.sessionId !== undefined && typeof body.sessionId !== "string")) return reply.code(409).send({ error: "Refresh the workspace before saving these requirements.", code: "planning_identity_required" });
        if (body.checkResultOnly === true) {
          const receipt = typeof body.sessionId === 'string' ? store.readPlanningMessageReceipt(body.sessionId, body.messageId) : null;
          const original = receipt ? store.getPlanningSessionById(receipt.sessionId)?.messages.find(item => item.id === receipt.messageId && item.role === 'user') : undefined;
          const work = receipt ? store.agentWork.findByScope({ kind: 'conversation', sessionId: receipt.sessionId,
            messageId: receipt.messageId, revision: receipt.savedRevision }) : undefined;
          if (!receipt || !original || original.text !== turn.message || receipt.expectedRevision !== body.expectedRevision || !work) {
            throw new AgentWorkError('planning_work_identity_invalid');
          }
        }
        saved = store.savePlanningMessage({ messageId: body.messageId, expectedRevision: body.expectedRevision as number, text: turn.message, ...(typeof body.sessionId === "string" ? { sessionId: body.sessionId } : {}) });
        const saveReceipt = { sessionId: saved.session.id, messageId: body.messageId, expectedRevision: body.expectedRevision as number, savedRevision: saved.savedRevision };
        if (dependencies.planningConversation) {
          return { ...await dependencies.planningConversation.continueSavedMessage(saved, body.messageId, body.checkResultOnly === true), requirementsSaved: true, saveReceipt };
        }
        const work = store.agentWork.prepare({ kind: "conversation", sessionId: saved.session.id, messageId: body.messageId, revision: saved.savedRevision }, { sessionId: saved.session.id, messageId: body.messageId, revision: saved.savedRevision });
        if (work.status === "prepared") store.agentWork.transition(work.workId, "blocked");
        return {
          workspace: store.getWorkspace(), planningSession: saved.session, planningStatus: saved.session.status,
          planningRevision: saved.revision, savedRevision: saved.savedRevision, reused: saved.reused,
          requirementsSaved: true, saveReceipt, generated: false, blocked: true, code: "public_mah_contract_missing",
          reply: "Requirements saved. MAH integration is not ready, so Agent processing and plan generation have not started."
        };
      } catch (error) {
        if (saved) {
          const body = request.body as Record<string, unknown>;
          if (dependencies.planningConversation && error instanceof MahBusinessContractError) {
            const work = store.agentWork.findByScope({ kind: 'conversation', sessionId: saved.session.id,
              messageId: String(body.messageId), revision: saved.savedRevision });
            const observed = error instanceof MahBusinessTaskReadbackError
              ? [...error.observations].reverse().find(item => item.taskId === work?.carrierTaskId && item.projectMatched) : undefined;
            const received = Boolean(observed);
            const replyText = received
              ? observed?.status === 'failed'
                ? 'Requirements saved. MAH received the request, but its task failed before a verified planning result was returned.'
                : 'Requirements saved. MAH received the request. A verified planning result is not available yet.'
              : 'Requirements saved. MAH task receipt or its planning result could not be verified. Keep this request to check its status.';
            return { workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(saved.session.id),
              planningStatus: saved.session.status, planningRevision: store.getPlanningRevision(saved.session.id),
              savedRevision: saved.savedRevision, requirementsSaved: true,
              saveReceipt: { sessionId: saved.session.id, messageId: body.messageId, expectedRevision: body.expectedRevision, savedRevision: saved.savedRevision },
              generated: false, blocked: true, processingPending: Boolean(observed && ['active', 'queued', 'running'].includes(observed.status ?? '')),
              processingCode: error.code,
              ...(work ? { mahTask: { taskId: work.carrierTaskId, received, status: observed?.status ?? 'unverified' } } : {}),
              reply: replyText };
          }
          return reply.code(503).send({ requirementsSaved: true,
            saveReceipt: { sessionId: saved.session.id, messageId: body.messageId, expectedRevision: body.expectedRevision, savedRevision: saved.savedRevision },
            planningRevision: saved.revision, savedRevision: saved.savedRevision, generated: false,
            code: "planning_processing_unverified", error: "Requirements saved. The subsequent processing status could not be verified." });
        }
        return reply.code(error instanceof AgentWorkError ? 409 : 400).send({ error: error instanceof AgentWorkError ? "The planning session changed. Refresh the workspace; your existing requirements are preserved." : "Unable to save these requirements.", code: error instanceof AgentWorkError ? error.code : "planning_save_failed" });
      }
    }

    setGeneratingPlan(true);
    let runId: string | undefined;
    try {
      const workspace = store.getWorkspace();
      if (workspace.profile.status !== "ready") return reply.code(409).send(planOperationRejection("profile_required"));
      let changeImpact: PlanChangeImpactPreview | undefined;
      let assistedHandoff: DirectBlueprintAssistedReplanningHandoff | undefined;
      if (turn.mode === "revise_plan") {
        if (turn.expectedPlanId !== workspace.activePlan.id || turn.expectedVersion !== workspace.activePlan.version) return reply.code(409).send(planOperationRejection("version_conflict"));
        if (workspace.activeBlueprint) {
          if (turn.assistedReplanning) {
            try {
              assistedHandoff = validateAssistedBlueprintHandoff(workspace.activeBlueprint, turn.assistedReplanning, turn.message);
            } catch (error) {
              const failure = planOperationError(error); return reply.code(failure.status).send(failure.body);
            }
            changeImpact = blueprintAssistedReplanningImpact(workspace.activePlan.id, workspace.activePlan.version, assistedHandoff);
          } else {
            changeImpact = previewPlanChange(workspace.activePlan, turn.message);
            if (changeImpact.requiresConfirmation && !turn.impactConfirmed) return reply.code(409).send({ code: "high_impact_confirmation_required", error: "This high-impact Plan change needs explicit confirmation before replanning.", impactPreview: changeImpact });
          }
        } else {
          changeImpact = previewPlanChange(workspace.activePlan, turn.message);
          if (changeImpact.requiresConfirmation && !turn.impactConfirmed) return reply.code(409).send({ code: "high_impact_confirmation_required", error: "This high-impact Plan change needs explicit confirmation before replanning.", impactPreview: changeImpact });
        }
      }
      if (!workspace.activeBlueprint) return reply.code(409).send({ code: "legacy_plan_conversion_required", error: "This saved plan needs a reviewed conversion before AI editing. Its data and current version are preserved." });
      runId = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "web" }).id;
      if (workspace.activeBlueprint) {
        const runtime = business;
        if (!("generateSkillItinerary" in runtime) || typeof runtime.generateSkillItinerary !== "function") throw new Error("Blueprint itinerary editing is unavailable right now. The current plan is unchanged.");
        const session = store.getPlanningSessionById(workspace.activeBlueprint.proposalRef.sessionId);
        if (!session) throw new Error("The saved planning details are unavailable. The current plan is unchanged.");
        let updated = await assistedBlueprintReplan({
          store, runtime, base: workspace.activeBlueprint, session,
          request: assistedHandoff?.request ?? turn.message,
          profile: { assistantPersonality: workspace.profile.assistantPersonality ?? "local_insider", displayName: workspace.profile.displayName, preferredLanguage: "English", nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus },
          expectedPlanId: workspace.activePlan.id, expectedPlanVersion: workspace.activePlan.version,
          ...(dependencies.itineraryContentReview ? { reviewContent: dependencies.itineraryContentReview } : {}),
          ...(assistedHandoff ? { handoff: assistedHandoff } : {})
        });
        let evidenceStatus: "verified" | "partial" = "partial";
        try {
          const evidence = await prepareGeneratedPlanEvidence(updated.activePlan.id);
          updated = evidence.workspace;
          evidenceStatus = evidence.status;
        } catch { /* The saved itinerary remains reviewable when optional source enrichment fails. */ }
        store.finishPlanGenerationRun({ runId, status: "succeeded", outputPlanId: updated.activePlan.id });
        return { reply: personalityMessage("The updated itinerary is saved as a draft. Review it before activation.", workspace.profile), workspace: updated, readyForReview: true, evidenceStatus };
      }

    } catch (error) {
      if (runId) store.finishPlanGenerationRun({ runId, status: "failed", failureCode: generation.planGenerationFailureCode(error) });
      if (error instanceof AgentExecutionBlocked) return reply.code(503).send({ code: error.code, error: "Travel planning is temporarily unavailable. Your saved trip details and current itinerary are retained." });
      if (error instanceof RuntimeAdapterError) return reply.code(runtimeErrorStatusCode(error)).send({ code: error.code, error: "Travel planning did not finish. Check the service status before continuing. Your current itinerary is retained." });
      const failure = planOperationError(error); return reply.code(failure.status).send(failure.body);
    } finally {
      setGeneratingPlan(false);
    }
  });

  server.post<{ Params: { sessionId: string }; Body: { proposalVersion?: number; expectedRevision?: number } }>("/api/planning-sessions/:sessionId/confirm", async (request, reply) => {
    if (!blueprintGenerationEnabled) return reply.code(503).send({ error: "Blueprint generation is disabled for this local instance. Landi will not fall back to the legacy Plan generator." });
    if (dependencies.generationAdmission) {
      const { expectedRevision, proposalVersion } = request.body ?? {};
      if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0 || !Number.isSafeInteger(proposalVersion)
        || Object.keys(request.body ?? {}).some(key => !['expectedRevision', 'proposalVersion'].includes(key))) {
        return reply.code(400).send({ code: 'generation_identity_required', error: 'Confirm the current saved proposal and revision.' });
      }
      try {
        await dependencies.generationAdmission.authorize({ sessionId: request.params.sessionId,
          revision: expectedRevision!, proposalVersion: proposalVersion! });
      } catch (error) {
        return reply.code(error instanceof MahCarrierError && error.code === 'generation_identity_changed' ? 409 : 503)
          .send({ code: error instanceof MahCarrierError ? error.code : 'generation_submission_unverified', error: 'This saved proposal cannot be submitted for generation right now.' });
      }
    }
    if (!dependencies.generationAdmission && !isolatedGeneration && !productionReadiness().generation) return reply.code(503).send({ code: "public_mah_contract_unverified", error: "MAH generation is not ready. Your saved requirements are preserved." });
    const existingJob = generation.jobs.get(request.params.sessionId);
    if (existingJob?.status === "running") {
      return reply.code(202).send({
        reply: "This confirmed proposal is already being generated.",
        workspace: store.getWorkspace(),
        planningSession: store.getPlanningSessionById(request.params.sessionId),
        planningStatus: "generating",
        generated: false,
        accepted: true,
        reused: true,
        generation: generation.publicGenerationJob(existingJob)
      });
    }
    if (getGeneratingPlan()) return reply.code(409).send({ error: "Another Plan generation is already running." });
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
      const missing = [...existing.unresolved.filter((item) => item.status === "open"), ...missingQuestions(existing.facts), ...missingGenerationQuestions(existing.facts, existing.messages)];
      if (missing.length) return reply.code(409).send({ error: `Before generating the plan, please confirm: ${missing[0]!.question}` });
      const workspace = current;
      if (workspace.profile.status !== "ready") return reply.code(409).send({ error: "Complete the required Profile basics before creating or revising a Plan." });
      const confirmed = store.confirmPlanningSession(request.params.sessionId, proposalVersion);
      let prepared = prepareConfirmedPlanningSession(confirmed);
      if (prepared.session.unresolved.length) {
        setGeneratingPlan(true);
        try {
          const runtime = business;
          const agentTurn = await runtime.continuePlanningConversation({
            message: `The user has just confirmed the plan direction. Continue naturally and ask only for the single most important missing detail. Reply in English.`,
            session: prepared.session,
            profile: { assistantPersonality: workspace.profile.assistantPersonality ?? "local_insider", displayName: workspace.profile.displayName, preferredLanguage: "English", nationality: workspace.profile.nationality, gender: workspace.profile.gender, immigrationStatus: workspace.profile.immigrationStatus }
          });
          const messages = [...prepared.session.messages];
          const last = messages.at(-1);
          if (last?.role === "assistant") messages[messages.length - 1] = { ...last, text: agentTurn.reply };
          prepared = { reply: agentTurn.reply, session: { ...prepared.session, messages } };
        } catch {
          // Keep the deterministic question only as an availability fallback.
        }
      }
      prepared.reply = personalityMessage(prepared.reply, workspace.profile);
      const lastPreparedReply = prepared.session.messages.at(-1);
      if (lastPreparedReply?.role === "assistant") lastPreparedReply.text = prepared.reply;
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
      setGeneratingPlan(true);
      const job = generation.enqueuePlanningSessionGeneration(prepared.session, workspace);
      backgroundQueued = true;
      return reply.code(202).send({
        reply: personalityMessage("Got it. I have enough to start building the plan.", workspace.profile),
        workspace: store.getWorkspace(),
        planningSession: store.getPlanningSessionById(prepared.session.id),
        planningStatus: "generating",
        generated: false,
        accepted: true,
        generation: generation.publicGenerationJob(job)
      });
    } catch (error) {
      try {
        const session = store.getPlanningSessionById(request.params.sessionId);
        if (session?.status === "generating" || session?.status === "proposal_confirmed") store.updatePlanningSessionStatus(request.params.sessionId, "proposal_ready");
      } catch { /* Preserve the original generation error. */ }
      return reply.code(runtimeErrorStatusCode(error)).send({
        error: error instanceof Error ? error.message : "The selected runtime could not generate a Plan draft."
      });
    } finally {
      if (!backgroundQueued) setGeneratingPlan(false);
    }
  });
}

function runtimeErrorStatusCode(error: unknown): number {
  return error instanceof RuntimeAdapterError && error.code === "timed_out"
    ? 504
    : error instanceof RuntimeAdapterError && (error.code === "not_installed" || error.code === "not_authenticated")
      ? 503
      : 400;
}

function validateAssistedBlueprintHandoff(blueprint: TripBlueprint, handoff: DirectBlueprintAssistedReplanningHandoff, message: string): DirectBlueprintAssistedReplanningHandoff {
  if (handoff.baseBlueprintId !== blueprint.id || handoff.baseBlueprintVersion !== blueprint.version) {
    throw new WorkspaceMutationError("The Trip Blueprint changed before assisted replanning could start. Refresh the workspace and review the latest version.", "version_conflict");
  }
  const prepared = prepareDirectBlueprintAssistedReplanningHandoff(blueprint, {
    replanRequirement: handoff.replanRequirement,
    revisions: handoff.revisions
  });
  if (prepared.request.trim() !== handoff.request.trim() || prepared.request.trim() !== message.trim()) {
    throw new WorkspaceMutationError("The assisted itinerary handoff no longer matches the prepared replanning request.", "request_identity_conflict");
  }
  if (!sameStringSet(prepared.affectedDayIds, handoff.affectedDayIds) || !sameStringSet(prepared.affectedPlaceIds, handoff.affectedPlaceIds)) {
    throw new WorkspaceMutationError("The assisted itinerary handoff no longer matches the affected itinerary scope.", "request_identity_conflict");
  }
  return prepared;
}

function blueprintAssistedReplanningImpact(planId: string, baseVersion: number, handoff: DirectBlueprintAssistedReplanningHandoff): PlanChangeImpactPreview {
  return {
    planId,
    baseVersion,
    impact: "high",
    summary: "This assisted itinerary update creates a replacement draft for the affected Trip Blueprint days.",
    reasons: [
      handoff.replanRequirement.explanation,
      "Landi must recheck route order, timing, meal and rest spacing, and opening constraints before the itinerary is execution-ready."
    ],
    affectedAreas: ["itinerary"],
    requiresConfirmation: false,
    createsReplacementDraft: true
  };
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}
