import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { SqliteWorkspaceStore } from '@c-assistant/storage';
import { MahPlanningConversationService } from './mah-planning-conversation.js';
import { createMahPlanningRuntimeFactory } from './mah-planning-runtime.js';
import { MAH_BUSINESS_JOURNAL_SCHEMA, SqliteMahBusinessSubmissionJournal } from './mah-business-journal.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import type { MahBusinessRequest } from './mah-business-contract.js';
import type { MahPublicRead } from './mah-business-public-result.js';
import { productionReadiness } from './production-readiness.js';
import { registerWebAgentRoutes } from './web-agent-routes.js';

const ROOT = '/fictional/landi';
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(process.env.LANDI_CONVERSATION_CHECK_ROOT ?? tmpdir(), 'fictional-conversation-'));
  const path = join(dir, 'workspace.sqlite'), journalPath = join(dir, 'journal.sqlite');
  writeFileSync(journalPath, '', { mode: 0o600, flag: 'wx' });
  let store = new SqliteWorkspaceStore(path), db = new DatabaseSync(journalPath);
  db.exec(MAH_BUSINESS_JOURNAL_SCHEMA);
  store.updateProfile({ displayName: 'Fictional traveler', preferredLanguage: 'English', nationality: 'Unspecified', gender: 'not_specified', immigrationStatus: 'unknown' });
  const session = store.createPlanningSession();
  let request: MahBusinessRequest, taskId = '', submits = 0, commands = 0;
  const state = { dropReceipt: false, corruptResult: false, publicContract: true, taskStatus: 'completed', beforeRead: undefined as (() => void) | undefined };
  const payload = { reply: 'When would you like to visit Fictional City?', facts: [{ key: 'destination', value: 'Fictional City' }], clarification: null };
  const raw = () => JSON.stringify({ schemaVersion: 1, kind: 'landi_business_result', requestId: state.corruptResult ? '33333333-3333-4333-8333-333333333333' : request.requestId,
    operation: request.operation, scope: request.scope, businessTime: request.businessTime, inputSha256: request.input.sha256,
    outcome: 'succeeded', contract: request.output.contract, payload });
  const run: MahPublicRead = async args => {
    commands++;
    let value: unknown;
    if (args[1] === 'submit') {
      submits++; taskId = args[args.indexOf('--task-id') + 1]!;
      if (state.dropReceipt) { state.dropReceipt = false; throw Error('fictional lost receipt'); }
      value = { ok: true, task_id: taskId, project_root: ROOT, admission_status: 'ready', personal_os_slot: { slot_class: 'interactive', workload_ref: `task:${taskId}` } };
    } else if (args[1] === 'show') {
      assert.equal(args[2], taskId);
      value = { ok: true, task: { task_id: taskId, root_dir: ROOT, status: state.taskStatus, task_lifecycle_revision: 1,
        agent: 'codex', direct_runtime_model_id: 'fictional-model', model_routing: { selected: { agent_id: 'codex' } },
        attachments: [{ sha256: sha256(canonicalJson(request)), size: Buffer.byteLength(canonicalJson(request)), read_state: 'present' }],
        created_at: request.businessTime, updated_at: request.businessTime,
        observability: { lifecycle: { running_at: request.businessTime, completed_at: request.businessTime, last_status: 'completed' } } } };
    } else if (args.includes('--read')) {
      state.beforeRead?.(); state.beforeRead = undefined;
      value = { content: raw() };
    } else value = [{ subpath: 'artifacts/landi-business-result.json', size: Buffer.byteLength(raw()) }];
    return { code: 0, stdout: JSON.stringify(value) };
  };
  const service = (publicReceipt = false) => {
    const factory = createMahPlanningRuntimeFactory({ projectRoot: ROOT, journal: new SqliteMahBusinessSubmissionJournal(db), run, waitMs: 1, pollMs: 1,
      assertContract: async r => { if (!state.publicContract) throw Error('fictional public contract missing'); request = structuredClone(r); },
      ...(publicReceipt ? {} : { verifyReceipt: async (r: MahBusinessRequest, c: { artifactSha256: string; taskId: string }) => ({ requestSha256: sha256(canonicalJson(r)), artifactSha256: c.artifactSha256, taskId: c.taskId,
        agentId: 'fictional-codex', modelId: 'fictional-model', startedAt: r.businessTime, completedAt: r.businessTime }) }) });
    return new MahPlanningConversationService({ store, runtimeForWork: factory });
  };
  const save = (messageId = 'fictional-message', expectedRevision = 0, text = 'Plan a fictional visit') =>
    store.savePlanningMessage({ sessionId: session.id, messageId, expectedRevision, text });
  const work = () => store.agentWork.findByScope({ kind: 'conversation', sessionId: session.id, messageId: 'fictional-message', revision: 1 })!;
  t.after(() => { store.close(); db.close(); });
  return { dir, session, state, service, save, work, get store() { return store; }, get db() { return db; },
    get submits() { return submits; }, get commands() { return commands; }, get taskId() { return taskId; },
    reopen() { store.close(); db.close(); store = new SqliteWorkspaceStore(path); db = new DatabaseSync(journalPath); } };
}

