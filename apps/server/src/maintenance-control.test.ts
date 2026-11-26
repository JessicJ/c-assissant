import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { createMaintenanceControl } from './maintenance-control.js';
import { registerMaintenanceControl } from './maintenance-control-routes.js';
import { createEmailExecutionWorker } from './email-execution-worker.js';
import { createEmailPlanMonitoringService } from './email-plan-monitoring.js';
import { createPlanningGenerationService } from './planning-generation.js';
import { startServerLifecycle } from './server-lifecycle.js';
import { productionReadiness } from './production-readiness.js';
import type { SqliteWorkspaceStore } from '@c-assistant/storage';

const token = 'fictional-maintenance-token-1234567890';
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function covered() {
  const control = createMaintenanceControl();
  for (const kind of ['http', 'background', 'delivery'] as const) control.cover(kind);
  control.observeGeneration(() => 0);
  return control;
}

test('missing evidence remains unverified, including after drain with no registered work', () => {
  const control = createMaintenanceControl();
  const before = control.snapshot();
  const after = control.enterDrain();
  assert.equal(before.phase, 'normal');
  assert.equal(after.phase, 'draining');
  for (const item of Object.values(after.local)) assert.equal(item.count, null);
  assert.equal(after.persistedOperations.status, 'unverified');
  assert.equal(after.preservedQueuedMail.count, null);
  assert.equal(after.readyToStop, false);
  assert.equal(after.writesDrained, null);
});

test('drain closes admission synchronously, waits existing work and never cancels it', async () => {
  const control = covered(); const work = deferred(); let cancelled = false;
  const running = control.run('background', () => work.promise);
  let pauses = 0; control.onPause(() => { pauses++; });
  assert.equal(control.enterDrain().local.background.count, 1);
  control.enterDrain(); assert.equal(pauses, 1);
  assert.throws(() => control.begin('delivery'), /admission_closed/);
  await assert.rejects(control.run('background', async () => { cancelled = true; }), /admission_closed/);
  assert.equal(cancelled, false);
  work.resolve(); await running;
  assert.equal(control.snapshot().phase, 'locally_drained');
  assert.equal(control.snapshot().readyToStop, false);
});

test('timeouts, failed observers, pause failure and work failures never imply successful drain', async () => {
  let now = 1_000; const control = createMaintenanceControl({ now: () => now });
  const finish = control.begin('http');
  control.enterDrain(10); now += 11;
  assert.equal(control.snapshot().phase, 'blocked'); finish();
  assert.equal(control.snapshot().phase, 'blocked');
  const failed = covered(); failed.onPause(() => { throw new Error('fixture'); });
  failed.observeGeneration(() => { throw new Error('fixture'); });
  assert.equal(failed.enterDrain().local.generation.count, null);
  assert.ok(failed.snapshot().issues.includes('scheduler_pause_failed'));
  const rejected = covered(); await assert.rejects(rejected.run('background', async () => { throw new Error('fixture'); }));
  assert.ok(rejected.enterDrain().issues.includes('background_work_failed'));
});

test('work completion is idempotent; snapshots have no control side effects', () => {
  const control = covered(); const finish = control.begin('http'); finish(); finish();
  const first = control.snapshot(); const second = control.snapshot();
  assert.equal(first.phase, 'normal'); assert.equal(second.local.http.count, 0);
  assert.equal(first.instanceId, second.instanceId);
  assert.equal(second.admissionClosed, false);
  assert.equal(second.executable, false);
});

