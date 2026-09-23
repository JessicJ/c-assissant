import assert from "node:assert/strict";
import test from "node:test";
import { LANDI_BLUEPRINT_SKILL, semanticFixedCommitmentsFromBookingConstraints, type SemanticFixedCommitment, type SemanticTravelPlan } from "@c-assistant/agent-adapters";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintEvidenceRef, type Plan, type ResearchSet, type TripBlueprint } from "@c-assistant/core";
import { buildPlannedExperienceReadinessTrace, readinessTraceAvailability } from "./semantic-readiness-trace.js";
import { runSemanticShadow, type SemanticShadowSnapshot } from "./semantic-shadow.js";

const now = "2026-09-14T00:00:00.000Z";
const evidence: BlueprintEvidenceRef[] = [{ sourceId: "official", status: "verified", checkedAt: now, supports: ["Official fixture."] }];

test("semantic shadow records pass_with_rechecks without invoking repair", async () => {
  const saved: unknown[] = [];
  let plannerCalls = 0;
  let repairCalls = 0;
  await runSemanticShadow(snapshot(plan({ pendingHotel: true }), research()), {
    config: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
    store: { saveDiagnosticArtifact: (input) => { saved.push(JSON.parse(input.rawResponse)); return "artifact-1"; } },
    codex: {
      generateSemanticTravelPlan: async () => {
        plannerCalls += 1;
        return { rawJson: "{}", plan: plan({ pendingHotel: true }) };
      },
      generateSemanticTravelPlanRepair: async () => {
        repairCalls += 1;
        return { rawJson: "{}", plan: plan() };
      }
    },
    logGenerationFailure: () => {}
  });
  assert.equal(plannerCalls, 1);
  assert.equal(repairCalls, 0);
  const report = saved[0] as Record<string, any>;
  assert.equal(report.type, "semantic_shadow_v1");
  assert.equal(report.validator.initialResult, "pass_with_rechecks");
  assert.equal(report.repair.attempted, false);
  assert.equal(report.structurer.success, true);
});

test("semantic shadow records fixed accommodation preservation trace without requiring a hotel experience", async () => {
  const report = await shadowReport(hotelStayPlan(), [hotelBookingConstraint()], research({ hotel: true }));
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.commitmentId, "booking-hotel:segment-hotel");
  assert.equal(trace.plannerInput.directlyProvidedAsBookingConstraint, true);
  assert.equal(trace.plannerInput.representedInResearch, true);
  assert.equal(trace.plannerInput.researchPlaceId, "hotel-saint-germain");
  assert.equal(trace.semantic.observed, true);
  assert.equal(trace.semantic.classification, "PRESERVED");
  assert.deepEqual([...trace.semantic.representationKinds].sort(), ["end_context", "semantic_fixed_commitment", "start_context"]);
  assert.equal(trace.structurer.observed, true);
  assert.equal(trace.structurer.classification, "PRESERVED");
  assert.deepEqual([...trace.structurer.representationKinds].sort(), ["end_context", "start_context", "structured_booking_constraint"]);
  assert.equal(trace.comparator.currentResult, "not_missing");
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 0);
});

test("fixed commitment comparator ignores hotel narrative-only mentions", async () => {
  const report = await shadowReport(plan({ markdownMention: "Hotel Saint-Germain" }), [hotelBookingConstraint()], research({ hotel: true }));
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.semantic.observed, false);
  assert.deepEqual(trace.semantic.representationKinds, ["NARRATIVE_ONLY"]);
  assert.equal(trace.comparator.currentResult, "missing_confirmed_commitment");
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 1);
});

test("fixed commitment comparator rejects hotel context outside confirmed stay", async () => {
  const report = await shadowReport(plan({ date: "2026-10-10", startLabel: "Hotel Saint-Germain", endLabel: "Hotel Saint-Germain" }), [hotelBookingConstraint()], research({ hotel: true }));
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.semantic.observed, false);
  assert.equal(trace.structurer.observed, false);
  assert.equal(trace.comparator.currentResult, "missing_confirmed_commitment");
});

