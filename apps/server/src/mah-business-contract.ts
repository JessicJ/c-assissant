/** Landi-local v1 contract. NOT a supported MAH CLI/API request and not wired to transport. */
import { canonicalJson, sha256, mahOperationContracts, mahStageOperations, type MahStageOperation } from "./mah-generation-contract.js";

export const businessOperations = [...mahStageOperations, "planning_conversation", "email_research", "email_timing"] as const;
export type BusinessOperation = typeof businessOperations[number];
export type BusinessScope =
  | { kind: "generation"; generationKey: string; sessionId: string; proposalVersion: number; checkpointVersion: number }
  | { kind: "conversation"; sessionId: string; requirementsVersion: number }
  | { kind: "email"; planId: string; planVersion: number; businessDate: string; recipientConfigRevision: number };
export type BusinessCapability = "structured_output" | "external_current_research";
export interface MahBusinessRequest {
  schemaVersion: 1;
  kind: "landi_business_request";
  requestId: string;
  operation: BusinessOperation;
  scope: BusinessScope;
  businessTime: string;
  input: { contract: string; sha256: string; payload: Record<string, unknown> };
  output: { contract: string };
  execution: {
    selectionOwner: "mah";
    preferredLanguage: string;
    capabilities: BusinessCapability[];
    maxRuntimeSeconds: number;
    authority: "artifact_only";
  };
}
export interface MahBusinessResult {
  schemaVersion: 1;
  kind: "landi_business_result";
  requestId: string;
  operation: BusinessOperation;
  scope: BusinessScope;
  businessTime: string;
  inputSha256: string;
  outcome: "succeeded";
  contract: string;
  payload: Record<string, unknown>;
}
/** Supplied by the backend public MAH verifier, never by the Agent artifact.
 * Public projection correlation is not an audit signature or permission grant.
 * Artifact hashing binds the external receipt.
 */
