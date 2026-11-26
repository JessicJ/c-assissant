import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializePlanningContinuityFixture, changePlanningContinuitySession, readPlanningContinuitySnapshot } from './planning-continuity-fixture.mjs';
import { createPlanningContinuityTransport } from './planning-continuity-transport.mjs';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';

const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const Fastify = require('fastify');
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test('虚构规划快照只读，会话与版本控制不改已有消息回执', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'landi-planning-fixture-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  try {
    initializePlanningContinuityFixture(databasePath);
    assert.equal(readPlanningContinuitySnapshot(databasePath).sessions.length, 0);
    const session = changePlanningContinuitySession(databasePath, { create: true, status: 'collecting' });
    const store = new SqliteWorkspaceStore(databasePath);
    store.savePlanningMessage({ sessionId: session.id, messageId: 'fictional-message', expectedRevision: 0, text: '虚构海湾 trip' }); store.close();
    const before = readPlanningContinuitySnapshot(databasePath);
    assert.deepEqual(readPlanningContinuitySnapshot(databasePath), before);
    assert.equal(changePlanningContinuitySession(databasePath, { status: 'missing' }), null);
    assert.deepEqual(readPlanningContinuitySnapshot(databasePath), before);
    changePlanningContinuitySession(databasePath, { sessionId: session.id, status: 'proposal_confirmed', advanceProposalVersion: true });
    const after = readPlanningContinuitySnapshot(databasePath);
    assert.deepEqual(after.receipts, before.receipts);
    assert.equal(after.sessions[0].messages.length, 1);
    assert.ok(after.revisions[0].revision > before.revisions[0].revision);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('待生成与已有结果夹具真实可读，状态设置保全其他业务表及计划版本', async () => {
  const { missingGenerationQuestions } = await import('../../apps/server/lib/planning-session-facts.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'landi-planning-states-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  try {
    const initial = initializePlanningContinuityFixture(databasePath);
    const session = changePlanningContinuitySession(databasePath, { create: true, status: 'collecting' });
    const before = readPlanningContinuitySnapshot(databasePath);
    const ready = changePlanningContinuitySession(databasePath, { sessionId: session.id, status: 'proposal_ready' });
    assert.deepEqual(missingGenerationQuestions(ready.facts, ready.messages), []);
    assert.deepEqual(ready.unresolved, []); assert.equal(ready.status, 'proposal_ready');
    for (const key of ['destination', 'purpose', 'travel_dates', 'arrival', 'departure', 'party_size', 'transport_preference']) assert.ok(ready.facts.some(fact => fact.key === key && fact.confirmed && fact.value.trim()));
    const proposed = readPlanningContinuitySnapshot(databasePath);
    assert.equal(proposed.revisions[0].revision, 1);
    const newer = changePlanningContinuitySession(databasePath, { sessionId: session.id, status: 'proposal_ready', advanceProposalVersion: true });
    assert.equal(newer.proposal.version, ready.proposal.version + 1);
    const revised = readPlanningContinuitySnapshot(databasePath);
    assert.equal(revised.revisions[0].revision, 2);
    const completed = changePlanningContinuitySession(databasePath, { sessionId: session.id, status: 'draft_ready' });
    assert.equal(completed.outputPlanId, initial.activePlan.id);
    const store = new SqliteWorkspaceStore(databasePath);
    try { assert.deepEqual(store.getWorkspace().activePlan, initial.activePlan); assert.equal(store.getPlanningSessionById(session.id).outputPlanId, initial.activePlan.id); } finally { store.close(); }
    const after = readPlanningContinuitySnapshot(databasePath);
    assert.equal(after.revisions[0].revision, 2); // 仅状态/结果关联变化不伪造需求内容修订。
    // 真实可写 Storage 构造器会优化 SQLite 统计；它们仍在快照中披露，但不是业务数据。
    for (const [table, digest] of Object.entries(before.tableDigests)) if (!['planning_sessions', 'planning_session_revisions', 'sqlite_stat1', 'sqlite_stat4'].includes(table)) assert.deepEqual(after.tableDigests[table], digest, table);
    assert.equal(after.schemaSha256, before.schemaSha256);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('真实Server只读路由经隔离代理核三态、延迟、未知回执和零业务写入', async () => {
  const { registerPlanningSessionRoutes } = await import('../../apps/server/lib/planning-session-routes.js');
  const { registerWebAgentRoutes } = await import('../../apps/server/lib/web-agent-routes.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'landi-planning-http-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  initializePlanningContinuityFixture(databasePath);
  const store = new SqliteWorkspaceStore(databasePath);
  const saved = store.savePlanningMessage({ messageId: 'fictional-original', expectedRevision: 0, text: '虚构海湾 trip' });
  const app = Fastify();
  registerPlanningSessionRoutes(app, { store, generation: { jobs: new Map() } });
  const forbidden = () => { throw Error('隔离验收禁止执行生成或外部副作用。'); };
  registerWebAgentRoutes(app, { store, generation: { jobs: new Map() }, blueprintGenerationEnabled: false, getGeneratingPlan: () => false, setGeneratingPlan: forbidden, business: new Proxy({}, { get: forbidden }), prepareGeneratedPlanEvidence: forbidden });
  app.get('/api/agent-readiness', async () => ({ conversation: false, blueprint: false, connection: { executable: false, configuration: 'unverified' } }));
  const upstream = await app.listen({ host: '127.0.0.1', port: 0 });
  const port = await freePort();
  const transport = createPlanningContinuityTransport({ databasePath, port, upstreamPort: Number(new URL(upstream).port) });
  await transport.listen();
  const base = transport.origin;
  const control = async body => { const response = await fetch(base + '/__fixture/control', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.status, 200); return response.json(); };
  const digest = createHash('sha256').update(JSON.stringify({ text: '虚构海湾 trip' })).digest('hex');
  const receipt = `/api/planning-messages/fictional-original/status?expectedRevision=0&inputSha256=${digest}`;
  try {
    const before = readPlanningContinuitySnapshot(databasePath);
    assert.deepEqual(await (await fetch(base + '/__fixture/snapshot')).json(), before);
    for (const value of ['verified', 'needs_setup', 'unverified']) { await control({ action: 'configuration', value }); const response = await fetch(base + '/api/agent-readiness'); const body = await response.json(); assert.equal(body.connection.configuration, value); assert.equal(body.connection.executable, false); assert.equal(body.conversation, false); }
    await control({ action: 'delay', path: '/api/agent-readiness', ms: 80 });
    const started = performance.now(); await fetch(base + '/api/agent-readiness'); assert.ok(performance.now() - started >= 70);
    await control({ action: 'receipts', unavailable: true }); assert.equal((await fetch(base + receipt)).status, 503);
    await control({ action: 'receipts', unavailable: false });
    const found = await (await fetch(base + receipt)).json(); assert.equal(found.requirementsSaved, true); assert.equal(found.sessionId, saved.session.id);
    const mismatch = await fetch(base + receipt.replace('expectedRevision=0', 'expectedRevision=1'));
    assert.equal(mismatch.status, 503); assert.equal((await mismatch.json()).requirementsSaved, null);
    const state = await (await fetch(base + '/__fixture/state')).json();
    assert.equal(Object.keys(state.counts).filter(key => !key.startsWith('GET ')).length, 0);
    assert.deepEqual(readPlanningContinuitySnapshot(databasePath), before);
    await control({ action: 'read-failure', path: '/api/workspace', failed: true });
    assert.equal((await fetch(base + '/api/workspace')).status, 503);
    assert.deepEqual(readPlanningContinuitySnapshot(databasePath), before);
    // 保存响应真正截断；随后只读对账及原身份重放不得产生第二条消息。
    const original = { mode: 'new_plan', message: '虚构第二次需求', messageId: 'fictional-dropped', sessionId: saved.session.id, expectedRevision: 1 };
    await control({ action: 'next-save', mode: 'drop_response', hideReceipt: true });
    await assert.rejects(async () => { const response = await fetch(base + '/api/agent/chat', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(original) }); await response.json(); });
    const droppedDigest = createHash('sha256').update(JSON.stringify({ text: original.message })).digest('hex');
    const droppedReceipt = `/api/planning-messages/${original.messageId}/status?expectedRevision=1&inputSha256=${droppedDigest}`;
    const committed = readPlanningContinuitySnapshot(databasePath);
    assert.equal(committed.receipts.length, 2); assert.equal(committed.sessions[0].messages.length, 2);
    assert.equal((await fetch(base + droppedReceipt)).status, 503);
    await control({ action: 'receipts', unavailable: false });
    assert.equal((await (await fetch(base + droppedReceipt)).json()).requirementsSaved, true);
    assert.deepEqual(readPlanningContinuitySnapshot(databasePath), committed);
    const replay = await fetch(base + '/api/agent/chat', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(original) });
    assert.equal(replay.status, 200); assert.equal((await replay.json()).reused, true);
    assert.deepEqual(readPlanningContinuitySnapshot(databasePath), committed);
    const denied = await fetch(base + '/__fixture/control', { method: 'POST', headers: { origin: 'https://fixture.invalid', 'content-type': 'application/json' }, body: '{}' }); assert.equal(denied.status, 403);
    assert.equal(await new Promise((resolve, reject) => { const request = http.get(base + '/api/agent-readiness', { headers: { host: 'fixture.invalid' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); }), 403);
  } finally { transport.close(); await app.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