test("fixed commitment comparator rejects same-date wrong hotel context", async () => {
  const report = await shadowReport(plan({ startLabel: "Hotel Luxembourg", endLabel: "Hotel Luxembourg" }), [hotelBookingConstraint()], research({ hotel: true }));
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.semantic.observed, false);
  assert.equal(trace.structurer.observed, false);
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 1);
});

test("fixed commitment comparator preserves booked event as planned experience", async () => {
  const booking = eventBookingConstraint();
  const report = await shadowReport(plan({ title: "Theatre ticket", placeName: "Theatre ticket", fixedCommitments: semanticFixedCommitmentsFromBookingConstraints([booking]) }), [booking]);
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.semantic.observed, true);
  assert.deepEqual(trace.semantic.representationKinds, ["semantic_fixed_commitment", "semantic_experience"]);
  assert.equal(trace.structurer.observed, true);
  assert.deepEqual(trace.structurer.representationKinds, ["structured_booking_constraint", "structured_block"]);
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 0);
});

test("semantic shadow passes two confirmed flights to Planner and preserves both structurally without a hotel", async () => {
  const bookings = flightBookingConstraints();
  const fixedCommitments = semanticFixedCommitmentsFromBookingConstraints(bookings);
  const semanticPlan = plan({
    fixedCommitments,
    startLabel: "Tokyo Haneda",
    endLabel: "Tokyo Haneda"
  });
  const saved: unknown[] = [];
  let plannerInput: SemanticFixedCommitment[] | undefined;
  await runSemanticShadow(snapshot(semanticPlan, research(), bookings), {
    config: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
    store: { saveDiagnosticArtifact: (input) => { saved.push(JSON.parse(input.rawResponse)); return "artifact-flights"; } },
    codex: {
      generateSemanticTravelPlan: async (input) => {
        plannerInput = input.fixedCommitments;
        return { rawJson: "{}", plan: semanticPlan };
      },
      generateSemanticTravelPlanRepair: async () => ({ rawJson: "{}", plan: semanticPlan })
    },
    logGenerationFailure: () => {}
  });
  assert.deepEqual(plannerInput, fixedCommitments);
  const report = saved[0] as Record<string, any>;
  assert.equal(report.comparison.fixedCommitmentCount, 2);
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 0);
  assert.equal(report.commitmentPreservation.length, 2);
  for (const trace of report.commitmentPreservation) {
    assert.equal(trace.plannerInput.directlyProvidedAsBookingConstraint, true);
    assert.equal(trace.semantic.classification, "PRESERVED");
    assert.equal(trace.semantic.representationKinds.includes("semantic_fixed_commitment"), true);
    assert.equal(trace.structurer.classification, "PRESERVED");
    assert.equal(trace.structurer.representationKinds.includes("structured_booking_constraint"), true);
    assert.equal(trace.comparator.currentResult, "not_missing");
  }
});

test("fixed commitment comparator rejects exact airport context without flight identity time and direction", async () => {
  const bookings = flightBookingConstraints();
  const report = await shadowReport(plan({ startLabel: "Tokyo Haneda", endLabel: "Tokyo Haneda" }), bookings);
  assert.equal(report.comparison.fixedCommitmentCount, 2);
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 2);
  for (const trace of report.commitmentPreservation) {
    assert.equal(trace.semantic.classification, "NOT_OBSERVED");
    assert.equal(trace.structurer.classification, "NOT_OBSERVED");
    assert.equal(trace.comparator.currentResult, "missing_confirmed_commitment");
  }
});

test("fixed commitment comparator does not satisfy events via hotel-like context", async () => {
  const report = await shadowReport(plan({ startLabel: "Theatre ticket", endLabel: "Theatre ticket" }), [eventBookingConstraint()]);
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.semantic.observed, false);
  assert.equal(trace.structurer.observed, false);
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 1);
});

test("fixed commitment comparator remains conservative on ambiguous identity", async () => {
  const report = await shadowReport(plan({ title: "Fixture Hall Annex", placeName: "Fixture Hall Annex" }), [eventBookingConstraint({ title: "Fixture Hall" })]);
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.semantic.observed, false);
  assert.equal(trace.structurer.observed, false);
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 1);
});

