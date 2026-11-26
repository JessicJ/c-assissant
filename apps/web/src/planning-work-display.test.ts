import assert from 'node:assert/strict';
import test from 'node:test';
import { planningWorkNotice, savedProcessingUnverified, unverifiedPlanningWork } from './planning-work-display.js';
import { sendAgentChat, getPlanningWorkStatus, PlanningRequirementsSaved } from './api-client.js';

const identity = { sessionId: 'fictional-session', messageId: 'fictional-message', expectedRevision: 0 };
const receipt = { ...identity, savedRevision: 1 };
const observed = (status = 'submission_unknown') => ({ schemaVersion: 1, ...identity, observedAt: new Date().toISOString(), executable: false,
  requirementsSaved: true, saveReceipt: receipt, planningRevision: 1,
  localWork: { workId: 'work', requestId: 'request', taskId: 'same-task', status, savedRevision: 1, resultApplied: false },
  mahStatus: { status: 'unverified', reason: 'not_queried' } });

test('frontend receipt: post-save error preserves verified save instead of rejecting requirements', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ requirementsSaved: true, saveReceipt: receipt }), { status: 503 }));
  await assert.rejects(sendAgentChat({ mode: 'new_plan', message: 'Fictional details', ...identity }), error => {
    assert.ok(error instanceof PlanningRequirementsSaved); assert.deepEqual(error.saveReceipt, receipt); return true;
  });
});
test('frontend receipt: mismatched message, session and revision never clear the pending request', async t => {
  for (const change of [{ messageId: 'other' }, { sessionId: 'other' }, { savedRevision: 8 }]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ requirementsSaved: true, saveReceipt: { ...receipt, ...change } }), { status: 503 }));
    await assert.rejects(sendAgentChat({ mode: 'new_plan', message: 'Fictional details', ...identity }), error => !(error instanceof PlanningRequirementsSaved));
    mock.mock.restore();
  }
});
test('frontend status: request is bounded uncached GET scoped to the existing message', async t => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(observed())); });
  await getPlanningWorkStatus(identity.sessionId, identity.messageId);
  assert.equal(calls.length, 1); assert.equal(calls[0]!.init?.method, 'GET'); assert.equal(calls[0]!.init?.cache, 'no-store');
  assert.ok(calls[0]!.init?.signal); assert.equal(calls[0]!.init?.body, undefined);
  assert.equal(calls[0]!.url, '/api/planning-sessions/fictional-session/messages/fictional-message/status');
});
test('frontend status: local queued/running never claim current remote state or final acceptance', () => {
  for (const status of ['prepared', 'submission_unknown', 'queued', 'running']) assert.equal(planningWorkNotice(observed(status), identity), savedProcessingUnverified);
  assert.match(planningWorkNotice(observed('completed'), identity)!, /reply has not been added/);
  assert.equal(planningWorkNotice({ ...observed('applied'), localWork: { ...observed('applied').localWork, resultApplied: true } }, identity), null);
});
test('frontend status: missing, crossed, future or stale evidence stays unverified', () => {
  const now = Date.now();
  for (const change of [{ requirementsSaved: null }, { sessionId: 'other' }, { messageId: 'other' },
    { observedAt: new Date(now + 1).toISOString() }, { observedAt: new Date(now - 60_001).toISOString() },
    { saveReceipt: { ...receipt, savedRevision: 3 } }]) assert.equal(planningWorkNotice({ ...observed(), ...change }, identity, now), unverifiedPlanningWork);
});

test('persisted project-matched public receipt preserves acceptance while current execution is unknown', () => {
  for (const status of ['queued', 'running']) {
    const value = { ...observed(status), mahStatus: { status: 'unverified', reason: 'not_queried',
      received: true, taskId: 'same-task', source: 'public_task_show', lastObservedStatus: status } };
    const notice = planningWorkNotice(value, identity)!;
    assert.match(notice, /MAH received this request/);
    assert.match(notice, /at the last check/);
    assert.match(notice, /Check the planning result/);
    assert.equal(planningWorkNotice({ ...value, mahStatus: { ...value.mahStatus, taskId: 'other-task' } }, identity), savedProcessingUnverified);
    assert.equal(planningWorkNotice({ ...value, mahStatus: { ...value.mahStatus, source: 'local_work' } }, identity), savedProcessingUnverified);
  }
  for (const status of ['prepared', 'submission_unknown']) {
    assert.equal(planningWorkNotice({ ...observed(status), mahStatus: { status: 'unverified', reason: 'not_queried',
      received: true, taskId: 'same-task', source: 'public_task_show', lastObservedStatus: status } }, identity), savedProcessingUnverified);
  }
});
