import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { collectGuardedPreflight, assessGuardedMetadata, inspectDeclaredArtifacts, parsePreflightArgs } from './guarded-preflight.mjs';
const config = { appRoot: '/fictional/release', plist: '/fictional/service.plist', nodePath: '/fictional/node', label: 'io.fictional.landi', uid: 501, port: 29876 };
const now = Date.parse('2026-10-23T10:00:00Z');
const sha = value => createHash('sha256').update(value).digest('hex');
function responses(changes = {}) {
  const calls = []; let services = 0, processes = 0;
  const query = (kind, args) => {
    calls.push({ kind, args });
    if (changes.fail === kind) throw new Error('SENSITIVE /private/database.sqlite secret-value');
    if (kind === 'plist') return changes.plist ?? JSON.stringify({ Label: config.label, WorkingDirectory: config.appRoot, ProgramArguments: [config.nodePath, config.appRoot + '/apps/server/lib/index.js'], KeepAlive: true, RunAtLoad: true, EnvironmentVariables: { SECRET: 'must-never-leak' } });
    if (kind === 'service') {
      services++;
      return changes.service ?? `fictional = {\n path = ${config.plist}\n state = running\n program = ${config.nodePath}\n working directory = ${config.appRoot}\n pid = ${changes.pidChanged && services > 1 ? 202 : 101}\n arguments = {\n ${config.nodePath}\n ${config.appRoot}/apps/server/lib/index.js\n }\n nested = {\n   state = active\n }\n}`;
    }
    if (kind === 'process') { processes++; return `${changes.startChanged && processes > 1 ? 'Fri Oct 23 17:01:00 2026' : 'Fri Oct 23 17:00:00 2026'} ${changes.wrongExecutable ? '/fictional/other-node' : config.nodePath}`; }
    if (kind === 'port') return changes.port ?? `p101\nn127.0.0.1:${config.port}\n`;
    assert.fail('unexpected command kind');
  };
  return { query, calls };
}
function report(changes) { const x = responses(changes); return { result: collectGuardedPreflight(config, { query: x.query, now: () => now }), calls: x.calls }; }

