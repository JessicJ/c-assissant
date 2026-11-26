import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { initializeWorkspaceFixture } from './isolated-workspace-fixture.mjs';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';

test('真实隔离接口保存、重放、重启、撤销与执行连续性', { timeout: 60000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-workspace-api-'));
  writeFileSync(join(directory, 'landi-development-fixture.json'), JSON.stringify({ kind: 'landi_isolated_development_fixture', version: 1 }));
  const initial = initializeWorkspaceFixture(join(directory, 'workspace.sqlite'));
  const store = new SqliteWorkspaceStore(join(directory, 'workspace.sqlite'));
  const initialTask = initial.activePlan.stages.flatMap(stage => stage.tasks).find(task => task.requirementId === 'fixture-preparation-action');
  store.setPlanTaskChecked(initial.activePlan.id, initialTask.id, true);
  const checked = store.getWorkspace();
  store.confirmPlan(checked.activePlan.id, checked.activePlan.version);
  store.close();
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  writeFileSync(join(directory, 'transport.json'), JSON.stringify({ origin: base }));
  let child;
  let diagnostics = '';
  async function start() {
    child = spawn(process.execPath, ['tests/browser/isolated-workspace-server.mjs', '--data-dir', directory, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { diagnostics += data.toString(); });
    child.stderr.on('data', data => { diagnostics += data.toString(); });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error(`隔离服务提前退出：${diagnostics}`);
      try { const response = await fetch(`${base}/api/workspace`); if (response.ok) return; } catch { /* 等待本任务服务 */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`隔离服务未就绪：${diagnostics}`);
  }
  async function stop() { if (child && child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGTERM'); await closed; } }
  const workspace = async () => (await fetch(`${base}/api/workspace`)).json();
  async function post(path, body) { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
  const endpoint = current => `/api/plans/${current.activePlan.id}/blueprint-revisions/direct`;
  const versions = current => ({ expectedVersion: current.activePlan.version, expectedBlueprintVersion: current.activeBlueprint.version });
  try {
    await start();
    const before = await workspace();
    assert.equal(before.activePlan.status, 'active');
    const taskCount = before.activePlan.stages.flatMap(stage => stage.tasks).length;
    const body = { ...versions(before), requestId: 'fixture-save-state', revisions: [
      { kind: 'set_tip_state', tipId: 'fixture-tip-block', pinned: true, hidden: false },
      { kind: 'create_preparation', origin: { kind: 'tip', id: 'fixture-tip-block', blueprintId: before.activeBlueprint.id, blueprintVersion: before.activeBlueprint.version } }
    ] };
    const saved = await post(endpoint(before), body);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    let current = saved.body.workspace;
    assert.equal(current.activeBlueprint.version, before.activeBlueprint.version + 1);
    assert.equal(current.activeBlueprint.travelTips[0].pinned, true);
    assert.equal(current.activePlan.stages.flatMap(stage => stage.tasks).length, taskCount);
    assert.equal(current.executionPlan.id, before.activePlan.id);
    assert.equal(current.executionPlan.version, before.activePlan.version);
    assert.equal(current.activePlan.stages.flatMap(stage => stage.tasks).find(task => task.requirementId === initialTask.requirementId).status, 'completed');
    assert.equal((await post(endpoint(before), body)).body.workspace.activePlan.id, current.activePlan.id);
    assert.equal((await post(endpoint(before), { ...body, requestId: 'fixture-stale-save' })).status, 409);
    const revision = current.latestDirectBlueprintRevision;
    await stop(); await start();
    const restarted = await workspace();
    assert.equal(restarted.activePlan.id, current.activePlan.id);
    assert.equal(restarted.latestDirectBlueprintRevision.id, revision.id);
    assert.equal(restarted.activeBlueprint.preparationChecklist.find(item => item.origin?.kind === 'tip').origin.blueprintVersion, 1);
    const undoBody = { ...versions(restarted), requestId: 'fixture-undo-state' };
    const undoPath = `/api/plans/${restarted.activePlan.id}/blueprint-revisions/${revision.id}/undo`;
    const undone = await post(undoPath, undoBody);
    assert.equal(undone.status, 200, JSON.stringify(undone.body));
    current = undone.body;
    assert.equal(current.activeBlueprint.version, restarted.activeBlueprint.version + 1);
    assert.equal(current.activeBlueprint.preparationChecklist.length, before.activeBlueprint.preparationChecklist.length);
    assert.equal(current.executionPlan.id, before.activePlan.id);
    assert.equal((await post(undoPath, undoBody)).body.activePlan.id, current.activePlan.id);
    assert.equal((await post(undoPath, { ...undoBody, requestId: 'fixture-stale-undo' })).status, 409);
    await stop(); await start();
    assert.equal((await workspace()).activePlan.id, current.activePlan.id);
    const removal = { ...versions(current), requestId: 'fixture-must-removal', revisions: [{ kind: 'remove_place_from_day', placeId: 'fixture-place-1', dayId: 'fixture-day-1' }] };
    const preview = await post(endpoint(current), removal);
    assert.equal(preview.status, 409);
    assert.equal(preview.body.code, 'high_impact_confirmation_required');
    assert.deepEqual(preview.body.impact.dates, ['2026-12-01']);
    assert.deepEqual(preview.body.impact.movementIds, ['fixture-movement']);
    assert.ok(preview.body.impact.reminderRequirementIds.includes('fixture-preparation-action'));
    assert.ok(preview.body.impact.evidence.length);
    assert.equal((await workspace()).activeBlueprint.version, current.activeBlueprint.version);
    const confirmed = await post(endpoint(current), { ...removal, highImpactConfirmation: preview.body.impact.id });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.workspace.activeBlueprint.days[0].stops.some(stop => stop.placeId === 'fixture-place-1'), false);
    assert.equal(confirmed.body.workspace.executionPlan.id, before.activePlan.id);
  } catch (error) { console.error(diagnostics); throw error; }
  finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
});
