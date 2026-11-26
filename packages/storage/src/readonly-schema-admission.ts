import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const reviewedHistorySchema = 'b9379f042cd62eb08b907687111a7d080e3cb6267fa36a7f9720b81d31267bc3';
export const reviewedReferenceSchema = '3e45f2e0ba765f5ce2b3e9976b5d8b3410bf15e03fcdedbbf88574508aa68d6f';
export const retainedSchemaDifferences = Object.freeze({
  sqlRepresentation: ['agent_runs', 'telegram_location_intent', 'trip_blueprints'],
  columnOrder: ['mah_generation_carriers', 'plans', 'profiles', 'stages', 'tasks'],
  defaults: ['plans.configuration_json'],
  missingChecks: ['mah_generation_carriers.operation', 'mah_generation_carriers.status', 'stages.presentation_kind']
});
const ensure = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const shaPattern = /^[a-f0-9]{64}$/;
export const bytesSha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function factsSha256(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return bytesSha256(JSON.stringify(sort(value)));
}
export interface ReadonlyAdmissionRecord {
  version: 1; purpose: 'backup_snapshot_readonly'; sourceDatabasePath: string;
  snapshot: { path: string; sha256: string; createdAt: string };
  receipt: { path: string; sha256: string };
  priorFailure: { path: string; sha256: string };
  references: Array<{ role: 'candidate' | 'baseline'; path: string; sha256: string }>;
  audit: { path: string; sha256: string }; executable: false;
}
function jsonRecord(ref: { path: string; sha256: string }) {
  ensure(object(ref) && typeof ref.path === 'string' && isAbsolute(ref.path) && ref.path.endsWith('.json') && shaPattern.test(ref.sha256), 'readonly_evidence_reference_invalid');
  const stat = lstatSync(ref.path);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2_000_000, 'readonly_evidence_file_invalid');
  const bytes = readFileSync(ref.path);
  ensure(bytesSha256(bytes) === ref.sha256, 'readonly_evidence_digest_mismatch');
  return JSON.parse(bytes.toString('utf8'));
}
export function loadReadonlyAdmission(databasePath: string, evidencePath: string, evidenceSha256: string) {
  const value = jsonRecord({ path: evidencePath, sha256: evidenceSha256 }) as ReadonlyAdmissionRecord;
  ensure(object(value) && value.version === 1 && value.purpose === 'backup_snapshot_readonly' && value.executable === false, 'readonly_admission_purpose_invalid');
  ensure(object(value.snapshot) && typeof value.sourceDatabasePath === 'string' && isAbsolute(value.sourceDatabasePath) && value.sourceDatabasePath !== databasePath, 'readonly_original_database_forbidden');
  ensure(isAbsolute(databasePath) && dirname(databasePath).endsWith('/data/backups') && value.snapshot.path === databasePath && shaPattern.test(value.snapshot.sha256) && Number.isFinite(Date.parse(value.snapshot.createdAt)) && Date.parse(value.snapshot.createdAt) <= Date.now(), 'readonly_snapshot_binding_invalid');
  const stat = lstatSync(databasePath);
  ensure(stat.isFile() && !stat.isSymbolicLink() && realpathSync(databasePath) === databasePath && !['-wal', '-shm', '-journal'].some(s => existsSync(databasePath + s)), 'readonly_standalone_snapshot_required');
  ensure(bytesSha256(readFileSync(databasePath)) === value.snapshot.sha256, 'readonly_snapshot_digest_mismatch');
  const receipt = jsonRecord(value.receipt);
  ensure(receipt.path === databasePath && receipt.createdAt === value.snapshot.createdAt && receipt.schemaVersion === 27 && receipt.integrity === 'ok' && dirname(databasePath).endsWith('/data/backups'), 'readonly_receipt_binding_invalid');
  const prior = jsonRecord(value.priorFailure);
  ensure(prior.status === 'failed' && prior.sha256 === value.snapshot.sha256 && prior.schemaSha256 === reviewedHistorySchema, 'readonly_prior_failure_binding_invalid');
  ensure(Array.isArray(value.references) && value.references.length === 2 && new Set(value.references.map(r => r.role)).size === 2 && value.references.every(r => ['candidate','baseline'].includes(r.role)), 'readonly_reference_pair_required');
  for (const ref of value.references) ensure(jsonRecord(ref).schemaSha256 === reviewedReferenceSchema, 'readonly_reference_schema_invalid');
  const audit = jsonRecord(value.audit);
  ensure(audit.status === 'passed' && audit.backupSha256 === value.snapshot.sha256 && audit.schemaSha256 === reviewedHistorySchema && audit.referenceSchemaSha256 === reviewedReferenceSchema && factsSha256(audit.retainedDifferences) === factsSha256(retainedSchemaDifferences), 'readonly_audit_binding_invalid');
  ensure(audit.factsSha256 === factsSha256(audit.facts), 'readonly_audit_facts_digest_mismatch');
  return { record: value, audit, evidenceSha256 };
}

