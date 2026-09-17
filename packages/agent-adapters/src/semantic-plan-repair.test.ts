import assert from "node:assert/strict";
import test from "node:test";

import { TRIP_BLUEPRINT_SCHEMA_VERSION, type BlueprintEvidenceRef, type BlueprintPlace, type ResearchSet } from "@c-assistant/core";
import {
  LANDI_BLUEPRINT_SKILL,
  diffSemanticTravelPlans,
  runSemanticPlanRepairOnce,
  validateSemanticTravelPlan,
  type SemanticTravelPlan,
  type SemanticValidationContext
} from "./index.js";

const checkedAt = "2026-09-14T00:00:00.000Z";
const verifiedEvidence: BlueprintEvidenceRef[] = [{ sourceId: "official", status: "verified", checkedAt, supports: ["Official operational page."] }];

test("semantic repair keeps pass_with_rechecks plans and does not call planner", async () => {
  let calls = 0;
  const result = await runSemanticPlanRepairOnce({
    plan: plan({ hotelPending: true }),
    validationContext: context([place()]),
    planningContext: "Fixture context.",
    repairer: () => { calls += 1; return plan(); }
  });
  assert.equal(result.status, "not_required");
  assert.equal(result.plannerInvoked, false);
  assert.equal(calls, 0);
  assert.equal(result.originalReport.result, "pass_with_rechecks");
});

test("semantic repair calls planner exactly once for repair_required and revalidates repaired plan once", async () => {
  let calls = 0;
  let validations = 0;
  const original = plan();
  const repaired = plan({ experienceTitle: "Open Museum", placeName: "Open Museum" });
  const result = await runSemanticPlanRepairOnce({
    plan: original,
    validationContext: context([place({ operationalFacts: closure() }), place({ id: "open-museum", name: "Open Museum" })]),
    planningContext: "Fixture context.",
    validate: (semanticPlan, validationContext) => {
      validations += 1;
      return validateSemanticTravelPlan(semanticPlan, validationContext);
    },
    repairer: () => {
      calls += 1;
      return repaired;
    }
  });
  assert.equal(result.status, "repaired");
  assert.equal(result.plannerInvoked, true);
  assert.equal(calls, 1);
  assert.equal(validations, 2);
  assert.equal(result.repairedReport?.result, "pass");
});

test("semantic repair does not retry when repaired plan still fails validation", async () => {
  let calls = 0;
  const result = await runSemanticPlanRepairOnce({
    plan: plan(),
    validationContext: context([place({ operationalFacts: closure() })]),
    planningContext: "Fixture context.",
    repairer: () => {
      calls += 1;
      return plan();
    }
  });
  assert.equal(result.status, "repair_failed_validation");
  assert.equal(calls, 1);
  assert.equal(result.repairedReport?.result, "repair_required");
});

test("semantic repair supplies only repair-required findings as primary repair findings", async () => {
  let seenCategories: string[] = [];
  const result = await runSemanticPlanRepairOnce({
    plan: plan({ hotelPending: true, operationalConditions: [{ kind: "reservation", note: "Reserve after repair." }] }),
    validationContext: context([place({ operationalFacts: { ...closure(), entry: { ticket: { requirement: "required", status: "verified", evidence: verifiedEvidence } } } })]),
    planningContext: "Fixture context.",
    repairer: (request) => {
      seenCategories = request.repairFindings.map((finding) => finding.category);
      assert.match(request.prompt, /PRESERVE EVERYTHING THAT IS NOT AFFECTED/);
      assert.match(request.prompt, /Do not regenerate the whole vacation/);
      return plan({ experienceTitle: "Open Museum", placeName: "Open Museum" });
    }
  });
  assert.equal(result.originalReport.findings.length > result.repairFindings.length, true);
  assert.deepEqual(seenCategories, ["hard_conflict"]);
});

test("semantic repair ignores optional conflicts and unresolved dependencies", async () => {
  let calls = 0;
  const optionalResult = await runSemanticPlanRepairOnce({
    plan: plan({ planRole: "optional" }),
    validationContext: context([place({ operationalFacts: closure() })]),
    planningContext: "Fixture context.",
    repairer: () => { calls += 1; return plan(); }
  });
  const unresolvedResult = await runSemanticPlanRepairOnce({
    plan: plan({ hotelPending: true }),
    validationContext: context([place()]),
    planningContext: "Fixture context.",
    repairer: () => { calls += 1; return plan(); }
  });
  assert.equal(optionalResult.status, "not_required");
  assert.equal(unresolvedResult.status, "not_required");
  assert.equal(calls, 0);
});

