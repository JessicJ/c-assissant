import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const item = (status, source, observedAt, reason, facts = {}) => ({ status, source, observedAt, reason, ...facts });
const missing = (source, at, reason = 'evidence_not_collected') => item('unverified', source, at, reason);
const maxBytes = 16 * 1024 * 1024;

export function validatePreflightConfig(value) {
  if (!value || !['appRoot', 'plist', 'nodePath'].every(key => typeof value[key] === 'string' && isAbsolute(value[key])) ||
      typeof value.label !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,127}$/.test(value.label) ||
      !Number.isSafeInteger(value.uid) || value.uid < 0 || !Number.isSafeInteger(value.port) || value.port < 1024 || value.port > 65535 ||
      (value.manifest !== undefined && (typeof value.manifest !== 'string' || !isAbsolute(value.manifest) || !validSha(value.manifestSha256))) ||
      (value.manifest === undefined && value.manifestSha256 !== undefined)) throw new Error('invalid_preflight_config');
  // A metadata JSON input is never an arbitrary configuration/database reader.
  if (!value.plist.endsWith('.plist') || value.manifest !== undefined && !value.manifest.endsWith('.json')) throw new Error('invalid_preflight_config');
  return { ...value, appRoot: resolve(value.appRoot), plist: resolve(value.plist), nodePath: resolve(value.nodePath) };
}

function boundedRead(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('metadata_file_refused');
  return readFileSync(path);
}

