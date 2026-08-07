import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { ClaudeCodeRuntimeAdapter, RuntimeAdapterError, buildPlanDraftPrompt, parseClaudePrintResult, parsePlanDraft, type RuntimeProcess } from "./index.js";

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
  assert.match(generation.args.at(-1) ?? "", /User request: I will attend an exhibition/i);
  assert.equal(generation.options?.env?.AMAP_API_KEY, undefined);
  assert.equal(generation.options?.env?.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(generation.options?.env?.ANTHROPIC_API_KEY, undefined);
  assert.equal(generation.options?.timeoutMs, 120_000);
  assert.equal(existsSync(generation.options?.cwd ?? ""), false);
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
});
