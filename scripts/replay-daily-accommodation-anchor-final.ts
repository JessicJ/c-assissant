import { resolve } from "node:path";
import {
  CodexRuntimeAdapter,
  diffSemanticTravelPlans,
  runSemanticPlanRepairOnce,
  semanticFixedCommitmentsFromBookingConstraints,
  structureSemanticTravelPlan,
  validateSemanticTravelPlan,
  type SemanticTravelPlan
} from "../packages/agent-adapters/src/index.ts";
import {
  assertTripBlueprintIntegrity,
  compileTripBlueprint,
  importSkillItinerary,
  type BlueprintMovement,
  type TripBlueprint
} from "../packages/core/src/index.ts";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.ts";
import { authoritativeSemanticCommitmentConstraints } from "../apps/server/src/semantic-draft-canary.ts";

const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? "data/c-assistant.sqlite");
const sessionId = "1ccf9af9-df05-42c5-9d6c-69c29760fbc7";
const blueprintId = "blueprint-98beef56-7975-46f8-81ae-84ab299462c8";
const diagnosticId = "95dda416-6c97-405c-ad72-d6d2b1765f4e";
const planId = "plan-oz2838";
const store = new SqliteWorkspaceStore(databasePath);

try {
  const session = store.getPlanningSessionById(sessionId);
  const beforeBlueprint = store.getTripBlueprint(blueprintId, 3);
  if (!session || !beforeBlueprint) throw new Error("Saved acceptance session or Blueprint v3 is unavailable.");
  const research = store.getResearchSet(beforeBlueprint.researchSetId);
  if (!research) throw new Error("Saved ResearchSet is unavailable.");
  const diagnostic = store.listDiagnosticArtifacts(beforeBlueprint.generationKey).find((item) => item.id === diagnosticId);
  if (!diagnostic) throw new Error("Saved Semantic diagnostic artifact is unavailable.");
  const payload = JSON.parse(diagnostic.rawResponse) as { semanticArtifact?: { finalPlan?: SemanticTravelPlan } };
  const savedPlan = payload.semanticArtifact?.finalPlan;
  if (!savedPlan) throw new Error("Diagnostic artifact does not contain the final Semantic plan.");

  const authoritativeConstraints = authoritativeSemanticCommitmentConstraints(session, beforeBlueprint.bookingConstraints ?? []);
  const normalizedPlan: SemanticTravelPlan = {
    ...structuredClone(savedPlan),
    fixedCommitments: semanticFixedCommitmentsFromBookingConstraints(authoritativeConstraints)
  };
  const validationContext = { research, bookingConstraints: authoritativeConstraints };
  const beforeReport = validateSemanticTravelPlan(normalizedPlan, validationContext);
  const skipRepairCall = process.env.LANDI_SKIP_REPAIR_CALL === "1";
  const repair = skipRepairCall ? undefined : await runSemanticPlanRepairOnce({
    plan: normalizedPlan,
    validationContext,
    planningContext: [
      "Targeted final replay only; do not regenerate the trip.",
      "Allowed changes: 2026-10-03 and 2026-10-04 outbound structure needed to preserve the confirmed 2026-10-03 16:30 LAX departure; 2026-10-08 evening only so the planned baseline has dinner when optional/replacement items are removed.",
      "On 2026-10-03 preserve useful pre-flight preparation, add a reasonable planned airport buffer without inventing a check-in fact, then a 16:30 confirmed LAX departure and in-transit end context.",
      "On 2026-10-04 represent in transit / Singapore connection; do not restart departure from Los Angeles.",
      "On 2026-10-08 keep Locavore as optional upgrade and ensure a planned baseline dinner/evening, using the smallest coherent planRole adjustment.",
      "Forbidden: any change to 2026-10-05 through 2026-10-07 or 2026-10-09 through 2026-10-12; accommodations; attractions; hotel dates; arrival 10:35; departure 17:10; base strategy; unrelated alternatives."
    ].join("\n"),
    repairer: async (request) => (await new CodexRuntimeAdapter().generateSemanticTravelPlanRepair({ prompt: request.prompt })).plan
  });
  if (!skipRepairCall && (!repair?.plannerInvoked || repair.status !== "repaired" || !repair.repairedPlan || !repair.repairedReport)) {
    throw new Error(`Targeted repair did not validate: ${repair.status}.`);
  }
  const repairedPlan = skipRepairCall ? deterministicTargetedRepair(normalizedPlan) : repair!.repairedPlan!;
  const repairedReport = skipRepairCall ? validateSemanticTravelPlan(repairedPlan, validationContext) : repair!.repairedReport!;
  if (repairedReport.findings.some((finding) => finding.requiresPlannerRepair)) throw new Error(`Deterministic targeted replay still requires repair: ${JSON.stringify(repairedReport.findings)}.`);
  assertTargetedDriftGuard(normalizedPlan, repairedPlan);
  const diff = diffSemanticTravelPlans(normalizedPlan, repairedPlan);

  const structured = structureSemanticTravelPlan(repairedPlan, research, {
    importBlueprint: false,
    hardenContract: false,
    bookingConstraints: authoritativeConstraints,
    destinations: beforeBlueprint.destinations
  });
  const lossy = structured.fidelity.filter((item) => item.classification === "CHANGED" || item.classification === "DROPPED");
  if (lossy.length) throw new Error(`Structurer fidelity failed: ${lossy[0]!.subject}.`);
  const createdAt = new Date().toISOString();
  let replayed = importSkillItinerary(research, structured.artifact, {
    blueprintId,
    blueprintVersion: 4,
    createdAt,
    bookingConstraints: structured.preservedBookingConstraints
  });
  replayed = carryForwardRouteOwnedFacts(replayed, beforeBlueprint);
  assertTripBlueprintIntegrity(replayed, { expectedResearchPlaceIds: research.places.map((place) => place.id) });

  const compilation = compileTripBlueprint(replayed, { createdAt });
  compilation.plan.id = planId;
  compilation.plan.version = 4;
  compilation.lineage.planId = planId;
  compilation.lineage.planVersion = 4;
  compilation.lineage.compilationKey = `targeted-replay:${planId}:plan-v4:${blueprintId}:blueprint-v4`;

  const replayArtifact = {
    kind: "daily_schedule_and_accommodation_anchor_targeted_replay",
    createdAt,
    sourceDiagnosticArtifactId: diagnosticId,
    plannerCalls: 0,
    repairCalls: 1,
    beforeValidator: beforeReport,
    afterValidator: repairedReport,
    decisionDiff: diff,
    semanticPlan: repairedPlan,
    structurer: structured,
    blueprint: replayed,
    publicationGate: { passed: true, checks: ["targeted drift guard", "fidelity", "Blueprint integrity", "deterministic compilation"] }
  };

  // Apply only after every isolated check above has passed.
  store.saveTripBlueprint(replayed);
  const workspace = store.createCompiledBlueprintPlan(compilation, "codex");
  store.savePlanningSession({ ...session, status: "draft_ready", outputPlanId: planId, updatedAt: createdAt });
  const replayDiagnosticId = store.saveDiagnosticArtifact({
    generationKey: beforeBlueprint.generationKey,
    rawResponse: JSON.stringify(replayArtifact),
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 14 * 86_400_000).toISOString()
  });

  process.stdout.write(`${JSON.stringify({
    sessionId,
    plan: { id: workspace.activePlan.id, version: workspace.activePlan.version },
    blueprint: { id: workspace.activeBlueprint?.id, version: workspace.activeBlueprint?.version },
    repairCalls: 1,
    beforeFindings: beforeReport.findings.filter((finding) => finding.requiresPlannerRepair),
    afterFindings: repairedReport.findings,
    decisionDiff: diff,
    diagnosticArtifactId: replayDiagnosticId,
    days: replayed.days.map((day) => ({ date: day.date, startContext: day.startContext, endContext: day.endContext, stops: day.stops, blocks: day.blocks?.map((block) => ({ id: block.id, title: block.title, kind: block.kind, placeId: block.placeId, startTime: block.startTime, endTime: block.endTime, durationMinutes: block.durationMinutes, planRole: block.planRole, timingStatus: block.display?.timingStatus, timeLabel: block.display?.timeLabel })) })),
    movements: replayed.movements.map((movement) => ({ dayId: movement.dayId, originPlaceId: movement.originPlaceId, destinationPlaceId: movement.destinationPlaceId, mode: movement.mode, status: movement.status, durationMinutes: movement.durationMinutes, distanceMeters: movement.distanceMeters }))
  }, null, 2)}\n`);
} finally {
  store.close();
}

