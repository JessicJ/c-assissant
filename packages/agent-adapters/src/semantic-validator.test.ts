import assert from "node:assert/strict";
import test from "node:test";

import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintBookingConstraint, type BlueprintEvidenceRef, type BlueprintPlace, type ResearchSet } from "@c-assistant/core";
import { LANDI_BLUEPRINT_SKILL, operationalFactAppliesToDate, semanticFixedCommitmentsFromBookingConstraints, validateSemanticTravelPlan, type SemanticFixedCommitment, type SemanticTravelPlan } from "./index.js";

const checkedAt = "2026-09-14T00:00:00.000Z";
const verifiedEvidence: BlueprintEvidenceRef[] = [{ sourceId: "official", status: "verified", checkedAt, supports: ["Official operational page."] }];

test("semantic validator applies operational facts only to deterministic matching dates", () => {
  assert.equal(operationalFactAppliesToDate({ date: "2026-10-06" }, "2026-10-06"), "applies");
  assert.equal(operationalFactAppliesToDate({ date: "2026-10-06" }, "2026-10-07"), "does_not_apply");
  assert.equal(operationalFactAppliesToDate({ startDate: "2026-10-06", endDate: "2026-10-10" }, "2026-10-08"), "applies");
  assert.equal(operationalFactAppliesToDate({ startDate: "2026-10-06", endDate: "2026-10-10" }, "2026-10-11"), "does_not_apply");
  assert.equal(operationalFactAppliesToDate({ weekdays: ["tuesday"] }, "2026-10-06"), "applies");
  assert.equal(operationalFactAppliesToDate({ weekdays: ["friday"] }, "2026-10-06"), "does_not_apply");
  assert.equal(operationalFactAppliesToDate({ season: "rainy season" }, "2026-10-06"), "indeterminate");
});

test("semantic validator separates verified hard closures from closure uncertainty", () => {
  const verified = validateSemanticTravelPlan(plan(), {
    research: research([place({
      operationalFacts: {
        access: { closed: [{ pattern: "Closed for ceremony", status: "verified", appliesTo: { date: "2026-10-06" }, evidence: verifiedEvidence }] }
      }
    })])
  });
  assert.equal(verified.result, "repair_required");
  assert.equal(verified.findings[0]?.category, "hard_conflict");
  assert.equal(verified.findings[0]?.requiresPlannerRepair, true);

  const uncertain = validateSemanticTravelPlan(plan(), {
    research: research([place({
      operationalFacts: {
        access: { closed: [{ pattern: "Possible ceremony closure", status: "recheck", appliesTo: { date: "2026-10-06" }, evidence: verifiedEvidence }] }
      }
    })])
  });
  assert.equal(uncertain.result, "pass_with_rechecks");
  assert.equal(uncertain.findings[0]?.category, "access_recheck");
  assert.equal(uncertain.findings[0]?.requiresPlannerRepair, false);
});

test("semantic validator flags confirmed booking timing conflicts against verified sessions", () => {
  const booking = bookingAt("2026-10-06T18:30");
  const report = validateSemanticTravelPlan(plan(), {
    research: research([place({
      operationalFacts: {
        sessions: [{ label: "Evening performance", startsAt: "18:00", endsAt: "19:00", status: "verified", appliesTo: { date: "2026-10-06" }, evidence: verifiedEvidence }]
      }
    })]),
    bookingConstraints: [booking]
  });
  assert.equal(report.result, "repair_required");
  assert.equal(report.findings.some((finding) => finding.category === "timing_conflict" && finding.requiresPlannerRepair), true);
});

test("semantic validator rejects a planned experience that overlaps a confirmed flight window", () => {
  const booking = bookingAt("2026-10-06T18:30", "2026-10-06T20:30");
  const report = validateSemanticTravelPlan(plan({
    fixedCommitments: semanticFixedCommitmentsFromBookingConstraints([booking]),
    startTime: "18:00",
    durationMinutes: 90
  }), {
    research: research([place()]),
    bookingConstraints: [booking]
  });
  assert.equal(report.result, "repair_required");
  assert.equal(report.findings.some((finding) => finding.category === "timing_conflict" && /overlaps confirmed fixed commitment/i.test(finding.explanation)), true);
});

