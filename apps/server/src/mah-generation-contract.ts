import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { SkillLineage } from "@c-assistant/core";
import { assertGenerationCarrierBusinessContext, type GenerationCarrierMapping, type GenerationCarrierStore } from "@c-assistant/storage";

export const MAH_STAGE_RESULT_SUBPATH = "artifacts/landi-stage-result.json" as const;
export const MAH_STAGE_REQUEST_KIND = "landi_generation_stage_request" as const;
export const MAH_STAGE_RESULT_KIND = "landi_generation_stage_result" as const;
export const MAH_STAGE_RESULT_CONTRACT = "landi.mah-generation-stage-result.v1" as const;
export const MAH_QUEUE_STAGE_RESULT_CONTRACT = "landi.mah-generation-stage-result.v2" as const;
export const MAH_QUEUE_PROTOCOL = "mah_task_queue_v1" as const;
export const MAH_PERSONAL_OS_SLOT_CLASS = "interactive" as const;
export const MAH_STAGE_MAX_RESULT_BYTES = 16 * 1024 * 1024;

export const mahStageOperations = [
  "research_batch",
  "itinerary_draft",
  "itinerary_review",
  "itinerary_repair",
  "planned_place_image_enrichment",
  "semantic_plan",
  "semantic_validation",
  "semantic_repair"
] as const;

export type MahStageOperation = typeof mahStageOperations[number];
export type MahStageStatus =
  | "prepared"
  | "submitting"
  | "submission_unknown"
  | "queued"
  | "running"
  | "completed"
  | "validated"
  | "imported"
  | "cancel_requested"
  | "cancelled"
  | "failed"
  | "scheduler_unavailable"
  | "carrier_missing"
  | "provider_route_unverified"
  | "artifact_missing"
  | "artifact_invalid"
  | "artifact_changed";

export type MahParentCheckpoint = {
  version: number;
  researchSetId?: string;
  blueprintId?: string;
  blueprintVersion?: number;
  artifactSha256?: string;
};

type MahStageRequestBase = {
  kind: typeof MAH_STAGE_REQUEST_KIND;
  requestId: string;
  carrierTaskId: string;
  generationKey: string;
  proposalRef: { sessionId: string; proposalVersion: number };
  skillLineage: SkillLineage;
  operation: MahStageOperation;
  batchId?: string;
  attempt: number;
  parentCheckpoint: MahParentCheckpoint;
  input: {
    businessContract: string;
    sha256: string;
    businessInput: Record<string, unknown>;
  };
  output: {
    subpath: typeof MAH_STAGE_RESULT_SUBPATH;
    envelopeContract: typeof MAH_STAGE_RESULT_CONTRACT | typeof MAH_QUEUE_STAGE_RESULT_CONTRACT;
  };
  execution: {
    preferredLanguage: string;

    webSearch: boolean;
    maxRuntimeSeconds: number;
    adaptiveProducerClockV1?: { validatorNodePath: string; artifactValidation?: "worktree_then_published_v1" };
    capabilityRequirements: Array<"structured_output" | "native_schema_constrained_generation" | "external_current_research" | "filesystem_write">;
  };
  createdAt: string;
};

export type MahStageRequest = MahStageRequestBase & (
  | { schemaVersion: 1; execution: MahStageRequestBase["execution"] & { agentPreference: "codex" | "claude-code" | "mah-routing" } }
  | { schemaVersion: 2; execution: MahStageRequestBase["execution"] & { agentPreference: "codex" | "claude-code" | "mah-routing"; personalOsSlotClass: typeof MAH_PERSONAL_OS_SLOT_CLASS } }
  | { schemaVersion: 3; protocol: typeof MAH_QUEUE_PROTOCOL; projectRoot: string }
);

export type MahCarrierMapping = GenerationCarrierMapping<MahStageRequest, MahStageOperation, MahStageStatus> & {
  expectedSubpath: typeof MAH_STAGE_RESULT_SUBPATH;
  slotClass?: "interactive" | "background";
  projectRoot: string;
};

export type MahSubmitReceipt = {
  schemaVersion: 1;
  taskId: string;
  projectRoot: string;
  slotClass: typeof MAH_PERSONAL_OS_SLOT_CLASS;
  workloadRef: string;
  admissionStatus: "ready" | "running" | "queued" | "deferred";
};

