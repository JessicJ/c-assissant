import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { ClaudeCodeRuntimeAdapter, RuntimeAdapterError, buildPlanDraftPrompt, parseClaudePrintResult, parsePlanDraft, planDraftSchema, type RuntimeProcess } from "./index.js";

const validDraft = JSON.stringify({
  title: "Attend an exhibition in Shanghai",
  location: "Shanghai, China",
  dates: "September 2026",
  knownInformation: ["Purpose: exhibition"],
  assumptions: ["Accommodation is unconfirmed."],
  nextAction: "Review the complete Plan.",
  stages: [{ title: "Before departure", description: "Prepare essentials.", tasks: [{ title: "Check documents", owner: "user", dueLabel: "Two hours before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check your passport, travel documents, phone, and charger before leaving.", refreshFacts: [] } }] }]
});

test("Codex Adapter accepts a schema-compatible Plan draft", () => {
  assert.equal(parsePlanDraft(validDraft).title, "Attend an exhibition in Shanghai");
  assert.equal(parsePlanDraft(validDraft).stages[0]?.tasks[0]?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.deepEqual(parsePlanDraft(validDraft).stages[0]?.tasks[0]?.reminder?.refreshFacts, []);
});

test("Codex Adapter rejects malformed Plan output", () => {
  assert.throws(() => parsePlanDraft("not json"), RuntimeAdapterError);
  assert.throws(() => parsePlanDraft(validDraft.replace("Asia/Shanghai", "Mars/Olympus")), RuntimeAdapterError);
  assert.throws(() => parsePlanDraft(validDraft.replace('"refreshFacts":[]', '"refreshFacts":["traffic"]')), RuntimeAdapterError);
});

test("Codex Adapter removes structured-output nulls from optional Task fields", () => {
  const withNulls = JSON.stringify({
    title: "Attend an exhibition in Shanghai",
    location: "Shanghai, China",
    dates: "September 2026",
    knownInformation: ["Purpose: exhibition"],
    assumptions: ["Accommodation is unconfirmed."],
    nextAction: "Review the complete Plan.",
    stages: [{ title: "Before departure", description: "Prepare essentials.", tasks: [{ title: "Choose accommodation", owner: "user", dueLabel: "Before departure", activationTrigger: null, reminder: null }] }]
  });
  const draft = parsePlanDraft(withNulls);
  assert.equal(draft.stages[0]?.tasks[0]?.activationTrigger, undefined);
  assert.equal(draft.stages[0]?.tasks[0]?.reminder, undefined);
});

test("Codex output schema stays inside the supported structured-output subset", () => {
  assert.doesNotMatch(JSON.stringify(planDraftSchema), /uniqueItems/);
});

test("Claude Code Adapter extracts the Print-mode result before validating the Plan", () => {
  assert.equal(parseClaudePrintResult(JSON.stringify({ result: validDraft })), validDraft);
  assert.throws(() => parseClaudePrintResult(JSON.stringify({ result: 42 })), RuntimeAdapterError);
});

test("Claude Code Adapter runs one isolated no-tools Print-mode Plan draft without Connector secrets", async () => {
  const calls: Array<{ command: string; args: string[]; options?: Parameters<RuntimeProcess>[2] }> = [];
  const run: RuntimeProcess = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "--version") return { code: 0, stdout: "2.1.0\n", stderr: "" };
    if (args[0] === "auth") return { code: 0, stdout: "{\"loggedIn\":true}", stderr: "" };
    return { code: 0, stdout: JSON.stringify({ result: validDraft }), stderr: "" };
  };
  const adapter = new ClaudeCodeRuntimeAdapter({
    run,
    environment: { PATH: process.env.PATH, AMAP_API_KEY: "not-for-claude", TELEGRAM_BOT_TOKEN: "not-for-claude", ANTHROPIC_API_KEY: "not-for-claude" }
  });

  const draft = await adapter.generatePlanDraft({
    request: "I will attend an exhibition in Shanghai.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "woman", immigrationStatus: "tourist_visa" }
  });

  assert.equal(draft.title, "Attend an exhibition in Shanghai");
  const generation = calls.at(-1)!;
  assert.equal(generation.command, "claude");
  assert.deepEqual(generation.args.slice(0, 8), ["-p", "--output-format", "json", "--max-turns", "1", "--tools", "", "--strict-mcp-config"]);
  assert.equal(generation.args.includes("--no-session-persistence"), true);
  assert.match(generation.args.at(-1) ?? "", /User request: I will attend an exhibition/i);
  assert.equal(generation.options?.env?.AMAP_API_KEY, undefined);
  assert.equal(generation.options?.env?.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(generation.options?.env?.ANTHROPIC_API_KEY, undefined);
  assert.equal(generation.options?.timeoutMs, 120_000);
  assert.equal(existsSync(generation.options?.cwd ?? ""), false);
});

test("Claude Code Adapter does not treat a logged-out JSON status as authenticated", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "2.1.85\n", stderr: "" };
    return { code: 0, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }), stderr: "" };
  };

  const status = await new ClaudeCodeRuntimeAdapter({ run }).check();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.match(status.message ?? "", /needs login/i);
});

test("Claude Code Adapter classifies an expired OAuth token as needing login", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "2.1.85\n", stderr: "" };
    if (args[0] === "auth") return { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: "" };
    return { code: 1, stdout: JSON.stringify({ is_error: true, result: "Failed to authenticate. OAuth access token has expired." }), stderr: "" };
  };

  await assert.rejects(
    new ClaudeCodeRuntimeAdapter({ run }).generatePlanDraft({
      request: "I will attend an exhibition in Shanghai.",
      profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
    }),
    (error: unknown) => error instanceof RuntimeAdapterError && error.code === "not_authenticated" && /expired/i.test(error.message)
  );
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
  assert.match(prompt, /Never invent a date, time, or departure time zone/i);
  assert.match(prompt, /Use \["weather"\] only when current destination weather/i);
  assert.match(prompt, /exactly six stages/i);
  assert.match(prompt, /总行程表/);
  assert.match(prompt, /每日行程/);
  assert.match(prompt, /预订清单/);
  assert.match(prompt, /预算表/);
  assert.match(prompt, /交通方案/);
  assert.match(prompt, /应急资料/);
  assert.match(prompt, /10-20% contingency/i);
  assert.match(prompt, /plan backward/i);
  assert.match(prompt, /1-2 must-do items per day/i);
  assert.match(prompt, /only time-bound travel nodes/i);
  assert.match(prompt, /individually checkable user-owned Tasks/i);
  assert.match(prompt, /Never invent an app download URL/i);
});

test("Plan revision context is complete but excludes Core and Connector state", () => {
  const currentPlan = JSON.parse(validDraft);
  const prompt = buildPlanDraftPrompt({
    request: "Move the arrival date to September 2.",
    currentPlan,
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "woman", immigrationStatus: "tourist_visa" }
  });

  assert.match(prompt, /Current draft to revise/);
  assert.match(prompt, /Move the arrival date to September 2/);
  assert.match(prompt, /Attend an exhibition in Shanghai/);
  assert.match(prompt, /Preserve every unaffected known fact/);
  assert.doesNotMatch(prompt, /sourceSnapshots|AMAP_API_KEY|TELEGRAM_BOT_TOKEN|plan-[0-9a-f-]{36}/);
});