test("semantic shadow repairs exactly once for repair_required findings", async () => {
  const saved: unknown[] = [];
  let repairCalls = 0;
  await runSemanticShadow(snapshot(plan(), research({ closed: true })), {
    config: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
    store: { saveDiagnosticArtifact: (input) => { saved.push(JSON.parse(input.rawResponse)); return "artifact-1"; } },
    codex: {
      generateSemanticTravelPlan: async () => ({ rawJson: "{}", plan: plan() }),
      generateSemanticTravelPlanRepair: async () => {
        repairCalls += 1;
        return { rawJson: "{}", plan: plan({ title: "Open Museum", placeName: "Open Museum" }) };
      }
    },
    logGenerationFailure: () => {}
  });
  const report = saved[0] as Record<string, any>;
  assert.equal(repairCalls, 1);
  assert.equal(report.validator.initialResult, "repair_required");
  assert.equal(report.repair.attempted, true);
  assert.equal(report.repair.modelCallCount, 1);
  assert.equal(report.repair.postRepairValidationResult, "pass");
  assert.equal(report.validator.finalResult, "pass");
  assert.equal(report.readinessTrace.counts.plannedExperienceCount, 1);
  assert.equal(report.readinessTrace.counts.traceEntryCount, 1);
  assert.equal(report.readinessTrace.occurrences[0].experienceName, "Open Museum");
  assert.equal(report.readinessTrace.occurrences.some((item: any) => item.experienceName === "Fixture Place"), false);
});

test("readiness trace records specific confirmed booking support without requiring duplicate operational facts", async () => {
  const booking = eventBookingConstraint();
  const report = await shadowReport(plan({
    title: "Theatre ticket",
    placeName: "Theatre ticket",
    fixedCommitments: semanticFixedCommitmentsFromBookingConstraints([booking])
  }), [booking]);
  const occurrence = report.readinessTrace.occurrences[0];
  assert.equal(report.readinessTrace.counts.plannedExperienceCount, 1);
  assert.equal(report.readinessTrace.counts.traceEntryCount, 1);
  assert.equal(occurrence.bookingSupport.length, 1);
  assert.equal(occurrence.bookingSupport[0].commitmentId, "booking-event:segment-event");
  assert.equal(occurrence.bookingSupport[0].conditionSupported, "confirmed_fixed_commitment");
  assert.equal(occurrence.bookingSupport[0].auditLabel, "C");
});

test("readiness trace does not present evidence outside the travel date as applicable", () => {
  const researched = research();
  researched.places[0]!.operationalFacts = {
    access: { closed: [{ pattern: "Closed on another date", status: "verified", appliesTo: { date: "2026-10-07" }, evidence }] }
  };
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan: plan(),
    research: researched,
    bookingConstraints: [],
    finalReport: { result: "pass", findings: [] }
  });
  const closure = trace.occurrences[0]!.operationalFactChecks.find((check) => check.kind === "closure")!;
  assert.equal(closure.dateApplicability, "does_not_apply");
  assert.equal(closure.checkStatus, "not_applicable");
  assert.deepEqual(closure.auditLabels, ["C"]);
});

test("readiness trace retains unmatched planned experiences and does not fabricate facts", () => {
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan: plan({ title: "Unknown Gallery", placeName: "Unknown Gallery" }),
    research: research(),
    bookingConstraints: [],
    finalReport: { result: "pass", findings: [] }
  });
  assert.equal(trace.counts.plannedExperienceCount, 1);
  assert.equal(trace.counts.traceEntryCount, 1);
  assert.equal(trace.occurrences[0]!.identity.status, "unresolved");
  assert.equal(trace.occurrences[0]!.operationalFactChecks[0]!.checkStatus, "not_performed");
  assert.deepEqual(trace.occurrences[0]!.auditLabels, ["D"]);
});

