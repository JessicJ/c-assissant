import {
  operationalFactAppliesToDate,
  type SemanticTravelExperience,
  type SemanticTravelPlan,
  type ValidationFinding,
  type ValidationReport
} from "@c-assistant/agent-adapters";
import type {
  BlueprintBookingConstraint,
  BlueprintEvidenceRef,
  BlueprintPlace,
  ResearchSet
} from "@c-assistant/core";

type AuditLabel = "A" | "B" | "C" | "D";
type CheckStatus = "performed" | "not_performed" | "not_applicable";
type Applicability = "applies" | "does_not_apply" | "indeterminate";
type OperationalFacts = NonNullable<BlueprintPlace["operationalFacts"]>;
type OperationalFact =
  | NonNullable<NonNullable<OperationalFacts["access"]>["windows"]>[number]
  | NonNullable<NonNullable<OperationalFacts["access"]>["closed"]>[number]
  | NonNullable<NonNullable<OperationalFacts["access"]>["lastEntry"]>
  | NonNullable<OperationalFacts["sessions"]>[number]
  | NonNullable<NonNullable<OperationalFacts["entry"]>["reservation"]>;

export interface PlannedExperienceReadinessTrace {
  version: "planned_experience_readiness_trace_v1";
  origin: "final_semantic_plan_and_final_validation";
  replayed: boolean;
  counts: {
    plannedExperienceCount: number;
    traceEntryCount: number;
    optionalExperienceCount: number;
    replacementExperienceCount: number;
    linkedFindingCount: number;
    unlinkedFindingCount: number;
  };
  occurrences: PlannedExperienceReadinessOccurrence[];
  unlinkedFindings: Array<{
    findingIndex: number;
    finding: ValidationFinding;
    reason: "plan_or_day_level" | "non_planned_occurrence" | "ambiguous_occurrence" | "no_matching_occurrence";
  }>;
}

export interface PlannedExperienceReadinessOccurrence {
  occurrenceKey: string;
  date: string;
  experienceName: string;
  planRole: "planned";
  identity: {
    status: "resolved" | "unresolved" | "ambiguous";
    matchingBasis: "exact_normalized_place_name" | "none";
    matchedResearchEntity?: { id: string; name: string };
    candidateResearchEntities?: Array<{ id: string; name: string }>;
    reason?: string;
  };
  conditionChecks: Array<{
    kind: string;
    note?: string;
    checkStatus: CheckStatus;
    reason?: string;
    finalFindingIndexes: number[];
    auditLabels: AuditLabel[];
  }>;
  operationalFactChecks: Array<{
    checkKey: string;
    kind: "closure" | "access_window" | "last_entry" | "session" | "reservation" | "ticket" | "booking" | "capacity";
    factStatus?: string;
    checkStatus: CheckStatus;
    reason?: string;
    dateApplicability: Applicability;
    validatorUsesDateApplicability: boolean;
    evidence: Array<{
      sourceId: string;
      status: string;
      checkedAt?: string;
      sourceResolved: boolean;
      hasSupportingClaim: boolean;
    }>;
    evidenceSupportsThisCheck: boolean;
    finalFindingIndexes: number[];
    auditLabels: AuditLabel[];
  }>;
  bookingSupport: Array<{
    commitmentId: string;
    bookingConstraintId: string;
    segmentId: string;
    type: string;
    segmentType: string;
    conditionSupported: "confirmed_fixed_commitment";
    startAtLocal?: string;
    endAtLocal?: string;
    auditLabel: "C";
  }>;
  finalFindings: Array<{ findingIndex: number; finding: ValidationFinding }>;
  auditLabels: AuditLabel[];
}

interface OccurrenceSeed {
  dayIndex: number;
  experienceIndex: number;
  date: string;
  experience: SemanticTravelExperience;
}

