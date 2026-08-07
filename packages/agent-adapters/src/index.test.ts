import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeAdapterError, buildPlanDraftPrompt, parseClaudePrintResult, parsePlanDraft } from "./index.js";

const validDraft = JSON.stringify({
  title: "Attend an exhibition in Shanghai",
  location: "Shanghai, China",
  dates: "September 2026",
  knownInformation: ["Purpose: exhibition"],
  assumptions: ["Accommodation is unconfirmed."],
  nextAction: "Review the complete Plan.",
  stages: [{ title: "Before departure", description: "Prepare essentials.", tasks: [{ title: "Confirm accommodation", owner: "user", dueLabel: "Before departure" }] }]
});

test("Codex Adapter accepts a schema-compatible Plan draft", () => {
  assert.equal(parsePlanDraft(validDraft).title, "Attend an exhibition in Shanghai");
});

test("Codex Adapter rejects malformed Plan output", () => {
  assert.throws(() => parsePlanDraft("not json"), RuntimeAdapterError);
});

test("Claude Code Adapter extracts the Print-mode result before validating the Plan", () => {
  assert.equal(parseClaudePrintResult(JSON.stringify({ result: validDraft })), validDraft);
  assert.throws(() => parseClaudePrintResult(JSON.stringify({ result: 42 })), RuntimeAdapterError);
});

test("Codex Plan context includes confirmed Profile identity without claiming policy eligibility", () => {
  const prompt = buildPlanDraftPrompt({
    request: "I will attend an exhibition in Shanghai.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "woman", immigrationStatus: "tourist_visa" }
  });
  assert.match(prompt, /nationality: Canada/);
  assert.match(prompt, /gender: woman/);
  assert.match(prompt, /China entry or residence status: tourist_visa/);
  assert.match(prompt, /not as proof of a policy entitlement/i);
});
