import assert from "node:assert/strict";
import test from "node:test";

import { createSkillRegistry, parseSkillManifest, validateSkillResult, type SkillManifest } from "./index.js";

const manifest: SkillManifest = {
  id: "example-skill",
  country: "china",
  version: "0.1.0",
  visibility: "internal",
  entrypoint: "runExampleSkill",
  requiredInputs: ["value"],
  optionalInputs: [],
  permittedProfileFields: [],
  permittedPlanFields: [],
  capabilities: [],
  sources: { provider: "none" },
  risk: { information: "ordinary", action: "read_only" },
  executionPolicy: "automatic",
  failure: { malformed: "failed" }
};

const result = { skill: { id: "example-skill", version: "0.1.0" }, status: "success", summary: "Done.", facts: [], assumptions: [], recommendations: [], proposedPlanChanges: [], proposedTasks: [], proposedReminders: [], actionCards: [], sources: [], warnings: [] };

test("Skill Runtime parses a strict manifest and keeps optional inputs explicit", () => {
  assert.deepEqual(parseSkillManifest({ ...manifest, optionalInputs: undefined }).optionalInputs, []);
  assert.throws(() => parseSkillManifest({ ...manifest, requiredInputs: ["value"], optionalInputs: ["value"] }), /both required and optional/);
});

test("Skill Registry rejects duplicate ids and entrypoint mismatches", () => {
  const registration = { manifest, entrypoint: manifest.entrypoint, handler: () => result };
  assert.throws(() => createSkillRegistry([registration, registration]), /Duplicate Skill id/);
  assert.throws(() => createSkillRegistry([{ ...registration, entrypoint: "runSomethingElse" }]), /Entrypoint mismatch/);
});

test("Skill Registry lists defensive manifest copies and invokes a validated result", async () => {
  const registry = createSkillRegistry([{ manifest, entrypoint: manifest.entrypoint, handler: () => result }]);
  const listed = registry.list();
  listed[0]!.requiredInputs.push("mutated");
  assert.deepEqual(registry.get("example-skill")?.requiredInputs, ["value"]);
  assert.deepEqual(await registry.invoke("example-skill", { value: 1 }), result);
});

test("Skill Runtime rejects unsupported statuses, identity drift, and missing result arrays", () => {
  assert.throws(() => validateSkillResult({ ...result, status: "needs_evidence" }, manifest), /unsupported status/);
  assert.throws(() => validateSkillResult({ ...result, skill: { ...result.skill, version: "0.2.0" } }, manifest), /mismatched identity/);
  const { warnings: _warnings, ...withoutWarnings } = result;
  assert.throws(() => validateSkillResult(withoutWarnings, manifest), /warnings must be an array/);
});