export function buildPlannedExperienceReadinessTrace(input: {
  finalPlan: SemanticTravelPlan;
  research: ResearchSet;
  bookingConstraints: BlueprintBookingConstraint[];
  finalReport: ValidationReport;
  replayed?: boolean;
}): PlannedExperienceReadinessTrace {
  const sources = new Set(input.research.sources.map((source) => source.id));
  const placesByName = groupPlacesByNormalizedName(input.research.places);
  const allOccurrences = input.finalPlan.dailyItinerary.flatMap((day, dayIndex) =>
    (day.experiences ?? []).map((experience, experienceIndex): OccurrenceSeed => ({
      dayIndex,
      experienceIndex,
      date: isoDate(day.date) ?? day.date,
      experience
    }))
  );
  const planned = allOccurrences.filter((item) => item.experience.planRole === "planned");
  const findingLinks = linkFindings(planned, allOccurrences, input.finalReport.findings);
  const bookingLinks = linkBookings(planned, input.finalPlan, input.bookingConstraints);

  const occurrences = planned.map((seed, occurrenceIndex): PlannedExperienceReadinessOccurrence => {
    const name = seed.experience.placeName ?? seed.experience.title;
    const candidates = placesByName.get(normalizeName(name)) ?? [];
    const identity = candidates.length === 1
      ? {
          status: "resolved" as const,
          matchingBasis: "exact_normalized_place_name" as const,
          matchedResearchEntity: { id: candidates[0]!.id, name: candidates[0]!.name }
        }
      : candidates.length > 1
        ? {
            status: "ambiguous" as const,
            matchingBasis: "exact_normalized_place_name" as const,
            matchedResearchEntity: { id: candidates.at(-1)!.id, name: candidates.at(-1)!.name },
            candidateResearchEntities: candidates.map((place) => ({ id: place.id, name: place.name })),
            reason: "Multiple ResearchSet entities share the exact normalized name; the Validator map selects the last entity, but the diagnostic does not treat that as unambiguous identity."
          }
        : {
            status: "unresolved" as const,
            matchingBasis: "none" as const,
            reason: "No exact normalized ResearchSet place identity matched the final planned occurrence."
          };
    const linked = findingLinks.byOccurrence.get(occurrenceIndex) ?? [];
    const selectedPlace = candidates.at(-1);
    const conditionChecks = (seed.experience.operationalConditions ?? []).map((condition) => {
      const indexes = linked.filter(({ finding }) => !finding.evidenceRefs?.length && findingMatchesCondition(finding, condition.kind)).map(({ findingIndex }) => findingIndex);
      const linkedFindings = indexes.map((index) => input.finalReport.findings[index]!);
      const labels = labelsForFindings(linkedFindings, "D");
      return {
        kind: condition.kind,
        ...(condition.note ? { note: condition.note } : {}),
        checkStatus: indexes.length ? "performed" as const : "not_performed" as const,
        ...(indexes.length ? {} : { reason: selectedPlace ? "The final Validator did not emit a finding that establishes this plan condition." : "No Research identity was available for this check." }),
        finalFindingIndexes: indexes,
        auditLabels: labels
      };
    });
    const operationalFactChecks = selectedPlace && identity.status !== "unresolved"
      ? factChecks(selectedPlace, seed.date, sources, linked, input.finalReport.findings, identity.status === "ambiguous")
      : [missingClosureCheck("No resolved Research identity was available; closure status is not established.")];
    if (selectedPlace && !selectedPlace.operationalFacts?.access?.closed?.length) {
      operationalFactChecks.unshift(missingClosureCheck("No structured closure fact was present; this does not establish that the place is open."));
    }
    const bookingSupport = bookingLinks.get(occurrenceIndex) ?? [];
    const finalFindings = linked.map(({ findingIndex, finding }) => ({ findingIndex, finding }));
    const auditLabels = uniqueLabels([
      ...(identity.status === "resolved" ? [] : ["D" as const]),
      ...conditionChecks.flatMap((check) => check.auditLabels),
      ...operationalFactChecks.flatMap((check) => check.auditLabels),
      ...bookingSupport.map(() => "C" as const),
      ...labelsForFindings(finalFindings.map((item) => item.finding))
    ]);
    return {
      occurrenceKey: `${seed.date}:day-${seed.dayIndex}:experience-${seed.experienceIndex}`,
      date: seed.date,
      experienceName: seed.experience.title,
      planRole: "planned",
      identity,
      conditionChecks,
      operationalFactChecks,
      bookingSupport,
      finalFindings,
      auditLabels
    };
  });

  return {
    version: "planned_experience_readiness_trace_v1",
    origin: "final_semantic_plan_and_final_validation",
    replayed: input.replayed ?? false,
    counts: {
      plannedExperienceCount: planned.length,
      traceEntryCount: occurrences.length,
      optionalExperienceCount: allOccurrences.filter((item) => item.experience.planRole === "optional").length,
      replacementExperienceCount: allOccurrences.filter((item) => item.experience.planRole === "replacement").length,
      linkedFindingCount: findingLinks.linkedCount,
      unlinkedFindingCount: findingLinks.unlinked.length
    },
    occurrences,
    unlinkedFindings: findingLinks.unlinked
  };
}

