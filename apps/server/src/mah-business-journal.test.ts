import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAH_BUSINESS_JOURNAL_SCHEMA, SqliteMahBusinessSubmissionJournal } from './mah-business-journal.js';
import { MahCliBusinessGateway } from './mah-business-gateway.js';
import { businessContracts, type MahBusinessRequest } from './mah-business-contract.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import type { MahPublicRead } from './mah-business-public-result.js';

const ROOT = '/fictional/landi';
function request(): MahBusinessRequest {
  const payload = { data: { message: 'Fictional journey' } };
  return { schemaVersion: 1, kind: 'landi_business_request', requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'planning_conversation', scope: { kind: 'conversation', sessionId: 'fictional', requirementsVersion: 1 },
    businessTime: '2026-10-26T00:00:00Z', input: { contract: businessContracts('planning_conversation').input, payload, sha256: sha256(canonicalJson(payload)) },
    output: { contract: businessContracts('planning_conversation').output },
    execution: { selectionOwner: 'mah', preferredLanguage: 'en', capabilities: ['structured_output'], maxRuntimeSeconds: 60, authority: 'artifact_only' } };
}
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(process.env.LANDI_JOURNAL_CHECK_ROOT ?? tmpdir(), 'fictional-journal-'));
  const path = join(dir, 'journal.sqlite');
  writeFileSync(path, '', { mode: 0o600, flag: 'wx' });
  const handles: DatabaseSync[] = [];
  function open() { const db = new DatabaseSync(path); handles.push(db); return db; }
  const db = open(); db.exec(MAH_BUSINESS_JOURNAL_SCHEMA);
  // Retain fixture databases as evidence; close handles without opening any workspace DB.
  t.after(() => { for (const handle of handles) if (handle.isOpen) handle.close(); });
  return { db, open, journal: new SqliteMahBusinessSubmissionJournal(db) };
}

