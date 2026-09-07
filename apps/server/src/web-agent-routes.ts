import type { FastifyInstance } from "fastify";
import { RuntimeAdapterError, type ClaudeCodeRuntimeAdapter, type CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import { prepareDirectBlueprintAssistedReplanningHandoff, type AgentRuntimeKind, type DirectBlueprintAssistedReplanningHandoff, type PlanChangeImpactPreview, type TripBlueprint } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { planRefinementState } from "./plan-refinement.js";
import { previewPlanChange } from "./plan-change-impact.js";
import { runtimeName } from "./runtime-display.js";
import { completedTasksForRevision, planDraftForRevision } from "./telegram-plan.js";
import { applyAgentPlanningTurn, prepareConfirmedPlanningSession } from "./planning-session.js";
import { planningGenerationReuse } from "./planning-session-generation.js";
import { assertWebAgentPlanUnchanged, formatWebAgentPlanReply, parseWebAgentTurn } from "./web-agent.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";

type RuntimeAdapter = CodexRuntimeAdapter | ClaudeCodeRuntimeAdapter;

export function registerWebAgentRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  blueprintGenerationEnabled: boolean;
  generation: PlanningGenerationService;
  getGeneratingPlan: () => boolean;
  setGeneratingPlan: (running: boolean) => void;
  selectedRuntimeAdapter: (kind: AgentRuntimeKind) => RuntimeAdapter;
  prepareGeneratedPlanEvidence: (planId: string) => Promise<{ workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>; status: "verified" | "partial" }>;
}): void {
  const {
    store,
    blueprintGenerationEnabled,
    generation,
    getGeneratingPlan,
    setGeneratingPlan,
    selectedRuntimeAdapter,
    prepareGeneratedPlanEvidence
  } = dependencies;

  server.post<{ Body: unknown }>("/api/agent/chat", async (request, reply) => {
    let turn: ReturnType<typeof parseWebAgentTurn>;
    try {
      turn = parseWebAgentTurn(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The Agent request is invalid." });
    }
    if (getGeneratingPlan()) return reply.code(409).send({ error: "The Agent is already working on a Plan. Please wait for that response." });

    if (turn.mode === "new_plan") {
      setGeneratingPlan(true);
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
          const job = generation.enqueuePlanningSessionGeneration(result.session, workspace);
          backgroundQueued = true;
          return reply.code(202).send({ reply: result.reply, workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(result.session.id), planningStatus: "generating", generated: false, accepted: true, generation: generation.publicGenerationJob(job) });
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
        if (!backgroundQueued) setGeneratingPlan(false);
      }
    }

    setGeneratingPlan(true);
    let runId: string | undefined;
    try {
      const workspace = store.getWorkspace();
      if (workspace.profile.status !== "ready") return reply.code(409).send({ error: "Complete the required Profile basics before creating or revising a Plan." });
      let changeImpact: PlanChangeImpactPreview | undefined;
      let assistedHandoff: DirectBlueprintAssistedReplanningHandoff | undefined;
      if (turn.mode === "revise_plan") {
        if (turn.expectedPlanId !== workspace.activePlan.id || turn.expectedVersion !== workspace.activePlan.version) return reply.code(409).send({ error: "The Plan changed before this revision could start. Refresh the workspace and review the latest version." });
        if (workspace.activeBlueprint) {
          if (!turn.assistedReplanning) return reply.code(409).send({
            error: "This Plan is backed by a Trip Blueprint. Use an assisted itinerary handoff for Blueprint-backed replanning so Landi can preserve version and route boundaries."
          });
          try {
            assistedHandoff = validateAssistedBlueprintHandoff(workspace.activeBlueprint, turn.assistedReplanning, turn.message);
          } catch (error) {
            return reply.code(409).send({ error: error instanceof Error ? error.message : "The assisted itinerary handoff no longer matches the current Trip Blueprint." });
          }
          changeImpact = blueprintAssistedReplanningImpact(workspace.activePlan.id, workspace.activePlan.version, assistedHandoff);
        } else {
          changeImpact = previewPlanChange(workspace.activePlan, turn.message);
          if (changeImpact.requiresConfirmation && !turn.impactConfirmed) return reply.code(409).send({ error: "This high-impact Plan change needs explicit confirmation before replanning.", impactPreview: changeImpact });
        }
      }
      runId = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "web" }).id;
      const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
      const draft = await runtime.generatePlanDraft({
        request: assistedHandoff?.request ?? turn.message,
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
      if (runId) store.finishPlanGenerationRun({ runId, status: "failed", failureCode: generation.planGenerationFailureCode(error) });
      return reply.code(runtimeErrorStatusCode(error)).send({
        error: error instanceof Error ? error.message : "The Agent could not respond right now."
      });
    } finally {
      setGeneratingPlan(false);
    }
  });

  server.post<{ Params: { sessionId: string }; Body: { proposalVersion?: number } }>("/api/planning-sessions/:sessionId/confirm", async (request, reply) => {
    if (!blueprintGenerationEnabled) return reply.code(503).send({ error: "Blueprint generation is disabled for this local instance. Landi will not fall back to the legacy Plan generator." });
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
      const workspace = current;
      if (workspace.profile.status !== "ready") return reply.code(409).send({ error: "Complete the required Profile basics before creating or revising a Plan." });
      const confirmed = store.confirmPlanningSession(request.params.sessionId, proposalVersion);
      let prepared = prepareConfirmedPlanningSession(confirmed);
      if (prepared.session.unresolved.length) {
        setGeneratingPlan(true);
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
      setGeneratingPlan(true);
      const job = generation.enqueuePlanningSessionGeneration(prepared.session, workspace);
      backgroundQueued = true;
      return reply.code(202).send({
        reply: "Your details are confirmed. Landi is generating the complete plan now.",
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
    throw new Error("The Trip Blueprint changed before assisted replanning could start. Refresh the workspace and review the latest version.");
  }
  const prepared = prepareDirectBlueprintAssistedReplanningHandoff(blueprint, {
    replanRequirement: handoff.replanRequirement,
    revisions: handoff.revisions
  });
  if (prepared.request.trim() !== handoff.request.trim() || prepared.request.trim() !== message.trim()) {
    throw new Error("The assisted itinerary handoff no longer matches the prepared replanning request.");
  }
  if (!sameStringSet(prepared.affectedDayIds, handoff.affectedDayIds) || !sameStringSet(prepared.affectedPlaceIds, handoff.affectedPlaceIds)) {
    throw new Error("The assisted itinerary handoff no longer matches the affected itinerary scope.");
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
