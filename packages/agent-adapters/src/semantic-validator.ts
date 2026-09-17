import type {
  BlueprintBookingConstraint,
  BlueprintEvidenceRef,
  BlueprintPlace,
  ResearchSet
} from "@c-assistant/core";
import type { SemanticTravelPlan, SemanticTravelExperience } from "./index.js";

type BlueprintOperationalFacts = NonNullable<BlueprintPlace["operationalFacts"]>;
type BlueprintOperationalFactApplicability = NonNullable<NonNullable<NonNullable<BlueprintOperationalFacts["access"]>["closed"]>[number]["appliesTo"]>;
type BlueprintOperationalRequirementFact = NonNullable<NonNullable<BlueprintOperationalFacts["entry"]>["reservation"]>;
type BlueprintOperationalSessionFact = NonNullable<BlueprintOperationalFacts["sessions"]>[number];

export type ValidationReportResult = "pass" | "pass_with_rechecks" | "repair_required";
export type ValidationFindingCategory =
  | "hard_conflict"
  | "timing_conflict"
  | "route_feasibility"
  | "booking_requirement"
  | "access_recheck"
  | "unresolved_dependency";

export interface ValidationFinding {
  date?: string;
  experience?: string;
  category: ValidationFindingCategory;
  explanation: string;
  evidenceRefs?: string[];
  requiresPlannerRepair: boolean;
}

export interface ValidationReport {
  result: ValidationReportResult;
  findings: ValidationFinding[];
  diagnostics?: {
    ignoredInvalidFactCount: number;
  };
}

export type OperationalFactApplicabilityResult = "applies" | "does_not_apply" | "indeterminate";

export interface SemanticValidationContext {
  research: ResearchSet;
  bookingConstraints?: BlueprintBookingConstraint[];
  importerEstimatedMovements?: unknown[];
}

export function validateSemanticTravelPlan(plan: SemanticTravelPlan, context: SemanticValidationContext): ValidationReport {
  const sourceIds = new Set(context.research.sources.map((source) => source.id));
  const placeByName = new Map(context.research.places.map((place) => [normalizeName(place.name), place] as const));
  const findings: ValidationFinding[] = [];
  let ignoredInvalidFactCount = 0;

  for (const day of plan.dailyItinerary) {
    const date = isoDateFromSemanticDate(day.date);
    if (date && unresolvedTravelContext(day.startContext.status)) {
      findings.push(validationFinding({
        date,
        category: "unresolved_dependency",
        explanation: `Start location is not exact yet: ${day.startContext.label}. Exact route timing cannot be validated.`,
        requiresPlannerRepair: false
      }));
    }
    if (date && unresolvedTravelContext(day.endContext.status) && day.endContext.label !== day.startContext.label) {
      findings.push(validationFinding({
        date,
        category: "unresolved_dependency",
        explanation: `End location is not exact yet: ${day.endContext.label}. Exact route timing cannot be validated.`,
        requiresPlannerRepair: false
      }));
    }

    for (const experience of day.experiences ?? []) {
      const place = placeByName.get(normalizeName(experience.placeName ?? experience.title));
      const role = experience.planRole;
      const canRequireRepair = role === "planned";
      const evidenceContext = { date, experience: experience.title, canRequireRepair, sourceIds };

      if (place?.operationalFacts) {
        const result = validateOperationalFacts(place, place.operationalFacts, evidenceContext);
        findings.push(...result.findings);
        ignoredInvalidFactCount += result.ignoredInvalidFactCount;
      }
      if (place?.operationalFacts && operationalFactsHaveEvidence(place.operationalFacts, sourceIds)) {
        findings.push(...validatePlannerAttentionConditions(experience, evidenceContext));
      }
    }
  }

  findings.push(...validateBookingTiming(plan, context.bookingConstraints ?? [], context.research, sourceIds));
  const uniqueFindings = uniqueValidationFindings(findings);
  return {
    result: validationResult(uniqueFindings),
    findings: uniqueFindings,
    ...(ignoredInvalidFactCount ? { diagnostics: { ignoredInvalidFactCount } } : {})
  };
}

