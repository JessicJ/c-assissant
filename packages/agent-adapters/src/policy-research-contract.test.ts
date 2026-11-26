import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillResearchBatchArtifact, skillResearchBatchSchema } from "./index.js";

const raw = { id: "batch", scopeLabel: "Lisbon", sources: [], places: [], events: [], actionRequirements: [], completedAt: "2026-10-22T00:00:00Z" };

test("policy summary is optional in the research contract and legacy artifacts remain readable", () => {
  assert.ok("policyResearch" in skillResearchBatchSchema.properties);
  assert.equal((skillResearchBatchSchema.required as readonly string[]).includes("policyResearch"), false);
  const parsed = parseSkillResearchBatchArtifact(JSON.stringify(raw), raw, raw.completedAt);
  assert.equal(parsed.policyResearch, undefined);
});

test("the adapter preserves optional policy input for non-blocking Core validation", () => {
  for (const policyResearch of [{ destination: "Portugal", missingInformation: ["Confirm passport country"] }, "malformed optional summary"]) {
    const parsed = parseSkillResearchBatchArtifact(JSON.stringify({ ...raw, policyResearch }), raw, raw.completedAt);
    assert.deepEqual(parsed.policyResearch, policyResearch);
  }
});
