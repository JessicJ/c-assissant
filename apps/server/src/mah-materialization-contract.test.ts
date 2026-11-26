import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assertMahMaterializationContract } from "./mah-materialization-contract.js";
import { MahCliTransport, type MahCommandRunner } from "./mah-cli-transport.js";
import { assertPersistedMahMapping, canonicalJson, sha256, mahOperationContracts,
  MAH_STAGE_REQUEST_KIND, MAH_STAGE_RESULT_SUBPATH, MAH_STAGE_RESULT_CONTRACT,
  type MahCarrierMapping, type MahStageRequest, type MahGenerationMappings } from "./mah-generation-contract.js";
import { productionReadiness } from "./production-readiness.js";

const blocked = (error: unknown) => error instanceof Error && "code" in error && error.code === "mah_task_materialization_contract_unverified";

function savedMapping(status: "prepared" | "scheduler_unavailable"): MahCarrierMapping {
  const businessInput = { prompt: "Fictional fixture only", outputSchema: { type: "object" }, outputBusinessContract: mahOperationContracts("research_batch").output };
  const request: MahStageRequest = {
    schemaVersion: 2, kind: MAH_STAGE_REQUEST_KIND, requestId: randomUUID(), carrierTaskId: randomUUID(),
    generationKey: "fictional-session:1:landi-trip-blueprint@1.0.0",
    proposalRef: { sessionId: "fictional-session", proposalVersion: 1 }, skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" },
    operation: "research_batch", batchId: "fictional-batch", attempt: 1, parentCheckpoint: { version: 3, researchSetId: "saved-research" },
    input: { businessContract: mahOperationContracts("research_batch").input, sha256: sha256(canonicalJson(businessInput)), businessInput },
    output: { subpath: MAH_STAGE_RESULT_SUBPATH, envelopeContract: MAH_STAGE_RESULT_CONTRACT },
    execution: { preferredLanguage: "en", agentPreference: "codex", personalOsSlotClass: "interactive", webSearch: true, maxRuntimeSeconds: 60, capabilityRequirements: ["structured_output", "native_schema_constrained_generation"] },
    createdAt: "2026-10-22T00:00:00Z"
  };
  const mapping: MahCarrierMapping = {
    generationKey: request.generationKey, operation: request.operation, batchId: request.batchId!, attempt: request.attempt,
    carrierTaskId: request.carrierTaskId, requestId: request.requestId, inputSha256: request.input.sha256,
    protocol: "mah_slot_v2", requestJson: canonicalJson(request), requestByteLength: Buffer.byteLength(canonicalJson(request)), serializerVersion: "canonical-json-v1",
    requestSha256: sha256(canonicalJson(request)), request, expectedSubpath: MAH_STAGE_RESULT_SUBPATH,
    slotClass: "interactive", projectRoot: "/fictional/landi", status, createdAt: request.createdAt, updatedAt: request.createdAt
  };
  assertPersistedMahMapping(mapping);
  return mapping;
}

for (const status of ["prepared", "scheduler_unavailable"] as const) {
  test(`${status}: reject before any CLI query, submission, mutation or identity replacement`, async () => {
    const mapping = savedMapping(status), before = structuredClone(mapping);
    const commands: string[][] = [], writes: unknown[][] = [];
    const store = {
      getByTaskId: () => mapping,
      updateStatus: (...args: unknown[]) => { writes.push(args); throw new Error("Unexpected store write"); }
    } as unknown as MahGenerationMappings;
    // No real process runner, database, or remote service is available to this fixture.
    const run: MahCommandRunner = async (_command, args) => {
      commands.push(args);
      throw new Error("No CLI invocation is permitted before the public contract is verified");
    };
    const transport = new MahCliTransport({ mahProjectRoot: mapping.projectRoot, store, run,
      environment: { LANDI_MAH_CLI_COMMAND: "/fictional/mah", LANDI_MAH_CLI_EXECUTABLE: "/fictional/node", LANDI_MAH_CLI_MAIN: "/fictional/main.js" } });
    await assert.rejects(transport.execute(mapping), {code:"mah_legacy_protocol_read_only"});
    await assert.rejects(transport.execute(mapping), {code:"mah_legacy_protocol_read_only"});
    assert.deepEqual(commands, []);
    assert.deepEqual(writes, []);
    assert.deepEqual(mapping, before);
  });
}

test("no report or environment input can turn the contract blocker into permission", () => {
  assert.throws(assertMahMaterializationContract, blocked);
  assert.equal(assertMahMaterializationContract.length, 0);
  assert.deepEqual(productionReadiness(), {
    status: "blocked", code: "public_mah_contract_unverified", conversation: false, generation: false,
    revision: false, unattendedEmail: false, hosting: false
  });
});

test('native runtime keeps recovery and generation inert with saved carriers and no verified public contract', async () => {
  const { createRuntimeServices } = await import('./runtime-services.js');
  let operations = 0;
  const mappings = new Proxy({}, { get() { operations++; throw new Error('No saved carrier query or write is permitted'); } });
  const store = { generationCarriers: mappings } as Parameters<typeof createRuntimeServices>[0]['store'];
  const runtime = createRuntimeServices({ store, componentRoot: '/fictional/component',
    semanticShadow: { enabled: false, sampleRate: 0, timeoutMs: 1 },
    semanticDraftCanary: { enabled: false, localEnvironment: false, allowedSessionIds: [] }, logGenerationFailure: () => {} });
  await runtime.recoverMahGenerations();
  await assert.rejects(runtime.business.generateSkillResearchBatch({} as never), /MAH/);
  await assert.rejects(runtime.business.continuePlanningConversation({} as never), /MAH/);
  await assert.rejects(runtime.business.generateEmailResearch({} as never), /MAH/);
  assert.equal(operations, 0);
  assert.equal(productionReadiness().generation, false);
});
