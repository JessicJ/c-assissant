import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviousStopped, publishOwnerAtomically, waitForOwner } from './isolated-browser-owner.mjs';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const previousOwner = { kind: 'landi_isolated_development_fixture', pid: 10, port: 8123, startedAt: '2026-11-16T00:00:00Z', entry: 'fixture' };
const nextOwner = { ...previousOwner, pid: 11, startedAt: '2026-11-16T00:01:00Z' };
test('原子发布前读取完整旧记录，替换后读取完整新记录', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'landi-owner-test-'));
  try {
    const file = path.join(dir, 'owner.json');
    writeFileSync(file, JSON.stringify(previousOwner));
    publishOwnerAtomically(file, nextOwner, () => {
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), previousOwner);
      assert.equal(readdirSync(dir).filter(name => name.startsWith('.owner-')).length, 1);
    });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), nextOwner);
    assert.deepEqual(readdirSync(dir), ['owner.json']);
  } finally { rmSync(dir, { recursive: true }); }
});
test('发布中断只清理本次临时文件并保留旧记录', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'landi-owner-test-'));
  try {
    const file = path.join(dir, 'owner.json');
    writeFileSync(file, JSON.stringify(previousOwner));
    writeFileSync(path.join(dir, '.owner-unrelated.tmp'), '保留');
    assert.throws(() => publishOwnerAtomically(file, nextOwner, () => { throw new Error('模拟中断'); }), /模拟中断/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), previousOwner);
    assert.deepEqual(readdirSync(dir).sort(), ['.owner-unrelated.tmp', 'owner.json']);
  } finally { rmSync(dir, { recursive: true }); }
});
test('仅等待已停止的自有旧记录直到新 owner 出现', async () => {
  let reads = 0;
  const owner = await waitForOwner({ readOwner: () => ++reads < 3 ? previousOwner : nextOwner, expectedPid: 11, port: 8123, expectedEntry: 'fixture', previousOwner, timeoutMs: 1000, intervalMs: 1 });
  assert.deepEqual(owner, nextOwner);
});
test('未知或篡改的 owner 立即拒绝', async () => {
  for (const owner of [{ ...previousOwner, pid: 12 }, { ...previousOwner, startedAt: 'changed' }, { ...nextOwner, port: 8124 }, { ...nextOwner, entry: 'unknown' }]) {
    await assert.rejects(waitForOwner({ readOwner: () => owner, expectedPid: 11, port: 8123, expectedEntry: 'fixture', previousOwner, timeoutMs: 1000 }), /所有权不匹配/);
  }
});
test('旧记录不更新时超时拒绝', async () => {
  await assert.rejects(waitForOwner({ readOwner: () => previousOwner, expectedPid: 11, port: 8123, expectedEntry: 'fixture', previousOwner, timeoutMs: 15, intervalMs: 2 }), /限时内更新所有权/);
});
test('旧服务必须正常退出且新服务提前退出须拒绝', async () => {
  assert.doesNotThrow(() => assertPreviousStopped({ exit: 0, signal: null }));
  assert.throws(() => assertPreviousStopped({ exit: null, signal: 'SIGTERM' }), /未正常退出/);
  assert.throws(() => assertPreviousStopped({ exit: 1, signal: null }), /未正常退出/);
  await assert.rejects(waitForOwner({ readOwner: () => previousOwner, expectedPid: 11, port: 8123, expectedEntry: 'fixture', previousOwner, checkAlive: () => { throw new Error('自有隔离服务提前退出。'); } }), /提前退出/);
});