test('saved requirement -> scoped MAH runtime -> atomic application preserves user ID and adds one assistant', async t => {
  const f = fixture(t), saved = f.save(), message = saved.session.messages[0]!;
  const result = await f.service().continueSavedMessage(saved, message.id);
  assert.equal(f.submits, 1); assert.equal(f.work().carrierTaskId, f.taskId);
  assert.equal(f.work().status, 'applied'); assert.equal(result.planningRevision, 2);
  assert.deepEqual(result.planningSession.messages[0], message);
  assert.deepEqual(result.planningSession.messages.map(m => m.role), ['user', 'assistant']);
  assert.ok(result.planningSession.facts.some(fact => fact.value === 'Fictional City'));
  assert.equal(result.generated, false); assert.equal(result.blocked, false);
});
test('applied retry reuses result even after newer requirements, without overwriting them', async t => {
  const f = fixture(t); await f.service().continueSavedMessage(f.save(), 'fictional-message');
  f.save('second-message', 2, 'A newer fictional preference');
  const result = await f.service().continueSavedMessage(f.save(), 'fictional-message');
  assert.equal(result.reused, true); assert.equal(f.submits, 1); assert.equal(result.planningRevision, 3);
  assert.equal(result.planningSession.messages.at(-1)?.id, 'second-message');
});
test('lost receipt and cold reopen retain frozen request and Task, with no duplicate submission', async t => {
  const f = fixture(t); f.state.dropReceipt = true;
  await assert.rejects(f.service().continueSavedMessage(f.save(), 'fictional-message'), /lost receipt/);
  const original = f.work(); assert.equal(original.status, 'submission_unknown');
  f.reopen();
  const result = await f.service().continueSavedMessage(f.save(), 'fictional-message');
  assert.equal(f.submits, 1); assert.equal(f.work().requestId, original.requestId);
  assert.equal(f.work().carrierTaskId, original.carrierTaskId); assert.equal(result.planningSession.messages.length, 2);
});
test('newer requirement during MAH execution rejects stale application', async t => {
  const f = fixture(t); f.state.beforeRead = () => { f.save('newer', 1, 'Keep my newer preference'); };
  await assert.rejects(f.service().continueSavedMessage(f.save(), 'fictional-message'), /work_scope_stale/);
  const session = f.store.getPlanningSessionById(f.session.id)!;
  assert.deepEqual(session.messages.map(m => m.role), ['user', 'user']);
  assert.equal(session.messages.at(-1)?.id, 'newer'); assert.equal(f.work().status, 'validated');
});
test('switching active session rejects the old result without editing either session', async t => {
  const f = fixture(t); f.state.beforeRead = () => { f.store.createPlanningSession(); };
  await assert.rejects(f.service().continueSavedMessage(f.save(), 'fictional-message'), /work_scope_stale/);
  assert.equal(f.store.getPlanningSessionById(f.session.id)?.status, 'abandoned');
  assert.equal(f.store.getPlanningSessionById(f.session.id)?.messages.length, 1);
  assert.equal(f.store.getPlanningSession()?.messages.length, 0);
});
test('application failure rolls back session and revision; validated retry makes no further runtime call', async t => {
  const f = fixture(t), saved = f.save(), original = f.store.savePlanningSession.bind(f.store);
  f.store.savePlanningSession = session => { original(session); throw Error('fictional application interruption'); };
  await assert.rejects(f.service().continueSavedMessage(saved, 'fictional-message'), /application interruption/);
  assert.equal(f.store.getPlanningRevision(f.session.id), 1);
  assert.equal(f.store.getPlanningSessionById(f.session.id)?.messages.length, 1); assert.equal(f.work().status, 'validated');
  const before = f.commands; f.store.savePlanningSession = original;
  await f.service().continueSavedMessage(f.save(), 'fictional-message');
  assert.equal(f.commands, before); assert.equal(f.work().status, 'applied');
});
test('cross-request result is rejected before any assistant or facts are applied', async t => {
  const f = fixture(t); f.state.corruptResult = true;
  await assert.rejects(f.service().continueSavedMessage(f.save(), 'fictional-message'), /identity_mismatch/);
  assert.equal(f.store.getPlanningSessionById(f.session.id)?.messages.length, 1);
  assert.equal(f.store.getPlanningSessionById(f.session.id)?.facts.length, 0);
});
test('legacy metadata-only blocked work is preserved without being silently rewritten', async t => {
  const f = fixture(t), saved = f.save();
  const work = f.store.agentWork.prepare({ kind: 'conversation', sessionId: f.session.id, messageId: 'fictional-message', revision: 1 }, { sessionId: f.session.id, messageId: 'fictional-message', revision: 1 });
  f.store.agentWork.transition(work.workId, 'blocked');
  await assert.rejects(f.service().continueSavedMessage(saved, 'fictional-message'), /snapshot_unavailable/);
  assert.equal(f.work().inputSha256, work.inputSha256); assert.equal(f.work().status, 'blocked'); assert.equal(f.commands, 0);
});
test('public contract rejection leaves saved requirement intact and performs no command', async t => {
  const f = fixture(t); f.state.publicContract = false;
  await assert.rejects(f.service().continueSavedMessage(f.save(), 'fictional-message'), /public contract missing/);
  assert.equal(f.commands, 0); assert.equal(f.store.getPlanningSessionById(f.session.id)?.messages.length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mah_business_submissions').get()?.n, 0);
});
test('normal route invokes connected planning service while retaining a saved receipt on failure', async t => {
  const f = fixture(t), server = Fastify(); t.after(() => server.close());
  let called = false;
  const service = f.service(); service.continueSavedMessage = async () => { called = true; throw Error('must remain closed'); };
  registerWebAgentRoutes(server, { store: f.store, planningConversation: service, blueprintGenerationEnabled: false,
    generation: {} as never, business: {} as never, getGeneratingPlan: () => false, setGeneratingPlan: () => {},
    prepareGeneratedPlanEvidence: async () => { throw Error('must not generate'); } });
  const response = await server.inject({ method: 'POST', url: '/api/agent/chat', payload: {
    mode: 'new_plan', message: 'Fictional route requirement', sessionId: f.session.id, messageId: 'route-message', expectedRevision: 0 } });
  assert.equal(response.statusCode, 503); assert.equal(response.json().requirementsSaved, true); assert.equal(called, true);
  assert.equal(productionReadiness().conversation, false); assert.equal(f.commands, 0);
});
test('public receipt provider integrates with frozen Work, journal and transactional conversation application', async t => {
  const f = fixture(t);
  const result = await f.service(true).continueSavedMessage(f.save(), 'fictional-message');
  assert.equal(f.work().status, 'applied'); assert.equal(f.work().carrierTaskId, f.taskId);
  assert.equal(result.planningSession.messages.length, 2); assert.equal(f.submits, 1);
});

test('explicit result check never submits a work absent from the journal', async t => {
  const f = fixture(t), saved = f.save();
  await assert.rejects(f.service().continueSavedMessage(saved, 'fictional-message', true), /work_missing/);
  assert.equal(f.submits, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mah_business_submissions').get()?.n, 0);
});

test('timed out task completes through explicit same-task result check without resubmission', async t => {
  const f = fixture(t), saved = f.save();
  f.state.taskStatus = 'running';
  await assert.rejects(f.service().continueSavedMessage(saved, 'fictional-message'), /wait_expired/);
  assert.equal(f.work().status, 'running');
  f.state.taskStatus = 'completed';
  const result = await f.service().continueSavedMessage(saved, 'fictional-message', true);
  assert.equal(f.submits, 1);
  assert.equal(result.planningSession.messages.length, 2);
  assert.equal(f.work().status, 'applied');
});

test('explicit result check rejects an unknown message before saving any input', async t => {
  const f = fixture(t), server = Fastify(); t.after(() => server.close());
  registerWebAgentRoutes(server, { store: f.store, planningConversation: f.service(), blueprintGenerationEnabled: false,
    generation: {} as never, business: {} as never, getGeneratingPlan: () => false, setGeneratingPlan: () => {},
    prepareGeneratedPlanEvidence: async () => { throw Error('must not generate'); } });
  const response = await server.inject({ method: 'POST', url: '/api/agent/chat', payload: {
    mode: 'new_plan', message: 'Unknown request', sessionId: f.session.id, messageId: 'unknown-message',
    expectedRevision: 0, checkResultOnly: true } });
  assert.equal(response.statusCode, 409);
  assert.equal(f.store.getPlanningSessionById(f.session.id)?.messages.length, 0);
  assert.equal(f.submits, 0);
});

test('result check cannot turn a pre-submit rejection into a submission', async t => {
  const f = fixture(t), saved = f.save();
  f.state.publicContract = false;
  await assert.rejects(f.service().continueSavedMessage(saved, 'fictional-message'));
  f.state.publicContract = true;
  await assert.rejects(f.service().continueSavedMessage(saved, 'fictional-message', true), /not_submitted/);
  assert.equal(f.submits, 0);
});

test('new planning requests reject unknown API fields before saving', async t => {
  const f = fixture(t), server = Fastify(); t.after(() => server.close());
  registerWebAgentRoutes(server, { store: f.store, planningConversation: f.service(), blueprintGenerationEnabled: false,
    generation: {} as never, business: {} as never, getGeneratingPlan: () => false, setGeneratingPlan: () => {},
    prepareGeneratedPlanEvidence: async () => { throw Error('must not generate'); } });
  const response = await server.inject({ method: 'POST', url: '/api/agent/chat', payload: {
    mode: 'new_plan', message: 'Fictional input', sessionId: f.session.id, messageId: 'unknown-field',
    expectedRevision: 0, forceSubmit: true } });
  assert.equal(response.statusCode, 400);
  assert.equal(f.store.getPlanningSessionById(f.session.id)?.messages.length, 0);
  assert.equal(f.submits, 0);
});
