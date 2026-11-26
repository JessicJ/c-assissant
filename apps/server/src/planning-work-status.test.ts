import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { SqliteWorkspaceStore } from '@c-assistant/storage';
import { registerPlanningSessionRoutes } from './planning-session-routes.js';
import { registerWebAgentRoutes } from './web-agent-routes.js';
import { productionReadiness } from './production-readiness.js';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'landi-fictional-work-status-')), path = join(dir, 'workspace.sqlite');
  let store = new SqliteWorkspaceStore(path);
  const server = Fastify();
  const saved = store.savePlanningMessage({ messageId: 'fictional-message', expectedRevision: 0, text: 'A fictional trip' });
  const scope = { kind: 'conversation' as const, sessionId: saved.session.id, messageId: 'fictional-message', revision: 1 };
  const url = `/api/planning-sessions/${saved.session.id}/messages/fictional-message/status`;
  const register = () => registerPlanningSessionRoutes(server, { store, generation: {} as never });
  const snapshot = () => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => ({
        name: row.name, rows: db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`).all()
      }));
    } finally { db.close(); }
  };
  t.after(async () => { await server.close(); store.close(); });
  return { server, saved, scope, url, path, register, snapshot, get store() { return store; },
    reopen() { store.close(); store = new SqliteWorkspaceStore(path); } };
}

test('status read: refresh recovers original task and saved revision after newer requirements, without writes', async t => {
  const f = fixture(t), work = f.store.agentWork.prepare(f.scope, { privateInput: 'not public' });
  f.store.agentWork.transition(work.workId, 'submitting'); f.store.agentWork.transition(work.workId, 'submission_unknown');
  f.store.savePlanningMessage({ sessionId: f.saved.session.id, messageId: 'newer', expectedRevision: 1, text: 'A newer preference' });
  f.reopen(); f.register();
  f.store.agentWork.prepare = () => { throw Error('GET must not prepare'); };
  f.store.agentWork.transition = () => { throw Error('GET must not transition'); };
  const before = f.snapshot();
  for (let i = 0; i < 2; i++) {
    const r = await f.server.inject({ method: 'GET', url: f.url }), body = r.json();
    assert.equal(r.statusCode, 200); assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(body.requirementsSaved, true); assert.equal(body.saveReceipt.savedRevision, 1); assert.equal(body.planningRevision, 2);
    assert.equal(body.localWork.taskId, work.carrierTaskId); assert.equal(body.localWork.requestId, work.requestId);
    assert.equal(body.localWork.status, 'submission_unknown'); assert.equal(body.localWork.resultApplied, false);
    assert.equal(body.mahStatus.status, 'unverified'); assert.equal(body.executable, false);
    assert.ok(!r.body.includes('privateInput'));
  }
  assert.deepEqual(f.snapshot(), before);
});
test('status read: saved message without Work stays recorded without creating a task', async t => {
  const f = fixture(t); f.register(); const before = f.snapshot();
  const body = (await f.server.inject({ method: 'GET', url: f.url })).json();
  assert.equal(body.requirementsSaved, true); assert.equal(body.localWork, null); assert.equal(body.code, 'planning_work_unrecorded');
  assert.deepEqual(f.snapshot(), before);
});
test('status read: legacy missing receipt remains unverified instead of guessing from message count', async t => {
  const f = fixture(t), db = new DatabaseSync(f.path);
  db.prepare('DELETE FROM planning_message_receipts WHERE message_id=?').run('fictional-message'); db.close(); f.register();
  const body = (await f.server.inject({ method: 'GET', url: f.url })).json();
  assert.equal(body.requirementsSaved, null); assert.equal(body.saveReceipt, null); assert.equal(body.code, 'planning_save_receipt_missing');
});
test('status read: corrupt save evidence returns unverified without exposing errors or repairing data', async t => {
  const f = fixture(t), db = new DatabaseSync(f.path);
  db.prepare('UPDATE planning_message_receipts SET input_sha256=? WHERE message_id=?').run('corrupt', 'fictional-message'); db.close(); f.register();
  const before = f.snapshot(), r = await f.server.inject({ method: 'GET', url: f.url });
  assert.equal(r.statusCode, 503); assert.equal(r.json().requirementsSaved, null); assert.equal(r.json().code, 'planning_work_unverified');
  assert.ok(!r.body.includes('corrupt')); assert.deepEqual(f.snapshot(), before);
});
test('status read: a message from another session cannot supply the save receipt or task', async t => {
  const f = fixture(t), other = f.store.createPlanningSession(); f.register();
  const r = await f.server.inject({ method: 'GET', url: `/api/planning-sessions/${other.id}/messages/fictional-message/status` });
  assert.equal(r.statusCode, 404); assert.equal(r.json().code, 'planning_message_missing');
});
test('status read: completed local Work does not imply accepted, applied or remote completed', async t => {
  const f = fixture(t), work = f.store.agentWork.prepare(f.scope, {});
  f.store.agentWork.transition(work.workId, 'submitting'); f.store.agentWork.transition(work.workId, 'completed'); f.register();
  const body = (await f.server.inject({ method: 'GET', url: f.url })).json();
  assert.equal(body.localWork.status, 'completed'); assert.equal(body.localWork.resultApplied, false); assert.equal(body.mahStatus.status, 'unverified');
  assert.equal(f.store.getPlanningSessionById(f.saved.session.id)?.messages.length, 1);
});
function chatRoutes(f: ReturnType<typeof fixture>) {
  registerWebAgentRoutes(f.server, { store: f.store, blueprintGenerationEnabled: false, generation: {} as never, business: {} as never,
    getGeneratingPlan: () => false, setGeneratingPlan: () => { throw Error('must not execute'); },
    prepareGeneratedPlanEvidence: async () => { throw Error('must not execute'); } });
}
test('save receipt: failure after commit reports saved requirements and preserves exact receipt for GET', async t => {
  const f = fixture(t); chatRoutes(f); f.register();
  f.store.agentWork.prepare = () => { throw Error('fictional post-save processing failure'); };
  const r = await f.server.inject({ method: 'POST', url: '/api/agent/chat', payload: {
    mode: 'new_plan', sessionId: f.saved.session.id, messageId: 'second', expectedRevision: 1, message: 'A second fictional detail' } });
  assert.equal(r.statusCode, 503); assert.equal(r.json().requirementsSaved, true); assert.equal(r.json().code, 'planning_processing_unverified');
  assert.equal(r.json().saveReceipt.messageId, 'second'); assert.equal(r.json().saveReceipt.savedRevision, 2);
  const status = (await f.server.inject({ method: 'GET', url: f.url.replace('fictional-message/status', 'second/status') })).json();
  assert.deepEqual(status.saveReceipt, r.json().saveReceipt); assert.equal(status.localWork, null);
  assert.equal(productionReadiness().conversation, false);
});
test('save receipt: stale writes never claim saved; closed-gate successful retry keeps one message and receipt', async t => {
  const f = fixture(t); chatRoutes(f);
  const payload = { mode: 'new_plan', sessionId: f.saved.session.id, messageId: 'second', expectedRevision: 1, message: 'Another detail' };
  const r = await f.server.inject({ method: 'POST', url: '/api/agent/chat', payload });
  const retry = await f.server.inject({ method: 'POST', url: '/api/agent/chat', payload });
  assert.equal(r.statusCode, 200); assert.equal(r.json().requirementsSaved, true); assert.equal(r.json().blocked, true);
  assert.deepEqual(r.json().saveReceipt, retry.json().saveReceipt); assert.equal(retry.json().reused, true);
  assert.equal(f.store.getPlanningSessionById(f.saved.session.id)?.messages.length, 2);
  const stale = await f.server.inject({ method: 'POST', url: '/api/agent/chat', payload: { ...payload, messageId: 'stale' } });
  assert.equal(stale.statusCode, 409); assert.notEqual(stale.json().requirementsSaved, true);
});

test('原消息精确GET支持首次无会话回执丢失，重启重复只读且不泄漏原文', async t => {
  const f = fixture(t); f.reopen(); f.register();
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(JSON.stringify({ text: 'A fictional trip' })).digest('hex');
  const url = `/api/planning-messages/fictional-message/status?expectedRevision=0&inputSha256=${digest}`;
  const before = f.snapshot();
  for (let i = 0; i < 2; i++) {
    const r = await f.server.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 200); assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.json().requirementsSaved, true); assert.equal(r.json().executable, false);
    assert.equal(r.json().saveReceipt.sessionId, f.saved.session.id); assert.equal(r.json().saveReceipt.savedRevision, 1);
    assert.equal(r.json().inputSha256, digest); assert.equal(r.body.includes('A fictional trip'), false);
  }
  for (const wrong of [url.replace('expectedRevision=0', 'expectedRevision=2'), url.replace(digest, 'a'.repeat(64)), `${url}&sessionId=wrong`]) {
    const r = await f.server.inject({ method: 'GET', url: wrong });
    assert.equal(r.statusCode, 503); assert.equal(r.json().requirementsSaved, null);
  }
  const missing = await f.server.inject({ method: 'GET', url: url.replace('fictional-message/status', 'missing/status') });
  assert.equal(missing.statusCode, 404); assert.equal(missing.json().requirementsSaved, null);
  assert.deepEqual(f.snapshot(), before);
});

test('受控实例允许两种原消息只读核对，仍禁止确认生成', async t => {
  const f = fixture(t);
  const { registerGuardedRequestAdmission } = await import('./guarded-request-admission.js');
  const { createHash } = await import('node:crypto');
  registerGuardedRequestAdmission(f.server); f.register();
  const digest = createHash('sha256').update(JSON.stringify({ text: 'A fictional trip' })).digest('hex');
  assert.equal((await f.server.inject({ method: 'GET', url: f.url })).statusCode, 200);
  assert.equal((await f.server.inject({ method: 'GET', url: `/api/planning-messages/fictional-message/status?expectedRevision=0&inputSha256=${digest}` })).statusCode, 200);
  assert.equal((await f.server.inject({ method: 'POST', url: `/api/planning-sessions/${f.saved.session.id}/generation/cancel` })).statusCode, 503);
});

test('status read retains prior public receipt across reopen while current MAH state remains unqueried', async t => {
  for (const status of ['queued', 'running'] as const) {
    const f = fixture(t), work = f.store.agentWork.prepare(f.scope, {});
    f.store.agentWork.transition(work.workId, 'submitting');
    f.store.agentWork.transition(work.workId, status);
    f.reopen(); f.register();
    const before = f.snapshot();
    const body = (await f.server.inject({ method: 'GET', url: f.url })).json();
    assert.equal(body.mahStatus.status, 'unverified');
    assert.equal(body.mahStatus.reason, 'not_queried');
    assert.equal(body.mahStatus.received, true);
    assert.equal(body.mahStatus.taskId, work.carrierTaskId);
    assert.equal(body.mahStatus.lastObservedStatus, status);
    assert.equal(body.mahStatus.source, 'public_task_show');
    assert.deepEqual(f.snapshot(), before);
  }
});

test('status read cannot turn local preparation or submission uncertainty into MAH receipt', async t => {
  const f = fixture(t), work = f.store.agentWork.prepare(f.scope, {});
  f.register();
  for (const status of ['prepared', 'submitting', 'submission_unknown'] as const) {
    if (status !== 'prepared') f.store.agentWork.transition(work.workId, status);
    const body = (await f.server.inject({ method: 'GET', url: f.url })).json();
    assert.notEqual(body.mahStatus.received, true);
    assert.equal(body.mahStatus.status, 'unverified');
  }
});
