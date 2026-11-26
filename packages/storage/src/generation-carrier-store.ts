import { createHash, randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, normalize } from "node:path";

export const GENERATION_CARRIER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS mah_generation_carriers (
    generation_key TEXT NOT NULL REFERENCES blueprint_generations(generation_key) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('research_batch', 'itinerary_draft', 'itinerary_review', 'itinerary_repair', 'planned_place_image_enrichment', 'semantic_plan', 'semantic_validation', 'semantic_repair')),
    batch_key TEXT NOT NULL,
    batch_id TEXT,
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    carrier_task_id TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL UNIQUE,
    input_sha256 TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    request_json TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('mah_task_queue_v1', 'mah_slot_v1', 'mah_slot_v2')),
    request_byte_length INTEGER NOT NULL CHECK (request_byte_length > 0),
    serializer_version TEXT NOT NULL,
    cancel_requested_at TEXT,
    running_at TEXT,
    expected_subpath TEXT NOT NULL,
    slot_class TEXT CHECK (slot_class IN ('interactive', 'background', 'review')),
    project_root TEXT,
    admission_status TEXT CHECK (admission_status IN ('ready', 'running', 'queued', 'deferred')),
    submit_receipt_json TEXT,
    status TEXT NOT NULL CHECK (status IN ('prepared', 'submitting', 'submission_unknown', 'queued', 'running', 'completed', 'validated', 'imported', 'cancel_requested', 'cancelled', 'failed', 'scheduler_unavailable', 'carrier_missing', 'provider_route_unverified', 'artifact_missing', 'artifact_invalid', 'artifact_changed')),
    result_sha256 TEXT,
    result_json TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (generation_key, operation, batch_key, attempt)
  );
  CREATE INDEX IF NOT EXISTS idx_mah_generation_carriers_recovery
    ON mah_generation_carriers(status, updated_at);
