import { MahBusinessContractError } from "./mah-business-contract.js";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { adaptiveValidatorInvocation, readAdaptiveProductionClock } from "./mah-adaptive-stage-witness.js";
import { inspectMahSubmitReceipt, resolveMahCliBinding } from "./mah-cli-binding.js";
import { MahBusinessPublicResultReader, type MahPublicRead } from "./mah-business-public-result.js";
import { createMahPublicReceiptVerifier } from "./mah-business-public-receipt.js";
import { MahCarrierError, MAH_QUEUE_PROTOCOL, MAH_STAGE_MAX_RESULT_BYTES, MAH_STAGE_RESULT_SUBPATH,
  canonicalJson, sha256, assertPersistedMahMapping, parseAndValidateMahStageResult,
  type MahCarrierMapping, type MahGenerationMappings, type MahStageResult } from "./mah-generation-contract.js";

export const MAH_SUPERVISION_STOP_REASON = "landi_server_supervision_stopped";
export type MahCommandResult = { code: number; stdout: string; stderr: string; aborted?: boolean; timedOut?: boolean };
export type MahCommandRunner = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal }) => Promise<MahCommandResult>;
export type MahCliTransportOptions = { mahProjectRoot: string | (() => string); store: MahGenerationMappings;
  environment?: NodeJS.ProcessEnv; run?: MahCommandRunner; schedulerWaitMs?: number; cancelWaitMs?: number; pollIntervalMs?: number };
type Observation = { task: Record<string, unknown>; status: string; materialized: boolean; schedulerStatus?: "queued" | "running" };
const ADAPTIVE_ACCEPTANCE_WAIT_MS = 60 * 60_000;
const RESULT_SCHEMA = "landi-mah-stage-result.v2.schema.json";
const RESULT_VALIDATOR = "landi-validate-stage-result.cjs.txt";
const validationAssets = new URL("../lib/mah-stage-validation/", import.meta.url);
const RECOVERABLE = ["prepared", "submitting", "submission_unknown", "queued", "running", "completed", "validated", "cancel_requested", "scheduler_unavailable"] as const;

/** Internal retry marker for a proven forward completed-version change. */
class MahCompletedVersionChanged extends MahCarrierError {
  constructor() { super("mah_task_lifecycle_conflict", "读取期间任务完成版本已更新，需重新核验完整结果。"); }
}

