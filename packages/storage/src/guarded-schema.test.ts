import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteWorkspaceStore } from './index.js';
import { BOOKING_MUTATION_RECEIPTS_SQL, guardedSchemaSha256 } from './guarded-schema.js';

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const tableSql = BOOKING_MUTATION_RECEIPTS_SQL.replace(' IF NOT EXISTS', '');
function inspect<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return read(db); } finally { db.close(); }
}
function mutate(file: string, sql: string): void {
  const db = new DatabaseSync(file);
  try { db.exec(sql); } finally { db.close(); }
}
function preservedOpen(file: string, expectedHash: string, rejects = false): void {
  // 虚构旧 sidecar 必须保留原字节，不导入或清理。
  const sidecar = `${file}.mah-carriers.sqlite`;
  writeFileSync(sidecar, 'fictional sidecar bytes');
  const before = hash(file), sidecarBefore = hash(sidecar);
  if (rejects) assert.throws(() => new SqliteWorkspaceStore(file, { guardedSchemaSha256: expectedHash }), /guarded_schema_/);
  else { const store = new SqliteWorkspaceStore(file, { guardedSchemaSha256: expectedHash }); store.getWorkspace(); store.close(); }
  assert.equal(hash(file), before);
  assert.equal(hash(sidecar), sidecarBefore);
  for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(file + suffix), false);
}

test('当前受控准入接受新建及独立29升级库，无写入且保留历史与回执', () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-guarded-current-'));
  try {
    const fingerprints = new Set<string>();
    for (const mode of ['fresh', '29', '28-29']) {
      const file = join(directory, `${mode}.sqlite`);
      const initial = new SqliteWorkspaceStore(file);
      const workspace = initial.getWorkspace(), lineage = initial.getPlanBlueprintLineage(workspace.activePlan.id);
      initial.close();
      if (mode !== 'fresh') {
        mutate(file, 'DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DROP TABLE booking_mutation_receipts; DELETE FROM schema_migrations WHERE version>=30');
        if (mode === '28-29') {
          for (const column of ['protocol', 'request_byte_length', 'serializer_version', 'cancel_requested_at', 'running_at']) mutate(file, `ALTER TABLE mah_generation_carriers DROP COLUMN ${column}`);
          mutate(file, 'ALTER TABLE blueprint_generations DROP COLUMN carrier_cancel_requested_at; DELETE FROM schema_migrations WHERE version=29');
          const to29 = new SqliteWorkspaceStore(file); to29.close();
          mutate(file, 'DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DROP TABLE booking_mutation_receipts; DELETE FROM schema_migrations WHERE version>=30');
        }
      }
      const history = inspect(file, db => db.prepare('SELECT * FROM schema_migrations WHERE version<=29 ORDER BY version').all());
      const upgraded = new SqliteWorkspaceStore(file);
      assert.deepEqual(upgraded.getWorkspace(), workspace);
      assert.deepEqual(upgraded.getPlanBlueprintLineage(workspace.activePlan.id), lineage);
      upgraded.close();
      assert.deepEqual(inspect(file, db => db.prepare('SELECT * FROM schema_migrations WHERE version<=29 ORDER BY version').all()), history);
      mutate(file, "INSERT INTO booking_mutation_receipts VALUES('fiction-request','fiction-digest','{}','2026-01-01T00:00:00Z')");
      const receipts = inspect(file, db => db.prepare('SELECT * FROM booking_mutation_receipts').all());
      // 仅测试隔离迁移已知输出的指纹，生产仍要求独立绑定的发布指纹。
      const fingerprint = inspect(file, guardedSchemaSha256); fingerprints.add(fingerprint);
      preservedOpen(file, fingerprint);
      assert.deepEqual(inspect(file, db => db.prepare('SELECT * FROM booking_mutation_receipts').all()), receipts);
      preservedOpen(file, '0'.repeat(64), true);
    }
    assert.ok(fingerprints.size > 1, '合法升级列序有各自精确指纹');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const malformed: [string, string][] = [
  ['缺表', 'DROP TABLE booking_mutation_receipts'],
  ['缺列', 'ALTER TABLE booking_mutation_receipts DROP COLUMN created_at'],
  ['多余列', 'ALTER TABLE booking_mutation_receipts ADD COLUMN extra TEXT'],
  ['错误类型', tableSql.replace('request_digest TEXT', 'request_digest INTEGER')],
  ['缺少非空约束', tableSql.replace('request_digest TEXT NOT NULL', 'request_digest TEXT')],
  ['改变文本主键可空事实', tableSql.replace('request_id TEXT PRIMARY KEY', 'request_id TEXT NOT NULL PRIMARY KEY')],
  ['缺少主键', tableSql.replace(' PRIMARY KEY', '')],
  ['主键列错误', tableSql.replace('request_id TEXT PRIMARY KEY', 'request_id TEXT').replace('request_digest TEXT NOT NULL', 'request_digest TEXT PRIMARY KEY')],
  ['额外默认值', tableSql.replace('created_at TEXT NOT NULL', "created_at TEXT NOT NULL DEFAULT ''")],
  ['隐藏生成列', tableSql.replace('created_at TEXT NOT NULL', 'created_at TEXT GENERATED ALWAYS AS (request_id) VIRTUAL')],
  ['外键', tableSql.replace('request_digest TEXT NOT NULL', 'request_digest TEXT NOT NULL REFERENCES profiles(id)')],
  ['CHECK', tableSql.replace('request_digest TEXT NOT NULL', "request_digest TEXT NOT NULL CHECK(request_digest<>'')")],
  ['无rowid表', tableSql + ' WITHOUT ROWID'],
  ['严格表', tableSql + ' STRICT'],
  ['主键排序规则', tableSql.replace('request_id TEXT PRIMARY KEY', 'request_id TEXT COLLATE NOCASE PRIMARY KEY')],
  ['主键降序', tableSql.replace('PRIMARY KEY', 'PRIMARY KEY DESC')],
  ['显式索引', 'CREATE INDEX extra_receipt ON booking_mutation_receipts(created_at)'],
  ['触发器', 'CREATE TRIGGER extra_receipt AFTER INSERT ON booking_mutation_receipts BEGIN SELECT 1; END'],
  ['缺29标记', 'DELETE FROM schema_migrations WHERE version=29'],
  ['缺30标记', 'DELETE FROM schema_migrations WHERE version=30'],
  ['缺1标记', 'DELETE FROM schema_migrations WHERE version=1'],
  ['30名称错误', "UPDATE schema_migrations SET name='fiction-wrong' WHERE version=30"],
  ['未来编号', "INSERT INTO schema_migrations VALUES(33,'fiction-future','2026-01-01T00:00:00Z')"],
];
for (const [name, sql] of malformed) test(`当前受控准入拒绝${name}，错误指纹自洽仍拒绝并保留原字节`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-guarded-malformed-'));
  try {
    const file = join(directory, 'fiction.sqlite');
    const initial = new SqliteWorkspaceStore(file); initial.close();
    mutate(file, sql.startsWith('CREATE TABLE') ? `DROP TABLE booking_mutation_receipts; ${sql}` : sql);
    const fingerprint = inspect(file, guardedSchemaSha256);
    preservedOpen(file, fingerprint, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