`;

export type GenerationCarrierProtocol = "mah_task_queue_v1" | "mah_slot_v1" | "mah_slot_v2";

export type GenerationCarrierMapping<
  Request = unknown,
  Operation extends string = string,
  Status extends string = string
> = {
  generationKey: string;
  operation: Operation;
  batchId?: string;
  attempt: number;
  carrierTaskId: string;
  requestId: string;
  inputSha256: string;
  requestSha256: string;
  request: Request;
  protocol: GenerationCarrierProtocol;
  requestJson: string;
  requestByteLength: number;
  serializerVersion: string;
  cancelRequestedAt?: string;
  runningAt?: string;
  expectedSubpath: string;
  slotClass?: string;
  projectRoot?: string;
  admissionStatus?: string;
  submitReceiptJson?: string;
  status: Status;
  resultSha256?: string;
  resultJson?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type FailedImageRetryIntent = {
  version: 1;
  targetPhase: string;
  targetRound: number;
  predecessors: Array<{ carrierTaskId: string; requestSha256: string }>;
};

/** A persisted public CLI observation, never an Agent's self-reported failure. */
export function hasConfirmedPublicImageFailure(mapping: GenerationCarrierMapping): boolean {
  if (mapping.operation !== "planned_place_image_enrichment" || mapping.protocol !== "mah_task_queue_v1"
    || mapping.status !== "failed" || mapping.cancelRequestedAt || mapping.errorCode !== "mah_public_task_failed" || !mapping.errorMessage) return false;
  try {
    const proof = requireRecord(JSON.parse(mapping.errorMessage));
    assertExactKeys(proof, ["version", "carrierTaskId", "projectRoot", "requestSha256", "taskLifecycleRevision", "failedAt"], []);
    return proof.version === 1 && proof.carrierTaskId === mapping.carrierTaskId && proof.projectRoot === mapping.projectRoot
      && proof.requestSha256 === mapping.requestSha256 && Number.isSafeInteger(proof.taskLifecycleRevision)
      && Number(proof.taskLifecycleRevision) >= 0 && validDateTime(proof.failedAt);
  } catch { return false; }
}

export class GenerationCarrierStorageError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class GenerationCarrierStore<
  Request = unknown,
  Operation extends string = string,
  Status extends string = string
> {
  constructor(private readonly database: DatabaseSync, databasePath: string, options?: { initialize: false }) {
    if (options?.initialize === false) return;
    const owns = !this.database.isTransaction;
    if (owns) this.database.exec("BEGIN IMMEDIATE");
    try {
      this.ensureAdmissionIdentityColumns();
      this.migrateLegacySidecar(databasePath);
      this.recordSchemaMigrations();
      if (owns) this.database.exec("COMMIT");
    } catch (error) { if (owns && this.database.isTransaction) this.database.exec("ROLLBACK"); throw error; }
    if (owns) this.cleanupLegacySidecar(databasePath);
  }

  prepare(input: {
    generationKey: string;
    operation: Operation;
    batchId?: string;
    inputSha256: string;
    expectedSubpath: string;
    slotClass?: string;
    protocol?: GenerationCarrierProtocol;
    serializerVersion?: string;
    projectRoot: string;
    preparedStatus: Status;
    retryableTerminalStatuses: readonly Status[];
    createRequest: (identity: { carrierTaskId: string; requestId: string; attempt: number }) => Request;
    serializeRequest: (request: Request) => string;
    hashRequest: (requestJson: string) => string;
  }): GenerationCarrierMapping<Request, Operation, Status> {
    if (this.database.isTransaction) throw new GenerationCarrierStorageError("mah_transaction_open", "准备 MAH 映射需要独立事务。");
    this.database.exec("BEGIN IMMEDIATE");
    try {
    this.assertGenerationCurrent(input.generationKey);
    const historicalSlots = this.listForGeneration(input.generationKey).some(mapping => mapping.protocol !== "mah_task_queue_v1");
    const existing = this.listForStage(input.generationKey, input.operation, input.batchId)[0];
    if ((input.protocol === "mah_task_queue_v1" || existing?.protocol === "mah_task_queue_v1") && historicalSlots) throw new GenerationCarrierStorageError("mah_legacy_protocol_read_only", "历史槽位生成不能切换为普通队列。");
    const retryable = existing ? input.retryableTerminalStatuses.includes(existing.status) : false;
    if (existing && existing.inputSha256 !== input.inputSha256 && !retryable) {
      throw new GenerationCarrierStorageError("mah_request_conflict", "同一 Landi 阶段已有不同输入的活动 MAH 映射，已拒绝重复提交。");
    }
    if (existing && existing.inputSha256 === input.inputSha256 && !retryable) {
      const candidate = input.createRequest({ carrierTaskId: existing.carrierTaskId, requestId: existing.requestId, attempt: existing.attempt });
      const stable = (value: unknown) => { const copy = structuredClone(value) as Record<string, unknown>; delete copy.createdAt; return canonicalJson(copy); };
      if (stable(candidate) !== stable(existing.request) || (input.protocol && input.protocol !== existing.protocol) || input.projectRoot !== existing.projectRoot || input.slotClass !== existing.slotClass) throw new GenerationCarrierStorageError("mah_request_conflict", "MAH 冻结请求身份或执行约束已变化。");
      this.assertGenerationCurrent(existing.generationKey, existing.request, existing.protocol !== "mah_task_queue_v1" || existing.status !== "imported");
      this.database.exec("COMMIT"); return existing;
    }
    const attempt = (existing?.attempt ?? 0) + 1;
    const carrierTaskId = randomUUID();
    const requestId = randomUUID();
    const request = input.createRequest({ carrierTaskId, requestId, attempt });
    const requestJson = input.serializeRequest(request);
    const protocol = classifyRequest(request);
    if (protocol === "mah_task_queue_v1" && historicalSlots) throw new GenerationCarrierStorageError("mah_legacy_protocol_read_only", "历史槽位生成不能切换为普通队列。");
    if (input.expectedSubpath !== MAH_STAGE_RESULT_SUBPATH || !isAbsolute(input.projectRoot) || normalize(input.projectRoot) !== input.projectRoot || input.projectRoot.includes("\0")) throw new GenerationCarrierStorageError("mah_request_invalid", "MAH 固定结果路径或规范项目根无效。");
    if (input.protocol && input.protocol !== protocol || protocol === "mah_task_queue_v1" && input.slotClass !== undefined) throw new GenerationCarrierStorageError("mah_request_invalid", "MAH 协议与槽位声明不一致。");
    const row = { generation_key: input.generationKey, operation: input.operation, batch_id: input.batchId ?? null, batch_key: input.batchId ?? "", attempt, carrier_task_id: carrierTaskId, request_id: requestId, input_sha256: input.inputSha256, project_root: input.projectRoot };
    assertVersionedRequest(request as Record<string, unknown>, row);
    if (protocol === "mah_task_queue_v1") {
      const currentInput = requireRecord(requireRecord(request as Record<string, unknown>).input);
      const currentBusiness = requireRecord(currentInput.businessInput);
      const identity = currentBusiness.stageIdentity;
      const imageRetry = currentBusiness.failedImageRetry as FailedImageRetryIntent | undefined;
      if (imageRetry) {
        for (const binding of imageRetry.predecessors) {
          const prior = this.getByTaskId(binding.carrierTaskId);
          if (!prior || prior.generationKey !== input.generationKey || prior.projectRoot !== input.projectRoot || prior.batchId === input.batchId
            || prior.requestSha256 !== binding.requestSha256 || !hasConfirmedPublicImageFailure(prior)) {
            throw new GenerationCarrierStorageError("mah_image_retry_invalid", "图片重试缺少精确的公开失败前序或新的目标阶段。");
          }
        }
      }
      if (identity !== undefined) {
        const stage = requireRecord(identity);
        const settled = new Set(["imported", "artifact_invalid"]);
        for (const prior of this.listForGeneration(input.generationKey)) {
          if (prior.protocol !== "mah_task_queue_v1" || prior.operation !== input.operation || prior.batchId === input.batchId || settled.has(prior.status)) continue;
          const priorBusiness = requireRecord(requireRecord(prior.request as Record<string, unknown>).input).businessInput;
          const oldBusiness = requireRecord(priorBusiness);
          const oldIdentity = oldBusiness.stageIdentity === undefined ? undefined : requireRecord(oldBusiness.stageIdentity);
          let overlaps = (oldIdentity?.scope ?? prior.batchId ?? "") === stage.scope;
          if (input.operation === "planned_place_image_enrichment") {
            const currentPlaces = requireRecord(currentBusiness.parserContext).placeIds as string[];
            const oldPlaces = oldBusiness.parserContext === undefined ? undefined : requireRecord(oldBusiness.parserContext).placeIds;
            overlaps = !Array.isArray(oldPlaces) || currentPlaces.some(id => oldPlaces.includes(id));
          }
          const confirmedRetry = imageRetry?.predecessors.some(binding => binding.carrierTaskId === prior.carrierTaskId
            && binding.requestSha256 === prior.requestSha256) && hasConfirmedPublicImageFailure(prior);
          if (overlaps && !confirmedRetry) throw new GenerationCarrierStorageError("mah_stage_predecessor_pending", "同一业务范围的原任务尚未确定接受或拒绝，已阻止分配另一任务身份。");
        }
      }
    }
    this.assertGenerationCurrent(input.generationKey, request, true);
    if (input.hashRequest(requestJson) !== sha256(requestJson)) throw new GenerationCarrierStorageError("mah_request_invalid", "MAH 请求摘要与实际字节不一致。");
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO mah_generation_carriers (
        generation_key, operation, batch_key, batch_id, attempt, carrier_task_id, request_id,
        input_sha256, request_sha256, request_json, expected_subpath, slot_class, project_root,
        status, created_at, updated_at, protocol, request_byte_length, serializer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.generationKey, input.operation, input.batchId ?? "", input.batchId ?? null, attempt, carrierTaskId, requestId,
      input.inputSha256, input.hashRequest(requestJson), requestJson, input.expectedSubpath, input.slotClass ?? null, input.projectRoot,
      input.preparedStatus, now, now, protocol, Buffer.byteLength(requestJson), input.serializerVersion ?? "canonical-json-v1");
    const result = this.requireByTaskId(carrierTaskId);
    this.database.exec("COMMIT"); return result;
    } catch (error) { if (this.database.isTransaction) this.database.exec("ROLLBACK"); throw error; }
  }

  getByTaskId(carrierTaskId: string): GenerationCarrierMapping<Request, Operation, Status> | undefined {
    const row = this.database.prepare("SELECT * FROM mah_generation_carriers WHERE carrier_task_id = ?").get(carrierTaskId) as Record<string, unknown> | undefined;
    return row ? mappingFromRow<Request, Operation, Status>(row) : undefined;
  }

  listForGeneration(generationKey: string): Array<GenerationCarrierMapping<Request, Operation, Status>> {
    return (this.database.prepare("SELECT * FROM mah_generation_carriers WHERE generation_key = ? ORDER BY created_at, attempt").all(generationKey) as Array<Record<string, unknown>>)
      .map((row) => mappingFromRow<Request, Operation, Status>(row));
  }

  listRecoverable(statuses: readonly Status[]): Array<GenerationCarrierMapping<Request, Operation, Status>> {
    if (!statuses.length) return [];
    const placeholders = statuses.map(() => "?").join(",");
    return (this.database.prepare(`SELECT * FROM mah_generation_carriers WHERE status IN (${placeholders}) ORDER BY updated_at`).all(...statuses) as Array<Record<string, unknown>>)
      .map((row) => mappingFromRow<Request, Operation, Status>(row));
  }

  updateStatus(carrierTaskId: string, status: Status, error?: { code: string; message: string }): GenerationCarrierMapping<Request, Operation, Status> {
    return this.withWriteLock(() => {
    const current = this.requireByTaskId(carrierTaskId);
    if (current.protocol === "mah_task_queue_v1") {
      const terminal = new Set(["artifact_invalid", "artifact_changed", "failed", "cancelled"]);
      const observed = new Set(["prepared", "submitting", "submission_unknown", "queued", "running", "completed", "validated"]);
      if (terminal.has(current.status) && observed.has(status)) return current;
      const progress = ["prepared", "submission_unknown", "queued", "running", "completed", "validated", "imported"];
      if (progress.includes(status) && progress.indexOf(current.status) > progress.indexOf(status)) return current;
    }
    if (current.status === "imported" || current.cancelRequestedAt && status !== "cancelled" && status !== "cancel_requested") return current;
    const result = this.database.prepare(`UPDATE mah_generation_carriers SET status = ?, error_code = ?, error_message = ?, updated_at = ?, cancel_requested_at = CASE WHEN ? IN ('cancel_requested','cancelled') THEN COALESCE(cancel_requested_at, ?) ELSE cancel_requested_at END WHERE carrier_task_id = ? AND status != 'imported' AND (cancel_requested_at IS NULL OR ? IN ('cancel_requested','cancelled'))`)
      .run(status, error?.code ?? null, error?.message ?? null, new Date().toISOString(), status, new Date().toISOString(), carrierTaskId, status);
    if (result.changes !== 1) return this.requireByTaskId(carrierTaskId);
    return this.requireByTaskId(carrierTaskId);
    });
  }

  recordSubmitReceipt(input: {
    carrierTaskId: string;
    slotClass?: string;
    projectRoot: string;
    admissionStatus?: string;
    submitReceiptJson: string;
  }): GenerationCarrierMapping<Request, Operation, Status> {
    return this.withWriteLock(() => {
    const current = this.getByTaskId(input.carrierTaskId);
    if (!current) throw new GenerationCarrierStorageError("mah_mapping_missing", "Landi MAH 映射不存在，已拒绝保存提交回执。");
    if (current.protocol === "mah_task_queue_v1" ? input.slotClass !== undefined || input.admissionStatus !== undefined : !["ready", "running", "queued", "deferred"].includes(String(input.admissionStatus))) throw new GenerationCarrierStorageError("mah_submit_receipt_invalid", "MAH 回执准入字段与协议不一致。");
    if (current.slotClass !== input.slotClass || current.projectRoot !== input.projectRoot) {
      throw new GenerationCarrierStorageError("mah_submit_receipt_invalid", "MAH 提交回执与持久化槽位或规范项目根不一致。");
    }
    if (current.submitReceiptJson && (current.submitReceiptJson !== input.submitReceiptJson || current.admissionStatus !== input.admissionStatus)) {
      throw new GenerationCarrierStorageError("mah_submit_receipt_invalid", "同一 MAH Task 返回了变化的公开提交回执。");
    }
    this.database.prepare(`UPDATE mah_generation_carriers
      SET admission_status = ?, submit_receipt_json = ?, updated_at = ?
      WHERE carrier_task_id = ?`).run(input.admissionStatus ?? null, input.submitReceiptJson, new Date().toISOString(), input.carrierTaskId);
    return this.requireByTaskId(input.carrierTaskId);
    });
  }

  recordValidated(input: {
    carrierTaskId: string;
    resultJson: string;
    resultSha256: string;
    validatedStatus: Status;
    importedStatus: Status;
    changedStatus: Status;
    cancelledStatuses: readonly Status[];
  }): GenerationCarrierMapping<Request, Operation, Status> {
    return this.withWriteLock(() => {
    const current = this.getByTaskId(input.carrierTaskId);
    if (!current) throw new GenerationCarrierStorageError("mah_mapping_missing", "Landi MAH 映射不存在，已拒绝导入。");
    if (current.status === input.importedStatus && current.resultSha256 === input.resultSha256 && current.resultJson === input.resultJson) return current;
    if (current.protocol === "mah_task_queue_v1" && ["artifact_invalid", "artifact_changed", "failed", "cancelled"].includes(current.status)) throw new GenerationCarrierStorageError("mah_artifact_invalid", "已拒绝或已终止的候选不能重新验证。");
    this.assertGenerationCurrent(current.generationKey, current.request, true);
    if (current.cancelRequestedAt) throw new GenerationCarrierStorageError("cancelled", "取消后的结果不能验证。");
    if (!SHA256.test(input.resultSha256) || sha256(input.resultJson) !== input.resultSha256) throw new GenerationCarrierStorageError("mah_artifact_invalid", "结果字节摘要不一致。");
    if (input.cancelledStatuses.includes(current.status)) throw new GenerationCarrierStorageError("cancelled", "该 Landi generation 已取消，晚到的 MAH 工件不会导入。");
    if (current.resultSha256 && (current.resultSha256 !== input.resultSha256 || current.resultJson !== input.resultJson)) {
      this.updateStatus(input.carrierTaskId, input.changedStatus, { code: "mah_artifact_changed", message: "同一 MAH 映射返回了不同摘要的工件。" });
      throw new GenerationCarrierStorageError("mah_artifact_changed", "同一 MAH 映射返回了不同摘要的工件，已拒绝替换已接受结果。");
    }
    if (current.status === input.importedStatus && current.resultSha256 === input.resultSha256) return current;
    this.database.prepare(`UPDATE mah_generation_carriers
      SET status = ?, result_sha256 = ?, result_json = ?, error_code = NULL, error_message = NULL, updated_at = ?
      WHERE carrier_task_id = ?`).run(input.validatedStatus, input.resultSha256, input.resultJson, new Date().toISOString(), input.carrierTaskId);
    return this.requireByTaskId(input.carrierTaskId);
    });
  }

  markCarriersImported(input: {
    generationKey: string;
    carrierTaskIds: readonly string[];
    validatedStatus: Status;
    importedStatus: Status;
    updatedAt?: string;
    requireAllValidated?: boolean;
    expectedCarriers?: readonly { carrierTaskId: string; resultSha256: string; requestSha256: string }[] | undefined;
  }): number {
    return this.withWriteLock(() => {
    this.assertGenerationCurrent(input.generationKey);
    const carrierTaskIds = [...new Set(input.carrierTaskIds)];
    if (!carrierTaskIds.length) {
      if (input.requireAllValidated) throw new GenerationCarrierStorageError("mah_import_boundary_invalid", "Plan 事务缺少已验证的 MAH carrier，已阻止无来源保存。");
      return 0;
    }
    const placeholders = carrierTaskIds.map(() => "?").join(",");
    const rows = this.database.prepare(`SELECT *
      FROM mah_generation_carriers WHERE carrier_task_id IN (${placeholders})`).all(...carrierTaskIds) as Array<Record<string, unknown>>;
    if (rows.length !== carrierTaskIds.length || rows.some((row) => row.cancel_requested_at != null || row.generation_key !== input.generationKey
      || (row.status !== input.validatedStatus && row.status !== input.importedStatus)
      || typeof row.result_sha256 !== "string" || typeof row.result_json !== "string")) {
      throw new GenerationCarrierStorageError("mah_import_boundary_invalid", "待导入的 MAH carrier 与 Generation、验证状态或结果摘要不一致。");
    }
    for (const row of rows) {
      if (input.expectedCarriers && (input.expectedCarriers.length !== carrierTaskIds.length || new Set(input.expectedCarriers.map(item => item.carrierTaskId)).size !== carrierTaskIds.length)) throw new GenerationCarrierStorageError("mah_import_boundary_invalid", "导入摘要集合与 carrier 集合不一致。");
      const expected = input.expectedCarriers?.find((item) => item.carrierTaskId === row.carrier_task_id);
      if (row.protocol === "mah_task_queue_v1" && (!expected || expected.resultSha256 !== row.result_sha256 || expected.requestSha256 !== row.request_sha256)) throw new GenerationCarrierStorageError("mah_import_boundary_invalid", "普通队列导入缺少精确请求与结果摘要。");
      this.assertGenerationCurrent(input.generationKey, JSON.parse(String(row.request_json))); if (sha256(String(row.result_json)) !== row.result_sha256) throw new GenerationCarrierStorageError("mah_artifact_changed", "工件摘要已变化。"); }
    const unlistedValidated = input.requireAllValidated && this.database.prepare(`SELECT carrier_task_id FROM mah_generation_carriers
      WHERE generation_key = ? AND status = ? AND carrier_task_id NOT IN (${placeholders}) LIMIT 1`)
      .get(input.generationKey, input.validatedStatus, ...carrierTaskIds);
    if (unlistedValidated) {
      throw new GenerationCarrierStorageError("mah_import_boundary_invalid", "Generation 仍有未纳入本次事务的已验证 MAH carrier，已停止部分导入。");
    }
    const result = this.database.prepare(`UPDATE mah_generation_carriers
      SET status = ?, error_code = NULL, error_message = NULL, updated_at = ?
      WHERE generation_key = ? AND status = ? AND carrier_task_id IN (${placeholders})`)
      .run(input.importedStatus, input.updatedAt ?? new Date().toISOString(), input.generationKey, input.validatedStatus, ...carrierTaskIds);
    return Number(result.changes);
    });
  }

  markGenerationCancelRequested(generationKey: string, cancelRequestedStatus: Status, updatedAt = new Date().toISOString()): number {
    const result = this.database.prepare(`UPDATE mah_generation_carriers
      SET status = ?, error_code = NULL, error_message = NULL, updated_at = ?, cancel_requested_at = COALESCE(cancel_requested_at, ?)
      WHERE generation_key = ? AND status NOT IN ('imported', 'cancelled')`)
      .run(cancelRequestedStatus, updatedAt, updatedAt, generationKey);
    return Number(result.changes);
  }

  getGenerationCarrierCheckpoint(generationKey: string): { version: number; researchSetId?: string; blueprintId?: string; blueprintVersion?: number; artifactSha256: string } {
    const generation = this.database.prepare("SELECT research_set_id,blueprint_id,blueprint_version FROM blueprint_generations WHERE generation_key=?").get(generationKey) as Record<string, unknown> | undefined;
    if (!generation) throw new GenerationCarrierStorageError("mah_mapping_missing", "Generation 不存在。");
    const research = generation.research_set_id == null ? undefined : this.database.prepare("SELECT content_json FROM research_sets WHERE id=? AND generation_key=?").get(String(generation.research_set_id),generationKey);
    const blueprint = generation.blueprint_id == null ? undefined : this.database.prepare("SELECT content_json FROM trip_blueprints WHERE id=? AND version=? AND generation_key=?").get(String(generation.blueprint_id),Number(generation.blueprint_version),generationKey);
    if (generation.research_set_id != null && !research || generation.blueprint_id != null && !blueprint) throw new GenerationCarrierStorageError("mah_request_conflict", "父检查点内容缺失。");
    return { version: Number(generation.blueprint_version ?? 0),
      ...(generation.research_set_id == null ? {} : { researchSetId: String(generation.research_set_id) }),
      ...(generation.blueprint_id == null ? {} : { blueprintId: String(generation.blueprint_id) }),
      ...(generation.blueprint_version == null ? {} : { blueprintVersion: Number(generation.blueprint_version) }),
      artifactSha256: sha256(canonicalJson({ research: research ? JSON.parse(String(research.content_json)) : null, blueprint: blueprint ? JSON.parse(String(blueprint.content_json)) : null })) };
  }

  assertGenerationCurrent(generationKey: string, request?: unknown, checkParent = false, allowCarrierCancellation = false): void {
    const row = this.database.prepare("SELECT g.*, s.proposal_json, s.confirmed_proposal_version, s.status AS session_status FROM blueprint_generations g JOIN planning_sessions s ON s.id=g.session_id WHERE g.generation_key=?").get(generationKey) as Record<string, unknown> | undefined;
    if (!row || !allowCarrierCancellation && row.carrier_cancel_requested_at != null || ["cancelled", "superseded"].includes(String(row?.status))) throw new GenerationCarrierStorageError("cancelled", "该生成已取消或不存在。");
    if (request) {
      const value = request as Record<string, unknown>, proposal = value.proposalRef as Record<string, unknown>, skill = value.skillLineage as Record<string, unknown>;
      if (checkParent) {
        const parent = value.parentCheckpoint as Record<string, unknown>;
        if (value.protocol === "mah_task_queue_v1" && (!parent || canonicalJson(parent) !== canonicalJson(this.getGenerationCarrierCheckpoint(generationKey)))) throw new GenerationCarrierStorageError("mah_request_conflict", "父检查点内容摘要已变化。");
        if (parent && (Number(parent.version) !== Number(row.blueprint_version ?? 0) || parent.researchSetId !== undefined && parent.researchSetId !== row.research_set_id || parent.blueprintId !== undefined && parent.blueprintId !== row.blueprint_id || parent.blueprintVersion !== undefined && parent.blueprintVersion !== row.blueprint_version)) throw new GenerationCarrierStorageError("mah_request_conflict", "父检查点已变化。");
      }
      if (proposal?.sessionId !== row.session_id || proposal?.proposalVersion !== row.proposal_version || skill?.skillId !== row.skill_id || skill?.skillVersion !== row.skill_version) throw new GenerationCarrierStorageError("mah_request_conflict", "MAH 请求不属于当前 Generation。");
    }
    const proposal = row.proposal_json ? JSON.parse(String(row.proposal_json)) as Record<string, unknown> : undefined;
    if (row.session_status === "abandoned" || row.confirmed_proposal_version !== row.proposal_version || proposal?.version !== row.proposal_version) throw new GenerationCarrierStorageError("mah_request_conflict", "已确认提案版本已变化。");
  }

  claimSubmission(carrierTaskId: string, requestSha256: string): boolean {
    if (this.database.isTransaction) throw new GenerationCarrierStorageError("mah_transaction_open", "提交发送权需要独立耐久事务。");
    const synchronous = Number(this.database.prepare("PRAGMA synchronous").get()?.synchronous);
    const mode = String(this.database.prepare("PRAGMA journal_mode").get()?.journal_mode);
    if (![2, 3].includes(synchronous) || !["delete", "truncate", "persist", "wal"].includes(mode)) throw new GenerationCarrierStorageError("mah_durability_unverified", "SQLite 持久化模式不足以授予发送权。");
    return this.withWriteLock(() => {
      const mapping = this.requireByTaskId(carrierTaskId);
      this.assertGenerationCurrent(mapping.generationKey, mapping.request, true);
      if (mapping.protocol !== "mah_task_queue_v1" || mapping.requestSha256 !== requestSha256 || sha256(mapping.requestJson) !== requestSha256 || mapping.requestByteLength !== Buffer.byteLength(mapping.requestJson) || mapping.cancelRequestedAt || mapping.status !== "prepared") return false;
      return this.database.prepare("UPDATE mah_generation_carriers SET status='submission_unknown',updated_at=? WHERE carrier_task_id=? AND status='prepared' AND cancel_requested_at IS NULL AND request_sha256=?").run(new Date().toISOString(),carrierTaskId,requestSha256).changes === 1;
    });
  }

  recordRunningAt(carrierTaskId: string, runningAt: string): GenerationCarrierMapping<Request, Operation, Status> {
    if (!validDateTime(runningAt)) throw new GenerationCarrierStorageError("mah_request_invalid", "运行起点无效。");
    return this.withWriteLock(() => {
      const current = this.requireByTaskId(carrierTaskId);
      if (current.runningAt && Date.parse(current.runningAt) !== Date.parse(runningAt)) throw new GenerationCarrierStorageError("mah_running_identity_conflict", "公开运行起点与已保存事实不一致。");
      this.database.prepare("UPDATE mah_generation_carriers SET running_at=COALESCE(running_at,?),updated_at=? WHERE carrier_task_id=?").run(runningAt,new Date().toISOString(),carrierTaskId);
      return this.requireByTaskId(carrierTaskId);
    });
  }

  private withWriteLock<T>(work: () => T): T {
    const owns = !this.database.isTransaction;
    if (owns) this.database.exec("BEGIN IMMEDIATE");
    try { const result = work(); if (owns) this.database.exec("COMMIT"); return result; }
    catch (error) { if (owns && this.database.isTransaction) this.database.exec("ROLLBACK"); throw error; }
  }

  private requireByTaskId(carrierTaskId: string): GenerationCarrierMapping<Request, Operation, Status> {
    const mapping = this.getByTaskId(carrierTaskId);
    if (!mapping) throw new GenerationCarrierStorageError("mah_mapping_missing", "Landi MAH 映射不存在，已拒绝继续。");
    return mapping;
  }

  private listForStage(generationKey: string, operation: Operation, batchId?: string): Array<GenerationCarrierMapping<Request, Operation, Status>> {
    return (this.database.prepare(`SELECT * FROM mah_generation_carriers
      WHERE generation_key = ? AND operation = ? AND batch_key = ? ORDER BY attempt DESC`).all(generationKey, operation, batchId ?? "") as Array<Record<string, unknown>>)
      .map((row) => mappingFromRow<Request, Operation, Status>(row));
  }

  private migrateLegacySidecar(databasePath: string): boolean {
    if (databasePath === ":memory:") return false;
    const legacyPath = `${databasePath}.mah-carriers.sqlite`;
    if (!existsSync(legacyPath)) return false;
    const legacy = new DatabaseSync(legacyPath, { readOnly: true });
    let committed = false;
    try {
      const table = legacy.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'mah_generation_carriers'").get();
      if (!table) throw new GenerationCarrierStorageError("mah_legacy_mapping_invalid", "旧 MAH carrier sidecar 缺少预期映射表，已停止迁移。");
      const rows = legacy.prepare("SELECT * FROM mah_generation_carriers ORDER BY created_at, attempt").all() as Array<Record<string, unknown>>;
      try {
        for (const row of rows) {
          assertLegacyRow(row, this.database);
          const byTask = this.database.prepare("SELECT * FROM mah_generation_carriers WHERE carrier_task_id = ?").get(String(row.carrier_task_id)) as Record<string, unknown> | undefined;
          const byStage = this.database.prepare(`SELECT * FROM mah_generation_carriers
            WHERE generation_key = ? AND operation = ? AND batch_key = ? AND attempt = ?`).get(String(row.generation_key), String(row.operation), String(row.batch_key), Number(row.attempt)) as Record<string, unknown> | undefined;
          if (byTask || byStage) {
            if (!byTask || !byStage || !sameCarrierRow(row, byTask) || !sameCarrierRow(row, byStage)) {
              throw new GenerationCarrierStorageError("mah_legacy_mapping_conflict", "旧 MAH carrier sidecar 与主 Storage 中的映射不一致，已停止迁移。");
            }
            continue;
          }
          this.database.prepare(`INSERT INTO mah_generation_carriers (
            generation_key, operation, batch_key, batch_id, attempt, carrier_task_id, request_id,
            input_sha256, request_sha256, request_json, expected_subpath, status, result_sha256,
            result_json, error_code, error_message, created_at, updated_at, slot_class, project_root,
            admission_status, submit_receipt_json, protocol, request_byte_length, serializer_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'background', NULL, NULL, NULL, 'mah_slot_v1', ?, 'canonical-json-v1')`)
            .run(...LEGACY_CARRIER_COLUMNS.map((column) => sqlValue(row[column])), Buffer.byteLength(String(row.request_json)));
        }
        this.recordSchemaMigrations();
        committed = true;
      } catch (error) {
        throw error;
      }
    } finally {
      legacy.close();
    }
    if (!committed) return false;

    return true;
  }

  private ensureAdmissionIdentityColumns(): void {
    const generationColumns = this.database.prepare("PRAGMA table_info(blueprint_generations)").all();
    if (!generationColumns.some(column => column.name === "carrier_cancel_requested_at")) this.database.exec("ALTER TABLE blueprint_generations ADD COLUMN carrier_cancel_requested_at TEXT");
    const columns = this.database.prepare("PRAGMA table_info(mah_generation_carriers)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    const additions = [
      ["slot_class", "TEXT CHECK (slot_class IN ('interactive', 'background', 'review'))"],
      ["project_root", "TEXT"],
      ["admission_status", "TEXT CHECK (admission_status IN ('ready', 'running', 'queued', 'deferred'))"],
      ["submit_receipt_json", "TEXT"],
      ["protocol", "TEXT"], ["request_byte_length", "INTEGER"], ["serializer_version", "TEXT"], ["cancel_requested_at", "TEXT"], ["running_at", "TEXT"]
    ] as const;
    for (const [name, declaration] of additions) {
      if (!names.has(name)) this.database.exec(`ALTER TABLE mah_generation_carriers ADD COLUMN ${name} ${declaration}`);
    }
    const rows = this.database.prepare("SELECT * FROM mah_generation_carriers").all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const request = JSON.parse(String(row.request_json));
      const protocol = classifyRequest(request);
      assertVersionedRequest(request, row);
      if (MAH_STAGE_RESULT_STATUSES.has(String(row.status)) && row.result_json == null) throw new GenerationCarrierStorageError("mah_request_invalid", "已接受结果缺少持久工件。");
      if (row.result_json != null && protocol !== "mah_task_queue_v1") assertLegacyResult(JSON.parse(String(row.result_json)), request, row);
      if (protocol === "mah_task_queue_v1" && (row.slot_class != null || row.admission_status != null)) throw new GenerationCarrierStorageError("mah_request_invalid", "普通队列包含旧槽位准入字段。");
      if (!UUID_V4.test(String(row.carrier_task_id)) || row.expected_subpath !== MAH_STAGE_RESULT_SUBPATH || row.request_byte_length != null && Number(row.request_byte_length) !== Buffer.byteLength(String(row.request_json)) || (row.result_json == null) !== (row.result_sha256 == null) || row.result_json != null && sha256(String(row.result_json)) !== row.result_sha256 || sha256(String(row.request_json)) !== row.request_sha256 || row.protocol != null && row.protocol !== protocol) throw new GenerationCarrierStorageError("mah_request_invalid", "历史 MAH 请求身份或摘要无效。");
      this.database.prepare("UPDATE mah_generation_carriers SET protocol=?, request_byte_length=?, serializer_version=COALESCE(serializer_version,'canonical-json-v1'), slot_class=CASE WHEN ?='mah_slot_v1' THEN COALESCE(slot_class,'background') ELSE slot_class END, cancel_requested_at=CASE WHEN status IN ('cancel_requested','cancelled') THEN COALESCE(cancel_requested_at,updated_at) ELSE cancel_requested_at END WHERE carrier_task_id=?")
        .run(protocol, Buffer.byteLength(String(row.request_json)), protocol, String(row.carrier_task_id));
    }
  }

  cleanupLegacySidecar(databasePath: string): void {
    if (this.database.isTransaction) throw new GenerationCarrierStorageError("mah_transaction_open", "migration_cleanup_before_commit");
    if (databasePath === ":memory:") return;
    const path = `${databasePath}.mah-carriers.sqlite`;
    for (const candidate of [`${path}-wal`, `${path}-shm`, path]) { try { if (existsSync(candidate)) unlinkSync(candidate); } catch { /* 主事务已提交；保留旧文件供下次完整核对。 */ } }
  }

  private recordSchemaMigrations(): void {
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (29, 'mah-generation-queue-protocol', ?)").run(new Date().toISOString());
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (25, 'authoritative-generation-carriers', ?)")
      .run(new Date().toISOString());
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (26, 'mah-carrier-admission-identity', ?)")
      .run(new Date().toISOString());
  }
}

const LEGACY_CARRIER_COLUMNS = [
  "generation_key", "operation", "batch_key", "batch_id", "attempt", "carrier_task_id", "request_id",
  "input_sha256", "request_sha256", "request_json", "expected_subpath", "status", "result_sha256",
  "result_json", "error_code", "error_message", "created_at", "updated_at"
] as const;

const MAH_STAGE_OPERATIONS = [
  "research_batch", "itinerary_draft", "itinerary_review", "itinerary_repair",
  "planned_place_image_enrichment", "semantic_plan", "semantic_validation", "semantic_repair"
] as const;
const MAH_STAGE_STATUSES = [
  "prepared", "submitting", "submission_unknown", "queued", "running", "completed", "validated", "imported",
  "cancel_requested", "cancelled", "failed", "scheduler_unavailable", "carrier_missing", "provider_route_unverified",
  "artifact_missing", "artifact_invalid", "artifact_changed"
] as const;
const MAH_STAGE_RESULT_STATUSES = new Set(["validated", "imported", "artifact_changed"]);
const MAH_STAGE_RESULT_SUBPATH = "artifacts/landi-stage-result.json";
const MAH_STAGE_REQUEST_KIND = "landi_generation_stage_request";
const MAH_STAGE_RESULT_KIND = "landi_generation_stage_result";
const MAH_STAGE_RESULT_CONTRACT = "landi.mah-generation-stage-result.v1";
const MAH_OPERATION_CONTRACTS: Record<string, { input: string; output: string }> = {
  research_batch: { input: "landi.skill-research-batch-input.v1", output: "landi.skill-research-batch.v1" },
  itinerary_draft: { input: "landi.skill-itinerary-input.v1", output: "landi.skill-itinerary.v1" },
  itinerary_review: { input: "landi.skill-itinerary-review-input.v1", output: "landi.skill-itinerary-review.v1" },
  itinerary_repair: { input: "landi.skill-itinerary-repair-input.v1", output: "landi.skill-itinerary.v1" },
  planned_place_image_enrichment: { input: "landi.planned-place-image-enrichment-input.v1", output: "landi.planned-place-image-enrichment.v1" },
  semantic_plan: { input: "landi.semantic-plan-input.v1", output: "landi.semantic-plan.v1" },
  semantic_validation: { input: "landi.semantic-validation-input.v1", output: "landi.semantic-validation.v1" },
  semantic_repair: { input: "landi.semantic-repair-input.v1", output: "landi.semantic-repair.v1" }
};
const CAPABILITY_REQUIREMENTS = new Set(["structured_output", "native_schema_constrained_generation", "external_current_research", "filesystem_write"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function mappingFromRow<Request, Operation extends string, Status extends string>(row: Record<string, unknown>): GenerationCarrierMapping<Request, Operation, Status> {
  return {
    generationKey: String(row.generation_key),
    operation: String(row.operation) as Operation,
    ...(row.batch_id == null ? {} : { batchId: String(row.batch_id) }),
    attempt: Number(row.attempt),
    carrierTaskId: String(row.carrier_task_id),
    requestId: String(row.request_id),
    inputSha256: String(row.input_sha256),
    requestSha256: String(row.request_sha256),
    request: JSON.parse(String(row.request_json)) as Request,
    protocol: row.protocol as GenerationCarrierProtocol,
    requestJson: String(row.request_json),
    requestByteLength: Number(row.request_byte_length),
    serializerVersion: String(row.serializer_version),
    ...(row.cancel_requested_at == null ? {} : { cancelRequestedAt: String(row.cancel_requested_at) }),
    ...(row.running_at == null ? {} : { runningAt: String(row.running_at) }),
    expectedSubpath: String(row.expected_subpath),
    ...(row.slot_class == null ? {} : { slotClass: String(row.slot_class) }),
    ...(row.project_root == null ? {} : { projectRoot: String(row.project_root) }),
    ...(row.admission_status == null ? {} : { admissionStatus: String(row.admission_status) }),
    ...(row.submit_receipt_json == null ? {} : { submitReceiptJson: String(row.submit_receipt_json) }),
    status: String(row.status) as Status,
    ...(row.result_sha256 == null ? {} : { resultSha256: String(row.result_sha256) }),
    ...(row.result_json == null ? {} : { resultJson: String(row.result_json) }),
    ...(row.error_code == null ? {} : { errorCode: String(row.error_code) }),
    ...(row.error_message == null ? {} : { errorMessage: String(row.error_message) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function assertLegacyRow(row: Record<string, unknown>, database: DatabaseSync): void {
  for (const column of LEGACY_CARRIER_COLUMNS) {
    if (["batch_key", "batch_id", "result_sha256", "result_json", "error_code", "error_message"].includes(column)) continue;
    if (row[column] === null || row[column] === undefined || String(row[column]).length === 0) {
      throw new GenerationCarrierStorageError("mah_legacy_mapping_invalid", `旧 MAH carrier sidecar 的 ${column} 字段无效。`);
    }
  }
  if (!Number.isInteger(Number(row.attempt)) || Number(row.attempt) < 1) throw new GenerationCarrierStorageError("mah_legacy_mapping_invalid", "旧 MAH carrier sidecar 的 attempt 无效。");
  if (!MAH_STAGE_OPERATIONS.includes(String(row.operation) as typeof MAH_STAGE_OPERATIONS[number])
    || !MAH_STAGE_STATUSES.includes(String(row.status) as typeof MAH_STAGE_STATUSES[number])) {
    throw new GenerationCarrierStorageError("mah_legacy_mapping_invalid", "旧 MAH carrier sidecar 的 operation 或 status 无效。");
  }
  if (!UUID_V4.test(String(row.carrier_task_id)) || !isBoundedString(row.request_id, 160)
    || !SHA256.test(String(row.input_sha256)) || !SHA256.test(String(row.request_sha256))
    || row.expected_subpath !== MAH_STAGE_RESULT_SUBPATH || !validDateTime(row.created_at) || !validDateTime(row.updated_at)) {
    throw new GenerationCarrierStorageError("mah_legacy_mapping_invalid", "旧 MAH carrier sidecar 的身份、摘要、固定路径或时间字段无效。");
  }
  try {
    const requestJson = String(row.request_json);
    const request = JSON.parse(requestJson) as Record<string, unknown>;
    assertLegacyRequest(request, row);
    if (sha256(requestJson) !== row.request_sha256) throw new Error("invalid");
    const generation = database.prepare(`SELECT session_id, proposal_version, skill_id, skill_version
      FROM blueprint_generations WHERE generation_key = ?`).get(String(row.generation_key)) as Record<string, unknown> | undefined;
    const proposalRef = request.proposalRef as Record<string, unknown>;
    const skillLineage = request.skillLineage as Record<string, unknown>;
    if (!generation || generation.session_id !== proposalRef.sessionId || generation.proposal_version !== proposalRef.proposalVersion
      || generation.skill_id !== skillLineage.skillId || generation.skill_version !== skillLineage.skillVersion) throw new Error("invalid");
    if ((row.result_json == null) !== (row.result_sha256 == null)) throw new Error("invalid");
    if (row.result_json != null) {
      const resultJson = String(row.result_json);
      const result = JSON.parse(resultJson) as Record<string, unknown>;
      assertLegacyResult(result, request, row);
      if (!SHA256.test(String(row.result_sha256)) || sha256(resultJson) !== row.result_sha256 || !MAH_STAGE_RESULT_STATUSES.has(String(row.status))) throw new Error("invalid");
    } else if (MAH_STAGE_RESULT_STATUSES.has(String(row.status))) {
      throw new Error("invalid");
    }
  } catch (error) {
    throw new GenerationCarrierStorageError("mah_legacy_mapping_invalid", "旧 MAH carrier sidecar 的请求 JSON 无效。", { cause: error });
  }
}

function assertLegacyRequest(request: Record<string, unknown>, row: Record<string, unknown>): void {
  assertExactKeys(request, ["schemaVersion", "kind", "requestId", "carrierTaskId", "generationKey", "proposalRef", "skillLineage", "operation", "batchId", "attempt", "parentCheckpoint", "input", "output", "execution", "createdAt"], ["batchId"]);
  const operation = String(request.operation);
  const proposalRef = requireRecord(request.proposalRef);
  const skillLineage = requireRecord(request.skillLineage);
  const checkpoint = requireRecord(request.parentCheckpoint);
  const input = requireRecord(request.input);
  const output = requireRecord(request.output);
  const execution = requireRecord(request.execution);
  assertExactKeys(proposalRef, ["sessionId", "proposalVersion"], []);
  assertExactKeys(skillLineage, ["skillId", "skillVersion"], []);
  assertExactKeys(checkpoint, ["version", "researchSetId", "blueprintId", "blueprintVersion", "artifactSha256"], ["researchSetId", "blueprintId", "blueprintVersion", "artifactSha256"]);
  assertExactKeys(input, ["businessContract", "sha256", "businessInput"], []);
  assertExactKeys(output, ["subpath", "envelopeContract"], []);
  assertExactKeys(execution, ["preferredLanguage", "agentPreference", "webSearch", "maxRuntimeSeconds", "capabilityRequirements"], []);
  const businessInput = requireRecord(input.businessInput);
  const capabilities = execution.capabilityRequirements;
  if (request.schemaVersion !== 1 || request.kind !== MAH_STAGE_REQUEST_KIND || request.carrierTaskId !== row.carrier_task_id
    || request.requestId !== row.request_id || request.generationKey !== row.generation_key || operation !== row.operation
    || (request.batchId ?? null) !== (row.batch_id ?? null) || request.attempt !== Number(row.attempt)
    || !isBoundedString(proposalRef.sessionId, 160) || !positiveInteger(proposalRef.proposalVersion)
    || !isBoundedString(skillLineage.skillId, 160) || !isBoundedString(skillLineage.skillVersion, 80)
    || !nonNegativeInteger(checkpoint.version) || !optionalBoundedString(checkpoint.researchSetId, 160)
    || !optionalBoundedString(checkpoint.blueprintId, 160) || (checkpoint.blueprintVersion !== undefined && !positiveInteger(checkpoint.blueprintVersion))
    || (checkpoint.artifactSha256 !== undefined && !SHA256.test(String(checkpoint.artifactSha256)))
    || input.businessContract !== MAH_OPERATION_CONTRACTS[operation]?.input || input.sha256 !== row.input_sha256
    || sha256(canonicalJson(businessInput)) !== input.sha256 || !Object.keys(businessInput).length
    || output.subpath !== MAH_STAGE_RESULT_SUBPATH || output.envelopeContract !== MAH_STAGE_RESULT_CONTRACT
    || !isBoundedString(execution.preferredLanguage, 40, 2) || !["codex", "claude-code", "mah-routing"].includes(String(execution.agentPreference))
    || typeof execution.webSearch !== "boolean" || !Number.isInteger(execution.maxRuntimeSeconds) || Number(execution.maxRuntimeSeconds) < 1 || Number(execution.maxRuntimeSeconds) > 7200
    || !Array.isArray(capabilities) || capabilities.length > 8 || new Set(capabilities).size !== capabilities.length
    || capabilities.some((capability) => !CAPABILITY_REQUIREMENTS.has(String(capability))) || !validDateTime(request.createdAt)) throw new Error("invalid");
  if (operation === "research_batch" && !isBoundedString(request.batchId, 160)) throw new Error("invalid");
  if ((operation === "research_batch" || operation === "planned_place_image_enrichment") && execution.webSearch !== true) throw new Error("invalid");
  if ((row.batch_id ?? null) === null ? row.batch_key !== "" : row.batch_key !== row.batch_id) throw new Error("invalid");
}

function assertLegacyResult(result: Record<string, unknown>, request: Record<string, unknown>, row: Record<string, unknown>): void {
  assertExactKeys(result, ["schemaVersion", "kind", "requestId", "carrierTaskId", "generationKey", "proposalRef", "skillLineage", "operation", "batchId", "attempt", "inputSha256", "outcome", "businessContract", "payload", "diagnostics", "provenance"], ["batchId"]);
  const provenance = requireRecord(result.provenance);
  const payload = requireRecord(result.payload);
  const diagnostics = result.diagnostics;
  assertExactKeys(provenance, ["carrier", "taskId", "agentId", "modelId", "startedAt", "completedAt"], ["modelId"]);
  if (result.schemaVersion !== 1 || result.kind !== MAH_STAGE_RESULT_KIND || result.requestId !== request.requestId
    || result.carrierTaskId !== row.carrier_task_id || result.generationKey !== row.generation_key
    || canonicalJson(result.proposalRef) !== canonicalJson(request.proposalRef) || canonicalJson(result.skillLineage) !== canonicalJson(request.skillLineage)
    || result.operation !== row.operation || (result.batchId ?? null) !== (row.batch_id ?? null) || result.attempt !== Number(row.attempt)
    || result.inputSha256 !== row.input_sha256 || result.outcome !== "succeeded"
    || result.businessContract !== MAH_OPERATION_CONTRACTS[String(row.operation)]?.output || !Object.keys(payload).length
    || !Array.isArray(diagnostics) || diagnostics.length > 100 || diagnostics.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
      const diagnostic = entry as Record<string, unknown>;
      try { assertExactKeys(diagnostic, ["code", "path", "message"], ["path"]); } catch { return true; }
      return !isBoundedString(diagnostic.code, 120) || !optionalBoundedString(diagnostic.path, 240) || !isBoundedString(diagnostic.message, 1200);
    }) || provenance.carrier !== "mah_task" || provenance.taskId !== row.carrier_task_id
    || !isBoundedString(provenance.agentId, 80) || !optionalBoundedString(provenance.modelId, 120)
    || !validDateTime(provenance.startedAt) || !validDateTime(provenance.completedAt)) throw new Error("invalid");
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], optional: string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key)) || allowed.some((key) => !optional.includes(key) && !(key in value))) throw new Error("invalid");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function isBoundedString(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function optionalBoundedString(value: unknown, max: number): boolean {
  return value === undefined || isBoundedString(value, max);
}

function positiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validDateTime(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameCarrierRow(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return LEGACY_CARRIER_COLUMNS.every((column) => (left[column] ?? null) === (right[column] ?? null))
    && right.slot_class === "background" && right.project_root == null
    && right.admission_status == null && right.submit_receipt_json == null;
}

function sqlValue(value: unknown): string | number | bigint | Uint8Array | null {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value ?? null;
  throw new GenerationCarrierStorageError("mah_legacy_mapping_invalid", "旧 MAH carrier sidecar 包含不受支持的 SQLite 字段值。");
}

function classifyRequest(request: unknown): GenerationCarrierProtocol {
  const value = requireRecord(request);
  if (value.kind !== MAH_STAGE_REQUEST_KIND) throw new GenerationCarrierStorageError("mah_request_invalid", "未知 MAH 请求类型。");
  if (value.schemaVersion === 1) return "mah_slot_v1";
  if (value.schemaVersion === 2) return "mah_slot_v2";
  if (value.schemaVersion === 3 && value.protocol === "mah_task_queue_v1") return "mah_task_queue_v1";
  throw new GenerationCarrierStorageError("mah_request_invalid", "未知 MAH 请求协议。");
}

/** 请求与恢复消费者共用的冻结解析边界；历史无此字段的请求仍只读原身份。 */
export function assertGenerationCarrierBusinessContext(businessInput: Record<string, unknown>, batchId: unknown, operation?: string): void {
  try { validateGenerationCarrierBusinessContext(businessInput, batchId, operation); }
  catch (error) {
    if (error instanceof GenerationCarrierStorageError) throw error;
    throw new GenerationCarrierStorageError("mah_request_invalid", "冻结业务解析边界结构无效。", { cause: error });
  }
}

function validateGenerationCarrierBusinessContext(businessInput: Record<string, unknown>, batchId: unknown, operation?: string): void {
  if (businessInput.stageIdentity !== undefined) {
    const stage = requireRecord(businessInput.stageIdentity);
    assertExactKeys(stage, ["version", "phase", "scope", "round"], []);
    if (stage.version !== 2 || !isBoundedString(stage.phase, 80) || typeof stage.scope !== "string" || stage.scope.length > 160
      || !positiveInteger(stage.round) || Number(stage.round) > 100
      || batchId !== `阶段2-${sha256(canonicalJson(stage)).slice(0, 32)}`) throw new GenerationCarrierStorageError("mah_request_invalid", "业务阶段身份与批次编码不一致。");
  }
  if (businessInput.failedImageRetry !== undefined) {
    const retry = requireRecord(businessInput.failedImageRetry);
    assertExactKeys(retry, ["version", "targetPhase", "targetRound", "predecessors"], []);
    const stage = businessInput.stageIdentity === undefined ? undefined : requireRecord(businessInput.stageIdentity);
    if (operation !== "planned_place_image_enrichment" || retry.version !== 1 || !stage
      || retry.targetPhase !== stage.phase || retry.targetRound !== stage.round
      || !Array.isArray(retry.predecessors) || !retry.predecessors.length || retry.predecessors.length > 32) {
      throw new GenerationCarrierStorageError("mah_image_retry_invalid", "图片重试意图必须绑定当前目标阶段与失败前序。");
    }
    const ids = new Set<string>();
    for (const item of retry.predecessors) {
      const binding = requireRecord(item);
      assertExactKeys(binding, ["carrierTaskId", "requestSha256"], []);
      if (!UUID_V4.test(String(binding.carrierTaskId)) || !SHA256.test(String(binding.requestSha256)) || ids.has(String(binding.carrierTaskId))) {
        throw new GenerationCarrierStorageError("mah_image_retry_invalid", "图片重试前序身份或摘要无效。");
      }
      ids.add(String(binding.carrierTaskId));
    }
  }
  const required = operation === "research_batch" ? ["researchBatch"] : operation === "itinerary_draft" || operation === "itinerary_repair" ? ["placeIds", "sourceIds", "eventIds"] : operation === "itinerary_review" ? ["dates"] : operation === "planned_place_image_enrichment" ? ["placeIds"] : [];
  if (businessInput.parserContext === undefined) {
    if (businessInput.stageIdentity !== undefined && required.length) throw new GenerationCarrierStorageError("mah_request_invalid", "新阶段缺少冻结解析边界。");
    return;
  }
  const context = requireRecord(businessInput.parserContext);
  if (businessInput.stageIdentity !== undefined && required.some(key => context[key] === undefined)) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结解析边界与操作不一致。");
  const keys = ["placeIds", "sourceIds", "eventIds", "dates", "researchBatch", "completedAt", "dayPatch", "qualityRepair"];
  assertExactKeys(context, keys, keys);
  const strings = (value: unknown) => Array.isArray(value) && value.length <= 50000 && value.every(item => isBoundedString(item, 160)) && new Set(value).size === value.length;
  for (const key of ["placeIds", "sourceIds", "eventIds", "dates"]) if (context[key] !== undefined && !strings(context[key])) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结解析范围无效。");
  if (context.completedAt !== undefined && !validDateTime(context.completedAt)) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结研究完成时间无效。");
  if (context.researchBatch !== undefined) {
    const batch = requireRecord(context.researchBatch); assertExactKeys(batch, ["id", "scopeLabel"], []);
    if (!isBoundedString(batch.id, 160) || !isBoundedString(batch.scopeLabel, 1000)) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结研究批次无效。");
  }
  if (context.dayPatch !== undefined) {
    const patch = requireRecord(context.dayPatch); assertExactKeys(patch, ["dates", "dayIds"], []);
    if (!strings(patch.dates) || !(patch.dates as string[]).length || !Array.isArray(patch.dayIds) || patch.dayIds.length !== (patch.dates as string[]).length) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结日期补丁无效。");
    for (const item of patch.dayIds) { const day = requireRecord(item); assertExactKeys(day, ["date", "id"], []);
      if (!(patch.dates as unknown[]).includes(day.date) || !isBoundedString(day.id, 160)) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结日期与日身份不一致。"); }
    if (new Set(patch.dayIds.map(item => (item as Record<string, unknown>).date)).size !== patch.dayIds.length || new Set(patch.dayIds.map(item => (item as Record<string, unknown>).id)).size !== patch.dayIds.length) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结日期补丁重复身份。");
  }
  if (context.qualityRepair !== undefined) {
    const quality = requireRecord(context.qualityRepair); assertExactKeys(quality, ["affectedDates", "allowRegionalReroute", "preserveTripMetadata", "findings"], []);
    if (!strings(quality.affectedDates) || typeof quality.allowRegionalReroute !== "boolean" || typeof quality.preserveTripMetadata !== "boolean" || !Array.isArray(quality.findings) || quality.findings.length > 1000) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结质量修复决策无效。");
    for (const item of quality.findings) { const finding = requireRecord(item); assertExactKeys(finding, ["code", "date"], ["date"]);
      if (!isBoundedString(finding.code, 160) || !optionalBoundedString(finding.date, 160)) throw new GenerationCarrierStorageError("mah_request_invalid", "冻结质量修复依据无效。"); }
  }
}

function assertVersionedRequest(request: Record<string, unknown>, row: Record<string, unknown>): void {
  const protocol = classifyRequest(request);
  if (protocol === "mah_slot_v1") return assertLegacyRequest(request, row);
  const normalized = structuredClone(request);
  normalized.schemaVersion = 1;
  const execution = requireRecord(normalized.execution);
  if (protocol === "mah_slot_v2") {
    if (execution.personalOsSlotClass !== "interactive") throw new GenerationCarrierStorageError("mah_request_invalid", "历史槽位身份无效。");
    delete execution.personalOsSlotClass;
  } else {
    if (!SHA256.test(String(requireRecord(request.parentCheckpoint).artifactSha256))) throw new GenerationCarrierStorageError("mah_request_invalid", "普通队列缺少父检查点内容摘要。");
    if (typeof request.projectRoot !== "string" || !isAbsolute(request.projectRoot) || normalize(request.projectRoot) !== request.projectRoot || request.projectRoot.includes("\0") || request.projectRoot !== row.project_root) throw new GenerationCarrierStorageError("mah_request_invalid", "普通队列项目根不匹配。");
    assertGenerationCarrierBusinessContext(requireRecord(requireRecord(request.input).businessInput), request.batchId, String(request.operation));
    delete normalized.protocol;
    delete normalized.projectRoot;
    if (execution.personalOsSlotClass !== undefined || execution.agentPreference !== undefined) throw new GenerationCarrierStorageError("mah_request_invalid", "普通队列不能携带槽位或 Agent 偏好。");
    if (execution.adaptiveProducerClockV1 !== undefined) {
      const clock = requireRecord(execution.adaptiveProducerClockV1);
      assertExactKeys(clock, ["validatorNodePath", "artifactValidation"], ["artifactValidation"]);
      if (clock.artifactValidation !== undefined && clock.artifactValidation !== "worktree_then_published_v1") {
        throw new GenerationCarrierStorageError("mah_request_invalid", "Adaptive 工件校验策略无效。");
      }
      const nodePath = clock.validatorNodePath;
      if (typeof nodePath !== "string" || nodePath.length < 2 || nodePath.length > 4096
        || !nodePath.startsWith("/") || /['"\\$`\r\n\0]/.test(nodePath)) {
        throw new GenerationCarrierStorageError("mah_request_invalid", "Adaptive 校验器的冻结 Node 路径无效。");
      }
      delete execution.adaptiveProducerClockV1;
    }
    execution.agentPreference = "mah-routing";
    if (requireRecord(normalized.output).envelopeContract !== "landi.mah-generation-stage-result.v2") throw new GenerationCarrierStorageError("mah_request_invalid", "普通队列结果合同不匹配。");
    requireRecord(normalized.output).envelopeContract = MAH_STAGE_RESULT_CONTRACT;
  }
  assertLegacyRequest(normalized, row);
}
