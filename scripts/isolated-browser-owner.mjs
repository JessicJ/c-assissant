import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function publishOwnerAtomically(ownerPath, owner, beforeRename = () => {}) {
  const temporary = path.join(path.dirname(ownerPath), `.owner-${randomUUID()}.tmp`);
  let created = false;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    created = true;
    try { writeFileSync(fd, JSON.stringify(owner)); } finally { closeSync(fd); }
    beforeRename();
    renameSync(temporary, ownerPath);
    created = false;
  } finally {
    if (created) unlinkSync(temporary);
  }
}

export function assertPreviousStopped(result) {
  if (result.exit !== 0 || result.signal !== null) throw new Error('旧自有服务未正常退出，不能等待其 owner。');
}

// 只有已证实正常退出的旧自有记录可以在同目录重启期间暂留。
export async function waitForOwner({ readOwner, expectedPid, port, expectedEntry, previousOwner, timeoutMs = 30000, intervalMs = 100, checkAlive = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkAlive();
    const owner = readOwner();
    if (owner) {
      if (owner.kind === 'landi_isolated_development_fixture' && owner.pid === expectedPid && owner.port === port && owner.entry === expectedEntry && typeof owner.startedAt === 'string' && Number.isFinite(Date.parse(owner.startedAt))) return owner;
      if (!previousOwner || !isDeepStrictEqual(owner, previousOwner)) throw new Error('隔离实例所有权不匹配。');
    }
    await delay(intervalMs);
  }
  throw new Error('隔离服务未在限时内更新所有权。');
}