export function operationalFactAppliesToDate(applicability: BlueprintOperationalFactApplicability | undefined, date: string): OperationalFactApplicabilityResult {
  if (!validDate(date)) return "indeterminate";
  if (!applicability) return "indeterminate";
  let constrained = false;
  if (applicability.date) {
    if (!validDate(applicability.date)) return "indeterminate";
    constrained = true;
    if (applicability.date !== date) return "does_not_apply";
  }
  if (applicability.startDate || applicability.endDate) {
    if ((applicability.startDate && !validDate(applicability.startDate)) || (applicability.endDate && !validDate(applicability.endDate))) return "indeterminate";
    constrained = true;
    if (applicability.startDate && date < applicability.startDate) return "does_not_apply";
    if (applicability.endDate && date > applicability.endDate) return "does_not_apply";
  }
  if (applicability.weekdays?.length) {
    constrained = true;
    const weekday = weekdayForDate(date);
    if (!weekday) return "indeterminate";
    if (!applicability.weekdays.includes(weekday)) return "does_not_apply";
  }
  return constrained ? "applies" : "indeterminate";
}

function validateOperationalFacts(
  place: BlueprintPlace,
  facts: BlueprintOperationalFacts,
  context: { date: string | undefined; experience: string; canRequireRepair: boolean; sourceIds: Set<string> }
): { findings: ValidationFinding[]; ignoredInvalidFactCount: number } {
  const findings: ValidationFinding[] = [];
  let ignoredInvalidFactCount = 0;

  for (const closed of facts.access?.closed ?? []) {
    const applicability = context.date ? operationalFactAppliesToDate(closed.appliesTo, context.date) : "indeterminate";
    if (applicability === "does_not_apply") continue;
    const evidenceRefs = evidenceLabels(closed.evidence);
    if (!evidenceBacked(closed.evidence, context.sourceIds)) {
      ignoredInvalidFactCount += 1;
      continue;
    }
    if (closed.status === "verified" && applicability === "applies") {
      if (strongEvidence(closed.evidence, context.sourceIds)) {
        findings.push(validationFinding({
          date: context.date,
          experience: context.experience,
          category: "hard_conflict",
          explanation: `${place.name} has a verified closure that applies to the planned date: ${closed.pattern}.`,
          evidenceRefs,
          requiresPlannerRepair: context.canRequireRepair
        }));
      } else {
        ignoredInvalidFactCount += 1;
      }
      continue;
    }
    findings.push(validationFinding({
      date: context.date,
      experience: context.experience,
      category: "access_recheck",
      explanation: `${place.name} has closure/access information that needs confirmation before use: ${closed.pattern}.`,
      evidenceRefs,
      requiresPlannerRepair: false
    }));
  }

  for (const window of facts.access?.windows ?? []) {
    const applicability = context.date ? operationalFactAppliesToDate(window.appliesTo, context.date) : "indeterminate";
    if (applicability !== "does_not_apply") {
      if (!evidenceBacked(window.evidence, context.sourceIds)) {
        ignoredInvalidFactCount += 1;
        continue;
      }
      if (window.status !== "verified" || applicability !== "applies") {
        findings.push(validationFinding({
          date: context.date,
          experience: context.experience,
          category: "access_recheck",
          explanation: `${place.name} access hours should be rechecked for the travel date.`,
          evidenceRefs: evidenceLabels(window.evidence),
          requiresPlannerRepair: false
        }));
      }
    }
  }

  for (const session of facts.sessions ?? []) {
    const applicability = context.date ? operationalFactAppliesToDate(session.appliesTo, context.date) : "indeterminate";
    if (applicability === "does_not_apply") continue;
    if (!evidenceBacked(session.evidence, context.sourceIds)) {
      ignoredInvalidFactCount += 1;
      continue;
    }
    if (session.status !== "verified" || applicability !== "applies") {
      findings.push(validationFinding({
        date: context.date,
        experience: context.experience,
        category: "access_recheck",
        explanation: `${place.name} session timing or inventory needs confirmation for the planned date.`,
        evidenceRefs: evidenceLabels(session.evidence),
        requiresPlannerRepair: false
      }));
    }
  }

  for (const requirement of requirementFacts(facts)) {
    if (requirement.requirement === "required" || requirement.requirement === "recommended") {
      if (!evidenceBacked(requirement.evidence, context.sourceIds)) {
        ignoredInvalidFactCount += 1;
        continue;
      }
      findings.push(validationFinding({
        date: context.date,
        experience: context.experience,
        category: "booking_requirement",
        explanation: `${place.name} has a ${requirement.requirement.replace("_", " ")} reservation, ticket, booking, or capacity requirement.`,
        evidenceRefs: evidenceLabels(requirement.evidence),
        requiresPlannerRepair: false
      }));
    }
  }

  return { findings, ignoredInvalidFactCount };
}

