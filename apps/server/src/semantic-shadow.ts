import {
  RuntimeAdapterError,
  runSemanticPlanRepairOnce,
  structureSemanticTravelPlan,
  validateSemanticTravelPlan,
  type CodexRuntimeAdapter,
  type SemanticPlanDecisionDiff,
  type SemanticTravelPlan,
  type ValidationFinding,
  type ValidationReport
} from "@c-assistant/agent-adapters";
import type {
  BlueprintBookingConstraint,
  BlueprintBookingSegment,
  BlueprintItineraryBlock,
  BlueprintItineraryDay,
  BlueprintMovement,
  Plan,
  PlanningSession,
  ResearchSet,
  SkillItineraryArtifact,
  TripBlueprint,
  WorkspaceSnapshot
} from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";

export interface SemanticShadowConfig {
  enabled: boolean;
  sampleRate: number;
  timeoutMs: number;
}

export interface SemanticShadowSnapshot {
  generationKey: string;
  sessionId: string;
  proposalVersion: number;
  request: string;
  profile: {
    preferredLanguage: WorkspaceSnapshot["profile"]["preferredLanguage"];
    nationality: WorkspaceSnapshot["profile"]["nationality"];
    gender: WorkspaceSnapshot["profile"]["gender"];
    immigrationStatus: WorkspaceSnapshot["profile"]["immigrationStatus"];
  };
  completedResearch: ResearchSet;
  bookingConstraints: BlueprintBookingConstraint[];
  legacyPlan: Plan;
  legacyBlueprint: TripBlueprint;
  sessionFacts: PlanningSession["facts"];
}

export interface SemanticShadowDependencies {
  store: Pick<SqliteWorkspaceStore, "saveDiagnosticArtifact">;
  codex: Pick<CodexRuntimeAdapter, "generateSemanticTravelPlan" | "generateSemanticTravelPlanRepair">;
  config: SemanticShadowConfig;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
  onDiagnostic?: (event: SemanticShadowDiagnosticEvent) => void;
}

type ShadowStatus = "completed" | "failed" | "timed_out" | "skipped";
type ShadowStage = "eligibility" | "planner" | "validator" | "repair" | "structurer" | "comparison" | "diagnostic_persistence" | "timeout";
export type SemanticShadowDiagnosticEvent =
  | { event: "eligibility_checked"; generationKey: string; featureEnabled: boolean; sampleRate: number; sampled: boolean }
  | { event: "scheduled"; generationKey: string }
  | { event: "runner_started"; generationKey: string }
  | { event: "planner_started"; generationKey: string }
  | { event: "validator_reached"; generationKey: string; result: ValidationReport["result"] }
  | { event: "repair_reached"; generationKey: string }
  | { event: "structurer_reached"; generationKey: string }
  | { event: "comparison_reached"; generationKey: string }
  | { event: "diagnostic_save_attempted"; generationKey: string; status: ShadowStatus }
  | { event: "diagnostic_save_succeeded"; generationKey: string; status: ShadowStatus }
  | { event: "terminal"; generationKey: string; status: ShadowStatus; failureStage?: ShadowStage; failureCode?: string };

export function semanticShadowEnabled(config: SemanticShadowConfig, generationKey: string): boolean {
  if (!config.enabled) return false;
  const sampleRate = normalizedSampleRate(config.sampleRate);
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return stableUnitInterval(generationKey) < sampleRate;
}

export function scheduleSemanticShadow(snapshot: SemanticShadowSnapshot, dependencies: SemanticShadowDependencies): void {
  const sampled = semanticShadowEnabled(dependencies.config, snapshot.generationKey);
  dependencies.onDiagnostic?.({ event: "eligibility_checked", generationKey: snapshot.generationKey, featureEnabled: dependencies.config.enabled, sampleRate: normalizedSampleRate(dependencies.config.sampleRate), sampled });
  if (!sampled) return;
  const immutableSnapshot = structuredClone(snapshot);
  dependencies.onDiagnostic?.({ event: "scheduled", generationKey: immutableSnapshot.generationKey });
  void runSemanticShadow(immutableSnapshot, dependencies).catch((error) => {
    dependencies.logGenerationFailure({
      generationKey: immutableSnapshot.generationKey,
      sessionId: immutableSnapshot.sessionId,
      failureCode: shadowFailureCode(error),
      message: error instanceof Error ? error.message : "Unknown semantic shadow failure"
    }, "Semantic shadow failed");
  });
}

