import { randomUUID } from "node:crypto";
import { blueprintPolicyKind, LANDI_BLUEPRINT_SKILL, RuntimeAdapterError, type CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import {
  blueprintImportFailureDetails,
  compileTripBlueprint,
  importSkillItinerary,
  importSkillResearchBatches,
  mergeResearchCatalogIntoBlueprint,
  mergeResearchSetCheckpoint,
  type BlueprintPlaceRelationship,
  type BlueprintGeneration,
  type BlueprintGenerationStage,
  type Plan,
  type PlanningSession,
  type ResearchSet,
  type SkillResearchBatchArtifact,
  type TravelBooking,
  type WorkspaceSnapshot
} from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { blueprintBookingConstraintsFromTravelBookings } from "./booking-plan-sync.js";
import {
  assessBlueprintDayReasonableness,
  buildCompletionItineraryRequest,
  buildTargetedCompletionResearchRequest,
  completionTargetsForBlueprint
} from "./day-completion.js";
import { assessExploreSupply, buildExploreSupplyResearchRequest } from "./explore-supply.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import {
  errorDiagnostic,
  generationStrategyFromKey,
  generationFailurePath,
  planGenerationFailureCode,
  selectedBlueprintGenerationKey,
  type PlanGenerationJob,
  publicGenerationJob,
  publicPersistedGeneration,
  updateGenerationJob
} from "./planning-generation-state.js";
import {
  planningArrivalLocalDateTime,
  planningAccommodationDestinationConflicts,
  planningPartySize,
  planningRequestForGenerationWithBookings,
  planningResearchScopes,
  planningTransportPreference
} from "./planning-session-generation.js";
import { scheduleSemanticShadow, type SemanticShadowConfig, type SemanticShadowDiagnosticEvent } from "./semantic-shadow.js";
import { generateSemanticDraft, semanticCanaryFailureDetails, semanticDraftCanaryEligible, type SemanticDraftCanaryConfig } from "./semantic-draft-canary.js";
import { missingGenerationQuestions } from "./planning-session-facts.js";
import {
  auditPlannedPlaceImageCoverage,
  itinerarySemanticSnapshot,
  mergePlannedPlaceImageEnrichment,
  missingPlannedPlaceImages
} from "./planned-place-image-coverage.js";