export function readinessTraceAvailability(report: unknown):
  | { status: "available"; trace: PlannedExperienceReadinessTrace }
  | { status: "historical_diagnostic_gap"; reason: string } {
  if (isRecord(report) && isRecord(report.readinessTrace) && report.readinessTrace.version === "planned_experience_readiness_trace_v1") {
    return { status: "available", trace: report.readinessTrace as unknown as PlannedExperienceReadinessTrace };
  }
  return {
    status: "historical_diagnostic_gap",
    reason: "This artifact predates planned-experience readiness tracing; item-level facts and findings cannot be reconstructed from aggregate diagnostics."
  };
}

function factChecks(
  place: BlueprintPlace,
  date: string,
  sourceIds: Set<string>,
  linkedFindings: Array<{ findingIndex: number; finding: ValidationFinding }>,
  allFindings: ValidationFinding[],
  ambiguousIdentity: boolean
): PlannedExperienceReadinessOccurrence["operationalFactChecks"] {
  const facts = place.operationalFacts;
  if (!facts) return [];
  const checks: PlannedExperienceReadinessOccurrence["operationalFactChecks"] = [];
  const add = (kind: PlannedExperienceReadinessOccurrence["operationalFactChecks"][number]["kind"], fact: OperationalFact, index: number, validatorUsesDateApplicability: boolean) => {
    const applicability = operationalFactAppliesToDate(fact.appliesTo, date);
    const evidence = evidenceTrace(fact.evidence, sourceIds);
    const evidenceSupportsThisCheck = evidence.some((item) => item.sourceResolved && item.hasSupportingClaim);
    const factEvidenceLabels = new Set(fact.evidence.map(evidenceLabel));
    const compatible = linkedFindings.filter(({ finding }) =>
      findingMatchesFact(finding, kind)
      && Boolean(finding.evidenceRefs?.some((reference) => factEvidenceLabels.has(reference)))
    );
    const applicableToValidator = validatorUsesDateApplicability ? applicability !== "does_not_apply" : true;
    let checkStatus: CheckStatus = "performed";
    let reason: string | undefined;
    if (kind === "last_entry") {
      checkStatus = "not_performed";
      reason = "The current Validator does not evaluate structured last-entry facts."
    } else if (!applicableToValidator) {
      checkStatus = "not_applicable";
      reason = "The structured fact does not apply to this planned date."
    } else if (!evidenceSupportsThisCheck) {
      checkStatus = "not_performed";
      reason = "No evidence reference both resolved to the ResearchSet and carried a supporting claim."
    }
    const labels: AuditLabel[] = ambiguousIdentity
      ? ["D"]
      : checkStatus === "not_applicable"
        ? ["C"]
        : checkStatus === "not_performed"
          ? ["D"]
          : compatible.length
            ? labelsForFindings(compatible.map((item) => item.finding))
            : applicability === "applies" && fact.status === "verified"
              ? ["C"]
              : ["D"];
    checks.push({
      checkKey: `${place.id}:${kind}:${index}`,
      kind,
      factStatus: fact.status,
      checkStatus,
      ...(reason ? { reason } : {}),
      dateApplicability: applicability,
      validatorUsesDateApplicability,
      evidence,
      evidenceSupportsThisCheck,
      finalFindingIndexes: compatible.map((item) => item.findingIndex).filter((findingIndex) => Boolean(allFindings[findingIndex])),
      auditLabels: uniqueLabels(labels)
    });
  };
  (facts.access?.closed ?? []).forEach((fact, index) => add("closure", fact, index, true));
  (facts.access?.windows ?? []).forEach((fact, index) => add("access_window", fact, index, true));
  if (facts.access?.lastEntry) add("last_entry", facts.access.lastEntry, 0, false);
  (facts.sessions ?? []).forEach((fact, index) => add("session", fact, index, true));
  (["reservation", "ticket", "booking", "capacity"] as const).forEach((kind) => {
    const fact = facts.entry?.[kind];
    if (fact) add(kind, fact, 0, false);
  });
  return checks;
}

