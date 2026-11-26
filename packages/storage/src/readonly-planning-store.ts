import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { loadReadonlyAdmission, inspectReadonlyHistory, assertReadonlyHistoryFacts, factsSha256, bytesSha256 } from './readonly-schema-admission.js';

/** Single statement; no migrations, seed, revision backfill, or business service imports. */
export function readPlanningReturnSnapshot(database: Pick<DatabaseSync, 'prepare'>, sessionId: string) {
    const row = database.prepare(`SELECT s.id,s.status,s.proposal_json,s.output_plan_id,s.updated_at,r.revision
      FROM planning_sessions s LEFT JOIN planning_session_revisions r ON r.session_id=s.id WHERE s.id=?`).get(sessionId);
    if (!row) return null;
    const proposal = row.proposal_json == null ? null : JSON.parse(String(row.proposal_json));
    const revision = row.revision == null ? null : Number(row.revision);
    const proposalVersion = proposal == null ? null : proposal.version;
    if ((revision !== null && (!Number.isSafeInteger(revision) || revision < 0))
      || (proposalVersion !== null && (!Number.isSafeInteger(proposalVersion) || proposalVersion < 1))) throw new Error("planning_return_snapshot_invalid");
    return { sessionId: String(row.id), revision, revisionSource: revision === null ? "missing" as const : "recorded" as const,
      proposalVersion: proposalVersion as number | null, status: String(row.status),
      outputPlanId: row.output_plan_id == null ? null : String(row.output_plan_id), updatedAt: String(row.updated_at) };
}

/** Only for an explicit, consistent standalone diagnostic snapshot, never a live WAL database. */
export function openReadonlyPlanningStore(databasePath: string, evidencePath: string, evidenceSha256: string) {
  const admission = loadReadonlyAdmission(databasePath, evidencePath, evidenceSha256);
  const stable = () => {
    if (['-wal','-shm','-journal'].some(s => existsSync(databasePath + s)) || bytesSha256(readFileSync(databasePath)) !== admission.record.snapshot.sha256) throw new Error('readonly_snapshot_changed');
  };
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec('PRAGMA query_only=ON');
    const facts = inspectReadonlyHistory(database); assertReadonlyHistoryFacts(facts);
    if (factsSha256(facts) !== admission.audit.factsSha256) throw new Error('readonly_audit_no_longer_matches');
    stable();
  }
  catch (error) { database.close(); throw error; }
  let closed = false;
  return Object.freeze({
    provenance: Object.freeze({ scope: 'backup_snapshot', backupSha256: admission.record.snapshot.sha256,
      snapshotCreatedAt: admission.record.snapshot.createdAt, schemaSha256: admission.audit.schemaSha256,
      admissionSha256: evidenceSha256, liveSessionMatch: 'unverified', carrierRuntime: 'unverified', receiptRuntime: 'unverified', executable: false }),
    readPlanningReturnSnapshot: (sessionId: string) => {
      if (closed) throw new Error('readonly_snapshot_closed');
      stable(); const result = readPlanningReturnSnapshot(database, sessionId); stable(); return result;
    },
    close: () => { if (!closed) { closed = true; database.close(); stable(); } }
  });
}