/** Read-only SQL and aggregate checks only. No business services, migrations or repair. */
export function inspectReadonlyHistory(database: Pick<DatabaseSync, 'prepare'>) {
  const n = (sql: string, ...args: string[]) => Number(database.prepare(sql).get(...args)!.n);
  const schema = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const schemaSha256 = bytesSha256(JSON.stringify(schema));
  ensure(schemaSha256 === reviewedHistorySchema, 'readonly_schema_not_reviewed');
  const version = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version;
  ensure(version === 27, 'readonly_schema_version_invalid');
  const integrity = database.prepare('PRAGMA integrity_check').all();
  ensure(integrity.length === 1 && Object.values(integrity[0]!)[0] === 'ok', 'readonly_integrity_failed');
  const operations = ['research_batch','itinerary_draft','itinerary_review','itinerary_repair','planned_place_image_enrichment','semantic_plan','semantic_validation','semantic_repair'];
  const statuses = ['prepared','submitting','submission_unknown','queued','running','completed','validated','imported','cancel_requested','cancelled','failed','scheduler_unavailable','carrier_missing','provider_route_unverified','artifact_missing','artifact_invalid','artifact_changed'];
  const kinds = ['overview','itinerary','reservations','budget','transport','details'];
  const invalid = (table: string, column: string, values: string[]) => n(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IS NULL OR ${column} NOT IN (${values.map(() => '?').join(',')})`, ...values);
  const violations: Record<string, number> = {
    carrierOperation: invalid('mah_generation_carriers','operation',operations), carrierStatus: invalid('mah_generation_carriers','status',statuses),
    stagePresentation: invalid('stages','presentation_kind',kinds), foreignKeys: database.prepare('PRAGMA foreign_key_check').all().length,
    missingRevision: n('SELECT COUNT(*) AS n FROM planning_sessions s LEFT JOIN planning_session_revisions r ON r.session_id=s.id WHERE r.session_id IS NULL'),
    invalidRevision: n("SELECT COUNT(*) AS n FROM planning_session_revisions WHERE typeof(revision)!='integer' OR revision<0 OR revision>9007199254740991"),
    invalidMessages: n("SELECT COUNT(*) AS n FROM planning_sessions WHERE CASE WHEN json_valid(messages_json) THEN json_type(messages_json)!='array' ELSE 1 END"),
    invalidPlanVersion: n("SELECT COUNT(*) AS n FROM plans WHERE typeof(version)!='integer' OR version<1 OR version>9007199254740991"),
    invalidPlanConfiguration: n('SELECT COUNT(*) AS n FROM plans WHERE NOT json_valid(configuration_json)'),
    missingResearch: n('SELECT COUNT(*) AS n FROM blueprint_generations g LEFT JOIN research_sets r ON r.id=g.research_set_id WHERE g.research_set_id IS NOT NULL AND (r.id IS NULL OR r.generation_key!=g.generation_key)'),
    missingBlueprint: n('SELECT COUNT(*) AS n FROM blueprint_generations g LEFT JOIN trip_blueprints b ON b.id=g.blueprint_id AND b.version=g.blueprint_version WHERE g.blueprint_id IS NOT NULL AND (b.id IS NULL OR b.generation_key!=g.generation_key)'),
    lineageVersion: n('SELECT COUNT(*) AS n FROM plan_blueprint_lineage l JOIN plans p ON p.id=l.plan_id WHERE l.plan_version!=p.version'),
    invalidProposal: 0, invalidConfirmation: 0, invalidTimestamp: 0, invalidGenerationProposal: 0,
    receiptVersions: n("SELECT COUNT(*) AS n FROM planning_message_receipts WHERE typeof(expected_revision)!='integer' OR expected_revision<0 OR typeof(saved_revision)!='integer' OR saved_revision!=expected_revision+1"),
    receiptAhead: n('SELECT COUNT(*) AS n FROM planning_message_receipts m JOIN planning_session_revisions r ON r.session_id=m.session_id WHERE m.saved_revision>r.revision')
  };
  for (const row of database.prepare('SELECT status,proposal_json,confirmed_proposal_version,updated_at FROM planning_sessions').all()) {
    let proposal: any = null;
    if (row.proposal_json !== null) { try { proposal = JSON.parse(String(row.proposal_json)); } catch { violations.invalidProposal!++; continue; }
      if (!proposal || !Number.isSafeInteger(proposal.version) || proposal.version < 1) violations.invalidProposal!++; }
    const confirmed = row.confirmed_proposal_version;
    if (confirmed !== null && (!Number.isSafeInteger(confirmed) || Number(confirmed) < 1 || !proposal || ['proposal_confirmed','generating','draft_ready'].includes(String(row.status)) && confirmed !== proposal.version)) violations.invalidConfirmation!++;
    const time = Date.parse(String(row.updated_at)); if (!Number.isFinite(time) || time > Date.now()) violations.invalidTimestamp!++;
  }
  for (const row of database.prepare('SELECT g.proposal_version,s.proposal_json FROM blueprint_generations g JOIN planning_sessions s ON s.id=g.session_id').all()) {
    try { const proposal = JSON.parse(String(row.proposal_json)); if (!proposal || !Number.isSafeInteger(proposal.version) || Number(row.proposal_version) > proposal.version) violations.invalidGenerationProposal!++; }
    catch { violations.invalidGenerationProposal!++; }
  }
  const counts = Object.fromEntries(['planning_sessions','plans','stages','mah_generation_carriers','planning_message_receipts'].map(table => [table, n(`SELECT COUNT(*) AS n FROM ${table}`)]));
  return { schemaSha256, schemaVersion: version, schemaObjects: schema, integrity: 'ok', counts, violations,
    coverage: { carrierRuntime: 'unverified', receiptRuntime: 'unverified', liveSessionMatch: 'unverified' } };
}
export function assertReadonlyHistoryFacts(facts: ReturnType<typeof inspectReadonlyHistory>) {
  ensure(Object.values(facts.violations).every(n => Number.isSafeInteger(n) && n === 0), 'readonly_historical_data_invalid');
}