function missingClosureCheck(reason: string): PlannedExperienceReadinessOccurrence["operationalFactChecks"][number] {
  return {
    checkKey: "closure:not_established",
    kind: "closure",
    checkStatus: "not_performed",
    reason,
    dateApplicability: "indeterminate",
    validatorUsesDateApplicability: true,
    evidence: [],
    evidenceSupportsThisCheck: false,
    finalFindingIndexes: [],
    auditLabels: ["D"]
  };
}

function evidenceTrace(evidence: BlueprintEvidenceRef[], sourceIds: Set<string>) {
  return evidence.map((ref) => ({
    sourceId: ref.sourceId,
    status: ref.status,
    ...(ref.checkedAt ? { checkedAt: ref.checkedAt } : {}),
    sourceResolved: sourceIds.has(ref.sourceId),
    hasSupportingClaim: ref.supports?.some((support) => support.trim().length > 0) ?? false
  }));
}

function evidenceLabel(ref: BlueprintEvidenceRef): string {
  return [ref.sourceId, ref.status, ref.checkedAt].filter(Boolean).join(" · ");
}

function linkFindings(plannedOccurrences: OccurrenceSeed[], allOccurrences: OccurrenceSeed[], findings: ValidationFinding[]) {
  const byOccurrence = new Map<number, Array<{ findingIndex: number; finding: ValidationFinding }>>();
  const unlinked: PlannedExperienceReadinessTrace["unlinkedFindings"] = [];
  let linkedCount = 0;
  findings.forEach((finding, findingIndex) => {
    if (!finding.date || !finding.experience) {
      unlinked.push({ findingIndex, finding, reason: "plan_or_day_level" });
      return;
    }
    const candidates = plannedOccurrences.flatMap((occurrence, occurrenceIndex) => {
      const names = [occurrence.experience.title, occurrence.experience.placeName].filter((value): value is string => Boolean(value)).map(normalizeName);
      return occurrence.date === finding.date && names.includes(normalizeName(finding.experience!)) ? [occurrenceIndex] : [];
    });
    if (candidates.length !== 1) {
      const matchesNonPlanned = allOccurrences.some((occurrence) => {
        if (occurrence.experience.planRole === "planned" || occurrence.date !== finding.date) return false;
        const names = [occurrence.experience.title, occurrence.experience.placeName].filter((value): value is string => Boolean(value)).map(normalizeName);
        return names.includes(normalizeName(finding.experience!));
      });
      unlinked.push({ findingIndex, finding, reason: candidates.length > 1 ? "ambiguous_occurrence" : matchesNonPlanned ? "non_planned_occurrence" : "no_matching_occurrence" });
      return;
    }
    const occurrenceIndex = candidates[0]!;
    byOccurrence.set(occurrenceIndex, [...(byOccurrence.get(occurrenceIndex) ?? []), { findingIndex, finding }]);
    linkedCount += 1;
  });
  return { byOccurrence, unlinked, linkedCount };
}