export async function runSemanticShadow(snapshot: SemanticShadowSnapshot, dependencies: SemanticShadowDependencies): Promise<void> {
  const startedAt = Date.now();
  let stage: ShadowStage = "planner";
  let timedOut = false;
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  const body = (async () => {
    try {
      dependencies.onDiagnostic?.({ event: "runner_started", generationKey: snapshot.generationKey });
      const plannerStartedAt = Date.now();
      dependencies.onDiagnostic?.({ event: "planner_started", generationKey: snapshot.generationKey });
      const semantic = await dependencies.codex.generateSemanticTravelPlan({
        request: snapshot.request,
        research: snapshot.completedResearch,
        profile: snapshot.profile,
        signal: controller.signal
      });
      const plannerRuntimeMs = Date.now() - plannerStartedAt;
      throwIfTimedOut(timedOut);

      stage = "validator";
      const validationContext = { research: snapshot.completedResearch, bookingConstraints: snapshot.bookingConstraints };
      const initialReport = validateSemanticTravelPlan(semantic.plan, validationContext);
      dependencies.onDiagnostic?.({ event: "validator_reached", generationKey: snapshot.generationKey, result: initialReport.result });
      let finalPlan: SemanticTravelPlan = semantic.plan;
      let finalReport: ValidationReport = initialReport;
      let repairAttempted = false;
      let repairSucceeded = false;
      let repairDecisionDiff: SemanticPlanDecisionDiff | undefined;
      let repairModelCallCount = 0;

      if (initialReport.result === "repair_required" && initialReport.findings.some((finding) => finding.requiresPlannerRepair)) {
        stage = "repair";
        dependencies.onDiagnostic?.({ event: "repair_reached", generationKey: snapshot.generationKey });
        const repair = await runSemanticPlanRepairOnce({
          plan: semantic.plan,
          validationContext,
          planningContext: snapshot.request,
          repairer: async (request) => {
            repairModelCallCount += 1;
            const result = await dependencies.codex.generateSemanticTravelPlanRepair({ prompt: request.prompt, signal: controller.signal });
            return result.plan;
          }
        });
        throwIfTimedOut(timedOut);
        repairAttempted = repair.plannerInvoked;
        repairSucceeded = repair.status === "repaired";
        repairDecisionDiff = repair.decisionDiff;
        if (repair.repairedPlan) finalPlan = repair.repairedPlan;
        if (repair.repairedReport) finalReport = repair.repairedReport;
      }

      stage = "structurer";
      dependencies.onDiagnostic?.({ event: "structurer_reached", generationKey: snapshot.generationKey });
      const structured = structureSemanticTravelPlan(finalPlan, snapshot.completedResearch, { importBlueprint: false, hardenContract: false });
      throwIfTimedOut(timedOut);

      stage = "comparison";
      dependencies.onDiagnostic?.({ event: "comparison_reached", generationKey: snapshot.generationKey });
      const report = buildSemanticShadowReport({
        snapshot,
        status: "completed",
        plannerRuntimeMs,
        plannerModelCallCount: 1,
        semanticPlan: finalPlan,
        initialReport,
        finalReport,
        repairAttempted,
        repairModelCallCount,
        repairSucceeded,
        repairDecisionDiff,
        structured,
        totalRuntimeMs: Date.now() - startedAt
      });
      stage = "diagnostic_persistence";
      dependencies.onDiagnostic?.({ event: "diagnostic_save_attempted", generationKey: snapshot.generationKey, status: "completed" });
      saveSemanticShadowDiagnostic(dependencies.store, snapshot.generationKey, report);
      dependencies.onDiagnostic?.({ event: "diagnostic_save_succeeded", generationKey: snapshot.generationKey, status: "completed" });
      dependencies.onDiagnostic?.({ event: "terminal", generationKey: snapshot.generationKey, status: "completed" });
    } catch (error) {
      if (timedOut) throw new RuntimeAdapterError("timed_out", "Semantic shadow timed out.");
      throw Object.assign(error instanceof Error ? error : new Error("Semantic shadow failed."), { shadowStage: stage });
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new RuntimeAdapterError("timed_out", "Semantic shadow timed out."));
    }, Math.max(1, dependencies.config.timeoutMs));
  });
  body.catch(() => {});

  try {
    await Promise.race([body, timeoutPromise]);
  } catch (error) {
    const failureStage = timedOut ? "timeout" : shadowStage(error) ?? stage;
    await saveFailureDiagnostic(snapshot, dependencies, {
      status: timedOut ? "timed_out" : "failed",
      failureStage,
      failureCode: shadowFailureCode(error),
      totalRuntimeMs: Date.now() - startedAt
    });
    dependencies.onDiagnostic?.({ event: "terminal", generationKey: snapshot.generationKey, status: timedOut ? "timed_out" : "failed", failureStage, failureCode: shadowFailureCode(error) });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildSemanticShadowReport(input: {
  snapshot: SemanticShadowSnapshot;
  status: ShadowStatus;
  plannerRuntimeMs: number;
  plannerModelCallCount: number;
  semanticPlan: SemanticTravelPlan;
  initialReport: ValidationReport;
  finalReport: ValidationReport;
  repairAttempted: boolean;
  repairModelCallCount: number;
  repairSucceeded: boolean;
  repairDecisionDiff?: SemanticPlanDecisionDiff | undefined;
  structured: ReturnType<typeof structureSemanticTravelPlan>;
  totalRuntimeMs: number;
}) {
  const semanticCounts = semanticPlanCounts(input.semanticPlan);
  const structurerCounts = {
    dayCount: input.structured.artifact.days.length,
    placeLinkedBlockCount: input.structured.artifact.days.flatMap((day) => day.blocks ?? []).filter((block) => Boolean(block.placeId)).length,
    blockCount: input.structured.artifact.days.flatMap((day) => day.blocks ?? []).length,
    movementCount: input.structured.artifact.movements.length,
    representationGapCount: input.structured.representationGaps.length
  };
  const comparison = compareLegacyAndSemantic(input.snapshot, input.semanticPlan, input.structured.artifact);
  return {
    type: "semantic_shadow_v1",
    identity: {
      sessionId: input.snapshot.sessionId,
      generationKey: input.snapshot.generationKey,
      proposalVersion: input.snapshot.proposalVersion,
      legacyPlanId: input.snapshot.legacyPlan.id,
      legacyPlanVersion: input.snapshot.legacyPlan.version
    },
    status: { value: input.status },
    planner: { succeeded: true, runtimeMs: input.plannerRuntimeMs, modelCallCount: input.plannerModelCallCount },
    research: {
      reusedProductionResearch: true,
      semanticTargetedResearchUsed: input.semanticPlan.targetedResearch.length > 0,
      targetedResearchCount: input.semanticPlan.targetedResearch.length
    },
    validator: {
      initialResult: input.initialReport.result,
      findingCountsByCategory: findingCountsByCategory(input.initialReport.findings),
      repairRequiredFindingCount: input.initialReport.findings.filter((finding) => finding.requiresPlannerRepair).length
    },
    repair: {
      attempted: input.repairAttempted,
      modelCallCount: input.repairModelCallCount,
      succeeded: input.repairSucceeded,
      changedDateCount: input.repairDecisionDiff?.daysChanged.length ?? 0,
      baseStrategyChanged: input.repairDecisionDiff?.baseStrategyChanged ?? false,
      fixedCommitmentChanged: fixedCommitmentChanged(input.repairDecisionDiff),
      suspiciousDecisionDriftCount: suspiciousDecisionDriftCount(input.repairDecisionDiff),
      postRepairValidationResult: input.repairAttempted ? input.finalReport.result : undefined
    },
    semantic: semanticCounts,
    structurer: { success: true, ...structurerCounts },
    comparison,
    commitmentPreservation: commitmentPreservationTrace(input.snapshot, input.semanticPlan, input.structured.artifact, comparison),
    watch: {
      genericConstraintExperienceCount: genericConstraintExperienceCount(input.semanticPlan),
      fillerLikeItems: fillerLikeItems(input.structured.artifact),
      placeIdentity: placeIdentityCoverage(input.semanticPlan, input.snapshot.completedResearch)
    },
    totalRuntimeMs: input.totalRuntimeMs
  };
}

async function saveFailureDiagnostic(snapshot: SemanticShadowSnapshot, dependencies: SemanticShadowDependencies, failure: { status: ShadowStatus; failureStage: ShadowStage; failureCode: string; totalRuntimeMs: number }): Promise<void> {
  try {
    dependencies.onDiagnostic?.({ event: "diagnostic_save_attempted", generationKey: snapshot.generationKey, status: failure.status });
    saveSemanticShadowDiagnostic(dependencies.store, snapshot.generationKey, {
      type: "semantic_shadow_v1",
      identity: {
        sessionId: snapshot.sessionId,
        generationKey: snapshot.generationKey,
        proposalVersion: snapshot.proposalVersion,
        legacyPlanId: snapshot.legacyPlan.id,
        legacyPlanVersion: snapshot.legacyPlan.version
      },
      status: { value: failure.status, failureStage: failure.failureStage, failureCode: failure.failureCode },
      totalRuntimeMs: failure.totalRuntimeMs
    });
    dependencies.onDiagnostic?.({ event: "diagnostic_save_succeeded", generationKey: snapshot.generationKey, status: failure.status });
  } catch (diagnosticError) {
    dependencies.logGenerationFailure({
      generationKey: snapshot.generationKey,
      sessionId: snapshot.sessionId,
      failureCode: shadowFailureCode(diagnosticError),
      message: diagnosticError instanceof Error ? diagnosticError.message : "Unknown diagnostic persistence failure"
    }, "Semantic shadow diagnostic persistence failed");
  }
}

function saveSemanticShadowDiagnostic(store: Pick<SqliteWorkspaceStore, "saveDiagnosticArtifact">, generationKey: string, report: unknown): void {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString();
  store.saveDiagnosticArtifact({ generationKey, rawResponse: JSON.stringify(report), createdAt, expiresAt });
}

function semanticPlanCounts(plan: SemanticTravelPlan) {
  const experiences = plan.dailyItinerary.flatMap((day) => day.experiences ?? []);
  return {
    dayCount: plan.dailyItinerary.length,
    plannedExperienceCount: experiences.filter((experience) => experience.planRole === "planned").length,
    optionalCount: experiences.filter((experience) => experience.planRole === "optional").length,
    replacementCount: experiences.filter((experience) => experience.planRole === "replacement").length
  };
}

function compareLegacyAndSemantic(snapshot: SemanticShadowSnapshot, plan: SemanticTravelPlan, artifact: ReturnType<typeof structureSemanticTravelPlan>["artifact"]) {
  const legacyPresentation = snapshot.legacyPlan.presentation;
  const legacyDays = legacyPresentation?.days ?? [];
  const semanticDates = new Set(plan.dailyItinerary.map((day) => isoDate(day.date) ?? day.date));
  const semanticBlocks = artifact.days.flatMap((day) => day.blocks ?? []);
  const confirmedCommitments = snapshot.bookingConstraints
    .flatMap((constraint) => constraint.segments.map((segment) => ({ constraint, segment })))
    .filter(({ constraint, segment }) => constraint.status === "confirmed" && constraint.constraintStrength === "hard" && segment.fixedCommitment);
  const missingConfirmedCommitments = confirmedCommitments.filter(({ constraint, segment }) => !commitmentIsStructurallyPreserved(snapshot, plan, artifact, constraint, segment));
  return {
    tripDayCoverage: { legacyDayCount: legacyDays.length, semanticDayCount: plan.dailyItinerary.length, matchedDateCount: legacyDays.filter((day) => semanticDates.has(day.date ?? "")).length },
    visibleItemsPerDay: artifact.days.map((day) => ({ date: day.date, semanticBlockCount: day.blocks?.length ?? 0, legacyPlaceCount: legacyDays.find((candidate) => candidate.date === day.date)?.placeIds.length ?? 0 })),
    arrivalDepartureRepresentation: {
      firstDayHasStartContext: Boolean(plan.dailyItinerary[0]?.startContext),
      lastDayHasEndContext: Boolean(plan.dailyItinerary.at(-1)?.endContext)
    },
    baseChangeRepresentationCount: plan.dailyItinerary.filter((day) => day.startContext.label !== day.endContext.label || day.startContext.status !== day.endContext.status).length,
    fixedCommitmentCount: confirmedCommitments.length,
    missingConfirmedCommitmentCount: missingConfirmedCommitments.length,
    missingConfirmedCommitments: missingConfirmedCommitments.map(({ constraint, segment }) => ({ commitmentId: commitmentIdentity(constraint, segment), type: constraint.type, title: constraint.title, segmentTitle: segment.title, startAtLocal: segment.startAtLocal })),
    accommodationLinkageCount: snapshot.bookingConstraints.filter((constraint) => constraint.type === "accommodation").length,
    mealLinkageCount: semanticBlocks.filter((block) => /\b(lunch|dinner|breakfast|meal|restaurant|food)\b/i.test(`${block.title ?? ""} ${block.summary ?? ""}`)).length,
    routeMovementRepresentationCount: artifact.movements.length,
    unresolvedDependencyCount: inputDependencyCount(plan),
    optionalReplacementCount: semanticBlocks.filter((block) => block.planRole === "optional" || block.planRole === "replacement").length,
    fillerLikeItemCount: fillerLikeItems(artifact).length
  };
}

function fillerLikeItems(artifact: ReturnType<typeof structureSemanticTravelPlan>["artifact"]) {
  const detector = /\bfree time|rest|flexible|slow morning|early night|return to hotel\b/i;
  return artifact.days.flatMap((day) => (day.blocks ?? []).flatMap((block) => {
    const text = `${block.title ?? ""} ${block.summary ?? ""}`;
    const match = text.match(detector)?.[0];
    return match ? [{
      date: day.date,
      title: block.title ?? block.id,
      planRole: block.planRole,
      representationType: block.kind,
      detectorReason: match
    }] : [];
  }));
}

function findingCountsByCategory(findings: ValidationFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.category] = (counts[finding.category] ?? 0) + 1;
    return counts;
  }, {});
}

