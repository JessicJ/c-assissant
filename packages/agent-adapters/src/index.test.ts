import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeAdapterError, parsePlanDraft } from "./index.js";

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