test("a confirmed 16:30 flight departure rejects a later Los Angeles early night but permits in-transit rest", () => {
  const booking = bookingAt("2026-10-03T16:30");
  const value = plan({ fixedCommitments: semanticFixedCommitmentsFromBookingConstraints([booking]) });
  value.dailyItinerary[0]!.date = "2026-10-03";
  value.dailyItinerary[0]!.experiences = [
    { title: "Confirmed flight departure", kind: "event", planRole: "planned", summary: "Depart the airport.", startTime: "16:30", timingStatus: "confirmed" },
    { title: "Packing and early night in Los Angeles", kind: "rest", planRole: "planned", summary: "Remain at the Los Angeles lodging.", startTime: "19:30", durationMinutes: 90, timingStatus: "planned" },
    { title: "In-flight rest", kind: "rest", planRole: "planned", summary: "Rest onboard while in transit.", startTime: "21:00", durationMinutes: 120, timingStatus: "planned" }
  ];
  const report = validateSemanticTravelPlan(value, { research: research([place()]), bookingConstraints: [booking] });
  assert.equal(report.findings.some((finding) => finding.experience === "Packing and early night in Los Angeles" && finding.category === "timing_conflict"), true);
  assert.equal(report.findings.some((finding) => finding.experience === "In-flight rest" && finding.category === "timing_conflict"), false);
});

test("semantic validator rejects missing or altered confirmed flight projections", () => {
  const booking = bookingAt("2026-10-06T18:30", "2026-10-06T20:30");
  const missing = validateSemanticTravelPlan(plan(), { research: research([place()]), bookingConstraints: [booking] });
  assert.equal(missing.findings.some((finding) => finding.category === "hard_conflict" && /missing from the Semantic plan/i.test(finding.explanation)), true);
  const alteredCommitments = semanticFixedCommitmentsFromBookingConstraints([booking]).map((commitment) => ({ ...commitment, destination: "Wrong airport" }));
  const altered = validateSemanticTravelPlan(plan({ fixedCommitments: alteredCommitments }), { research: research([place()]), bookingConstraints: [booking] });
  assert.equal(altered.findings.some((finding) => finding.category === "hard_conflict" && /destination/i.test(finding.explanation)), true);
});

test("semantic validator treats booking requirements as non-repair requirements", () => {
  const report = validateSemanticTravelPlan(plan(), {
    research: research([place({
      operationalFacts: {
        entry: { reservation: { requirement: "required", status: "verified", evidence: verifiedEvidence } }
      }
    })])
  });
  assert.equal(report.result, "pass_with_rechecks");
  assert.equal(report.findings[0]?.category, "booking_requirement");
  assert.equal(report.findings[0]?.requiresPlannerRepair, false);
});

test("semantic validator reports missing hotel context without forcing repair", () => {
  const report = validateSemanticTravelPlan(plan({ startStatus: "planned_base_pending_property" }), { research: research([place()]) });
  assert.equal(report.result, "pass_with_rechecks");
  assert.equal(report.findings.some((finding) => finding.category === "unresolved_dependency" && !finding.requiresPlannerRepair), true);
});

test("semantic validator does not force repair for optional closed experiences", () => {
  const report = validateSemanticTravelPlan(plan({ planRole: "optional" }), {
    research: research([place({
      operationalFacts: {
        access: { closed: [{ pattern: "Closed for ceremony", status: "verified", appliesTo: { date: "2026-10-06" }, evidence: verifiedEvidence }] }
      }
    })])
  });
  assert.equal(report.result, "pass_with_rechecks");
  assert.equal(report.findings[0]?.category, "hard_conflict");
  assert.equal(report.findings[0]?.requiresPlannerRepair, false);
});

test("semantic validator ignores hard closures that lack strong evidence", () => {
  const report = validateSemanticTravelPlan(plan(), {
    research: research([place({
      operationalFacts: {
        access: { closed: [{ pattern: "Closed for ceremony", status: "verified", appliesTo: { date: "2026-10-06" }, evidence: [{ sourceId: "missing", status: "verified", supports: ["Unsupported source."] }] }] }
      }
    })])
  });
  assert.equal(report.result, "pass");
  assert.equal(report.findings.length, 0);
  assert.equal(report.diagnostics?.ignoredInvalidFactCount, 1);
});

test("semantic validator ignores importer-estimated movements as route conflicts", () => {
  const report = validateSemanticTravelPlan(plan(), {
    research: research([place()]),
    importerEstimatedMovements: [{ origin: "A", destination: "B", durationMinutes: 999 }]
  });
  assert.equal(report.result, "pass");
  assert.equal(report.findings.length, 0);
});

test("semantic validator does not invent operational findings from semantic conditions without evidence-backed operational facts", () => {
  const report = validateSemanticTravelPlan(plan({ operationalConditions: [{ kind: "access", note: "Needs access recheck." }] }), {
    research: research([place()])
  });
  assert.equal(report.result, "pass");
  assert.equal(report.findings.length, 0);
});

