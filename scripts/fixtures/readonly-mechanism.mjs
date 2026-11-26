// Synthetic source-mechanism evidence only; never a deployment/history snapshot.
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { SqliteWorkspaceStore } = require('@c-assistant/storage');

export function createSyntheticHistoryFixture(directory) {
  mkdirSync(directory, { recursive: true });
  const databasePath = join(realpathSync(directory), 'synthetic-history.sqlite');
  const store = new SqliteWorkspaceStore(databasePath);
  const session = store.createPlanningSession('travel', new Date('2026-01-01T00:00:00Z'));
  store.close();
  const db = new DatabaseSync(databasePath);
  let historicalMigrations, historicalObjects;
  try {
    // 当前Schema推进时立即失败，合成降版逻辑必须重新审阅。
    assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
    historicalMigrations = db.prepare('SELECT * FROM schema_migrations WHERE version<=27 ORDER BY version').all();
    historicalObjects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name NOT IN ('travel_adjustment_drafts','travel_adjustment_handoffs','travel_adjustment_receipts','travel_episodes','travel_observations','travel_phases','booking_mutation_receipts','direct_blueprint_edits','direct_blueprint_undos') ORDER BY type,name").all();
    // 合成历史夹具固定为原有 Schema 27；不修改生产准入版本或任何用户数据库。
    db.exec('DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DROP TABLE booking_mutation_receipts; DROP TABLE direct_blueprint_undos; DROP TABLE direct_blueprint_edits');
    for (const column of ['protocol', 'request_byte_length', 'serializer_version', 'cancel_requested_at', 'running_at']) db.exec(`ALTER TABLE mah_generation_carriers DROP COLUMN ${column}`);
    db.exec('ALTER TABLE blueprint_generations DROP COLUMN carrier_cancel_requested_at');
    db.exec('DELETE FROM schema_migrations WHERE version>27');
    db.prepare('INSERT OR IGNORE INTO planning_session_revisions (session_id, revision) VALUES (?, 0)').run(session.id);
    db.enableDefensive(false); // Fixture-only DDL editing; never a production connection.
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA writable_schema=ON');
    for (const [table, field] of [['mah_generation_carriers', 'operation'], ['mah_generation_carriers', 'status'], ['stages', 'presentation_kind']]) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
      const pattern = new RegExp(` CHECK \\(${field} IN \\([^)]*\\)\\)`, 'g');
      assert.equal([...row.sql.matchAll(pattern)].length, 1, `Expected one ${table}.${field} CHECK`);
      db.prepare("UPDATE sqlite_master SET sql=? WHERE type='table' AND name=?").run(row.sql.replace(pattern, ''), table);
    }
    db.exec('PRAGMA writable_schema=OFF');
    const version = Number(db.prepare('PRAGMA schema_version').get().schema_version);
    db.exec(`PRAGMA schema_version=${version + 1}`);
  } finally { db.close(); }
  const read = new DatabaseSync(databasePath, { readOnly: true });
  let schemaSha256;
  try {
    const schema = read.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    schemaSha256 = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
    assert.deepEqual(read.prepare('SELECT * FROM schema_migrations ORDER BY version').all(), historicalMigrations);
    assert.deepEqual(historicalMigrations.map(row => row.version), Array.from({ length: 27 }, (_, i) => i + 1));
    assert.deepEqual(read.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger') ORDER BY type,name").all(), historicalObjects);
    for (const name of ['travel_adjustment_drafts','travel_adjustment_handoffs','travel_adjustment_receipts','travel_episodes','travel_observations','travel_phases','booking_mutation_receipts', 'direct_blueprint_edits', 'direct_blueprint_undos']) assert.equal(read.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name), undefined);
    const carrierColumns = read.prepare('PRAGMA table_info(mah_generation_carriers)').all().map(row => row.name);
    for (const name of ['protocol', 'request_byte_length', 'serializer_version', 'cancel_requested_at', 'running_at']) assert.equal(carrierColumns.includes(name), false);
    for (const name of ['slot_class', 'project_root', 'admission_status', 'submit_receipt_json']) assert.equal(carrierColumns.includes(name), true);
    assert.equal(read.prepare('PRAGMA table_info(blueprint_generations)').all().some(row => row.name === 'carrier_cancel_requested_at'), false);
    assert.equal(read.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { read.close(); }
  return { databasePath, schemaSha256, schemaVersion: 27, sessionId: session.id, evidenceMode: 'fixture_mechanism', productionExecutable: false };
}