test("readiness trace treats missing closure information as unknown rather than confirmed open", () => {
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan: plan(), research: research(), bookingConstraints: [], finalReport: { result: "pass", findings: [] }
  });
  const closure = trace.occurrences[0]!.operationalFactChecks.find((check) => check.checkKey === "closure:not_established")!;
  assert.equal(closure.checkStatus, "not_performed");
  assert.equal(closure.dateApplicability, "indeterminate");
  assert.match(closure.reason!, /does not establish.*open/i);
  assert.deepEqual(closure.auditLabels, ["D"]);
});

test("readiness trace links same-named occurrences only on the exact finding date", () => {
  const samePlacePlan = plan();
  samePlacePlan.dailyItinerary.push({ ...structuredClone(samePlacePlan.dailyItinerary[0]!), date: "2026-10-07" });
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan: samePlacePlan,
    research: research(),
    bookingConstraints: [],
    finalReport: {
      result: "pass_with_rechecks",
      findings: [{ date: "2026-10-07", experience: "Fixture Place", category: "access_recheck", explanation: "Recheck only the second visit.", requiresPlannerRepair: false }]
    }
  });
  assert.equal(trace.counts.traceEntryCount, 2);
  assert.equal(trace.occurrences[0]!.finalFindings.length, 0);
  assert.equal(trace.occurrences[1]!.finalFindings.length, 1);
  assert.equal(trace.counts.linkedFindingCount, 1);
});

test("readiness trace keeps partial support and unknown checks separate", () => {
  const researched = research();
  researched.places[0]!.operationalFacts = {
    entry: { reservation: { requirement: "required", status: "verified", evidence } }
  };
  const finding = { date: "2026-10-06", experience: "Fixture Place", category: "booking_requirement" as const, explanation: "Reservation required.", evidenceRefs: [`official · verified · ${now}`], requiresPlannerRepair: false };
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan: plan(), research: researched, bookingConstraints: [], finalReport: { result: "pass_with_rechecks", findings: [finding] }
  });
  const occurrence = trace.occurrences[0]!;
  assert.deepEqual(occurrence.operationalFactChecks.find((check) => check.kind === "reservation")!.auditLabels, ["B"]);
  assert.deepEqual(occurrence.operationalFactChecks.find((check) => check.checkKey === "closure:not_established")!.auditLabels, ["D"]);
  assert.deepEqual(occurrence.auditLabels, ["B", "D"]);
});

test("readiness trace does not cross-link plan-condition and fact findings by category alone", () => {
  const finalPlan = plan();
  finalPlan.dailyItinerary[0]!.experiences![0]!.operationalConditions = [{ kind: "reservation", note: "Choose a ticket if needed." }];
  const researched = research();
  researched.places[0]!.operationalFacts = { entry: { reservation: { requirement: "recommended", status: "verified", evidence } } };
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan,
    research: researched,
    bookingConstraints: [],
    finalReport: {
      result: "pass_with_rechecks",
      findings: [
        { date: "2026-10-06", experience: "Fixture Place", category: "booking_requirement", explanation: "Fact finding.", evidenceRefs: [`official · verified · ${now}`], requiresPlannerRepair: false },
        { date: "2026-10-06", experience: "Fixture Place", category: "booking_requirement", explanation: "Choose a ticket if needed.", requiresPlannerRepair: false }
      ]
    }
  });
  const occurrence = trace.occurrences[0]!;
  assert.deepEqual(occurrence.operationalFactChecks.find((check) => check.kind === "reservation")!.finalFindingIndexes, [0]);
  assert.deepEqual(occurrence.conditionChecks[0]!.finalFindingIndexes, [1]);
});

test("readiness trace reports old artifacts as historical diagnostic gaps without backfill", () => {
  const oldArtifact = { type: "semantic_shadow_v1", semantic: { plannedExperienceCount: 9 }, validator: { initialResult: "pass_with_rechecks" } };
  const before = structuredClone(oldArtifact);
  const availability = readinessTraceAvailability(oldArtifact);
  assert.equal(availability.status, "historical_diagnostic_gap");
  assert.match(availability.reason, /cannot be reconstructed/i);
  assert.deepEqual(oldArtifact, before);
  assert.equal("readinessTrace" in oldArtifact, false);
});