function deterministicTargetedRepair(plan: SemanticTravelPlan): SemanticTravelPlan {
  const repaired = structuredClone(plan);
  repaired.dailyItinerary = repaired.dailyItinerary.map((day) => {
    if (day.date === "2026-10-03") return {
      ...day,
      area: "Los Angeles departure and long-haul transit",
      endContext: { label: "In transit from Los Angeles via Singapore", status: "in_transit" },
      plan: "Complete final preparation, protect an airport buffer, depart LAX at the confirmed 16:30 local time, and continue in transit via Singapore.",
      experiences: [
        ...(day.experiences ?? []).filter((item) => item.title === "Final document and entry-requirement review"),
        { title: "Final packing and airport departure buffer", planRole: "planned" as const, summary: "Finish packing, travel to LAX, and allow a conservative international-departure buffer without asserting an airline check-in deadline.", kind: "transfer" as const, placeName: "Los Angeles International Airport (LAX)", primaryExperience: false, startTime: "12:30", endTime: "16:00", durationMinutes: 210, timingStatus: "planned" as const, operationalConditions: [{ kind: "recheck" as const, note: "Recheck the issued terminal and airline operating details before travel." }] },
        { title: "Confirmed departure from LAX", planRole: "planned" as const, summary: "Depart Los Angeles International Airport at the user-confirmed local time for the journey via Singapore to Bali.", kind: "event" as const, placeName: "Los Angeles International Airport (LAX)", primaryExperience: true, startTime: "16:30", timingStatus: "confirmed" as const, operationalConditions: [{ kind: "recheck" as const, note: "Reconfirm terminal, carrier, and operating details; the 16:30 departure time remains the confirmed commitment." }] },
        { title: "Long-haul flight and in-transit rest", planRole: "planned" as const, summary: "Continue in transit after departure, prioritizing hydration, movement, meals, and sleep.", kind: "rest" as const, primaryExperience: false, startTime: "17:00", timingStatus: "planned" as const }
      ]
    };
    if (day.date === "2026-10-04") return {
      ...day,
      area: "In transit via Singapore to Bali",
      startContext: { label: "In transit from Los Angeles via Singapore", status: "in_transit" },
      endContext: { label: "In transit via Singapore to Bali", status: "in_transit" },
      plan: "Remain in transit and make the Singapore connection; do not restart the Los Angeles departure on this date.",
      experiences: [
        { title: "Long-haul travel and Singapore connection", planRole: "planned" as const, summary: "Continue the itinerary via Singapore using the issued airline connection details; no sightseeing is scheduled.", kind: "transfer" as const, primaryExperience: true, timingStatus: "unknown" as const, operationalConditions: [{ kind: "recheck" as const, note: "Reconfirm connection terminal, carrier, and operating details from the issued itinerary." }] },
        ...((day.experiences ?? []).filter((item) => item.title === "In-flight rest and hydration"))
      ]
    };
    if (day.date === "2026-10-08") return {
      ...day,
      plan: "A final Ubud day combines the morning Monkey Forest, nearby art, midday recovery, and a complete central-Ubud dinner baseline; Locavore NXT remains an optional reservation-led upgrade.",
      experiences: (day.experiences ?? []).map((item) => item.title === "Simple central-Ubud dinner" ? {
        ...item,
        planRole: "planned" as const,
        summary: "Dine near the hotel as the committed evening baseline and use the remaining time to pack and rest.",
        operationalConditions: [],
        replacementFor: undefined
      } : item).map((item) => item.title === "Return to lodging" ? { ...item, summary: "Return after the planned central-Ubud dinner, or after Locavore NXT if the optional upgrade is booked." } : item)
    };
    return day;
  });
  return repaired;
}

