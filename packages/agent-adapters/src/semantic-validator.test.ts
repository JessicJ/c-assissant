import assert from "node:assert/strict";
import test from "node:test";

import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintBookingConstraint, type BlueprintEvidenceRef, type BlueprintPlace, type ResearchSet } from "@c-assistant/core";
import { LANDI_BLUEPRINT_SKILL, operationalFactAppliesToDate, validateSemanticTravelPlan, type SemanticTravelPlan } from "./index.js";

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
  const report = validateSemanticTravelPlan(plan(), {
    research: research([place({
      operationalFacts: {
        sessions: [{ label: "Evening performance", startsAt: "18:00", endsAt: "19:00", status: "verified", appliesTo: { date: "2026-10-06" }, evidence: verifiedEvidence }]
      }
    })]),
    bookingConstraints: [bookingAt("2026-10-06T18:30")]
  });
  assert.equal(report.result, "repair_required");
  assert.equal(report.findings.some((finding) => finding.category === "timing_conflict" && finding.requiresPlannerRepair), true);
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

function plan(options: { startStatus?: SemanticTravelPlan["dailyItinerary"][number]["startContext"]["status"]; planRole?: NonNullable<SemanticTravelPlan["dailyItinerary"][number]["experiences"]>[number]["planRole"]; operationalConditions?: NonNullable<SemanticTravelPlan["dailyItinerary"][number]["experiences"]>[number]["operationalConditions"] } = {}): SemanticTravelPlan {
  return {
    title: "Validator fixture",
    language: "en",
    tripStrategy: "Use a single deterministic fixture day.",
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

function bookingAt(startAtLocal: string): BlueprintBookingConstraint {
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
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}
