import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { createSyntheticHistoryFixture } from './fixtures/readonly-mechanism.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'apps/server/package.json'));
const ts = require('typescript');
const original = require(join(root, 'packages/storage/lib/readonly-schema-admission.js'));
const area = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'landi-readonly-mechanism-')));
const fixture = createSyntheticHistoryFixture(join(area, 'data/backups'));
const { databasePath, schemaSha256, sessionId } = fixture;
const sourcePath = join(root, 'packages/storage/src/readonly-schema-admission.ts');
const sourceBefore = original.bytesSha256(fs.readFileSync(sourcePath));
const before = original.bytesSha256(fs.readFileSync(databasePath));
const cache = new Map(); let opened = 0, closed = 0, substitutions = 0;
const forbidden = () => { throw new Error('fixture_mechanism forbids network, process and timer actions'); };
function load(file) {
  const filename = resolve(root, file);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  let source = fs.readFileSync(filename, 'utf8');
  if (filename === sourcePath) {
    const declaration = /^export const reviewedHistorySchema = '[a-f0-9]{64}';$/gm;
    assert.equal([...source.matchAll(declaration)].length, 1);
    source = source.replace(declaration, `export const reviewedHistorySchema = '${schemaSha256}';`);
    substitutions++;
  }
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
  function localRequire(name) {
    if (name === 'node:child_process') return { spawn: forbidden, exec: forbidden, execFile: forbidden };
    if (name === 'node:sqlite') return { DatabaseSync: class extends DatabaseSync {
      constructor(file, options) { assert.equal(file, databasePath); assert.equal(options?.readOnly, true); super(file, options); opened++; }
      exec(sql) { assert.equal(sql, 'PRAGMA query_only=ON'); return super.exec(sql); }
      prepare(sql) { assert.match(sql, /^(SELECT |PRAGMA integrity_check|PRAGMA foreign_key_check)/); return super.prepare(sql); }
      close() { super.close(); closed++; }
    } };
    if (name === '@c-assistant/storage/readonly-planning-store') return load('packages/storage/src/readonly-planning-store.ts');
    if (name.startsWith('.')) return load(resolve(dirname(filename), name.replace(/\.js$/, '.ts')));
    return createRequire(filename)(name);
  }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInThisContext(`(function(exports,require,fetch,setInterval,setTimeout){${code}\n})`, { filename })(exports, localRequire, forbidden, forbidden, forbidden);
  return exports;
}
const history = load('packages/storage/src/readonly-schema-admission.ts');
const planning = load('packages/storage/src/readonly-planning-store.ts');
const startup = load('apps/server/src/readonly-diagnostic-startup.ts');
const facts = (() => { const db = new DatabaseSync(databasePath, { readOnly: true }); try { return history.inspectReadonlyHistory(db); } finally { db.close(); } })();
history.assertReadonlyHistoryFacts(facts);
let sequence = 0;
const hash = p => original.bytesSha256(fs.readFileSync(p));
const write = (name, value) => { const path = join(area, `${++sequence}-${name}.json`); fs.writeFileSync(path, JSON.stringify(value)); return { path, sha256: hash(path) }; };
const at = '2026-01-01T00:00:00Z';
const record = { version: 1, purpose: 'backup_snapshot_readonly', sourceDatabasePath: join(area, 'never-open-live.sqlite'),
  snapshot: { path: databasePath, sha256: before, createdAt: at },
  receipt: write('receipt', { path: databasePath, createdAt: at, schemaVersion: 27, integrity: 'ok' }),
  priorFailure: write('prior', { status: 'failed', sha256: before, schemaSha256 }),
  references: ['candidate', 'baseline'].map(role => ({ role, ...write(role, { schemaSha256: original.reviewedReferenceSchema }) })),
  audit: write('audit', { status: 'passed', backupSha256: before, schemaSha256, referenceSchemaSha256: original.reviewedReferenceSchema,
    retainedDifferences: original.retainedSchemaDifferences, facts, factsSha256: history.factsSha256(facts) }), executable: false };
const admission = write('admission', record);
const token = 'fictional-readonly-credential-1234567890';
const environment = () => ({ LANDI_DIAGNOSTIC_DATABASE_PATH: databasePath, LANDI_DIAGNOSTIC_PORT: '39889', LANDI_DIAGNOSTIC_ADMISSION_PATH: admission.path, LANDI_DIAGNOSTIC_ADMISSION_SHA256: admission.sha256, LANDI_DIAGNOSTIC_TOKEN: token });

