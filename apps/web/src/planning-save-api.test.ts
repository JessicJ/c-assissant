import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { sendAgentChat, getPlanningMessageSaveStatus, PlanningRequirementsSaved } from './api-client.js';

const identity = { messageId: 'fictional-message', expectedRevision: 0 };
const receipt = { ...identity, sessionId: 'fictional-session', savedRevision: 1 };

test('成功状态码缺失或错误的原保存回执仍保持未知', async () => {
  const original = globalThis.fetch;
  try {
    for (const saveReceipt of [undefined, { ...receipt, messageId: 'other' }, { ...receipt, expectedRevision: 3 }, { ...receipt, savedRevision: 8 }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ requirementsSaved: true, saveReceipt, workspace: {} }));
      await assert.rejects(sendAgentChat({ ...identity, mode: 'new_plan', message: '虚构旅行' }));
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ requirementsSaved: true, saveReceipt: receipt, planningRevision: 1, workspace: { planningSession: { id: receipt.sessionId, messages: [{ id: identity.messageId, role: 'user', text: '虚构旅行' }] } } }));
    assert.deepEqual((await sendAgentChat({ ...identity, mode: 'new_plan', message: '虚构旅行' })).saveReceipt, receipt);
  } finally { globalThis.fetch = original; }
});

test('既有方案修订不要求规划消息保存回执', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ reply: '修订结果' }));
    assert.equal((await sendAgentChat({ mode: 'revise_plan', message: '虚构更正' })).reply, '修订结果');
  } finally { globalThis.fetch = original; }
});

test('首次保存丢回执仅按原身份和摘要GET，不传原文或猜会话', async () => {
  const original = globalThis.fetch;
  const text = '虚构旅行敏感原文';
  const digest = createHash('sha256').update(JSON.stringify({ text })).digest('hex');
  try {
    const calls: { url: string; method: string | undefined; cache: string | undefined }[] = [];
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init?.method, cache: init?.cache }); return new Response(JSON.stringify({ inputSha256: digest, saveReceipt: receipt })); };
    assert.ok(await getPlanningMessageSaveStatus(identity, text));
    assert.equal(calls.length, 1); assert.equal(calls[0]!.method, 'GET'); assert.equal(calls[0]!.cache, 'no-store');
    assert.equal(calls[0]!.url.includes(text), false); assert.equal(calls[0]!.url.includes('sessionId='), false);
    assert.ok(calls[0]!.url.includes(`inputSha256=${digest}`));
    globalThis.fetch = async () => new Response(JSON.stringify({ inputSha256: 'wrong' }));
    assert.equal(await getPlanningMessageSaveStatus(identity, text), null);
  } finally { globalThis.fetch = original; }
});

test('回执与会话文本或版本明确矛盾时保持未知', async () => {
  const original = globalThis.fetch;
  const session = { id: receipt.sessionId, messages: [{ id: identity.messageId, role: 'user', text: '虚构旅行' }] };
  const valid = { requirementsSaved: true, saveReceipt: receipt, planningRevision: 1, planningSession: session, workspace: { planningSession: session } };
  try {
    for (const payload of [{ ...valid, planningRevision: 0 }, { ...valid, planningSession: { ...session, id: 'other' } },
      { ...valid, workspace: { planningSession: { ...session, messages: [{ id: identity.messageId, role: 'user', text: '其他原文' }] } } }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(payload));
      await assert.rejects(sendAgentChat({ ...identity, mode: 'new_plan', message: '虚构旅行' }), (error: unknown) => error instanceof Error && !(error instanceof PlanningRequirementsSaved));
    }
  } finally { globalThis.fetch = original; }
});
