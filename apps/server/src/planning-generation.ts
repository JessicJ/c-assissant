import { type BookingRelationshipProducer, bookingRelationshipSourceUnits, reconcileBookingRelationshipAssessment } from "@c-assistant/core";
import type { MaintenanceControl } from "./maintenance-control.js";
import type { BlueprintRuntime } from "./agent-work-contract.js";
import { createHash, randomUUID } from "node:crypto";
import { blueprintPolicyKind, LANDI_BLUEPRINT_SKILL, parseSkillItineraryArtifact, RuntimeAdapterError, type CodexRuntimeAdapter, type SkillItineraryReviewRequest, type SkillItineraryReviewFinding } from "@c-assistant/agent-adapters";
import {
  blueprintImportFailureDetails,
  assertTripBlueprintIntegrity,
  compileTripBlueprint,
  importSkillItinerary,
  importSkillResearchBatches,
  isLodgingPlaceCategory,
  mergeResearchCatalogIntoBlueprint,
  mergeResearchSetCheckpoint,
  type BlueprintPlaceRelationship,
  type BlueprintBookingConstraint,
  type BlueprintGeneration,
  type BlueprintGenerationStage,
  type BlueprintGenerationEvent,
  type Plan,
  type PlanningSession,
  type ResearchSet,
  type SkillResearchBatchArtifact,
  type SkillItineraryArtifact,
  type TripBlueprint,
  type TravelBooking,
  type WorkspaceSnapshot
} from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { blueprintBookingConstraintsFromTravelBookings } from "./booking-plan-sync.js";
import {
  assessBlueprintDayReasonableness,
  buildCompletionItineraryRequest,
  buildTargetedCompletionResearchRequest,
  completionTargetsForBlueprint,
  emptyDestinationDayDates
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
  assertPlanningGenerationProposal,
  planningArrivalLocalDateTime,
  planningAccommodationDestinationConflicts,
  planningCountryGatewayContext,
  planningExplicitGatewayOnly,
  planningPartySize,
  planningAccommodationRequired,
  planningRequestForGenerationWithBookings,
  planningResearchScopes,
  planningTransportPreference
} from "./planning-session-generation.js";
import { scheduleSemanticShadow, type SemanticShadowConfig, type SemanticShadowDiagnosticEvent } from "./semantic-shadow.js";
import { generateSemanticDraft, semanticCanaryFailureDetails, semanticDraftCanaryEligible, type SemanticDraftCanaryConfig } from "./semantic-draft-canary.js";
import { missingGenerationQuestions } from "./planning-session-facts.js";
import { materializeRecommendedAccommodationAnchors } from "./accommodation-anchor-materialization.js";
import { normalizeUnverifiedBookedTimes } from "./itinerary-quality-review.js";
import { addResearchedFlightOrigins, flightOriginGaps } from "./flight-origin-completion.js";
import { materializeOutboundDeparture } from "./outbound-departure.js";
import { addResearchedGatewayNodes, correctImpossibleFlightMovements, gatewayNodeGaps, researchedGatewayForGap } from "./gateway-node-completion.js";
import { continuePublishedPlanImages } from "./planned-place-image-continuation.js";
import { materializeProposedHotelDepartures } from "./proposed-departure-times.js";
import { completeDepartureEndpoint } from "./departure-endpoint-completion.js";
import { auditPlannedPlaceImageCoverage, missingPlannedPlaceImages } from "./planned-place-image-coverage.js";
import { prefetchPlannedPlaceImages, probeRemoteImageUrl, requiresMahImageRecovery, runPlannedPlaceImagePass } from "./planned-place-image-pipeline.js";
import { searchWikipediaPlaceImages } from "./wikipedia-place-images.js";
import { itineraryArtifactFromBlueprint, reviewItineraryForPublication } from "./itinerary-publication-review.js";
import { ITINERARY_CONTENT_REQUIREMENTS, normalizeDayCandidates } from "./itinerary-content-review.js";
import { auditItineraryContent } from "./itinerary-content-audit.js";
import { MahCarrierError, type MahStageOperation, type MahStageRequest } from "./mah-generation-contract.js";
import { mahStageIdentity, mahBusinessParserContext, type MahQualityRepairContext, type MahStageContext, type MahGenerationContext } from "./mah-blueprint-runtime.js";
import { MAH_SUPERVISION_STOP_REASON } from "./mah-cli-transport.js";

const OPTIONAL_EXPLORE_RESEARCH_TIMEOUT_MS = 5 * 60_000;

/** Scope identity stays stable across retries without colliding when the scope list changes. */
export function researchScopeBatchId(index: number, scopeLabel: string): string {
  return `scope-${index + 1}-${createHash("sha1").update(scopeLabel).digest("hex").slice(0, 10)}`;
}

