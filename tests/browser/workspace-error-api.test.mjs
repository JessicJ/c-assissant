import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from '../../apps/server/node_modules/fastify/fastify.js';
import { workspaceMutationDigestInput } from '../../packages/core/lib/index.js';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';
import { initializeWorkspaceFixture } from './isolated-workspace-fixture.mjs';
import { registerPlanManagementRoutes } from '../../apps/server/lib/plan-management-routes.js';
import { registerWebAgentRoutes } from '../../apps/server/lib/web-agent-routes.js';
import { registerPlanPresentationRoutes } from '../../apps/server/lib/plan-presentation-routes.js';

test('全部同职责接口捕获未知异常，不按异常关键词推断业务冲突', async () => {
  const diagnostic = '虚构内部诊断 /private/fixture-only changed before already working already scheduled';
  const store = new Proxy({}, { get: () => () => { throw new Error(diagnostic); } });
  const server = Fastify({ logger: false });
  registerPlanManagementRoutes(server, { store, getMaps() { throw new Error(diagnostic); }, startActivePlanMonitoring() {} });
  registerPlanPresentationRoutes(server, { store, getMaps() { throw new Error(diagnostic); } });
  registerWebAgentRoutes(server, { store, blueprintGenerationEnabled: true, generation: {}, business: {}, getGeneratingPlan: () => false, setGeneratingPlan() {}, prepareGeneratedPlanEvidence() { throw new Error(diagnostic); } });
  const cases = [
    ['POST', '/api/agent/chat', { mode: 'revise_plan', message: '虚构调整', expectedPlanId: 'fixture', expectedVersion: 1, impactConfirmed: true }],
    ['DELETE', '/api/plans'], ['DELETE', '/api/plans/fixture'], ['POST', '/api/plans/fixture/abandon'],
    ['GET', '/api/plans/history'], ['DELETE', '/api/plans/history'], ['DELETE', '/api/plans/fixture/history'],
    ['POST', '/api/plans/fixture/replacement/undo', { expectedVersion: 1 }],
    ['PATCH', '/api/plans/fixture/tasks/task/check', { checked: true }],
    ['POST', '/api/plans/fixture/changes', { kind: 'reorder_task', taskId: 'task', direction: 'up', expectedVersion: 1 }],
    ['POST', '/api/plans/fixture/changes/change/undo', { expectedVersion: 1 }],
    ['POST', '/api/plans/fixture/blueprint-revisions/direct', { requestId: 'request', expectedVersion: 1, expectedBlueprintVersion: 1, revisions: [{ kind: 'set_tip_state', tipId: 'tip', pinned: true }] }],
    ['POST', '/api/plans/fixture/blueprint-revisions/revision/undo', { requestId: 'request', expectedVersion: 1, expectedBlueprintVersion: 1 }],
    ['GET', '/api/plans/fixture/blueprint-revisions/receipts/request?operation=save&expectedVersion=1&expectedBlueprintVersion=1&requestDigest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['POST', '/api/plans/fixture/blueprint-revisions/assisted-replanning', { expectedVersion: 1, revisions: [{ kind: 'update_place_priority', placeId: 'place', priority: 'must' }], replanRequirement: {} }],
    ['POST', '/api/plans/fixture/change-impact', { expectedVersion: 1, message: '虚构调整' }],
    ['POST', '/api/plans/fixture/sources/snapshot'], ['GET', '/api/plans/fixture/execution'],
    ['POST', '/api/plans/fixture/confirm', { expectedVersion: 1 }],
    ['POST', '/api/plans/fixture/tasks/task/reminder/cancel'],
    ['PUT', '/api/plans/fixture/accommodation', {}],
    ['POST', '/api/plans/fixture/accommodation/manual', { name: '虚构住宿', address: '虚构地区' }],
    ['POST', '/api/plans/fixture/accommodation/linked', { expectedVersion: 1, name: '虚构住宿', address: '虚构地区' }],
    ['PUT', '/api/plans/fixture/transport-preference', {}], ['PUT', '/api/plans/fixture/travel-context', {}], ['PUT', '/api/plans/fixture/arrival', {}],
    ['POST', '/api/plans/fixture/presentation/routes/segment/refresh', { expectedVersion: 1 }],
    ['POST', '/api/plans/fixture/presentation/routes/refresh', { expectedVersion: 1, segmentIds: ['segment'] }],
    ['PATCH', '/api/plans/fixture/presentation', { expectedVersion: 1, assignments: {}, priorities: {}, orders: {} }]
  ];
  try {
    for (const [method, url, payload] of cases) {
      const response = await server.inject({ method, url, ...(payload ? { payload } : {}) });
      assert.equal(response.statusCode, 500, `${method} ${url}: ${response.body}`);
      assert.equal(response.json().code, 'internal_error');
      assert.ok(!response.body.includes(diagnostic)); assert.ok(!response.body.includes('/private/'));
    }
  } finally { await server.close(); }
});

test('真实隔离存储保存及撤销失败、只读回执、重启及幂等恢复', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-error-contract-'));
  const databasePath = join(directory, 'fixture.sqlite');
  let store = new SqliteWorkspaceStore(databasePath);
  const old = store.createGeneratedPlan({ title: '虚构旧执行计划', location: '虚构海湾', dates: '2026-12-01', knownInformation: [], assumptions: [], nextAction: '审阅', stages: [{ title: '虚构任务', description: '隔离验证', tasks: [{ title: '核对虚构材料', owner: 'user', dueLabel: '出发前' }] }] });
  store.confirmPlan(old.activePlan.id); store.close();
  initializeWorkspaceFixture(databasePath);
  store = new SqliteWorkspaceStore(databasePath);
  const sql = new DatabaseSync(databasePath);
  let server;
  let origin;
  const maps = { configurationStatus: () => ({ status: 'unavailable' }), geocodeAddress: async () => ({ status: 'unavailable' }), drivingRoute: async () => ({ status: 'unavailable' }), walkingRoute: async () => ({ status: 'unavailable' }), transitRoute: async () => ({ status: 'unavailable' }) };
  async function start() {
    server = Fastify({ logger: false });
    registerPlanManagementRoutes(server, { store, getMaps: () => maps, startActivePlanMonitoring() {} });
    registerPlanPresentationRoutes(server, { store, getMaps: () => maps });
    origin = await server.listen({ host: '127.0.0.1', port: 0 });
  }
  const request = async (url, body) => {
    const response = await fetch(origin + url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: response.status, body: await response.json() };
  };
  const snapshot = () => ({ workspace: store.getWorkspace(), execution: store.getExecutionPlan(), edits: sql.prepare('SELECT * FROM direct_blueprint_edits').all(), undos: sql.prepare('SELECT * FROM direct_blueprint_undos').all(), lineage: sql.prepare('SELECT * FROM plan_blueprint_lineage').all(), plans: sql.prepare('SELECT * FROM plans').all() });
  const receiptUrl = (plan, operation, body, revisionId) => `/api/plans/${plan}/blueprint-revisions/receipts/${body.requestId}?` + new URLSearchParams({ operation, requestDigest: createHash("sha256").update(workspaceMutationDigestInput(operation, plan, { ...body, ...(revisionId ? { revisionId } : {}) })).digest("hex"), expectedVersion: String(body.expectedVersion), expectedBlueprintVersion: String(body.expectedBlueprintVersion), ...(revisionId ? { revisionId } : {}) });
  try {
    await start();
    const before = snapshot();
    const plan = before.workspace.activePlan.id;
    const body = { requestId: randomUUID(), expectedVersion: before.workspace.activePlan.version, expectedBlueprintVersion: before.workspace.activeBlueprint.version, revisions: [{ kind: 'set_tip_state', tipId: 'fixture-tip-block', pinned: true }] };
    const saveUrl = `/api/plans/${plan}/blueprint-revisions/direct`;
    const diagnostic = '虚构内部诊断 /private/fixture-only/workspace.sqlite changed before already scheduled';
    sql.exec(`CREATE TRIGGER isolated_save_abort BEFORE INSERT ON direct_blueprint_edits BEGIN SELECT RAISE(ABORT, '${diagnostic}'); END`);
    const failed = await request(saveUrl, body);
    assert.equal(failed.status, 500); assert.equal(failed.body.code, 'internal_error');
    assert.ok(!JSON.stringify(failed).includes(diagnostic)); assert.ok(!JSON.stringify(failed).includes('/private/'));
    assert.deepEqual(snapshot(), before);
    assert.equal((await request(receiptUrl(plan, 'save', body))).body.status, 'not_found');
    sql.exec('DROP TRIGGER isolated_save_abort');
    const saved = await request(saveUrl, body);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const savedState = snapshot();
    assert.equal(savedState.workspace.activeBlueprint.version, before.workspace.activeBlueprint.version + 1);
    assert.deepEqual(savedState.execution, before.execution);
    // 只读回执既不重提也不依赖原 Plan 仍为当前计划；回传当前事实。
    const receipt = await request(receiptUrl(plan, 'save', body));
    assert.equal(receipt.body.status, 'committed'); assert.equal(receipt.body.requestId, body.requestId);
    assert.deepEqual(receipt.body.workspace, savedState.workspace);
    assert.equal((await request(saveUrl, body)).status, 200); assert.deepEqual(snapshot(), savedState);
    assert.equal((await request(saveUrl, { ...body, revisions: [{ ...body.revisions[0], pinned: false }] })).body.code, 'request_identity_conflict');
    assert.equal((await request(receiptUrl(plan, 'save', { ...body, revisions: [{ ...body.revisions[0], pinned: false }] }))).body.code, 'request_identity_conflict');
    assert.equal((await request(receiptUrl(plan, 'save', { ...body, expectedVersion: body.expectedVersion + 1 }))).body.code, 'request_identity_conflict');
    const revisionId = saved.body.revision.id;
    const undoBody = { requestId: randomUUID(), expectedVersion: savedState.workspace.activePlan.version, expectedBlueprintVersion: savedState.workspace.activeBlueprint.version };
    const undoPlan = savedState.workspace.activePlan.id;
    const undoUrl = `/api/plans/${undoPlan}/blueprint-revisions/${revisionId}/undo`;
    sql.exec(`CREATE TRIGGER isolated_undo_abort BEFORE INSERT ON direct_blueprint_undos BEGIN SELECT RAISE(ABORT, '${diagnostic}'); END`);
    const undoFailed = await request(undoUrl, undoBody);
    assert.equal(undoFailed.status, 500); assert.equal(undoFailed.body.code, 'internal_error');
    assert.ok(!JSON.stringify(undoFailed).includes('/private/'));
    assert.deepEqual(snapshot(), savedState);
    sql.exec('DROP TRIGGER isolated_undo_abort');
    await server.close(); store.close(); store = new SqliteWorkspaceStore(databasePath); await start();
    assert.equal((await request(receiptUrl(plan, 'save', body))).body.status, 'committed');
    const undone = await request(undoUrl, undoBody); assert.equal(undone.status, 200);
    const undoneState = snapshot();
    assert.equal(undoneState.workspace.activeBlueprint.version, savedState.workspace.activeBlueprint.version + 1);
    assert.deepEqual(undoneState.execution, before.execution);
    const undoReceipt = await request(receiptUrl(undoPlan, 'undo', undoBody, revisionId));
    assert.equal(undoReceipt.body.status, 'committed'); assert.deepEqual(undoReceipt.body.workspace, undoneState.workspace);
    assert.equal((await request(undoUrl, undoBody)).status, 200); assert.deepEqual(snapshot(), undoneState);
    assert.equal(undoneState.edits.length, before.edits.length + 1); assert.equal(undoneState.undos.length, before.undos.length + 1);
  } finally { await server?.close(); store.close(); sql.close(); rmSync(directory, { recursive: true, force: true }); }
});