after(() => {
  assert.equal(substitutions, 1);
  assert.equal(opened, closed);
  assert.equal(hash(databasePath), before);
  assert.equal(hash(sourcePath), sourceBefore);
  assert.equal(original.reviewedHistorySchema, 'b9379f042cd62eb08b907687111a7d080e3cb6267fa36a7f9720b81d31267bc3');
  for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(fs.existsSync(databasePath + suffix), false);
  fs.rmSync(area, { recursive: true, force: true });
});

test('fixture_mechanism: unmodified production schema gate rejects synthetic history', () => {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try { assert.throws(() => original.inspectReadonlyHistory(db), /readonly_schema_not_reviewed/); } finally { db.close(); }
  assert.equal(fixture.productionExecutable, false);
});
test('fixture_mechanism: read-only admission preserves file bytes and provenance remains unverified', () => {
  const store = planning.openReadonlyPlanningStore(databasePath, admission.path, admission.sha256);
  try {
    assert.equal(store.provenance.executable, false);
    for (const key of ['carrierRuntime', 'receiptRuntime', 'liveSessionMatch']) assert.equal(store.provenance[key], 'unverified');
    assert.equal(store.readPlanningReturnSnapshot(sessionId).revision, 0);
    assert.equal(store.readPlanningReturnSnapshot('missing'), null);
  } finally { store.close(); }
});
test('fixture_mechanism: bad digests, missing references, original path and altered audit reject before DB open', () => {
  for (const change of [v => v.purpose = 'workbench', v => v.snapshot.sha256 = '0'.repeat(64), v => v.references = [], v => v.priorFailure.sha256 = '0'.repeat(64), v => v.audit.sha256 = '0'.repeat(64), v => v.snapshot.createdAt = '2999-01-01T00:00:00Z']) {
    const copy = structuredClone(record); change(copy); const ref = write('invalid', copy), count = opened;
    assert.throws(() => planning.openReadonlyPlanningStore(databasePath, ref.path, ref.sha256)); assert.equal(opened, count);
  }
  assert.throws(() => planning.openReadonlyPlanningStore(databasePath, admission.path, '0'.repeat(64)), /digest_mismatch/);
  assert.throws(() => planning.openReadonlyPlanningStore(record.sourceDatabasePath, admission.path, admission.sha256), /original_database_forbidden/);
});
test('fixture_mechanism: missing CHECKs cannot conceal actual illegal carrier and presentation rows', () => {
  const copy = join(area, 'invalid-values.sqlite'); fs.copyFileSync(databasePath, copy);
  const db = new DatabaseSync(copy);
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare(`INSERT INTO mah_generation_carriers (generation_key,operation,batch_key,attempt,carrier_task_id,request_id,input_sha256,request_sha256,request_json,expected_subpath,status,created_at,updated_at) VALUES ('fiction','illegal','',1,'fiction-task','fiction-request','x','x','{}','result','illegal',?,?)`).run(at, at);
    db.prepare(`INSERT INTO stages (id,plan_id,title,description,presentation_kind,sort_order) VALUES ('fiction-stage','fiction-plan','Fiction','Fiction','illegal',0)`).run();
    const invalid = history.inspectReadonlyHistory(db);
    for (const key of ['carrierOperation', 'carrierStatus', 'stagePresentation']) assert.equal(invalid.violations[key], 1);
    assert.throws(() => history.assertReadonlyHistoryFacts(invalid), /historical_data_invalid/);
  } finally { db.close(); }
});
test('fixture_mechanism: diagnostics authenticate, deny business routes, and compare a real synthetic session without live approval', async () => {
  const instance = startup.createReadonlyDiagnosticServer(environment()), server = instance.server;
  const headers = { authorization: `Bearer ${token}`, 'x-landi-instance-id': instance.instanceId };
  try {
    assert.equal(server.server.listening, false);
    assert.equal((await server.inject({ url: '/api/agent-readiness' })).statusCode, 403);
    for (const [method, url] of [['POST', '/api/agent/chat'], ['POST', '/api/backups'], ['GET', '/api/workspace']]) assert.equal((await server.inject({ method, url, headers })).statusCode, 503);
    const ready = await server.inject({ url: '/api/agent-readiness', headers }); assert.equal(ready.statusCode, 200); assert.equal(ready.headers['cache-control'], 'no-store');
    for (const key of ['generation', 'conversation', 'revision', 'unattendedEmail', 'hosting']) assert.equal(ready.json()[key], false);
    const url = `/api/planning-sessions/${sessionId}/return-check?expectedRevision=0&expectedProposalVersion=none`;
    const response = (await server.inject({ url, headers })).json(); assert.equal(response.comparison, 'matched'); assert.equal(response.provenance.liveSessionMatch, 'unverified'); assert.equal(response.executable, false);
    assert.equal(server.server.listening, false);
  } finally { await server.close(); }
});