test('injection: authenticate instance and loopback, preserve pre-admitted work, deny all new business routes', async () => {
  const server = Fastify(); const control = covered();
  registerMaintenanceControl(server, control, token);
  const arrived = deferred(); const release = deferred(); let writes = 0;
  server.post('/fixture/save', async () => { arrived.resolve(); await release.promise; writes++; return { saved: true }; });
  server.get('/fixture/read', async () => ({ ok: true }));
  server.get('/fixture/error', async () => { throw new Error('fixture'); });
  const headers = { authorization: `Bearer ${token}`, 'x-landi-instance-id': control.instanceId };
  try {
    const snapshot = () => server.inject({ method: 'GET', url: '/internal/maintenance/snapshot', headers });
    assert.equal((await server.inject('/internal/maintenance/snapshot')).statusCode, 403);
    assert.equal((await server.inject({ url: '/internal/maintenance/snapshot', headers, remoteAddress: '198.51.100.1' })).statusCode, 403);
    assert.equal((await server.inject({ url: '/internal/maintenance/snapshot', headers: { ...headers, 'x-landi-instance-id': 'wrong' } })).statusCode, 403);
    assert.equal((await server.inject({ method: 'POST', url: '/internal/maintenance/drain', headers, payload: { timeoutMs: -1 } })).statusCode, 400);
    assert.equal((await snapshot()).json().admissionClosed, false);
    assert.equal((await server.inject('/fixture/error')).statusCode, 500);
    assert.equal((await snapshot()).json().local.http.count, 0);
    const saving = server.inject({ method: 'POST', url: '/fixture/save' });
    const pending = Promise.resolve(saving); await arrived.promise;
    const drained = await server.inject({ method: 'POST', url: '/internal/maintenance/drain', headers, payload: {} });
    assert.equal(drained.json().local.http.count, 1);
    assert.equal((await server.inject('/fixture/read')).statusCode, 503);
    assert.equal((await server.inject({ method: 'POST', url: '/fixture/save' })).statusCode, 503);
    assert.equal(writes, 0);
    release.resolve(); assert.equal((await pending).statusCode, 200);
    const result = (await snapshot()).json();
    assert.equal(writes, 1); assert.equal(result.phase, 'locally_drained');
    assert.equal(result.persistedOperations.count, null); assert.equal(result.readyToStop, false);
  } finally { release.resolve(); await server.close(); }
});

test('worker preserves fictional queued messages and makes no storage or transport calls after drain', async () => {
  const control = covered(); let touches = 0;
  const queue = [{ id: 'fictional-queued', status: 'queued' }];
  const store = new Proxy({}, { get() { touches++; throw new Error('must not access storage'); } }) as SqliteWorkspaceStore;
  const worker = createEmailExecutionWorker({ maintenance: control, store,
    getTransport: () => { throw new Error('must not construct transport'); }, render: async () => { throw new Error('must not render'); } });
  control.enterDrain(); await worker.tick(new Map());
  assert.equal(touches, 0); assert.deepEqual(queue, [{ id: 'fictional-queued', status: 'queued' }]);
});

test('in-flight fictional delivery settles naturally; drain does not claim the next queued message', async () => {
  const control = covered(); const sending = deferred(); const receipt = deferred<{ status: 'uncertain'; code: string; retryable: false }>();
  const queued = ['first', 'second']; let claims = 0; let sends = 0;
  const settled: string[] = [];
  const plan = { id: 'fictional-plan', version: 1, status: 'active' };
  const store = { getExecutionPlan: () => plan, email: {
    settings: () => ({ enabled: true, verified: true, revision: 1, recipient: 'fiction@example.invalid' }),
    cancelObsolete: () => {}, enqueue: () => { throw new Error('no new messages expected'); },
    claim: () => { claims++; return { id: queued.shift(), lease: 'fictional-lease', recipientRevision: 1, attempts: 0, expiresAt: '2099-01-01T00:00:00Z', content: { text: 'fictional', html: '<p>fictional</p>', subject: 'fictional' } }; },
    canSend: () => true, settle: (id: string) => { settled.push(id); }
  } } as unknown as SqliteWorkspaceStore;
  const worker = createEmailExecutionWorker({ maintenance: control, store,
    getTransport: () => ({ configured: () => true, verify: async () => ({ ready: true }), send: async () => { sends++; sending.resolve(); return receipt.promise; } }),
    render: async () => { throw new Error('saved content only'); } });
  const running = worker.tick(new Map()); await sending.promise;
  assert.equal(control.enterDrain().local.delivery.count, 1);
  assert.deepEqual(queued, ['second']); assert.deepEqual(settled, []);
  receipt.resolve({ status: 'uncertain', code: 'fictional_unknown', retryable: false }); await running;
  assert.equal(claims, 1); assert.equal(sends, 1);
  assert.deepEqual(settled, ['first']); assert.deepEqual(queued, ['second']);
  assert.equal(control.snapshot().local.delivery.count, 0);
  assert.ok(control.snapshot().issues.includes('delivery_outcome_unknown'));
  assert.notEqual(control.snapshot().phase, 'locally_drained');
});