/** Inspect release code only. Never follow a manifest into configuration or data. */
export function inspectDeclaredArtifacts(appRoot, manifest, read = boundedRead) {
  const files = manifest?.files;
  if (!Array.isArray(files) || !files.length || files.length > 50_000) throw new Error('artifact_list_invalid');
  const root = realpathSync(appRoot), seen = new Set();
  const mandatory = ['apps/server/lib/index.js', 'packages/storage/lib/index.js', 'apps/web/dist/index.html', 'pnpm-lock.yaml'];
  for (const entry of files) {
    if (!entry || typeof entry.path !== 'string' || isAbsolute(entry.path) || !validSha(entry.sha256)) throw new Error('artifact_entry_invalid');
    const local = entry.path;
    if (local.includes('\\') || local.split('/').some(part => !part || part === '.' || part === '..') ||
        !(/^(apps\/(server\/lib|web\/dist)|packages\/[a-zA-Z0-9_-]+\/lib)\//.test(local) || local === 'pnpm-lock.yaml') ||
        /(?:^|\/)(?:\.env[^/]*|node_modules|data|logs?)(?:\/|$)|\.(?:sqlite(?:-wal|-shm|-journal)?|db|env|log)$/i.test(local) || seen.has(local)) throw new Error('artifact_path_refused');
    const path = resolve(root, local);
    const canonical = realpathSync(path);
    if (relative(root, canonical).startsWith('..') || isAbsolute(relative(root, canonical)) || canonical !== path) throw new Error('artifact_path_refused');
    if (sha(read(path)) !== entry.sha256) throw new Error('artifact_digest_mismatch');
    seen.add(local);
  }
  if (!mandatory.every(path => seen.has(path))) throw new Error('artifact_unit_incomplete');
  return { declaredFileCount: seen.size };
}

// These are the only operating-system commands this module can issue.
function query(kind, args) {
  const spec = {
    plist: ['/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', args.path]],
    service: ['/bin/launchctl', ['print', `gui/${args.uid}/${args.label}`]],
    process: ['/bin/ps', ['-p', String(args.pid), '-o', 'lstart=', '-o', 'comm=']],
    port: ['/usr/sbin/lsof', ['-nP', '-a', `-iTCP:${args.port}`, '-sTCP:LISTEN', '-Fpn']]
  }[kind];
  if (!spec) throw new Error('query_not_allowed');
  if (kind === 'plist') {
    const stat = lstatSync(args.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes || realpathSync(args.path) !== resolve(args.path)) throw new Error('metadata_file_refused');
  }
  return execFileSync(spec[0], spec[1], { encoding: 'utf8', timeout: 5000, maxBuffer: maxBytes, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseService(text) {
  const one = key => {
    const matches = [...text.matchAll(new RegExp(`^[ \t]*${key} = (.+)$`, 'gm'))];
    if (!matches.length) throw new Error('service_projection_ambiguous');
    const indentation = match => match[0].match(/^[ \t]*/)[0].length;
    const depth = Math.min(...matches.map(indentation));
    const top = matches.filter(match => indentation(match) === depth);
    if (top.length !== 1) throw new Error('service_projection_ambiguous');
    return top[0][1].trim();
  };
  const pid = Number(one('pid'));
  const args = [...text.matchAll(/^[ \t]*arguments = \{[ \t]*\n([\s\S]*?)^[ \t]*\}/gm)];
  if (!Number.isSafeInteger(pid) || pid < 1 || args.length !== 1) throw new Error('service_projection_invalid');
  return { pid, state: one('state'), program: one('program'), path: one('path'), cwd: one('working directory'),
    argv: args[0][1].split('\n').map(v => v.trim()).filter(Boolean) };
}
function parseProcess(text) {
  const match = text.trim().match(/^([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/);
  if (!match || !safeTime(match[1])) throw new Error('process_projection_invalid');
  return { startedAt: new Date(Date.parse(match[1])).toISOString(), executable: match[2] };
}
function parsePort(text, port) {
  let pid;
  const owners = [];
  for (const line of text.trim().split('\n')) {
    if (/^p[1-9]\d*$/.test(line)) pid = Number(line.slice(1));
    else if (/^f\d+$/.test(line)) {
      if (!pid) throw new Error('port_projection_invalid');
      // lsof emits descriptor records even when only p/n fields are requested.
    } else if (line.startsWith('n')) {
      if (!pid || line !== `n127.0.0.1:${port}`) throw new Error('port_projection_invalid');
      owners.push(pid);
    } else if (line) throw new Error('port_projection_invalid');
  }
  if (owners.length !== 1) throw new Error('port_projection_ambiguous');
  return owners[0];
}

/** Observations never establish permission to stop, start, migrate or resume. */
export function assessGuardedMetadata(config, observations, now = Date.now()) {
  const at = new Date(Number.isFinite(now) ? now : 0).toISOString();
  const facts = {};
  const fresh = value => value && safeTime(value.observedAt) && Number.isFinite(now) && Date.parse(value.observedAt) <= now && now - Date.parse(value.observedAt) <= 60_000;
  for (const key of ['plist', 'service', 'serviceAfter', 'process', 'processAfter', 'port', 'artifacts']) {
    const value = observations[key];
    facts[key] = fresh(value) && value.ok === true ? item('observed', key, value.observedAt, 'metadata_observed', value.publicFacts ?? {}) : missing(key, value?.observedAt ?? null, value?.ok === false ? 'query_or_parse_failed' : 'missing_or_stale_evidence');
  }
  const p = observations.plist, s = observations.service, after = observations.serviceAfter, proc = observations.process, procAfter = observations.processAfter, port = observations.port;
  const all = [p, s, after, proc, procAfter, port].every(value => fresh(value) && value.ok === true && value.data && typeof value.data === 'object');
  const expectedEntry = resolve(config.appRoot, 'apps/server/lib/index.js');
  const identity = all && [s.data, after.data].every(v => v.state === 'running' && v.pid === s.data.pid && v.program === config.nodePath && v.path === config.plist && v.cwd === config.appRoot && v.argv?.length === 2 && v.argv[0] === config.nodePath && v.argv[1] === expectedEntry) &&
    p.data.Label === config.label && p.data.WorkingDirectory === config.appRoot && p.data.ProgramArguments?.length === 2 && p.data.ProgramArguments[0] === config.nodePath && p.data.ProgramArguments[1] === expectedEntry &&
    proc.data.executable === config.nodePath && procAfter.data.executable === config.nodePath && proc.data.startedAt === procAfter.data.startedAt && Date.parse(proc.data.startedAt) <= Date.parse(proc.observedAt) && port.data.pid === s.data.pid;
  facts.serviceIdentity = item(identity ? 'consistent_unverified' : 'unverified', 'plist+launchd+process+listener', at, identity ? 'metadata_identity_consistent_only' : 'identity_missing_or_conflicting', identity ? { pid: s.data.pid, startedAt: proc.data.startedAt, keepAlive: p.data.KeepAlive === true, runAtLoad: p.data.RunAtLoad === true } : {});
  for (const key of ['managerPaused', 'stopVerified', 'writesDrained', 'activeGenerations', 'pendingDeliveries', 'uncertainOperations', 'backupConsistency', 'databaseCompatibility', 'configurationBinding', 'releaseCompleteness', 'installedDependencies']) facts[key] = missing('not_collected_by_metadata_preflight', null);
  return { schemaVersion: 1, status: 'unverified', executable: false, databaseAction: 'preserve', observedAt: at,
    bindingSha256: sha(JSON.stringify({ root: config.appRoot, plist: config.plist, node: config.nodePath, label: config.label, uid: config.uid, port: config.port })),
    counts: { activeGenerations: null, pendingDeliveries: null, uncertainOperations: null }, facts };
}

export function collectGuardedPreflight(input, dependencies = {}) {
  const config = validatePreflightConfig(input), run = dependencies.query ?? query, clock = dependencies.now ?? Date.now;
  const observations = {};
  function collect(key, operation, publicFacts = () => ({})) {
    try { const data = operation(); observations[key] = { ok: true, observedAt: new Date(clock()).toISOString(), data, publicFacts: publicFacts(data) }; }
    catch { observations[key] = { ok: false, observedAt: new Date(clock()).toISOString() }; }
  }
  collect('plist', () => { const data = JSON.parse(run('plist', { path: config.plist })); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('plist_invalid'); return data; });
  collect('service', () => parseService(run('service', config)));
  if (observations.service.ok) collect('process', () => parseProcess(run('process', { pid: observations.service.data.pid })));
  collect('port', () => ({ pid: parsePort(run('port', { port: config.port }), config.port) }));
  if (config.manifest) collect('artifacts', () => {
    const bytes = boundedRead(config.manifest);
    if (sha(bytes) !== config.manifestSha256) throw new Error('manifest_digest_mismatch');
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.version !== 1 || manifest.mode !== 'guarded-workbench' || manifest.projectRoot !== config.appRoot || manifest.origin !== `http://127.0.0.1:${config.port}`) throw new Error('manifest_binding_mismatch');
    return inspectDeclaredArtifacts(config.appRoot, manifest);
  }, data => ({ ...data, manifestSha256: config.manifestSha256 }));
  collect('serviceAfter', () => parseService(run('service', config)));
  if (observations.serviceAfter.ok) collect('processAfter', () => parseProcess(run('process', { pid: observations.serviceAfter.data.pid })));
  return assessGuardedMetadata(config, observations, clock());
}

export function parsePreflightArgs(args) {
  const names = { '--app-root': 'appRoot', '--plist': 'plist', '--node-path': 'nodePath', '--label': 'label', '--uid': 'uid', '--port': 'port', '--manifest': 'manifest', '--manifest-sha256': 'manifestSha256' }, result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]], value = args[i + 1];
    if (!key || Object.hasOwn(result, key) || typeof value !== 'string' || value.startsWith('--') || ['uid', 'port'].includes(key) && !/^\d+$/.test(value)) throw new Error('invalid_preflight_config');
    result[key] = ['uid', 'port'].includes(key) ? Number(value) : value;
  }
  return validatePreflightConfig(result);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(collectGuardedPreflight(parsePreflightArgs(process.argv.slice(2))), null, 2) + '\n'); }
  catch { process.stderr.write('Preflight configuration invalid; no readiness established.\n'); process.exitCode = 2; }
}