function placeIdentityCoverage(plan: SemanticTravelPlan, research: ResearchSet) {
  const places = new Set(research.places.map((place) => normalize(place.name)));
  const experiences = plan.dailyItinerary.flatMap((day) => day.experiences ?? []);
  const matched = experiences.filter((experience) => places.has(normalize(experience.placeName ?? experience.title))).length;
  return {
    semanticExperienceTotal: experiences.length,
    matchedResearchSetPlaces: matched,
    unmatchedExperiences: experiences.length - matched,
    operationalFactsCoveredExperiences: experiences.filter((experience) => {
      const placeName = normalize(experience.placeName ?? experience.title);
      return research.places.some((place) => normalize(place.name) === placeName && Boolean(place.operationalFacts));
    }).length
  };
}

function genericConstraintExperienceCount(plan: SemanticTravelPlan): number {
  return plan.dailyItinerary.flatMap((day) => day.experiences ?? []).filter((experience) => /confirmed immovable evening commitment/i.test(experience.title)).length;
}

function fixedCommitmentChanged(diff: SemanticPlanDecisionDiff | undefined): boolean {
  if (!diff) return false;
  return [...diff.experiencesAdded, ...diff.experiencesRemoved, ...diff.experiencesMoved, ...diff.planRoleChanges].some((item) => /flight|hotel|booking|ticket|session|commitment|event/i.test(JSON.stringify(item)));
}