test("semantic validator requires a complete committed baseline without optional or replacement dinner", () => {
  const value = plan();
  value.dailyItinerary[0]!.experiences = [
    { title: "Depart hotel", kind: "lodging", planRole: "planned", summary: "Start", startTime: "08:30", timingStatus: "planned" },
    { title: "Museum", kind: "experience", planRole: "planned", summary: "Core", startTime: "09:00", endTime: "11:00", timingStatus: "planned" },
    { title: "Lunch", kind: "meal", planRole: "planned", summary: "Lunch", startTime: "12:00", endTime: "13:00", timingStatus: "planned" },
    { title: "Hotel rest", kind: "rest", planRole: "planned", summary: "Rest", startTime: "15:00", endTime: "17:00", timingStatus: "planned" },
    { title: "Optional tasting dinner", kind: "meal", planRole: "optional", summary: "Upgrade", startTime: "18:00", endTime: "21:00", timingStatus: "recheck" },
    { title: "Simple dinner", kind: "meal", planRole: "replacement", summary: "Fallback", startTime: "18:30", endTime: "20:00", timingStatus: "planned" },
    { title: "Return hotel", kind: "lodging", planRole: "planned", summary: "End", startTime: "21:30", timingStatus: "planned" }
  ];
  const incomplete = validateSemanticTravelPlan(value, { research: research([place()]) });
  assert.equal(incomplete.findings.some((finding) => finding.category === "committed_day_incomplete" && finding.requiresPlannerRepair), true);
  value.dailyItinerary[0]!.experiences![5]!.planRole = "planned";
  const complete = validateSemanticTravelPlan(value, { research: research([place()]) });
  assert.equal(complete.findings.some((finding) => finding.category === "committed_day_incomplete"), false);
});

function plan(options: { startStatus?: SemanticTravelPlan["dailyItinerary"][number]["startContext"]["status"]; planRole?: NonNullable<SemanticTravelPlan["dailyItinerary"][number]["experiences"]>[number]["planRole"]; operationalConditions?: NonNullable<SemanticTravelPlan["dailyItinerary"][number]["experiences"]>[number]["operationalConditions"]; fixedCommitments?: SemanticFixedCommitment[]; startTime?: string; durationMinutes?: number } = {}): SemanticTravelPlan {
  return {
    title: "Validator fixture",
    language: "en",
    tripStrategy: "Use a single deterministic fixture day.",
    fixedCommitments: options.fixedCommitments ?? [],
    targetedResearch: [],
    dailyItinerary: [{
      date: "2026-10-06",
      area: "Ubud",
      startContext: { label: "Fixture base", status: options.startStatus ?? "confirmed_property" },
      endContext: { label: "Fixture base", status: "confirmed_property" },
      plan: "Visit the fixture place.",
      experiences: [{
        title: "Fixture Place",
        placeName: "Fixture Place",
        planRole: options.planRole ?? "planned",
        summary: "A planned fixture experience.",
        ...(options.startTime ? { startTime: options.startTime } : {}),
        ...(options.durationMinutes ? { durationMinutes: options.durationMinutes } : {}),
        ...(options.operationalConditions ? { operationalConditions: options.operationalConditions } : {})
      }]
    }],
    unresolvedExperiences: [],
    preparation: [],
    tips: [],
    researchGrounding: [],
    followUpChecks: [],
    markdown: "# Validator fixture"
  };
}

function research(places: BlueprintPlace[]): ResearchSet {
  return {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "research-validator-fixture",
    generationKey: "validator-fixture",
    proposalRef: { sessionId: "session-validator-fixture", proposalVersion: 1 },
    skillLineage: LANDI_BLUEPRINT_SKILL,
    status: "completed",
    batches: [],
    places,
    events: [],
    sources: [{ id: "official", title: "Official source", authority: "Official", url: "https://official.example/place", retrievedAt: checkedAt, status: "verified", official: true }],
    actionRequirements: [],
    createdAt: checkedAt,
    updatedAt: checkedAt,
    completedAt: checkedAt
  };
}

function place(overrides: Partial<BlueprintPlace> = {}): BlueprintPlace {
  return {
    id: "fixture-place",
    name: "Fixture Place",
    locationLabel: "Ubud",
    category: "experience",
    priority: "must",
    whyWorthIt: "It is useful for validator tests.",
    plan: "Visit during the fixture day.",
    evidence: verifiedEvidence,
    ...overrides
  };
}

function bookingAt(startAtLocal: string, endAtLocal?: string): BlueprintBookingConstraint {
  return {
    id: "booking-fixed",
    type: "flight",
    title: "Fixed departure",
    status: "confirmed",
    sourceLabel: "User booking",
    importedAt: checkedAt,
    constraintStrength: "hard",
    segments: [{
      id: "booking-fixed-segment",
      segmentType: "flight_leg",
      title: "Fixed departure leg",
      startAtLocal,
      ...(endAtLocal ? { endAtLocal } : {}),
      origin: "Fixture origin",
      destination: "Fixture destination",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}
