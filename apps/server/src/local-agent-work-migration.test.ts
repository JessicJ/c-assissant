import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { SqliteWorkspaceStore, assertAgentWorkScope, workDigest, type AgentWork, type AgentWorkScope } from "@c-assistant/storage";
import { createRuntimeServices } from "./runtime-services.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { registerWebAgentRoutes } from "./web-agent-routes.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import type { BusinessRuntime } from "./agent-work-contract.js";
import { canonicalJson } from "./mah-generation-contract.js";

const scope = (): AgentWorkScope => ({ kind: "conversation", sessionId: "fictional-session", messageId: "message", revision: 1 });
function completed(store: SqliteWorkspaceStore, selected = scope()) {
  const work = store.agentWork.prepare(selected, { text: "fictional input" });
  for (const status of ["submitting", "submission_unknown", "running", "completed"] as const) store.agentWork.transition(work.workId, status);
  return work;
}
function envelope(work: AgentWork, payload: unknown = { answer: "fixture" }) {
  return { contractVersion: 1, workId: work.workId, requestId: work.requestId, carrierTaskId: work.carrierTaskId, inputSha256: work.inputSha256, scope: work.scope, payload };
}
function memory(fn: (store: SqliteWorkspaceStore) => void) {
  const store = new SqliteWorkspaceStore(":memory:");
  try { fn(store); } finally { store.close(); }
}

