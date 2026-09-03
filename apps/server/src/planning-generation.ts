import { randomUUID } from "node:crypto";
import { RuntimeAdapterError, type CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import {
  compileTripBlueprint,
  importSkillItinerary,
  importSkillResearchBatches,
  mergeResearchSetCheckpoint,
  type BlueprintGeneration,
  type BlueprintGenerationStage,
  type Plan,
  type PlanningSession,
  type TravelBooking,
  type WorkspaceSnapshot
} from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { blueprintBookingConstraintsFromTravelBookings } from "./booking-plan-sync.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import {
  INTERACTIVE_TRIP_PLANNER_SKILL,
  blueprintGenerationKey,
  errorDiagnostic,
  generationFailurePath,
  planGenerationFailureCode,
  type PlanGenerationJob,
  publicGenerationJob,
  publicPersistedGeneration,
  updateGenerationJob
} from "./planning-generation-state.js";
import {
  planningArrivalLocalDateTime,
  planningPartySize,
  planningRequestForGenerationWithBookings,
  planningResearchScopes,
  planningTransportPreference
} from "./planning-session-generation.js";

export function createPlanningGenerationService(dependencies: {
  store: SqliteWorkspaceStore;
  codex: CodexRuntimeAdapter;
  setGeneratingPlan: (running: boolean) => void;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
}): PlanningGenerationService {
  const { store, codex, setGeneratingPlan, logGenerationFailure } = dependencies;
  const jobs = new Map<string, PlanGenerationJob>();

  function enqueuePlanningSessionGeneration(session: PlanningSession, workspace: WorkspaceSnapshot): PlanGenerationJob {
    if (!session.confirmedProposalVersion) throw new Error("A confirmed Proposal version is required before Blueprint generation.");
    const existing = jobs.get(session.id);
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
    jobs.set(session.id, job);
    store.updatePlanningSessionStatus(session.id, "generating");
    const savedPlaceCount = store.getResearchSetByGenerationKey(generationKey)?.places.length;
    appendGenerationEvent(generationKey, generation.stage, "running", persisted ? "Resuming from the latest saved generation checkpoint." : "Confirmed proposal queued for Skill generation.", {
      ...(savedPlaceCount === undefined ? {} : { savedPlaceCount }),
      nextAction: generation.stage === "queued" ? "Start geographic place research." : "Continue from the saved checkpoint."
    });
    void executePlanningSessionGeneration(job, session, workspace);
    return job;
  }

  async function executePlanningSessionGeneration(job: PlanGenerationJob, session: PlanningSession, workspace: WorkspaceSnapshot) {
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
      promotePlanningBookingsToPlan(store, session.id, generatedWorkspace.activePlan.id, generatedWorkspace.activePlan.version);
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
      logGenerationFailure({ runId: job.runId, sessionId: session.id, stage: failedStage, failureCode, message: error instanceof Error ? error.message : "Unknown generation error", diagnostic: errorDiagnostic(error) }, "Plan generation failed");
    } finally {
      setGeneratingPlan(false);
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

  function markPersistedGenerationCancelled(generationKey: string, message: string) {
    const current = store.getBlueprintGeneration(generationKey);
    if (!current || current.status === "completed") return;
    store.saveBlueprintGeneration({ ...current, status: "cancelled", failure: { code: "cancelled", stage: current.stage, issues: [{ path: current.stage, code: "cancelled", message }], resumable: true }, updatedAt: new Date().toISOString() });
    appendGenerationEvent(generationKey, current.stage, "cancelled", message, { savedPlaceCount: store.getResearchSetByGenerationKey(generationKey)?.places.length ?? 0, nextAction: "Resume this confirmed proposal when ready." });
  }

  return {
    jobs,
    blueprintGenerationKey,
    enqueuePlanningSessionGeneration,
    publicGenerationJob,
    publicPersistedGeneration,
    updateGenerationJob,
    markPersistedGenerationCancelled,
    planGenerationFailureCode
  };
}

function promotePlanningBookingsToPlan(store: SqliteWorkspaceStore, sessionId: string, planId: string, planVersion: number): void {
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

async function withSingleTransientRetry<T>(operation: () => Promise<T>, onRetry: () => void): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof RuntimeAdapterError) || !["timed_out", "run_failed"].includes(error.code)) throw error;
    onRetry();
    return operation();
  }
}

function completedBlueprintRequirementIds(workspace: WorkspaceSnapshot): string[] {
  return [workspace.activePlan, workspace.executionPlan]
    .filter((plan): plan is Plan => Boolean(plan))
    .flatMap((plan) => plan.stages.flatMap((stage) => stage.tasks))
    .filter((task) => task.status === "completed" && Boolean(task.requirementId))
    .map((task) => task.requirementId!);
}

export { planGenerationFailureCode } from "./planning-generation-state.js";