function suspiciousDecisionDriftCount(diff: SemanticPlanDecisionDiff | undefined): number {
  if (!diff) return 0;
  return diff.experiencesAdded.length + diff.experiencesRemoved.length + diff.experiencesMoved.length + diff.planRoleChanges.length + diff.startEndContextChanges.length + (diff.baseStrategyChanged ? 1 : 0);
}

function inputDependencyCount(plan: SemanticTravelPlan): number {
  return plan.dailyItinerary.reduce((count, day) => count + (day.startContext.status === "unresolved_base" ? 1 : 0) + (day.endContext.status === "unresolved_base" ? 1 : 0), 0) + plan.unresolvedExperiences.length;
}

type CommitmentStageClassification = "PRESERVED" | "REPRESENTED_DIFFERENTLY" | "NOT_OBSERVED";
type CommitmentEvidenceMatch = "research_place_id" | "exact_name" | "exact_location" | "narrative";
interface CommitmentEvidence {
  date?: string;
  field: string;
  value: string;
  match: CommitmentEvidenceMatch;
}

function commitmentPreservationTrace(
  snapshot: SemanticShadowSnapshot,
  plan: SemanticTravelPlan,
  artifact: SkillItineraryArtifact,
  comparison: ReturnType<typeof compareLegacyAndSemantic>
) {
  const missingIds = new Set(comparison.missingConfirmedCommitments.map((commitment) => commitment.commitmentId));
  return confirmedCommitments(snapshot.bookingConstraints).map(({ constraint, segment }) => {
    const commitmentId = commitmentIdentity(constraint, segment);
    const sourceIdentity = {
      constraintId: constraint.id,
      segmentId: segment.id,
      title: constraint.title,
      segmentTitle: segment.title,
      location: segment.location,
      origin: segment.origin,
      destination: segment.destination
    };
    const researchPlace = researchPlaceForCommitment(snapshot.completedResearch, constraint, segment);
    const semantic = semanticCommitmentEvidence(plan, constraint, segment, researchPlace?.id);
    const structurer = structurerCommitmentEvidence(artifact, constraint, segment, researchPlace?.id);
    return {
      commitmentId,
      bookingId: constraint.id,
      type: constraint.type,
      sourceIdentity,
      dateRange: {
        startAtLocal: segment.startAtLocal,
        endAtLocal: segment.endAtLocal
      },
      plannerInput: {
        directlyProvidedAsBookingConstraint: false,
        representedInResearch: Boolean(researchPlace),
        researchPlaceId: researchPlace?.id
      },
      semantic: stageTrace(semantic.strongEvidence, semantic.narrativeEvidence, constraint, segment),
      structurer: stageTrace(structurer.strongEvidence, [], constraint, segment),
      comparator: {
        currentResult: missingIds.has(commitmentId) ? "missing_confirmed_commitment" : "not_missing"
      }
    };
  });
}

