import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export interface EmailSettings {
  recipient: string;
  verified: boolean;
  enabled: boolean;
  revision: number;
  cityTimeZones: Record<string,string>;
}
export interface EmailReviewScope {
  basePlanId:string;baseVersion:number;draftPlanId:string;draftVersion:number;blueprintVersion?:number;recipientRevision:number;
}
export interface EmailDeliveryContent {
  subject:string;html:string;text:string;
  authorizationDigest?:string;
  adjustment?:{requestId:string;intentId:string;timingId:string};
  attachments?:import("@c-assistant/core").EmailInlineAttachment[];
  research?:{images?:Array<{targetId:string;url:string;alt:string;sourceUrl:string;rationale:string;status?:"available"|"recheck"}>;status:"generated"|"saved_facts";sources:Array<{title:string;url:string;checkedAt:string}>;notes:Array<{targetId:string;text:string;sourceUrls:string[];rationale:string}>};
  review?:EmailReviewScope;
}
export interface EmailJob {
  id:string;planId:string;planVersion:number;kind:"morning"|"transfer"|"dining"|"change";
  activityId?:string;date:string;dueAt:string;expiresAt:string;
  status:"pending"|"sending"|"accepted"|"retry"|"uncertain"|"failed"|"cancelled";
  attempts:number;retryAt:string;lease?:string;content?:EmailDeliveryContent;recipientRevision:number;failureCode?:string;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export interface EmailPlanConfirmation {planId:string;version:number;basePlanId:string;baseVersion:number;confirmedAt:string}
export const EMAIL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS email_settings (id INTEGER PRIMARY KEY CHECK(id=1), recipient TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, city_time_zones_json TEXT NOT NULL DEFAULT '{}', verification_hash TEXT, verification_expires TEXT, verification_attempts INTEGER NOT NULL DEFAULT 0, verification_state TEXT NOT NULL DEFAULT 'none', legacy_plan_id TEXT, legacy_plan_version INTEGER, legacy_until TEXT);
INSERT OR IGNORE INTO email_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS email_outbox (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, plan_version INTEGER NOT NULL, kind TEXT NOT NULL, activity_id TEXT, local_date TEXT NOT NULL, due_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT NOT NULL, lease TEXT, lease_expires TEXT, recipient_revision INTEGER NOT NULL, content_json TEXT, failure_code TEXT);
CREATE INDEX IF NOT EXISTS email_outbox_due ON email_outbox(status,retry_at,due_at);
CREATE TABLE IF NOT EXISTS email_plan_confirmations (plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, plan_version INTEGER NOT NULL, base_plan_id TEXT NOT NULL, base_version INTEGER NOT NULL, confirmed_at TEXT NOT NULL, PRIMARY KEY(plan_id,plan_version));
CREATE TABLE IF NOT EXISTS email_timing (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, plan_version INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT NOT NULL, lease TEXT, lease_expires TEXT, result_json TEXT);
CREATE TABLE IF NOT EXISTS email_attention_state (plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, plan_version INTEGER NOT NULL, attention_key TEXT NOT NULL, fingerprint TEXT, episode INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(plan_id,plan_version,attention_key));
`;
export const EMAIL_TIMING_SCOPE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS email_timing_current (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, plan_version INTEGER NOT NULL,
  timing_id TEXT NOT NULL REFERENCES email_timing(id), PRIMARY KEY(plan_id,plan_version)
);`;
export const EMAIL_TIMING_SCOPE_MIGRATION_NAME='邮件安排持久接管关联';
type SettingsRow = { city_time_zones_json: string; recipient: string; verified: number; enabled: number; revision: number };
type JobRow = { id: string; plan_id: string; plan_version: number; kind: EmailJob["kind"]; activity_id: string | null; local_date: string; due_at: string; expires_at: string; status: EmailJob["status"]; attempts: number; retry_at: string; lease: string | null; recipient_revision: number; content_json: string | null; failure_code: string | null };
export class EmailExecutionStorage {
  constructor(private readonly db: DatabaseSync) {}
  ensureTiming(id:string,planId:string,version:number,now:string,failureCode='timing_pending'):void {
    this.db.exec('SAVEPOINT email_timing_scope');
    try {
      this.db.prepare("INSERT OR IGNORE INTO email_timing(id,plan_id,plan_version,status,retry_at,result_json) VALUES(?,?,?,'pending',?,?)").run(id,planId,version,now,JSON.stringify({failureCode}));
      const row=this.db.prepare('SELECT plan_id,plan_version FROM email_timing WHERE id=?').get(id);
      if(row?.plan_id!==planId||row.plan_version!==version)throw new Error('邮件安排身份冲突。');
      this.db.prepare('INSERT INTO email_timing_current VALUES(?,?,?) ON CONFLICT(plan_id,plan_version) DO UPDATE SET timing_id=excluded.timing_id').run(planId,version,id);
      this.db.exec('RELEASE email_timing_scope');
    }catch(error){this.db.exec('ROLLBACK TO email_timing_scope; RELEASE email_timing_scope');throw error;}
  }
  currentTiming(planId:string,version:number){
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='email_timing_current'").get())return undefined;
    const row=this.db.prepare('SELECT timing_id FROM email_timing_current WHERE plan_id=? AND plan_version=?').get(planId,version);
    if(!row)return undefined;
    const id=String(row.timing_id),record=this.timing(id);
    return record?{id,...record}:undefined;
  }
  timing(id: string): {status:string;result?:unknown;failureCode?:string} | undefined {
    const row=this.db.prepare("SELECT status,result_json FROM email_timing WHERE id=?").get(id) as {status:string;result_json:string|null}|undefined;
    const result=row?.result_json?JSON.parse(row.result_json):undefined;
    return row ? {status:row.status,...(result?{result}:{}),...(row.status!=='ready'&&result?.failureCode?{failureCode:result.failureCode}:{})} : undefined;
  }
  claimTiming(id:string,planId:string,version:number,now:string):string|undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.ensureTiming(id,planId,version,now);
      this.db.prepare("UPDATE email_timing SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END WHERE id=? AND status='planning' AND lease_expires<=?").run(id,now);
      const lease=randomUUID();
      const result=this.db.prepare("UPDATE email_timing SET status='planning',attempts=attempts+1,lease=?,lease_expires=? WHERE id=? AND status='pending' AND retry_at<=?").run(lease,new Date(Date.parse(now)+120_000).toISOString(),id,now);
      this.db.exec("COMMIT");return Number(result.changes)===1?lease:undefined;
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  saveTiming(id:string,lease:string,now:string,result:unknown):boolean {
    return Number(this.db.prepare("UPDATE email_timing SET status='ready',result_json=?,lease=NULL WHERE id=? AND status='planning' AND lease=? AND lease_expires>? AND EXISTS(SELECT 1 FROM email_timing_current WHERE timing_id=email_timing.id)").run(JSON.stringify(result),id,lease,now).changes)===1;
  }
  failTiming(id:string,lease:string,now:string,failureCode='timing_generation_failed'):void {
    this.db.prepare("UPDATE email_timing SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,retry_at=?,lease=NULL,result_json=? WHERE id=? AND status='planning' AND lease=?").run(new Date(Date.parse(now)+5*60_000).toISOString(),JSON.stringify({failureCode}),id,lease);
  }
  retryTiming(planId:string,version:number):void {
    this.db.prepare("UPDATE email_timing SET status='pending',attempts=0,retry_at=? WHERE plan_id=? AND plan_version=? AND status='failed' AND id=(SELECT timing_id FROM email_timing_current WHERE plan_id=? AND plan_version=?)").run(new Date().toISOString(),planId,version,planId,version);
  }
  timingStatus(planId:string,version:number):string {
    return this.currentTiming(planId,version)?.status ?? 'pending';
  }
  usesEmail(planId: string, version: number, now = new Date()): boolean {
    const legacy = this.db.prepare("SELECT legacy_plan_id,legacy_plan_version,legacy_until FROM email_settings WHERE id=1").get() as { legacy_plan_id: string | null; legacy_plan_version: number | null; legacy_until: string | null };
    return legacy.legacy_plan_id !== planId || legacy.legacy_plan_version !== version || !legacy.legacy_until || now.toISOString() > legacy.legacy_until;
  }
  settings(): EmailSettings {
    const s = this.db.prepare("SELECT * FROM email_settings WHERE id=1").get() as unknown as SettingsRow;
    return { recipient: s.recipient, verified: Boolean(s.verified), enabled: Boolean(s.enabled), revision: s.revision, cityTimeZones: JSON.parse(s.city_time_zones_json) as Record<string,string> };
  }
  updateSettings(input: { recipient: string; cityTimeZones?: Record<string,string> }): EmailSettings {
    const old = this.settings(); const changed = old.recipient !== input.recipient;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`UPDATE email_settings SET recipient=?,city_time_zones_json=?,verified=?,enabled=?,revision=revision+?,verification_hash=CASE WHEN ? THEN NULL ELSE verification_hash END,verification_expires=CASE WHEN ? THEN NULL ELSE verification_expires END,verification_attempts=CASE WHEN ? THEN 0 ELSE verification_attempts END,verification_state=CASE WHEN ? THEN 'none' ELSE verification_state END WHERE id=1`).run(input.recipient, JSON.stringify(input.cityTimeZones ?? old.cityTimeZones), changed ? 0 : Number(old.verified), changed ? 0 : Number(old.enabled), Number(changed),Number(changed),Number(changed),Number(changed),Number(changed));
      this.db.prepare("UPDATE email_outbox SET status='cancelled',failure_code='settings_changed' WHERE status IN ('pending','retry')").run();
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.settings();
  }
  setEnabled(enabled: boolean): EmailSettings {
    if (enabled && !this.settings().verified) throw new Error("Verify the recipient first.");
    this.db.prepare("UPDATE email_settings SET enabled=?,legacy_plan_id=CASE WHEN ?=1 THEN NULL ELSE legacy_plan_id END WHERE id=1").run(Number(enabled),Number(enabled));
    if (!enabled) this.db.prepare("UPDATE email_outbox SET status='cancelled',failure_code='email_paused' WHERE status IN ('pending','retry')").run();
    return this.settings();
  }
  beginVerification(code: string, expiresAt: string): boolean {
    const now = new Date(Date.parse(expiresAt) - 15 * 60_000).toISOString();
    const result = this.db.prepare("UPDATE email_settings SET verification_hash=?,verification_expires=?,verification_attempts=0,verification_state='sending' WHERE id=1 AND (verification_expires IS NULL OR verification_expires<=? OR verification_state='failed')").run(sha(`${this.settings().recipient}:${code}`), expiresAt, now);
    return Number(result.changes) === 1;
  }
  finishVerificationSend(revision: number, status: "accepted" | "failed" | "uncertain"): void {
    this.db.prepare("UPDATE email_settings SET verification_state=? WHERE id=1 AND revision=? AND verification_state='sending'").run(status, revision);
  }
  verifyRecipient(code: string, now: string): boolean {
    const s = this.db.prepare("SELECT * FROM email_settings WHERE id=1").get() as unknown as SettingsRow & { verification_hash: string | null; verification_expires: string | null; verification_attempts: number; verification_state: string };
    if (!s.verification_hash || !s.verification_expires || s.verification_expires < now || s.verification_attempts >= 5 || s.verification_state !== "accepted") return false;
    this.db.prepare("UPDATE email_settings SET verification_attempts=verification_attempts+1 WHERE id=1").run();
    const expected = Buffer.from(s.verification_hash, "hex"); const actual = Buffer.from(sha(`${s.recipient}:${code}`), "hex");
    if (!timingSafeEqual(expected, actual)) return false;
    this.db.prepare("UPDATE email_settings SET verified=1,verification_hash=NULL,verification_state='verified' WHERE id=1").run();
    return true;
  }
  enqueue(job: Omit<EmailJob, "status" | "attempts" | "retryAt">): void {
    this.db.prepare("INSERT OR IGNORE INTO email_outbox(id,plan_id,plan_version,kind,activity_id,local_date,due_at,expires_at,status,retry_at,recipient_revision,content_json) VALUES(?,?,?,?,?,?,?,?, 'pending',?,?,?) ON CONFLICT(id) DO UPDATE SET status='pending',due_at=excluded.due_at,expires_at=excluded.expires_at,retry_at=excluded.retry_at,content_json=COALESCE(email_outbox.content_json,excluded.content_json),failure_code=NULL WHERE email_outbox.status='cancelled' AND email_outbox.failure_code IN ('settings_changed','email_paused','review_not_configured','timing_replaced')").run(job.id, job.planId, job.planVersion, job.kind, job.activityId ?? null, job.date, job.dueAt, job.expiresAt, job.dueAt, job.recipientRevision, job.content ? JSON.stringify(job.content) : null);
  }
  list(limit = 100): EmailJob[] {
    return (this.db.prepare("SELECT * FROM email_outbox ORDER BY due_at DESC LIMIT ?").all(limit) as unknown as JobRow[]).map(row => this.job(row));
  }
  get(id:string):EmailJob|undefined {
    const row=this.db.prepare('SELECT * FROM email_outbox WHERE id=?').get(id) as unknown as JobRow|undefined;
    return row?this.job(row):undefined;
  }
  versionJobs(planId:string,version:number):EmailJob[] {
    return (this.db.prepare('SELECT * FROM email_outbox WHERE plan_id=? AND plan_version=? ORDER BY id').all(planId,version) as unknown as JobRow[]).map(row=>this.job(row));
  }
  cancelObsolete(planId: string, version: number, now: string): void {
    // An expired sending lease is ambiguous: the server could have accepted it before a crash.
    this.db.prepare("UPDATE email_outbox SET status='uncertain',failure_code='interrupted_delivery' WHERE status='sending' AND lease_expires<=?").run(now);
    this.db.prepare("UPDATE email_outbox SET status='cancelled',failure_code='obsolete_or_expired' WHERE status IN ('pending','retry') AND (plan_id<>? OR plan_version<>? OR expires_at<=?)").run(planId, version, now);
  }
  claim(planId: string, version: number, now: string): EmailJob | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM email_outbox WHERE plan_id=? AND plan_version=? AND status IN ('pending','retry') AND due_at<=? AND retry_at<=? AND expires_at>? ORDER BY CASE kind WHEN 'change' THEN 0 ELSE 1 END,due_at LIMIT 1").get(planId, version, now, now, now) as unknown as JobRow | undefined;
      if (!row) { this.db.exec("COMMIT"); return; }
      const lease = randomUUID();
      this.db.prepare("UPDATE email_outbox SET status='sending',attempts=attempts+1,lease=?,lease_expires=? WHERE id=?").run(lease, new Date(Date.parse(now) + 120_000).toISOString(), row.id);
      this.db.exec("COMMIT"); return { ...this.job(row), status: "sending", attempts: row.attempts + 1, lease };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  saveContent(id: string, lease: string, content: EmailJob["content"]): void {
    this.db.prepare("UPDATE email_outbox SET content_json=? WHERE id=? AND lease=? AND status='sending'").run(JSON.stringify(content), id, lease);
  }
  canSend(id: string, lease: string, now: string): boolean {
    return Boolean(this.db.prepare("SELECT id FROM email_outbox WHERE id=? AND lease=? AND status='sending' AND lease_expires>? AND expires_at>?").get(id, lease, now, now));
  }
  observeAttention(planId: string, version: number, key: string, fingerprint?: string): { episode: number; changed: boolean; first: boolean } {
    const old = this.db.prepare("SELECT fingerprint,episode FROM email_attention_state WHERE plan_id=? AND plan_version=? AND attention_key=?").get(planId,version,key) as {fingerprint:string|null;episode:number}|undefined;
    const changed = old?.fingerprint !== (fingerprint ?? null);
    const episode = (old?.episode ?? 0) + Number(Boolean(fingerprint) && changed);
    this.db.prepare("INSERT INTO email_attention_state(plan_id,plan_version,attention_key,fingerprint,episode) VALUES(?,?,?,?,?) ON CONFLICT(plan_id,plan_version,attention_key) DO UPDATE SET fingerprint=excluded.fingerprint,episode=excluded.episode").run(planId,version,key,fingerprint ?? null,episode);
    return {episode,changed,first:!old};
  }
  settle(id: string, lease: string, status: EmailJob["status"], retryAt: string, failureCode?: string): void {
    this.db.prepare("UPDATE email_outbox SET status=?,retry_at=?,failure_code=? WHERE id=? AND lease=? AND status='sending'").run(status, retryAt, failureCode ?? null, id, lease);
  }
  cancelPending(id: string, reason: string): void {
    this.db.prepare("UPDATE email_outbox SET status='cancelled',failure_code=? WHERE id=? AND status IN ('pending','retry')").run(reason,id);
  }
  recordPlanConfirmation(input: EmailPlanConfirmation): void {
    this.db.prepare("INSERT OR IGNORE INTO email_plan_confirmations(plan_id,plan_version,base_plan_id,base_version,confirmed_at) VALUES(?,?,?,?,?)").run(input.planId,input.version,input.basePlanId,input.baseVersion,input.confirmedAt);
  }
  planConfirmation(planId:string,version:number): EmailPlanConfirmation | undefined {
    const row=this.db.prepare("SELECT * FROM email_plan_confirmations WHERE plan_id=? AND plan_version=?").get(planId,version) as {plan_id:string;plan_version:number;base_plan_id:string;base_version:number;confirmed_at:string}|undefined;
    return row?{planId:row.plan_id,version:row.plan_version,basePlanId:row.base_plan_id,baseVersion:row.base_version,confirmedAt:row.confirmed_at}:undefined;
  }
  private job(row: JobRow): EmailJob {
    return { id: row.id, planId: row.plan_id, planVersion: row.plan_version, kind: row.kind, date: row.local_date, dueAt: row.due_at, expiresAt: row.expires_at, status: row.status, attempts: row.attempts, retryAt: row.retry_at, recipientRevision: row.recipient_revision, ...(row.activity_id ? { activityId: row.activity_id } : {}), ...(row.lease ? { lease: row.lease } : {}), ...(row.content_json ? { content: JSON.parse(row.content_json) as NonNullable<EmailJob["content"]> } : {}), ...(row.failure_code ? { failureCode: row.failure_code } : {}) };
  }
}
