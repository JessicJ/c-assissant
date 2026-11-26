import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { workspaceMutationDigestInput } from '../../packages/core/lib/index.js';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';
import { createFixtureTransport, startFixtureTransport } from './isolated-workspace-transport.mjs';
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
test('隔离HTTP材料、真实竞争回滚、响应丢失回执与同目录重启', { timeout: 60000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-transport-check-')); const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  let child, diagnostics = '';
  async function stop() { if (child?.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGTERM'); const [code] = await closed; assert.equal(code, 0, diagnostics); } }
  async function start() { child = spawn(process.execPath, ['tests/browser/isolated-workspace-server.mjs', '--data-dir', directory, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', data => { diagnostics += data; }); child.stderr.on('data', data => { diagnostics += data; }); for (let count = 0; count < 100; count++) { if (child.exitCode !== null) throw Error(diagnostics); try { if ((await fetch(origin + '/api/workspace')).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(diagnostics); }
  async function request(path, body, headers = {}) { const response = await fetch(origin + path, body ? { method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body) } : undefined); return { status: response.status, body: await response.json() }; }
  const control = body => request('/__fixture/control', body); const workspace = async () => (await request('/api/workspace')).body;
  function assertProjection(projected) { const store = new SqliteWorkspaceStore(join(directory, 'workspace.sqlite')); const raw = store.getWorkspace(); store.close(); const normalized = structuredClone(projected); for (const place of normalized.activeBlueprint.places) for (const image of place.images ?? []) { if (image.url === origin + '/__fixture/image.png') image.url = 'https://fixture.invalid/image.png'; if (image.url === origin + '/__fixture/broken.png') image.url = 'https://fixture.invalid/broken.png'; } assert.deepEqual(normalized, raw); }
  const endpoint = current => `/api/plans/${current.activePlan.id}/blueprint-revisions/direct`;
  const bodyFor = (current, tip = 'fixture-tip-day') => ({ requestId: randomUUID(), expectedVersion: current.activePlan.version, expectedBlueprintVersion: current.activeBlueprint.version, revisions: [{ kind: 'set_tip_state', tipId: tip, pinned: true }] });
  const receipt = (path, body, operation = 'save', revisionId) => path.replace(/\/direct$|\/[^/]+\/undo$/, `/receipts/${body.requestId}`) + '?' + new URLSearchParams({ operation, expectedVersion: String(body.expectedVersion), expectedBlueprintVersion: String(body.expectedBlueprintVersion), requestDigest: createHash('sha256').update(workspaceMutationDigestInput(operation, path.split('/')[3], { ...body, ...(revisionId ? { revisionId } : {}) })).digest('hex'), ...(revisionId ? { revisionId } : {}) });
  const snapshot = () => { const sql = new DatabaseSync(join(directory, 'workspace.sqlite')); try { return Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, sql.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])); } finally { sql.close(); } };
  try {
    await start(); assert.equal((await control({ action: 'clear' })).status, 200);
    // 内层端口被其他自有探针占用时，外层在等待和失败后均不得开放。
    const occupied = net.createServer(); await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const outerPort = await freePort(); const occupiedPort = occupied.address().port;
    const unopened = createFixtureTransport({ databasePath: join(directory, 'workspace.sqlite'), port: outerPort, upstreamPort: occupiedPort });
    let release; const gate = new Promise(resolve => { release = resolve; });
    const rejectedStartup = startFixtureTransport(unopened, async () => { await gate; const contender = net.createServer(); await new Promise((resolve, reject) => { contender.once('error', reject); contender.listen(occupiedPort, '127.0.0.1', resolve); }); });
    await assert.rejects(() => fetch(`http://127.0.0.1:${outerPort}/api/workspace`));
    release(); await assert.rejects(rejectedStartup, { code: 'EADDRINUSE' });
    await assert.rejects(() => fetch(`http://127.0.0.1:${outerPort}/api/workspace`));
    await new Promise(resolve => occupied.close(resolve));
    assert.equal((await request('/__fixture/control', { action: 'clear' }, { origin: 'https://outside.invalid' })).status, 403);
    assert.equal(await new Promise((resolve, reject) => { const req = http.request(origin + '/__fixture/control', { method: 'POST', headers: { host: 'outside.invalid', origin, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end('{"action":"clear"}'); }), 403);
    const before = await workspace();
    for (const source of before.activeBlueprint.sources) { const response = await fetch(source.url); assert.equal(response.status, 200); assert.match(await response.text(), /虚构验收来源/); assert.match(source.title, /来源标题持续阅读至末尾.*全部文字/); }
    const image = await fetch(before.activeBlueprint.places[0].images[0].url); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(Buffer.from(await image.arrayBuffer()).readUInt32BE(0), 0x89504e47); assert.equal((await fetch(before.activeBlueprint.places[1].images[0].url)).status, 404);
    const store = new SqliteWorkspaceStore(join(directory, 'workspace.sqlite')); const raw = store.getWorkspace(); store.close();
    assert.equal(raw.activeBlueprint.places[0].images[0].url, 'https://fixture.invalid/image.png');
    const normalized = structuredClone(before); normalized.activeBlueprint.places[0].images[0].url = raw.activeBlueprint.places[0].images[0].url; normalized.activeBlueprint.places[1].images[0].url = raw.activeBlueprint.places[1].images[0].url; assert.deepEqual(normalized, raw);
    const staleBody = bodyFor(before); assert.equal((await request(endpoint(before), bodyFor(before, 'fixture-tip-block-only'))).status, 200); assert.equal((await request(endpoint(before), staleBody)).body.code, 'version_conflict');
    let current = await workspace(); const path = endpoint(current); const body = bodyFor(current); const prior = snapshot();
    await control({ action: 'arm', path, requestId: body.requestId, mode: 'rollback' });
    assert.equal((await request(path, { ...body, requestId: '无关虚构请求', expectedVersion: 0 })).status, 400);
    assert.equal((await request('/__fixture/state')).body.armed.requestId, body.requestId);
    const rejected = await request(path, body); assert.equal(rejected.status, 500); assert.equal(rejected.body.code, 'internal_error'); assert.ok(!JSON.stringify(rejected).includes('/private/')); assert.deepEqual(snapshot(), prior);
    assert.equal((await request(receipt(path, body))).body.status, 'not_found'); assert.deepEqual(snapshot(), prior);
    // not_found只表示尚无回执；同一原请求仍可提交，不能据此断言失败。
    await control({ action: 'next', mode: 'drop_response', hideReceipt: true });
    assert.deepEqual((await request('/__fixture/state')).body.next, { mode: 'drop_response', hideReceipt: true });
    assert.equal((await request('/__fixture/control', { action: 'clear' }, { origin: 'https://outside.invalid' })).status, 403);
    assert.equal((await request('/__fixture/state')).body.next.mode, 'drop_response');
    const receiptPath = receipt(path, body).split('?')[0];
    const lostResponse = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    assert.equal(lostResponse.status, 200);
    await assert.rejects(() => lostResponse.json());
    const capturedState = (await request('/__fixture/state')).body;
    assert.equal(capturedState.next, undefined); assert.equal(capturedState.armed, undefined);
    assert.equal(capturedState.captured.path, path); assert.deepEqual(capturedState.captured.body, body);
    assert.equal(capturedState.captured.rawBody, JSON.stringify(body)); assert.equal(capturedState.captured.body.requestId, body.requestId);
    assert.equal(capturedState.unavailableReceipt, receiptPath);
    current = await workspace(); assert.equal(current.activeBlueprint.version, before.activeBlueprint.version + 2); assert.equal((await request(receipt(path, body))).status, 503);
    await control({ action: 'receipts', path: receiptPath, unavailable: false }); const readback = await request(receipt(path, body)); assert.equal(readback.body.status, 'committed'); assert.equal(readback.body.requestId, body.requestId);
    assertProjection(readback.body.workspace);
    const committed = snapshot(); assert.equal(committed.direct_blueprint_edits.length, prior.direct_blueprint_edits.length + 1);
    const audit = committed.direct_blueprint_edits.find(row => row.request_id === body.requestId); assert.equal(JSON.parse(audit.fingerprint).expectedPlanId, path.split('/')[3]); assert.equal(JSON.parse(audit.result_json).revision.id, readback.body.revision.id);
    assert.equal(JSON.parse(audit.result_json).workspace.activeBlueprint.places[0].images[0].url, 'https://fixture.invalid/image.png');
    const replay = await request(path, body); assert.equal(replay.status, 200); assertProjection(replay.body.workspace); assert.deepEqual(snapshot(), committed); assert.equal((await request('/__fixture/state')).body.next, undefined); assert.equal((await request(path, { ...body, revisions: [{ ...body.revisions[0], pinned: false }] })).body.code, 'request_identity_conflict');
    const undoBody = { requestId: randomUUID(), expectedVersion: current.activePlan.version, expectedBlueprintVersion: current.activeBlueprint.version }; const revisionId = readback.body.revision.id; const undoPath = `/api/plans/${current.activePlan.id}/blueprint-revisions/${revisionId}/undo`;
    await control({ action: 'arm', path: undoPath, requestId: undoBody.requestId, mode: 'rollback' }); assert.equal((await request(undoPath, undoBody)).status, 500); assert.deepEqual(snapshot(), committed);
    await stop(); await start(); assert.deepEqual(snapshot(), committed); assert.equal((await request(receipt(path, body))).body.status, 'committed');
    await control({ action: 'arm', path: undoPath, requestId: undoBody.requestId, mode: 'drop_response' });
    const undoReceipt = receipt(undoPath, undoBody, 'undo', revisionId); await control({ action: 'receipts', path: undoReceipt.split('?')[0], unavailable: true });
    await assert.rejects(() => request(undoPath, undoBody)); const undone = snapshot(); assert.equal(undone.direct_blueprint_undos.length, committed.direct_blueprint_undos.length + 1);
    assert.equal((await request(undoReceipt)).status, 503); await control({ action: 'receipts', path: undoReceipt.split('?')[0], unavailable: false });
    const undoReadback = await request(undoReceipt); assert.equal(undoReadback.body.status, 'committed'); assert.equal(undoReadback.body.requestId, undoBody.requestId);
    assertProjection(undoReadback.body.workspace);
    const undoAudit = undone.direct_blueprint_undos.find(row => row.request_id === undoBody.requestId); assert.equal(JSON.parse(undoAudit.fingerprint).revisionId, revisionId); assert.equal(JSON.parse(undoAudit.result_json).activeBlueprint.version, undoReadback.body.workspace.activeBlueprint.version);
    const undoReplay = await request(undoPath, undoBody); assert.equal(undoReplay.status, 200); assertProjection(undoReplay.body); assert.deepEqual(snapshot(), undone);
    await stop(); const hash = () => createHash('sha256').update(readFileSync(join(directory, 'workspace.sqlite'))).digest('hex'); const beforeHash = hash();
    const wrong = spawn(process.execPath, ['tests/browser/isolated-workspace-server.mjs', '--data-dir', directory, '--port', String(await freePort())], { stdio: 'ignore' }); const [wrongCode] = await once(wrong, 'close'); assert.notEqual(wrongCode, 0); assert.equal(hash(), beforeHash); await start(); assert.deepEqual(snapshot(), undone);
  } finally { await stop(); rmSync(directory, { recursive: true }); }
});