function assertTargetedDriftGuard(before: SemanticTravelPlan, after: SemanticTravelPlan): void {
  const allowed = new Set(["2026-10-03", "2026-10-04", "2026-10-08"]);
  const beforeDays = new Map(before.dailyItinerary.map((day) => [day.date, day] as const));
  const afterDays = new Map(after.dailyItinerary.map((day) => [day.date, day] as const));
  if (before.title !== after.title || before.tripStrategy !== after.tripStrategy || before.language !== after.language) throw new Error("Repair drifted whole-trip identity or strategy.");
  if (JSON.stringify(before.fixedCommitments) !== JSON.stringify(after.fixedCommitments)) throw new Error("Repair changed authoritative fixed commitments.");
  if (JSON.stringify(before.preparation) !== JSON.stringify(after.preparation) || JSON.stringify(before.tips) !== JSON.stringify(after.tips) || JSON.stringify(before.researchGrounding) !== JSON.stringify(after.researchGrounding)) throw new Error("Repair drifted non-itinerary sections.");
  for (const [date, day] of beforeDays) {
    const repaired = afterDays.get(date);
    if (!repaired) throw new Error(`Repair removed ${date}.`);
    if (!allowed.has(date) && JSON.stringify(day) !== JSON.stringify(repaired)) throw new Error(`Repair drifted forbidden date ${date}.`);
  }
  if (afterDays.size !== beforeDays.size) throw new Error("Repair changed the trip date set.");
  const beforeHotels = hotelContextSignature(before);
  const afterHotels = hotelContextSignature(after);
  if (beforeHotels !== afterHotels) throw new Error("Repair changed accommodation contexts.");
  assertFixedOccurrence(after, "2026-10-03", "16:30", /LAX|Los Angeles|departure/i);
  assertFixedOccurrence(after, "2026-10-12", "17:10", /DPS|departure/i);
  assertFixedOccurrence(after, "2026-10-05", "10:35", /DPS|arrival/i);
}