function confirmedCommitments(bookingConstraints: BlueprintBookingConstraint[]): Array<{ constraint: BlueprintBookingConstraint; segment: BlueprintBookingSegment }> {
  return bookingConstraints
    .flatMap((constraint) => constraint.segments.map((segment) => ({ constraint, segment })))
    .filter(({ constraint, segment }) => constraint.status === "confirmed" && constraint.constraintStrength === "hard" && segment.fixedCommitment);
}

function stageTrace(strongEvidence: CommitmentEvidence[], narrativeEvidence: CommitmentEvidence[], constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment) {
  const structuralEvidence = strongEvidence.filter((evidence) => commitmentEvidenceCounts(constraint, segment, evidence)).slice(0, 12);
  const narrative = narrativeEvidence.slice(0, 4);
  return {
    observed: structuralEvidence.length > 0,
    classification: structuralEvidence.length > 0 ? "PRESERVED" as const : "NOT_OBSERVED" as const,
    representationKinds: uniqueStrings([
      ...structuralEvidence.map((evidence) => representationKind(evidence.field)),
      ...narrative.map(() => "NARRATIVE_ONLY")
    ]),
    evidence: structuralEvidence,
    ...(narrative.length ? { narrativeEvidence: narrative } : {})
  };
}

function semanticCommitmentEvidence(plan: SemanticTravelPlan, constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment, researchPlaceId: string | undefined): { strongEvidence: CommitmentEvidence[]; narrativeEvidence: CommitmentEvidence[] } {
  const match = commitmentMatcher(constraint, segment);
  const strongEvidence: CommitmentEvidence[] = [];
  for (const day of plan.dailyItinerary) {
    addMatchedEvidence(strongEvidence, day.startContext.label, `${isoDate(day.date) ?? day.date}.startContext`, match, { date: isoDate(day.date) ?? day.date });
    addMatchedEvidence(strongEvidence, day.endContext.label, `${isoDate(day.date) ?? day.date}.endContext`, match, { date: isoDate(day.date) ?? day.date });
    for (const [index, experience] of (day.experiences ?? []).entries()) {
      addMatchedEvidence(strongEvidence, experience.placeName, `${isoDate(day.date) ?? day.date}.experiences[${index}].placeName`, match, { date: isoDate(day.date) ?? day.date });
      addMatchedEvidence(strongEvidence, experience.title, `${isoDate(day.date) ?? day.date}.experiences[${index}].title`, match, { date: isoDate(day.date) ?? day.date });
    }
  }
  addMatchedEvidence(strongEvidence, plan.tripStrategy, "tripStrategy", match);
  const narrativeEvidence: CommitmentEvidence[] = [];
  addNarrativeEvidence(narrativeEvidence, plan.markdown, "markdown", match);
  if (researchPlaceId) {
    for (const evidence of strongEvidence) {
      if (evidence.match === "exact_name") evidence.match = "research_place_id";
    }
  }
  return { strongEvidence: dedupeEvidence(strongEvidence), narrativeEvidence: dedupeEvidence(narrativeEvidence) };
}