export interface MahBusinessReceipt {
  requestSha256: string;
  artifactSha256: string;
  taskId: string;
  agentId: string;
  modelId: string;
  startedAt: string;
  completedAt: string;
}
export class MahBusinessContractError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code = "mah_business_contract_invalid"): never { throw new MahBusinessContractError(code); }
function object(v: unknown): asserts v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail();
}
function keys(v: unknown, expected: string[]): asserts v is Record<string, unknown> {
  object(v);
  if (Object.keys(v).length !== expected.length || expected.some(k => !Object.hasOwn(v, k))) fail();
}
function text(v: unknown): asserts v is string { if (typeof v !== "string" || !v.trim() || v.length > 512) fail(); }
function integer(v: unknown, min = 1): void { if (!Number.isSafeInteger(v) || Number(v) < min) fail(); }
function timestamp(v: unknown): void {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) fail();
}
function digest(v: unknown): void { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) fail(); }
function uuid(v: unknown): void { if (typeof v !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)) fail(); }
// Reject functions, undefined, cycles, non-finite numbers and non-JSON objects before hashing.
function json(v: unknown, ancestors = new Set<object>()): void {
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number" && Number.isFinite(v)) return;
  if (!v || typeof v !== "object" || ancestors.has(v)) fail();
  if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) fail();
  ancestors.add(v);
  for (const child of Object.values(v)) json(child, ancestors);
  ancestors.delete(v);
}
export function businessContracts(operation: BusinessOperation): { input: string; output: string } {
  if (mahStageOperations.includes(operation as MahStageOperation)) return mahOperationContracts(operation as MahStageOperation);
  if (!businessOperations.includes(operation)) return fail();
  const name = operation.replaceAll("_", "-");
  return { input: `landi.${name}-input.v1`, output: `landi.${name}.v1` };
}
function scope(v: unknown, operation: BusinessOperation): void {
  object(v);
  if (operation === "planning_conversation") {
    keys(v, ["kind", "sessionId", "requirementsVersion"]);
    if (v.kind !== "conversation") fail();
    text(v.sessionId); integer(v.requirementsVersion, 0);
  } else if (operation === "email_research" || operation === "email_timing") {
    keys(v, ["kind", "planId", "planVersion", "businessDate", "recipientConfigRevision"]);
    if (v.kind !== "email") fail();
    text(v.planId); integer(v.planVersion); integer(v.recipientConfigRevision, 0);
    if (typeof v.businessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.businessDate)) fail();
    timestamp(`${v.businessDate}T00:00:00Z`);
  } else {
    keys(v, ["kind", "generationKey", "sessionId", "proposalVersion", "checkpointVersion"]);
    if (v.kind !== "generation") fail();
    text(v.generationKey); text(v.sessionId); integer(v.proposalVersion); integer(v.checkpointVersion, 0);
  }
}
export function assertMahBusinessRequest(v: unknown): asserts v is MahBusinessRequest {
  json(v);
  keys(v, ["schemaVersion", "kind", "requestId", "operation", "scope", "businessTime", "input", "output", "execution"]);
  if (v.schemaVersion !== 1 || v.kind !== "landi_business_request" || !businessOperations.includes(v.operation as BusinessOperation)) fail();
  const operation = v.operation as BusinessOperation;
  uuid(v.requestId); scope(v.scope, operation); timestamp(v.businessTime);
  keys(v.input, ["contract", "sha256", "payload"]); keys(v.output, ["contract"]);
  const contracts = businessContracts(operation);
  if (v.input.contract !== contracts.input || v.output.contract !== contracts.output) fail();
  object(v.input.payload); if (!Object.keys(v.input.payload).length) fail(); digest(v.input.sha256);
  if (sha256(canonicalJson(v.input.payload)) !== v.input.sha256) fail("mah_business_input_hash_mismatch");
  keys(v.execution, ["selectionOwner", "preferredLanguage", "capabilities", "maxRuntimeSeconds", "authority"]);
  const e = v.execution;
  if (e.selectionOwner !== "mah" || e.authority !== "artifact_only") fail();
  text(e.preferredLanguage); integer(e.maxRuntimeSeconds);
  if (Number(e.maxRuntimeSeconds) > 7200 || !Array.isArray(e.capabilities) || new Set(e.capabilities).size !== e.capabilities.length || e.capabilities.some(c => c !== "structured_output" && c !== "external_current_research") || !e.capabilities.includes("structured_output")) fail();
  if (["research_batch", "planned_place_image_enrichment", "email_research"].includes(operation) && !e.capabilities.includes("external_current_research")) fail();
  if (Buffer.byteLength(canonicalJson(v)) > 16 * 1024 * 1024) fail();
}
/** Explicit retry validation only; never generates IDs, timestamps, tasks or submissions. */
export function assertSameBusinessRetry(original: unknown, retry: unknown): void {
  assertMahBusinessRequest(original); assertMahBusinessRequest(retry);
  if (canonicalJson(original) !== canonicalJson(retry)) fail("mah_business_retry_identity_changed");
}
/** Envelope + authoritative receipt + operation-specific payload validation. No importer or writes. */
export function validateMahBusinessResult<T>(raw: string, request: MahBusinessRequest,
  receipt: MahBusinessReceipt | undefined, validatePayload: (payload: Record<string, unknown>, request: MahBusinessRequest) => T): T {
  assertMahBusinessRequest(request);
  if (Buffer.byteLength(raw) > 16 * 1024 * 1024) fail();
  let v: unknown; try { v = JSON.parse(raw); } catch { fail(); }
  keys(v, ["schemaVersion", "kind", "requestId", "operation", "scope", "businessTime", "inputSha256", "outcome", "contract", "payload"]);
  if (v.schemaVersion !== 1 || v.kind !== "landi_business_result" || v.outcome !== "succeeded") fail();
  for (const field of ["requestId", "operation", "scope", "businessTime"] as const) {
    if (canonicalJson(v[field]) !== canonicalJson(request[field])) fail("mah_business_result_identity_mismatch");
  }
  if (v.inputSha256 !== request.input.sha256 || v.contract !== request.output.contract) fail("mah_business_result_identity_mismatch");
  object(v.payload); if (!Object.keys(v.payload).length) fail();
  if (!receipt) fail("mah_public_execution_receipt_unverified");
  keys(receipt, ["requestSha256", "artifactSha256", "taskId", "agentId", "modelId", "startedAt", "completedAt"]);
  uuid(receipt.taskId); text(receipt.agentId); text(receipt.modelId); timestamp(receipt.startedAt); timestamp(receipt.completedAt);
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt) || receipt.requestSha256 !== sha256(canonicalJson(request)) || receipt.artifactSha256 !== sha256(raw)) fail("mah_public_execution_receipt_mismatch");
  return validatePayload(v.payload, request);
}
