import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import ts from 'typescript';
import { loadMaintenanceBootstrapPolicy } from './maintenance-bootstrap-policy.js';
import { createMaintenanceBootstrap, startMaintenanceBootstrap } from './maintenance-bootstrap-startup.js';
import { assessFirstTakeover } from './first-takeover-contract.js';
import { productionReadiness } from './production-readiness.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const token = 'fictional-bootstrap-secret-1234567890';
function fixture() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'landi-fictional-bootstrap-')));
  const lib = resolve(root, 'apps/server/lib'); mkdirSync(lib, { recursive: true });
  const files = ['index.js', 'maintenance-bootstrap-startup.js', 'maintenance-bootstrap-policy.js', 'maintenance-control.js', 'maintenance-control-routes.js'].map(name => `apps/server/lib/${name}`);
  files.push('pnpm-lock.yaml');
  for (const file of files) writeFileSync(resolve(root, file), `// fictional release metadata: ${file}\n`);
  const manifest = { version: 1, mode: 'maintenance-bootstrap', projectRoot: root, origin: 'http://127.0.0.1:39879', oldOrigin: 'http://127.0.0.1:8787', nodeVersion: process.version,
    files: files.map(path => ({ path, sha256: sha(readFileSync(resolve(root, path), 'utf8')) })) };
  const env = { LANDI_SERVER_MODE: 'maintenance-bootstrap', LANDI_MAINTENANCE_TOKEN: token, LANDI_MAINTENANCE_APP_ROOT: root,
    LANDI_MAINTENANCE_MANIFEST_PATH: resolve(root, 'manifest.json'), LANDI_MAINTENANCE_MANIFEST_SHA256: '', LANDI_MAINTENANCE_PORT: '39879',
    // Poisoned legacy settings must never cause a fallback or a business file read.
    C_ASSISTANT_DATA_PATH: resolve(root, 'DO-NOT-OPEN.sqlite'), C_ASSISTANT_ENV_PATH: resolve(root, 'DO-NOT-READ.env'), LANDI_BLUEPRINT_GENERATION: '1' };
  function pin() { const bytes = JSON.stringify(manifest); writeFileSync(env.LANDI_MAINTENANCE_MANIFEST_PATH, bytes); env.LANDI_MAINTENANCE_MANIFEST_SHA256 = sha(bytes); }
  pin();
  return { root, lib, env, manifest, pin, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('bootstrap injection starts closed and exposes only authenticated maintenance routes', async () => {
  const f = fixture();
  try {
    const instance = await createMaintenanceBootstrap(f.env);
    try {
      assert.equal(instance.server.server.listening, false);
      assert.equal(instance.control.accepting(), false);
      const headers = { authorization: `Bearer ${token}`, 'x-landi-instance-id': instance.control.instanceId };
      const snapshot = await instance.server.inject({ url: '/internal/maintenance/snapshot', headers });
      assert.equal(snapshot.statusCode, 200);
      const value = snapshot.json();
      assert.equal(value.role, 'candidate_bootstrap'); assert.equal(value.admissionClosed, true);
      assert.equal(value.local.http.count, 0);
      assert.equal(value.local.background.count, null); assert.equal(value.local.generation.count, null);
      assert.equal(value.persistedOperations.status, 'unverified'); assert.equal(value.readyToStop, false);
      for (const [method, url] of [['GET', '/api/workspace'], ['POST', '/api/agent/chat'], ['POST', '/api/backups'], ['GET', '/']] as const) {
        assert.equal((await instance.server.inject({ method, url })).statusCode, 503);
      }
      assert.equal((await instance.server.inject('/internal/maintenance/snapshot')).statusCode, 403);
      assert.equal((await instance.server.inject({ url: '/internal/maintenance/snapshot', headers, remoteAddress: '198.51.100.2' })).statusCode, 403);
      assert.equal(instance.server.server.listening, false);
    } finally { await instance.server.close(); }
    // Both poisoned paths are absent: successful construction/injection cannot depend on them.
    assert.throws(() => readFileSync(f.env.C_ASSISTANT_DATA_PATH), { code: 'ENOENT' });
    assert.throws(() => readFileSync(f.env.C_ASSISTANT_ENV_PATH), { code: 'ENOENT' });
  } finally { f.close(); }
});

test('startup checks reject unsafe config before any listener and never choose standard startup', async () => {
  const f = fixture();
  try {
    for (const delta of [ { LANDI_SERVER_MODE: 'standard' }, { LANDI_MAINTENANCE_TOKEN: '' }, { LANDI_MAINTENANCE_PORT: '' },
      { LANDI_MAINTENANCE_MANIFEST_SHA256: '0'.repeat(64) }, { LANDI_MAINTENANCE_MANIFEST_PATH: f.env.C_ASSISTANT_DATA_PATH } ]) {
      await assert.rejects(createMaintenanceBootstrap({ ...f.env, ...delta }));
    }
    f.manifest.origin = f.manifest.oldOrigin; f.env.LANDI_MAINTENANCE_PORT = '8787'; f.pin();
    assert.throws(() => loadMaintenanceBootstrapPolicy(f.env), /binding_mismatch/);
  } finally { f.close(); }
});

test('artifact mutations, escaping paths, unknown business fields and unlisted files fail closed', () => {
  const f = fixture();
  try {
    const entry = resolve(f.lib, 'index.js'); const original = readFileSync(entry, 'utf8');
    writeFileSync(entry, 'changed'); assert.throws(() => loadMaintenanceBootstrapPolicy(f.env), /digest_mismatch/); writeFileSync(entry, original);
    f.manifest.files.push({ path: '../escape.js', sha256: 'a'.repeat(64) }); f.pin();
    assert.throws(() => loadMaintenanceBootstrapPolicy(f.env), /artifact_invalid/); f.manifest.files.pop(); f.pin();
    Object.assign(f.manifest, { databasePath: f.env.C_ASSISTANT_DATA_PATH }); f.pin();
    assert.throws(() => loadMaintenanceBootstrapPolicy(f.env), /field_unsupported/); delete (f.manifest as Record<string, unknown>).databasePath; f.pin();
    writeFileSync(resolve(f.lib, 'unlisted.js'), 'fictional');
    assert.throws(() => loadMaintenanceBootstrapPolicy(f.env), /release_incomplete/);
    rmSync(resolve(f.lib, 'unlisted.js'));
    rmSync(entry); symlinkSync('/not-a-real-business-file', entry);
    assert.throws(() => loadMaintenanceBootstrapPolicy(f.env), /explicit_file_required/);
  } finally { f.close(); }
});

test('a source/fake artifact cannot be started as the pinned compiled release', async () => {
  const f = fixture();
  try { await assert.rejects(startMaintenanceBootstrap(f.env), /maintenance_running_artifact_mismatch/); }
  finally { f.close(); }
});

const at = Date.parse('2026-10-23T04:00:00Z');
function takeoverFixture() {
  const old = { role: 'old_service', instanceId: 'fictional-old-instance', pid: 12345, startedAt: '2026-10-22T04:00:00Z', origin: 'http://127.0.0.1:8787', artifactSha256: 'a'.repeat(64), databasePath: '/fictional/data.sqlite' };
  const data = {
    identity: { ownerMatched: true, runtimeArtifactMatched: true }, admission: { closed: true, allEntrypointsCovered: true },
    drain: { schedulersPaused: true, activeRequests: 0, activeBackground: 0, activeGenerations: 0, activeDeliveries: 0 },
    persisted: { uncertainOperations: 0, preservedQueuedMail: 17, queueAction: 'preserve', snapshotSha256: 'b'.repeat(64) },
    manager: { autoRestartPrevented: true, manager: 'fictional-launchd' }, exit: { ownerExited: true, portReleased: true, replacementAbsent: true },
    backup: { consistent: true, integrity: 'ok', sha256: 'b'.repeat(64), schemaSha256: 'c'.repeat(64), databasePath: '/fictional/data.sqlite', quiescenceRecordSha256: 'd'.repeat(64) },
    compatibility: { schemaVersion: 27, backupSha256: 'b'.repeat(64), schemaSha256: 'c'.repeat(64), candidateSchemaSha256: 'c'.repeat(64), baselineSchemaSha256: 'c'.repeat(64), historyCompatible: true, mutationsPerformed: false, inspectedCopy: true }
  };
  const sources = { identity: 'os_identity_and_startup_record', admission: 'old_process_admission', drain: 'old_process_work_registry', persisted: 'consistent_storage_snapshot', manager: 'os_service_manager', exit: 'os_process_and_listener', backup: 'consistent_backup_verification', compatibility: 'backup_copy_readonly_inspection' };
  const facts = Object.fromEntries(Object.entries(data).map(([name, value]) => [name, { status: 'observed', source: sources[name as keyof typeof sources], subject: { ...old }, observedAt: new Date(at - 1000).toISOString(), records: [{ reference: '/fictional/evidence/'+name+'.json', sha256: 'd'.repeat(64) }], data: value }])) as Record<string, any>;
  return { version: 1, oldService: old, facts, automaticResume: false, restoreDatabase: false };
}

test('missing evidence and candidate zero counts never establish old service drain', () => {
  const missing = assessFirstTakeover(null, at);
  assert.equal(missing.status, 'unverified'); assert.equal(missing.oldServiceDrained, null);
  const value = takeoverFixture(); delete value.facts.drain;
  Object.assign(value, { candidateSnapshot: { role: 'candidate_bootstrap', local: { http: { count: 0 }, generation: { count: 0 } } } });
  const result = assessFirstTakeover(value, at);
  assert.equal(result.status, 'unverified'); assert.equal(result.oldServiceDrained, null);
  assert.ok(result.issues.includes('drain:evidence_missing'));
  value.facts.drain = takeoverFixture().facts.drain; value.facts.drain.subject.role = 'candidate_bootstrap';
  assert.ok(assessFirstTakeover(value, at).issues.includes('drain:old_subject_mismatch'));
});

test('fully consistent fictional claims still cannot authorize stop or execution; queued mail need not be zero', () => {
  const value = takeoverFixture(); const before = JSON.stringify(value);
  const result = assessFirstTakeover(value, at);
  assert.equal(result.status, 'consistent_unverified'); assert.deepEqual(result.issues, []);
  assert.equal(result.executable, false); assert.equal(result.readyToStop, false);
  assert.equal(result.rawRecordsIndependentlyVerified, false); assert.equal(result.oldServiceDrained, null);
  assert.equal(JSON.stringify(value), before);
});

test('wrong owner, stale/future records, unknown source and absent raw references are unverified', () => {
  for (const mutate of [
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.subject.startedAt = '2026-10-21T04:00:00Z'; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.subject.instanceId = 'fictional-candidate-instance'; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.observedAt = new Date(at-60_001).toISOString(); },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.observedAt = new Date(at+1).toISOString(); },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.source = 'candidate_work_registry'; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.records = []; }
  ]) { const value = takeoverFixture(); mutate(value); assert.equal(assessFirstTakeover(value, at).facts.drain?.status, 'unverified'); }
});

