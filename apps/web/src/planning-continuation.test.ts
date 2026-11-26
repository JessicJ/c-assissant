import assert from 'node:assert/strict';
import test from 'node:test';
import { createIsolatedPlanningContinuation, readPlanningContinuation, serverPlanningContinuation } from './planning-continuation.js';
const scope = { sessionId: 'fictional-session', revision: 3, proposalVersion: 2 };
test('continuation requires explicit internal dependency and exact fresh scope, never an object or permission claim', async () => {
  const valid = () => ({ ...scope, ready: true, validUntil: Date.now() + 10000 });
  assert.equal(await readPlanningContinuation(undefined, scope), null);
  assert.equal(await readPlanningContinuation({ read: async () => valid() }, scope), null);
  const port = createIsolatedPlanningContinuation(async () => valid());
  assert.ok(await readPlanningContinuation(port, scope));
  for (const value of [{ ...valid(), ready: false }, { ...valid(), sessionId: 'other' }, { ...valid(), revision: 4 },
    { ...valid(), proposalVersion: 1 }, { ...valid(), validUntil: Date.now() - 1 }, { ...valid(), validUntil: Date.now() + 60000 }]) {
    assert.equal(await readPlanningContinuation(createIsolatedPlanningContinuation(async () => value), scope), null);
  }
  assert.equal(await readPlanningContinuation(createIsolatedPlanningContinuation(async () => { throw Error('Unavailable'); }), scope), null);
});


test('normal continuation reads only the matching server admission and rejects stale or mismatched responses', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string | undefined }[] = [];
  let response = { ...scope, ready: true, validUntil: Date.now() + 20000 };
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    assert.ok(await readPlanningContinuation(serverPlanningContinuation, scope));
    assert.deepEqual(calls, [{ url: '/api/planning-sessions/fictional-session/generation-admission?revision=3&proposalVersion=2', method: 'GET' }]);
    response = { ...response, revision: 4 };
    assert.equal(await readPlanningContinuation(serverPlanningContinuation, scope), null);
    response = { ...scope, ready: false, validUntil: Date.now() + 20000 };
    assert.equal(await readPlanningContinuation(serverPlanningContinuation, scope), null);
    response = { ...scope, ready: true, validUntil: Date.now() - 1 };
    assert.equal(await readPlanningContinuation(serverPlanningContinuation, scope), null);
    assert.ok(calls.every(call => call.method === 'GET'));
  } finally { globalThis.fetch = originalFetch; }
});
