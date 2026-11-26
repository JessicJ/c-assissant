import { randomUUID } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { assertMahBusinessRequest, MahBusinessContractError, type MahBusinessRequest } from './mah-business-contract.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import type { BusinessSubmission, MahBusinessSubmissionJournal } from './mah-business-gateway.js';

/** Standalone journal schema. Never installed by workspace migrations or startup. */
export const MAH_BUSINESS_JOURNAL_SCHEMA = `
CREATE TABLE mah_business_submissions (
  request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE,
  project_root TEXT NOT NULL, request_json TEXT NOT NULL, request_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','submission_unknown','submitted','result_read'))
);`;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fail(code: string): never { throw new MahBusinessContractError(code); }

/** Caller supplies an explicitly opened, private journal DB; no paths are opened here.
 * FULL/EXTRA synchronous writes and autocommit are required before external effects.
 * This records intent/readback only, never validation, import or MAH authority.
 */
export class SqliteMahBusinessSubmissionJournal implements MahBusinessSubmissionJournal {
  constructor(private readonly db: DatabaseSync) {}

  private assertDurability(): void {
    if (this.db.isTransaction) fail('mah_business_journal_transaction_open');
    const synchronous = Number(this.db.prepare('PRAGMA synchronous').get()?.synchronous);
    const mode = this.db.prepare('PRAGMA journal_mode').get()?.journal_mode;
    if (![2, 3].includes(synchronous) || !['delete', 'truncate', 'persist', 'wal'].includes(String(mode))) {
      fail('mah_business_journal_durability_unverified');
    }
  }

  private decode(row: Record<string, unknown>): BusinessSubmission {
    let request: unknown;
    try { request = JSON.parse(String(row.request_json)); } catch { fail('mah_business_journal_record_invalid'); }
    assertMahBusinessRequest(request);
    if (request.requestId !== row.request_id || canonicalJson(request) !== row.request_json
      || sha256(String(row.request_json)) !== row.request_sha256 || !UUID.test(String(row.task_id))
      || typeof row.project_root !== 'string' || !isAbsolute(row.project_root)
      || normalize(row.project_root) !== row.project_root || row.project_root.includes('\0')
      || !['prepared', 'submission_unknown', 'submitted', 'result_read'].includes(String(row.state))) {
      fail('mah_business_journal_record_invalid');
    }
    return { taskId: String(row.task_id), requestSha256: String(row.request_sha256),
      projectRoot: row.project_root, state: row.state as BusinessSubmission['state'] };
  }

  findByTaskId(taskId: string): BusinessSubmission | undefined {
    if (!UUID.test(taskId)) fail('mah_business_task_identity_invalid');
    const row = this.db.prepare('SELECT * FROM mah_business_submissions WHERE task_id=?').get(taskId);
    return row ? this.decode(row) : undefined;
  }

  async reserve(input: MahBusinessRequest, projectRoot: string, taskId?: string): Promise<BusinessSubmission> {
    const request = structuredClone(input);
    assertMahBusinessRequest(request);
    if (taskId !== undefined && !UUID.test(taskId)) fail('mah_business_task_identity_invalid');
    if (!isAbsolute(projectRoot) || normalize(projectRoot) !== projectRoot || projectRoot.includes('\0')) fail('mah_business_project_invalid');
    this.assertDurability();
    const encoded = canonicalJson(request), digest = sha256(encoded);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM mah_business_submissions WHERE request_id=?').get(request.requestId);
      let result: BusinessSubmission;
      if (old) {
        result = this.decode(old);
        if (old.request_json !== encoded || result.requestSha256 !== digest || result.projectRoot !== projectRoot
          || taskId !== undefined && result.taskId !== taskId) {
          fail('mah_business_journal_request_conflict');
        }
      } else {
        result = { taskId: taskId ?? randomUUID(), requestSha256: digest, projectRoot, state: 'prepared' };
        this.db.prepare('INSERT INTO mah_business_submissions VALUES (?,?,?,?,?,?)')
          .run(request.requestId, result.taskId, projectRoot, encoded, digest, result.state);
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  async claimSubmission(taskId: string): Promise<boolean> {
    this.assertDurability();
    return this.update(taskId, current => current.state === 'prepared' ? 'submission_unknown' : undefined);
  }

  async mark(taskId: string, state: BusinessSubmission['state']): Promise<void> {
    this.assertDurability();
    this.update(taskId, current => {
      if (current.state === state) return undefined;
      if ((state === 'submitted' && current.state === 'submission_unknown')
        || (state === 'result_read' && ['submission_unknown', 'submitted'].includes(current.state))) return state;
      return fail('mah_business_journal_transition_invalid');
    });
  }

  private update(taskId: string, next: (current: BusinessSubmission) => BusinessSubmission['state'] | undefined): boolean {
    if (!UUID.test(taskId)) fail('mah_business_task_identity_invalid');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT * FROM mah_business_submissions WHERE task_id=?').get(taskId);
      if (!row) fail('mah_business_journal_task_missing');
      const current = this.decode(row), state = next(current);
      if (state !== undefined && this.db.prepare('UPDATE mah_business_submissions SET state=? WHERE task_id=? AND state=?')
        .run(state, taskId, current.state).changes !== 1) fail('mah_business_journal_state_conflict');
      this.db.exec('COMMIT');
      return state !== undefined;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
}