test('active/unknown work, queue clearing, forced recovery and incompatible backups block assessment', () => {
  for (const mutate of [
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.data.activeRequests = 1; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.drain.data.activeDeliveries = null; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.persisted.data.uncertainOperations = 1; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.persisted.data.queueAction = 'clear'; },
    (v: ReturnType<typeof takeoverFixture>) => { v.automaticResume = true; },
    (v: ReturnType<typeof takeoverFixture>) => { v.restoreDatabase = true; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.compatibility.data.backupSha256 = 'e'.repeat(64); },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.compatibility.data.baselineSchemaSha256 = 'e'.repeat(64); },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.backup.data.schemaSha256 = 'e'.repeat(64); },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.backup.data.databasePath = '/fictional/other.sqlite'; },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.backup.data.quiescenceRecordSha256 = 'e'.repeat(64); },
    (v: ReturnType<typeof takeoverFixture>) => { v.facts.admission.observedAt = new Date(at).toISOString(); }
  ]) { const value = takeoverFixture(); mutate(value); assert.equal(assessFirstTakeover(value, at).status, 'unverified'); }
});

test('bootstrap runtime import graph excludes business/CLI modules and production gates stay closed', () => {
  const allowed = new Set(['fastify', 'node:fs', 'node:path', 'node:url', 'node:crypto']); const visited = new Set<string>();
  function visit(name: string) {
    if (visited.has(name)) return; visited.add(name);
    const url = new URL(name, import.meta.url); const source = readFileSync(url, 'utf8');
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    for (const stmt of ast.statements) {
      if (!ts.isImportDeclaration(stmt) || stmt.importClause?.isTypeOnly) continue;
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      if (spec.startsWith('./')) visit(spec.replace(/\.js$/, '.ts'));
      else assert.ok(allowed.has(spec), `unexpected runtime import: ${spec}`);
    }
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/);
  }
  visit('./maintenance-bootstrap-startup.ts');
  const entry = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.ok(entry.indexOf("mode === 'maintenance-bootstrap'") < entry.indexOf("mode === 'standard'"));
  assert.ok(Object.values(productionReadiness()).includes(false));
  for (const key of ['generation', 'conversation', 'revision', 'unattendedEmail', 'hosting'] as const) assert.equal(productionReadiness()[key], false);
});