test('metadata agreement is evidence consistency only; no stop/drain/backup/count inference', () => {
  const { result, calls } = report();
  assert.equal(result.facts.serviceIdentity.status, 'consistent_unverified');
  assert.equal(result.facts.serviceIdentity.keepAlive, true);
  assert.equal(result.status, 'unverified'); assert.equal(result.executable, false); assert.equal(result.databaseAction, 'preserve');
  assert.deepEqual(result.counts, { activeGenerations: null, pendingDeliveries: null, uncertainOperations: null });
  for (const key of ['managerPaused', 'stopVerified', 'writesDrained', 'backupConsistency', 'databaseCompatibility', 'configurationBinding', 'releaseCompleteness', 'installedDependencies']) assert.equal(result.facts[key].status, 'unverified', key);
  assert.deepEqual(calls.map(v => v.kind), ['plist', 'service', 'process', 'port', 'service', 'process']);
});
test('query errors are sanitized, preserve other observations and never imply zero work', () => {
  for (const fail of ['plist', 'service', 'process', 'port']) {
    const { result } = report({ fail }); const text = JSON.stringify(result);
    assert.equal(result.facts.serviceIdentity.status, 'unverified');
    assert.ok(!text.includes('secret-value')); assert.ok(!text.includes('/private/database')); assert.equal(result.counts.activeGenerations, null);
  }
});
test('PID change, start identity change and executable mismatch remain unverified', () => {
  for (const changes of [{ pidChanged: true }, { startChanged: true }, { wrongExecutable: true }]) assert.equal(report(changes).result.facts.serviceIdentity.status, 'unverified');
});
test('unknown, non-loopback, duplicate and foreign port listeners cannot establish identity', () => {
  for (const port of ['', 'p202\nn127.0.0.1:29876\n', 'p101\nn*:29876\n', 'p101\nn127.0.0.1:29876\np202\nn127.0.0.1:29876\n']) assert.equal(report({ port }).result.facts.serviceIdentity.status, 'unverified');
});
test('malformed or conflicting plist/service output is unverified, without raw output leakage', () => {
  for (const changes of [{ plist: 'null' }, { plist: '{broken secret' }, { plist: JSON.stringify({ Label: 'foreign' }) }, { service: 'private raw output' }]) {
    const { result } = report(changes); assert.equal(result.facts.serviceIdentity.status, 'unverified'); assert.ok(!JSON.stringify(result).includes('private raw output'));
  }
});
test('timestamps are not refreshed by report generation; missing/stale/future evidence is unverified', () => {
  for (const stamp of [null, 'invalid', new Date(now - 60_001).toISOString(), new Date(now + 1).toISOString()]) {
    const r = assessGuardedMetadata(config, { service: { ok: true, observedAt: stamp, data: {} } }, now);
    assert.equal(r.facts.service.status, 'unverified'); assert.equal(r.facts.service.observedAt, stamp);
  }
});
test('report excludes configuration, process arguments, private paths, credentials and raw errors', () => {
  const text = JSON.stringify(report().result);
  for (const value of ['must-never-leak', 'EnvironmentVariables', '/fictional/release', '/fictional/service.plist', '/fictional/node', 'ProgramArguments']) assert.ok(!text.includes(value), value);
});
test('CLI requires explicit validated inputs; duplicates, mutations, defaults and unknown flags refused', () => {
  const args = ['--app-root', config.appRoot, '--plist', config.plist, '--node-path', config.nodePath, '--label', config.label, '--uid', '501', '--port', '29876'];
  assert.deepEqual(parsePreflightArgs(args), config);
  for (const values of [[], [...args, '--resume', 'yes'], [...args, '--port', '29877'], [...args, '--manifest', '/fictional/manifest.json'], [...args.slice(0, -1), 'NaN'], [...args, '--manifest-sha256', 'a'.repeat(64)]]) assert.throws(() => parsePreflightArgs(values));
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'landi-preflight-fictional-')));
  const paths = ['apps/server/lib/index.js', 'packages/storage/lib/index.js', 'apps/web/dist/index.html', 'pnpm-lock.yaml'];
  const files = paths.map(path => { const bytes = 'fictional code ' + path; mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); return { path, sha256: sha(bytes) }; });
  return { root, manifest: { version: 1, mode: 'guarded-workbench', projectRoot: root, origin: 'http://127.0.0.1:29876', files } };
}
test('declared artifact hashing uses fictional files only and does not imply full release readiness', () => {
  const x = fixture(); try {
    assert.deepEqual(inspectDeclaredArtifacts(x.root, x.manifest), { declaredFileCount: 4 });
    x.manifest.files[0].sha256 = '0'.repeat(64); assert.throws(() => inspectDeclaredArtifacts(x.root, x.manifest));
  } finally { rmSync(x.root, { recursive: true }); }
});
test('sensitive, outside, traversal and symlink artifact paths are refused before content read', () => {
  const x = fixture(); try {
    const sentinel = join(x.root, 'fake-user.sqlite'); writeFileSync(sentinel, 'fictional private sentinel');
    symlinkSync(sentinel, join(x.root, 'apps/server/lib/linked.js'));
    for (const path of ['data/fake-user.sqlite', '.env', '../fake-user.sqlite', '/private/fake-user.sqlite', 'apps/server/lib/../../data/fake-user.sqlite', 'apps/server/lib/.env', 'apps/server/lib/fake.sqlite', 'apps/server/lib/linked.js']) {
      let reads = 0; assert.throws(() => inspectDeclaredArtifacts(x.root, { files: [{ path, sha256: 'a'.repeat(64) }] }, () => { reads++; assert.fail('sensitive content must not be read'); })); assert.equal(reads, 0);
    }
    assert.equal(readFileSync(sentinel, 'utf8'), 'fictional private sentinel');
  } finally { rmSync(x.root, { recursive: true }); }
});
test('optional manifest report checks bytes and binding; missing/mismatched evidence is unverified', () => {
  const x = fixture(); try {
    const path = join(x.root, 'manifest.json'); const bytes = JSON.stringify(x.manifest); writeFileSync(path, bytes);
    const q = responses(); const c = { ...config, appRoot: x.root, manifest: path, manifestSha256: sha(bytes) };
    const r = collectGuardedPreflight(c, { query: q.query, now: () => now }); assert.equal(r.facts.artifacts.status, 'observed'); assert.equal(r.facts.artifacts.declaredFileCount, 4); assert.equal(r.facts.releaseCompleteness.status, 'unverified');
    const bad = collectGuardedPreflight({ ...c, manifestSha256: '0'.repeat(64) }, { query: q.query, now: () => now }); assert.equal(bad.facts.artifacts.status, 'unverified');
  } finally { rmSync(x.root, { recursive: true }); }
});


test('lsof descriptor: numeric f13 records retain listener and service identity checks', () => {
  for (const fd of ['f13', 'f0', 'f214']) {
    const { result } = report({ port: `p101\n${fd}\nn127.0.0.1:29876\n` });
    assert.equal(result.facts.port.status, 'observed');
    assert.equal(result.facts.serviceIdentity.status, 'consistent_unverified');
    assert.equal(result.status, 'unverified');
    assert.equal(result.executable, false);
    assert.equal(result.facts.writesDrained.status, 'unverified');
    assert.equal(result.facts.backupConsistency.status, 'unverified');
    assert.deepEqual(result.counts, { activeGenerations: null, pendingDeliveries: null, uncertainOperations: null });
  }
});
test('lsof descriptor: missing identity, malformed fields and absent listeners stay unverified', () => {
  for (const port of ['f13\np101\nn127.0.0.1:29876\n', 'p101\nf13\n', 'p101\nf\nn127.0.0.1:29876\n', 'p101\nf13garbage\nn127.0.0.1:29876\n', 'p101\nf13\nxunknown\nn127.0.0.1:29876\n']) {
    const { result } = report({ port });
    assert.equal(result.facts.port.status, 'unverified');
    assert.equal(result.facts.serviceIdentity.status, 'unverified');
    assert.equal(result.executable, false);
  }
});
test('lsof descriptor: foreign owners, duplicate listeners and wrong addresses remain blocked', () => {
  for (const port of ['p202\nf13\nn127.0.0.1:29876\n', 'p101\nf13\nn*:29876\n', 'p101\nf13\nn127.0.0.1:29877\n', 'p101\nf13\nn127.0.0.1:29876\np202\nf14\nn127.0.0.1:29876\n', 'p101\nf13\nn127.0.0.1:29876\nf14\nn127.0.0.1:29876\n']) {
    const { result } = report({ port });
    assert.equal(result.facts.serviceIdentity.status, 'unverified');
    assert.equal(result.executable, false);
  }
});
