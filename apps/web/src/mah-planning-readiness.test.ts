import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMahConnection, parsePlanningReturn, checkMahPlanningReadiness } from './mah-planning-readiness.js';

const now = Date.now();
function configuration() {
  return { status: 'blocked', code: 'public_mah_contract_unverified', conversation: false, generation: false, revision: false, unattendedEmail: false, hosting: false,
    connection: { selectionOwner: 'mah', executable: false, configuration: 'verified', code: 'configuration_verified_execution_blocked',
      evidence: { source: 'mah_public_configuration', protocol: 1, scopeVerified: true, maxAgeMs: 60000, observedAt: new Date(now).toISOString() } } };
}
const baseline = { sessionId: 'fictional-session', revision: 3, proposalVersion: 2 };
function returned() {
  return { schemaVersion: 1, executable: false, sessionId: baseline.sessionId, observedAt: new Date(now).toISOString(), comparison: 'matched', code: 'planning_versions_match',
    snapshot: { sessionId: baseline.sessionId, revisionSource: 'recorded', revision: 3, proposalVersion: 2, status: 'collecting', outputPlanId: null, updatedAt: new Date(now).toISOString() } };
}

test('配置证据过期未来损坏错scope或冲突均不提升', () => {
  assert.equal(parseMahConnection(configuration(), now), 'verified');
  for (const observedAt of ['bad', new Date(now - 60001).toISOString(), new Date(now + 1).toISOString()]) {
    const value = configuration(); value.connection.evidence.observedAt = observedAt;
    assert.equal(parseMahConnection(value, now), 'unverified');
  }
  for (const value of [null, {}, { ...configuration(), generation: true }, { ...configuration(), connection: { ...configuration().connection, executable: true } },
    { ...configuration(), connection: { ...configuration().connection, evidence: { ...configuration().connection.evidence, scopeVerified: false } } }]) assert.equal(parseMahConnection(value, now), 'unverified');
});

test('会话缺失变化已关闭已有结果与未知保持独立事实', () => {
  for (const status of ['generating', 'proposal_confirmed', 'draft_ready', 'abandoned']) {
    const value = returned(); value.snapshot.status = status;
    assert.deepEqual(parsePlanningReturn(value, baseline, now), { comparison: 'matched', status });
  }
  assert.deepEqual(parsePlanningReturn({ ...returned(), comparison: 'missing', code: 'planning_session_missing', snapshot: null }, baseline, now), { comparison: 'missing' });
  for (const value of [null, { ...returned(), sessionId: 'other' }, { ...returned(), observedAt: new Date(now + 1).toISOString() },
    { ...returned(), snapshot: { ...returned().snapshot, revision: 4 } }]) assert.deepEqual(parsePlanningReturn(value, baseline, now), { comparison: 'unverified' });
});

test('配置和会话匹配也不授权执行，只发送两个只读请求', async () => {
  const original = globalThis.fetch, calls: RequestInit[] = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push(init!); return new Response(JSON.stringify(String(url).includes('agent-readiness') ? configuration() : returned())); };
    const result = await checkMahPlanningReadiness(baseline);
    assert.equal(result.configuration, 'verified'); assert.equal(result.session.comparison, 'matched'); assert.equal(result.executable, false);
    assert.equal(result.validUntil, now + 60000);
    assert.equal(calls.length, 2); assert.ok(calls.every(call => call.method === 'GET' && call.cache === 'no-store'));
  } finally { globalThis.fetch = original; }
});

test('configured submission is reported independently of full generation and observed task receipt', async t => {
  const original = globalThis.fetch;
  try {
    for (const enabled of [false, true]) {
      const value = { ...configuration(), ...(enabled ? { conversationSubmission: {
        configured: true, mode: 'read_only', preflight: 'required_per_request' } } : {}) };
      globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('agent-readiness') ? value : returned()));
      const result = await checkMahPlanningReadiness(baseline);
      assert.equal(result.submissionConfigured, enabled);
      assert.equal(result.executable, false);
      if (enabled) { assert.match(result.message, /submit saved requirements/); assert.match(result.message, /Full travel-plan generation remains unavailable/); }
      assert.doesNotMatch(result.message, /MAH received/);
    }
  } finally { globalThis.fetch = original; }
});