test('disconnect uncertainty cannot be cleared by a completed request or repeated drain request', () => {
  const control = covered(); const finish = control.begin('http');
  control.markUncertain('request_aborted'); finish();
  assert.ok(control.enterDrain().issues.includes('request_aborted'));
  assert.notEqual(control.enterDrain().phase, 'locally_drained');
});

test('both direct and detached monitor calls are registered, later triggers do nothing', async () => {
  const control = covered(); let reads = 0;
  const store = { getExecutionPlan: () => { reads++; return undefined; }, email: { settings: () => ({}) } } as unknown as SqliteWorkspaceStore;
  const monitor = createEmailPlanMonitoringService({ maintenance: control, store,
    getConnectors: () => { throw new Error('no connectors'); }, logWarning: () => {} });
  monitor.startActivePlanMonitoring();
  assert.ok(control.snapshot().local.background.count! > 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(control.snapshot().local.background.count, 0);
  const prior = reads; control.enterDrain(); monitor.startActivePlanMonitoring();
  await monitor.runItineraryDepartureReminders(); await monitor.runPlanWeatherMonitor();
  assert.equal(reads, prior);
});

test('generation rejects before touching storage; its observer reads no database and stops no task', () => {
  const control = covered(); let touches = 0;
  const store = new Proxy({}, { get() { touches++; throw new Error('fixture must not access database'); } }) as SqliteWorkspaceStore;
  const service = createPlanningGenerationService({ maintenance: control, store, codex: {} as never,
    setGeneratingPlan: () => {}, logGenerationFailure: () => {} });
  assert.equal(control.snapshot().local.generation.count, 0);
  control.enterDrain();
  assert.throws(() => service.enqueuePlanningSessionGeneration({} as never, {} as never), /admission_closed/);
  assert.equal(touches, 0);
});

test('lifecycle pause clears timers, refuses unverified stop, and does not abort supervision or close store', async () => {
  const control = covered(); let clears = 0; let aborted = 0; let closed = 0;
  const server = { listen: async () => {}, close: async () => { closed++; }, log: { warn: () => {} } };
  const lifecycle = await startServerLifecycle({ maintenance: control, server: server as never,
    store: { recoverInterruptedPlanGenerations: () => ({ runs: 0, sessions: 0 }), close: () => { closed++; } } as never,
    activePlanMonitoring: { runItineraryDepartureReminders: async () => {}, runPlanWeatherMonitor: async () => {}, runPlanVenueMonitor: async () => {}, startActivePlanMonitoring: () => {} },
    abortGenerationJobs: async () => { aborted++; }, scheduler: { setInterval: () => 1, clearInterval: () => { clears++; } },
    port: 0, host: '127.0.0.1', installSignalHandlers: false });
  control.enterDrain(); assert.equal(clears, 3);
  await assert.rejects(lifecycle.stop(), /maintenance_stop_unverified/);
  assert.equal(aborted, 0); assert.equal(closed, 0);
});

test('production gates and startup opt-in remain closed', () => {
  assert.equal(productionReadiness().generation, false);
  assert.equal(productionReadiness().hosting, false);
  const startup = readFileSync(new URL('./standard-server-startup.ts', import.meta.url), 'utf8');
  assert.match(startup, /maintenanceToken \? createMaintenanceControl\(\) : undefined/);
});