test("new work: strict scopes reject fabricated proposals, invalid revisions and mixed email identities", () => {
  assert.throws(() => assertAgentWorkScope({ ...scope(), proposalRef: {} }));
  assert.throws(() => assertAgentWorkScope({ ...scope(), revision: 0 }));
  assert.throws(() => assertAgentWorkScope({ kind: "generation" }));
  assertAgentWorkScope({ kind: "email_timing", planId: "plan", planVersion: 1, opportunitiesSha256: "a".repeat(64), timeZonesSha256: "b".repeat(64), recipientRevision: 0, windowStart: "2030-01-01T00:00:00Z", windowEnd: "2030-01-02T00:00:00Z" });
  assert.throws(() => assertAgentWorkScope({ kind: "email_research", planId: "plan", planVersion: 1 }));
});
test("new work: canonical input reuses identities; changed input and illegal retries conflict", () => memory(store => {
  const a = store.agentWork.prepare(scope(), { a: 1, b: 2 });
  const b = store.agentWork.prepare(scope(), { b: 2, a: 1 });
  assert.equal(a.workId, b.workId); assert.equal(a.carrierTaskId, b.carrierTaskId);
  assert.throws(() => store.agentWork.prepare(scope(), { a: 2 }));
  store.agentWork.transition(a.workId, "submitting");
  store.agentWork.transition(a.workId, "submission_unknown");
  assert.equal(store.agentWork.prepare(scope(), { a: 1, b: 2 }).requestId, a.requestId);
  assert.throws(() => store.agentWork.transition(a.workId, "prepared"));
  assert.throws(() => store.agentWork.prepare({ ...scope(), messageId: "other" } as AgentWorkScope, { invalid: undefined }));
}));
test("new work: results require identity, business validation and immutable digest", () => memory(store => {
  const work = completed(store);
  assert.throws(() => store.agentWork.validateResult(work.workId, { ...envelope(work), requestId: "different" }, () => {}));
  assert.throws(() => store.agentWork.validateResult(work.workId, envelope(work), () => { throw new Error("domain rejected"); }));
  assert.equal(store.agentWork.get(work.workId)?.status, "completed");
  store.agentWork.validateResult(work.workId, envelope(work), () => {});
  assert.equal(store.agentWork.validateResult(work.workId, envelope(work), () => {}).status, "validated");
  assert.throws(() => store.agentWork.validateResult(work.workId, envelope(work, { answer: "changed" }), () => {}));
}));
test("new work: application rolls back business writes and marker together; successful replay applies once", () => memory(store => {
  const work = completed(store); store.agentWork.validateResult(work.workId, envelope(work), () => {});
  assert.throws(() => store.agentWork.applyValidated(work.workId, () => true, db => {
    db.exec("CREATE TABLE fixture_effect(value TEXT)"); db.prepare("INSERT INTO fixture_effect VALUES (?)").run("must rollback"); throw new Error("crash");
  }));
  assert.equal(store.agentWork.get(work.workId)?.status, "validated");
  let count = 0;
  store.agentWork.applyValidated(work.workId, () => true, db => { db.exec("CREATE TABLE fixture_effect(value TEXT)"); count++; });
  store.agentWork.applyValidated(work.workId, () => true, () => { count++; });
  assert.equal(count, 1); assert.equal(store.agentWork.get(work.workId)?.status, "applied");
}));
test("new work: stale recipient/plan scope and expired email evidence cannot apply", () => memory(store => {
  const work = completed(store); store.agentWork.validateResult(work.workId, envelope(work), () => {});
  assert.throws(() => store.agentWork.applyValidated(work.workId, () => false, () => assert.fail("stale effect")));
  const email = completed(store, { kind: "email_research", planId: "plan", planVersion: 1, eventId: "event", recipientRevision: 1, targetsSha256: "a".repeat(64), validUntil: "2000-01-01T00:00:00Z" });
  store.agentWork.validateResult(email.workId, envelope(email), () => {});
  assert.throws(() => store.agentWork.applyValidated(email.workId, () => true, () => assert.fail("expired effect")));
}));
test("new work: cancel intent and supersession reject late results without replacing UUID", () => memory(store => {
  const work = completed(store); store.agentWork.transition(work.workId, "cancel_requested");
  assert.throws(() => store.agentWork.validateResult(work.workId, envelope(work), () => {}));
  store.agentWork.transition(work.workId, "cancelled");
  assert.equal(store.agentWork.prepare(scope(), { text: "fictional input" }).carrierTaskId, work.carrierTaskId);
  const other = store.agentWork.prepare({ ...scope(), messageId: "next" } as AgentWorkScope, {});
  store.agentWork.transition(other.workId, "superseded");
  assert.throws(() => store.agentWork.transition(other.workId, "submitting"));
}));
test("new work: saved messages are idempotent, concurrency checked, and proposal approval invalidated", () => memory(store => {
  const saved = store.savePlanningMessage({ messageId: "m1", expectedRevision: 0, text: "Tokyo museums" });
  const retry = store.savePlanningMessage({ messageId: "m1", expectedRevision: 0, text: "Tokyo museums" });
  assert.equal(saved.session.id, retry.session.id); assert.equal(retry.reused, true); assert.equal(retry.session.messages.length, 1);
  assert.throws(() => store.savePlanningMessage({ sessionId: saved.session.id, messageId: "m2", expectedRevision: 0, text: "stale" }));
  assert.throws(() => store.savePlanningMessage({ messageId: "m1", expectedRevision: 0, text: "changed" }));
  store.savePlanningSession({ ...saved.session, status: "proposal_confirmed", confirmedProposalVersion: 1 });
  const next = store.savePlanningMessage({ sessionId: saved.session.id, messageId: "m2", expectedRevision: 1, text: "Five days" });
  assert.equal(next.revision, 2); assert.equal(next.session.status, "collecting"); assert.equal(next.session.confirmedProposalVersion, undefined);
  store.updatePlanningSessionStatus(saved.session.id, "generating");
  assert.throws(() => store.savePlanningMessage({ sessionId: saved.session.id, messageId: "m3", expectedRevision: 2, text: "Do not replace generation" }));
}));
test("new work: requirement facts updated through old storage APIs advance revision without rewriting messages", () => memory(store => {
  const saved = store.savePlanningMessage({ messageId: "base", expectedRevision: 0, text: "Fictional trip" });
  store.savePlanningSession({ ...saved.session, facts: [{ key: "destination", value: "Tokyo", source: "user", confirmed: true, updatedAt: new Date().toISOString() }] });
  assert.equal(store.getPlanningRevision(saved.session.id), 2);
  assert.throws(() => store.savePlanningMessage({ sessionId: saved.session.id, messageId: "stale-editor", expectedRevision: 1, text: "Old view" }));
  assert.equal(store.getPlanningSession()?.messages.length, 1);
}));
test("new work: additive upgrade preserves historical session, generation table and email delivery rows; reopen recovers identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "landi-work-upgrade-")); const path = join(dir, "fixture.sqlite");
  try {
    let store = new SqliteWorkspaceStore(path);
    const saved = store.savePlanningMessage({ messageId: "legacy-message", expectedRevision: 0, text: "Fictional legacy requirements" });
    const oldPlan = store.getWorkspace().activePlan;
    store.saveBlueprintGeneration({ generationKey: "historical-generation", proposalRef: { sessionId: saved.session.id, proposalVersion: 1 }, skillLineage: { skillId: "fixture", skillVersion: "1" }, status: "failed", stage: "research", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" });
    store.close();
    const old = new DatabaseSync(path);
    // 此处验证迁移 27 追加工作表，不重建迁移 29 之前的承载表。
    // 完整虚构 v1 请求在当前表中保留其真实 mah_slot_v1 协议。
    const businessInput = { text: "虚构历史研究" };
    const carrierTaskId = randomUUID(), requestId = randomUUID();
    const request = {
      schemaVersion: 1, kind: "landi_generation_stage_request", generationKey: "historical-generation",
      carrierTaskId, requestId, operation: "research_batch", batchId: "historical-batch", attempt: 1,
      proposalRef: { sessionId: saved.session.id, proposalVersion: 1 }, skillLineage: { skillId: "fixture", skillVersion: "1" },
      parentCheckpoint: { version: 0 },
      input: { businessContract: "landi.skill-research-batch-input.v1", sha256: workDigest(businessInput), businessInput },
      output: { subpath: "artifacts/landi-stage-result.json", envelopeContract: "landi.mah-generation-stage-result.v1" },
      execution: { preferredLanguage: "zh-CN", agentPreference: "mah-routing", webSearch: true, maxRuntimeSeconds: 60, capabilityRequirements: ["structured_output"] },
      createdAt: "2020-01-01T00:00:00Z"
    };
    const requestJson = canonicalJson(request);
    old.prepare("INSERT INTO mah_generation_carriers (generation_key,operation,batch_key,batch_id,attempt,carrier_task_id,request_id,input_sha256,request_sha256,request_json,protocol,request_byte_length,serializer_version,expected_subpath,slot_class,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      request.generationKey, request.operation, request.batchId, request.batchId, request.attempt, carrierTaskId, requestId,
      request.input.sha256, createHash("sha256").update(requestJson).digest("hex"), requestJson, "mah_slot_v1", Buffer.byteLength(requestJson), "canonical-json-v1",
      request.output.subpath, "background", "failed", request.createdAt, request.createdAt
    );
    old.prepare("INSERT INTO email_outbox (id,plan_id,plan_version,kind,local_date,due_at,expires_at,status,attempts,retry_at,recipient_revision) VALUES ('old-uncertain',?,?,'morning','2020-01-01','2020-01-01T00:00:00Z','2020-01-02T00:00:00Z','uncertain',1,'2020-01-01T00:00:00Z',0)").run(oldPlan.id, oldPlan.version);
    old.exec("DROP TABLE planning_message_receipts; DROP TABLE planning_session_revisions; DROP TABLE agent_work; DELETE FROM schema_migrations WHERE version=27");
    const tables = ["planning_sessions", "mah_generation_carriers", "email_settings", "email_outbox"];
    const snapshot = tables.map(t => old.prepare(`SELECT * FROM ${t}`).all()); old.close();
    store = new SqliteWorkspaceStore(path);
    assert.equal(store.getPlanningRevision(saved.session.id), saved.session.messages.length);
    const work = store.agentWork.prepare(scope(), {}); store.agentWork.transition(work.workId, "submitting"); store.agentWork.transition(work.workId, "submission_unknown"); store.close();
    store = new SqliteWorkspaceStore(path); assert.equal(store.agentWork.prepare(scope(), {}).requestId, work.requestId); store.close();
    const read = new DatabaseSync(path); assert.deepEqual(tables.map(t => read.prepare(`SELECT * FROM ${t}`).all()), snapshot); read.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("new business interfaces cannot inherit a local process fallback", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const runtime = createRuntimeServices({ store, componentRoot: "/tmp/fictional-landi", semanticShadow: { enabled: false, sampleRate: 0, timeoutMs: 1 }, semanticDraftCanary: { enabled: false, localEnvironment: true, allowedSessionIds: [] }, logGenerationFailure: () => {} });
    for (const method of ["continuePlanningConversation", "generateEmailResearch", "generateEmailTiming", "generateSkillResearchBatch", "generateSkillItinerary", "reviewSkillItinerary", "generatePlannedPlaceImageEnrichment", "generateSemanticTravelPlan", "generateSemanticTravelPlanRepair"] as const) await assert.rejects(runtime.business[method]({} as never), /MAH integration is not ready/);
    assert.equal("generatePlanDraft" in runtime.business, false);
    assert.equal("check" in runtime.business, false);
    await runtime.recoverMahGenerations();
  } finally { store.close(); }
});
test("new API saves requirements while unavailable, reuses receipts, rejects stale writes and blocks legacy editing", async () => {
  const store = new SqliteWorkspaceStore(":memory:"); const server = Fastify(); let calls = 0;
  const business = new Proxy({}, { get: () => { calls++; throw new Error("Agent must not run"); } }) as BusinessRuntime;
  try {
    registerWebAgentRoutes(server, { store, business, blueprintGenerationEnabled: true, generation: { jobs: new Map() } as unknown as PlanningGenerationService, getGeneratingPlan: () => false, setGeneratingPlan: () => {}, prepareGeneratedPlanEvidence: async () => { throw new Error("No evidence execution"); } });
    const payload = { mode: "new_plan", message: "Fictional Tokyo trip", messageId: "api-message", expectedRevision: 0 };
    const response = await server.inject({ method: "POST", url: "/api/agent/chat", payload });
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().blocked, true); assert.equal(response.json().planningRevision, 1);
    const confirmation = await server.inject({ method: "POST", url: `/api/planning-sessions/${response.json().planningSession.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal(confirmation.statusCode, 503); assert.equal(confirmation.json().code, "public_mah_contract_unverified");
    const retry = await server.inject({ method: "POST", url: "/api/agent/chat", payload });
    assert.equal(retry.json().reused, true); assert.equal(store.getPlanningSession()?.messages.length, 1);
    const stale = await server.inject({ method: "POST", url: "/api/agent/chat", payload: { ...payload, messageId: "stale" } });
    assert.equal(stale.statusCode, 409); assert.equal(calls, 0);
    const before = store.getWorkspace().activePlan;
    store.updateProfile({ displayName: "Fixture", preferredLanguage: "English", nationality: "Unspecified", gender: "not_specified", immigrationStatus: "unknown" });
    const legacy = await server.inject({ method: "POST", url: "/api/agent/chat", payload: { mode: "revise_plan", message: "Adjust this fictional trip", expectedPlanId: before.id, expectedVersion: before.version, impactConfirmed: true } });
    assert.equal(legacy.statusCode, 409); assert.equal(legacy.json().code, "legacy_plan_conversion_required"); assert.deepEqual(store.getWorkspace().activePlan, before); assert.equal(calls, 0);
  } finally { await server.close(); store.close(); }
});

test("new production readiness stays blocked even when both local diagnostics report authenticated", async () => {
  const store = new SqliteWorkspaceStore(":memory:"); const server = Fastify();
  try {
    registerRuntimeRoutes(server, { store, runtimes: { codex: { check: async () => ({ kind: "codex", installed: true, authenticated: true }) }, "claude-code": { check: async () => ({ kind: "claude-code", installed: true, authenticated: true }) } }, getLocalConfiguration: () => ({ google: { configured: true } }) });
    const ready = await server.inject({ method: "GET", url: "/api/setup-readiness" });
    assert.equal(ready.json().status, "needs_attention"); assert.equal(ready.json().items.find((item: { id: string }) => item.id === "runtime").status, "needs_attention");
    const production = await server.inject({ method: "GET", url: "/api/agent-readiness" });
    assert.equal(production.json().status, "blocked"); assert.equal(production.json().unattendedEmail, false);
  } finally { await server.close(); store.close(); }
});

test("new work: asynchronous validators and stale-check promises cannot escape the transaction boundary", () => memory(store => {
  const work = completed(store);
  assert.throws(() => store.agentWork.validateResult(work.workId, envelope(work), async () => {}));
  store.agentWork.validateResult(work.workId, envelope(work), () => {});
  assert.throws(() => store.agentWork.applyValidated(work.workId, (async () => true) as unknown as () => boolean, () => {}));
  assert.throws(() => store.agentWork.applyValidated(work.workId, () => true, async () => {}));
  assert.equal(store.agentWork.get(work.workId)?.status, "validated");
}));