function linkBookings(occurrences: OccurrenceSeed[], plan: SemanticTravelPlan, bookings: BlueprintBookingConstraint[]) {
  const result = new Map<number, PlannedExperienceReadinessOccurrence["bookingSupport"]>();
  const projectedIds = new Set(plan.fixedCommitments.map((commitment) => commitment.commitmentId));
  for (const booking of bookings) {
    if (booking.status !== "confirmed" || booking.constraintStrength !== "hard") continue;
    for (const segment of booking.segments) {
      const commitmentId = `${booking.id}:${segment.id}`;
      if (!segment.fixedCommitment || !projectedIds.has(commitmentId)) continue;
      const segmentDates = new Set([localDate(segment.startAtLocal), localDate(segment.endAtLocal)].filter((value): value is string => Boolean(value)));
      const bookingNames = [booking.title, segment.title].map(normalizeName);
      const candidates = occurrences.flatMap((occurrence, occurrenceIndex) => {
        const occurrenceNames = [occurrence.experience.title, occurrence.experience.placeName].filter((value): value is string => Boolean(value)).map(normalizeName);
        return segmentDates.has(occurrence.date) && occurrenceNames.some((name) => bookingNames.includes(name)) ? [occurrenceIndex] : [];
      });
      if (candidates.length !== 1) continue;
      const occurrenceIndex = candidates[0]!;
      const support = {
        commitmentId,
        bookingConstraintId: booking.id,
        segmentId: segment.id,
        type: booking.type,
        segmentType: segment.segmentType,
        conditionSupported: "confirmed_fixed_commitment" as const,
        ...(segment.startAtLocal ? { startAtLocal: segment.startAtLocal } : {}),
        ...(segment.endAtLocal ? { endAtLocal: segment.endAtLocal } : {}),
        auditLabel: "C" as const
      };
      result.set(occurrenceIndex, [...(result.get(occurrenceIndex) ?? []), support]);
    }
  }
  return result;
}

function groupPlacesByNormalizedName(places: BlueprintPlace[]): Map<string, BlueprintPlace[]> {
  const result = new Map<string, BlueprintPlace[]>();
  for (const place of places) result.set(normalizeName(place.name), [...(result.get(normalizeName(place.name)) ?? []), place]);
  return result;
}

function findingMatchesCondition(finding: ValidationFinding, kind: string): boolean {
  if (kind === "reservation") return finding.category === "booking_requirement";
  if (kind === "session" || kind === "access" || kind === "weather" || kind === "recheck") return finding.category === "access_recheck" || finding.category === "hard_conflict" || finding.category === "timing_conflict";
  return finding.category === "unresolved_dependency" || finding.category === "route_feasibility";
}

function findingMatchesFact(finding: ValidationFinding, kind: PlannedExperienceReadinessOccurrence["operationalFactChecks"][number]["kind"]): boolean {
  if (kind === "reservation" || kind === "ticket" || kind === "booking" || kind === "capacity") return finding.category === "booking_requirement";
  if (kind === "session") return finding.category === "access_recheck" || finding.category === "timing_conflict" || finding.category === "hard_conflict";
  return finding.category === "access_recheck" || finding.category === "hard_conflict";
}

function labelsForFindings(findings: ValidationFinding[], fallback?: AuditLabel): AuditLabel[] {
  const labels = findings.map((finding): AuditLabel => finding.requiresPlannerRepair ? "A" : "B");
  if (!labels.length && fallback) labels.push(fallback);
  return uniqueLabels(labels);
}

function uniqueLabels(labels: AuditLabel[]): AuditLabel[] {
  const order: AuditLabel[] = ["A", "B", "C", "D"];
  return order.filter((label) => labels.includes(label));
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isoDate(value: string): string | undefined {
  return value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
}

function localDate(value: string | undefined): string | undefined {
  return value?.match(/^(20\d{2}-\d{2}-\d{2})T/)?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
