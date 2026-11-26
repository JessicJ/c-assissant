import { EMAIL_TIMING_SCOPE_SCHEMA_SQL, EMAIL_TIMING_SCOPE_MIGRATION_NAME } from './email-store.js';
import { TRAVEL_ADJUSTMENT_MIGRATION_NAME, TRAVEL_ADJUSTMENT_SCHEMA_SQL } from './travel-adjustment-store.js';
import { inspectReadonlyHistory, assertReadonlyHistoryFacts, factsSha256 } from './readonly-schema-admission.js';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

// 与迁移30复用，保留原SQL字节和SQLite文本主键可空事实。
export const BOOKING_MUTATION_RECEIPTS_SQL = 'CREATE TABLE IF NOT EXISTS booking_mutation_receipts(request_id TEXT PRIMARY KEY, request_digest TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL)';
export const BOOKING_MUTATION_RECEIPTS_MIGRATION_NAME = '预订版本化保存回执';

function assertCurrentReceiptSchema(database: Pick<DatabaseSync, 'prepare'>): void {
  const fail = () => { throw new Error('guarded_schema_incomplete'); };
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='booking_mutation_receipts'").get();
  if (table?.sql !== BOOKING_MUTATION_RECEIPTS_SQL.replace(' IF NOT EXISTS', '')) fail();
  const columns = database.prepare('PRAGMA table_xinfo(booking_mutation_receipts)').all();
  const expected = ['request_id', 'request_digest', 'result_json', 'created_at'].map((name, cid) =>
    ({ cid, name, type: 'TEXT', notnull: cid === 0 ? 0 : 1, dflt_value: null, pk: cid === 0 ? 1 : 0, hidden: 0 }));
  if (!isDeepStrictEqual(columns.map(row => ({ ...row })), expected)) fail();
  if (database.prepare('PRAGMA foreign_key_list(booking_mutation_receipts)').all().length) fail();
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name='booking_mutation_receipts' AND type IN ('index','trigger') AND sql IS NOT NULL").get()) fail();
  const tables = database.prepare('PRAGMA table_list(booking_mutation_receipts)').all();
  if (tables.length !== 1 || tables[0]?.type !== 'table' || tables[0]?.wr !== 0 || tables[0]?.strict !== 0 || tables[0]?.ncol !== 4) fail();
  const indexes = database.prepare('PRAGMA index_list(booking_mutation_receipts)').all();
  const index = indexes[0];
  if (indexes.length !== 1 || index?.name !== 'sqlite_autoindex_booking_mutation_receipts_1' || index?.unique !== 1 || index?.origin !== 'pk' || index?.partial !== 0) fail();
  const indexColumns = database.prepare('PRAGMA index_xinfo(sqlite_autoindex_booking_mutation_receipts_1)').all();
  if (!isDeepStrictEqual(indexColumns.map(row => ({ ...row })), [
    { seqno: 0, cid: 0, name: 'request_id', desc: 0, coll: 'BINARY', key: 1 },
    { seqno: 1, cid: -1, name: null, desc: 0, coll: 'BINARY', key: 0 },
  ])) fail();
  const migrations = database.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all();
  if (![30,31,32].includes(migrations.length) || migrations.some((row, i) => !Number.isInteger(row.version) || row.version !== i + 1)
    || migrations[29]?.name !== BOOKING_MUTATION_RECEIPTS_MIGRATION_NAME || migrations.length>=31 && migrations[30]?.name!==TRAVEL_ADJUSTMENT_MIGRATION_NAME || migrations.length===32 && migrations[31]?.name!==EMAIL_TIMING_SCOPE_MIGRATION_NAME) throw new Error('guarded_schema_version_unsupported');
}
export function guardedSchemaSha256(database: Pick<DatabaseSync, 'prepare'>): string {
  const rows = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
export function assertGuardedSchema(database: Pick<DatabaseSync, 'prepare'>, expectedSha256: string, options?: { historicalPostStop: true }): void {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || guardedSchemaSha256(database) !== expectedSha256) throw new Error('guarded_schema_incompatible');
  const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  if ((options?.historicalPostStop ? row?.version !== 27 : ![30,31,32].includes(Number(row?.version)))) throw new Error('guarded_schema_version_unsupported');
  if (!options?.historicalPostStop) assertCurrentReceiptSchema(database);
  if (Number(row?.version) >= 31) {
    for(const ddl of (TRAVEL_ADJUSTMENT_SCHEMA_SQL+(row?.version===32?EMAIL_TIMING_SCOPE_SCHEMA_SQL:'')).split(';').map(v=>v.trim()).filter(Boolean)) {
      const match=ddl.match(/^CREATE TABLE IF NOT EXISTS (\w+)/);if(!match)throw new Error('guarded_schema_incomplete');
      const actual=database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(match[1]!);
      if(actual?.sql!==ddl.replace(' IF NOT EXISTS',''))throw new Error('guarded_schema_incomplete');
    }
  }
  // A release fingerprint alone must not allow an arbitrary empty/version-only database.
  for (const table of ['profiles','runtime_settings','plans','planning_sessions','planning_session_revisions','mah_generation_carriers','agent_work','email_settings',...(options?.historicalPostStop ? [] : ['direct_blueprint_edits','direct_blueprint_undos','booking_mutation_receipts'])]) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('guarded_schema_incomplete');
  }
  if (!options?.historicalPostStop) for (const [table, required] of Object.entries({blueprint_generations:["carrier_cancel_requested_at"],mah_generation_carriers:["protocol","request_byte_length","serializer_version","cancel_requested_at","running_at"],direct_blueprint_edits:["id","request_id","fingerprint","plan_id","plan_version","blueprint_id","blueprint_version","base_blueprint_version","before_json","after_json","metadata_json","result_json","created_at","undone"],direct_blueprint_undos:["request_id","revision_id","fingerprint","result_json","created_at"],booking_mutation_receipts:["request_id","request_digest","result_json","created_at"]})) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    if(required.some(column => !columns.includes(column))) throw new Error('guarded_schema_incomplete');
  }
}

/** Additional audit for the explicitly reviewed historic schema; no SQL writes. */
export function assertPostStopHistory(database: Pick<DatabaseSync, 'prepare'>, expectedFactsSha256: string): void {
  const facts = inspectReadonlyHistory(database);
  assertReadonlyHistoryFacts(facts);
  if (factsSha256(facts) !== expectedFactsSha256) throw new Error('post_stop_audit_facts_mismatch');
}
