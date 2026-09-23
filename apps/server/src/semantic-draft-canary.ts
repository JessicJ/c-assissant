import {
  RuntimeAdapterError,
  runSemanticPlanRepairOnce,
  semanticFixedCommitmentsFromBookingConstraints,
  structureSemanticTravelPlan,
  validateSemanticTravelPlan,
  type CodexRuntimeAdapter,
  type SemanticTravelPlan,
  type ValidationReport
} from "@c-assistant/agent-adapters";
import type { BlueprintBookingConstraint, PlanningSession, ResearchSet, WorkspaceSnapshot } from "@c-assistant/core";
import { buildPlannedExperienceReadinessTrace } from "./semantic-readiness-trace.js";
import { planningTravelDateRange } from "./planning-session-facts.js";

export interface SemanticDraftCanaryConfig {
  enabled: boolean;
  localEnvironment: boolean;
  allowedSessionIds: string[];
}

export function semanticDraftCanaryEligible(config: SemanticDraftCanaryConfig, sessionId: string): boolean {
  return config.enabled
    && config.localEnvironment
    && (config.allowedSessionIds.length === 0 || config.allowedSessionIds.includes(sessionId));
}

export async function generateSemanticDraft(input: {
  codex: Pick<CodexRuntimeAdapter, "generateSemanticTravelPlan" | "generateSemanticTravelPlanRepair">;
  request: string;
  profile: {
    preferredLanguage: WorkspaceSnapshot["profile"]["preferredLanguage"];
    nationality: WorkspaceSnapshot["profile"]["nationality"];
    gender: WorkspaceSnapshot["profile"]["gender"];
    immigrationStatus: WorkspaceSnapshot["profile"]["immigrationStatus"];
  };
  research: ResearchSet;
  destinations: string[];
  bookingConstraints: BlueprintBookingConstraint[];
  session: PlanningSession;
  signal: AbortSignal;
}) {
  const timings = { plannerMs: 0, validatorMs: 0, repairMs: 0, structurerMs: 0, plannerCalls: 0, repairCalls: 0, validatorCalls: 0 };
  let stage = "planner";
  let initialReport: ValidationReport | undefined;
  let finalReport: ValidationReport | undefined;
  let repairAttempted = false;
  let structurerDestinations: string[] | undefined;
  let destinationGate: { expected: string[]; actual: string[]; matched: boolean } | undefined;
  let rawSemanticOutput: string | undefined;
  let parsedInitialPlan: SemanticTravelPlan | undefined;
  let rawRepairOutput: string | undefined;
  let repairedPlan: SemanticTravelPlan | undefined;
  let structuredDiagnostic: ReturnType<typeof structureSemanticTravelPlan> | undefined;
  let publicationGate: { passed: boolean; reason?: string } | undefined;
  try {
  const authoritativeConstraints = authoritativeSemanticCommitmentConstraints(input.session, input.bookingConstraints);
  const fixedCommitments = semanticFixedCommitmentsFromBookingConstraints(authoritativeConstraints);
  let startedAt = Date.now();
  timings.plannerCalls += 1;
  const semantic = await input.codex.generateSemanticTravelPlan({
    request: input.request,
    research: input.research,
    fixedCommitments,
    profile: input.profile,
    signal: input.signal
  });
  rawSemanticOutput = semantic.rawJson;
  parsedInitialPlan = semantic.plan;
  timings.plannerMs = Date.now() - startedAt;

  stage = "validator";
  const validationContext = { research: input.research, bookingConstraints: authoritativeConstraints };
  startedAt = Date.now();
  timings.validatorCalls += 1;
  const initialValidationReport = validateSemanticTravelPlan(semantic.plan, validationContext);
  initialReport = initialValidationReport;
  timings.validatorMs += Date.now() - startedAt;
  let finalPlan: SemanticTravelPlan = semantic.plan;
  finalReport = initialValidationReport;

  if (initialReport.result === "repair_required" && initialReport.findings.some((finding) => finding.requiresPlannerRepair)) {
    stage = "repair";
    startedAt = Date.now();
    const repair = await runSemanticPlanRepairOnce({
      plan: semantic.plan,
      validationContext,
      planningContext: input.request,
      validate: (plan, context) => {
        if (plan === semantic.plan) return initialValidationReport;
        timings.validatorCalls += 1;
        const validationStartedAt = Date.now();
        const report = validateSemanticTravelPlan(plan, context);
        timings.validatorMs += Date.now() - validationStartedAt;
        return report;
      },
      repairer: async (request) => {
        timings.repairCalls += 1;
        const result = await input.codex.generateSemanticTravelPlanRepair({ prompt: request.prompt, signal: input.signal });
        rawRepairOutput = result.rawJson;
        repairedPlan = result.plan;
        return result.plan;
      }
    });
    timings.repairMs = Date.now() - startedAt;
    repairAttempted = repair.plannerInvoked;
    if (repair.repairedPlan) finalPlan = repair.repairedPlan;
    if (repair.repairedReport) finalReport = repair.repairedReport;
  }

  stage = repairAttempted ? "post_repair_validator" : "validator";
  if (finalReport.result === "repair_required" || finalReport.findings.some((finding) => finding.requiresPlannerRepair)) {
    throw new RuntimeAdapterError("invalid_output", "Semantic draft still has an unresolved hard conflict after the single allowed repair.");
  }

  stage = "structurer";
  startedAt = Date.now();
  const structured = structureSemanticTravelPlan(finalPlan, input.research, {
    importBlueprint: false,
    hardenContract: false,
    bookingConstraints: authoritativeConstraints,
    destinations: input.destinations
  });
  structuredDiagnostic = structured;
  timings.structurerMs = Date.now() - startedAt;
  structurerDestinations = [...structured.artifact.destinations];
  stage = "publication_gate";
  destinationGate = destinationGateComparison(input.destinations, structured.artifact.destinations);
  try {
    assertSemanticPublicationGate(input.session, finalPlan, finalReport, structured, authoritativeConstraints, input.destinations);
    publicationGate = { passed: true };
  } catch (error) {
    publicationGate = { passed: false, reason: error instanceof Error ? error.message : "Publication gate failed." };
    throw error;
  }
  const readinessTrace = buildPlannedExperienceReadinessTrace({
    finalPlan,
    research: input.research,
    bookingConstraints: authoritativeConstraints,
    finalReport
  });
  return {
    finalPlan,
    finalReport,
    initialReport,
    structured,
    readinessTrace,
    repairAttempted,
    timings,
    diagnosticArtifact: {
      rawSemanticOutput,
      parsedInitialPlan,
      finalPlan,
      initialValidatorReport: initialReport,
      finalValidatorReport: finalReport,
      repair: { attempted: repairAttempted, rawOutput: rawRepairOutput, repairedPlan },
      structurer: structured,
      publicationGate
    }
  };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("Semantic Canary generation failed."), {
      semanticCanaryFailure: {
        stage,
        timings: { ...timings },
        ...(initialReport && finalReport ? {
          validator: {
            initialResult: initialReport.result,
            finalResult: finalReport.result,
            finalRepairRequiredFindingCount: finalReport.findings.filter((finding) => finding.requiresPlannerRepair).length
          },
          repairAttempted
        } : {}),
        ...(structurerDestinations ? { structurerDestinations } : {}),
        ...(destinationGate ? { destinationGate } : {}),
        diagnosticArtifact: {
          rawSemanticOutput,
          parsedInitialPlan,
          finalPlan: repairedPlan ?? parsedInitialPlan,
          initialValidatorReport: initialReport,
          finalValidatorReport: finalReport,
          repair: { attempted: repairAttempted, rawOutput: rawRepairOutput, repairedPlan },
          structurer: structuredDiagnostic,
          publicationGate: publicationGate ?? { passed: false, reason: error instanceof Error ? error.message : "Semantic generation failed." }
        }
      }
    });
  }
}