/** A failed quality pass can leave a newer complete artifact than the last saved Blueprint. */
export function recoverValidatedDiagnosticBlueprint(input: {
  store: SqliteWorkspaceStore;
  generationKey: string;
  research: ResearchSet;
  blueprint: TripBlueprint | undefined;
  session: PlanningSession;
  bookingConstraints: BlueprintBookingConstraint[];
}): TripBlueprint | undefined {
  const diagnostic = input.store.listDiagnosticArtifacts(input.generationKey)
    .filter((entry) => !input.blueprint || entry.createdAt > input.blueprint.createdAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((entry) => { try { return JSON.parse(entry.rawResponse).type === "blueprint_import_failure_v1"; } catch { return false; } });
  if (!diagnostic) return undefined;
  try {
    const saved = JSON.parse(diagnostic.rawResponse) as { type?: string; artifact?: SkillItineraryArtifact };
    if (saved.type !== "blueprint_import_failure_v1" || !saved.artifact || !Array.isArray(saved.artifact.days) || !Array.isArray(saved.artifact.movements)) return undefined;
    const artifact = parseSkillItineraryArtifact(JSON.stringify(saved.artifact), new Set(input.research.places.map((place) => place.id)), new Set(input.research.sources.map((source) => source.id)), new Set(input.research.events.map((event) => event.id)));
    let candidate = importSkillItinerary(input.research, { ...saved.artifact, movements: artifact.movements }, {
      blueprintId: input.blueprint?.id ?? `blueprint-${randomUUID()}`,
      blueprintVersion: (input.blueprint?.version ?? 0) + 1,
      createdAt: new Date().toISOString(),
      bookingConstraints: input.bookingConstraints
    });
    candidate = normalizeUnverifiedBookedTimes(materializeRecommendedAccommodationAnchors(candidate).blueprint);
    candidate = normalizeDayCandidates(materializeProposedHotelDepartures(completeDepartureEndpoint(correctImpossibleFlightMovements(candidate), input.session), input.session));
    assertTripBlueprintIntegrity(candidate, { expectedResearchPlaceIds: input.research.places.map((place) => place.id) });
    // Recover structural work first; the shared publication gate below owns content corrections.
    return candidate;
  } catch {
    // Keep the earlier checkpoint; the normal repair path can use its saved research.
    return undefined;
  }
}

export function createPlanningGenerationService(dependencies: {
  maintenance?: MaintenanceControl;
  store: SqliteWorkspaceStore;
  codex: BlueprintRuntime;
  semanticShadow?: SemanticShadowConfig;
  semanticDraftCanary?: SemanticDraftCanaryConfig;
  plannedPlaceImageEnrichment?: boolean;
  itineraryContentReview?: (request: SkillItineraryReviewRequest) => Promise<SkillItineraryReviewFinding[]>;
  probeImageUrl?: (url: string) => Promise<boolean | undefined>;
  lookupKnownImages?: Parameters<typeof runPlannedPlaceImagePass>[0]["lookupKnownImages"];
  onSemanticShadowDiagnostic?: (event: SemanticShadowDiagnosticEvent | { event: "scheduling_branch_reached"; generationKey: string }) => void;
  runWithGenerationContext?: <T>(context: MahGenerationContext, operation: () => Promise<T>) => Promise<T>;
  runWithStageContext?: <T>(identity: MahStageContext, operation: () => Promise<T>) => Promise<T>;
  cancelCarrierGeneration?: (generationKey: string) => Promise<void>;
  rejectCarrierBusinessPayload?: (input: { generationKey: string; operation: MahStageOperation; batchId?: string; candidate: unknown; code: string; message: string }) => void;
  authoritativeMahCarriers?: boolean;
  carrierForCandidate?: (candidate: unknown) => { carrierTaskId: string; requestSha256: string; resultSha256: string; producer?:BookingRelationshipProducer } | undefined;
  setGeneratingPlan: (running: boolean) => void;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
}): PlanningGenerationService {
  const { store, codex, setGeneratingPlan, logGenerationFailure } = dependencies;
  const generateResearchBatch = (input: Parameters<CodexRuntimeAdapter["generateSkillResearchBatch"]>[0]) =>
    codex.generateSkillResearchBatch({ ...input, deferPlaceImages: dependencies.plannedPlaceImageEnrichment === true });
  const stage = <T>(phase: string, round: number, operation: () => Promise<T>, scope?: string, qualityRepair?: MahQualityRepairContext): Promise<T> =>
    dependencies.runWithStageContext ? dependencies.runWithStageContext({ phase, round, ...(scope === undefined ? {} : { scope }), ...(qualityRepair ? { qualityRepair } : {}) }, operation) : operation();
  const semanticShadow = dependencies.semanticShadow ?? { enabled: false, sampleRate: 0, timeoutMs: 10 * 60_000 };
  const semanticDraftCanary = dependencies.semanticDraftCanary ?? { enabled: false, localEnvironment: false, allowedSessionIds: [] };
  const jobs = new Map<string, PlanGenerationJob>();
  const jobRuns = new Map<string, Promise<void>>();
  const imageContinuations = new Map<string, Promise<unknown>>();
  const blueprintGenerationKey = (sessionId: string, proposalVersion: number) => selectedBlueprintGenerationKey(
    sessionId,
    proposalVersion,
    (key) => store.getBlueprintGeneration(key),
    semanticDraftCanaryEligible(semanticDraftCanary, sessionId)
  );

  dependencies.maintenance?.observeGeneration(() => jobRuns.size + imageContinuations.size);

  function enqueuePlanningSessionGeneration(session: PlanningSession, workspace: WorkspaceSnapshot): PlanGenerationJob {
    dependencies.maintenance?.assertAccepting();
    assertPlanningGenerationProposal(session);
    const generationKey = blueprintGenerationKey(session.id, session.confirmedProposalVersion);
    const persisted = store.getBlueprintGeneration(generationKey);
    if (session.status === "generating" && (!persisted || persisted.proposalRef.sessionId !== session.id
      || persisted.proposalRef.proposalVersion !== session.confirmedProposalVersion
      || ["cancelled", "superseded", "completed"].includes(persisted.status))) {
      throw new MahCarrierError("mah_generation_context_missing", "恢复缺少与当前确认版本精确匹配的可继续生成记录。");
    }
    const unresolved = missingGenerationQuestions(session.facts, session.messages);
    if (unresolved.length) throw new RuntimeAdapterError("invalid_request", `Complete the generation-critical facts before Plan generation: ${unresolved.map((item) => item.key).join(", ")}.`);
    const existing = jobs.get(session.id);
    if (existing?.status === "running") return existing;
    const controller = new AbortController();
    const run = store.startPlanGenerationRun({ runtimeKind: "codex", trigger: "web" });
    const now = new Date().toISOString();
    const strategy = generationStrategyFromKey(generationKey);
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
    const execute = () => executePlanningSessionGeneration(job, session, workspace);
    const execution = (dependencies.runWithGenerationContext
      ? dependencies.runWithGenerationContext({ generationKey, proposalRef: generation.proposalRef, skillLineage: generation.skillLineage }, execute)
      : execute());
    const tracked = execution.finally(() => { if (jobRuns.get(session.id) === tracked) jobRuns.delete(session.id); });
    jobRuns.set(session.id, tracked);
    void tracked;
    return job;
  }

  async function executePlanningSessionGeneration(job: PlanGenerationJob, session: PlanningSession, workspace: WorkspaceSnapshot) {
    const requestStartedAt = Date.now();
    let researchRuntimeMs = 0;
    let prefetchedImages: ReturnType<typeof prefetchPlannedPlaceImages> | undefined;
    let semanticOutcome: Awaited<ReturnType<typeof generateSemanticDraft>> | undefined;
    let canaryInputContext: ReturnType<typeof semanticCanaryInputContext> | undefined;
    let importExecuted = false;
    let importCompleted = false;
    let compileExecuted = false;
    let compileCompleted = false;
    let pendingResearchArtifact: { scopeLabel: string; artifact: SkillResearchBatchArtifact; rejected?: SkillResearchBatchArtifact } | undefined;
    let pendingItineraryArtifact: SkillItineraryArtifact | undefined;
    let rejectedItineraryArtifact: SkillItineraryArtifact | undefined;
    try {
      if (!dependencies.authoritativeMahCarriers && workspace.runtime.selectedKind !== "codex") throw new MahCarrierError("mah_provider_route_unsupported", "当前生成入口需要可用的执行配置。");
      const generation = store.getBlueprintGeneration(job.generationKey);
      if (!generation) throw new Error("Blueprint Generation checkpoint is missing.");
      const skillLineage = generation.skillLineage;
      blueprintPolicyKind(skillLineage);
      const sessionBookings = store.listTravelBookingsForPlanningSession(session.id);
      const bookingConstraints = blueprintBookingConstraintsFromTravelBookings(sessionBookings);
      const request = `${planningRequestForGenerationWithBookings(session, sessionBookings)}\n\n${ITINERARY_CONTENT_REQUIREMENTS}`;
      const profile = {
        assistantPersonality: workspace.profile.assistantPersonality ?? "local_insider", displayName: workspace.profile.displayName,
        preferredLanguage: dependencies.authoritativeMahCarriers ? workspace.profile.preferredLanguage : "English",
        nationality: workspace.profile.nationality,
        gender: workspace.profile.gender,
        immigrationStatus: workspace.profile.immigrationStatus
      };
      const scopes = planningResearchScopes(session);
      const countryGateway = planningCountryGatewayContext(session);
      const requiresRegionalResearch = countryGateway && !planningExplicitGatewayOnly(session, countryGateway.city);
      if (job.strategy === "semantic_canary") {
        canaryInputContext = semanticCanaryInputContext(session, sessionBookings, scopes);
        assertSemanticCanaryDestinationInput(session, sessionBookings, canaryInputContext);
      }
      let research = store.getResearchSetByGenerationKey(job.generationKey);
      if (research && (research.skillLineage.skillId !== skillLineage.skillId || research.skillLineage.skillVersion !== skillLineage.skillVersion)) throw new Error("Research checkpoint policy does not match this Blueprint Generation.");
      const completedScopes = new Set(research?.batches.filter((batch) => batch.status === "completed").map((batch) => batch.scopeLabel) ?? []);
      for (const [index, scopeLabel] of scopes.entries()) {
        if (completedScopes.has(scopeLabel)) continue;
        const batchId = researchScopeBatchId(index, scopeLabel);
        assertGenerationNotCancelled(job, session);
        updateGenerationJob(job, { stage: "research", scopeLabel, savedPlaceCount: research?.places.length ?? 0, message: `Researching ${scopeLabel}.` });
        updatePersistedGeneration(job.generationKey, "research", "running");
        appendGenerationEvent(job.generationKey, "research", "running", `Started Skill research for ${scopeLabel}.`, {
          scopeLabel,
          savedPlaceCount: research?.places.length ?? 0,
          nextAction: "Save this geographic batch before continuing."
        });
        const researchStartedAt = Date.now();
        let artifact = await withSingleTransientRetry(
          () => generateResearchBatch({ request, batch: { id: batchId, scopeLabel }, signal: job.controller.signal, profile, skillLineage }),
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
        const researchContext = {
          researchSetId: research?.id ?? `research-${randomUUID()}`,
          generationKey: job.generationKey,
          proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
          skillLineage,
          createdAt: research?.createdAt ?? checkpointTime,
          updatedAt: checkpointTime
        };
        pendingResearchArtifact = { scopeLabel, artifact };
        let incoming;
        try {
          incoming = importSkillResearchBatches([artifact], researchContext);
        } catch (error) {
          if (!isResearchIntegrityFailure(error)) throw error;
          dependencies.rejectCarrierBusinessPayload?.({ generationKey: job.generationKey, operation: "research_batch", batchId, candidate: artifact, code: "mah_business_integrity_failed", message: error.message });
          appendGenerationEvent(job.generationKey, "research", "running", `Research contract rejected ${scopeLabel}; attempting one bounded repair.`, { scopeLabel, savedPlaceCount: research?.places.length ?? 0 });
          const repairStartedAt = Date.now();
          artifact = await generateResearchBatch({ request, batch: { id: batchId, scopeLabel }, signal: job.controller.signal, profile, skillLineage, repair: { rejected: artifact, issues: [error.message] } });
          researchRuntimeMs += Date.now() - repairStartedAt;
          assertGenerationNotCancelled(job, session);
          const rejectedArtifact = pendingResearchArtifact.artifact;
          pendingResearchArtifact = { scopeLabel, artifact, rejected: rejectedArtifact };
          assertResearchRepairPreservesPlaces(rejectedArtifact, artifact);
          try {
            incoming = importSkillResearchBatches([artifact], researchContext);
          } catch (repairError) {
            dependencies.rejectCarrierBusinessPayload?.({ generationKey: job.generationKey, operation: "research_batch", batchId, candidate: artifact, code: "mah_business_integrity_failed", message: repairError instanceof Error ? repairError.message : "研究修复未通过领域校验。" });
            throw repairError;
          }
        }
        if (countryGateway && requiresRegionalResearch && scopes.length > 1 && index === scopes.length - 1 && !hasPlaceOutsideGateway([...(research?.places ?? []), ...incoming.places], countryGateway.city)) {
          dependencies.rejectCarrierBusinessPayload?.({ generationKey: job.generationKey, operation: "research_batch", batchId, candidate: artifact, code: "mah_business_integrity_failed", message: `研究结果没有覆盖 ${countryGateway.city} 之外的可用区域。` });
          appendGenerationEvent(job.generationKey, "research", "running", `Countrywide research found no usable region outside ${countryGateway.city}; requesting one focused correction.`, { scopeLabel, savedPlaceCount: research?.places.length ?? 0 });
          const rejectedArtifact = artifact;
          const repairStartedAt = Date.now();
          artifact = await stage("研究区域补全", 1, () => generateResearchBatch({
            request,
            batch: { id: batchId, scopeLabel },
            signal: job.controller.signal,
            profile,
            skillLineage,
            repair: { rejected: rejectedArtifact, issues: [`${countryGateway.city} is the entry/exit gateway, not the entire ${countryGateway.country} trip. Research at least one feasible region beyond ${countryGateway.city}, with concrete source-backed attractions and specific overnight-base candidates. Preserve existing researched places; do not invent costs or claim the route is affordable without evidence.`] }
          }));
          researchRuntimeMs += Date.now() - repairStartedAt;
          assertGenerationNotCancelled(job, session);
          pendingResearchArtifact = { scopeLabel, artifact, rejected: rejectedArtifact };
          assertResearchRepairPreservesPlaces(rejectedArtifact, artifact);
          incoming = importSkillResearchBatches([artifact], researchContext);
          if (!hasPlaceOutsideGateway([...(research?.places ?? []), ...incoming.places], countryGateway.city)) {
            dependencies.rejectCarrierBusinessPayload?.({ generationKey: job.generationKey, operation: "research_batch", batchId, candidate: artifact, code: "mah_business_integrity_failed", message: `修复后的研究仍没有覆盖 ${countryGateway.city} 之外的可用区域。` });
            throw new Error(`Destination research could not identify a region beyond the ${countryGateway.city} entry/exit gateway for the ${countryGateway.country} trip.`);
          }
        }
        pendingResearchArtifact = undefined;
        const remaining = scopes.slice(index + 1).some((scope) => !completedScopes.has(scope));
        const researchCheckpoint = mergeResearchSetCheckpoint(research, incoming, { status: remaining ? "researching" : "completed", updatedAt: checkpointTime });
        research = store.saveResearchSet(researchCheckpoint, carrierCheckpoint({
          generationKey: job.generationKey,
          operation: "research_batch",
          batchId,
          candidate: artifact,
          stage: "research",
          status: "running",
          detail: `Saved ${scopeLabel} research checkpoint.`,
          createdAt: checkpointTime,
          scopeLabel,
          savedPlaceCount: researchCheckpoint.places.length,
          nextAction: remaining ? "Research the next geographic batch." : "Build the itinerary from the complete Research Set."
        }));
        completedScopes.add(scopeLabel);
        updateGenerationJob(job, { savedPlaceCount: research.places.length, message: `Saved ${research.places.length} researched places.` });
      }
      if (!research) throw new Error("The Skill did not produce a Research Set.");
      if (research.status !== "completed") {
        research = store.saveResearchSet({ ...research, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      if (accommodationResearchNeeded(research, bookingConstraints, session)) {
        const accommodationScope = `${scopes.join(" / ")} accommodation anchors`;
        updateGenerationJob(job, { stage: "research", scopeLabel: accommodationScope, savedPlaceCount: research.places.length, message: "Researching specific accommodation anchors." });
        updatePersistedGeneration(job.generationKey, "research", "running");
        appendGenerationEvent(job.generationKey, "research", "running", "Started one bounded accommodation-only research pass because no user-selected stay or credible lodging candidate is available.", { scopeLabel: accommodationScope, savedPlaceCount: research.places.length, nextAction: "Save specific, sourced lodging candidates before daily planning." });
        const accommodationStartedAt = Date.now();
        let artifact = await withSingleTransientRetry(
          () => generateResearchBatch({ request: buildAccommodationResearchRequest(request), batch: { id: "accommodation-anchors", scopeLabel: accommodationScope }, signal: job.controller.signal, profile, skillLineage }),
          () => appendGenerationEvent(job.generationKey, "research", "running", "Transient accommodation research failure; retrying this bounded batch once.", { scopeLabel: accommodationScope, savedPlaceCount: research!.places.length })
        );
        researchRuntimeMs += Date.now() - accommodationStartedAt;
        assertGenerationNotCancelled(job, session);
        const checkpointTime = new Date().toISOString();
        const accommodationContext = {
          researchSetId: research.id,
          generationKey: job.generationKey,
          proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
          skillLineage,
          createdAt: research.createdAt,
          updatedAt: checkpointTime
        };
        pendingResearchArtifact = { scopeLabel: accommodationScope, artifact: asAccommodationResearchBatch(artifact) };
        let incoming;
        try {
          incoming = importSkillResearchBatches([pendingResearchArtifact.artifact], accommodationContext);
        } catch (error) {
          if (!isResearchIntegrityFailure(error)) throw error;
          dependencies.rejectCarrierBusinessPayload?.({ generationKey: job.generationKey, operation: "research_batch", batchId: "accommodation-anchors", candidate: artifact, code: "mah_business_integrity_failed", message: error.message });
          appendGenerationEvent(job.generationKey, "research", "running", "Accommodation research contract rejected; attempting one bounded repair.", { scopeLabel: accommodationScope, savedPlaceCount: research.places.length });
          const repairStartedAt = Date.now();
          artifact = await generateResearchBatch({ request: buildAccommodationResearchRequest(request), batch: { id: "accommodation-anchors", scopeLabel: accommodationScope }, signal: job.controller.signal, profile, skillLineage, repair: { rejected: pendingResearchArtifact.artifact, issues: [error.message] } });
          researchRuntimeMs += Date.now() - repairStartedAt;
          assertGenerationNotCancelled(job, session);
          const rejectedArtifact = pendingResearchArtifact.artifact;
          pendingResearchArtifact = { scopeLabel: accommodationScope, artifact: asAccommodationResearchBatch(artifact), rejected: rejectedArtifact };
          assertResearchRepairPreservesPlaces(rejectedArtifact, pendingResearchArtifact.artifact);
          try {
            incoming = importSkillResearchBatches([pendingResearchArtifact.artifact], accommodationContext);
          } catch (repairError) {
            dependencies.rejectCarrierBusinessPayload?.({ generationKey: job.generationKey, operation: "research_batch", batchId: "accommodation-anchors", candidate: artifact, code: "mah_business_integrity_failed", message: repairError instanceof Error ? repairError.message : "住宿研究修复未通过领域校验。" });
            throw repairError;
          }
        }
        pendingResearchArtifact = undefined;
        const accommodationCheckpoint = mergeResearchSetCheckpoint(research, incoming, { status: "completed", updatedAt: checkpointTime });
        research = store.saveResearchSet(accommodationCheckpoint, carrierCheckpoint({
          generationKey: job.generationKey,
          operation: "research_batch",
          batchId: "accommodation-anchors",
          candidate: artifact,
          stage: "research",
          status: "running",
          detail: "Saved accommodation candidates for itinerary planning.",
          createdAt: checkpointTime,
          scopeLabel: accommodationScope,
          savedPlaceCount: accommodationCheckpoint.places.length,
          nextAction: "Choose a recommended stay for each overnight base. These stays are not booked."
        }));
      }
      let completedResearch = research;
      if (dependencies.plannedPlaceImageEnrichment) {
        const checkpoint = completedResearch;
        prefetchedImages = prefetchPlannedPlaceImages({
          places: checkpoint.places,
          lookup: dependencies.lookupKnownImages ?? ((places, signal) => searchWikipediaPlaceImages(places, { signal, sources: checkpoint.sources })),
          signal: job.controller.signal,
          onError: error => logGenerationFailure({ generationKey: job.generationKey, stage: "image_prefetch", error: errorDiagnostic(error) }, "Read-only image prefetch failed; final lookup remains available")
        });
        // Start the public read before composition without waiting for its result.
        await Promise.resolve();
      }
      assertGenerationNotCancelled(job, session);
      let blueprint = store.getTripBlueprintByGenerationKey(job.generationKey);
      // A failed targeted-research stage may have saved the catalog before its Blueprint.
      if (blueprint && completedResearch.places.some((place) => !blueprint!.places.some((saved) => saved.id === place.id))) {
        blueprint = saveGenerationBlueprint(mergeResearchCatalogIntoBlueprint(blueprint, completedResearch, new Date().toISOString()));
        appendGenerationEvent(job.generationKey, "import", "running", "Reconciled the saved itinerary with newer completed research without changing its route.", { savedPlaceCount: blueprint.places.length });
      }
      if (job.strategy !== "semantic_canary" && !dependencies.authoritativeMahCarriers) {
        const recovered = recoverValidatedDiagnosticBlueprint({ store, generationKey: job.generationKey, research: completedResearch, blueprint, session, bookingConstraints });
        if (recovered) {
          blueprint = saveGenerationBlueprint(recovered);
          appendGenerationEvent(job.generationKey, "import", "running", "Recovered a structurally valid saved itinerary for the shared publication review.", {
            savedPlaceCount: blueprint.places.length,
            nextAction: "Continue from the validated Blueprint instead of repeating completed research and itinerary work."
          });
        }
      }
      if (!blueprint) {
        updateGenerationJob(job, { stage: "itinerary", scopeLabel: undefined, savedPlaceCount: completedResearch.places.length, message: "Building the daily itinerary from saved places." });
        updatePersistedGeneration(job.generationKey, "itinerary", "running");
        if (job.strategy === "semantic_canary") {
          appendGenerationEvent(job.generationKey, "itinerary", "running", "Started direct Semantic Planner generation from the complete Research Set.", { savedPlaceCount: completedResearch.places.length, nextAction: "Validate, optionally repair once, and structure the final Semantic plan." });
          semanticOutcome = await stage("语义正式生成", 1, () => generateSemanticDraft({ codex, request, profile, research: completedResearch, destinations: scopes, bookingConstraints, session, signal: job.controller.signal }));
          assertGenerationNotCancelled(job, session);
          updateGenerationJob(job, { stage: "import", message: "Importing the validated final Semantic plan." });
          updatePersistedGeneration(job.generationKey, "import", "running");
          importExecuted = true;
          const semanticProducer=dependencies.carrierForCandidate?.(semanticOutcome.finalPlan)?.producer;
          blueprint = importSkillItinerary(completedResearch, semanticOutcome.structured.artifact, {
            blueprintId: `blueprint-${randomUUID()}`,
            blueprintVersion: 1,
            createdAt: new Date().toISOString(),
            bookingConstraints: semanticOutcome.structured.preservedBookingConstraints,
            ...(semanticProducer?{bookingRelationshipProducer:semanticProducer}: {})
          });
          importCompleted = true;
          rejectUnconsumedCandidates(job.generationKey, ["semantic_plan", "semantic_repair"], [semanticOutcome.finalPlan]);
          blueprint = saveGenerationBlueprint(blueprint, [semanticOutcome.finalPlan]);
          appendGenerationEvent(job.generationKey, "import", "running", `Validated Semantic plan imported (${semanticOutcome.finalReport.result}; repair=${semanticOutcome.repairAttempted}).`, { savedPlaceCount: blueprint.places.length, nextAction: "Compile the same final Semantic plan into a reviewable Draft." });
        } else {
          appendGenerationEvent(job.generationKey, "itinerary", "running", "Started Skill itinerary generation from the complete Research Set.", { savedPlaceCount: completedResearch.places.length, nextAction: "Publish the Trip Blueprint after structural validation." });
          let artifact = await withSingleTransientRetry(
            () => codex.generateSkillItinerary({ request, bookingRelationshipSourceUnits:bookingRelationshipSourceUnits(bookingConstraints), research: completedResearch, signal: job.controller.signal, profile }),
            () => appendGenerationEvent(job.generationKey, "itinerary", "running", "Transient itinerary failure; retrying this stage once.", { savedPlaceCount: completedResearch.places.length })
          );
          assertGenerationNotCancelled(job, session);
          updateGenerationJob(job, { stage: "import", message: "Validating and publishing the Trip Blueprint." });
          updatePersistedGeneration(job.generationKey, "import", "running");
          const createdAt = new Date().toISOString();
          pendingItineraryArtifact = artifact;
          const producer=dependencies.carrierForCandidate?.(artifact)?.producer;
          const importContext = { ...(producer?{bookingRelationshipProducer:producer}: {}), blueprintId: `blueprint-${randomUUID()}`, blueprintVersion: 1, createdAt, bookingConstraints };
          try {
            blueprint = importSkillItinerary(completedResearch, artifact, importContext);
          } catch (error) {
            if (!isBlueprintIntegrityFailure(error)) throw error;
            dependencies.rejectCarrierBusinessPayload?.({ generationKey: job.generationKey, operation: "itinerary_draft", candidate: artifact,
              code: "mah_business_integrity_failed", message: "行程候选未通过领域完整性校验。" });
            appendGenerationEvent(job.generationKey, "import", "running", "Itinerary contract rejected; attempting one bounded repair.", { savedPlaceCount: completedResearch.places.length });
            rejectedItineraryArtifact = artifact;
            artifact = await codex.generateSkillItinerary({ request, bookingRelationshipSourceUnits:bookingRelationshipSourceUnits(bookingConstraints), research: completedResearch, signal: job.controller.signal, profile, repair: { rejected: artifact, issues: [error.message] } });
            assertGenerationNotCancelled(job, session);
            pendingItineraryArtifact = artifact;
            assertItineraryRepairPreservesStops(rejectedItineraryArtifact, artifact);
            const repairProducer=dependencies.carrierForCandidate?.(artifact)?.producer;
            blueprint = importSkillItinerary(completedResearch, artifact, {blueprintId:importContext.blueprintId,blueprintVersion:importContext.blueprintVersion,createdAt,bookingConstraints,...(repairProducer?{bookingRelationshipProducer:repairProducer}:{})});
          }
          blueprint = normalizeUnverifiedBookedTimes(materializeRecommendedAccommodationAnchors(blueprint).blueprint);
          blueprint = saveGenerationBlueprint(blueprint, [artifact]);
          appendGenerationEvent(job.generationKey, "import", "running", "Saved structurally valid itinerary. Content corrections will run together after required day and transport completion.", { savedPlaceCount: blueprint.places.length });
          pendingItineraryArtifact = undefined;
          rejectedItineraryArtifact = undefined;
          blueprint = saveGenerationBlueprint(blueprint);
          appendGenerationEvent(job.generationKey, "import", "running", "Trip Blueprint published with every Research Set place preserved.", { savedPlaceCount: blueprint.places.length, nextAction: "Compile deterministic execution work for review." });
        }
      }
      const completed = await completeUnderPlannedDays({ job, session, request, profile, skillLineage, research: completedResearch, blueprint, bookingConstraints,
        onArtifact: (artifact, rejected) => { pendingItineraryArtifact = artifact; rejectedItineraryArtifact = rejected; }
      });
      completedResearch = completed.research;
      blueprint = completed.blueprint;
      const exploreSupply = await completeExploreSupply({ job, session, request, profile, skillLineage, research: completedResearch, blueprint });
      completedResearch = exploreSupply.research;
      blueprint = exploreSupply.blueprint;
      const outboundOrigin = session.facts.find(fact => fact.key === "arrival_origin" && fact.confirmed)?.value;
      const firstDay = blueprint.days[0];
      if (outboundOrigin && firstDay?.kind === "transit" && !firstDay.blocks?.length && !firstDay.stops.length && /depart|出发/iu.test(firstDay.title)) {
        let prepared = materializeOutboundDeparture(blueprint, session, completedResearch);
        if (prepared === blueprint) {
          const artifact = await generateResearchBatch({ request: `${request}\n\nResearch only the explicitly confirmed outbound origin airport: ${outboundOrigin}. Return its exact name with airport code, city, coordinates and source. Do not infer a different airport, flight time, terminal, airline, pickup point or booking.`, batch: { id: "outbound-origin-airport", scopeLabel: outboundOrigin }, signal: job.controller.signal, profile, skillLineage });
          assertGenerationNotCancelled(job, session);
          const checkpointTime = new Date().toISOString();
          const incoming = importSkillResearchBatches([sameBatchRelationshipsOnly(artifact)], { researchSetId: completedResearch.id, generationKey: job.generationKey, proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! }, skillLineage, createdAt: completedResearch.createdAt, updatedAt: checkpointTime });
          const outboundCheckpoint = mergeResearchSetCheckpoint(completedResearch, incoming, { status: "completed", updatedAt: checkpointTime });
          completedResearch = store.saveResearchSet(outboundCheckpoint, carrierCheckpoint({
            generationKey: job.generationKey,
            operation: "research_batch",
            batchId: "outbound-origin-airport",
          candidate: artifact,
            stage: "research",
            status: "running",
            detail: "Saved research for the departure airport confirmed by the traveler.",
            createdAt: checkpointTime,
            scopeLabel: outboundOrigin,
            savedPlaceCount: outboundCheckpoint.places.length,
            nextAction: "Add the confirmed departure point to the route."
          }));
          blueprint = mergeResearchCatalogIntoBlueprint(blueprint, completedResearch, checkpointTime);
          prepared = materializeOutboundDeparture(blueprint, session, completedResearch);
          if (prepared === blueprint) throw new Error("The confirmed outbound airport could not be resolved. Complete the departure airport before publishing the trip.");
        }
        blueprint = saveGenerationBlueprint(prepared);
      }
      const flightGaps = flightOriginGaps(blueprint);
      if (flightGaps.length) {
        const hasAirportCandidate = flightGaps.every((gap) => completedResearch.places.some((place) =>
          !place.accommodation && !/\b(?:hotel|motel|lodge|hostel)\b/iu.test(place.category) &&
          /\bairport\b|机场/iu.test(`${place.category} ${place.name}`) && place.coordinates && place.city?.trim().toLocaleLowerCase() === gap.city.trim().toLocaleLowerCase()
        ));
        if (!hasAirportCandidate) {
          const scopeLabel = `Departure airports for ${flightGaps.map((gap) => gap.city).join(" / ")}`;
          updateGenerationJob(job, { stage: "research", scopeLabel, savedPlaceCount: completedResearch.places.length, message: "Checking flight departure airports before final review." });
          updatePersistedGeneration(job.generationKey, "research", "running");
          appendGenerationEvent(job.generationKey, "research", "running", `Final review found ${flightGaps.length} flight day(s) without departure-airport route nodes.`, { scopeLabel, savedPlaceCount: completedResearch.places.length });
          const artifact = await generateResearchBatch({
            request: `${request}\n\nTargeted transport-node research only. For these planned flights, find the one real passenger departure airport in each origin city and return its exact name, city, category airport, coordinates, and an official source. Do not add attractions, prices, dates, flights, hotels, or unverified transfer times. Flights: ${JSON.stringify(flightGaps)}.`,
            batch: { id: "flight-origin-airports", scopeLabel }, signal: job.controller.signal, profile, skillLineage
          });
          assertGenerationNotCancelled(job, session);
          const checkpointTime = new Date().toISOString();
          const incoming = importSkillResearchBatches([sameBatchRelationshipsOnly(artifact)], {
            researchSetId: completedResearch.id, generationKey: job.generationKey,
            proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
            skillLineage, createdAt: completedResearch.createdAt, updatedAt: checkpointTime
          });
          const flightCheckpoint = mergeResearchSetCheckpoint(completedResearch, incoming, { status: "completed", updatedAt: checkpointTime });
          completedResearch = store.saveResearchSet(flightCheckpoint, carrierCheckpoint({
            generationKey: job.generationKey,
            operation: "research_batch",
            batchId: "flight-origin-airports",
          candidate: artifact,
            stage: "research",
            status: "running",
            detail: "Saved validated research for the flight departure airport.",
            createdAt: checkpointTime,
            scopeLabel,
            savedPlaceCount: flightCheckpoint.places.length,
            nextAction: "Complete the flight departure route."
          }));
          blueprint = mergeResearchCatalogIntoBlueprint(blueprint, completedResearch, checkpointTime);
        }
        const completed = addResearchedFlightOrigins(blueprint, completedResearch);
        if (completed.unresolved.length) throw new Error(`Trip Blueprint review could not resolve flight departure airports for ${completed.unresolved.map((gap) => `${gap.date} ${gap.city}`).join(", ")}.`);
        blueprint = saveGenerationBlueprint(completed.blueprint);
        appendGenerationEvent(job.generationKey, "import", "running", `Final review completed ${flightGaps.length} flight origin route node(s).`, { savedPlaceCount: blueprint.places.length });
      }
      const gatewayGaps = gatewayNodeGaps(blueprint, session);
      if (gatewayGaps.length) {
        const missingCandidates = gatewayGaps.some((gap) => !researchedGatewayForGap(blueprint!, completedResearch, gap));
        if (missingCandidates) {
          const scopeLabel = "Traveler-confirmed arrival and departure transport nodes";
          updateGenerationJob(job, { stage: "research", scopeLabel, savedPlaceCount: completedResearch.places.length, message: "Researching confirmed airport and station route nodes." });
          updatePersistedGeneration(job.generationKey, "research", "running");
          appendGenerationEvent(job.generationKey, "research", "running", `Final review found ${gatewayGaps.length} missing traveler-confirmed transport node(s).`, { scopeLabel, savedPlaceCount: completedResearch.places.length });
          const artifact = await generateResearchBatch({
            request: `${request}\n\nTargeted transport-node research only. Return the exact real passenger airports or railway stations named by the traveler, with name, city, appropriate category, verified coordinates where available, and official source. Do not add attractions, hotels, services, departure times, or invented transfer durations. Missing nodes: ${JSON.stringify(gatewayGaps)}.`,
            batch: { id: "confirmed-gateway-nodes", scopeLabel }, signal: job.controller.signal, profile, skillLineage
          });
          assertGenerationNotCancelled(job, session);
          const checkpointTime = new Date().toISOString();
          const incoming = importSkillResearchBatches([sameBatchRelationshipsOnly(artifact)], {
            researchSetId: completedResearch.id, generationKey: job.generationKey,
            proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
            skillLineage, createdAt: completedResearch.createdAt, updatedAt: checkpointTime
          });
          const gatewayCheckpoint = mergeResearchSetCheckpoint(completedResearch, incoming, { status: "completed", updatedAt: checkpointTime });
          completedResearch = store.saveResearchSet(gatewayCheckpoint, carrierCheckpoint({
            generationKey: job.generationKey,
            operation: "research_batch",
            batchId: "confirmed-gateway-nodes",
          candidate: artifact,
            stage: "research",
            status: "running",
            detail: "Saved research for the arrival and departure points confirmed by the traveler.",
            createdAt: checkpointTime,
            scopeLabel,
            savedPlaceCount: gatewayCheckpoint.places.length,
            nextAction: "Complete the confirmed arrival and departure route points."
          }));
          blueprint = mergeResearchCatalogIntoBlueprint(blueprint, completedResearch, checkpointTime);
        }
        const completed = addResearchedGatewayNodes(blueprint, completedResearch, session);
        if (completed.unresolved.length) throw new Error(`Trip Blueprint review could not resolve confirmed transport nodes for ${completed.unresolved.map((gap) => `${gap.date} ${gap.direction} ${gap.nodeKind}`).join(", ")}.`);
        blueprint = saveGenerationBlueprint(completed.blueprint);
        appendGenerationEvent(job.generationKey, "import", "running", `Final review completed ${gatewayGaps.length} traveler-confirmed transport node(s).`, { savedPlaceCount: blueprint.places.length });
      }
      const movementCorrected = correctImpossibleFlightMovements(normalizeUnverifiedBookedTimes(blueprint));
      if (JSON.stringify(movementCorrected.movements) !== JSON.stringify(blueprint.movements)) blueprint = saveGenerationBlueprint(movementCorrected);
      const departureCompleted = completeDepartureEndpoint(blueprint, session);
      if (JSON.stringify(departureCompleted.days) !== JSON.stringify(blueprint.days)) blueprint = saveGenerationBlueprint(departureCompleted);
      const departureTimed = materializeProposedHotelDepartures(blueprint, session);
      if (JSON.stringify(departureTimed.days) !== JSON.stringify(blueprint.days)) blueprint = saveGenerationBlueprint(departureTimed);
      if (JSON.stringify(blueprint.bookingConstraints ?? []) !== JSON.stringify(bookingConstraints)) {
        blueprint = saveGenerationBlueprint(reconcileBookingRelationshipAssessment({ ...blueprint }, bookingConstraints));
      }
      blueprint = saveGenerationBlueprint(normalizeDayCandidates(blueprint));
      let reviewRecommendations: SkillItineraryReviewFinding[] = [];
      const auditPublication = async (candidate: TripBlueprint) => {
        const deterministic = reviewItineraryForPublication(candidate, session);
        if (!dependencies.itineraryContentReview) return deterministic;
        let reviewCandidate: SkillItineraryReviewFinding[] | undefined;
        const editorial = await auditItineraryContent({ store, generationKey: job.generationKey,
          useCache: !dependencies.authoritativeMahCarriers,
          request: { request, research: completedResearch, itinerary: itineraryArtifactFromBlueprint(candidate), profile, signal: job.controller.signal },
          review: async reviewRequest => {
            reviewCandidate = await dependencies.itineraryContentReview!(reviewRequest);
            return reviewCandidate;
          },
          onStart: (cached) => {
            updateGenerationJob(job, { stage: "import", message: cached ? "Reusing the saved content review." : "Reviewing route, daily pace and travel connections." });
            appendGenerationEvent(job.generationKey, "import", "running", cached ? "Reused the content review for this unchanged itinerary and evidence." : "Started independent itinerary content review using the saved facts and route.", { savedPlaceCount: candidate.places.length });
          }
        });
        assertGenerationNotCancelled(job, session);
        if (reviewCandidate) saveGenerationBlueprint(candidate, [reviewCandidate]);
        reviewRecommendations = editorial.filter((finding) => !finding.blocking);
        return [...deterministic, ...editorial.filter((finding) => finding.blocking)];
      };
      let publicationFindings = await auditPublication(blueprint);
      let rejectedCorrection: SkillItineraryArtifact | undefined;
      const consumedQualityRounds = dependencies.authoritativeMahCarriers ? store.generationCarriers.listForGeneration(job.generationKey)
        .filter(mapping => mapping.operation === "itinerary_repair" && ["imported", "artifact_invalid"].includes(mapping.status))
        .flatMap(mapping => { const identity = mahStageIdentity(mapping.request as MahStageRequest); return identity?.phase === "质量修复" ? [identity.round] : []; }) : [];
      for (let correctionIndex = Math.max(0, ...consumedQualityRounds); publicationFindings.length && job.strategy !== "semantic_canary" && correctionIndex < 2; correctionIndex += 1) {
        updateGenerationJob(job, { stage: "import", message: "Correcting final whole-trip review findings." });
        updatePersistedGeneration(job.generationKey, "import", "running");
        appendGenerationEvent(job.generationKey, "import", "running", `Final whole-trip review correction ${correctionIndex + 1}/2 for ${publicationFindings.length} issue(s).`, { savedPlaceCount: blueprint.places.length });
        const savedArtifact = itineraryArtifactFromBlueprint(blueprint);
        const rejected = rejectedCorrection ?? savedArtifact;
        const correctionFindings = [...publicationFindings, ...reviewRecommendations];
        const localCorrection = canUseDateLocalCorrection(publicationFindings, reviewRecommendations, Boolean(rejectedCorrection));
        const correctionDates = [...new Set(correctionFindings.flatMap((finding) => finding.date ? [finding.date] : []))];
        rejectedItineraryArtifact = rejected;
        pendingItineraryArtifact = await stage("质量修复", correctionIndex + 1, () => codex.generateSkillItinerary({
          request,
          bookingRelationshipSourceUnits:bookingRelationshipSourceUnits(bookingConstraints),
          research: completedResearch,
          signal: job.controller.signal,
          profile,
          ...(localCorrection ? { dayPatch: { original: savedArtifact, dates: correctionDates } } : {}),
          repair: { rejected, issues: [
            ...publicationFindings.map((finding) => `${finding.date ?? "Whole trip"}: ${finding.explanation} ${finding.repairInstruction}`),
            ...reviewRecommendations.map((finding) => `Optional improvement on ${finding.date ?? "the trip"}: ${finding.explanation} ${finding.repairInstruction} Apply only when supported; keep unresolved evidence local and preserve commitments.`)
          ] }
        }), "全行程", {
          affectedDates: correctionDates,
          allowRegionalReroute: publicationFindings.some(finding => ["destination_scope_collapse", "overextended_base", "route_efficiency"].includes(finding.code)),
          preserveTripMetadata: localCorrection,
          findings: publicationFindings.map(finding => ({ code: finding.code, ...(finding.date ? { date: finding.date } : {}) }))
        });
        const correctionCandidate = pendingItineraryArtifact;
        const receipt = dependencies.carrierForCandidate?.(correctionCandidate);
        const frozenRepair = receipt ? mahBusinessParserContext(store.generationCarriers.getByTaskId(receipt.carrierTaskId)!.request as MahStageRequest)?.qualityRepair : undefined;
        if (dependencies.authoritativeMahCarriers && !frozenRepair) throw new MahCarrierError("mah_parser_context_missing", "质量修复缺少冻结的合并决策。");
        assertGenerationNotCancelled(job, session);
        try {
          pendingItineraryArtifact = restoreUnrelatedQualityRepairDays(
            savedArtifact,
            pendingItineraryArtifact,
            frozenRepair?.affectedDates ?? correctionDates,
            frozenRepair?.allowRegionalReroute ?? publicationFindings.some((finding) => ["destination_scope_collapse", "overextended_base", "route_efficiency"].includes(finding.code)),
            frozenRepair?.preserveTripMetadata ?? localCorrection
          );
          assertItineraryQualityRepairPreservesStops(savedArtifact, pendingItineraryArtifact, completedResearch, frozenRepair?.findings ?? publicationFindings, bookingConstraints);
          const correctionProducer=dependencies.carrierForCandidate?.(correctionCandidate)?.producer;
          const retainedAssessment=(frozenRepair?.preserveTripMetadata??localCorrection)?blueprint.bookingRelationshipAssessment:undefined;
          let corrected = normalizeUnverifiedBookedTimes(materializeRecommendedAccommodationAnchors(importSkillItinerary(completedResearch, pendingItineraryArtifact, {
            blueprintId: blueprint.id,
            blueprintVersion: blueprint.version + 1,
            createdAt: new Date().toISOString(),
            bookingConstraints,
            ...(retainedAssessment?{bookingRelationshipAssessment:retainedAssessment}:correctionProducer?{bookingRelationshipProducer:correctionProducer}:{})
          })).blueprint);
          corrected = materializeProposedHotelDepartures(completeDepartureEndpoint(correctImpossibleFlightMovements(corrected), session), session);
          corrected = normalizeDayCandidates(corrected);
          assertTripBlueprintIntegrity(corrected, { expectedResearchPlaceIds: completedResearch.places.map((place) => place.id) });
          blueprint = saveGenerationBlueprint(corrected, [correctionCandidate]);
          rejectedCorrection = undefined;
          publicationFindings = await auditPublication(blueprint);
        } catch (error) {
          if (!(error instanceof Error) || (!error.message.startsWith("Trip Blueprint failed integrity:") && !error.message.startsWith("Itinerary repair removed"))) throw error;
          rejectCandidate(correctionCandidate);
          // A bad model correction cannot overwrite the last valid checkpoint or bypass the remaining attempt.
          rejectedCorrection = pendingItineraryArtifact;
          publicationFindings = [...publicationFindings.filter((finding) => finding.code !== "repair_contract_failure"), {
            code: "repair_contract_failure", explanation: error.message,
            repairInstruction: "Correct this rejected output against the saved Research Set. Preserve every date and protected commitment; return a structurally valid complete artifact."
          }];
          appendGenerationEvent(job.generationKey, "import", "running", `A correction failed the itinerary contract. Kept the last valid checkpoint; the shared repair budget will handle the rejected output. Reason: ${error.message}`, { savedPlaceCount: blueprint.places.length });
        }
        if (!publicationFindings.length) {
          pendingItineraryArtifact = undefined;
          rejectedItineraryArtifact = undefined;
        }
      }
      if (publicationFindings.length) throw new Error(`Trip Blueprint final review failed: ${publicationFindings.map((finding) => finding.explanation).join("; ")}`);
      appendGenerationEvent(job.generationKey, "import", "running", "Final whole-trip review passed.", { savedPlaceCount: blueprint.places.length });
      if (dependencies.plannedPlaceImageEnrichment) {
        const imageCoverage = await enrichPlannedPlaceImages({ job, session, request, profile, scopes, research: completedResearch, blueprint, ...(prefetchedImages ? { prefetchedImages } : {}) });
        completedResearch = imageCoverage.research;
        blueprint = imageCoverage.blueprint;
      }
      assertGenerationNotCancelled(job, session);
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
      const readyAt = new Date().toISOString();
      const carrierTaskIds = store.generationCarriers.listForGeneration(job.generationKey)
        .filter((mapping) => mapping.status === "imported")
        .map((mapping) => mapping.carrierTaskId);
      const carrierCompletion = dependencies.authoritativeMahCarriers ? {
        generationKey: job.generationKey,
        carrierTaskIds,
        expectedCarriers: carrierTaskIds.map(carrierTaskId => expectedCarrier(store.generationCarriers.getByTaskId(carrierTaskId)!)),
        generationEvent: generationCheckpointEvent(store, {
          id: `mah-ready-${compilation.lineage.compilationKey}`,
          generationKey: job.generationKey,
          stage: "ready" as const,
          status: "completed" as const,
          detail: "The Trip Blueprint and Draft Plan are ready for review. Execution has not started.",
          savedPlaceCount: blueprint.places.length,
          nextAction: "Review the complete itinerary and confirm the Draft Plan when ready.",
          createdAt: readyAt
        })
      } : undefined;
      const generatedWorkspace = store.createCompiledBlueprintPlan(compilation, "codex", carrierCompletion);
      const compileRuntimeMs = Date.now() - compileStartedAt;
      store.updatePlanningSessionStatus(session.id, "draft_ready", generatedWorkspace.activePlan.id);
      store.finishPlanGenerationRun({ runId: job.runId, status: "succeeded", outputPlanId: generatedWorkspace.activePlan.id });
      updateGenerationJob(job, { stage: "ready", status: "succeeded", message: "The complete Trip Blueprint and Draft Plan are ready for review." });
      // The MAH pass already bounded its own attempts; do not create a new
      // background phase for the same missing/definitively failed image input.
      if (dependencies.plannedPlaceImageEnrichment && !dependencies.authoritativeMahCarriers && missingPlannedPlaceImages(blueprint, completedResearch).length && !imageContinuations.has(job.generationKey)) {
        const continuation = continuePublishedPlanImages({ store, codex, planId: generatedWorkspace.activePlan.id,
          research: completedResearch, blueprint, request, profile, signal: job.controller.signal,
          lookupKnownImages: currentImageLookup(completedResearch, prefetchedImages),
          ...(dependencies.runWithStageContext ? { runWithStageContext: dependencies.runWithStageContext } : {}),
          rejectCandidate,
          ...(dependencies.probeImageUrl ? { probeImageUrl: dependencies.probeImageUrl } : {}) })
          .then(result => {
            if (result) appendGenerationEvent(job.generationKey, "ready", "completed", `Background photos saved ${result.acceptedImageCount} candidate(s); ${result.remainingPlaceCount} place(s) still need a photo.`, { savedPlaceCount: result.research.places.length });
          })
          .catch(error => logGenerationFailure({ generationKey: job.generationKey, stage: "image_continuation", error: errorDiagnostic(error) }, "Background image continuation stopped; the published plan is preserved"))
          .finally(() => imageContinuations.delete(job.generationKey));
        imageContinuations.set(job.generationKey, continuation);
      }
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
        codex: {
          generateSemanticTravelPlan: input => stage("语义影子生成", 1, () => codex.generateSemanticTravelPlan(input)),
          generateSemanticTravelPlanRepair: input => stage("语义影子修复", 1, () => codex.generateSemanticTravelPlanRepair(input))
        },
        config: semanticShadow,
        logGenerationFailure,
        ...(dependencies.onSemanticShadowDiagnostic ? { onDiagnostic: (event: SemanticShadowDiagnosticEvent) => dependencies.onSemanticShadowDiagnostic?.(event) } : {})
        });
      }
    } catch (error) {
      const failedStage: BlueprintGenerationStage = job.stage === "failed" || job.stage === "cancelled" ? "queued" : job.stage;
      const failureCode = planGenerationFailureCode(error);
      if (failureCode === "mah_supervision_stopped") {
        updateGenerationJob(job, { message: "Local task supervision stopped. Restarting will resume the same MAH task." });
        return;
      }
      const cancelled = failureCode === "cancelled";
      const superseded = failureCode === "superseded";
      try { store.finishPlanGenerationRun({ runId: job.runId, status: "failed", failureCode }); } catch { /* The run may already have been recovered or cancelled. */ }
      try {
        const current = store.getPlanningSessionById(session.id);
        if (current && current.confirmedProposalVersion === session.confirmedProposalVersion && current.status !== "abandoned" && (current.status === "generating" || current.status === "proposal_confirmed")) store.updatePlanningSessionStatus(session.id, "proposal_ready");
      } catch { /* Preserve the generation failure. */ }
      const failureMessage = superseded ? "A newer proposal replaced this generation. Its saved checkpoints remain read-only." : cancelled ? "Plan generation was cancelled. Saved checkpoints remain available." : error instanceof Error ? error.message : "Plan generation failed.";
      if (pendingResearchArtifact) {
        try {
          const createdAt = new Date().toISOString();
          store.saveDiagnosticArtifact({
            generationKey: job.generationKey,
            createdAt,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
            rawResponse: JSON.stringify({ type: "research_import_failure_v1", scopeLabel: pendingResearchArtifact.scopeLabel, error: failureMessage, artifact: pendingResearchArtifact.artifact, ...(pendingResearchArtifact.rejected ? { rejectedArtifact: pendingResearchArtifact.rejected } : {}) })
          });
        } catch { /* Preserve the original research import failure. */ }
      }
      if (job.strategy !== "semantic_canary" && (failedStage === "import" || failedStage === "itinerary")) {
        const details = blueprintImportFailureDetails(error);
        if (details || pendingItineraryArtifact || rejectedItineraryArtifact) {
          try {
            const createdAt = new Date().toISOString();
            store.saveDiagnosticArtifact({
              generationKey: job.generationKey,
              createdAt,
              expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
              rawResponse: JSON.stringify({ type: "blueprint_import_failure_v1", issues: details?.issues ?? [failureMessage], days: details?.days ?? [], movements: details?.movements ?? [], ...(pendingItineraryArtifact ? { artifact: pendingItineraryArtifact } : {}), ...(rejectedItineraryArtifact ? { rejectedArtifact: rejectedItineraryArtifact } : {}) })
            });
          } catch { /* Preserve the original import failure. */ }
        }
      }
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

  function carrierCheckpoint(input: {
    generationKey: string;
    operation: MahStageOperation;
    batchId?: string;
    candidate: unknown;
    stage: BlueprintGenerationStage;
    status: BlueprintGeneration["status"];
    detail: string;
    createdAt: string;
    scopeLabel?: string;
    savedPlaceCount?: number;
    nextAction?: string;
  }) {
    if (!dependencies.authoritativeMahCarriers) return undefined;
    const receipt = dependencies.carrierForCandidate?.(input.candidate);
    const mapping = receipt ? store.generationCarriers.getByTaskId(receipt.carrierTaskId) : undefined;
    if (!mapping || !receipt || mapping.generationKey !== input.generationKey || mapping.operation !== input.operation
      || !["validated", "imported"].includes(mapping.status) || mapping.requestSha256 !== receipt.requestSha256 || mapping.resultSha256 !== receipt.resultSha256) {
      throw new MahCarrierError("mah_mapping_missing", "合法业务检查点缺少原候选的精确有效回执。");
    }
    return {
      carrierTaskIds: [mapping.carrierTaskId],
      expectedCarriers: [expectedCarrier(mapping)],
      generationEvent: generationCheckpointEvent(store, {
        id: `mah-import-${mapping.carrierTaskId}`,
        generationKey: input.generationKey,
        stage: input.stage,
        status: input.status,
        detail: input.detail,
        createdAt: input.createdAt,
        ...(input.scopeLabel === undefined ? {} : { scopeLabel: input.scopeLabel }),
        ...(input.savedPlaceCount === undefined ? {} : { savedPlaceCount: input.savedPlaceCount }),
        ...(input.nextAction === undefined ? {} : { nextAction: input.nextAction })
      })
    };
  }

  function saveGenerationBlueprint(blueprint: TripBlueprint, candidates: unknown[] = []): TripBlueprint {
    if (!dependencies.authoritativeMahCarriers) return store.saveTripBlueprint(blueprint);
    const carriers = candidates.map(candidate => {
      const carrier = dependencies.carrierForCandidate?.(candidate);
      if (!carrier) throw new MahCarrierError("mah_import_boundary_invalid", "行程候选缺少本次实际使用的任务关联。");
      return carrier;
    });
    const checkpoint = carriers.length ? {
      carrierTaskIds: carriers.map(mapping => mapping.carrierTaskId),
      expectedCarriers: carriers,
      generationEvent: generationCheckpointEvent(store, {
        id: `mah-blueprint-${sha256CarrierSet(carriers.map(mapping => `${mapping.carrierTaskId}:${mapping.resultSha256}`))}`,
        generationKey: blueprint.generationKey,
        stage: "itinerary" as const,
        status: "running" as const,
        detail: "Saved the validated itinerary checkpoint.",
        savedPlaceCount: blueprint.places.length,
        createdAt: new Date().toISOString()
      })
    } : undefined;
    return store.saveTripBlueprint(blueprint, checkpoint);
  }

  function rejectCandidate(candidate: unknown): void {
    const receipt = dependencies.carrierForCandidate?.(candidate);
    const mapping = receipt ? store.generationCarriers.getByTaskId(receipt.carrierTaskId) : undefined;
    if (receipt && mapping?.status === "validated" && mapping.requestSha256 === receipt.requestSha256 && mapping.resultSha256 === receipt.resultSha256) {
      store.generationCarriers.updateStatus(receipt.carrierTaskId, "artifact_invalid", {
        code: "mah_business_candidate_not_accepted", message: "此候选未被领域接受，保留原检查点。"
      });
    }
  }

  function rejectUnconsumedCandidates(generationKey: string, operations: MahStageOperation[], accepted: unknown[] = []): void {
    const keep = new Set(accepted.flatMap(candidate => {
      const receipt = dependencies.carrierForCandidate?.(candidate);
      return receipt ? [receipt.carrierTaskId] : [];
    }));
    for (const mapping of store.generationCarriers.listForGeneration(generationKey)) {
      if (mapping.status === "validated" && operations.includes(mapping.operation as MahStageOperation) && !keep.has(mapping.carrierTaskId)) {
        store.generationCarriers.updateStatus(mapping.carrierTaskId, "artifact_invalid", {
          code: "mah_business_candidate_not_accepted", message: "此候选未用于已接受的检查点。"
        });
      }
    }
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
    onArtifact: (artifact: SkillItineraryArtifact | undefined, rejected?: SkillItineraryArtifact) => void;
  }): Promise<{ research: typeof input.research; blueprint: typeof input.blueprint }> {
    let research = input.research;
    let blueprint = input.blueprint;
    blueprint = normalizeDayCandidates(blueprint);
    const targets = completionTargetsForBlueprint(blueprint, research);
    const dependencyGaps = assessBlueprintDayReasonableness(blueprint).filter((day) => day.classification === "UNDER_PLANNED" && day.cause === "DEPENDENCY_GAP");
    if (!targets.length) {
      const emptyDays = emptyDestinationDayDates(blueprint);
      if (emptyDays.length) appendGenerationEvent(input.job.generationKey, "itinerary", "running", `Empty days ${emptyDays.join(", ")} will be handled by the shared publication review.`, { savedPlaceCount: research.places.length });
      const detail = dependencyGaps.length
        ? `Stage 3.10 day completion found no candidate-gap days. Preserved ${dependencyGaps.length} dependency-gap day(s): ${dependencyGaps.map((day) => day.date).join(", ")}.`
        : "Stage 3.10 day completion found no materially under-planned candidate-gap days.";
      appendGenerationEvent(input.job.generationKey, "itinerary", "running", detail, { savedPlaceCount: research.places.length, nextAction: "Run final reasonableness check before compile." });
      return { research, blueprint };
    }

    const completionCheckpoint = `Day completion checkpoint: ${createHash("sha1").update(JSON.stringify(targets.map((target) => [target.day.date, target.day.city]))).digest("hex")}`;
    if (store.getBlueprintGenerationEvents(input.job.generationKey).some((event) => event.detail === completionCheckpoint)) {
      appendGenerationEvent(input.job.generationKey, "itinerary", "running", "Reusing saved day-completion work. Remaining findings will go to the shared publication review.", { savedPlaceCount: research.places.length });
      return { research, blueprint };
    }
    const researchTargets = targets.filter((target) => !target.existingCandidates.length && target.researchScopeLabel
      && !research.batches.some((batch) => batch.status === "completed" && batch.scopeLabel === target.researchScopeLabel));
    for (const target of researchTargets) {
      const batchId = completionResearchBatchId(target.day.date, store.generationCarriers.listForGeneration(input.job.generationKey)
        .filter(mapping => mapping.operation === "research_batch")
        .flatMap(mapping => { const identity = mahStageIdentity(mapping.request as MahStageRequest); return identity ? [identity.scope] : []; }));
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
        () => generateResearchBatch({
          request: buildTargetedCompletionResearchRequest(input.request, target),
          batch: { id: batchId, scopeLabel },
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
      research = store.saveResearchSet(research, carrierCheckpoint({
        generationKey: input.job.generationKey,
        operation: "research_batch",
        batchId,
        candidate: artifact,
        stage: "research",
        status: "running",
        detail: `Saved targeted day-completion research for ${target.day.date}.`,
        createdAt: checkpointTime,
        scopeLabel,
        savedPlaceCount: research.places.length,
        nextAction: "Re-compose under-planned day with the normal itinerary generator."
      }));
    }

    assertGenerationNotCancelled(input.job, input.session);
    updateGenerationJob(input.job, { stage: "itinerary", scopeLabel: undefined, savedPlaceCount: research.places.length, message: "Re-composing under-planned days." });
    updatePersistedGeneration(input.job.generationKey, "itinerary", "running");
    const dates = targets.map((target) => target.day.date).join(", ");
    appendGenerationEvent(input.job.generationKey, "itinerary", "running", `Stage 3.10 re-composing under-planned day(s): ${dates}.`, {
      savedPlaceCount: research.places.length,
      nextAction: "Validate the completion pass before compile."
    });
    let completionArtifact = await withSingleTransientRetry(
      () => codex.generateSkillItinerary({ bookingRelationshipSourceUnits:bookingRelationshipSourceUnits(input.blueprint.bookingConstraints??[]), request: buildCompletionItineraryRequest(input.request, targets, researchTargets.length > 0), research, dayPatch: { original: itineraryArtifactFromBlueprint(input.blueprint), dates: targets.map((target) => target.day.date) }, signal: input.job.controller.signal, profile: input.profile }),
      () => appendGenerationEvent(input.job.generationKey, "itinerary", "running", "Transient completion itinerary failure; retrying this stage once.", { savedPlaceCount: research.places.length })
    );
    const completionCandidate = completionArtifact;
    assertGenerationNotCancelled(input.job, input.session);
    completionArtifact = restoreUntargetedItineraryDays(
      itineraryArtifactFromBlueprint(input.blueprint),
      completionArtifact,
      targets.map((target) => target.day.date),
      true
    );
    input.onArtifact(completionArtifact);
    const completionContext = { blueprintId: blueprint.id, blueprintVersion: blueprint.version, createdAt: blueprint.createdAt, bookingConstraints: input.bookingConstraints,...(input.blueprint.bookingRelationshipAssessment?{bookingRelationshipAssessment:input.blueprint.bookingRelationshipAssessment}:{}) };
    try {
      blueprint = normalizeUnverifiedBookedTimes(materializeRecommendedAccommodationAnchors(importSkillItinerary(research, completionArtifact, completionContext)).blueprint);
      blueprint = saveGenerationBlueprint(blueprint, [completionCandidate]);
    } catch (error) {
      if (!isBlueprintIntegrityFailure(error)) throw error;
      rejectCandidate(completionCandidate);
      appendGenerationEvent(input.job.generationKey, "itinerary", "running", "Day completion output failed the itinerary contract. Kept the previous valid route for the shared publication review.", { savedPlaceCount: research.places.length });
      blueprint = mergeResearchCatalogIntoBlueprint(input.blueprint, research, new Date().toISOString());
    }
    appendGenerationEvent(input.job.generationKey, "itinerary", "running", completionCheckpoint, { savedPlaceCount: research.places.length });
    // Keep this composition as a checkpoint; the shared publication review owns content repairs.
    blueprint = saveGenerationBlueprint(blueprint);
    input.onArtifact(undefined);
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
    const supplementMapping = [...store.generationCarriers.listForGeneration(input.job.generationKey)].reverse().find(mapping =>
      mapping.operation === "research_batch" && mahStageIdentity(mapping.request as MahStageRequest)?.scope === "explore-supply");
    const supplementAlreadyAttempted = store.getBlueprintGenerationEvents(input.job.generationKey)
      .some((event) => event.detail === "The formal itinerary is complete, but the local guide needs more plan-outside choices. Starting one bounded supplemental research pass.")
      && (!supplementMapping || ["imported", "artifact_invalid", "artifact_changed", "failed", "cancelled"].includes(supplementMapping.status));
    if (supplementAlreadyAttempted) {
      appendGenerationEvent(input.job.generationKey, "itinerary", "running", "The bounded Explore supplement was already attempted for this generation. Resuming with the choices already saved.", {
        savedPlaceCount: input.research.places.length,
        nextAction: "Compile the accepted itinerary with the available guide content."
      });
      return { research: input.research, blueprint: input.blueprint };
    }
    const scopeLabel = `Explore choices near ${(assessment.uncoveredAreas.length ? assessment.uncoveredAreas : assessment.mainAreas).join(" / ") || input.blueprint.destinations.join(" / ")}`;
    updateGenerationJob(input.job, { stage: "research", scopeLabel, savedPlaceCount: input.research.places.length, message: "Finding optional local choices for the guide…" });
    updatePersistedGeneration(input.job.generationKey, "research", "running");
    appendGenerationEvent(input.job.generationKey, "research", "running", "The formal itinerary is complete, but the local guide needs more plan-outside choices. Starting one bounded supplemental research pass.", {
      scopeLabel,
      savedPlaceCount: input.research.places.length,
      nextAction: "Add sourced local choices without changing the formal itinerary."
    });
    let artifact: SkillResearchBatchArtifact | undefined;
    try {
      assertGenerationNotCancelled(input.job, input.session);
      artifact = await generateResearchBatch({
        request: buildExploreSupplyResearchRequest(input.request, input.blueprint, input.research, assessment),
        batch: { id: "explore-supply", scopeLabel },
        signal: input.job.controller.signal,
        profile: input.profile,
        skillLineage: input.skillLineage,
        timeoutMs: OPTIONAL_EXPLORE_RESEARCH_TIMEOUT_MS
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
        store.saveResearchSetAndTripBlueprint(input.research, input.blueprint, undefined, carrierCheckpoint({
          generationKey: input.job.generationKey, operation: "research_batch", batchId: "explore-supply",
          candidate: artifact,
          stage: "research", status: "running", detail: "Optional research was checked. It returned no additional places, so the saved itinerary is retained.",
          createdAt: checkpointTime, savedPlaceCount: input.research.places.length
        }));
        appendGenerationEvent(input.job.generationKey, "research", "running", "No additional distinct local choices passed identity and evidence checks. The accepted draft remains unchanged.", {
          scopeLabel,
          savedPlaceCount: input.research.places.length,
          nextAction: "Compile the accepted itinerary with the available guide content."
        });
        return { research: input.research, blueprint: input.blueprint };
      }
      const mergedBlueprint = mergeResearchCatalogIntoBlueprint(input.blueprint, mergedResearch, checkpointTime);
      const completedAssessment = assessExploreSupply(mergedBlueprint);
      const saved = store.saveResearchSetAndTripBlueprint(mergedResearch, mergedBlueprint, undefined, carrierCheckpoint({
        generationKey: input.job.generationKey,
        operation: "research_batch",
        batchId: "explore-supply",
          candidate: artifact,
        stage: "research",
        status: "running",
        detail: `Saved ${newPlaceIds.length} additional sourced local research item(s); ${completedAssessment.actionablePlaceIds.length} map-ready plan-outside choice(s) are now available. The formal itinerary was not changed.`,
        createdAt: checkpointTime,
        scopeLabel,
        savedPlaceCount: mergedResearch.places.length,
        nextAction: "Compile the unchanged formal itinerary with the expanded guide catalog."
      }));
      return saved;
    } catch (error) {
      rethrowGenerationControlError(error, input.job.controller.signal);
      if (artifact) rejectCandidate(artifact);
      logGenerationFailure({ generationKey: input.job.generationKey, stage: "explore_supply", error: errorDiagnostic(error) }, "Optional Explore supply research failed; preserving the accepted itinerary");
      appendGenerationEvent(input.job.generationKey, "research", "running", error instanceof RuntimeAdapterError && error.code === "timed_out"
        ? "Optional local-choice research reached its five-minute limit. The accepted itinerary was preserved."
        : "More local recommendations could not be completed this time. The accepted itinerary and its verified content were preserved.", {
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

  function currentImageLookup(research: ResearchSet, prefetched?: ReturnType<typeof prefetchPlannedPlaceImages>): NonNullable<Parameters<typeof runPlannedPlaceImagePass>[0]["lookupKnownImages"]> {
    const lookup = dependencies.lookupKnownImages ?? ((places, signal) => searchWikipediaPlaceImages(places, { signal, sources: research.sources }));
    return prefetched ? (places, signal) => prefetched(places, signal, lookup) : lookup;
  }

  async function enrichPlannedPlaceImages(input: {
    job: PlanGenerationJob;
    session: PlanningSession;
    request: string;
    profile: { preferredLanguage: string; nationality: string; gender: WorkspaceSnapshot["profile"]["gender"]; immigrationStatus: WorkspaceSnapshot["profile"]["immigrationStatus"] };
    scopes: string[];
    research: ResearchSet;
    blueprint: NonNullable<ReturnType<SqliteWorkspaceStore["getTripBlueprintByGenerationKey"]>>;
    prefetchedImages?: ReturnType<typeof prefetchPlannedPlaceImages>;
  }): Promise<{ research: ResearchSet; blueprint: NonNullable<ReturnType<SqliteWorkspaceStore["getTripBlueprintByGenerationKey"]>> }> {
    const beforeAudit = auditPlannedPlaceImageCoverage(input.blueprint, input.research);
    const missing = missingPlannedPlaceImages(input.blueprint, input.research);
    appendGenerationEvent(input.job.generationKey, "research", "running", `Timeline image coverage: ${beforeAudit.length - missing.length}/${beforeAudit.length} place-backed card(s) have sourced candidates.`, {
      savedPlaceCount: input.research.places.length,
      nextAction: missing.length ? `Try one bounded image-only pass for ${missing.length} missing place(s).` : "Continue without additional image research."
    });
    updateGenerationJob(input.job, { stage: "research", scopeLabel: undefined, savedPlaceCount: input.research.places.length, message: "Preparing itinerary cards…" });
    updatePersistedGeneration(input.job.generationKey, "research", "running");
    try {
      const result = await runPlannedPlaceImagePass({
        research: input.research,
        blueprint: input.blueprint,
        sequentialCarriers: dependencies.authoritativeMahCarriers === true,
        rejectCandidate,
        signal: input.job.controller.signal,
        probeImageUrl: (url, signal) => dependencies.probeImageUrl ? dependencies.probeImageUrl(url) : probeRemoteImageUrl(url, { signal }),
        lookupKnownImages: currentImageLookup(input.research, input.prefetchedImages),
        search: (places, timeoutMs, rejectedImageUrls, signal, imageStage) => stage("图片初次补充", imageStage.round, () => codex.generatePlannedPlaceImageEnrichment({
          request: rejectedImageUrls.length ? `${input.request}\n\nThese image URLs did not return image content and must not be reused: ${rejectedImageUrls.join(", ")}` : input.request,
          scopeLabel: input.scopes.join(" / "),
          places,
          sources: input.research.sources,
          rejectedImageUrls,
          profile: input.profile,
          signal,
          timeoutMs
        })),
        save: (research, blueprint, saveContext) => {
          if (saveContext.source !== "agent_generation") return store.saveResearchSetAndTripBlueprint(research, blueprint);
          const savedAt = new Date().toISOString();
          return store.saveResearchSetAndTripBlueprint(research, blueprint, undefined, carrierCheckpoint({
            generationKey: input.job.generationKey,
            operation: "planned_place_image_enrichment",
            candidate: saveContext.candidate,
            stage: "research",
            status: "running",
            detail: `Saved MAH image research for ${saveContext.requestedPlaceIds.length} planned places.`,
            createdAt: savedAt,
            savedPlaceCount: research.places.length,
            nextAction: "Continue image research or prepare the current draft."
          }));
        },
        onBatch: ({ requested, accepted, error }) => {
          if (error) logGenerationFailure({ generationKey: input.job.generationKey, stage: "planned_place_images", requested,
            code: error instanceof RuntimeAdapterError ? error.code : "image_search_failed",
            error: error instanceof Error ? error.message : String(error), diagnostic: errorDiagnostic(error) }, "One image research batch failed; continuing with other batches");
          appendGenerationEvent(input.job.generationKey, "research", "running", error
            ? `Image search for ${requested} place(s) ${error instanceof RuntimeAdapterError && error.code === "timed_out" ? "timed out" : "failed"}; saved itinerary content is unaffected.`
            : `Image search accepted ${accepted} sourced image(s) for ${requested} place(s).`, { savedPlaceCount: input.research.places.length });
        }
      });
      assertGenerationNotCancelled(input.job, input.session);
      rejectUnconsumedCandidates(input.job.generationKey, ["planned_place_image_enrichment"]);
      appendGenerationEvent(input.job.generationKey, "research", "running", `Image search saved ${result.acceptedImageCount} sourced candidate(s); ${result.remainingPlaceCount} place(s) still need a photo.`, { savedPlaceCount: result.research.places.length, nextAction: "Compile the draft; later image passes can target only remaining places." });
      return { research: result.research, blueprint: result.blueprint };
    } catch (error) {
      rethrowGenerationControlError(error, input.job.controller.signal);
      if (dependencies.authoritativeMahCarriers && requiresMahImageRecovery(error)) throw error;
      rejectUnconsumedCandidates(input.job.generationKey, ["planned_place_image_enrichment"]);
      logGenerationFailure({ generationKey: input.job.generationKey, stage: "planned_place_images", error: errorDiagnostic(error) }, "Optional planned-place image enrichment failed; preserving the accepted itinerary");
      appendGenerationEvent(input.job.generationKey, "research", "running", "Image enrichment could not be completed. Saved image fixes remain available; the itinerary can use illustrations where photos are missing.", { savedPlaceCount: input.research.places.length, nextAction: "Compile the latest saved itinerary." });
      return {
        research: store.getResearchSetByGenerationKey(input.job.generationKey) ?? input.research,
        blueprint: store.getTripBlueprintByGenerationKey(input.job.generationKey) ?? input.blueprint
      };
    }
  }

  function assertGenerationNotCancelled(job: PlanGenerationJob, session: PlanningSession) {
    if (job.controller.signal.aborted && job.controller.signal.reason === MAH_SUPERVISION_STOP_REASON) {
      throw new MahCarrierError("mah_supervision_stopped", "本地监督已停止，原任务与检查点保持可恢复。");
    }
    const current = store.getPlanningSessionById(session.id);
    if (job.controller.signal.aborted || current?.status === "abandoned") throw new RuntimeAdapterError("cancelled", "Plan generation was cancelled.");
    if (current?.confirmedProposalVersion !== session.confirmedProposalVersion) throw new RuntimeAdapterError("superseded", "A newer proposal replaced this Blueprint Generation.");
  }

  function markPersistedGenerationCancelled(generationKey: string, message: string) {
    store.requestBlueprintGenerationCancellation(generationKey, message);
  }

  async function cancelGeneration(generationKey: string, message: string): Promise<void> {
    markPersistedGenerationCancelled(generationKey, message);
    await dependencies.cancelCarrierGeneration?.(generationKey);
  }

  async function stopGenerationSupervision(reason: unknown): Promise<void> {
    for (const job of jobs.values()) if (job.status === "running" || imageContinuations.has(job.generationKey)) job.controller.abort(reason);
    await Promise.allSettled([...jobRuns.values(), ...imageContinuations.values()]);
  }

  return {
    jobs,
    imageContinuations,
    blueprintGenerationKey,
    enqueuePlanningSessionGeneration,
    publicGenerationJob,
    publicPersistedGeneration,
    updateGenerationJob,
    markPersistedGenerationCancelled,
    cancelGeneration,
    stopGenerationSupervision,
    planGenerationFailureCode
  };
}

function sha256CarrierSet(identities: string[]): string {
  return createHash("sha256").update(JSON.stringify(identities.sort())).digest("hex");
}

function expectedCarrier(mapping: { carrierTaskId: string; requestSha256: string; resultSha256?: string }) {
  if (!mapping.resultSha256) throw new MahCarrierError("mah_import_boundary_invalid", "检查点缺少已验证结果摘要。");
  return { carrierTaskId: mapping.carrierTaskId, requestSha256: mapping.requestSha256, resultSha256: mapping.resultSha256 };
}

function rethrowGenerationControlError(error: unknown, signal: AbortSignal): void {
  if (signal.aborted && signal.reason === MAH_SUPERVISION_STOP_REASON) {
    throw new MahCarrierError("mah_supervision_stopped", "本地监督已停止，原任务与检查点保持可恢复。");
  }
  if (error && typeof error === "object" && "code" in error
    && ["cancelled", "superseded", "mah_supervision_stopped"].includes(String(error.code))) throw error;
}

export function accommodationResearchNeeded(research: ResearchSet, bookingConstraints: ReturnType<typeof blueprintBookingConstraintsFromTravelBookings>, session?: Pick<PlanningSession, "facts">): boolean {
  if (session && !planningAccommodationRequired(session)) return false;
  const hasUserAccommodation = bookingConstraints.some((constraint) => constraint.type === "accommodation" && constraint.status !== "cancelled" && constraint.segments.some((segment) => segment.segmentType === "hotel_stay" && (constraint.status === "confirmed" || Boolean(segment.location || segment.destination))));
  if (hasUserAccommodation) return false;
  if (research.batches.some((batch) => batch.id.includes("accommodation-anchors"))) return false;
  return !research.places.some((place) => place.accommodation?.state === "recommended" || (place.coordinates && isLodgingPlaceCategory(place.category, place.visitRole)));
}

export function buildAccommodationResearchRequest(request: string): string {
  return `${request.trim()}\n\nBounded accommodation-anchor research only: infer the overnight bases already required by this confirmed trip design and return a small set of specific, credible, map-ready lodging candidates for each base. Do not add attractions, dining, shopping, transport tabs, prices, availability, or reservation claims. Mark every specific property accommodation.state=recommended, keep it out of Explore with guideDisplay.showInGuide=false, attach source evidence and coordinates, and include only real officialUrl or bookingUrl values. Recommended means not booked. If a base has no reliable specific candidate after this pass, return only an accommodation.state=pending area fallback for that base.`;
}

function asAccommodationResearchBatch(artifact: SkillResearchBatchArtifact): SkillResearchBatchArtifact {
  const lodgingPlaces = artifact.places.filter((place) => isLodgingPlaceCategory(place.category, place.visitRole));
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

export async function withSingleTransientRetry<T>(operation: () => Promise<T>, onRetry: () => void, now: () => number = Date.now): Promise<T> {
  const startedAt = now();
  try {
    return await operation();
  } catch (error) {
    // A timeout has exhausted its stage budget; replaying it doubles the wait.
    // Only retry an early process failure. Saved checkpoints support explicit recovery.
    if (!(error instanceof RuntimeAdapterError) || error.code !== "run_failed" || now() - startedAt > 120_000) throw error;
    onRetry();
    return operation();
  }
}

function isResearchIntegrityFailure(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("Research Set failed integrity:");
}

function isBlueprintIntegrityFailure(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("Trip Blueprint failed integrity:");
}

function assertResearchRepairPreservesPlaces(rejected: SkillResearchBatchArtifact, repaired: SkillResearchBatchArtifact): void {
  const repairedIds = new Set(repaired.places.map((place) => place.id).filter((id): id is string => Boolean(id)));
  const missing = rejected.places.map((place) => place.id).filter((id): id is string => typeof id === "string" && id.length > 0).filter((id) => !repairedIds.has(id));
  if (missing.length) throw new Error(`Research repair removed existing places: ${missing.join(", ")}`);
}

export function hasPlaceOutsideGateway(places: Array<{ city?: string; category?: string }>, gatewayCity: string): boolean {
  const gateway = gatewayCity.trim().toLocaleLowerCase();
  return places.some((place) => Boolean(place.city?.trim() && place.city.trim().toLocaleLowerCase() !== gateway)
    && !/\b(?:airport|station|terminal|hotel|hostel|motel|lodge|accommodation)\b/iu.test(place.category ?? ""));
}

function assertItineraryRepairPreservesStops(rejected: SkillItineraryArtifact, repaired: SkillItineraryArtifact): void {
  const repairedDays = new Map(repaired.days.map((day) => [day.date, day]));
  for (const day of rejected.days) {
    const revised = repairedDays.get(day.date);
    if (!revised) throw new Error(`Itinerary repair removed day ${day.date}`);
    const placeIds = new Set(revised.stops.map((stop) => stop.placeId));
    const missing = day.stops.map((stop) => stop.placeId).filter((id) => !placeIds.has(id));
    if (missing.length) throw new Error(`Itinerary repair removed scheduled places from ${day.date}: ${missing.join(", ")}`);
  }
}

/** Keep accepted days intact when a bounded quality repair unexpectedly rewrites them. */
export function restoreUnrelatedQualityRepairDays(
  rejected: SkillItineraryArtifact,
  repaired: SkillItineraryArtifact,
  affectedDates: string[],
  allowRegionalReroute = false,
  preserveTripMetadata = repaired.days.length < rejected.days.length
): SkillItineraryArtifact {
  if (allowRegionalReroute) return repaired;
  return restoreUntargetedItineraryDays(rejected, repaired, affectedDates, preserveTripMetadata);
}

/** A day-completion pass may edit only the days selected by the reasonableness review. */
export function restoreUntargetedItineraryDays(original: SkillItineraryArtifact, composed: SkillItineraryArtifact, targetDates: string[], preserveTripMetadata = composed.days.length < original.days.length): SkillItineraryArtifact {
  const targets = new Set(targetDates);
  const originalByDate = new Map(original.days.map((day) => [day.date, day] as const));
  if (targetDates.some((date) => !originalByDate.has(date))) throw new Error("Day patch references a date outside the saved itinerary.");
  const composedByDate = new Map(composed.days.map((day) => [day.date, day] as const));
  if (composedByDate.size !== composed.days.length) throw new Error("Day patch repeats a date.");
  if (composed.days.some((day) => !originalByDate.has(day.date))) throw new Error("Day patch adds a date outside the saved itinerary.");
  if (targetDates.some((date) => !composedByDate.has(date))) throw new Error("Day patch omits a requested date.");
  const patchIds = new Set(composed.days.filter((day) => targets.has(day.date)).map((day) => day.id));
  const retainedIds = new Set(original.days.filter((day) => !targets.has(day.date)).map((day) => day.id));
  if ([...patchIds].some((id) => retainedIds.has(id))) throw new Error("Day patch reuses an unrelated day identity.");
  return {
    ...structuredClone(preserveTripMetadata ? original : composed),
    days: original.days.map((day) => structuredClone(targets.has(day.date) ? composedByDate.get(day.date)! : day)),
    movements: [
      ...composed.movements.filter((movement) => patchIds.has(movement.dayId)).map((movement) => structuredClone(movement)),
      ...original.movements.filter((movement) => retainedIds.has(movement.dayId)).map((movement) => structuredClone(movement))
    ]
  };
}

/** A quality correction may replace a flexible visit on the affected day. */
export function assertItineraryQualityRepairPreservesStops(
  rejected: SkillItineraryArtifact,
  repaired: SkillItineraryArtifact,
  research: Pick<ResearchSet, "places">,
  findings: Array<{ code: string; date?: string }>,
  bookingConstraints: BlueprintBookingConstraint[] = []
): void {
  const placeById = new Map(research.places.map((place) => [place.id, place] as const));
  const revisedDays = new Map(repaired.days.map((day) => [day.date, day] as const));
  const regionalReroute = findings.some((finding) => ["destination_scope_collapse", "overextended_base", "route_efficiency"].includes(finding.code));
  const flexibleDates = new Set(findings
    .filter((finding) => finding.date && ["overplanned_day", "time_sequence_conflict", "missing_overnight_base", "empty_destination_day", "unselected_accommodation", "missing_midday_break", "day_pacing", "missing_daily_logistics"].includes(finding.code))
    .map((finding) => finding.date));
  for (const [index, day] of rejected.days.entries()) {
    const revised = revisedDays.get(day.date);
    if (!revised) throw new Error(`Itinerary repair removed day ${day.date}`);
    const retained = new Set(revised.stops.map((stop) => stop.placeId));
    const flexible = regionalReroute || flexibleDates.has(day.date);
    const missing = day.stops.map((stop) => stop.placeId).filter((id) => {
      if (retained.has(id)) return false;
      const place = placeById.get(id);
      if (!flexible || !place) return true;
      if (place.accommodation?.state === "confirmed" || place.accommodation?.state === "selected") return true;
      if (matchesFixedBooking(place.name, place.category, day.date, bookingConstraints)) return true;
      // The international arrival and departure nodes anchor the approved trip dates.
      if ((index === 0 || index === rejected.days.length - 1) && /\b(?:airport|aerodrome)\b/iu.test(`${place.category} ${place.name}`)) return true;
      return false;
    });
    if (missing.length) throw new Error(`Itinerary repair removed scheduled places from ${day.date}: ${missing.join(", ")}`);
  }
}

function matchesFixedBooking(name: string, category: string, date: string, constraints: BlueprintBookingConstraint[]): boolean {
  const normalizedName = name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return constraints.some((constraint) => constraint.status === "confirmed" && constraint.constraintStrength === "hard" && constraint.segments.some((segment) => {
    if (!segment.fixedCommitment || segment.constraintStrength !== "hard") return false;
    if (![segment.startAtLocal?.slice(0, 10), segment.endAtLocal?.slice(0, 10)].includes(date)) return false;
    const label = `${constraint.title} ${segment.title} ${segment.origin ?? ""} ${segment.destination ?? ""} ${segment.location ?? ""}`
      .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (normalizedName.length >= 5 && label.includes(normalizedName)) return true;
    return segment.segmentType === "flight_leg" && /\bairport\b|机场/iu.test(`${category} ${name}`);
  }));
}

function completedBlueprintRequirementIds(workspace: WorkspaceSnapshot): string[] {
  return [workspace.activePlan, workspace.executionPlan]
    .filter((plan): plan is Plan => Boolean(plan))
    .flatMap((plan) => plan.stages.flatMap((stage) => stage.tasks))
    .filter((task) => task.status === "completed" && Boolean(task.requirementId))
    .map((task) => task.requirementId!);
}

export { planGenerationFailureCode } from "./planning-generation-state.js";

/** Dated optional improvements do not expand a local repair into a whole-trip rewrite. */
export function canUseDateLocalCorrection(required: Array<{ code: string; date?: string }>, optional: Array<{ code: string; date?: string }>, rejected = false): boolean {
  return !rejected && required.length > 0 && [...required, ...optional].every(finding => Boolean(finding.date))
    && !required.some(finding => ["destination_scope_collapse", "overextended_base", "route_efficiency"].includes(finding.code));
}


/** 日期是补全目标的耐久身份；已冻结的旧索引身份只按原值恢复。 */
export function completionResearchBatchId(date: string, existingBatchIds: readonly string[] = []): string {
  const canonical = `completion-${date}`;
  const existing = [...new Set(existingBatchIds.filter(id => id === canonical
    || (/^completion-[1-9][0-9]*-[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(id) && id.endsWith(`-${date}`))))];
  if (existing.length > 1) throw new MahCarrierError("mah_stage_identity_legacy", "同一补全日期已有冲突的历史阶段身份，已保留原映射并停止继续。");
  return existing[0] ?? canonical;
}


/** 重放仅沿用已提交事件的时间，其余字段仍由 Storage 严格核对。 */
export function generationCheckpointEvent(
  store: Pick<SqliteWorkspaceStore, "getBlueprintGenerationEvents">,
  event: Omit<BlueprintGenerationEvent, "sequence">
): Omit<BlueprintGenerationEvent, "sequence"> {
  const existing = store.getBlueprintGenerationEvents(event.generationKey).find(candidate => candidate.id === event.id);
  return existing ? { ...event, createdAt: existing.createdAt } : event;
}