test("readiness trace retains plan and day findings once as unlinked", () => {
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan: plan({ pendingHotel: true }),
    research: research(),
    bookingConstraints: [],
    finalReport: {
      result: "pass_with_rechecks",
      findings: [{ date: "2026-10-06", category: "unresolved_dependency", explanation: "Start location is not exact yet.", requiresPlannerRepair: false }]
    }
  });
  assert.equal(trace.counts.unlinkedFindingCount, 1);
  assert.equal(trace.unlinkedFindings[0]!.reason, "plan_or_day_level");
  assert.equal(trace.occurrences[0]!.finalFindings.length, 0);
});

test("readiness trace explains findings that belong to final non-planned occurrences", () => {
  const finalPlan = plan();
  finalPlan.dailyItinerary[0]!.experiences![0]!.planRole = "optional";
  const trace = buildPlannedExperienceReadinessTrace({
    finalPlan,
    research: research(),
    bookingConstraints: [],
    finalReport: {
      result: "pass_with_rechecks",
      findings: [{ date: "2026-10-06", experience: "Fixture Place", category: "access_recheck", explanation: "Optional visit needs recheck.", requiresPlannerRepair: false }]
    }
  });
  assert.equal(trace.counts.plannedExperienceCount, 0);
  assert.equal(trace.counts.optionalExperienceCount, 1);
  assert.equal(trace.unlinkedFindings[0]!.reason, "non_planned_occurrence");
});

test("readiness trace generation does not mutate any validation input", () => {
  const finalPlan = plan();
  const researched = research({ closed: true });
  const bookings = [hotelBookingConstraint()];
  const finalReport = { result: "repair_required" as const, findings: [{ date: "2026-10-06", experience: "Fixture Place", category: "hard_conflict" as const, explanation: "Closed.", requiresPlannerRepair: true }] };
  const before = structuredClone({ finalPlan, researched, bookings, finalReport });
  buildPlannedExperienceReadinessTrace({ finalPlan, research: researched, bookingConstraints: bookings, finalReport });
  assert.deepEqual({ finalPlan, researched, bookings, finalReport }, before);
});

test("semantic shadow timeout persists failure diagnostic only", async () => {
  const saved: unknown[] = [];
  await runSemanticShadow(snapshot(plan(), research()), {
    config: { enabled: true, sampleRate: 1, timeoutMs: 1 },
    store: { saveDiagnosticArtifact: (input) => { saved.push(JSON.parse(input.rawResponse)); return "artifact-1"; } },
    codex: {
      generateSemanticTravelPlan: () => new Promise(() => {}),
      generateSemanticTravelPlanRepair: async () => ({ rawJson: "{}", plan: plan() })
    },
    logGenerationFailure: () => {}
  });
  const report = saved[0] as Record<string, any>;
  assert.equal(report.type, "semantic_shadow_v1");
  assert.equal(report.status.value, "timed_out");
  assert.equal(report.status.failureStage, "timeout");
});

function snapshot(semanticPlan: SemanticTravelPlan, completedResearch: ResearchSet, bookingConstraints: SemanticShadowSnapshot["bookingConstraints"] = []): SemanticShadowSnapshot {
  return {
    generationKey: "session-1:1:landi-trip-blueprint@1.0.0",
    sessionId: "session-1",
    proposalVersion: 1,
    request: "Plan a short fixture trip.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "not_obtained" },
    completedResearch,
    bookingConstraints,
    legacyPlan: { id: "plan-1", version: 1, presentation: { days: [{ id: "presentation-day-1", date: "2026-10-06", placeIds: ["fixture-place"] }] } } as unknown as Plan,
    legacyBlueprint: { id: "blueprint-1", version: 1, days: [], movements: [] } as unknown as TripBlueprint,
    sessionFacts: [{ key: "destination", value: "Fixture", source: "user", confirmed: true, updatedAt: now }]
  };
}