function commitmentIsStructurallyPreserved(snapshot: SemanticShadowSnapshot, plan: SemanticTravelPlan, artifact: SkillItineraryArtifact, constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment): boolean {
  const researchPlace = researchPlaceForCommitment(snapshot.completedResearch, constraint, segment);
  const semantic = semanticCommitmentEvidence(plan, constraint, segment, researchPlace?.id).strongEvidence;
  const structurer = structurerCommitmentEvidence(artifact, constraint, segment, researchPlace?.id).strongEvidence;
  return [...semantic, ...structurer].some((evidenceItem) => commitmentEvidenceCounts(constraint, segment, evidenceItem));
}

function structurerCommitmentEvidence(artifact: SkillItineraryArtifact, constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment, researchPlaceId: string | undefined): { strongEvidence: CommitmentEvidence[] } {
  const match = commitmentMatcher(constraint, segment);
  const strongEvidence: CommitmentEvidence[] = [];
  for (const day of artifact.days) {
    addMatchedContextEvidence(strongEvidence, day.startContext, `${day.date}.startContext`, match, { date: day.date });
    addMatchedContextEvidence(strongEvidence, day.endContext, `${day.date}.endContext`, match, { date: day.date });
    for (const [index, stop] of day.stops.entries()) {
      if (researchPlaceId && stop.placeId === researchPlaceId) strongEvidence.push({ date: day.date, field: `${day.date}.stops[${index}].placeId`, value: stop.placeId, match: "research_place_id" });
    }
    for (const [index, block] of (day.blocks ?? []).entries()) {
      addBlockEvidence(strongEvidence, block, `${day.date}.blocks[${index}]`, day.date, match, researchPlaceId);
    }
  }
  for (const [index, movement] of artifact.movements.entries()) {
    addMovementEvidence(strongEvidence, movement, `movements[${index}]`, match, researchPlaceId);
  }
  return { strongEvidence: dedupeEvidence(strongEvidence) };
}

