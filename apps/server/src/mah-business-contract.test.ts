import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { businessOperations, businessContracts, assertMahBusinessRequest, assertSameBusinessRetry, validateMahBusinessResult, type BusinessOperation, type MahBusinessRequest, type MahBusinessReceipt } from "./mah-business-contract.js";
import { canonicalJson, sha256 } from "./mah-generation-contract.js";
import { productionReadiness } from "./production-readiness.js";
import { blockedBusinessOperation } from "./agent-work-contract.js";
function request(operation: BusinessOperation = "planning_conversation"): MahBusinessRequest {
  const contracts = businessContracts(operation), payload = { message: "Fictional trip", version: 1 };
  return { schemaVersion: 1, kind: "landi_business_request", requestId: "11111111-1111-4111-8111-111111111111", operation,
    scope: operation === "planning_conversation" ? { kind: "conversation", sessionId: "fictional", requirementsVersion: 0 }
      : operation.startsWith("email_") ? { kind: "email", planId: "fictional", planVersion: 1, businessDate: "2026-10-22", recipientConfigRevision: 0 }
      : { kind: "generation", generationKey: "fictional:1", sessionId: "fictional", proposalVersion: 1, checkpointVersion: 0 },
    businessTime: "2026-10-22T00:00:00Z", input: { contract: contracts.input, sha256: sha256(canonicalJson(payload)), payload }, output: { contract: contracts.output },
    execution: { selectionOwner: "mah", preferredLanguage: "en", capabilities: ["structured_output", "external_current_research"], maxRuntimeSeconds: 600, authority: "artifact_only" } };
}
function result(r: MahBusinessRequest) { return { schemaVersion: 1, kind: "landi_business_result", requestId: r.requestId, operation: r.operation, scope: r.scope, businessTime: r.businessTime, inputSha256: r.input.sha256, outcome: "succeeded", contract: r.output.contract, payload: { reply: "Fictional response" } }; }
function receipt(r: MahBusinessRequest, raw: string): MahBusinessReceipt { return { requestSha256: sha256(canonicalJson(r)), artifactSha256: sha256(raw), taskId: "22222222-2222-4222-8222-222222222222", agentId: "fictional-mah-agent", modelId: "fictional-mah-model", startedAt: r.businessTime, completedAt: r.businessTime }; }
test("all eleven operations use scoped identities without invented generation IDs", () => {
  for (const op of businessOperations) assert.doesNotThrow(() => assertMahBusinessRequest(request(op)));
  for (const op of ["planning_conversation", "email_research", "email_timing"] as const) {
    const r = request(op); assert.ok(!("generationKey" in r.scope));
    assert.throws(() => assertMahBusinessRequest({ ...r, scope: request("semantic_plan").scope }));
  }
});
test("Agent/model selection belongs to MAH; broad authority and missing capabilities rejected", () => {
  for (const override of [{ agentPreference: "codex" }, { modelId: "chosen" }, { selectionOwner: "landi" }, { authority: "write" }, { capabilities: [] }, { capabilities: ["structured_output", "filesystem_write"] }]) {
    const r = request(); assert.throws(() => assertMahBusinessRequest({ ...r, execution: { ...r.execution, ...override } }));
  }
  const r = request("email_research"); r.execution.capabilities = ["structured_output"]; assert.throws(() => assertMahBusinessRequest(r));
});
test("retry freezes ID, time, versions and input; non-JSON input rejected", () => {
  const r = request(); assertSameBusinessRetry(r, structuredClone(r));
  for (const changed of [{ ...r, requestId: "33333333-3333-4333-8333-333333333333" }, { ...r, businessTime: "2026-10-23T00:00:00Z" }, { ...r, scope: { ...r.scope, requirementsVersion: 1 } }]) assert.throws(() => assertSameBusinessRetry(r, changed));
  const changed = structuredClone(r); changed.input.payload.message = "different"; assert.throws(() => assertMahBusinessRequest(changed));
  changed.input.sha256 = sha256(canonicalJson(changed.input.payload)); assert.throws(() => assertSameBusinessRetry(r, changed));
  for (const bad of [undefined, NaN, () => 1, new Date()]) assert.throws(() => assertMahBusinessRequest({ ...r, input: { ...r.input, payload: { bad } } }));
});
test("scope versions, real dates and operation contract checked", () => {
  const r = request("email_timing");
  for (const scope of [{ ...r.scope, businessDate: "2026-02-30" }, { ...r.scope, planVersion: 0 }, { ...r.scope, generationKey: "fake" }]) assert.throws(() => assertMahBusinessRequest({ ...r, scope }));
  assert.throws(() => assertMahBusinessRequest({ ...r, output: { contract: "wrong.v1" } }));
});
test("external receipt and domain validator required; self-reported provenance rejected", () => {
  const r = request(), raw = JSON.stringify(result(r)); let calls = 0;
  const validate = (p: Record<string, unknown>) => { calls++; assert.equal(p.reply, "Fictional response"); return p.reply; };
  assert.throws(() => validateMahBusinessResult(raw, r, undefined, validate)); assert.equal(calls, 0);
  assert.equal(validateMahBusinessResult(raw, r, receipt(r, raw), validate), "Fictional response"); assert.equal(calls, 1);
  const self = JSON.stringify({ ...result(r), provenance: receipt(r, raw) });
  assert.throws(() => validateMahBusinessResult(self, r, receipt(r, self), validate));
  assert.throws(() => validateMahBusinessResult(raw, r, receipt(r, raw), () => { throw new Error("domain validation failed"); }), /domain validation failed/);
});
test("stale/cross-request/altered-artifact results blocked before payload validation", () => {
  const r = request(), raw = JSON.stringify(result(r));
  for (const override of [{ requestId: "other" }, { inputSha256: "0".repeat(64) }, { scope: { kind: "conversation", sessionId: "fictional", requirementsVersion: 2 } }, { businessTime: "2026-10-23T00:00:00Z" }, { contract: "wrong" }]) {
    const changed = JSON.stringify({ ...result(r), ...override });
    assert.throws(() => validateMahBusinessResult(changed, r, receipt(r, changed), () => assert.fail("must not reach payload")));
  }
  for (const changed of [{ ...receipt(r, raw), artifactSha256: "0".repeat(64) }, { ...receipt(r, raw), requestSha256: "0".repeat(64) }, { ...receipt(r, raw), completedAt: "2026-10-21T00:00:00Z" }]) assert.throws(() => validateMahBusinessResult(raw, r, changed, () => assert.fail()));
});
test("published schemas agree with operation scopes and contracts", () => {
  for (const kind of ["request", "result"]) {
    const schema = JSON.parse(readFileSync(new URL(`../../../docs/contracts/landi-mah-business-${kind}.v1.schema.json`, import.meta.url), "utf8"));
    assert.deepEqual(schema.properties.operation.enum, [...businessOperations]); assert.equal(schema.additionalProperties, false);
    for (const op of businessOperations) {
      const branch = schema.allOf.find((entry: any) => entry.if.properties.operation.const === op).then.properties;
      assert.equal(branch.scope.properties.kind.const, request(op).scope.kind);
      assert.equal(kind === "request" ? branch.output.properties.contract.const : branch.contract.const, businessContracts(op).output);
      if (kind === "request") assert.equal(branch.input.properties.contract.const, businessContracts(op).input);
    }
  }
});
test("production gates closed, no transport wiring or direct fallback", () => {
  const gates = productionReadiness();
  for (const field of ["generation", "conversation", "revision", "unattendedEmail", "hosting"] as const) assert.equal(gates[field], false);
  assert.throws(blockedBusinessOperation, /MAH integration is not ready/);
  const runtime = readFileSync(new URL("./runtime-services.ts", import.meta.url), "utf8"); assert.ok(!runtime.includes("mah-business-contract"));
  for (const name of ["continuePlanningConversation", "generateEmailResearch", "generateEmailTiming"]) assert.ok(runtime.includes(`${name}: async () => blockedBusinessOperation()`));
  assert.ok(runtime.includes("if (!productionReadiness().generation) blockedBusinessOperation()"));
});