function validatePlannerAttentionConditions(
  experience: SemanticTravelExperience,
  context: { date: string | undefined; experience: string; canRequireRepair: boolean }
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const condition of experience.operationalConditions ?? []) {
    if (condition.kind === "reservation" || condition.kind === "session") {
      findings.push(validationFinding({
        date: context.date,
        experience: context.experience,
        category: condition.kind === "reservation" ? "booking_requirement" : "access_recheck",
        explanation: condition.note ?? `${experience.title} needs ${condition.kind} confirmation.`,
        requiresPlannerRepair: false
      }));
    } else if (condition.kind === "route" || condition.kind === "traveler_choice") {
      findings.push(validationFinding({
        date: context.date,
        experience: context.experience,
        category: "unresolved_dependency",
        explanation: condition.note ?? `${experience.title} depends on a decision or route that is not fixed yet.`,
        requiresPlannerRepair: false
      }));
    } else if (condition.kind === "access" || condition.kind === "weather" || condition.kind === "recheck") {
      findings.push(validationFinding({
        date: context.date,
        experience: context.experience,
        category: "access_recheck",
        explanation: condition.note ?? `${experience.title} needs operational recheck.`,
        requiresPlannerRepair: false
      }));
    }
  }
  return findings;
}

function validateBookingTiming(plan: SemanticTravelPlan, bookings: BlueprintBookingConstraint[], research: ResearchSet, sourceIds: Set<string>): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const fixedSegments = bookings
    .filter((booking) => booking.status === "confirmed" && booking.constraintStrength === "hard")
    .flatMap((booking) => booking.segments.filter((segment) => segment.fixedCommitment && segment.startAtLocal));
  if (!fixedSegments.length) return findings;
  const placeByName = new Map(research.places.map((place) => [normalizeName(place.name), place] as const));
  for (const day of plan.dailyItinerary) {
    const date = isoDateFromSemanticDate(day.date);
    if (!date) continue;
    for (const experience of day.experiences ?? []) {
      if (experience.planRole !== "planned") continue;
      const place = placeByName.get(normalizeName(experience.placeName ?? experience.title));
      for (const session of place?.operationalFacts?.sessions ?? []) {
        if (!verifiedApplicableSession(session, date, sourceIds) || !session.endsAt) continue;
        const sessionEnd = minuteOfDay(session.endsAt);
        if (sessionEnd === undefined) continue;
        for (const segment of fixedSegments) {
          if (dateFromLocalDateTime(segment.startAtLocal) !== date) continue;
          const commitmentStart = timeFromLocalDateTime(segment.startAtLocal);
          if (commitmentStart === undefined) continue;
          if (sessionEnd <= commitmentStart) continue;
          findings.push(validationFinding({
            date,
            experience: experience.title,
            category: "timing_conflict",
            explanation: `${experience.title} session ends at ${session.endsAt}, after confirmed fixed commitment ${segment.title} starts at ${segment.startAtLocal}.`,
            evidenceRefs: evidenceLabels(session.evidence),
            requiresPlannerRepair: true
          }));
        }
      }
    }
  }
  return findings;
}