function addBlockEvidence(evidence: CommitmentEvidence[], block: BlueprintItineraryBlock, fieldPrefix: string, date: string, match: ReturnType<typeof commitmentMatcher>, researchPlaceId: string | undefined): void {
  if (researchPlaceId && block.placeId === researchPlaceId) evidence.push({ date, field: `${fieldPrefix}.placeId`, value: block.placeId, match: "research_place_id" });
  addMatchedEvidence(evidence, block.title, `${fieldPrefix}.title`, match, { date });
  addMatchedEvidence(evidence, block.summary, `${fieldPrefix}.summary`, match, { date });
}

function addMovementEvidence(evidence: CommitmentEvidence[], movement: BlueprintMovement, fieldPrefix: string, match: ReturnType<typeof commitmentMatcher>, researchPlaceId: string | undefined): void {
  if (researchPlaceId && movement.originPlaceId === researchPlaceId) evidence.push({ field: `${fieldPrefix}.originPlaceId`, value: movement.originPlaceId, match: "research_place_id" });
  if (researchPlaceId && movement.destinationPlaceId === researchPlaceId) evidence.push({ field: `${fieldPrefix}.destinationPlaceId`, value: movement.destinationPlaceId, match: "research_place_id" });
  addMatchedEvidence(evidence, movement.label, `${fieldPrefix}.label`, match);
  addMatchedEvidence(evidence, movement.detail, `${fieldPrefix}.detail`, match);
}

function addMatchedContextEvidence(evidence: CommitmentEvidence[], context: BlueprintItineraryDay["startContext"], field: string, match: ReturnType<typeof commitmentMatcher>, options: { date?: string } = {}): void {
  addMatchedEvidence(evidence, context?.label, `${field}.label`, match, options);
}

function addMatchedEvidence(evidence: CommitmentEvidence[], value: string | undefined, field: string, match: ReturnType<typeof commitmentMatcher>, options: { date?: string } = {}): void {
  const matched = matchValue(value, match);
  if (!matched) return;
  evidence.push({ ...options, field, value: value!, match: matched });
}

function addNarrativeEvidence(evidence: CommitmentEvidence[], value: string | undefined, field: string, match: ReturnType<typeof commitmentMatcher>): void {
  if (!value) return;
  const normalizedValue = normalize(value);
  if ([...match.names].some((candidate) => candidate && normalizedValue.includes(candidate))) {
    evidence.push({ field, value: "[narrative mention omitted]", match: "narrative" });
  }
}

function matchValue(value: string | undefined, match: ReturnType<typeof commitmentMatcher>): CommitmentEvidenceMatch | undefined {
  const normalized = normalize(value ?? "");
  if (!normalized) return undefined;
  if (match.names.has(normalized)) return "exact_name";
  if (match.locations.has(normalized)) return "exact_location";
  return undefined;
}

function commitmentMatcher(constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment) {
  return {
    names: normalizedSet([constraint.title, segment.title]),
    locations: normalizedSet([segment.location, segment.origin, segment.destination])
  };
}