export type MahGenerationMappings = GenerationCarrierStore<MahStageRequest, MahStageOperation, MahStageStatus>;

export type MahStageResult = {
  schemaVersion: 1 | 2;
  requestSha256?: string;
  parentCheckpoint?: MahParentCheckpoint;
  kind: typeof MAH_STAGE_RESULT_KIND;
  requestId: string;
  carrierTaskId: string;
  generationKey: string;
  proposalRef: { sessionId: string; proposalVersion: number };
  skillLineage: SkillLineage;
  operation: MahStageOperation;
  batchId?: string;
  attempt: number;
  inputSha256: string;
  outcome: "succeeded";
  businessContract: string;
  payload: Record<string, unknown>;
  diagnostics: Array<{ code: string; path?: string; message: string }>;
  provenance: {
    carrier: "mah_task";
    taskId: string;
    agentId: string;
    modelId?: string;
    startedAt: string;
    completedAt: string;
  };
};

const operationContracts: Record<MahStageOperation, { input: string; output: string }> = {
  research_batch: { input: "landi.skill-research-batch-input.v1", output: "landi.skill-research-batch.v1" },
  itinerary_draft: { input: "landi.skill-itinerary-input.v1", output: "landi.skill-itinerary.v1" },
  itinerary_review: { input: "landi.skill-itinerary-review-input.v1", output: "landi.skill-itinerary-review.v1" },
  itinerary_repair: { input: "landi.skill-itinerary-repair-input.v1", output: "landi.skill-itinerary.v1" },
  planned_place_image_enrichment: { input: "landi.planned-place-image-enrichment-input.v1", output: "landi.planned-place-image-enrichment.v1" },
  semantic_plan: { input: "landi.semantic-plan-input.v1", output: "landi.semantic-plan.v1" },
  semantic_validation: { input: "landi.semantic-validation-input.v1", output: "landi.semantic-validation.v1" },
  semantic_repair: { input: "landi.semantic-repair-input.v1", output: "landi.semantic-repair.v1" }
};

export class MahCarrierError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export function mahOperationContracts(operation: MahStageOperation): { input: string; output: string } {
  return operationContracts[operation];
}