async function shadowReport(semanticPlan: SemanticTravelPlan, bookingConstraints: SemanticShadowSnapshot["bookingConstraints"] = [], completedResearch = research()): Promise<Record<string, any>> {
  const saved: unknown[] = [];
  await runSemanticShadow(snapshot(semanticPlan, completedResearch, bookingConstraints), {
    config: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
    store: { saveDiagnosticArtifact: (input) => { saved.push(JSON.parse(input.rawResponse)); return "artifact-1"; } },
    codex: {
      generateSemanticTravelPlan: async () => ({ rawJson: "{}", plan: semanticPlan }),
      generateSemanticTravelPlanRepair: async () => ({ rawJson: "{}", plan: semanticPlan })
    },
    logGenerationFailure: () => {}
  });
  return saved[0] as Record<string, any>;
}

function plan(options: { pendingHotel?: boolean; title?: string; placeName?: string; startLabel?: string; endLabel?: string; date?: string; markdownMention?: string; fixedCommitments?: SemanticFixedCommitment[] } = {}): SemanticTravelPlan {
  return {
    title: "Fixture semantic plan",
    language: "en",
    tripStrategy: "Use a compact fixture strategy.",
    fixedCommitments: options.fixedCommitments ?? [],
    targetedResearch: [],
    dailyItinerary: [{
      date: options.date ?? "2026-10-06",
      area: "Fixture area",
      startContext: { label: options.startLabel ?? "Fixture base", status: options.pendingHotel ? "planned_base_pending_property" : "confirmed_property" },
      endContext: { label: options.endLabel ?? "Fixture base", status: "confirmed_property" },
      plan: "Visit the fixture experience.",
      experiences: [{ title: options.title ?? "Fixture Place", placeName: options.placeName ?? "Fixture Place", planRole: "planned", summary: "A planned fixture experience." }]
    }],
    unresolvedExperiences: [],
    preparation: [],
    tips: [],
    researchGrounding: [],
    followUpChecks: [],
    markdown: `# Fixture semantic plan

This fixture semantic plan is intentionally long enough to pass the frozen SemanticTravelPlan parser when the repair path re-parses model output. It keeps the scenario compact: one base, one travel day, and one planned museum-style experience. The tests only care about deterministic orchestration, but the content remains readable so the contract resembles production output.

## Daily itinerary

On 2026-10-06 the traveler starts at the fixture base, visits the selected fixture experience, and returns to the fixture base. Repair may replace the closed fixture place with an open museum while preserving the surrounding day context.${options.markdownMention ? ` Mention only: ${options.markdownMention}.` : ""}`
  };
}

function hotelStayPlan(): SemanticTravelPlan {
  const booking = hotelBookingConstraint();
  return {
    ...plan({ fixedCommitments: semanticFixedCommitmentsFromBookingConstraints([booking]) }),
    dailyItinerary: [
      day("2026-10-06", "Paris Charles de Gaulle Airport", "Hotel Saint-Germain"),
      day("2026-10-07", "Hotel Saint-Germain", "Hotel Saint-Germain"),
      day("2026-10-08", "Hotel Saint-Germain", "Hotel Saint-Germain"),
      day("2026-10-09", "Hotel Saint-Germain", "Paris Charles de Gaulle Airport")
    ]
  };
}

function flightBookingConstraints(): SemanticShadowSnapshot["bookingConstraints"] {
  return [
    {
      id: "booking-arrival-flight",
      type: "flight",
      title: "Arrival flight to Haneda",
      status: "confirmed",
      sourceLabel: "Fixture booking",
      importedAt: now,
      constraintStrength: "hard",
      segments: [{
        id: "segment-arrival-flight",
        segmentType: "flight_leg",
        title: "Arrival flight to Haneda",
        startAtLocal: "2026-10-06T07:25",
        startTimeZone: "Asia/Tokyo",
        endAtLocal: "2026-10-06T07:25",
        endTimeZone: "Asia/Tokyo",
        origin: "Shanghai",
        destination: "Tokyo Haneda",
        constraintStrength: "hard",
        fixedCommitment: true,
        needsReviewReasons: []
      }]
    },
    {
      id: "booking-departure-flight",
      type: "flight",
      title: "Departure flight from Haneda",
      status: "confirmed",
      sourceLabel: "Fixture booking",
      importedAt: now,
      constraintStrength: "hard",
      segments: [{
        id: "segment-departure-flight",
        segmentType: "flight_leg",
        title: "Departure flight from Haneda",
        startAtLocal: "2026-10-06T23:10",
        startTimeZone: "Asia/Tokyo",
        origin: "Tokyo Haneda",
        destination: "Shanghai",
        constraintStrength: "hard",
        fixedCommitment: true,
        needsReviewReasons: []
      }]
    }
  ];
}