export class MahCliTransport {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly run: MahCommandRunner;
  private readonly schedulerWaitMs: number;
  private readonly cancelWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly cancellations = new Map<string, Promise<void>>();
  private canonicalProjectRoot?: string;
  constructor(private readonly options: MahCliTransportOptions) {
    this.environment = options.environment ?? process.env;
    this.run = options.run ?? runCommand;
    this.schedulerWaitMs = options.schedulerWaitMs ?? boundedInteger(this.environment.LANDI_MAH_SCHEDULER_WAIT_MS, 90_000, 1_000, 300_000);
    this.cancelWaitMs = options.cancelWaitMs ?? boundedInteger(this.environment.LANDI_MAH_CANCEL_WAIT_MS, 30_000, 1_000, 120_000);
    this.pollIntervalMs = options.pollIntervalMs ?? boundedInteger(this.environment.LANDI_MAH_POLL_INTERVAL_MS, 1_000, 50, 10_000);
  }
  admissionIdentity(): { projectRoot: string; validatorNodePath: string } {
    return { projectRoot: this.projectRoot(), validatorNodePath: realpathSync(process.execPath) };
  }
  async execute(mapping: MahCarrierMapping, signal?: AbortSignal): Promise<{ mapping: MahCarrierMapping; result: MahStageResult }> {
    this.assertMapping(mapping);
    if (supervisionStopped(signal)) throw new MahCarrierError("mah_supervision_stopped", "服务正在关闭；同一任务将在重启后继续查询。");
    if (mapping.cancelRequestedAt || ["cancel_requested", "cancelled"].includes(mapping.status) || signal?.aborted) {
      await this.cancelMapping(mapping); throw new MahCarrierError("cancelled", "行程生成已取消，现有检查点已保留。");
    }
    if (mapping.status === "imported" && mapping.resultJson && mapping.resultSha256 === sha256(mapping.resultJson))
      return { mapping, result: parseAndValidateMahStageResult(mapping.resultJson, mapping.request).result };
    if (mapping.status === "prepared") await this.submit(mapping, signal);
    const terminal = await this.waitForTerminal(mapping, signal);
    return this.validateCompletedArtifact(mapping, terminal, signal);
  }
  async cancelGeneration(generationKey: string): Promise<void> {
    await Promise.all(this.options.store.listForGeneration(generationKey)
      .filter(m => m.protocol === MAH_QUEUE_PROTOCOL && !["imported", "cancelled", "failed"].includes(m.status))
      .map(m => this.cancelMapping(m as MahCarrierMapping)));
  }
  async recoverActiveMappings(generationKey?: string): Promise<Array<{ carrierTaskId: string; generationKey: string; status: string }>> {
    const recovered: Array<{ carrierTaskId: string; generationKey: string; status: string }> = [];
    const candidates = this.options.store.listRecoverable(RECOVERABLE);
    if (generationKey !== undefined) candidates.push(...this.options.store.listForGeneration(generationKey)
      .filter(mapping => mapping.protocol === MAH_QUEUE_PROTOCOL && mapping.operation === "planned_place_image_enrichment"
        && mapping.status === "failed" && !mapping.cancelRequestedAt));
    for (const candidate of candidates) {
      const mapping = candidate as MahCarrierMapping;
      if (generationKey !== undefined && mapping.generationKey !== generationKey) continue;
      if (mapping.protocol !== MAH_QUEUE_PROTOCOL) continue;
      try {
        this.assertMapping(mapping);
        if (mapping.cancelRequestedAt || mapping.status === "cancel_requested") await this.cancelMapping(mapping);
        else if (mapping.status !== "prepared") {
          const observation = await this.observe(mapping);
          this.persistObservation(mapping, observation);
          if (observation.status === "completed") await this.validateCompletedArtifact(mapping, observation);
        }
      } catch { /* 未知、暂未找到及读取错误只保留原 UUID，不改变为可重提终态。 */ }
      recovered.push({ carrierTaskId: mapping.carrierTaskId, generationKey: mapping.generationKey,
        status: this.current(mapping).status });
    }
    return recovered;
  }
  private current(mapping: MahCarrierMapping): MahCarrierMapping {
    const current = this.options.store.getByTaskId(mapping.carrierTaskId) as MahCarrierMapping | undefined;
    if (!current) throw new MahCarrierError("mah_mapping_missing", "生成映射已不存在，结果未导入。");
    return current;
  }
  private assertMapping(mapping: MahCarrierMapping): void {
    assertPersistedMahMapping(mapping);
    if (mapping.protocol !== MAH_QUEUE_PROTOCOL || mapping.request.schemaVersion !== 3)
      throw new MahCarrierError("mah_legacy_protocol_read_only", "历史生成协议仅允许读取，不能提交或继续执行。");
    if (mapping.projectRoot !== this.projectRoot()) throw new MahCarrierError("mah_task_project_mismatch", "生成任务的项目身份不一致。");
  }
  private async submit(mapping: MahCarrierMapping, signal?: AbortSignal): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "landi-mah-stage-"));
    try {
      const requestPath = join(directory, "landi-stage-request.json"), descriptionPath = join(directory, "task-description.txt");
      await writeFile(requestPath, mapping.requestJson, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const [schema, validator] = await Promise.all([
        readFile(new URL(RESULT_SCHEMA, validationAssets), "utf8"),
        readFile(new URL(RESULT_VALIDATOR, validationAssets), "utf8"),
      ]);
      const schemaPath = join(directory, RESULT_SCHEMA), validatorPath = join(directory, RESULT_VALIDATOR);
      await Promise.all([
        writeFile(schemaPath, schema, { encoding: "utf8", mode: 0o600, flag: "wx" }),
        writeFile(validatorPath, validator, { encoding: "utf8", mode: 0o600, flag: "wx" }),
        writeFile(descriptionPath, taskDescription(mapping, sha256(schema), sha256(validator)), { encoding: "utf8", mode: 0o600, flag: "wx" }),
      ]);
      const bytes = await readFile(requestPath);
      if (bytes.byteLength !== mapping.requestByteLength || sha256(bytes.toString("utf8")) !== mapping.requestSha256)
        throw new MahCarrierError("mah_request_invalid", "请求附件字节与冻结摘要不一致。");
      if (signal?.aborted) { if (supervisionStopped(signal)) throw new MahCarrierError("mah_supervision_stopped", "服务正在关闭，尚未发送任务。"); await this.cancelMapping(mapping); return; }
      if (!this.options.store.claimSubmission(mapping.carrierTaskId, mapping.requestSha256)) return;
      // 耐久 CAS 已提交；此后任何失败都只能查原 UUID。
      try {
        const response = await this.invoke(["task", "submit", "--cwd", mapping.projectRoot, "--description-file", descriptionPath,
          "--title", title(mapping), "--task-id", mapping.carrierTaskId, "--no-write", "--attach", requestPath, "--attach", schemaPath, "--attach", validatorPath, "--format", "json"], 60_000, signal);
        const receipt = inspectSubmitReceipt(response, mapping);
        if (receipt) this.options.store.recordSubmitReceipt({ carrierTaskId: mapping.carrierTaskId, projectRoot: mapping.projectRoot,
          submitReceiptJson: canonicalJson(receipt) });
      } catch { /* 回执丢失仍保留 submission_unknown；查询不获得第二次发送权。 */ }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  private async waitForTerminal(mapping: MahCarrierMapping, signal?: AbortSignal): Promise<Observation> {
    const observationStartedAt = Date.now();
    const waitingDeadline = observationStartedAt + this.schedulerWaitMs;
    // A new explicit supervision attempt gets a bounded query window for the
    // original UUID. Scheduler progress cannot start or reset production timing.
    let materializationDeadline: number | undefined;
    let endedProduction: { endedAt: number; traceId: unknown; requestId: unknown; lifecycleRevision: unknown } | undefined;
    let closingDeadline: number | undefined;
    let initialLifecycleDeadline: number | undefined;
    let initialUpdateLagIdentity: { trace: unknown; request: unknown; active: unknown } | undefined;
    const sameClosingIdentity = (observed: Observation | undefined) => Boolean(endedProduction && observed?.materialized
      && observed.task.orchestration_topology === "adaptive" && observed.task.trace_id === endedProduction.traceId
      && observed.task.active_request_id === endedProduction.requestId && observed.task.task_lifecycle_revision === endedProduction.lifecycleRevision);
    for (;;) {
      if (supervisionStopped(signal)) throw new MahCarrierError("mah_supervision_stopped", "服务正在关闭，任务将在重启后继续查询。");
      let current = this.current(mapping);
      if (current.cancelRequestedAt || signal?.aborted || current.status === "cancel_requested") {
        await this.cancelMapping(current); throw new MahCarrierError("cancelled", "行程生成已取消，晚到结果将被拒绝。");
      }
      let observation: Observation | undefined;
      try { observation = await this.observe(current, signal); }
      catch (error) {
        if (supervisionStopped(signal)) throw new MahCarrierError("mah_supervision_stopped", "服务正在关闭，原任务身份已保留。");
        if (initialUpdateLagIdentity && error instanceof MahCarrierError
          && ["mah_task_project_mismatch", "mah_task_projection_invalid", "mah_task_status_invalid"].includes(error.code)) throw error;
      }
      if (observation) {
        if (!observation.materialized && observation.schedulerStatus === "running" && materializationDeadline === undefined) {
          materializationDeadline = observationStartedAt + Math.max(this.schedulerWaitMs, current.request.execution.maxRuntimeSeconds * 1000);
        }
        if (initialUpdateLagIdentity && (!observation.materialized
          || observation.task.trace_id !== initialUpdateLagIdentity.trace || observation.task.last_request_id !== initialUpdateLagIdentity.request
            || observation.task.active_request_id !== initialUpdateLagIdentity.active))
          throw new MahCarrierError("mah_task_lifecycle_conflict", "等待初始时间投影期间执行身份发生变化，原任务保持不变。");
        const lifecycleReady = this.persistObservation(current, observation);
        if (lifecycleReady && ["running", "completed"].includes(observation.status) && this.current(mapping).runningAt) initialUpdateLagIdentity = undefined;
        if (!lifecycleReady && this.current(mapping).errorCode === "mah_initial_running_update_lag")
          initialUpdateLagIdentity ??= { trace: observation.task.trace_id, request: observation.task.last_request_id, active: observation.task.active_request_id };
        current = this.current(mapping);
        if (current.cancelRequestedAt) continue;
        if (!lifecycleReady) {
          initialLifecycleDeadline ??= Date.now() + this.schedulerWaitMs;
          if (Date.now() >= initialLifecycleDeadline) throw new MahCarrierError("mah_task_lifecycle_unverified", "运行起点尚未公开核实，保留原任务供恢复。");
          await delay(this.pollIntervalMs, signal);
          continue;
        }
        if (observation.status === "completed") return observation;
        if (observation.status === "cancelled") throw new MahCarrierError("cancelled", "生成任务已取消。");
        if (observation.status === "failed") throw new MahCarrierError("mah_task_failed", "生成任务明确失败，现有检查点已保留。");
      }
      if (closingDeadline !== undefined) {
        if (!sameClosingIdentity(observation)) throw new MahCarrierError("mah_execution_clock_unverified", "关闭期间的任务身份未核实，保留原任务供恢复。");
        if (Date.now() >= closingDeadline) throw new MahCarrierError(
          endedProduction && Date.now() >= endedProduction.endedAt + ADAPTIVE_ACCEPTANCE_WAIT_MS ? "mah_acceptance_wait_timed_out" : "mah_execution_clock_unverified",
          "任务关闭状态尚未公开收敛，保留原任务供恢复。");
        await delay(this.pollIntervalMs, signal);
        continue;
      }
      const budgetMs = current.request.execution.maxRuntimeSeconds * 1_000;
      const checkedAt = Date.now();
      let executionExpired = Boolean(current.runningAt && checkedAt >= Date.parse(current.runningAt) + budgetMs);
      if (executionExpired) {
        if (!observation || (observation.task.orchestration_topology !== "direct"
          && observation.task.orchestration_topology !== "adaptive")) throw new MahCarrierError("mah_execution_clock_unverified", "暂时无法核对生产计时，保留原任务供恢复。");
        if (observation.task.orchestration_topology === "adaptive" && current.request.execution.adaptiveProducerClockV1) {
          const read: MahPublicRead = async (args, readSignal) => {
            const response = await this.invoke(args, 30_000, readSignal);
            return response.timedOut || response.aborted ? { code: -1, stdout: "" } : response;
          };
          const clock = await readAdaptiveProductionClock(read, observation.task, current.projectRoot, signal);
          if (supervisionStopped(signal)) throw new MahCarrierError("mah_supervision_stopped", "服务正在关闭，原任务身份已保留。");
          if (!clock) {
            // Task replay can close before task show publishes its terminal row.
            // Refresh the same public identity before treating that gap as failure.
            const latest = await this.observe(current, signal);
            this.persistObservation(current, latest);
            if (latest.status === "completed") return latest;
            if (latest.status === "failed") throw new MahCarrierError("mah_task_failed", "生成任务明确失败，现有检查点已保留。");
            if (latest.status === "cancelled") throw new MahCarrierError("cancelled", "生成任务已取消。");
            if (!sameClosingIdentity(observation) || !sameClosingIdentity(latest) || !endedProduction) {
              throw new MahCarrierError("mah_execution_clock_unverified", "无法确认实际生产步骤，保留原任务供恢复。");
            }
            const acceptanceDeadline = endedProduction.endedAt + ADAPTIVE_ACCEPTANCE_WAIT_MS;
            if (Date.now() >= acceptanceDeadline) throw new MahCarrierError("mah_acceptance_wait_timed_out", "验收等待时限已到，保留原任务供恢复。");
            closingDeadline = Math.min(Date.now() + this.schedulerWaitMs, acceptanceDeadline);
            await delay(this.pollIntervalMs, signal);
            continue;
          }
          if (clock.endedAt !== undefined) endedProduction = { endedAt: clock.endedAt,
            traceId: observation.task.trace_id, requestId: observation.task.active_request_id,
            lifecycleRevision: observation.task.task_lifecycle_revision };
          if (clock.endedAt !== undefined && clock.endedAt - clock.startedAt > budgetMs)
            throw new MahCarrierError("mah_task_timed_out", "生产步骤超过业务执行时限，候选结果未导入。");
          if (clock.endedAt !== undefined && checkedAt - clock.endedAt >= ADAPTIVE_ACCEPTANCE_WAIT_MS)
            throw new MahCarrierError("mah_acceptance_wait_timed_out", "验收仍未结束，保留原任务供恢复。");
          executionExpired = clock.endedAt === undefined && checkedAt - clock.startedAt >= budgetMs;
          if (executionExpired) {
            // A new observation may show that production ended while replay was loading.
            const latest = await this.observe(current, signal);
            if (latest.status !== "running") continue;
            if (latest.task.orchestration_topology !== "adaptive")
              throw new MahCarrierError("mah_execution_clock_unverified", "任务执行方式已变化，保留原任务供恢复。");
            const confirmed = await readAdaptiveProductionClock(read, latest.task, current.projectRoot, signal);
            if (signal?.aborted) continue;
            if (!confirmed || confirmed.attemptId !== clock.attemptId || confirmed.startedAt !== clock.startedAt)
              throw new MahCarrierError("mah_execution_clock_unverified", "生产执行身份已变化，保留原任务供恢复。");
            if (confirmed.endedAt !== undefined) continue;
          }
        }
      }
      if (executionExpired) {
        // 先提交取消闩锁，再执行远端取消；读取失败不得清除此事实。
        this.options.store.updateStatus(mapping.carrierTaskId, "cancel_requested", { code: "mah_task_timed_out", message: "生成执行超过阶段时限。" });
        await this.cancelMapping(this.current(mapping));
        throw new MahCarrierError("mah_task_timed_out", "生成执行超过阶段时限，已保存取消意图。");
      }
      if (!current.runningAt && Date.now() >= (materializationDeadline ?? waitingDeadline)) throw new MahCarrierError("mah_queue_wait_timed_out", "等待生成任务超时，原任务身份已保留，稍后可继续查询。");
      await delay(this.pollIntervalMs, signal);
    }
  }
  private persistObservation(mapping: MahCarrierMapping, observation: Observation): boolean {
    if (!observation.materialized) {
      const current = this.current(mapping);
      if (!current.runningAt && ["submission_unknown", "queued", "scheduler_unavailable"].includes(current.status)) {
        this.options.store.updateStatus(mapping.carrierTaskId, "queued");
      }
      return true;
    }
    if (observation.status === "running" && !this.current(mapping).runningAt) {
      const observability = observation.task.observability;
      const lifecycle = isRecord(observability) ? observability.lifecycle : undefined;
      if ((observability != null && !isRecord(observability)) || (lifecycle != null && !isRecord(lifecycle))) {
        throw new MahCarrierError("mah_task_lifecycle_unverified", "运行起点投影损坏，保留原任务供恢复。");
      }
      const fields = [observation.task.created_at, isRecord(lifecycle) ? lifecycle.running_at : undefined, observation.task.updated_at];
      if (fields.every(value => typeof value === "string")) {
        const [created, running, updated] = fields.map(value => Date.parse(String(value))) as [number, number, number];
        if ([created, running, updated].every(value => Number.isFinite(value) && value <= Date.now())
          && created <= updated && updated < running) {
          const optionalTimes = isRecord(lifecycle) ? [lifecycle.created_at, lifecycle.first_event_at].filter(value => value != null) : [];
          if (optionalTimes.some(value => typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now()
            || Date.parse(value) < created)
            || (isRecord(lifecycle) && typeof lifecycle.created_at === "string" && Date.parse(lifecycle.created_at) > running)
            || (isRecord(lifecycle) && typeof lifecycle.first_event_at === "string" && Date.parse(lifecycle.first_event_at) < running))
            throw new MahCarrierError("mah_task_lifecycle_unverified", "运行起点的关联时间发生矛盾，原任务保持不变。");
          // A complete initial projection can publish running_at before the root
          // updated_at catches up. Record only the rejected projection, never a
          // clock or execution status; the existing fixed window rereads show.
          const detail = JSON.stringify({ reason: "initial_running_update_lag", taskId: mapping.carrierTaskId,
            revision: observation.task.task_lifecycle_revision ?? null, traceId: observation.task.trace_id ?? null,
            requestId: observation.task.last_request_id ?? null, activeRequestId: observation.task.active_request_id ?? null,
            createdAt: fields[0], runningAt: fields[1], updatedAt: fields[2],
            lifecycleCreatedAt: isRecord(lifecycle) ? lifecycle.created_at ?? null : null,
            firstEventAt: isRecord(lifecycle) ? lifecycle.first_event_at ?? null : null });
          const current = this.current(mapping);
          if (current.errorCode !== "mah_initial_running_update_lag" || current.errorMessage !== detail)
            this.options.store.updateStatus(mapping.carrierTaskId, current.status, { code: "mah_initial_running_update_lag", message: detail });
          return false;
        }
      }
      if (fields.some(value => value == null)) {
        const times = fields.map(value => value == null ? undefined : typeof value === "string" ? Date.parse(value) : NaN);
        const [created, running, updated] = times;
        if (times.some(value => value !== undefined && (!Number.isFinite(value) || value > Date.now()))
          || (created !== undefined && running !== undefined && created > running)
          || (running !== undefined && updated !== undefined && running > updated)
          || (created !== undefined && updated !== undefined && created > updated)) {
          throw new MahCarrierError("mah_task_lifecycle_unverified", "运行起点时间发生矛盾，保留原任务供恢复。");
        }
        return false;
      }
    }
    if (observation.status === "running" || observation.status === "completed") {
      const lifecycle = isRecord(observation.task.observability) && isRecord(observation.task.observability.lifecycle) ? observation.task.observability.lifecycle : undefined;
      if (!lifecycle || typeof lifecycle.running_at !== "string" || !Number.isFinite(Date.parse(lifecycle.running_at))
        || typeof observation.task.created_at !== "string" || !Number.isFinite(Date.parse(observation.task.created_at))
        || typeof observation.task.updated_at !== "string" || !Number.isFinite(Date.parse(observation.task.updated_at))
        || Date.parse(observation.task.created_at) > Date.parse(lifecycle.running_at)
        || Date.parse(lifecycle.running_at) > Date.parse(observation.task.updated_at)
        || Date.parse(lifecycle.running_at) > Date.now())
        throw new MahCarrierError("mah_task_lifecycle_unverified", "生成任务缺少可核验的执行起点。");
      const persisted = this.current(mapping);
      const observedAt = Date.parse(lifecycle.running_at);
      const budgetStart = Date.parse(persisted.runningAt ?? "");
      if (persisted.runningAt && budgetStart !== observedAt) {
        // MAH can replace the preliminary running status timestamp with the first
        // run event. Require that exact public corroboration, not a drift window.
        if (Date.parse(observation.task.created_at) > budgetStart || budgetStart >= observedAt
          || typeof lifecycle.first_event_at !== "string" || Date.parse(lifecycle.first_event_at) !== observedAt)
          throw new MahCarrierError("mah_task_lifecycle_conflict", "公开执行起点与持久化事实发生冲突，未重置阶段时限。");
      }
      if (!persisted.runningAt) this.options.store.recordRunningAt(mapping.carrierTaskId, lifecycle.running_at);
    }
    if (observation.status === "failed" && mapping.operation === "planned_place_image_enrichment") {
      const current = this.current(mapping);
      // An invalid or cancelled artifact cannot become retryable through a late failure.
      if (["artifact_invalid", "artifact_changed", "cancel_requested", "cancelled", "imported"].includes(current.status) || current.cancelRequestedAt) return true;
      const task = observation.task;
      const life = isRecord(task.observability) && isRecord(task.observability.lifecycle) ? task.observability.lifecycle : undefined;
      const failedAt = life?.failed_at;
      const requestAttachments = Array.isArray(task.attachments) ? task.attachments.filter(attachment => isRecord(attachment)
        && attachment.sha256 === mapping.requestSha256) : [];
      const validTime = typeof failedAt === "string" && Number.isFinite(Date.parse(failedAt)) && Date.parse(failedAt) <= Date.now();
      const orderedTimes = validTime && [task.created_at, task.updated_at].every(value => value === undefined || typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now())
        && (task.created_at === undefined || Date.parse(String(task.created_at)) <= Date.parse(String(failedAt)))
        && (task.updated_at === undefined || Date.parse(String(failedAt)) <= Date.parse(String(task.updated_at)));
      if (life?.last_status === "failed" && Number.isSafeInteger(task.task_lifecycle_revision) && Number(task.task_lifecycle_revision) >= 0
        && requestAttachments.length === 1 && isRecord(requestAttachments[0]) && requestAttachments[0].size === mapping.requestByteLength
        && requestAttachments[0].read_state === "present" && orderedTimes) {
        this.options.store.updateStatus(mapping.carrierTaskId, "failed", { code: "mah_public_task_failed", message: canonicalJson({
          version: 1, carrierTaskId: mapping.carrierTaskId, projectRoot: mapping.projectRoot, requestSha256: mapping.requestSha256,
          taskLifecycleRevision: task.task_lifecycle_revision, failedAt
        }) });
        return true;
      }
    }
    if (["queued", "running", "completed", "failed", "cancelled"].includes(observation.status))
      this.options.store.updateStatus(mapping.carrierTaskId, observation.status as "queued" | "running" | "completed" | "failed" | "cancelled");
    return true;
  }
  private async validateCompletedArtifact(mapping: MahCarrierMapping, terminal: Observation, signal?: AbortSignal): Promise<{ mapping: MahCarrierMapping; result: MahStageResult }> {
    let snapshot = terminal;
    for (let attempt = 0; ; attempt++) {
      try { return await this.validateCompletedArtifactSnapshot(mapping, snapshot, signal); }
      catch (error) {
        const changedDuringRead = error instanceof MahBusinessContractError && error.code === "mah_business_task_changed_during_read";
        if ((!changedDuringRead && !(error instanceof MahCompletedVersionChanged)) || attempt >= 2) throw error;
        const current = this.current(mapping);
        if (current.cancelRequestedAt || ["cancel_requested", "cancelled"].includes(current.status)) throw new MahCarrierError("cancelled", "取消后的结果不会导入。");
        if (supervisionStopped(signal)) throw new MahCarrierError("mah_supervision_stopped", "服务正在关闭，原任务身份已保留。");
        signal?.throwIfAborted();
        const latest = await this.observe(current, signal);
        const refreshed = this.current(mapping);
        if (refreshed.cancelRequestedAt || ["cancel_requested", "cancelled"].includes(refreshed.status)) throw new MahCarrierError("cancelled", "取消后的结果不会导入。");
        const before = snapshot.task.task_lifecycle_revision, after = latest.task.task_lifecycle_revision;
        if (!latest.materialized || latest.status !== "completed" || !Number.isSafeInteger(before) || !Number.isSafeInteger(after)
          || Number(before) < 0 || Number(after) <= Number(before)
          || ["trace_id", "last_request_id"].some(key => snapshot.task[key] !== undefined && latest.task[key] !== snapshot.task[key])) throw error;
        // Discard every byte and witness from the failed snapshot. Admission,
        // project, clock and result validation run again for this same Task.
        this.persistObservation(refreshed, latest);
        snapshot = latest;
      }
    }
  }
  private async validateCompletedArtifactSnapshot(mapping: MahCarrierMapping, terminal: Observation, signal?: AbortSignal): Promise<{ mapping: MahCarrierMapping; result: MahStageResult }> {
    const current = this.current(mapping);
    this.assertMapping(current);
    if (!terminal.materialized || terminal.status !== "completed") throw new MahCarrierError("mah_task_projection_invalid", "任务尚未物化，不能读取或接受生成工件。");
    if (current.cancelRequestedAt || ["cancel_requested", "cancelled"].includes(current.status)) throw new MahCarrierError("cancelled", "取消后的结果不会导入。");
    const read: MahPublicRead = async (args, readSignal) => {
      const response = await this.invoke(args, 30_000, readSignal);
      if (supervisionStopped(readSignal)) throw new MahCarrierError("mah_supervision_stopped", "服务正在关闭，工件将在重启后复核。");
      if (response.aborted || response.timedOut) throw new MahCarrierError("mah_public_read_incomplete", "公开工件读取未完整完成，候选未导入。");
      if (current.resultSha256 && response.code === 0 && args[1] === "context" && args[5] === "--read" && args[6] === MAH_STAGE_RESULT_SUBPATH) {
        let body: unknown;
        try { body = JSON.parse(response.stdout); } catch { /* The reader reports malformed public JSON. */ }
        if (isRecord(body) && body.ok !== false && typeof body.content === "string" && sha256(body.content) !== current.resultSha256) {
          this.options.store.updateStatus(current.carrierTaskId, "artifact_changed");
          throw new MahCarrierError("mah_artifact_changed", "同一任务的结果字节已变化，原结果已保留。");
        }
      }
      return response;
    };
    const reader = new MahBusinessPublicResultReader(current.projectRoot, read, MAH_STAGE_RESULT_SUBPATH);
    const candidate = await reader.readCandidate(current.carrierTaskId, signal);
    if (current.resultSha256 && current.resultSha256 !== candidate.artifactSha256) {
      this.options.store.updateStatus(current.carrierTaskId, "artifact_changed");
      throw new MahCarrierError("mah_artifact_changed", "同一任务的结果字节已变化，原结果已保留。");
    }
    if (terminal.task.task_lifecycle_revision !== candidate.lifecycleRevision) {
      if (Number.isSafeInteger(terminal.task.task_lifecycle_revision) && Number(terminal.task.task_lifecycle_revision) >= 0
        && candidate.lifecycleRevision > Number(terminal.task.task_lifecycle_revision)) {
        throw new MahCompletedVersionChanged();
      }
      throw new MahCarrierError("mah_task_lifecycle_conflict", "公开任务完成版本发生冲突，未接受结果。");
    }
    const witness = await createMahPublicReceiptVerifier(current.projectRoot, MAH_STAGE_RESULT_SUBPATH, read)(current.requestJson, candidate, signal);
    const terminalLifecycle = isRecord(terminal.task.observability) && isRecord(terminal.task.observability.lifecycle)
      ? terminal.task.observability.lifecycle : undefined;
    if (terminalLifecycle?.running_at !== witness.startedAt)
      throw new MahCarrierError("mah_task_lifecycle_conflict", "工件验收期间公开完成版本或执行起点发生变化。");
    const budgetStart = Date.parse(current.runningAt ?? "");
    if (!Number.isFinite(budgetStart))
      throw new MahCarrierError("mah_task_lifecycle_unverified", "缺少持久计时起点，未导入结果。");
    // The root interval still proves Task lifecycle and artifact finality. For
    // Adaptive results count the verified production intervals.
    const execution = witness.execution;
    const executionMs = execution
      ? execution.runtimeMs ?? Date.parse(execution.completedAt) - Date.parse(execution.startedAt)
      : Date.parse(witness.completedAt) - Math.min(budgetStart, Date.parse(witness.startedAt));
    if (!Number.isFinite(executionMs) || executionMs < 0)
      throw new MahCarrierError("mah_task_lifecycle_unverified", "无法核对业务执行用时，未导入结果。");
    if (executionMs > current.request.execution.maxRuntimeSeconds * 1_000) {
      if (execution) throw new MahCarrierError("mah_task_timed_out", "已验收的生产步骤超过业务执行时限，候选结果未导入。");
      this.options.store.updateStatus(current.carrierTaskId, "cancel_requested", { code: "mah_task_timed_out", message: "公开执行时间超过阶段时限。" });
      await this.cancelMapping(this.current(mapping));
      throw new MahCarrierError("mah_task_timed_out", "任务实际执行超过阶段时限，候选结果未导入。");
    }
    const checked = parseAndValidateMahStageResult(candidate.raw, current.request);
    const p = checked.result.provenance;
    if (p.agentId !== witness.agentId || p.modelId !== witness.modelId
      || Date.parse(p.startedAt) < Date.parse(witness.startedAt) || Date.parse(p.startedAt) > Date.parse(p.completedAt)
      || Date.parse(p.completedAt) > Date.parse(witness.completedAt))
      throw new MahCarrierError("mah_provider_route_unverified", "结果自述与公开执行来源不一致，已拒绝导入。");
    const stored = this.options.store.recordValidated({ carrierTaskId: current.carrierTaskId, resultJson: candidate.raw,
      resultSha256: candidate.artifactSha256, validatedStatus: "validated", importedStatus: "imported", changedStatus: "artifact_changed",
      cancelledStatuses: ["cancel_requested", "cancelled"] });
    return { mapping: stored as MahCarrierMapping, result: checked.result };
  }
  private async cancelMapping(mapping: MahCarrierMapping): Promise<void> {
    const active = this.cancellations.get(mapping.carrierTaskId); if (active) return active;
    const pending = this.convergeCancellation(mapping).finally(() => this.cancellations.delete(mapping.carrierTaskId));
    this.cancellations.set(mapping.carrierTaskId, pending); return pending;
  }
  private async convergeCancellation(mapping: MahCarrierMapping): Promise<void> {
    this.assertMapping(mapping);
    const current = this.current(mapping);
    if (["imported", "cancelled"].includes(current.status)) return;
    this.options.store.updateStatus(current.carrierTaskId, "cancel_requested");
    try { await this.invoke(["task", "cancel", current.carrierTaskId, "--cwd", current.projectRoot, "--format", "json"], 30_000); } catch { /* 取消意图仍已持久化。 */ }
    const deadline = Date.now() + this.cancelWaitMs;
    do {
      try {
        const observed = await this.observe(current);
        if (["cancelled", "completed", "failed"].includes(observed.status)) {
          this.options.store.updateStatus(current.carrierTaskId, "cancelled"); return;
        }
      } catch { /* 不确定态不得清掉取消闩锁。 */ }
      await delay(this.pollIntervalMs);
    } while (Date.now() <= deadline);
    throw new MahCarrierError("mah_cancel_unconfirmed", "取消尚未公开确认，原任务及取消意图已保留。");
  }
  private async observe(mapping: MahCarrierMapping, signal?: AbortSignal): Promise<Observation> {
    const response = await this.invoke(["task", "show", mapping.carrierTaskId, "--cwd", mapping.projectRoot, "--format", "json"], 30_000, signal);
    if (response.code !== 0 || response.timedOut || response.aborted) throw new MahCarrierError("mah_task_unavailable", "暂时无法读取原生成任务。");
    let value: unknown; try { value = JSON.parse(response.stdout); } catch { throw new MahCarrierError("mah_task_projection_invalid", "生成任务公开数据无效。"); }
    if (!isRecord(value) || value.ok !== true || !isRecord(value.task) || value.task.task_id !== mapping.carrierTaskId
      || (value.schema_version !== undefined && value.schema_version !== 1)) throw new MahCarrierError("mah_task_projection_invalid", "生成任务公开身份或版本无效。");
    const task = value.task;
    const scheduled = isRecord(value.scheduled_task) ? value.scheduled_task : undefined;
    const roots = [value.project_root, task.project_root, task.root_dir,
      ...(isRecord(task.project) ? [task.project.root_dir] : []),
      ...(scheduled ? [scheduled.project_root, scheduled.root_dir] : [])].filter(x => x !== undefined);
    if (roots.some(root => root !== mapping.projectRoot)) throw new MahCarrierError("mah_task_project_mismatch", "生成任务公开项目身份不一致。");
    if (value.task_record_materialized === false) {
      const status = task.status === "active" ? "running" : task.status === "waiting" ? "queued" : task.status;
      if (!scheduled || scheduled.task_id !== mapping.carrierTaskId
        || !["queued", "running", "pending", "deferred", "awaiting_admission"].includes(String(status))) {
        throw new MahCarrierError("mah_task_projection_invalid", "生成任务的调度投影身份或等待状态无效。");
      }
      return { task, status: "queued", materialized: false, schedulerStatus: status === "running" ? "running" : "queued" };
    }
    if (!roots.length) throw new MahCarrierError("mah_task_project_mismatch", "生成任务公开项目身份不一致。");
    const status = task.status === "active" ? "running" : task.status === "waiting" ? "queued" : task.status;
    if (typeof status !== "string" || !["queued", "running", "completed", "failed", "cancelled"].includes(status)) throw new MahCarrierError("mah_task_status_invalid", "生成任务公开状态无效。");
    return { task, status, materialized: true };
  }
  private async invoke(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<MahCommandResult> {
    const binding = resolveMahCliBinding(this.environment);
    return this.run(binding.command, args, { cwd: this.projectRoot(), env: binding.environment, timeoutMs, ...(signal ? { signal } : {}) });
  }
  private projectRoot(): string {
    this.canonicalProjectRoot ??= typeof this.options.mahProjectRoot === "function" ? this.options.mahProjectRoot() : this.options.mahProjectRoot;
    if (!isAbsolute(this.canonicalProjectRoot) || normalize(this.canonicalProjectRoot) !== this.canonicalProjectRoot || this.canonicalProjectRoot.includes("\0")) throw new MahCarrierError("mah_project_invalid", "生成项目根无效。");
    return this.canonicalProjectRoot;
  }
}
function title(mapping: MahCarrierMapping): string { return `Landi 有界生成：${mapping.operation}`; }
function inspectSubmitReceipt(response: MahCommandResult, mapping: MahCarrierMapping): Record<string, unknown> | undefined {
  return inspectMahSubmitReceipt(response, { taskId: mapping.carrierTaskId, projectRoot: mapping.projectRoot, title: title(mapping) });
}

function taskDescription(mapping: MahCarrierMapping, schemaSha256: string, validatorSha256: string): string {
  const clock = mapping.request.execution.adaptiveProducerClockV1;
  const node = clock?.validatorNodePath;
  const adaptiveCommand = node && adaptiveValidatorInvocation(
    mapping.projectRoot, mapping.carrierTaskId, node, schemaSha256, mapping.requestSha256, validatorSha256,
  )?.command;
  const usesWorktree = clock?.artifactValidation === "worktree_then_published_v1";
  const productionCommand = usesWorktree && node && adaptiveValidatorInvocation(
    mapping.projectRoot, mapping.carrierTaskId, node, schemaSha256, mapping.requestSha256, validatorSha256, "worktree",
  )?.command;
  if (node && (!adaptiveCommand || (usesWorktree && !productionCommand))) throw new MahCarrierError("mah_request_invalid", "无法构造可核验的 Adaptive 校验命令。");
  return [
    ...(mapping.operation === "planned_place_image_enrichment" ? ["此阶段只补地点照片：先精确读取请求中的 prompt、outputSchema 与外层关联字段。校验器附件直接以 SHA-256 核对后执行，不必逐行通读或搜索其完整实现；生产与独立验收仍须实际运行规范命令并保留原生输出。"] : []),
    "执行 Landi 有界阶段。按 landi-stage-request.json 中 input.businessInput.prompt 生成 payload，以 input.businessInput.outputSchema 校验 payload。",
    `完整结果必须符合附件 ${RESULT_SCHEMA}，SHA-256 为 ${schemaSha256}。严格从请求复制所有身份、阶段、父检查点及输入摘要，requestSha256 使用附件实际字节的摘要 ${mapping.requestSha256}。Direct 的 provenance 使用公开 task show 的实际 Agent 和模型，开始及完成时间记录本阶段工作区间。`,
    `只在当前 Task 的 ${MAH_STAGE_RESULT_SUBPATH} 写入一个结果 JSON。不得修改仓库源码、数据库或其它 Task。不得联网安装校验依赖。`,
    `Direct 写完后，在确认本机 Node 的可执行身份并核对校验器附件 ${RESULT_VALIDATOR} 的 SHA-256 为 ${validatorSha256} 后，运行：node --input-type=commonjs - "<结果 Schema 附件路径>" "<请求附件路径>" "<规范工件路径>" < "<校验器附件路径>"。校验器检查整个外层、payload 和冻结请求关联，退出 0 且输出 valid:true 后才提交。若失败，只在本 Task 内修正工件再校验。`,
    ...(adaptiveCommand ? ["Adaptive 的生产者和独立验收者使用公开 task replay 的 orchestration.task_state 核对 synthesize 的 Attempt。provenance 使用该生产 Attempt 的 executor_agent_id、resolved_model_id，时间落在其生产区间内。不得使用根任务 Planner 的身份。验收以已完成的生产 Attempt 为准，根任务最终状态由 Landi 在 MAH 收尾后核对。"] : []),
    ...(productionCommand ? [`Adaptive 生产者在 MAH 分派的工作区仓库根目录写入相对工件路径，原样执行此命令并保留原生工具事件与输出。MAH 在生产 Attempt 结束后发布工件：${productionCommand}`] : []),
    ...(!usesWorktree && adaptiveCommand ? [`Adaptive 生产者和独立验收者原样执行：${adaptiveCommand}`] : []),
    ...(usesWorktree && adaptiveCommand ? [`Adaptive 独立验收者在发布后原样执行此命令并保留原生工具事件与输出。两次校验输出的 Schema、请求和工件摘要必须一致：${adaptiveCommand}`] : []),
    "独立验收者只读执行复核，证据由 MAH 原生工具事件留痕，不创建临时文件或报告。",
    "独立验收者须对最终工件再次运行同一附件校验器，核对真实退出码与输出的 Schema、请求和工件摘要，确认前后工件字节相同。保留两次命令的原始输出。若校验缺失或不通过，不得接受交付。",
  ].join("\n");
}
async function runCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal }): Promise<MahCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], ...(options.signal ? { signal: options.signal } : {}) });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, options.timeoutMs);
    const stdoutLimit = args[1] === "replay" ? 32 * 1024 * 1024 : MAH_STAGE_MAX_RESULT_BYTES;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (stdout.length <= stdoutLimit) stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length <= 64_000) stderr += chunk.toString("utf8"); });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, aborted: error.name === "AbortError", timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, ...(options.signal?.aborted === undefined ? {} : { aborted: options.signal.aborted }), timedOut });
    });
  });
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : fallback;
}

function supervisionStopped(signal?: AbortSignal): boolean {
  return signal?.aborted === true && signal.reason === MAH_SUPERVISION_STOP_REASON;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (supervisionStopped(signal)) return reject(new MahCarrierError("mah_supervision_stopped", "服务正在关闭；MAH 操作保留待恢复。"));
    if (signal?.aborted) return reject(new MahCarrierError("cancelled", "MAH 操作已取消。"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new MahCarrierError(supervisionStopped(signal) ? "mah_supervision_stopped" : "cancelled", supervisionStopped(signal) ? "服务正在关闭；MAH 操作保留待恢复。" : "MAH 操作已取消。"));
    }, { once: true });
  });
}
