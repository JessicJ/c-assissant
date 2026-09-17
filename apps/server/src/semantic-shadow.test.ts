import assert from "node:assert/strict";
import test from "node:test";
import { LANDI_BLUEPRINT_SKILL, type SemanticTravelPlan } from "@c-assistant/agent-adapters";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintEvidenceRef, type Plan, type ResearchSet, type TripBlueprint } from "@c-assistant/core";
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
  assert.equal(trace.plannerInput.directlyProvidedAsBookingConstraint, false);
  assert.equal(trace.plannerInput.representedInResearch, true);
  assert.equal(trace.plannerInput.researchPlaceId, "hotel-saint-germain");
  assert.equal(trace.semantic.observed, true);
  assert.equal(trace.semantic.classification, "PRESERVED");
  assert.deepEqual([...trace.semantic.representationKinds].sort(), ["end_context", "start_context"]);
  assert.equal(trace.structurer.observed, true);
  assert.equal(trace.structurer.classification, "PRESERVED");
  assert.deepEqual([...trace.structurer.representationKinds].sort(), ["end_context", "start_context"]);
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
  const report = await shadowReport(plan({ title: "Theatre ticket", placeName: "Theatre ticket" }), [eventBookingConstraint()]);
  const trace = report.commitmentPreservation[0];
  assert.equal(trace.semantic.observed, true);
  assert.deepEqual(trace.semantic.representationKinds, ["semantic_experience"]);
  assert.equal(trace.structurer.observed, true);
  assert.deepEqual(trace.structurer.representationKinds, ["structured_block"]);
  assert.equal(report.comparison.missingConfirmedCommitmentCount, 0);
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

function plan(options: { pendingHotel?: boolean; title?: string; placeName?: string; startLabel?: string; endLabel?: string; date?: string; markdownMention?: string } = {}): SemanticTravelPlan {
  return {
    title: "Fixture semantic plan",
    language: "en",
    tripStrategy: "Use a compact fixture strategy.",
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
  return {
    ...plan(),
    dailyItinerary: [
      day("2026-10-06", "Paris Charles de Gaulle Airport", "Hotel Saint-Germain"),
      day("2026-10-07", "Hotel Saint-Germain", "Hotel Saint-Germain"),
      day("2026-10-08", "Hotel Saint-Germain", "Hotel Saint-Germain"),
      day("2026-10-09", "Hotel Saint-Germain", "Paris Charles de Gaulle Airport")
    ]
  };
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
