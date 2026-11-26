import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type AgentWorkScope =
  | { kind: "conversation"; sessionId: string; messageId: string; revision: number }
  | { kind: "revision"; planId: string; planVersion: number; blueprintId: string; blueprintVersion: number; revisionId: string; changesSha256: string }
  | { kind: "images"; planId: string; planVersion: number; blueprintId: string; blueprintVersion: number; targetsSha256: string }
  | { kind: "email_research"; planId: string; planVersion: number; eventId: string; targetsSha256: string; recipientRevision: number; validUntil: string }
  | { kind: "email_timing"; planId: string; planVersion: number; opportunitiesSha256: string; timeZonesSha256: string; recipientRevision: number; windowStart: string; windowEnd: string };
export type AgentWorkStatus = "prepared" | "blocked" | "submitting" | "submission_unknown" | "queued" | "running" | "completed" | "validated" | "applied" | "cancel_requested" | "cancelled" | "superseded" | "expired" | "failed";
export interface AgentWork {
  contractVersion: 1; workId: string; requestId: string; carrierTaskId: string; attempt: number;
  operation: AgentWorkScope["kind"]; scope: AgentWorkScope; inputSha256: string; requestSha256: string;
  input: unknown; status: AgentWorkStatus; result?: unknown; resultSha256?: string;
}
export class AgentWorkError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function canonicalWorkJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalWorkJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalWorkJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new AgentWorkError("invalid_json_value");
}
export const workDigest = (value: unknown) => createHash("sha256").update(canonicalWorkJson(value)).digest("hex");

const fields = {
  conversation: ["sessionId", "messageId", "revision"],
  revision: ["planId", "planVersion", "blueprintId", "blueprintVersion", "revisionId", "changesSha256"],
  images: ["planId", "planVersion", "blueprintId", "blueprintVersion", "targetsSha256"],
  email_research: ["planId", "planVersion", "eventId", "targetsSha256", "recipientRevision", "validUntil"],
  email_timing: ["planId", "planVersion", "opportunitiesSha256", "timeZonesSha256", "recipientRevision", "windowStart", "windowEnd"]
} as const;
export function assertAgentWorkScope(value: unknown): asserts value is AgentWorkScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentWorkError("invalid_work_scope");
  const scope = value as Record<string, unknown>;
  if (typeof scope.kind !== "string" || !Object.hasOwn(fields, scope.kind)) throw new AgentWorkError("invalid_work_scope");
  const keys: readonly string[] = fields[scope.kind as keyof typeof fields];
  if (Object.keys(scope).length !== keys.length + 1) throw new AgentWorkError("invalid_work_scope");
  for (const key of keys) {
    const v = scope[key];
    if (["revision", "planVersion", "blueprintVersion", "recipientRevision"].includes(key)) {
      if (!Number.isSafeInteger(v) || Number(v) < (key === "recipientRevision" ? 0 : 1)) throw new AgentWorkError("invalid_work_scope");
    } else if (typeof v !== "string" || !v.trim() || (key.endsWith("Sha256") && !/^[a-f0-9]{64}$/.test(v))) throw new AgentWorkError("invalid_work_scope");
    if (["validUntil", "windowStart", "windowEnd"].includes(key) && (typeof v !== "string" || !Number.isFinite(Date.parse(v)))) throw new AgentWorkError("invalid_work_scope");
  }
  if (scope.kind === "email_timing" && Date.parse(String(scope.windowEnd)) <= Date.parse(String(scope.windowStart))) throw new AgentWorkError("invalid_work_scope");
}