test("semantic repair parses repaired output through the existing SemanticTravelPlan parser", async () => {
  await assert.rejects(
    runSemanticPlanRepairOnce({
      plan: plan(),
      validationContext: context([place({ operationalFacts: closure() })]),
      planningContext: "Fixture context.",
      repairer: () => ({ ...plan(), markdown: "too short" })
    }),
    /complete readable markdown plan/
  );
});

test("semantic decision diff detects travel-decision drift", () => {
  const original = plan();
  const repaired = plan({
    extraDayExperience: true,
    planRole: "replacement",
    startLabel: "Different base"
  });
  const diff = diffSemanticTravelPlans(original, repaired);
  assert.deepEqual(diff.daysChanged, ["2026-10-06", "2026-10-07"]);
  assert.equal(diff.experiencesAdded.some((item) => item.title === "Unrelated Day Change"), true);
  assert.equal(diff.planRoleChanges[0]?.title, "Fixture Place");
  assert.equal(diff.startEndContextChanges[0]?.field, "startContext");
  assert.equal(diff.baseStrategyChanged, true);
  assert.equal(diff.meaningfulTravelDecisionDrift, true);
});

function plan(options: {
  hotelPending?: boolean;
  planRole?: NonNullable<SemanticTravelPlan["dailyItinerary"][number]["experiences"]>[number]["planRole"];
  experienceTitle?: string;
  placeName?: string;
  operationalConditions?: NonNullable<SemanticTravelPlan["dailyItinerary"][number]["experiences"]>[number]["operationalConditions"];
  extraDayExperience?: boolean;
  startLabel?: string;
} = {}): SemanticTravelPlan {
  return {
    title: "Repair fixture",
    language: "en",
    tripStrategy: "Use one compact base and preserve the surrounding itinerary unless a confirmed operational conflict requires a small coherent adjustment.",
    targetedResearch: [],
    dailyItinerary: [
      {
        date: "2026-10-06",
        area: "Fixture area",
        startContext: { label: options.startLabel ?? "Fixture base", status: options.hotelPending ? "planned_base_pending_property" : "confirmed_property" },
        endContext: { label: "Fixture base", status: "confirmed_property" },
        plan: "Visit the fixture experience while preserving a compact base strategy and the existing travel rhythm.",
        experiences: [{
          title: options.experienceTitle ?? "Fixture Place",
          placeName: options.placeName ?? "Fixture Place",
          planRole: options.planRole ?? "planned",
          summary: "A planned fixture experience.",
          ...(options.operationalConditions ? { operationalConditions: options.operationalConditions } : {})
        }]
      },
      {
        date: "2026-10-07",
        area: "Unaffected area",
        startContext: { label: "Fixture base", status: "confirmed_property" },
        endContext: { label: "Fixture base", status: "confirmed_property" },
        plan: "Keep the unaffected day stable.",
        experiences: options.extraDayExperience ? [{ title: "Unrelated Day Change", planRole: "planned", summary: "This should be detected as drift." }] : []
      }
    ],
    unresolvedExperiences: [],
    preparation: ["Keep confirmed bookings fixed."],
    tips: ["Preserve the accepted pace."],
    researchGrounding: ["Fixture source."],
    followUpChecks: [],
    markdown: `# Repair fixture

This diagnostic SemanticTravelPlan is intentionally long enough to satisfy the existing parser. It describes a compact trip with a fixed base, one planned experience on the first day, and a second day that should remain unaffected by narrow repair work. The repair orchestration tests use it to verify that only confirmed repair-required validation findings trigger a one-shot Planner repair, while non-repair uncertainty remains advisory. The traveler-facing content is not important; the structural contract is.

## Daily itinerary

October 6 starts and ends at the fixture base. October 7 also stays at the fixture base. The plan should preserve this base strategy unless the confirmed conflict directly requires a coherent change.`
  };
}

function context(places: BlueprintPlace[]): SemanticValidationContext {
  return { research: research(places) };
}

function research(places: BlueprintPlace[]): ResearchSet {
  return {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "research-repair-fixture",
    generationKey: "repair-fixture",
    proposalRef: { sessionId: "session-repair-fixture", proposalVersion: 1 },
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
    locationLabel: "Fixture area",
    category: "experience",
    priority: "must",
    whyWorthIt: "It is useful for repair tests.",
    plan: "Visit during the fixture day.",
    evidence: verifiedEvidence,
    ...overrides
  };
}

function closure(): NonNullable<BlueprintPlace["operationalFacts"]> {
  return {
    access: {
      closed: [{ pattern: "Closed for private event", status: "verified", appliesTo: { date: "2026-10-06" }, evidence: verifiedEvidence }]
    }
  };
}