function verifiedApplicableSession(session: BlueprintOperationalSessionFact, date: string, sourceIds: Set<string>): boolean {
  return session.status === "verified"
    && operationalFactAppliesToDate(session.appliesTo, date) === "applies"
    && strongEvidence(session.evidence, sourceIds);
}

function requirementFacts(facts: BlueprintOperationalFacts): BlueprintOperationalRequirementFact[] {
  return [
    facts.entry?.reservation,
    facts.entry?.ticket,
    facts.entry?.booking,
    facts.entry?.capacity
  ].filter((fact): fact is BlueprintOperationalRequirementFact => Boolean(fact));
}

function strongEvidence(evidence: BlueprintEvidenceRef[], sourceIds: Set<string>): boolean {
  return evidence.some((ref) => ref.status === "verified" && sourceIds.has(ref.sourceId) && (ref.supports?.some((support) => support.trim()) ?? false));
}

function evidenceBacked(evidence: BlueprintEvidenceRef[], sourceIds: Set<string>): boolean {
  return evidence.some((ref) => sourceIds.has(ref.sourceId) && (ref.supports?.some((support) => support.trim()) ?? false));
}

function operationalFactsHaveEvidence(facts: BlueprintOperationalFacts, sourceIds: Set<string>): boolean {
  return [
    ...(facts.access?.windows ?? []).flatMap((fact) => fact.evidence),
    ...(facts.access?.closed ?? []).flatMap((fact) => fact.evidence),
    ...(facts.access?.lastEntry?.evidence ?? []),
    ...(facts.sessions ?? []).flatMap((fact) => fact.evidence),
    ...(facts.entry?.reservation?.evidence ?? []),
    ...(facts.entry?.ticket?.evidence ?? []),
    ...(facts.entry?.booking?.evidence ?? []),
    ...(facts.entry?.capacity?.evidence ?? [])
  ].some((ref) => evidenceBacked([ref], sourceIds));
}

function evidenceLabels(evidence: BlueprintEvidenceRef[]): string[] {
  return evidence.map((ref) => [ref.sourceId, ref.status, ref.checkedAt].filter(Boolean).join(" · "));
}

function unresolvedTravelContext(status: string): boolean {
  return status === "planned_base_pending_property" || status === "unresolved_base";
}

function validationResult(findings: ValidationFinding[]): ValidationReportResult {
  if (!findings.length) return "pass";
  return findings.some((finding) => finding.requiresPlannerRepair) ? "repair_required" : "pass_with_rechecks";
}

function validationFinding(input: {
  date?: string | undefined;
  experience?: string | undefined;
  category: ValidationFindingCategory;
  explanation: string;
  evidenceRefs?: string[] | undefined;
  requiresPlannerRepair: boolean;
}): ValidationFinding {
  return {
    category: input.category,
    explanation: input.explanation,
    requiresPlannerRepair: input.requiresPlannerRepair,
    ...(input.date ? { date: input.date } : {}),
    ...(input.experience ? { experience: input.experience } : {}),
    ...(input.evidenceRefs?.length ? { evidenceRefs: input.evidenceRefs } : {})
  };
}

function uniqueValidationFindings(findings: ValidationFinding[]): ValidationFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify([finding.date, finding.experience, finding.category, finding.explanation, finding.requiresPlannerRepair]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isoDateFromSemanticDate(value: string): string | undefined {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  return iso && validDate(iso) ? iso : undefined;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function weekdayForDate(value: string): NonNullable<BlueprintOperationalFactApplicability["weekdays"]>[number] | undefined {
  if (!validDate(value)) return undefined;
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(`${value}T00:00:00Z`).getUTCDay()] as NonNullable<BlueprintOperationalFactApplicability["weekdays"]>[number];
}

function minuteOfDay(value: string): number | undefined {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function dateFromLocalDateTime(value: string | undefined): string | undefined {
  return value?.match(/(20\d{2}-\d{2}-\d{2})/)?.[1];
}

function timeFromLocalDateTime(value: string | undefined): number | undefined {
  const match = value?.match(/([01]\d|2[0-3]):([0-5]\d)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}