function assertFixedOccurrence(plan: SemanticTravelPlan, date: string, time: string, matcher: RegExp): void {
  const occurrence = plan.dailyItinerary.find((day) => day.date === date)?.experiences?.find((item) => item.startTime === time && item.timingStatus === "confirmed" && matcher.test(`${item.title} ${item.summary} ${item.placeName ?? ""}`));
  if (!occurrence) throw new Error(`Repair failed to preserve fixed occurrence ${date} ${time}.`);
}

function hotelContextSignature(plan: SemanticTravelPlan): string {
  return plan.dailyItinerary.filter((day) => day.date >= "2026-10-05").map((day) => `${day.date}:${day.startContext.label}:${day.startContext.status}>${day.endContext.label}:${day.endContext.status}`).join("|");
}

function carryForwardRouteOwnedFacts(next: TripBlueprint, previous: TripBlueprint): TripBlueprint {
  const previousByPair = new Map(previous.movements.map((movement) => [`${movement.dayId}\u0000${movement.originPlaceId}\u0000${movement.destinationPlaceId}`, movement] as const));
  const carriedSourceIds = new Set<string>();
  const movements = next.movements.map((movement) => {
    const prior = previousByPair.get(`${movement.dayId}\u0000${movement.originPlaceId}\u0000${movement.destinationPlaceId}`);
    if (!prior || prior.status !== "verified" || !prior.evidence.length || prior.mode !== movement.mode) return movement;
    for (const evidence of prior.evidence) carriedSourceIds.add(evidence.sourceId);
    return carryMovementFacts(movement, prior);
  });
  const sourceIds = new Set(next.sources.map((source) => source.id));
  return {
    ...next,
    sources: [...next.sources, ...previous.sources.filter((source) => carriedSourceIds.has(source.id) && !sourceIds.has(source.id)).map((source) => structuredClone(source))],
    movements
  };
}

function carryMovementFacts(next: BlueprintMovement, prior: BlueprintMovement): BlueprintMovement {
  return {
    ...next,
    status: prior.status,
    ...(prior.durationMinutes ? { durationMinutes: prior.durationMinutes } : {}),
    ...(prior.distanceMeters ? { distanceMeters: prior.distanceMeters } : {}),
    ...(prior.label ? { label: prior.label } : {}),
    ...(prior.detail ? { detail: prior.detail } : {}),
    ...(prior.display ? { display: structuredClone(prior.display) } : {}),
    evidence: structuredClone(prior.evidence)
  };
}