export function canonicalJson(value: unknown): string {
  const normalized = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalized);
    if (entry && typeof entry === "object") return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalized(child)])
    );
    return entry;
  };
  return JSON.stringify(normalized(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseAndValidateMahStageResult(raw: string, request: MahStageRequest): { result: MahStageResult; digest: string } {
  if (Buffer.byteLength(raw, "utf8") > MAH_STAGE_MAX_RESULT_BYTES) throw new MahCarrierError("mah_artifact_too_large", "MAH 结果工件超过允许大小，未导入任何业务数据。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MahCarrierError("mah_artifact_invalid_json", "MAH 结果工件不是有效 JSON，已保留现有检查点。", { cause: error });
  }
  if (!isRecord(parsed)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果工件必须是单一 JSON 对象。");
  assertExactKeys(parsed, [
    "schemaVersion", "kind", "requestId", "carrierTaskId", "generationKey", "proposalRef", "skillLineage", "operation",
    "batchId", "attempt", "inputSha256", "outcome", "businessContract", "payload", "diagnostics", "provenance", ...(request.schemaVersion === 3 ? ["requestSha256", "parentCheckpoint"] : [])
  ], ["batchId"], "结果外层");
  if (parsed.schemaVersion !== (request.schemaVersion === 3 ? 2 : 1)) throw new MahCarrierError("mah_artifact_version_unsupported", "MAH 结果工件版本不受支持，未尝试兼容或降级解析。");
  if (parsed.kind !== MAH_STAGE_RESULT_KIND || parsed.outcome !== "succeeded") throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果工件类型或结果状态无效。");
  if (!mahStageOperations.includes(parsed.operation as MahStageOperation)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果工件包含未知操作。");
  if (!isNonEmptyString(parsed.requestId, 160) || !isUuidV4(parsed.carrierTaskId) || !isNonEmptyString(parsed.generationKey, 512)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果工件身份字段无效。");
  if (!Number.isInteger(parsed.attempt) || Number(parsed.attempt) < 1 || !isSha256(parsed.inputSha256)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果工件尝试次数或输入摘要无效。");
  assertProposalRef(parsed.proposalRef);
  assertSkillLineage(parsed.skillLineage);
  if (parsed.batchId !== undefined && !isNonEmptyString(parsed.batchId, 160)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果工件批次身份无效。");
  if (!isRecord(parsed.payload) || Object.keys(parsed.payload).length === 0) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果工件缺少结构化业务 payload。");
  assertDiagnostics(parsed.diagnostics);
  assertProvenance(parsed.provenance);

  if (request.schemaVersion === 3 && (parsed.requestSha256 !== sha256(canonicalJson(request))
    || canonicalJson(parsed.parentCheckpoint) !== canonicalJson(request.parentCheckpoint))) throw new MahCarrierError("mah_artifact_correlation_mismatch", "MAH 结果请求摘要或父检查点与冻结请求不一致。");
  const operation = parsed.operation as MahStageOperation;
  if (parsed.businessContract !== mahOperationContracts(operation).output) throw new MahCarrierError("mah_business_contract_mismatch", "MAH 结果业务合同与操作不匹配。");
  const comparisons: Array<[unknown, unknown, string]> = [
    [parsed.requestId, request.requestId, "requestId"],
    [parsed.carrierTaskId, request.carrierTaskId, "carrierTaskId"],
    [parsed.generationKey, request.generationKey, "generationKey"],
    [operation, request.operation, "operation"],
    [parsed.batchId, request.batchId, "batchId"],
    [parsed.attempt, request.attempt, "attempt"],
    [parsed.inputSha256, request.input.sha256, "inputSha256"],
    [(parsed.provenance as Record<string, unknown>).taskId, request.carrierTaskId, "provenance.taskId"],
    [canonicalJson(parsed.proposalRef), canonicalJson(request.proposalRef), "proposalRef"],
    [canonicalJson(parsed.skillLineage), canonicalJson(request.skillLineage), "skillLineage"]
  ];
  const mismatch = comparisons.find(([actual, expected]) => actual !== expected);
  if (mismatch) throw new MahCarrierError("mah_artifact_correlation_mismatch", `MAH 结果关联字段 ${mismatch[2]} 与已持久化请求不一致。`);
  return { result: parsed as unknown as MahStageResult, digest: sha256(raw) };
}

export function assertMahStageRequest(request: MahStageRequest): void {
  if (!isRecord(request)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求必须是单一对象。");
  assertRequestExactKeys(request as unknown as Record<string, unknown>, ["schemaVersion", "kind", "requestId", "carrierTaskId", "generationKey", "proposalRef", "skillLineage", "operation", "batchId", "attempt", "parentCheckpoint", "input", "output", "execution", "createdAt", ...(request.schemaVersion === 3 ? ["protocol", "projectRoot"] : [])], ["batchId"]);
  if (![1, 2, 3].includes(request.schemaVersion) || request.kind !== MAH_STAGE_REQUEST_KIND) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求版本或类型无效。");
  if (request.schemaVersion === 3 && (request.protocol !== MAH_QUEUE_PROTOCOL || !isAbsolute(request.projectRoot))) throw new MahCarrierError("mah_request_invalid", "普通队列请求协议或项目根无效。");
  if (!isUuidV4(request.carrierTaskId) || !isNonEmptyString(request.requestId, 160) || !isNonEmptyString(request.generationKey, 512)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求身份字段无效。");
  if (!isRecord(request.proposalRef)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求 Proposal 引用无效。");
  assertRequestExactKeys(request.proposalRef as Record<string, unknown>, ["sessionId", "proposalVersion"], []);
  if (!isNonEmptyString(request.proposalRef.sessionId, 160) || !Number.isInteger(request.proposalRef.proposalVersion) || request.proposalRef.proposalVersion < 1) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求 Proposal 引用无效。");
  if (!isRecord(request.skillLineage)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求 Skill lineage 无效。");
  assertRequestExactKeys(request.skillLineage as unknown as Record<string, unknown>, ["skillId", "skillVersion"], []);
  if (!isNonEmptyString(request.skillLineage.skillId, 160) || !isNonEmptyString(request.skillLineage.skillVersion, 80)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求 Skill lineage 无效。");
  const expectedGenerationPrefix = `${request.proposalRef.sessionId}:${request.proposalRef.proposalVersion}:${request.skillLineage.skillId}@${request.skillLineage.skillVersion}`;
  if (request.generationKey !== expectedGenerationPrefix && !request.generationKey.startsWith(`${expectedGenerationPrefix}:`)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求的 Generation Key 与 Proposal 或 Skill lineage 不一致。");
  if (!mahStageOperations.includes(request.operation) || request.input.businessContract !== mahOperationContracts(request.operation).input) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求操作与业务合同不匹配。");
  if (!Number.isInteger(request.attempt) || request.attempt < 1 || (request.batchId !== undefined && !isNonEmptyString(request.batchId, 160))) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求 attempt 或 batchId 无效。");
  if (!isRecord(request.parentCheckpoint)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求父检查点无效。");
  assertRequestExactKeys(request.parentCheckpoint as Record<string, unknown>, ["version", "researchSetId", "blueprintId", "blueprintVersion", "artifactSha256"], ["researchSetId", "blueprintId", "blueprintVersion", "artifactSha256"]);
  if (!Number.isInteger(request.parentCheckpoint.version) || request.parentCheckpoint.version < 0
    || (request.parentCheckpoint.researchSetId !== undefined && !isNonEmptyString(request.parentCheckpoint.researchSetId, 160))
    || (request.parentCheckpoint.blueprintId !== undefined && !isNonEmptyString(request.parentCheckpoint.blueprintId, 160))
    || (request.parentCheckpoint.blueprintVersion !== undefined && (!Number.isInteger(request.parentCheckpoint.blueprintVersion) || request.parentCheckpoint.blueprintVersion < 1))
    || (request.parentCheckpoint.artifactSha256 !== undefined && !isSha256(request.parentCheckpoint.artifactSha256))
    || (request.schemaVersion === 3 && !isSha256(request.parentCheckpoint.artifactSha256))) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求父检查点字段无效。");
  if (!isRecord(request.input)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求输入无效。");
  assertRequestExactKeys(request.input as Record<string, unknown>, ["businessContract", "sha256", "businessInput"], []);
  if (!isRecord(request.input.businessInput) || Object.keys(request.input.businessInput).length === 0) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求业务输入无效。");
  if (request.schemaVersion === 3) assertGenerationCarrierBusinessContext(request.input.businessInput, request.batchId, request.operation);
  if (!isSha256(request.input.sha256) || sha256(canonicalJson(request.input.businessInput)) !== request.input.sha256) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求业务输入摘要不匹配。");
  if (!isRecord(request.output)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求输出声明无效。");
  assertRequestExactKeys(request.output as Record<string, unknown>, ["subpath", "envelopeContract"], []);
  if (request.output.subpath !== MAH_STAGE_RESULT_SUBPATH || request.output.envelopeContract !== (request.schemaVersion === 3 ? MAH_QUEUE_STAGE_RESULT_CONTRACT : MAH_STAGE_RESULT_CONTRACT)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求输出路径或外层合同无效。");
  if (!isRecord(request.execution)) throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求执行约束无效。");
  assertRequestExactKeys(request.execution as Record<string, unknown>, ["preferredLanguage", "webSearch", "maxRuntimeSeconds", "capabilityRequirements", ...(request.schemaVersion === 3 ? ["adaptiveProducerClockV1"] : ["agentPreference"]), ...(request.schemaVersion === 2 ? ["personalOsSlotClass"] : [])], ["adaptiveProducerClockV1"]);
  const adaptiveClock = request.execution.adaptiveProducerClockV1;
  if (adaptiveClock !== undefined && (!isRecord(adaptiveClock) || Object.keys(adaptiveClock).some(key => key !== "validatorNodePath" && key !== "artifactValidation")
    || (adaptiveClock.artifactValidation !== undefined && adaptiveClock.artifactValidation !== "worktree_then_published_v1")
    || !isNonEmptyString(adaptiveClock.validatorNodePath, 4096)
    || !adaptiveClock.validatorNodePath.startsWith("/") || /['"\\$`\r\n\0]/.test(adaptiveClock.validatorNodePath))) {
    throw new MahCarrierError("mah_request_invalid", "MAH Adaptive 校验器的冻结 Node 路径无效。");
  }
  if (request.operation === "research_batch" && !request.batchId) throw new MahCarrierError("mah_request_invalid", "研究批次请求缺少 batchId。");
  if ((request.operation === "research_batch" || request.operation === "planned_place_image_enrichment") && !request.execution.webSearch) throw new MahCarrierError("mah_request_invalid", "需要外部研究的 MAH 请求必须显式启用 Web 搜索。");
  const capabilities = request.execution.capabilityRequirements;
  const allowedCapabilities = new Set(["structured_output", "native_schema_constrained_generation", "external_current_research", "filesystem_write"]);
  if (!isNonEmptyString(request.execution.preferredLanguage, 40) || (request.schemaVersion !== 3 && !["codex", "claude-code", "mah-routing"].includes(request.execution.agentPreference))
    || (request.schemaVersion === 2 && request.execution.personalOsSlotClass !== MAH_PERSONAL_OS_SLOT_CLASS)
    || typeof request.execution.webSearch !== "boolean" || !Number.isInteger(request.execution.maxRuntimeSeconds) || request.execution.maxRuntimeSeconds < 1 || request.execution.maxRuntimeSeconds > 7200
    || !Array.isArray(capabilities) || capabilities.length > 8 || new Set(capabilities).size !== capabilities.length
    || capabilities.some((capability) => !allowedCapabilities.has(capability)) || !Number.isFinite(Date.parse(request.createdAt))) {
    throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求执行约束或创建时间无效。");
  }
}

export function assertPersistedMahMapping(mapping: MahCarrierMapping): void {
  assertMahStageRequest(mapping.request);
  const requestJson = canonicalJson(mapping.request);
  if (mapping.carrierTaskId !== mapping.request.carrierTaskId || mapping.requestId !== mapping.request.requestId
    || mapping.generationKey !== mapping.request.generationKey || mapping.operation !== mapping.request.operation
    || (mapping.batchId ?? null) !== (mapping.request.batchId ?? null) || mapping.attempt !== mapping.request.attempt
    || mapping.inputSha256 !== mapping.request.input.sha256 || mapping.expectedSubpath !== MAH_STAGE_RESULT_SUBPATH
    || (mapping.request.schemaVersion === 3
      ? mapping.protocol !== MAH_QUEUE_PROTOCOL || mapping.slotClass !== undefined || mapping.admissionStatus !== undefined || mapping.request.projectRoot !== mapping.projectRoot
      : mapping.request.schemaVersion === 2 ? mapping.protocol !== "mah_slot_v2" || mapping.slotClass !== MAH_PERSONAL_OS_SLOT_CLASS : mapping.protocol !== "mah_slot_v1" || mapping.slotClass !== "background")
    || (mapping.request.schemaVersion !== 1 && (!isNonEmptyString(mapping.projectRoot, 4096) || !isAbsolute(mapping.projectRoot)))
    || mapping.requestSha256 !== sha256(requestJson) || mapping.requestJson !== requestJson || mapping.requestByteLength !== Buffer.byteLength(requestJson)) throw new MahCarrierError("mah_request_invalid", "已持久化 MAH 映射与规范请求附件不一致。");
  if (mapping.request.schemaVersion === 3) {
    if (mapping.submitReceiptJson !== undefined) {
      let receipt: unknown;
      try { receipt = JSON.parse(mapping.submitReceiptJson); } catch { throw new MahCarrierError("mah_request_invalid", "已保存的普通队列回执不是有效 JSON。"); }
      if (!isRecord(receipt) || (receipt.ok !== undefined && receipt.ok !== true) || receipt.task_id !== mapping.carrierTaskId
        || receipt.title !== `Landi 有界生成：${mapping.operation}`
        || receipt.audit_ref !== `.mah/tasks/${mapping.carrierTaskId}/audit/audit.ndjson`
        || receipt.events_ref !== `.mah/tasks/${mapping.carrierTaskId}/stream.jsonl`
        || !isRecord(receipt.result_ref) || receipt.result_ref.type !== "none"
        || (receipt.project_root !== undefined && receipt.project_root !== mapping.projectRoot) || canonicalJson(receipt) !== mapping.submitReceiptJson)
        throw new MahCarrierError("mah_request_invalid", "已保存的普通队列回执身份或固定引用无效。");
    }
    return;
  }
  if (mapping.submitReceiptJson === undefined) {
    if (mapping.admissionStatus !== undefined) throw new MahCarrierError("mah_request_invalid", "已持久化 MAH 映射只有 admission 状态而没有公开提交回执。");
    return;
  }
  let receipt: unknown;
  try {
    receipt = JSON.parse(mapping.submitReceiptJson);
  } catch (error) {
    throw new MahCarrierError("mah_request_invalid", "已持久化 MAH 提交回执不是有效 JSON。", { cause: error });
  }
  if (!isRecord(receipt)) throw new MahCarrierError("mah_request_invalid", "已持久化 MAH 提交回执必须是单一对象。");
  assertRequestExactKeys(receipt, ["schemaVersion", "taskId", "projectRoot", "slotClass", "workloadRef", "admissionStatus"], []);
  if (receipt.schemaVersion !== 1 || receipt.taskId !== mapping.carrierTaskId || receipt.projectRoot !== mapping.projectRoot
    || receipt.slotClass !== mapping.slotClass || receipt.workloadRef !== `task:${mapping.carrierTaskId}`
    || !["ready", "running", "queued", "deferred"].includes(String(receipt.admissionStatus))
    || receipt.admissionStatus !== mapping.admissionStatus || canonicalJson(receipt) !== mapping.submitReceiptJson) {
    throw new MahCarrierError("mah_request_invalid", "已持久化 MAH 提交回执与 Task、槽位或规范项目根不一致。");
  }
}

function assertRequestExactKeys(value: Record<string, unknown>, allowed: string[], optional: string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key)) || allowed.some((key) => !optional.includes(key) && !(key in value))) {
    throw new MahCarrierError("mah_request_invalid", "MAH 阶段请求包含未声明字段或缺少必需字段。");
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], optional: string[], label: string): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) throw new MahCarrierError("mah_artifact_invalid_structure", `${label}包含未声明字段。`);
  const required = allowed.filter((key) => !optional.includes(key));
  if (required.some((key) => !(key in value))) throw new MahCarrierError("mah_artifact_invalid_structure", `${label}缺少必需字段。`);
}

function assertProposalRef(value: unknown): asserts value is MahStageResult["proposalRef"] {
  if (!isRecord(value)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 proposalRef 无效。");
  assertExactKeys(value, ["sessionId", "proposalVersion"], [], "proposalRef");
  if (!isNonEmptyString(value.sessionId, 160) || !Number.isInteger(value.proposalVersion) || Number(value.proposalVersion) < 1) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 proposalRef 无效。");
}

function assertSkillLineage(value: unknown): asserts value is SkillLineage {
  if (!isRecord(value)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 skillLineage 无效。");
  assertExactKeys(value, ["skillId", "skillVersion"], [], "skillLineage");
  if (!isNonEmptyString(value.skillId, 160) || !isNonEmptyString(value.skillVersion, 80)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 skillLineage 无效。");
}

function assertDiagnostics(value: unknown): void {
  if (!Array.isArray(value) || value.length > 100) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 diagnostics 无效。");
  for (const diagnostic of value) {
    if (!isRecord(diagnostic)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 diagnostic 无效。");
    assertExactKeys(diagnostic, ["code", "path", "message"], ["path"], "diagnostic");
    if (!isNonEmptyString(diagnostic.code, 120) || !isNonEmptyString(diagnostic.message, 1200) || (diagnostic.path !== undefined && !isNonEmptyString(diagnostic.path, 240))) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 diagnostic 字段无效。");
  }
}

function assertProvenance(value: unknown): asserts value is MahStageResult["provenance"] {
  if (!isRecord(value)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 provenance 无效。");
  assertExactKeys(value, ["carrier", "taskId", "agentId", "modelId", "startedAt", "completedAt"], ["modelId"], "provenance");
  if (value.carrier !== "mah_task" || !isUuidV4(value.taskId) || !isNonEmptyString(value.agentId, 80) || (value.modelId !== undefined && !isNonEmptyString(value.modelId, 120)) || !isDateTime(value.startedAt) || !isDateTime(value.completedAt)) throw new MahCarrierError("mah_artifact_invalid_structure", "MAH 结果 provenance 字段无效。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && !Number.isNaN(Date.parse(value));
}