function researchPlaceForCommitment(research: ResearchSet, constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment): ResearchSet["places"][number] | undefined {
  const match = commitmentMatcher(constraint, segment);
  return research.places.find((place) => {
    const names = normalizedSet([place.name, place.localizedName]);
    const locations = normalizedSet([place.locationLabel, place.area, place.city]);
    return intersects(names, match.names) || intersects(locations, match.locations);
  });
}

function commitmentIdentity(constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment): string {
  return `${constraint.id}:${segment.id}`;
}

function representationKind(field: string): string {
  if (field.includes("startContext")) return "start_context";
  if (field.includes("endContext")) return "end_context";
  if (field.includes("tripStrategy")) return "base_strategy";
  if (field.includes("experiences")) return "semantic_experience";
  if (field.includes("blocks")) return "structured_block";
  if (field.includes("stops")) return "structured_stop";
  if (field.includes("movements")) return "structured_movement";
  return "other_structural_reference";
}

function commitmentEvidenceCounts(constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment, evidence: CommitmentEvidence): boolean {
  if (evidence.match === "narrative") return false;
  const date = evidence.date;
  if (constraint.type === "accommodation") return accommodationEvidenceCounts(evidence.field, date, segment);
  if (constraint.type === "flight" || constraint.type === "train" || constraint.type === "rental_car") return transportEvidenceCounts(evidence.field, date, segment);
  return eventLikeEvidenceCounts(evidence.field, date, segment);
}

function accommodationEvidenceCounts(field: string, date: string | undefined, segment: BlueprintBookingSegment): boolean {
  if (!date) return false;
  if (field.includes("startContext")) return dateAfter(date, localDate(segment.startAtLocal)) && dateOnOrBefore(date, localDate(segment.endAtLocal));
  if (field.includes("endContext")) return dateOnOrAfter(date, localDate(segment.startAtLocal)) && dateBefore(date, localDate(segment.endAtLocal));
  if (field.includes("blocks") || field.includes("stops") || field.includes("movements") || field.includes("experiences")) return dateWithinInclusive(date, localDate(segment.startAtLocal), localDate(segment.endAtLocal));
  return false;
}

function transportEvidenceCounts(field: string, date: string | undefined, segment: BlueprintBookingSegment): boolean {
  if (!date || !(field.includes("startContext") || field.includes("endContext") || field.includes("movements") || field.includes("blocks") || field.includes("experiences"))) return false;
  const start = localDate(segment.startAtLocal);
  const end = localDate(segment.endAtLocal);
  return (start !== undefined && date === start) || (end !== undefined && date === end);
}

function eventLikeEvidenceCounts(field: string, date: string | undefined, segment: BlueprintBookingSegment): boolean {
  const start = localDate(segment.startAtLocal);
  return Boolean(date && start && date === start && (field.includes("experiences") || field.includes("blocks") || field.includes("stops")));
}

function localDate(value: string | undefined): string | undefined {
  return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
}

function dateWithinInclusive(date: string, start: string | undefined, end: string | undefined): boolean {
  return dateOnOrAfter(date, start) && dateOnOrBefore(date, end);
}

function dateOnOrAfter(date: string, boundary: string | undefined): boolean {
  return !boundary || date >= boundary;
}

function dateOnOrBefore(date: string, boundary: string | undefined): boolean {
  return !boundary || date <= boundary;
}

function dateAfter(date: string, boundary: string | undefined): boolean {
  return !boundary || date > boundary;
}

function dateBefore(date: string, boundary: string | undefined): boolean {
  return !boundary || date < boundary;
}

function normalizedSet(values: Array<string | undefined>): Set<string> {
  return new Set(values.map((value) => normalize(value ?? "")).filter(Boolean));
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeEvidence(evidence: CommitmentEvidence[]): CommitmentEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.date ?? ""}|${item.field}|${item.value}|${item.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function throwIfTimedOut(timedOut: boolean): void {
  if (timedOut) throw new RuntimeAdapterError("timed_out", "Semantic shadow timed out.");
}

function shadowStage(error: unknown): ShadowStage | undefined {
  return typeof error === "object" && error !== null && "shadowStage" in error ? (error as { shadowStage?: ShadowStage }).shadowStage : undefined;
}

function shadowFailureCode(error: unknown): string {
  if (error instanceof RuntimeAdapterError) return error.code;
  if (error instanceof Error && /timed? ?out/i.test(error.message)) return "timed_out";
  return "semantic_shadow_failed";
}

function normalizedSampleRate(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function stableUnitInterval(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function isoDate(value: string): string | undefined {
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}
