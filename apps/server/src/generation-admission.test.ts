import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { SqliteWorkspaceStore } from '@c-assistant/storage';
import { IsolatedGenerationAdmission, assertIsolatedGenerationDatabase } from './generation-admission.js';
import { registerPlanningSessionRoutes } from './planning-session-routes.js';
import { registerWebAgentRoutes } from './web-agent-routes.js';
import { productionReadiness } from './production-readiness.js';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'landi-generation-admission-'));
  const store = new SqliteWorkspaceStore(join(directory, 'synthetic.sqlite'));
  store.updateProfile({ displayName: 'Test', preferredLanguage: 'English', nationality: 'Unspecified', gender: 'not_specified', immigrationStatus: 'unknown' });
  const initial = store.createPlanningSession();
  const now = new Date().toISOString();
  const session = store.savePlanningSession({ ...initial, status: 'proposal_ready',
    facts: Object.entries({ destination: 'Kyoto', purpose: 'Visit temples and tea houses', travel_dates: '2026-12-12 to 2026-12-12',
      arrival: 'Already in Kyoto at 08:00', departure: 'Return to Kyoto station at 20:00', party_size: '1', transport_preference: 'public transport' })
      .map(([key, value]) => ({ key, value, source: 'user' as const, confirmed: true, updatedAt: now })),
    unresolved: [], proposal: { version: 1, title: 'Kyoto day trip', objective: 'Temples and tea', theme: 'Culture',
      segments: ['Kyoto'], skeleton: ['2026-12-12'], tradeoffs: [], assumptions: [], decisionPoints: [] } });
  let previews = 0;
  const admission = new IsolatedGenerationAdmission({ store, sessionId: session.id, projectRoot: '/synthetic/project',
    preview: async () => { previews++; } });
  const identity = { sessionId: session.id, revision: store.getPlanningRevision(session.id), proposalVersion: 1 };
  t.after(() => store.close());
  return { store, admission, identity, session, get previews() { return previews; } };
}

test('read-only generation admission checks exact saved proposal and never grants execution from a GET', async t => {
  const f = fixture(t);
  const result = await f.admission.check(f.identity);
  assert.equal(result.ready, true);
  assert.equal(f.previews, 1);
  assert.throws(() => f.admission.run(f.identity, async () => {}), /generation admission/);
  assert.equal(productionReadiness().generation, false);
  for (const identity of [{ ...f.identity, revision: f.identity.revision + 1 }, { ...f.identity, proposalVersion: 2 }, { ...f.identity, sessionId: 'other' }]) {
    assert.equal((await f.admission.check(identity)).ready, false);
  }
  assert.equal(f.previews, 1);
});

test('explicit authorization repeats preview and confines execution to its async request context', async t => {
  const f = fixture(t);
  await f.admission.check(f.identity);
  await f.admission.authorize(f.identity);
  assert.equal(f.previews, 2);
  assert.throws(() => f.admission.assertExecution(), /outside/);
  await f.admission.run(f.identity, async () => { await Promise.resolve(); f.admission.assertExecution(); });
  assert.throws(() => f.admission.run({ ...f.identity, proposalVersion: 2 }, async () => {}), /generation admission/);
  assert.equal(productionReadiness().unattendedEmail, false);
});

test('proposal mutation during preview invalidates admission and incomplete details prevent preview', async t => {
  const f = fixture(t);
  const changing = new IsolatedGenerationAdmission({ store: f.store, sessionId: f.session.id, projectRoot: '/synthetic/project', preview: async () => {
    f.store.savePlanningSession({ ...f.session, proposal: { ...f.session.proposal!, version: 2 } });
  } });
  assert.equal((await changing.check(f.identity)).ready, false);
  assert.throws(() => changing.run(f.identity, async () => {}));
  f.store.savePlanningSession({ ...f.session, facts: [] });
  assert.equal((await f.admission.check({ ...f.identity, revision: f.store.getPlanningRevision(f.session.id) })).ready, false);
  assert.equal(f.previews, 0);
});