test('request and task identity survive close/reopen, with exact request bytes', async t => {
  const f = fixture(t), r = request(), original = await f.journal.reserve(r, ROOT);
  assert.equal(f.db.prepare('SELECT request_json FROM mah_business_submissions').get()?.request_json, canonicalJson(r));
  f.db.close();
  assert.deepEqual(await new SqliteMahBusinessSubmissionJournal(f.open()).reserve(r, ROOT), original);
});
test('two independent handles allow exactly one submission claim', async t => {
  const f = fixture(t), second = new SqliteMahBusinessSubmissionJournal(f.open()), r = request();
  const a = await f.journal.reserve(r, ROOT), b = await second.reserve(r, ROOT);
  assert.equal(a.taskId, b.taskId);
  assert.deepEqual(await Promise.all([f.journal.claimSubmission(a.taskId), second.claimSubmission(a.taskId)]), [true, false]);
});
test('changed input, business time or project cannot reuse a frozen request ID', async t => {
  const f = fixture(t), r = request(); await f.journal.reserve(r, ROOT);
  for (const changed of [{ ...r, businessTime: '2026-10-27T00:00:00Z' }, { ...r, scope: { ...r.scope, requirementsVersion: 2 } }]) {
    await assert.rejects(f.journal.reserve(changed as MahBusinessRequest, ROOT), /request_conflict/);
  }
  await assert.rejects(f.journal.reserve(r, '/another/project'), /request_conflict/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mah_business_submissions').get()?.n, 1);
});
test('corrupted persisted request rejects before a claim', async t => {
  const f = fixture(t), mapping = await f.journal.reserve(request(), ROOT);
  f.db.prepare('UPDATE mah_business_submissions SET request_sha256=?').run('0'.repeat(64));
  await assert.rejects(f.journal.claimSubmission(mapping.taskId), /record_invalid/);
  assert.equal(f.db.prepare('SELECT state FROM mah_business_submissions').get()?.state, 'prepared');
});
test('unclaimed, backwards and fabricated validation states reject', async t => {
  const f = fixture(t), mapping = await f.journal.reserve(request(), ROOT);
  await assert.rejects(f.journal.mark(mapping.taskId, 'submitted'), /transition_invalid/);
  await f.journal.claimSubmission(mapping.taskId); await f.journal.mark(mapping.taskId, 'submitted');
  await f.journal.mark(mapping.taskId, 'result_read');
  await f.journal.mark(mapping.taskId, 'result_read');
  await assert.rejects(f.journal.mark(mapping.taskId, 'submitted'), /transition_invalid/);
  await assert.rejects(f.journal.mark(mapping.taskId, 'validated' as never), /transition_invalid/);
  assert.equal((await f.journal.reserve(request(), ROOT)).state, 'result_read');
});
test('outer transaction rejects before mutation, not a false durable acknowledgement', async t => {
  const f = fixture(t); f.db.exec('BEGIN');
  await assert.rejects(f.journal.reserve(request(), ROOT), /transaction_open/);
  f.db.exec('ROLLBACK');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mah_business_submissions').get()?.n, 0);
});
test('unsafe synchronous or journal mode rejects without preparing work', async t => {
  const f = fixture(t); f.db.exec('PRAGMA synchronous=OFF');
  await assert.rejects(f.journal.reserve(request(), ROOT), /durability_unverified/);
  f.db.exec('PRAGMA synchronous=FULL; PRAGMA journal_mode=MEMORY');
  await assert.rejects(f.journal.reserve(request(), ROOT), /durability_unverified/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mah_business_submissions').get()?.n, 0);
});
test('unverified read-only preview blocks before durable journal mutation or task submission', async t => {
  const f = fixture(t); let commands = 0;
  const gateway = new MahCliBusinessGateway({ projectRoot: ROOT, journal: f.journal,
    run: async args => { commands++; assert.ok(args.includes('--preview')); return { code: 0, stdout: JSON.stringify({ ok: false }) }; },
    verifyReceipt: async () => { throw Error('unexpected receipt'); } });
  await assert.rejects(gateway.execute(request()), /submission_contract_unverified/);
  assert.equal(commands, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mah_business_submissions').get()?.n, 0);
});
test('lost submit receipt then journal reopen reads the same task without resubmitting', async t => {
  const f = fixture(t), r = request(); let submits = 0, taskId = '';
  const raw = JSON.stringify({ fictional: true });
  const run: MahPublicRead = async args => {
    if (args[1] === 'submit') { submits++; taskId = args[args.indexOf('--task-id') + 1]!; throw Error('lost fictional receipt'); }
    assert.equal(args[2], taskId);
    const value = args[1] === 'show' ? { ok: true, task: { task_id: taskId, root_dir: ROOT, status: 'completed', task_lifecycle_revision: 1 } }
      : args.includes('--read') ? { content: raw } : [{ subpath: 'artifacts/landi-business-result.json', size: Buffer.byteLength(raw) }];
    return { code: 0, stdout: JSON.stringify(value) };
  };
  const options = { projectRoot: ROOT, run, assertContract: async () => {}, verifyReceipt: async () => ({
    requestSha256: sha256(canonicalJson(r)), artifactSha256: sha256(raw), taskId,
    agentId: 'fictional-agent', modelId: 'fictional-model', startedAt: r.businessTime, completedAt: r.businessTime }) };
  await assert.rejects(new MahCliBusinessGateway({ ...options, journal: f.journal }).execute(r), /lost fictional receipt/);
  assert.equal((await f.journal.reserve(r, ROOT)).state, 'submission_unknown');
  f.db.close(); const reopened = new SqliteMahBusinessSubmissionJournal(f.open());
  assert.equal((await new MahCliBusinessGateway({ ...options, journal: reopened }).execute(r)).raw, raw);
  assert.equal(submits, 1); assert.equal((await reopened.reserve(r, ROOT)).state, 'result_read');
});
