import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plan } from "@c-assistant/core";
import { formatDate, isStarterPlan, planRefinementQuestion, refinementIntro } from "./plan-display.js";

function planFixture(patch: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    version: 2,
    title: "Kyoto visit",
    location: "Kyoto",
    dates: "October 2026",
    status: "active",
    knownInformation: [],
    assumptions: [],
    nextAction: "Review and confirm",
    configuration: {},
    stages: [],
    sources: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    ...patch
  } as Plan;
}

describe("plan display helpers", () => {
  it("detects only the seeded starter plan", () => {
    assert.equal(isStarterPlan(planFixture({ title: "Attend an exhibition in Shanghai", version: 1 })), true);
    assert.equal(isStarterPlan(planFixture({ title: "Attend an exhibition in Shanghai", version: 2 })), false);
  });

  it("uses a direct answerable next action as the refinement question", () => {
    assert.equal(
      planRefinementQuestion(planFixture({ nextAction: "Have you booked accommodation?" })),
      "Have you booked accommodation?"
    );
  });

  it("skips redundant document questions when the context already has an institution name", () => {
    assert.equal(
      planRefinementQuestion(planFixture({
        nextAction: "What is the exact university name on the admission document?",
        knownInformation: ["The offer is from Kyoto University."]
      })),
      null
    );
  });

  it("turns answerable assumptions into one prioritized question", () => {
    assert.equal(
      planRefinementQuestion(planFixture({ assumptions: ["Arrival date and departure date are flexible."] })),
      "What date do you expect to arrive, and when will you leave? Approximate dates are fine."
    );
  });

  it("builds the refinement intro from the selected question", () => {
    assert.equal(
      refinementIntro(planFixture({ assumptions: ["Budget preference is unknown."] })),
      "One key question is recommended: For this Plan, do you care most about budget, convenience, or comfort? You can also share a budget range.\nAnswer it or finish refining now. Other unknowns will remain as items to confirm."
    );
  });

  it("formats valid dates and preserves invalid values", () => {
    assert.equal(formatDate("2026-10-05T00:00:00.000Z"), "October 5, 2026");
    assert.equal(formatDate("not-a-date"), "not-a-date");
  });
});