function day(date: string, startLabel: string, endLabel: string): SemanticTravelPlan["dailyItinerary"][number] {
  return {
    date,
    area: "Fixture area",
    startContext: { label: startLabel, status: startLabel.includes("Airport") ? "transport_node" : "confirmed_property" },
    endContext: { label: endLabel, status: endLabel.includes("Airport") ? "transport_node" : "confirmed_property" },
    plan: "Use the confirmed base as the travel context.",
    experiences: [{ title: "Fixture Place", placeName: "Fixture Place", planRole: "planned", summary: "A planned fixture experience." }]
  };
}

function research(options: { closed?: boolean; hotel?: boolean } = {}): ResearchSet {
  return {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "research-1",
    generationKey: "session-1:1:landi-trip-blueprint@1.0.0",
    proposalRef: { sessionId: "session-1", proposalVersion: 1 },
    skillLineage: LANDI_BLUEPRINT_SKILL,
    status: "completed",
    batches: [],
    places: [
      ...(options.hotel ? [{ id: "hotel-saint-germain", name: "Hotel Saint-Germain", localizedName: "Hôtel Saint-Germain", locationLabel: "Saint-Germain, Paris", category: "Accommodation", priority: "booked" as const, whyWorthIt: "Fixture hotel.", plan: "Use as confirmed base.", evidence }] : []),
      { id: "fixture-place", name: "Fixture Place", locationLabel: "Fixture", category: "museum", priority: "must", whyWorthIt: "Fixture.", plan: "Visit.", evidence, ...(options.closed ? { operationalFacts: { access: { closed: [{ pattern: "Closed for private event", status: "verified" as const, appliesTo: { date: "2026-10-06" }, evidence }] } } } : {}) },
      { id: "open-museum", name: "Open Museum", locationLabel: "Fixture", category: "museum", priority: "preferred", whyWorthIt: "Fixture.", plan: "Visit.", evidence }
    ],
    events: [],
    sources: [{ id: "official", title: "Official", authority: "Official", url: "https://example.test", retrievedAt: now, status: "verified", official: true }],
    actionRequirements: [],
    createdAt: now,
    updatedAt: now,
    completedAt: now
  };
}

function hotelBookingConstraint(): SemanticShadowSnapshot["bookingConstraints"][number] {
  return {
    id: "booking-hotel",
    type: "accommodation",
    title: "Hotel Saint-Germain",
    status: "confirmed",
    sourceLabel: "Fixture booking",
    importedAt: now,
    constraintStrength: "hard",
    segments: [{
      id: "segment-hotel",
      segmentType: "hotel_stay",
      title: "Hotel Saint-Germain",
      startAtLocal: "2026-10-06T15:00",
      endAtLocal: "2026-10-09T11:00",
      location: "Saint-Germain, Paris",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}

function eventBookingConstraint(options: { title?: string } = {}): SemanticShadowSnapshot["bookingConstraints"][number] {
  const title = options.title ?? "Theatre ticket";
  return {
    id: "booking-event",
    type: "event",
    title,
    status: "confirmed",
    sourceLabel: "Fixture booking",
    importedAt: now,
    constraintStrength: "hard",
    segments: [{
      id: "segment-event",
      segmentType: "event_window",
      title,
      startAtLocal: "2026-10-06T19:30",
      endAtLocal: "2026-10-06T22:00",
      location: "Fixture Theatre",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}