test('normal routes expose scoped read-only admission while unconfigured instances stay blocked', async t => {
  const f = fixture(t), app = Fastify(); t.after(() => app.close());
  registerPlanningSessionRoutes(app, { store: f.store, generation: {} as never, generationAdmission: f.admission });
  const response = await app.inject({ method: 'GET', url: `/api/planning-sessions/${f.identity.sessionId}/generation-admission?revision=${f.identity.revision}&proposalVersion=1` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ready, true);
  assert.equal(response.headers['cache-control'], 'no-store');
  const wrong = await app.inject({ method: 'GET', url: `/api/planning-sessions/${f.identity.sessionId}/generation-admission?revision=${f.identity.revision + 1}&proposalVersion=1` });
  assert.equal(wrong.json().ready, false);
  const plain = Fastify(); t.after(() => plain.close());
  registerPlanningSessionRoutes(plain, { store: f.store, generation: {} as never });
  assert.equal((await plain.inject({ method: 'GET', url: `/api/planning-sessions/${f.identity.sessionId}/generation-admission?revision=${f.identity.revision}&proposalVersion=1` })).json().ready, false);
});

test('normal confirm independently rejects stale identity before enqueue or changing the saved proposal', async t => {
  const f = fixture(t), app = Fastify(); t.after(() => app.close());
  let enqueues = 0;
  registerWebAgentRoutes(app, { store: f.store, generationAdmission: f.admission, blueprintGenerationEnabled: true,
    generation: { jobs: new Map(), enqueuePlanningSessionGeneration: () => { enqueues++; throw Error('unexpected enqueue'); } } as never,
    business: {} as never, getGeneratingPlan: () => false, setGeneratingPlan: () => {},
    prepareGeneratedPlanEvidence: async () => { throw Error('unexpected evidence preparation'); } });
  const response = await app.inject({ method: 'POST', url: `/api/planning-sessions/${f.identity.sessionId}/confirm`,
    payload: { proposalVersion: 1, expectedRevision: f.identity.revision + 1 } });
  assert.equal(response.statusCode, 409);
  assert.equal(f.store.getPlanningSessionById(f.identity.sessionId)?.status, 'proposal_ready');
  assert.equal(enqueues, 0);
});

test('local acceptance entry rejects an application database inside a source repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'landi-validation-path-'));
  const path = join(root, 'production.sqlite'); writeFileSync(path, '');
  assert.throws(() => assertIsolatedGenerationDatabase(path, root, root), /outside/);
  assert.throws(() => assertIsolatedGenerationDatabase('relative.sqlite', root, root), /absolute/);
});

test('confirm rechecks scope after the public preflight and rejects a concurrent proposal change', async t => {
  const f = fixture(t), app = Fastify(); t.after(() => app.close());
  let enqueues = 0;
  const admission = new IsolatedGenerationAdmission({ store: f.store, sessionId: f.identity.sessionId, projectRoot: '/synthetic/project',
    preview: async () => { f.store.savePlanningSession({ ...f.session, proposal: { ...f.session.proposal!, version: 2 } }); } });
  registerWebAgentRoutes(app, { store: f.store, generationAdmission: admission, blueprintGenerationEnabled: true,
    generation: { jobs: new Map(), enqueuePlanningSessionGeneration: () => { enqueues++; throw Error('unexpected enqueue'); } } as never,
    business: {} as never, getGeneratingPlan: () => false, setGeneratingPlan: () => {},
    prepareGeneratedPlanEvidence: async () => { throw Error('unexpected evidence preparation'); } });
  const response = await app.inject({ method: 'POST', url: `/api/planning-sessions/${f.identity.sessionId}/confirm`,
    payload: { proposalVersion: 1, expectedRevision: f.identity.revision } });
  assert.equal(response.statusCode, 409);
  assert.equal(f.store.getPlanningSessionById(f.identity.sessionId)?.proposal?.version, 2);
  assert.equal(f.store.getPlanningSessionById(f.identity.sessionId)?.confirmedProposalVersion, undefined);
  assert.equal(enqueues, 0);
  assert.throws(() => admission.run(f.identity, async () => {}));
});
