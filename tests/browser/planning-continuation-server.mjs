/** Dedicated development harness. No production Server entry imports this file. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializePlanningContinuityFixture, changePlanningContinuitySession, readPlanningContinuitySnapshot } from './planning-continuity-fixture.mjs';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';
import { MahCliTransport } from '../../apps/server/lib/mah-cli-transport.js';
import { createIsolatedGenerationRuntimeServices } from '../../apps/server/lib/runtime-services.js';
import { registerIsolatedGenerationWebAgentRoutes } from '../../apps/server/lib/web-agent-routes.js';
import { registerPlanningSessionRoutes } from '../../apps/server/lib/planning-session-routes.js';
import { registerBookingRoutes } from '../../apps/server/lib/booking-routes.js';
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const Fastify = require('fastify'), esbuild = require('esbuild');
const args = process.argv.slice(2), directoryArg = args[args.indexOf('--data-dir') + 1], port = Number(args[args.indexOf('--port') + 1]);
if (!args.includes('--data-dir') || !args.includes('--port') || !directoryArg || !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Explicit owned empty data directory and port required.');
const directory = path.resolve(directoryArg);
if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || fs.readdirSync(directory).length)) throw Error('Use a new empty owned directory.');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const root = fileURLToPath(new URL('../../', import.meta.url));
const webDirectory = path.join(directory, 'web');
const build = await esbuild.build({ entryPoints: [path.join(root, 'tests/browser/planning-continuation-harness.tsx')], bundle: true,
  nodePaths: [path.join(root, 'apps/web/node_modules')], outdir: webDirectory, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022',
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl' }, metafile: true, logLevel: 'silent' });
const assets = new Map(build.outputFiles.map(file => ['/' + path.basename(file.path), file.contents]));
fs.writeFileSync(path.join(directory, 'asset-manifest.json'), JSON.stringify({ kind: 'isolated_development_harness',
  files: [...assets].map(([name, bytes]) => ({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })),
  metafile: build.metafile }, null, 2), { mode: 0o600 });
const forbidden = () => { throw Error('Development harness forbids outbound network and child processes.'); };
net.Socket.prototype.connect = forbidden; tls.connect = forbidden; dgram.Socket.prototype.send = forbidden; globalThis.fetch = forbidden;
for (const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) childProcess[method] = forbidden;
syncBuiltinESMExports();
const db = path.join(directory, 'workspace.sqlite'); initializePlanningContinuityFixture(db);
const session = changePlanningContinuitySession(db, { create: true, status: 'proposal_ready' });
const slots = { A: session.id, B: null }; const held = new Map(), holdPaths = new Set(), timeline = []; let holdSequence = 0;
const store = new SqliteWorkspaceStore(db); let ready = true;
const commands = [], requests = [], origin = `http://127.0.0.1:${port}`; let taskId = '';
const environment = { MAH_TASK_CLI_COMMAND: '/Applications/MAH.app/Contents/Resources/mah/mah-task-runtime/scripts/task-cli/mah',
  MAH_TASK_CLI_EXECUTABLE: '/Applications/MAH.app/Contents/MacOS/MAH', MAH_TASK_CLI_MAIN: '/Applications/MAH.app/Contents/Resources/mah/mah-task-runtime/dist/cli/index.js', MAH_TASK_CLI_APP: '', MAH_TASK_CLI_TERMINATOR: '--' };
const run = async (_command, commandArgs) => {
  commands.push(commandArgs);
  if (commandArgs[1] === 'submit') {
    taskId = commandArgs[commandArgs.indexOf('--task-id') + 1];
    return { code: 0, stderr: '', stdout: JSON.stringify({ task_id: taskId, title: commandArgs[commandArgs.indexOf('--title') + 1], audit_ref: `.mah/tasks/${taskId}/audit/audit.ndjson`, events_ref: `.mah/tasks/${taskId}/stream.jsonl`, result_ref: { type: 'none' } }) };
  }
  if (commandArgs[1] === 'show') return { code: 0, stderr: '', stdout: JSON.stringify({ ok: true, task_record_materialized: true, task: { task_id: taskId, root_dir: directory, status: 'queued', task_lifecycle_revision: 1 } }) };
  throw Error('Dedicated fake transport rejects any other operation.');
};
const transport = new MahCliTransport({ mahProjectRoot: directory, store: store.generationCarriers, environment, run, schedulerWaitMs: 300000, pollIntervalMs: 100 });
const services = createIsolatedGenerationRuntimeServices({ store, semanticShadow: { enabled: false, sampleRate: 0, timeoutMs: 1000 }, semanticDraftCanary: { enabled: false, localEnvironment: false, allowedSessionIds: [] }, logGenerationFailure() {} }, transport);
const api = Fastify({ logger: false });
registerIsolatedGenerationWebAgentRoutes(api, { store, blueprintGenerationEnabled: true, generation: services.planningGeneration,
  getGeneratingPlan: services.getGeneratingPlan, setGeneratingPlan: services.setGeneratingPlan, business: services.business,
  prepareGeneratedPlanEvidence: async () => ({ workspace: store.getWorkspace(), status: 'partial' }) }, services);
registerPlanningSessionRoutes(api, { store, generation: services.planningGeneration }); registerBookingRoutes(api, { store });
api.get('/api/workspace', async () => store.getWorkspace());
api.get('/api/bookings', async () => ({ bookings: [] }));
api.get('/api/agent-readiness', async () => ({ status: 'blocked', code: 'public_mah_contract_unverified', conversation: false, generation: false, revision: false, unattendedEmail: false, hosting: false }));
const html = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/planning-continuation-harness.css"></head><body><div id="root"></div><script type="module" src="/planning-continuation-harness.js"></script></body></html>');
const server = http.createServer(async (request, response) => {
  const json = (code, body) => { response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
  try {
    if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin && request.headers.origin !== origin) return json(403, { error: 'Wrong development origin.' });
    const url = new URL(request.url, origin);
    if (request.method === 'GET' && url.pathname === '/') { response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return response.end(html); }
    if (request.method === 'GET' && assets.has(url.pathname)) { response.writeHead(200, { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', 'cache-control': 'no-store' }); return response.end(assets.get(url.pathname)); }
    if (request.method === 'GET' && url.pathname === '/__continuation/state') return json(200, { kind: 'isolated_development', ready, requests, fakeCommands: commands, realMahCalls: 0, sessionId: session.id, slots, held: [...held.values()].map(({ release, ...entry }) => entry), timeline });
    if (request.method === 'GET' && url.pathname === '/__continuation/parent') return json(200, { workspace: store.getWorkspace(), slots });
    if (request.method === 'GET' && url.pathname === '/__continuation/snapshot') return json(200, readPlanningContinuitySnapshot(db));
    if (request.method === 'GET' && url.pathname === '/__continuation/check') {
      const live = store.getPlanningSessionById(url.searchParams.get('sessionId') ?? session.id);
      return json(200, live ? { sessionId: live.id, revision: store.getPlanningRevision(live.id), proposalVersion: live.proposal?.version, ready, validUntil: Date.now() + 10000 } : { ready: false });
    }
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw Error('Bounded request exceeded.'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    if (request.method === 'POST' && url.pathname === '/__continuation/control') {
      if (request.headers.origin !== origin || request.headers['content-type']?.split(';')[0] !== 'application/json') return json(403, { error: 'Same-origin control required.' });
      const body = JSON.parse(bytes);
      if (body.action === 'ready' && typeof body.value === 'boolean') ready = body.value;
      else if (body.action === 'advance-proposal') {
        const current = store.getPlanningSessionById(body.sessionId ?? session.id); store.savePlanningSession({ ...current, proposal: { ...current.proposal, version: current.proposal.version + 1 } });
      } else if (body.action === 'session' && ['A','B'].includes(body.slot)) {
        const result = changePlanningContinuitySession(db, { sessionId: slots[body.slot] ?? undefined, create: !slots[body.slot], status: body.status, advanceProposalVersion: body.advanceProposalVersion === true });
        slots[body.slot] = result?.id ?? slots[body.slot];
      } else if (body.action === 'booking-question') {
        const current = store.getPlanningSessionById(body.sessionId);
        if (!current) return json(400, { error: 'Select an existing fictional session.' });
        store.savePlanningSession({ ...current, messages: [...current.messages, { id: 'fixture-booking-question-' + Date.now(), role: 'assistant', text: 'Do you have any flight or hotel bookings?', createdAt: new Date().toISOString() }], updatedAt: new Date().toISOString() });
      } else if (body.action === 'hold' && typeof body.path === 'string' && /^\/api\//.test(body.path) && typeof body.enabled === 'boolean') {
        if (body.enabled) holdPaths.add(body.path); else holdPaths.delete(body.path);
      } else if (body.action === 'release' && typeof body.path === 'string') {
        for (const entry of held.values()) if (entry.path === body.path) entry.release();
      } else return json(400, { error: 'Unknown explicit development control.' });
      return json(200, { ready, session: store.getPlanningSessionById(session.id) });
    }
    if (!url.pathname.startsWith('/api/')) return json(404, { error: 'Not a development route.' });
    requests.push({ method: request.method, path: url.pathname, body: bytes.length ? JSON.parse(bytes) : null });
    timeline.push({ event: 'api_arrived', method: request.method, path: url.pathname, at: new Date().toISOString() });
    const result = await api.inject({ method: request.method, url: url.pathname + url.search, payload: bytes.length ? bytes : undefined, headers: { 'content-type': 'application/json' } });
    timeline.push({ event: 'api_completed', method: request.method, path: url.pathname, status: result.statusCode, at: new Date().toISOString() });
    if (holdPaths.has(url.pathname)) {
      if (held.size >= 8) return json(503, { error: 'Development hold capacity reached.' });
      const id = ++holdSequence;
      await new Promise(resolve => {
        let released = false;
        const release = () => { if (released) return; released = true; clearTimeout(timer); held.delete(id); timeline.push({ event: 'response_released', id, path: url.pathname, at: new Date().toISOString() }); resolve(); };
        const timer = setTimeout(release, 30000);
        held.set(id, { id, path: url.pathname, status: result.statusCode, heldAt: new Date().toISOString(), release });
        timeline.push({ event: 'response_held', id, path: url.pathname, at: new Date().toISOString() });
        response.once('close', release);
      });
    }
    if (!response.destroyed) { response.writeHead(result.statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(result.body); }
  } catch { if (!response.headersSent) json(500, { error: 'Development harness request failed.' }); else response.destroy(); }
});
server.on('connect', (_req, socket) => socket.destroy()); server.on('upgrade', (_req, socket) => socket.destroy());
let closing = false;
async function close() { if (closing) return; closing = true; for (const entry of held.values()) entry.release(); await services.abortGenerationJobs(); await api.close(); server.close(); server.closeAllConnections(); store.close(); }
process.once('SIGTERM', close); process.once('SIGINT', close);
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ kind: 'isolated_planning_continuation', pid: process.pid, port, origin, sessionId: session.id }), { mode: 0o600 });
console.log(JSON.stringify({ kind: 'isolated_planning_continuation_ready', origin, sessionId: session.id, realMahCalls: 0 }));