export function createPlanningGenerationService(dependencies: {
  store: SqliteWorkspaceStore;
  codex: CodexRuntimeAdapter;
  semanticShadow?: SemanticShadowConfig;
  semanticDraftCanary?: SemanticDraftCanaryConfig;
  plannedPlaceImageEnrichment?: boolean;
  onSemanticShadowDiagnostic?: (event: SemanticShadowDiagnosticEvent | { event: "scheduling_branch_reached"; generationKey: string }) => void;
  setGeneratingPlan: (running: boolean) => void;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
}): PlanningGenerationService {
  const { store, codex, setGeneratingPlan, logGenerationFailure } = dependencies;
  const semanticShadow = dependencies.semanticShadow ?? { enabled: false, sampleRate: 0, timeoutMs: 10 * 60_000 };
  const semanticDraftCanary = dependencies.semanticDraftCanary ?? { enabled: false, localEnvironment: false, allowedSessionIds: [] };
  const jobs = new Map<string, PlanGenerationJob>();
  const blueprintGenerationKey = (sessionId: string, proposalVersion: number) => selectedBlueprintGenerationKey(
    sessionId,
    proposalVersion,
    (key) => store.getBlueprintGeneration(key),
    semanticDraftCanaryEligible(semanticDraftCanary, sessionId)
  );

  function enqueuePlanningSessionGeneration(session: PlanningSession, workspace: WorkspaceSnapshot): PlanGenerationJob {
    if (!session.confirmedProposalVersion) throw new Error("A confirmed Proposal version is required before Blueprint generation.");
    const unresolved = missingGenerationQuestions(session.facts);
    if (unresolved.length) throw new RuntimeAdapterError("invalid_request", `Complete the generation-critical facts before Plan generation: ${unresolved.map((item) => item.key).join(", ")}.`);
    const existing = jobs.get(session.id);
    if (existing?.status === "running") return existing;
    const controller = new AbortController();
    const run = store.startPlanGenerationRun({ runtimeKind: "codex", trigger: "web" });
    const now = new Date().toISOString();
    const generationKey = blueprintGenerationKey(session.id, session.confirmedProposalVersion);
    const strategy = generationStrategyFromKey(generationKey);
    const persisted = store.getBlueprintGeneration(generationKey);
    const generation = store.saveBlueprintGeneration({
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion },
      skillLineage: persisted?.skillLineage ?? LANDI_BLUEPRINT_SKILL,
      status: "running",
      stage: persisted?.stage === "ready" ? "compile" : persisted?.stage ?? "queued",
      ...(persisted?.researchSetId ? { researchSetId: persisted.researchSetId } : {}),
      ...(persisted?.blueprintId ? { blueprintId: persisted.blueprintId } : {}),
      ...(persisted?.blueprintVersion ? { blueprintVersion: persisted.blueprintVersion } : {}),
      createdAt: persisted?.createdAt ?? now,
      updatedAt: now
    });
    const job: PlanGenerationJob = { runId: run.id, sessionId: session.id, generationKey, strategy, stage: generation.stage, status: "running", startedAt: generation.createdAt, updatedAt: now, controller };
    jobs.set(session.id, job);
    store.updatePlanningSessionStatus(session.id, "generating");
    const savedPlaceCount = store.getResearchSetByGenerationKey(generationKey)?.places.length;
    appendGenerationEvent(generationKey, generation.stage, "running", persisted ? `Resuming ${strategy} from the latest saved generation checkpoint.` : `Confirmed proposal queued with frozen ${strategy} strategy.`, {
      ...(savedPlaceCount === undefined ? {} : { savedPlaceCount }),
      nextAction: generation.stage === "queued" ? "Start geographic place research." : "Continue from the saved checkpoint."
    });
    void executePlanningSessionGeneration(job, session, workspace);
    return job;
  }

  async function executePlanningSessionGeneration(job: PlanGenerationJob, session: PlanningSession, workspace: WorkspaceSnapshot) {
    const requestStartedAt = Date.now();
    let researchRuntimeMs = 0;
    let semanticOutcome: Awaited<ReturnType<typeof generateSemanticDraft>> | undefined;
    let canaryInputContext: ReturnType<typeof semanticCanaryInputContext> | undefined;
    let importExecuted = false;
    let importCompleted = false;
    let compileExecuted = false;
    let compileCompleted = false;
    try {
      if (workspace.runtime.selectedKind !== "codex") throw new RuntimeAdapterError("skill_unavailable", "Landi Blueprint generation requires the Codex runtime. Select Codex and try again.");
      const generation = store.getBlueprintGeneration(job.generationKey);
      if (!generation) throw new Error("Blueprint Generation checkpoint is missing.");
      const skillLineage = generation.skillLineage;
      blueprintPolicyKind(skillLineage);
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
      if (job.strategy === "semantic_canary") {
        canaryInputContext = semanticCanaryInputContext(session, sessionBookings, scopes);
        assertSemanticCanaryDestinationInput(session, sessionBookings, canaryInputContext);
      }
      let research = store.getResearchSetByGenerationKey(job.generationKey);
      if (research && (research.skillLineage.skillId !== skillLineage.skillId || research.skillLineage.skillVersion !== skillLineage.skillVersion)) throw new Error("Research checkpoint policy does not match this Blueprint Generation.");
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
        const researchStartedAt = Date.now();
        const artifact = await withSingleTransientRetry(
          () => codex.generateSkillResearchBatch({ request, batch: { id: `scope-${index + 1}`, scopeLabel }, signal: job.controller.signal, profile, skillLineage }),
          () => appendGenerationEvent(job.generationKey, "research", "running", `Transient research failure for ${scopeLabel}; retrying this batch once.`, { scopeLabel, savedPlaceCount: research?.places.length ?? 0 })
        );
        researchRuntimeMs += Date.now() - researchStartedAt;
        if (artifact.imageDiagnostics) {
          appendGenerationEvent(job.generationKey, "research", "running", imageDiagnosticSummary(artifact.imageDiagnostics), {
            scopeLabel,
            savedPlaceCount: research?.places.length ?? 0,
            nextAction: "Save source-bound images with this research batch."
          });
        }
        assertGenerationNotCancelled(job, session);
        const checkpointTime = new Date().toISOString();
        const incoming = importSkillResearchBatches([artifact], {
          researchSetId: research?.id ?? `research-${randomUUID()}`,
          generationKey: job.generationKey,
          proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
          skillLineage,
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
      if (accommodationResearchNeeded(research, bookingConstraints)) {
        const accommodationScope = `${scopes.join(" / ")} accommodation anchors`;
        updateGenerationJob(job, { stage: "research", scopeLabel: accommodationScope, savedPlaceCount: research.places.length, message: "Researching specific accommodation anchors." });
        updatePersistedGeneration(job.generationKey, "research", "running");
        appendGenerationEvent(job.generationKey, "research", "running", "Started one bounded accommodation-only research pass because no user-selected stay or credible lodging candidate is available.", { scopeLabel: accommodationScope, savedPlaceCount: research.places.length, nextAction: "Save specific, sourced lodging candidates before daily planning." });
        const accommodationStartedAt = Date.now();
        const artifact = await withSingleTransientRetry(
          () => codex.generateSkillResearchBatch({ request: buildAccommodationResearchRequest(request), batch: { id: "accommodation-anchors", scopeLabel: accommodationScope }, signal: job.controller.signal, profile, skillLineage }),
          () => appendGenerationEvent(job.generationKey, "research", "running", "Transient accommodation research failure; retrying this bounded batch once.", { scopeLabel: accommodationScope, savedPlaceCount: research!.places.length })
        );
        researchRuntimeMs += Date.now() - accommodationStartedAt;
        assertGenerationNotCancelled(job, session);
        const checkpointTime = new Date().toISOString();
        const incoming = importSkillResearchBatches([asAccommodationResearchBatch(artifact)], {
          researchSetId: research.id,
          generationKey: job.generationKey,
          proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
          skillLineage,
          createdAt: research.createdAt,
          updatedAt: checkpointTime
        });
        research = store.saveResearchSet(mergeResearchSetCheckpoint(research, incoming, { status: "completed", updatedAt: checkpointTime }));
        appendGenerationEvent(job.generationKey, "research", "running", "Saved bounded accommodation candidates for Planner selection.", { scopeLabel: accommodationScope, savedPlaceCount: research.places.length, nextAction: "Choose one recommended, not-booked anchor per overnight base." });
      }
      let completedResearch = research;
      assertGenerationNotCancelled(job, session);
      let blueprint = store.getTripBlueprintByGenerationKey(job.generationKey);
      if (!blueprint) {
        updateGenerationJob(job, { stage: "itinerary", scopeLabel: undefined, savedPlaceCount: completedResearch.places.length, message: "Building the daily itinerary from saved places." });
        updatePersistedGeneration(job.generationKey, "itinerary", "running");
        if (job.strategy === "semantic_canary") {
          appendGenerationEvent(job.generationKey, "itinerary", "running", "Started direct Semantic Planner generation from the complete Research Set.", { savedPlaceCount: completedResearch.places.length, nextAction: "Validate, optionally repair once, and structure the final Semantic plan." });
          semanticOutcome = await generateSemanticDraft({ codex, request, profile, research: completedResearch, destinations: scopes, bookingConstraints, session, signal: job.controller.signal });
          assertGenerationNotCancelled(job, session);
          updateGenerationJob(job, { stage: "import", message: "Importing the validated final Semantic plan." });
          updatePersistedGeneration(job.generationKey, "import", "running");
          importExecuted = true;
          blueprint = importSkillItinerary(completedResearch, semanticOutcome.structured.artifact, {
            blueprintId: `blueprint-${randomUUID()}`,
            blueprintVersion: 1,
            createdAt: new Date().toISOString(),
            bookingConstraints: semanticOutcome.structured.preservedBookingConstraints
          });
          importCompleted = true;
          blueprint = store.saveTripBlueprint(blueprint);
          appendGenerationEvent(job.generationKey, "import", "running", `Validated Semantic plan imported (${semanticOutcome.finalReport.result}; repair=${semanticOutcome.repairAttempted}).`, { savedPlaceCount: blueprint.places.length, nextAction: "Compile the same final Semantic plan into a reviewable Draft." });
        } else {
          appendGenerationEvent(job.generationKey, "itinerary", "running", "Started Skill itinerary generation from the complete Research Set.", { savedPlaceCount: completedResearch.places.length, nextAction: "Publish the Trip Blueprint after structural validation." });
          const artifact = await withSingleTransientRetry(
            () => codex.generateSkillItinerary({ request, research: completedResearch, signal: job.controller.signal, profile }),
            () => appendGenerationEvent(job.generationKey, "itinerary", "running", "Transient itinerary failure; retrying this stage once.", { savedPlaceCount: completedResearch.places.length })
          );
          assertGenerationNotCancelled(job, session);
          updateGenerationJob(job, { stage: "import", message: "Validating and publishing the Trip Blueprint." });
          updatePersistedGeneration(job.generationKey, "import", "running");
          const createdAt = new Date().toISOString();
          blueprint = importSkillItinerary(completedResearch, artifact, { blueprintId: `blueprint-${randomUUID()}`, blueprintVersion: 1, createdAt, bookingConstraints });
          blueprint = store.saveTripBlueprint(blueprint);
          appendGenerationEvent(job.generationKey, "import", "running", "Trip Blueprint published with every Research Set place preserved.", { savedPlaceCount: blueprint.places.length, nextAction: "Compile deterministic execution work for review." });
          const completed = await completeUnderPlannedDays({ job, session, request, profile, skillLineage, research: completedResearch, blueprint, bookingConstraints });
          completedResearch = completed.research;
          blueprint = completed.blueprint;
        }
      }
      const exploreSupply = await completeExploreSupply({ job, session, request, profile, skillLineage, research: completedResearch, blueprint });
      completedResearch = exploreSupply.research;
      blueprint = exploreSupply.blueprint;
      if (dependencies.plannedPlaceImageEnrichment) {
        const imageCoverage = await enrichPlannedPlaceImages({ job, session, request, profile, scopes, research: completedResearch, blueprint });
        completedResearch = imageCoverage.research;
        blueprint = imageCoverage.blueprint;
      }
      if (bookingConstraints.length && JSON.stringify(blueprint.bookingConstraints ?? []) !== JSON.stringify(bookingConstraints)) {
        blueprint = store.saveTripBlueprint({ ...blueprint, bookingConstraints });
      }
      if (store.getPlanningSessionById(session.id)?.status === "abandoned" || job.controller.signal.aborted) throw new RuntimeAdapterError("cancelled", "Plan generation was cancelled.");
      updateGenerationJob(job, { stage: "compile", scopeLabel: undefined, savedPlaceCount: blueprint.places.length, message: "Compiling deterministic Plan tasks." });
      updatePersistedGeneration(job.generationKey, "compile", "running");
      appendGenerationEvent(job.generationKey, "compile", "running", job.strategy === "semantic_canary" ? "Compiling the validated final Semantic Blueprint." : "Compiling the published Blueprint without an AI repair pass.", { savedPlaceCount: blueprint.places.length, nextAction: "Save the reviewable Draft Plan and lineage atomically." });
      const completedRequirementIds = completedBlueprintRequirementIds(workspace);
      const compileStartedAt = Date.now();
      compileExecuted = true;
      const compilation = compileTripBlueprint(blueprint, { createdAt: new Date().toISOString(), completedRequirementIds });
      compileCompleted = true;
      const partySize = planningPartySize(session);
      const transportPreference = planningTransportPreference(session);
      const expectedArrivalAtLocal = planningArrivalLocalDateTime(session);
      if (partySize) compilation.plan.configuration.travelContext.partySize = partySize;
      if (transportPreference) compilation.plan.configuration.transport.preference = transportPreference;
      if (expectedArrivalAtLocal) compilation.plan.configuration.arrival.expectedAtLocal = expectedArrivalAtLocal;
      assertGenerationNotCancelled(job, session);
      const generatedWorkspace = store.createCompiledBlueprintPlan(compilation, "codex");
      const compileRuntimeMs = Date.now() - compileStartedAt;
      promotePlanningBookingsToPlan(store, session.id, generatedWorkspace.activePlan.id, generatedWorkspace.activePlan.version);
      store.updatePlanningSessionStatus(session.id, "draft_ready", generatedWorkspace.activePlan.id);
      store.finishPlanGenerationRun({ runId: job.runId, status: "succeeded", outputPlanId: generatedWorkspace.activePlan.id });
      appendGenerationEvent(job.generationKey, "ready", "completed", "Trip Blueprint and Draft Plan are ready for review. No execution has started.", { savedPlaceCount: blueprint.places.length, nextAction: "Review the complete itinerary and confirm the Draft Plan when ready." });
      updateGenerationJob(job, { stage: "ready", status: "succeeded", message: "The complete Trip Blueprint and Draft Plan are ready for review." });
      if (job.strategy === "semantic_canary") {
        try {
          saveSemanticCanaryDiagnostic({
            generationKey: job.generationKey,
            session,
            planId: generatedWorkspace.activePlan.id,
            blueprintId: blueprint.id,
            researchRuntimeMs,
            compileRuntimeMs,
            totalRuntimeMs: Date.now() - requestStartedAt,
            semanticOutcome,
            bookingConstraintCount: bookingConstraints.length,
            canaryInputContext,
            stages: { importExecuted, importCompleted, compileExecuted, compileCompleted }
          });
        } catch (diagnosticError) {
          logGenerationFailure({ generationKey: job.generationKey, sessionId: session.id, failureCode: "diagnostic_persistence_failed", message: diagnosticError instanceof Error ? diagnosticError.message : "Unknown diagnostic persistence failure" }, "Semantic Canary diagnostic persistence failed");
        }
      } else {
        dependencies.onSemanticShadowDiagnostic?.({ event: "scheduling_branch_reached", generationKey: job.generationKey });
        scheduleSemanticShadow({
        generationKey: job.generationKey,
        sessionId: session.id,
        proposalVersion: session.confirmedProposalVersion!,
        request,
        profile,
        completedResearch,
        destinations: scopes,
        bookingConstraints,
        legacyPlan: generatedWorkspace.activePlan,
        legacyBlueprint: blueprint,
        sessionFacts: session.facts
        }, {
        store,
        codex,
        config: semanticShadow,
        logGenerationFailure,
        ...(dependencies.onSemanticShadowDiagnostic ? { onDiagnostic: (event: SemanticShadowDiagnosticEvent) => dependencies.onSemanticShadowDiagnostic?.(event) } : {})
        });
      }
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
      if (job.strategy === "semantic_canary") {
        try {
          const details = semanticCanaryFailureDetails(error);
          const createdAt = new Date().toISOString();
          store.saveDiagnosticArtifact({
            generationKey: job.generationKey,
            createdAt,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
            rawResponse: JSON.stringify({
              type: "semantic_draft_canary_v1",
              identity: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion, generationKey: job.generationKey, strategy: "semantic_canary", policyVersion: "1.0.0" },
              status: { value: cancelled ? "cancelled" : "failed", failureStage: details?.stage ?? failedStage, failureCode, reason: failureMessage },
              timings: { totalRuntimeMs: Date.now() - requestStartedAt, researchRuntimeMs, ...(details?.timings ?? {}) },
              ...(canaryInputContext ? { inputs: canaryInputContext } : {}),
              stages: { importExecuted, importCompleted, compileExecuted, compileCompleted },
              ...(details?.validator ? { validator: details.validator } : {}),
              ...(details?.repairAttempted === undefined ? {} : { repairAttempted: details.repairAttempted }),
              ...(details?.structurerDestinations ? { structurerDestinations: details.structurerDestinations } : {}),
              ...(details?.destinationGate ? { destinationGate: details.destinationGate } : {}),
              ...(details?.diagnosticArtifact === undefined ? {} : { semanticArtifact: details.diagnosticArtifact }),
              ...(semanticOutcome ? semanticCanaryFailureContext(semanticOutcome, error) : {}),
              authority: { draftPublished: false, confirmationInvoked: false, executionActivated: false, telegramInvoked: false }
            })
          });
        } catch (diagnosticError) {
          logGenerationFailure({ generationKey: job.generationKey, sessionId: session.id, failureCode: "diagnostic_persistence_failed", message: diagnosticError instanceof Error ? diagnosticError.message : "Unknown diagnostic persistence failure" }, "Semantic Canary failure diagnostic persistence failed");
        }
      }
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

  function semanticCanaryFailureContext(outcome: Awaited<ReturnType<typeof generateSemanticDraft>>, error: unknown) {
    const imported = blueprintImportFailureDetails(error);
    const affectedDates = new Set(imported?.days.map((day) => day.date) ?? []);
    return {
      calls: {
        semanticPlanner: outcome.timings.plannerCalls,
        validator: outcome.timings.validatorCalls,
        repair: outcome.timings.repairCalls,
        legacyItinerary: 0,
        semanticShadow: 0
      },
      validator: {
        initialResult: outcome.initialReport.result,
        finalResult: outcome.finalReport.result,
        finalRepairRequiredFindingCount: outcome.finalReport.findings.filter((finding) => finding.requiresPlannerRepair).length
      },
      semanticTimings: {
        plannerMs: outcome.timings.plannerMs,
        validatorMs: outcome.timings.validatorMs,
        repairMs: outcome.timings.repairMs,
        structurerMs: outcome.timings.structurerMs
      },
      preservation: {
        preservedBookingConstraintCount: outcome.structured.preservedBookingConstraints.length,
        dateCount: outcome.finalPlan.dailyItinerary.length
      },
      ...(imported ? {
        importFailure: {
          issues: imported.issues,
          semanticDays: outcome.finalPlan.dailyItinerary.filter((day) => affectedDates.has(day.date)).map((day) => ({
            date: day.date,
            startContext: day.startContext,
            endContext: day.endContext,
            experiences: (day.experiences ?? []).map((experience) => ({
              title: experience.title,
              ...(experience.placeName ? { placeName: experience.placeName } : {}),
              planRole: experience.planRole,
              ...(experience.replacementFor ? { replacementFor: experience.replacementFor } : {})
            }))
          })),
          normalizedDays: imported.days,
          normalizedMovements: imported.movements
        }
      } : {})
    };
  }

  function saveSemanticCanaryDiagnostic(input: {
    generationKey: string;
    session: PlanningSession;
    planId: string;
    blueprintId: string;
    researchRuntimeMs: number;
    compileRuntimeMs: number;
    totalRuntimeMs: number;
    semanticOutcome: Awaited<ReturnType<typeof generateSemanticDraft>> | undefined;
    bookingConstraintCount: number;
    canaryInputContext: ReturnType<typeof semanticCanaryInputContext> | undefined;
    stages: { importExecuted: boolean; importCompleted: boolean; compileExecuted: boolean; compileCompleted: boolean };
  }): void {
    const createdAt = new Date().toISOString();
    const outcome = input.semanticOutcome;
    store.saveDiagnosticArtifact({
      generationKey: input.generationKey,
      createdAt,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
      rawResponse: JSON.stringify({
        type: "semantic_draft_canary_v1",
        identity: { sessionId: input.session.id, proposalVersion: input.session.confirmedProposalVersion, generationKey: input.generationKey, strategy: "semantic_canary", policyVersion: "1.0.0", planId: input.planId, blueprintId: input.blueprintId },
        status: { value: "completed", authority: "draft_only" },
        timings: { totalRuntimeMs: input.totalRuntimeMs, researchRuntimeMs: input.researchRuntimeMs, semanticPlannerRuntimeMs: outcome?.timings.plannerMs, validatorRuntimeMs: outcome?.timings.validatorMs, repairRuntimeMs: outcome?.timings.repairMs, structurerRuntimeMs: outcome?.timings.structurerMs, compileRuntimeMs: input.compileRuntimeMs },
        calls: { semanticPlanner: outcome?.timings.plannerCalls ?? 0, validator: outcome?.timings.validatorCalls ?? 0, repair: outcome?.timings.repairCalls ?? 0, legacyItinerary: 0, semanticShadow: 0 },
        validator: { initialResult: outcome?.initialReport.result, finalResult: outcome?.finalReport.result, finalRepairRequiredFindingCount: outcome?.finalReport.findings.filter((finding) => finding.requiresPlannerRepair).length },
        ...(input.canaryInputContext ? { inputs: input.canaryInputContext } : {}),
        structurerDestinations: outcome?.structured.artifact.destinations,
        destinationGate: input.canaryInputContext && outcome ? {
          expected: input.canaryInputContext.confirmedTripDestinations.map((item) => item.value),
          actual: outcome.structured.artifact.destinations,
          matched: true
        } : undefined,
        stages: input.stages,
        preservation: { bookingConstraintCount: input.bookingConstraintCount, preservedBookingConstraintCount: outcome?.structured.preservedBookingConstraints.length, dateCount: outcome?.finalPlan.dailyItinerary.length },
        readinessTrace: outcome?.readinessTrace,
        semanticArtifact: outcome?.diagnosticArtifact
      })
    });
  }

  function semanticCanaryInputContext(session: PlanningSession, bookings: TravelBooking[], scopes: string[]) {
    return {
      confirmedTripDestinations: session.facts
        .filter((fact) => fact.key === "destination" && fact.confirmed)
        .map((fact) => ({ value: fact.value, source: fact.source })),
      accommodationLocations: bookings
        .filter((booking) => booking.status !== "cancelled")
        .flatMap((booking) => booking.segments
          .filter((segment) => segment.status !== "cancelled" && segment.segmentType === "hotel_stay")
          .map((segment) => ({ value: segment.location ?? segment.destination ?? "", source: booking.sourceLabel })))
        .filter((item) => item.value),
      researchScopes: [...scopes]
    };
  }

  function assertSemanticCanaryDestinationInput(session: PlanningSession, bookings: TravelBooking[], context: ReturnType<typeof semanticCanaryInputContext>): void {
    const destination = context.confirmedTripDestinations[0];
    if (!destination || destination.source !== "user") throw new RuntimeAdapterError("invalid_request", "Semantic Canary requires a user-confirmed trip destination before Research starts.");
    if (!session.proposal?.objective.toLocaleLowerCase().includes(destination.value.toLocaleLowerCase())) throw new RuntimeAdapterError("invalid_request", "The confirmed proposal and trip destination no longer match.");
    const conflicts = planningAccommodationDestinationConflicts(session, bookings);
    if (conflicts.length) throw new RuntimeAdapterError("invalid_request", `The confirmed accommodation location conflicts with the trip destination: ${conflicts[0]}.`);
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

  async function completeUnderPlannedDays(input: {
    job: PlanGenerationJob;
    session: PlanningSession;
    request: string;
    profile: {
      preferredLanguage: WorkspaceSnapshot["profile"]["preferredLanguage"];
      nationality: WorkspaceSnapshot["profile"]["nationality"];
      gender: WorkspaceSnapshot["profile"]["gender"];
      immigrationStatus: WorkspaceSnapshot["profile"]["immigrationStatus"];
    };
    skillLineage: BlueprintGeneration["skillLineage"];
    research: NonNullable<ReturnType<SqliteWorkspaceStore["getResearchSetByGenerationKey"]>>;
    blueprint: NonNullable<ReturnType<SqliteWorkspaceStore["getTripBlueprintByGenerationKey"]>>;
    bookingConstraints: ReturnType<typeof blueprintBookingConstraintsFromTravelBookings>;
  }): Promise<{ research: typeof input.research; blueprint: typeof input.blueprint }> {
    let research = input.research;
    let blueprint = input.blueprint;
    const targets = completionTargetsForBlueprint(blueprint, research);
    const dependencyGaps = assessBlueprintDayReasonableness(blueprint).filter((day) => day.classification === "UNDER_PLANNED" && day.cause === "DEPENDENCY_GAP");
    if (!targets.length) {
      const detail = dependencyGaps.length
        ? `Stage 3.10 day completion found no candidate-gap days. Preserved ${dependencyGaps.length} dependency-gap day(s): ${dependencyGaps.map((day) => day.date).join(", ")}.`
        : "Stage 3.10 day completion found no materially under-planned candidate-gap days.";
      appendGenerationEvent(input.job.generationKey, "itinerary", "running", detail, { savedPlaceCount: research.places.length, nextAction: "Run final reasonableness check before compile." });
      return { research, blueprint };
    }

    const researchTargets = targets.filter((target) => !target.existingCandidates.length && target.researchScopeLabel);
    for (const [index, target] of researchTargets.entries()) {
      assertGenerationNotCancelled(input.job, input.session);
      const scopeLabel = target.researchScopeLabel!;
      updateGenerationJob(input.job, { stage: "research", scopeLabel, savedPlaceCount: research.places.length, message: `Researching completion candidates for ${target.day.date}.` });
      updatePersistedGeneration(input.job.generationKey, "research", "running");
      appendGenerationEvent(input.job.generationKey, "research", "running", `Started targeted day-completion research for ${target.day.date}.`, {
        scopeLabel,
        savedPlaceCount: research.places.length,
        nextAction: "Merge day-specific candidates into the Research Set."
      });
      const completedAt = new Date().toISOString();
      const artifact = await withSingleTransientRetry(
        () => codex.generateSkillResearchBatch({
          request: buildTargetedCompletionResearchRequest(input.request, target),
          batch: { id: `completion-${index + 1}-${target.day.date}`, scopeLabel },
          signal: input.job.controller.signal,
          profile: input.profile,
          skillLineage: input.skillLineage,
          completedAt
        }),
        () => appendGenerationEvent(input.job.generationKey, "research", "running", `Transient targeted research failure for ${target.day.date}; retrying this batch once.`, { scopeLabel, savedPlaceCount: research.places.length })
      );
      assertGenerationNotCancelled(input.job, input.session);
      const checkpointTime = new Date().toISOString();
      const previousPlaceIds = new Set(research.places.map((place) => place.id));
      const incoming = importSkillResearchBatches([sameBatchRelationshipsOnly(artifact)], {
        researchSetId: research.id,
        generationKey: input.job.generationKey,
        proposalRef: { sessionId: input.session.id, proposalVersion: input.session.confirmedProposalVersion! },
        skillLineage: input.skillLineage,
        createdAt: research.createdAt,
        updatedAt: checkpointTime
      });
      research = mergeResearchSetCheckpoint(research, incoming, { status: "completed", updatedAt: checkpointTime });
      research = withCompletionAnchorRelationships(research, target, previousPlaceIds);
      research = store.saveResearchSet(research);
      appendGenerationEvent(input.job.generationKey, "research", "running", `Saved targeted day-completion research for ${target.day.date}.`, {
        scopeLabel,
        savedPlaceCount: research.places.length,
        nextAction: "Re-compose under-planned day with the normal itinerary generator."
      });
    }

    assertGenerationNotCancelled(input.job, input.session);
    updateGenerationJob(input.job, { stage: "itinerary", scopeLabel: undefined, savedPlaceCount: research.places.length, message: "Re-composing under-planned days." });
    updatePersistedGeneration(input.job.generationKey, "itinerary", "running");
    const dates = targets.map((target) => target.day.date).join(", ");
    appendGenerationEvent(input.job.generationKey, "itinerary", "running", `Stage 3.10 re-composing under-planned day(s): ${dates}.`, {
      savedPlaceCount: research.places.length,
      nextAction: "Validate the completion pass before compile."
    });
    const completionArtifact = await withSingleTransientRetry(
      () => codex.generateSkillItinerary({ request: buildCompletionItineraryRequest(input.request, targets, researchTargets.length > 0), research, signal: input.job.controller.signal, profile: input.profile }),
      () => appendGenerationEvent(input.job.generationKey, "itinerary", "running", "Transient completion itinerary failure; retrying this stage once.", { savedPlaceCount: research.places.length })
    );
    assertGenerationNotCancelled(input.job, input.session);
    blueprint = importSkillItinerary(research, completionArtifact, { blueprintId: blueprint.id, blueprintVersion: blueprint.version, createdAt: blueprint.createdAt, bookingConstraints: input.bookingConstraints });
    blueprint = store.saveTripBlueprint(blueprint);
    const finalUnderPlanned = assessBlueprintDayReasonableness(blueprint).filter((day) => day.classification === "UNDER_PLANNED");
    appendGenerationEvent(input.job.generationKey, "itinerary", "running", finalUnderPlanned.length
      ? `Stage 3.10 final reasonableness check still has under-planned day(s): ${finalUnderPlanned.map((day) => `${day.date} ${day.cause ?? "UNKNOWN"}`).join(", ")}.`
      : "Stage 3.10 final reasonableness check passed without under-planned days.", {
      savedPlaceCount: blueprint.places.length,
      nextAction: "Compile deterministic execution work for review."
    });
    return { research, blueprint };
  }

  async function completeExploreSupply(input: {
    job: PlanGenerationJob;
    session: PlanningSession;
    request: string;
    profile: {
      preferredLanguage: WorkspaceSnapshot["profile"]["preferredLanguage"];
      nationality: WorkspaceSnapshot["profile"]["nationality"];
      gender: WorkspaceSnapshot["profile"]["gender"];
      immigrationStatus: WorkspaceSnapshot["profile"]["immigrationStatus"];
    };
    skillLineage: BlueprintGeneration["skillLineage"];
    research: ResearchSet;
    blueprint: NonNullable<ReturnType<SqliteWorkspaceStore["getTripBlueprintByGenerationKey"]>>;
  }): Promise<{ research: ResearchSet; blueprint: typeof input.blueprint }> {
    const assessment = assessExploreSupply(input.blueprint);
    if (!assessment.needsSupplement) {
      appendGenerationEvent(input.job.generationKey, "itinerary", "running", `Explore supply retained ${assessment.actionablePlaceIds.length} plan-outside choice(s) across ${assessment.choiceTypes.length} choice type(s).`, {
        savedPlaceCount: input.research.places.length,
        nextAction: "Compile the accepted itinerary and guide catalog."
      });
      return { research: input.research, blueprint: input.blueprint };
    }
    const supplementAlreadyAttempted = store.getBlueprintGenerationEvents(input.job.generationKey)
      .some((event) => event.detail === "The formal itinerary is complete, but the local guide needs more plan-outside choices. Starting one bounded supplemental research pass.");
    if (supplementAlreadyAttempted) {
      appendGenerationEvent(input.job.generationKey, "itinerary", "running", "The bounded Explore supplement was already attempted for this generation. Resuming with the choices already saved.", {
        savedPlaceCount: input.research.places.length,
        nextAction: "Compile the accepted itinerary with the available guide content."
      });
      return { research: input.research, blueprint: input.blueprint };
    }
    const scopeLabel = `Explore choices near ${(assessment.uncoveredAreas.length ? assessment.uncoveredAreas : assessment.mainAreas).join(" / ") || input.blueprint.destinations.join(" / ")}`;
    appendGenerationEvent(input.job.generationKey, "research", "running", "The formal itinerary is complete, but the local guide needs more plan-outside choices. Starting one bounded supplemental research pass.", {
      scopeLabel,
      savedPlaceCount: input.research.places.length,
      nextAction: "Add sourced local choices without changing the formal itinerary."
    });
    try {
      assertGenerationNotCancelled(input.job, input.session);
      const artifact = await codex.generateSkillResearchBatch({
        request: buildExploreSupplyResearchRequest(input.request, input.blueprint, input.research, assessment),
        batch: { id: "explore-supply", scopeLabel },
        signal: input.job.controller.signal,
        profile: input.profile,
        skillLineage: input.skillLineage
      });
      assertGenerationNotCancelled(input.job, input.session);
      const checkpointTime = new Date().toISOString();
      const incoming = importSkillResearchBatches([sameBatchRelationshipsOnly(artifact)], {
        researchSetId: input.research.id,
        generationKey: input.job.generationKey,
        proposalRef: input.research.proposalRef,
        skillLineage: input.skillLineage,
        createdAt: input.research.createdAt,
        updatedAt: checkpointTime
      });
      const existingIds = new Set(input.research.places.map((place) => place.id));
      const mergedResearch = mergeResearchSetCheckpoint(input.research, incoming, { status: "completed", updatedAt: checkpointTime });
      const newPlaceIds = mergedResearch.places.filter((place) => !existingIds.has(place.id)).map((place) => place.id);
      if (!newPlaceIds.length) {
        appendGenerationEvent(input.job.generationKey, "research", "running", "No additional distinct local choices passed identity and evidence checks. The accepted draft remains unchanged.", {
          scopeLabel,
          savedPlaceCount: input.research.places.length,
          nextAction: "Compile the accepted itinerary with the available guide content."
        });
        return { research: input.research, blueprint: input.blueprint };
      }
      const mergedBlueprint = mergeResearchCatalogIntoBlueprint(input.blueprint, mergedResearch, checkpointTime);
      const saved = store.saveResearchSetAndTripBlueprint(mergedResearch, mergedBlueprint);
      const completedAssessment = assessExploreSupply(saved.blueprint);
      appendGenerationEvent(input.job.generationKey, "research", "running", `Saved ${newPlaceIds.length} additional sourced local research item(s); ${completedAssessment.actionablePlaceIds.length} map-ready plan-outside choice(s) are now available. The formal itinerary was not changed.`, {
        scopeLabel,
        savedPlaceCount: saved.research.places.length,
        nextAction: "Compile the unchanged formal itinerary with the expanded guide catalog."
      });
      return saved;
    } catch (error) {
      if (error instanceof RuntimeAdapterError && error.code === "cancelled") throw error;
      logGenerationFailure({ generationKey: input.job.generationKey, stage: "explore_supply", error: errorDiagnostic(error) }, "Optional Explore supply research failed; preserving the accepted itinerary");
      appendGenerationEvent(input.job.generationKey, "research", "running", "More local recommendations could not be completed this time. The accepted itinerary and its verified content were preserved.", {
        scopeLabel,
        savedPlaceCount: input.research.places.length,
        nextAction: "Compile the accepted itinerary with the available guide content."
      });
      return { research: input.research, blueprint: input.blueprint };
    }
  }

  function sameBatchRelationshipsOnly(artifact: SkillResearchBatchArtifact): SkillResearchBatchArtifact {
    const batchPlaceIds = new Set(artifact.places.map((place) => place.id).filter((id): id is string => Boolean(id)));
    const sameBatchPlaceId = (placeId: string | undefined): placeId is string => Boolean(placeId && batchPlaceIds.has(placeId));
    const sameBatchPlaceIds = (placeIds: string[]): string[] => placeIds.filter((placeId, index, all) => batchPlaceIds.has(placeId) && all.indexOf(placeId) === index);
    const withoutPlaceId = <T extends { placeId?: string }>(item: T): Omit<T, "placeId"> => {
      const { placeId: _placeId, ...rest } = item;
      return rest;
    };
    return {
      ...artifact,
      events: artifact.events.map((event) => sameBatchPlaceId(event.placeId) || !event.placeId ? event : withoutPlaceId(event)),
      relationships: (artifact.relationships ?? []).filter((relationship) => batchPlaceIds.has(relationship.fromPlaceId) && batchPlaceIds.has(relationship.toPlaceId)),
      ...(artifact.localFoods ? { localFoods: artifact.localFoods.map((item) => ({ ...item, diningPlaceIds: sameBatchPlaceIds(item.diningPlaceIds) })).filter((item) => item.diningPlaceIds.length) } : {}),
      ...(artifact.localProducts ? { localProducts: artifact.localProducts.map((item) => ({ ...item, purchasePlaceIds: sameBatchPlaceIds(item.purchasePlaceIds) })).filter((item) => item.purchasePlaceIds.length) } : {}),
      ...(artifact.experienceThemes ? { experienceThemes: artifact.experienceThemes.map((item) => ({ ...item, offeringPlaceIds: sameBatchPlaceIds(item.offeringPlaceIds) })).filter((item) => item.offeringPlaceIds.length) } : {}),
      ...(artifact.travelTips ? { travelTips: artifact.travelTips.map((tip) => sameBatchPlaceId(tip.placeId) || !tip.placeId ? tip : withoutPlaceId(tip)) } : {}),
      ...(artifact.preparationChecklist ? { preparationChecklist: artifact.preparationChecklist.map((item) => sameBatchPlaceId(item.placeId) || !item.placeId ? item : withoutPlaceId(item)) } : {}),
      ...(artifact.actionRequirements ? { actionRequirements: artifact.actionRequirements.map((requirement) => sameBatchPlaceId(requirement.placeId) || !requirement.placeId ? requirement : withoutPlaceId(requirement)) } : {})
    };
  }

  function withCompletionAnchorRelationships(research: ResearchSet, target: ReturnType<typeof completionTargetsForBlueprint>[number], previousPlaceIds: Set<string>): ResearchSet {
    const newPlaces = research.places.filter((place) => !previousPlaceIds.has(place.id));
    if (!newPlaces.length || !target.anchors.length) return research;
    const existingIds = new Set((research.guideRelationships ?? []).map((relationship) => relationship.id));
    const added: BlueprintPlaceRelationship[] = [];
    for (const place of newPlaces) {
      for (const anchor of target.anchors) {
        const id = `relationship-completion-${target.day.date}-${slug(anchor.id)}-${slug(place.id)}`;
        if (existingIds.has(id)) continue;
        existingIds.add(id);
        added.push({
          id,
          kind: place.area && anchor.area && place.area.toLowerCase() === anchor.area.toLowerCase() ? "same_area" : "same_direction",
          fromPlaceId: anchor.id,
          toPlaceId: place.id,
          rationale: `Stage 3.10 targeted completion candidate for ${target.day.date}; selected because it fits the same day area or direction as ${anchor.name}.`,
          evidence: []
        });
      }
    }
    return { ...research, guideRelationships: [...(research.guideRelationships ?? []), ...added], updatedAt: new Date().toISOString() };
  }

  function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
  }

  function imageDiagnosticSummary(diagnostics: NonNullable<Awaited<ReturnType<CodexRuntimeAdapter["generateSkillResearchBatch"]>>["imageDiagnostics"]>): string {
    const omittedCount = diagnostics.omitted.length;
    const omittedSuffix = omittedCount ? ` ${omittedCount} place(s) had no compliant sourced image.` : "";
    return `Image enrichment accepted ${diagnostics.acceptedImageCount} sourced image(s) for ${diagnostics.requestedPlaceCount} requested place(s).${omittedSuffix}`;
  }

  async function enrichPlannedPlaceImages(input: {
    job: PlanGenerationJob;
    session: PlanningSession;
    request: string;
    profile: { preferredLanguage: string; nationality: string; gender: WorkspaceSnapshot["profile"]["gender"]; immigrationStatus: WorkspaceSnapshot["profile"]["immigrationStatus"] };
    scopes: string[];
    research: ResearchSet;
    blueprint: NonNullable<ReturnType<SqliteWorkspaceStore["getTripBlueprintByGenerationKey"]>>;
  }): Promise<{ research: ResearchSet; blueprint: NonNullable<ReturnType<SqliteWorkspaceStore["getTripBlueprintByGenerationKey"]>> }> {
    const beforeAudit = auditPlannedPlaceImageCoverage(input.blueprint, input.research);
    const missing = missingPlannedPlaceImages(input.blueprint, input.research);
    appendGenerationEvent(input.job.generationKey, "research", "running", `Planned-place image coverage: ${beforeAudit.length - missing.length}/${beforeAudit.length} concrete Timeline place(s) have sourced candidates.`, {
      savedPlaceCount: input.research.places.length,
      nextAction: missing.length ? `Try one bounded image-only pass for ${missing.length} missing place(s).` : "Continue without additional image research."
    });
    if (!missing.length) return { research: input.research, blueprint: input.blueprint };
    const semanticBefore = JSON.stringify(itinerarySemanticSnapshot(input.blueprint));
    try {
      const enrichment = await codex.generatePlannedPlaceImageEnrichment({
        request: input.request,
        scopeLabel: input.scopes.join(" / "),
        places: missing,
        profile: input.profile,
        signal: input.job.controller.signal
      });
      assertGenerationNotCancelled(input.job, input.session);
      const updatedAt = new Date().toISOString();
      const merged = mergePlannedPlaceImageEnrichment(input.research, input.blueprint, enrichment, updatedAt);
      if (!merged.acceptedImageCount) {
        appendGenerationEvent(input.job.generationKey, "research", "running", "The bounded image pass found no additional exact-place images. The itinerary remains available with text-only cards where needed.", { savedPlaceCount: input.research.places.length, nextAction: "Compile the unchanged itinerary." });
        return { research: input.research, blueprint: input.blueprint };
      }
      if (JSON.stringify(itinerarySemanticSnapshot(merged.blueprint)) !== semanticBefore) throw new Error("Planned-place image enrichment changed itinerary semantics.");
      const saved = store.saveResearchSetAndTripBlueprint(merged.research, merged.blueprint);
      appendGenerationEvent(input.job.generationKey, "research", "running", `Saved ${merged.acceptedImageCount} sourced image candidate(s) for planned Timeline places without changing the itinerary.`, { savedPlaceCount: saved.research.places.length, nextAction: "Compile the unchanged itinerary." });
      return saved;
    } catch (error) {
      if (error instanceof RuntimeAdapterError && error.code === "cancelled") throw error;
      logGenerationFailure({ generationKey: input.job.generationKey, stage: "planned_place_images", error: errorDiagnostic(error) }, "Optional planned-place image enrichment failed; preserving the accepted itinerary");
      appendGenerationEvent(input.job.generationKey, "research", "running", "Image enrichment could not be completed. The itinerary remains usable and missing images will render as text-only cards.", { savedPlaceCount: input.research.places.length, nextAction: "Compile the unchanged itinerary." });
      return { research: input.research, blueprint: input.blueprint };
    }
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

export function accommodationResearchNeeded(research: ResearchSet, bookingConstraints: ReturnType<typeof blueprintBookingConstraintsFromTravelBookings>): boolean {
  const hasUserAccommodation = bookingConstraints.some((constraint) => constraint.type === "accommodation" && constraint.status !== "cancelled" && constraint.segments.some((segment) => segment.segmentType === "hotel_stay" && (constraint.status === "confirmed" || Boolean(segment.location || segment.destination))));
  if (hasUserAccommodation) return false;
  if (research.batches.some((batch) => batch.id.includes("accommodation-anchors"))) return false;
  return !research.places.some((place) => place.accommodation?.state === "recommended" || (place.coordinates && /\b(hotel|resort|villa|inn|guesthouse|lodg)\b/i.test(`${place.category} ${place.visitRole ?? ""}`)));
}

export function buildAccommodationResearchRequest(request: string): string {
  return `${request.trim()}\n\nBounded accommodation-anchor research only: infer the overnight bases already required by this confirmed trip design and return a small set of specific, credible, map-ready lodging candidates for each base. Do not add attractions, dining, shopping, transport tabs, prices, availability, or reservation claims. Mark every specific property accommodation.state=recommended, keep it out of Explore with guideDisplay.showInGuide=false, attach source evidence and coordinates, and include only real officialUrl or bookingUrl values. Recommended means not booked. If a base has no reliable specific candidate after this pass, return only an accommodation.state=pending area fallback for that base.`;
}

function asAccommodationResearchBatch(artifact: SkillResearchBatchArtifact): SkillResearchBatchArtifact {
  const lodgingPlaces = artifact.places.filter((place) => /\b(hotel|resort|villa|inn|guesthouse|lodg|accommodation|stay)\b/i.test(`${place.category} ${place.visitRole ?? ""}`));
  const lodgingIds = new Set(lodgingPlaces.flatMap((place) => place.id ? [place.id] : []));
  return {
    ...artifact,
    places: lodgingPlaces.map((place) => ({
        ...place,
        guideDisplay: { ...(place.guideDisplay ?? {}), showInGuide: false },
        accommodation: place.accommodation ?? { state: place.coordinates ? "recommended" : "pending", ...(place.area ? { baseLabel: place.area } : {}), rationale: place.whyWorthIt }
      })),
    events: [],
    relationships: (artifact.relationships ?? []).filter((relationship) => lodgingIds.has(relationship.fromPlaceId) && lodgingIds.has(relationship.toPlaceId)),
    localFoods: [],
    localProducts: [],
    experienceThemes: [],
    travelTips: [],
    actionRequirements: (artifact.actionRequirements ?? []).filter((requirement) => !requirement.placeId || lodgingIds.has(requirement.placeId))
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