/**
 * Builds the complete authoritative commitment set used by Semantic planning.
 * A confirmed user-supplied flight fact is authoritative even when no imported
 * booking row exists yet.
 */
export function authoritativeSemanticCommitmentConstraints(
  session: PlanningSession,
  bookingConstraints: BlueprintBookingConstraint[]
): BlueprintBookingConstraint[] {
  const constraints = structuredClone(bookingConstraints);
  const occupied = new Set(constraints.flatMap((constraint) => constraint.segments.map((segment) => `${segment.startAtLocal ?? ""}\u0000${normalized(segment.origin ?? "")}`)));
  const userText = session.messages.filter((message) => message.role === "user").map((message) => message.text).join("\n");
  for (const fact of explicitUserFlightDepartures(userText, session.id, session.createdAt)) {
    const segment = fact.segments[0]!;
    const key = `${segment.startAtLocal ?? ""}\u0000${normalized(segment.origin ?? "")}`;
    if (occupied.has(key)) continue;
    constraints.push(fact);
    occupied.add(key);
  }
  return constraints;
}

function explicitUserFlightDepartures(text: string, sessionId: string, importedAt: string): BlueprintBookingConstraint[] {
  const results: BlueprintBookingConstraint[] = [];
  const chinese = /(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*从\s*([^，。；;\n]{1,48}?)\s*(?:出发|起飞)/gu;
  for (const match of text.matchAll(chinese)) {
    const [, year, month, day, hour, minute, originText] = match;
    const origin = normalizeFlightNode(originText!);
    const destination = destinationAfterDeparture(text.slice(match.index! + match[0].length));
    results.push(userFlightConstraint(sessionId, importedAt, `${year}-${pad(month!)}-${pad(day!)}T${pad(hour!)}:${minute}`, origin, destination));
  }
  const english = /(?:depart(?:ing|ure)?|fly(?:ing)?)\s+(?:from\s+)?([^,.!?;\n]{1,48}?)\s+(?:on\s+)?(20\d{2})-(\d{1,2})-(\d{1,2})\s+(?:at\s+)?(\d{1,2}):(\d{2})/giu;
  for (const match of text.matchAll(english)) {
    const [, originText, year, month, day, hour, minute] = match;
    results.push(userFlightConstraint(sessionId, importedAt, `${year}-${pad(month!)}-${pad(day!)}T${pad(hour!)}:${minute}`, normalizeFlightNode(originText!), undefined));
  }
  return results;
}

function userFlightConstraint(sessionId: string, importedAt: string, startAtLocal: string, origin: string, destination: string | undefined): BlueprintBookingConstraint {
  const dateTimeId = startAtLocal.replace(/[^0-9]/g, "");
  const id = `user-fact-flight-${sessionId}-${dateTimeId}`;
  return {
    id,
    type: "flight",
    title: `Confirmed flight departure from ${origin}`,
    status: "confirmed",
    sourceLabel: "Explicit confirmed user fact",
    importedAt,
    constraintStrength: "hard",
    segments: [{
      id: `departure-${dateTimeId}`,
      segmentType: "flight_leg",
      title: `${startAtLocal.slice(0, 10)} ${startAtLocal.slice(11)} departure from ${origin}`,
      startAtLocal,
      ...(origin.toLocaleUpperCase().includes("LAX") ? { startTimeZone: "America/Los_Angeles" } : {}),
      origin,
      ...(destination ? { destination } : {}),
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}

function destinationAfterDeparture(value: string): string | undefined {
  const match = value.match(/(?:经|途经)\s*([^，。；;\n]{1,32}?)(?:转机|中转)/u);
  return match?.[1]?.trim();
}

function normalizeFlightNode(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (/LAX|洛杉矶/i.test(compact)) return "Los Angeles International Airport (LAX)";
  if (/DPS|巴厘岛|伍拉赖|Ngurah Rai/i.test(compact)) return "I Gusti Ngurah Rai International Airport (DPS)";
  return compact;
}

function pad(value: string): string {
  return value.padStart(2, "0");
}

export function semanticCanaryFailureDetails(error: unknown): {
  stage: string;
  timings: Record<string, number>;
  validator?: { initialResult: string; finalResult: string; finalRepairRequiredFindingCount: number };
  repairAttempted?: boolean;
  structurerDestinations?: string[];
  destinationGate?: { expected: string[]; actual: string[]; matched: boolean };
  diagnosticArtifact?: unknown;
} | undefined {
  if (!(error instanceof Error) || !("semanticCanaryFailure" in error)) return undefined;
  const value = (error as Error & { semanticCanaryFailure?: unknown }).semanticCanaryFailure;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    stage?: unknown;
    timings?: unknown;
    validator?: { initialResult: string; finalResult: string; finalRepairRequiredFindingCount: number };
    repairAttempted?: boolean;
    structurerDestinations?: string[];
    destinationGate?: { expected: string[]; actual: string[]; matched: boolean };
    diagnosticArtifact?: unknown;
  };
  if (typeof candidate.stage !== "string" || !candidate.timings || typeof candidate.timings !== "object") return undefined;
  return {
    stage: candidate.stage,
    timings: candidate.timings as Record<string, number>,
    ...(candidate.validator ? { validator: candidate.validator } : {}),
    ...(candidate.repairAttempted === undefined ? {} : { repairAttempted: candidate.repairAttempted }),
    ...(candidate.structurerDestinations ? { structurerDestinations: candidate.structurerDestinations } : {}),
    ...(candidate.destinationGate ? { destinationGate: candidate.destinationGate } : {}),
    ...(candidate.diagnosticArtifact === undefined ? {} : { diagnosticArtifact: candidate.diagnosticArtifact })
  };
}

function assertSemanticPublicationGate(
  session: PlanningSession,
  plan: SemanticTravelPlan,
  report: ValidationReport,
  structured: ReturnType<typeof structureSemanticTravelPlan>,
  bookingConstraints: BlueprintBookingConstraint[],
  confirmedDestinations: string[]
): void {
  const expectedDates = planningDates(session);
  const actualDates = plan.dailyItinerary.map((day) => day.date);
  if (JSON.stringify(actualDates) !== JSON.stringify(expectedDates)) {
    throw new RuntimeAdapterError("invalid_output", `Semantic draft dates do not match the confirmed request: expected ${expectedDates.join(", ")}, got ${actualDates.join(", ")}.`);
  }
  if (plan.dailyItinerary.some((day) => !day.startContext?.label || !day.endContext?.label)) {
    throw new RuntimeAdapterError("invalid_output", "Semantic draft is missing required day start/end context.");
  }
  if (report.result === "repair_required") throw new RuntimeAdapterError("invalid_output", "Semantic draft cannot publish with repair-required findings.");
  const lossy = structured.fidelity.filter((item) => item.classification === "CHANGED" || item.classification === "DROPPED");
  if (lossy.length) throw new RuntimeAdapterError("invalid_output", `Semantic Structurer changed or dropped travel decisions: ${lossy[0]!.subject}.`);
  const expectedCommitmentIds = bookingConstraints
    .filter((constraint) => constraint.status === "confirmed" && constraint.constraintStrength === "hard")
    .flatMap((constraint) => constraint.segments.filter((segment) => segment.fixedCommitment && segment.constraintStrength === "hard").map((segment) => `${constraint.id}:${segment.id}`));
  const preservedCommitmentIds = new Set(structured.preservedBookingConstraints.flatMap((constraint) => constraint.segments.map((segment) => `${constraint.id}:${segment.id}`)));
  const missing = expectedCommitmentIds.filter((id) => !preservedCommitmentIds.has(id));
  if (missing.length) throw new RuntimeAdapterError("invalid_output", `Semantic Structurer did not preserve confirmed hard commitment ${missing[0]}.`);
  const comparison = destinationGateComparison(confirmedDestinations, structured.artifact.destinations);
  if (!comparison.matched) {
    throw new RuntimeAdapterError("invalid_output", `Semantic Structurer destinations do not match the confirmed request (${confirmedDestinations.join(" + ")}).`);
  }
}

export function destinationGateComparison(expected: string[], actual: string[]): { expected: string[]; actual: string[]; matched: boolean } {
  const normalizedExpected = [...new Set(expected.map(normalized))].sort();
  const normalizedActual = [...new Set(actual.map(normalized))].sort();
  return { expected: [...expected], actual: [...actual], matched: JSON.stringify(normalizedExpected) === JSON.stringify(normalizedActual) };
}

function planningDates(session: PlanningSession): string[] {
  const value = session.facts.find((fact) => fact.key === "travel_dates" && fact.confirmed)?.value;
  const range = value ? planningTravelDateRange(value) : undefined;
  if (!range) throw new RuntimeAdapterError("invalid_request", "Semantic Canary requires a confirmed, unambiguous travel date range.");
  const start = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate}T00:00:00Z`);
  const result: string[] = [];
  for (let cursor = start; cursor <= end && result.length <= 60; cursor = new Date(cursor.getTime() + 86_400_000)) result.push(cursor.toISOString().slice(0, 10));
  if (!result.length || result.length > 60) throw new RuntimeAdapterError("invalid_request", "Semantic Canary travel date range is invalid or too long.");
  return result;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
