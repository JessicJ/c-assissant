import assert from "node:assert/strict";
import test from "node:test";
import { preparePlanningMessage, forgetRejectedPlanningMessage } from "./planning-message-identity.js";
test("new browser receipt survives lost responses and reload without a second message identity", () => {
  const map = new Map<string, string>(); const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const a = preparePlanningMessage(storage, "pending", "Tokyo", { revision: 0 }, () => "first-id");
  const b = preparePlanningMessage(storage, "pending", "Tokyo", { revision: 1, sessionId: "returned-late" }, () => "must-not-use");
  assert.deepEqual(a, b); assert.equal(a.expectedRevision, 0);
  const c = preparePlanningMessage(storage, "pending", "Osaka", { revision: 1 }, () => "new-id"); assert.equal(c.messageId, "new-id");
});

test("new browser receipt keeps ambiguous submissions but releases rejected stale identities after review", () => {
  const map = new Map<string, string>(); const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k,v); }, removeItem: (k: string) => { map.delete(k); } };
  const old = preparePlanningMessage(storage, "pending", "Fixture", { revision: 1 }, () => "old");
  forgetRejectedPlanningMessage(storage, "pending", "planning_save_failed");
  assert.deepEqual(preparePlanningMessage(storage, "pending", "Fixture", { revision: 2 }, () => "unused"), old);
  forgetRejectedPlanningMessage(storage, "pending", "planning_revision_conflict");
  assert.equal(preparePlanningMessage(storage, "pending", "Fixture", { revision: 2 }, () => "reviewed").messageId, "reviewed");
});

test('损坏或混合待核对记录不能被当作空存储或替换身份', () => {
  for (const raw of ['', '{', '{}', JSON.stringify({ version: 2, pending: [] }), JSON.stringify({ version: 2, pending: {}, message: '原文', identity: { messageId: '原身份', expectedRevision: 0 } }), JSON.stringify({ version: 9, message: '原文', identity: { messageId: '原身份', expectedRevision: 0 } }), JSON.stringify({ version: 2, pending: [{ message: '原文', identity: { messageId: '原身份', expectedRevision: 0 } }, { message: '损坏' }] })]) {
    let bytes = raw, allocated = 0;
    const storage = { getItem: () => bytes, setItem: (_key: string, value: string) => { bytes = value; }, removeItem: () => { bytes = ''; } };
    assert.throws(() => preparePlanningMessage(storage, 'pending', '原文', { revision: 0 }, () => { allocated++; return '替代身份'; }));
    assert.equal(allocated, 0); assert.equal(bytes, raw);
  }
});

test('身份内容冲突与证据缺失不释放原身份，只有确证修订冲突允许重新审阅', () => {
  for (const code of ['planning_message_conflict', 'planning_session_missing', 'planning_identity_required', 'planning_message_invalid']) {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const original = preparePlanningMessage(storage, 'pending', '原文', { revision: 0 }, () => 'original');
    const bytes = values.get('pending');
    forgetRejectedPlanningMessage(storage, 'pending', code, original.messageId);
    assert.equal(values.get('pending'), bytes);
    assert.deepEqual(preparePlanningMessage(storage, 'pending', '原文', { revision: 9 }, () => 'wrong'), original);
  }
});

test('签名损坏与迁移同文本不同编辑不能消除原稿', async () => {
  const { persistPlanningDraft, migratePlanningDraft, readPlanningDraftSignature } = await import('./planning-message-identity.js');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  persistPlanningDraft(storage, 'from', '同文本', true, () => 'edit-A'); persistPlanningDraft(storage, 'to', '同文本', true, () => 'edit-B');
  migratePlanningDraft(storage, 'from', 'to'); assert.equal(storage.getItem('from'), '同文本'); assert.equal(readPlanningDraftSignature(storage, 'from')?.token, 'edit-A');
  storage.removeItem('to'); assert.throws(() => migratePlanningDraft(storage, 'from', 'to')); assert.equal(storage.getItem('from'), '同文本');
  storage.setItem('pending', JSON.stringify({ version: 2, pending: [{ message: 'A', identity: { messageId: 'original', expectedRevision: 0 }, draft: { raw: 'B', token: 'same' } }] }));
  assert.throws(() => preparePlanningMessage(storage, 'pending', 'A', { revision: 0 }, () => 'wrong'));
});