export const AGENT_WORK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_work (
 work_id TEXT PRIMARY KEY, logical_key TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
 carrier_task_id TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL, request_sha256 TEXT NOT NULL,
 status TEXT NOT NULL, result_json TEXT, result_sha256 TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_work_status ON agent_work(status);
CREATE TABLE IF NOT EXISTS planning_session_revisions (
 session_id TEXT PRIMARY KEY REFERENCES planning_sessions(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision>=0)
);
CREATE TABLE IF NOT EXISTS planning_message_receipts (
 message_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
 input_sha256 TEXT NOT NULL, expected_revision INTEGER NOT NULL, saved_revision INTEGER NOT NULL
);`;

const transitions: Record<AgentWorkStatus, readonly AgentWorkStatus[]> = {
  prepared: ["blocked", "submitting", "cancelled", "superseded", "expired"],
  blocked: ["prepared", "cancelled", "superseded", "expired"],
  submitting: ["submission_unknown", "queued", "running", "completed", "cancel_requested", "failed"],
  submission_unknown: ["queued", "running", "completed", "cancel_requested", "failed"],
  queued: ["running", "completed", "cancel_requested", "superseded", "expired", "failed"],
  running: ["completed", "cancel_requested", "superseded", "expired", "failed"],
  completed: ["validated", "cancel_requested", "superseded", "expired", "failed"],
  validated: ["applied", "cancel_requested", "superseded", "expired"],
  cancel_requested: ["cancelled"], cancelled: [], applied: [], superseded: [], expired: [], failed: []
};
export class AgentWorkStore {
  constructor(private readonly db: DatabaseSync) {}
  /** Read the existing immutable work identity without preparing a changed input. */
  findByScope(scope: AgentWorkScope): AgentWork | undefined {
    assertAgentWorkScope(scope);
    const row = this.db.prepare("SELECT work_id FROM agent_work WHERE logical_key=?")
      .get(workDigest({ scope, operation: scope.kind }));
    return row ? this.get(String(row.work_id)) : undefined;
  }
  get(workId: string): AgentWork | undefined {
    const row = this.db.prepare("SELECT * FROM agent_work WHERE work_id=?").get(workId);
    if (!row) return undefined;
    const request = JSON.parse(String(row.request_json));
    if (request.contractVersion !== 1 || workDigest(request) !== row.request_sha256) throw new AgentWorkError("work_record_invalid");
    assertAgentWorkScope(request.scope);
    const status = String(row.status) as AgentWorkStatus;
    if (!Object.hasOwn(transitions, status)) throw new AgentWorkError("work_record_invalid");
    if (request.workId !== row.work_id || request.requestId !== row.request_id || request.carrierTaskId !== row.carrier_task_id || request.operation !== request.scope.kind || request.inputSha256 !== workDigest(request.input)) throw new AgentWorkError("work_record_invalid");
    const result = row.result_json === null ? undefined : JSON.parse(String(row.result_json));
    if (result !== undefined && workDigest(result) !== row.result_sha256) throw new AgentWorkError("work_result_changed");
    return { ...request, requestSha256: String(row.request_sha256), status, ...(result !== undefined ? { result, resultSha256: String(row.result_sha256) } : {}) };
  }
  prepare(scope: AgentWorkScope, input: unknown): AgentWork {
    assertAgentWorkScope(scope);
    const logicalKey = workDigest({ scope, operation: scope.kind });
    const inputSha256 = workDigest(input);
    const old = this.db.prepare("SELECT work_id FROM agent_work WHERE logical_key=?").get(logicalKey);
    if (old) {
      const work = this.get(String(old.work_id))!;
      if (work.inputSha256 !== inputSha256) throw new AgentWorkError("work_input_conflict");
      return work;
    }
    const request = { contractVersion: 1, workId: randomUUID(), requestId: randomUUID(), carrierTaskId: randomUUID(), attempt: 1, operation: scope.kind, scope, inputSha256, input };
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO agent_work VALUES (?,?,?,?,?,?,'prepared',NULL,NULL,?,?)")
      .run(request.workId, logicalKey, request.requestId, request.carrierTaskId, canonicalWorkJson(request), workDigest(request), now, now);
    return this.get(request.workId)!;
  }
  transition(workId: string, next: AgentWorkStatus): AgentWork {
    const work = this.get(workId);
    if (!work) throw new AgentWorkError("work_not_found");
    if (next === work.status) return work;
    if (next === "validated" || next === "applied" || !transitions[work.status].includes(next)) throw new AgentWorkError("invalid_work_transition");
    this.setStatus(work, next);
    return this.get(workId)!;
  }
  validateResult(workId: string, envelope: { contractVersion: number; workId: string; requestId: string; carrierTaskId: string; inputSha256: string; scope: AgentWorkScope; payload: unknown }, validate: (payload: unknown) => void): AgentWork {
    const work = this.get(workId);
    if (!work) throw new AgentWorkError("work_not_found");
    if (envelope.contractVersion !== 1 || envelope.workId !== work.workId || envelope.requestId !== work.requestId || envelope.carrierTaskId !== work.carrierTaskId || envelope.inputSha256 !== work.inputSha256 || workDigest(envelope.scope) !== workDigest(work.scope)) throw new AgentWorkError("work_result_identity_invalid");
    if (!["completed", "validated", "applied"].includes(work.status)) throw new AgentWorkError("work_result_not_accepted");
    const digest = workDigest(envelope.payload);
    if (work.resultSha256 && work.resultSha256 !== digest) throw new AgentWorkError("work_result_changed");
    if (validate.constructor.name === "AsyncFunction") throw new AgentWorkError("async_work_validation_forbidden");
    const checked: unknown = validate(envelope.payload);
    if (checked && typeof (checked as PromiseLike<unknown>).then === "function") throw new AgentWorkError("async_work_validation_forbidden");
    if (workDigest(envelope.payload) !== digest) throw new AgentWorkError("work_validation_changed_payload");
    if (work.resultSha256) return work;
    const changed = this.db.prepare("UPDATE agent_work SET status='validated',result_json=?,result_sha256=?,updated_at=? WHERE work_id=? AND status='completed' AND result_json IS NULL")
      .run(canonicalWorkJson(envelope.payload), digest, new Date().toISOString(), workId).changes;
    if (changed !== 1) throw new AgentWorkError("work_state_conflict");
    return this.get(workId)!;
  }
  applyValidated(workId: string, isCurrent: (db: DatabaseSync, scope: AgentWorkScope) => boolean, apply: (db: DatabaseSync, payload: unknown) => void): AgentWork {
    if (isCurrent.constructor.name === "AsyncFunction" || apply.constructor.name === "AsyncFunction") throw new AgentWorkError("async_work_application_forbidden");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const work = this.get(workId);
      if (!work) throw new AgentWorkError("work_not_found");
      if (work.status !== "applied") {
        if (work.status !== "validated") throw new AgentWorkError("work_not_validated");
        const until = work.scope.kind === "email_research" ? work.scope.validUntil : work.scope.kind === "email_timing" ? work.scope.windowEnd : undefined;
        if ((until && Date.parse(until) <= Date.now()) || isCurrent(this.db, work.scope) !== true) throw new AgentWorkError("work_scope_stale");
        const returned: unknown = apply(this.db, work.result);
        if (returned && typeof (returned as PromiseLike<unknown>).then === "function") throw new AgentWorkError("async_work_application_forbidden");
        this.setStatus(work, "applied");
      }
      this.db.exec("COMMIT");
      return this.get(workId)!;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private setStatus(work: AgentWork, next: AgentWorkStatus) {
    if (this.db.prepare("UPDATE agent_work SET status=?,updated_at=? WHERE work_id=? AND status=?").run(next, new Date().toISOString(), work.workId, work.status).changes !== 1) throw new AgentWorkError("work_state_conflict");
  }
}
