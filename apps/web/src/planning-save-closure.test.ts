import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as identities from "./planning-message-identity.js";
import { PlanningMessageRejected, PlanningRequirementsSaved } from './api-client.js';
import * as workDisplay from './planning-work-display.js';
import * as continuationPorts from './planning-continuation.js';

// Exercise the actual component's event handlers and effects with a deterministic
// hook host. No DOM, browser storage, backend, database or MAH process is used.
const compiled = ts.transpileModule(readFileSync(new URL("PlanComposer.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
}).outputText;
type Element = { type: unknown; props: Record<string, any> };
function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const session = () => ({ id: "session", status: "collecting", messages: [], facts: [], unresolved: [], deferred: [], updatedAt: "2026-10-22T00:00:00Z" });
function host(storage: ReturnType<typeof memory>, send: (body: any) => Promise<any>, publish: (workspace: any) => Promise<void> = async () => {}, savedSession?: ReturnType<typeof session>, readStatus: (sessionId: string, messageId: string) => Promise<unknown> = async () => null, readRevision: () => Promise<number> = async () => 1, extraApi: Record<string, unknown> = {}, continuation?: continuationPorts.PlanningContinuationPort) {
  const slots: any[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let cursor = 0, dirty = true, tree: Element, effects: Array<() => void> = [];
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (update: any) => { const next = typeof update === "function" ? update(slots[index]) : update; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const index = cursor++, old = slots[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) { const next = { dependencies, cleanup: undefined as unknown }; slots[index] = next; effects.push(() => { if (typeof old?.cleanup === "function") old.cleanup(); next.cleanup = effect(); }); }
    }
  };
  const api = { PlanningMessageRejected, PlanningRequirementsSaved,
    getPlanningMessageSaveStatus: async (identity: any) => readStatus(identity.sessionId, identity.messageId), getPlanningWorkStatus: readStatus, sendAgentChat: send, getPlanningRevision: readRevision, ...extraApi };
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  const exports: any = {};
  const context = vm.createContext({ exports, EventSource: class { addEventListener() {} close() {} }, localStorage: storage, crypto: { randomUUID: (() => { let i = 0; return () => `display-${++i}`; })() },
    window: { setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: (id: number) => { timers.delete(id); }, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} },
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.includes("planning-message-identity")) return identities;
      if (name.includes('planning-work-display')) return workDisplay;
      if (name.includes("api-client")) return api;
      if (name.includes("planning-continuation")) return continuationPorts;
      if (name.includes("assistant-personality")) return { resolveAssistantPersonality: () => ({ id: "local_insider" }), assistantPlanningWelcome: () => "Welcome" };
      if (name.includes("planning-budget")) return { hasStatedBudgetAmount: () => false };
      if (name.includes("conversation-state")) return { conversationStorageKey: () => "conversation", conversationFromPlanningSession: (value: any) => value?.messages ?? [], loadConversation: () => [] };
      return new Proxy({}, { get: () => () => "" });
    }
  });
  vm.runInContext(compiled, context);
  const errors: string[] = [];
  const props: any = { mode: "new_plan", currentPlan: null, planningSession: savedSession, initialMessage: "", profile: {}, continuation, onPlanCreated: publish, onError(message: string) { errors.push(message); }, onStatus() {}, onComplete() {} };
  function render() {
    for (let i = 0; dirty && i < 30; i++) {
      dirty = false; cursor = 0; effects = [];
      tree = exports.PlanComposer(props);
      for (const effect of effects) effect();
    }
    assert.equal(dirty, false, "Component must settle");
  }
  function find(predicate: (element: Element) => boolean, node: any): Element | undefined {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) return node.map((child) => find(predicate, child)).find(Boolean);
    if (predicate(node)) return node;
    return find(predicate, node.props?.children);
  }
  async function flush() { await new Promise<void>((resolve) => setImmediate(resolve)); render(); await new Promise<void>((resolve) => setImmediate(resolve)); render(); }
  render();
  return { flush, errors, expireAdmission() { const timer = [...timers.values()].at(-1); assert.ok(timer); timer(); render(); }, unmount() { for (const value of slots) if (typeof value?.cleanup === 'function') value.cleanup(); },
    revision: () => find((element) => Boolean(element.props?.baseline), tree)!.props.baseline.revision,
    recheck() { find((element) => Boolean(element.props?.baseline), tree)!.props.onRecheck(); },
    disabled: () => find((element) => element.type === 'textarea', tree)!.props.disabled,
    generationDisabled: () => find((element) => element.type === 'button' && element.props.children === 'Generate plan', tree)?.props.disabled,
    setContinuation(value: continuationPorts.PlanningContinuationPort | undefined) { props.continuation = value; dirty = true; render(); },
    click(label: string) { find((element) => element.type === 'button' && element.props.children === label, tree)!.props.onClick(); }, setSession(value: ReturnType<typeof session> | undefined) { props.planningSession = value; dirty = true; render(); },
    text: () => JSON.stringify(tree),
    input: () => find((element) => element.type === "textarea", tree)!.props.value,
    type(value: string) { find((element) => element.type === "textarea", tree)!.props.onChange({ target: { value } }); render(); },
    async submit() { find((element) => element.props?.className === "send-button", tree)!.props.onClick(); await flush(); }
  };
}

function localStatus(sessionId: string, messageId: string, status = 'submission_unknown') {
  return { schemaVersion: 1, sessionId, messageId, observedAt: new Date().toISOString(), executable: false,
    requirementsSaved: true, saveReceipt: { sessionId, messageId, expectedRevision: 0, savedRevision: 1 }, planningRevision: 1,
    localWork: { workId: 'work', requestId: 'request', taskId: 'same-task', status, savedRevision: 1, resultApplied: false },
    mahStatus: { status: 'unverified', reason: 'not_queried' } };
}

function restored() {
  const storage = memory();
  const signature = identities.persistPlanningDraft(storage, 'conversation:input:session', 'Saved fictional trip', true, () => 'edit-original')!;
  identities.preparePlanningMessage(storage, 'conversation:pending-message', 'Saved fictional trip', { sessionId: 'session', revision: 0 }, () => 'saved-message', signature);
  storage.setItem('conversation:input:session', 'Saved fictional trip');
  const persisted = { ...session(), messages: [{ id: 'saved-message', role: 'user', text: 'Saved fictional trip' }] } as any;
  return { storage, persisted };
}
test('closure: revision conflict performs only GET until the user explicitly retries', async () => {
  const storage = memory(), posts: any[] = []; let reads = 0;
  const ui = host(storage, async body => {
    posts.push(body);
    if (posts.length === 1) throw new PlanningMessageRejected('planning_revision_conflict', 'Requirements changed.');
    throw new PlanningRequirementsSaved({ sessionId: 'session', messageId: body.messageId, expectedRevision: body.expectedRevision, savedRevision: body.expectedRevision + 1 });
  }, undefined, session(), undefined, async () => ++reads);
  await ui.flush(); ui.type('Fictional trip'); await ui.submit(); await ui.flush();
  assert.equal(reads, 2); assert.equal(posts.length, 1); assert.equal(ui.input(), 'Fictional trip');
  assert.equal(storage.getItem('conversation:pending-message'), null);
  await ui.submit();
  assert.equal(posts.length, 2); assert.equal(posts[1].expectedRevision, 2);
  assert.notEqual(posts[1].messageId, posts[0].messageId);
});
test('closure: failed conflict version GET preserves text and blocks another POST', async () => {
  let reads = 0, posts = 0;
  const ui = host(memory(), async () => { posts++; throw new PlanningMessageRejected('planning_revision_conflict', 'Changed'); }, undefined, session(), undefined,
    async () => { if (++reads > 1) throw Error('Read unavailable'); return 1; });
  await ui.flush(); ui.type('Keep this'); await ui.submit(); await ui.flush(); await ui.submit();
  assert.equal(reads, 2); assert.equal(posts, 1); assert.equal(ui.input(), 'Keep this');
});
test('closure: fresh exact receipt settles restored pending text without POST', async () => {
  const { storage, persisted } = restored(); let posts = 0;
  const ui = host(storage, async () => { posts++; }, undefined, persisted, async (sid, mid) => localStatus(sid, mid));
  await ui.flush(); assert.equal(ui.input(), ''); assert.equal(posts, 0);
  assert.equal(storage.getItem('conversation:pending-message'), null);
  assert.equal(storage.getItem('conversation:input:session'), null);
});
test('closure: newer stored draft survives exact old-message reconciliation', async () => {
  const { storage, persisted } = restored(); identities.persistPlanningDraft(storage, 'conversation:input:session', 'New preference', true);
  const ui = host(storage, async () => { throw Error('No POST'); }, undefined, persisted, async (sid, mid) => localStatus(sid, mid));
  await ui.flush(); assert.equal(ui.input(), 'New preference');
  assert.equal(storage.getItem('conversation:input:session'), 'New preference');
  assert.equal(storage.getItem('conversation:pending-message'), null);
});
test('closure: edits while GET is pending survive, even when text equals the old message', async () => {
  for (const newer of ['Later preference', 'Saved fictional trip']) {
    const { storage, persisted } = restored(); let resolve!: (value: unknown) => void;
    const ui = host(storage, async () => { throw Error('No POST'); }, undefined, persisted, () => new Promise(done => { resolve = done; }));
    await ui.flush(); ui.type('Editing'); ui.type(newer);
    resolve(localStatus('session', 'saved-message')); await ui.flush();
    assert.equal(ui.input(), newer); assert.equal(storage.getItem('conversation:input:session'), newer);
    assert.equal(storage.getItem('conversation:pending-message'), null);
  }
});
test('closure: missing, stale, crossed and revision-mismatched evidence never clears text', async () => {
  const cases = [null, { ...localStatus('session', 'saved-message'), observedAt: '2000-01-01T00:00:00Z' },
    localStatus('other-session', 'saved-message'), localStatus('session', 'other-message'),
    { ...localStatus('session', 'saved-message'), saveReceipt: { sessionId: 'session', messageId: 'saved-message', expectedRevision: 4, savedRevision: 5 }, planningRevision: 5 }];
  for (const value of cases) {
    const { storage, persisted } = restored();
    const ui = host(storage, async () => { throw Error('No POST'); }, undefined, persisted, async () => value);
    await ui.flush(); assert.equal(ui.input(), 'Saved fictional trip');
    assert.notEqual(storage.getItem('conversation:pending-message'), null);
  }
});
test('closure: persisted message text mismatch does not settle the pending identity', async () => {
  const { storage, persisted } = restored(); persisted.messages[0].text = 'Different persisted text';
  const ui = host(storage, async () => { throw Error('No POST'); }, undefined, persisted, async (sid, mid) => localStatus(sid, mid));
  await ui.flush(); assert.equal(ui.input(), 'Saved fictional trip');
  assert.notEqual(storage.getItem('conversation:pending-message'), null);
});
test('closure: acknowledged downstream failure uses existing notice without duplicate global error', async () => {
  let posts = 0;
  const ui = host(memory(), async body => { posts++; throw new PlanningRequirementsSaved({ sessionId: 'session', messageId: body.messageId, expectedRevision: body.expectedRevision, savedRevision: body.expectedRevision + 1 }); }, undefined, session(), async (sid, mid) => localStatus(sid, mid));
  await ui.flush(); ui.type('Fictional trip'); await ui.submit();
  assert.equal(posts, 1); assert.equal(ui.input(), ''); assert.deepEqual(ui.errors, []);
  assert.ok(ui.text().includes(workDisplay.savedProcessingUnverified));
});

test('首次无会话回执丢失后重开只按原身份GET并清理原草稿', async () => {
  const storage = memory();
  const signature = identities.persistPlanningDraft(storage, 'conversation:input:new', '原始旅行', true, () => 'edit-original')!;
  identities.preparePlanningMessage(storage, 'conversation:pending-message', '原始旅行', { revision: 0 }, () => 'original', signature);
  storage.setItem('conversation:input:new', '原始旅行');
  const calls: any[] = []; let posts = 0;
  const ui = host(storage, async () => { posts++; }, undefined, undefined, undefined, undefined, {
    getPlanningMessageSaveStatus: async (identity: any, text: string) => { calls.push({ identity, text }); return localStatus('session', 'original'); }
  });
  await ui.flush();
  assert.equal(posts, 0); assert.equal(ui.input(), ''); assert.equal(storage.getItem('conversation:pending-message'), null);
  assert.equal(calls[0].identity.messageId, 'original'); assert.equal(calls[0].identity.sessionId, undefined);
});

test('原回执GET晚到不能清除相同文本的新编辑或发布到另一会话', async () => {
  for (const switched of [false, true]) {
    const storage = memory(); let resolve!: (value: unknown) => void;
    const signature = identities.persistPlanningDraft(storage, 'conversation:input:session', '同文本', true, () => 'edit-original')!;
    identities.preparePlanningMessage(storage, 'conversation:pending-message', '同文本', { sessionId: 'session', revision: 0 }, () => 'original', signature);
    storage.setItem('conversation:input:session', '同文本');
    const ui = host(storage, async () => { throw Error('禁止发送'); }, undefined, session(), undefined, undefined, {
      getPlanningMessageSaveStatus: () => new Promise(done => { resolve = done; })
    });
    await ui.flush();
    if (switched) ui.setSession({ ...session(), id: 'session-B' });
    ui.type('临时编辑'); ui.type('同文本');
    resolve(localStatus('session', 'original')); await ui.flush();
    assert.equal(ui.input(), '同文本');
    assert.equal(storage.getItem(switched ? 'conversation:input:session-B' : 'conversation:input:session'), '同文本');
    if (switched) assert.notEqual(storage.getItem('conversation:pending-message'), null);
  }
});

test('未知保存的普通发送只核对，明确重试仍沿原身份并再次先GET', async () => {
  const storage = memory(), events: string[] = [], bodies: any[] = [];
  const signature = identities.persistPlanningDraft(storage, 'conversation:input:new', '原始旅行', true, () => 'edit-original')!;
  identities.preparePlanningMessage(storage, 'conversation:pending-message', '原始旅行', { revision: 0 }, () => 'original', signature);
  storage.setItem('conversation:input:new', '原始旅行');
  const ui = host(storage, async body => { events.push('POST'); bodies.push(body); throw Error('响应仍未知'); }, undefined, undefined, undefined, undefined, {
    getPlanningMessageSaveStatus: async () => { events.push('GET'); return null; }
  });
  await ui.flush(); await ui.submit(); assert.equal(bodies.length, 0);
  ui.click('Retry original save'); await ui.flush();
  assert.equal(bodies.length, 1); assert.equal(bodies[0].messageId, 'original'); assert.equal(bodies[0].expectedRevision, 0);
  assert.equal(events[events.indexOf('POST') - 1], 'GET');
});

test('自己的保存使父组件刷新同会话版本后输入仍可编辑', async () => {
  let ui!: ReturnType<typeof host>, posts = 0;
  ui = host(memory(), async body => { posts++; return { workspace: {}, planningSession: session(), planningRevision: 2, blocked: true }; }, async () => {
    ui.setSession({ ...session(), updatedAt: '2026-11-19T00:00:00Z' });
  }, session());
  await ui.flush(); ui.type('新的旅行'); await ui.submit(); await ui.flush();
  assert.equal(posts, 1); assert.equal(ui.disabled(), false);
  ui.type('再次编辑'); assert.equal(ui.input(), '再次编辑');
});

test('旧保存结果晚于同会话新版本不覆盖版本与新输入', async () => {
  let resolve!: (value: unknown) => void;
  const ui = host(memory(), () => new Promise(done => { resolve = done; }), undefined, session());
  await ui.flush(); ui.type('旧输入'); await ui.submit();
  ui.setSession({ ...session(), updatedAt: '2026-11-19T00:00:00Z' }); await ui.flush(); ui.type('新输入');
  resolve({ workspace: {}, planningSession: session(), planningRevision: 2, blocked: true }); await ui.flush();
  assert.equal(ui.input(), '新输入'); assert.equal(ui.disabled(), false);
});

test('完成结果的工作区GET晚到不能打开另一会话或卸载后的页面', async () => {
  for (const unmounted of [false, true]) {
    let resolve!: (value: unknown) => void, published = 0;
    const original = { ...session(), status: 'draft_ready', outputPlanId: 'old-plan' } as any;
    const ui = host(memory(), async () => {}, async () => { published++; }, original, undefined, undefined, {
      getWorkspace: () => new Promise(done => { resolve = done; })
    });
    await ui.flush();
    if (unmounted) ui.unmount(); else ui.setSession({ ...session(), id: 'session-B' });
    resolve({ activePlan: { id: 'old-plan' } }); await ui.flush();
    assert.equal(published, 0);
  }
});

test('旧生成GET与轮询结果晚到不能应用到新会话', async () => {
  const pending: ((value: unknown) => void)[] = []; let published = 0;
  const ui = host(memory(), async () => {}, async () => { published++; }, { ...session(), status: 'generating' } as any, undefined, undefined, {
    getPlanningGeneration: () => new Promise(done => { pending.push(done); }),
    planningGenerationEventsUrl: () => '/fictional-events'
  });
  await ui.flush(); assert.equal(pending.length, 2);
  ui.setSession({ ...session(), id: 'session-B' }); await ui.flush(); ui.type('会话B草稿');
  for (const resolve of pending) resolve({ sessionStatus: 'draft_ready', outputPlanId: 'old-plan', generation: null });
  await ui.flush(); assert.equal(published, 0); assert.equal(ui.input(), '会话B草稿'); assert.equal(ui.disabled(), false);
});

test('旧修订GET晚于已保存回执不能降低下次明确保存版本', async () => {
  let reads = 0, resolve!: (value: number) => void; const bodies: any[] = [];
  const ui = host(memory(), async body => { bodies.push(body); return { workspace: {}, planningSession: session(), planningRevision: body.expectedRevision + 1, blocked: true }; }, undefined, session(), undefined,
    () => ++reads === 1 ? Promise.resolve(1) : new Promise(done => { resolve = done; }));
  await ui.flush(); ui.setSession({ ...session(), updatedAt: '2026-11-19T00:00:00Z' }); await ui.flush();
  ui.type('第一次保存'); await ui.submit(); resolve(1); await ui.flush();
  ui.type('第二次保存'); await ui.submit();
  assert.equal(bodies.length, 2); assert.equal(bodies[1].expectedRevision, 2);
});

test('修订对账同会话两种返回顺序均保全较新版本、草稿及下一次明确保存身份', async () => {
  for (const revisionFirst of [true, false]) {
    const storage = memory(), bodies: any[] = [], reads: any[] = [];
    const signature = identities.persistPlanningDraft(storage, 'conversation:input:session', '原始需求', true, () => '原编辑')!;
    const original = identities.preparePlanningMessage(storage, 'conversation:pending-message', '原始需求', { sessionId: 'session', revision: 0 }, () => '原消息', signature);
    let revisionDone!: (value: number) => void, receiptDone!: (value: unknown) => void;
    const ui = host(storage, async body => { bodies.push(body); throw Error('保留明确保存的原身份'); }, undefined, session(), undefined,
      () => new Promise(done => { revisionDone = done; }), {
        getPlanningMessageSaveStatus: (identity: any) => { reads.push({ ...identity }); return new Promise(done => { receiptDone = done; }); }
      });
    ui.type('后续草稿');
    assert.equal(reads[0].messageId, original.messageId);
    assert.equal(reads[0].expectedRevision, 0);
    // 两次返回之间只推进微任务，不调用 render 或 effect。
    if (revisionFirst) { revisionDone(2); await Promise.resolve(); receiptDone(localStatus('session', '原消息')); }
    else { receiptDone(localStatus('session', '原消息')); await Promise.resolve(); revisionDone(2); }
    await ui.flush();
    console.log(JSON.stringify({ 场景: 'B01实际handler返回顺序', 修订先返回: revisionFirst, 最终修订: ui.revision(), 自动POST: bodies.length, 草稿: ui.input() }));
    assert.equal(ui.input(), '后续草稿'); assert.equal(bodies.length, 0); assert.equal(ui.revision(), 2);
    await ui.submit();
    assert.equal(bodies.length, 1); assert.equal(bodies[0].expectedRevision, 2); assert.equal(bodies[0].sessionId, 'session');
    const pending = identities.pendingPlanningMessage(storage, 'conversation:pending-message', 'session')!;
    assert.equal(pending.identity.messageId, bodies[0].messageId); assert.equal(pending.identity.expectedRevision, 2);
    assert.equal(pending.message, '后续草稿');
  }
});

test('较新GET之后的普通保存、已保存异常及缺失修订成功均不回填旧版本', async () => {
  for (const result of ['普通成功', '已保存异常', '缺失修订'] as const) {
    let reads = 0, revisionDone!: (value: number) => void, saveDone!: (value: any) => void, saveFail!: (value: unknown) => void;
    const bodies: any[] = [];
    const ui = host(memory(), body => { bodies.push(body); return new Promise((done, fail) => { saveDone = done; saveFail = fail; }); }, undefined, session(), undefined,
      () => ++reads === 1 ? Promise.resolve(1) : new Promise(done => { revisionDone = done; }));
    await ui.flush(); ui.setSession({ ...session(), updatedAt: '2026-11-19T01:00:00Z' }); await ui.flush();
    ui.type('旧保存'); await ui.submit(); assert.equal(bodies[0].expectedRevision, 1);
    revisionDone(5); await Promise.resolve();
    if (result === '已保存异常') saveFail(new PlanningRequirementsSaved({ sessionId: 'session', messageId: bodies[0].messageId, expectedRevision: 1, savedRevision: 2 }));
    else saveDone({ workspace: {}, planningSession: session(), ...(result === '普通成功' ? { planningRevision: 2 } : {}), blocked: true });
    await ui.flush(); assert.equal(ui.revision(), 5); assert.equal(bodies.length, 1);
    ui.type('下次明确保存'); await ui.submit(); assert.equal(bodies[1].expectedRevision, 5); assert.equal(bodies[1].sessionId, 'session');
  }
});

test('GET失败和冲突失效均保留高水位，低旧回执不能解除未知，新读回后仅明确保存', async () => {
  for (const conflict of [false, true]) {
    const storage = memory(), bodies: any[] = [];
    let reads = 0, receiptDone!: (value: any) => void;
    const ui = host(storage, async body => { bodies.push(body); throw new PlanningMessageRejected('planning_revision_conflict', '版本冲突'); }, undefined, session(), undefined,
      async () => { reads++; if (reads === 2) throw Error('只读失败'); return reads === 1 ? 5 : 6; },
      { getPlanningMessageSaveStatus: () => new Promise(done => { receiptDone = done; }) });
    await ui.flush(); assert.equal(ui.revision(), 5);
    if (conflict) { ui.type('冲突草稿'); await ui.submit(); await ui.flush(); }
    else { ui.setSession({ ...session(), updatedAt: '2026-11-19T01:00:00Z' }); await ui.flush(); }
    assert.equal(ui.revision(), undefined);
    const key = 'conversation:input:session';
    const signature = identities.persistPlanningDraft(storage, key, '原消息草稿', true, () => '旧签名')!;
    identities.preparePlanningMessage(storage, 'conversation:pending-message', '原消息草稿', { sessionId: 'session', revision: 0 }, () => '旧消息', signature);
    ui.type('较新草稿');
    ui.recheck();
    receiptDone(localStatus('session', '旧消息')); await ui.flush();
    assert.equal(ui.revision(), undefined); assert.equal(ui.input(), '较新草稿');
    const count = bodies.length; await ui.submit(); assert.equal(bodies.length, count);
    ui.setSession({ ...session(), updatedAt: '2026-11-19T02:00:00Z' }); await ui.flush();
    assert.equal(ui.revision(), 6); assert.equal(bodies.length, count);
    await ui.submit(); assert.equal(bodies.length, count + 1); assert.equal(bodies.at(-1).expectedRevision, 6);
  }
});

test('跨会话高低值独立初始化，A到无会话再回A在读回前保持未知', async () => {
  let reads = 0, done!: (value: number) => void;
  const bodies: any[] = [];
  const ui = host(memory(), async body => { bodies.push(body); throw Error('保持请求'); }, undefined, session(), undefined,
    () => ++reads === 1 ? Promise.resolve(9) : new Promise(resolve => { done = resolve; }));
  await ui.flush(); assert.equal(ui.revision(), 9);
  ui.setSession({ ...session(), id: 'B' }); assert.equal(ui.revision(), undefined);
  done(2); await ui.flush(); assert.equal(ui.revision(), 2); ui.type('B草稿'); await ui.submit();
  assert.equal(bodies[0].sessionId, 'B'); assert.equal(bodies[0].expectedRevision, 2);
  ui.setSession(undefined); await ui.flush(); assert.equal(ui.revision(), 0);
  ui.setSession(session()); assert.equal(ui.revision(), undefined);
  ui.type('A新草稿'); await ui.submit(); assert.equal(bodies.length, 1);
  done(4); await ui.flush(); assert.equal(ui.revision(), 4); await ui.submit();
  assert.equal(bodies[1].sessionId, 'session'); assert.equal(bodies[1].expectedRevision, 4);
});

test('三种首次绑定保留已确认修订，随后较低较高或失败GET均不恢复旧低值', async () => {
  for (const path of ['回执', '普通成功', '已保存异常'] as const) for (const next of ['较低', '较高', '失败'] as const) {
    const storage = memory(), bodies: any[] = []; let reads = 0;
    const signature = identities.persistPlanningDraft(storage, 'conversation:input:new', '首份需求', true, () => '首编辑')!;
    if (path === '回执') identities.preparePlanningMessage(storage, 'conversation:pending-message', '首份需求', { revision: 0 }, () => '首消息', signature);
    const ui = host(storage, async body => {
      bodies.push(body);
      if (path === '已保存异常') throw new PlanningRequirementsSaved({ sessionId: 'session', messageId: body.messageId, expectedRevision: 0, savedRevision: 1 });
      return { workspace: {}, planningSession: session(), planningRevision: 1, blocked: true };
    }, undefined, undefined, undefined, async () => { reads++; if (next === '失败') throw Error('只读失败'); return next === '较低' ? 0 : 3; },
    { getPlanningMessageSaveStatus: async () => localStatus('session', '首消息') });
    if (path !== '回执') { ui.type('首份需求'); await ui.submit(); }
    await ui.flush(); assert.ok(reads > 0); assert.equal(bodies.length, path === '回执' ? 0 : 1);
    assert.equal(ui.revision(), next === '失败' ? undefined : next === '较高' ? 3 : 1);
    ui.type('绑定后草稿'); const count = bodies.length;
    if (next === '失败') { await ui.submit(); assert.equal(bodies.length, count); assert.equal(ui.input(), '绑定后草稿'); }
  }
});

test('同值重复观察幂等，失败后低GET保持未知直到新的不低于高水位读回', async () => {
  const values = [5, 5, new Error('只读失败'), 1, 6]; let reads = 0;
  const ui = host(memory(), async () => { throw Error('本场景禁止保存'); }, undefined, session(), undefined,
    async () => { const value = values[reads++]; if (value instanceof Error) throw value; return value as number; });
  await ui.flush(); assert.equal(ui.revision(), 5);
  for (const [i, expected] of [5, undefined, undefined, 6].entries()) {
    ui.setSession({ ...session(), updatedAt: `2026-11-19T0${i}:00:00Z` }); await ui.flush();
    assert.equal(ui.revision(), expected);
  }
});

test('切换会话后A迟到的高修订GET不能污染B较低版本及明确保存', async () => {
  let reads = 0, oldDone!: (value: number) => void; const bodies: any[] = [];
  const ui = host(memory(), async body => { bodies.push(body); throw Error('保持原请求'); }, undefined, session(), undefined,
    () => ++reads === 1 ? new Promise(done => { oldDone = done; }) : Promise.resolve(2));
  ui.setSession({ ...session(), id: 'B' }); await ui.flush(); assert.equal(ui.revision(), 2);
  oldDone(99); await ui.flush(); assert.equal(ui.revision(), 2);
  ui.type('B原文'); await ui.submit(); assert.equal(bodies[0].expectedRevision, 2); assert.equal(bodies[0].sessionId, 'B');
});

test('保存后的工作区异常只显示稳定提示，不泄漏内部路径', async () => {
  const ui = host(memory(), async () => ({ workspace: {}, planningSession: session(), planningRevision: 2, blocked: true }),
    async () => { throw new Error('/private/fixture-only'); }, session());
  await ui.flush(); ui.type('旅行者原文保持'); await ui.submit();
  assert.equal(ui.input(), '');
  assert.ok(ui.errors.length > 0);
  assert.equal(ui.errors.join(' ').includes('/private/fixture-only'), false);
  assert.equal(ui.text().includes('/private/fixture-only'), false);
  assert.ok(ui.text().includes('Requirements saved'));
});

test('会话退回无会话或首次请求被外部会话取代时旧保存不能发布', async () => {
  for (const fromExisting of [false, true]) {
    const storage = memory(); let resolve!: (value: unknown) => void, published = 0;
    const ui = host(storage, () => new Promise(done => { resolve = done; }), async () => { published++; }, fromExisting ? session() : undefined);
    await ui.flush(); ui.type('旧请求'); await ui.submit();
    ui.setSession(fromExisting ? undefined : { ...session(), id: 'external-B' }); await ui.flush(); ui.type('新范围草稿');
    resolve({ workspace: {}, planningSession: session(), planningRevision: 2, blocked: true }); await ui.flush();
    assert.equal(published, 0); assert.equal(ui.input(), '新范围草稿');
    assert.ok(storage.getItem('conversation:pending-message')?.includes('旧请求'));
  }
});

test('成功状态码的明确矛盾经真实API解析后不清草稿与pending', async () => {
  const original = globalThis.fetch;
  const { sendAgentChat } = await import('./api-client.js');
  const storage = memory();
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ requirementsSaved: true, saveReceipt: { sessionId: 'session', messageId: body.messageId, expectedRevision: body.expectedRevision, savedRevision: body.expectedRevision + 1 },
        planningRevision: body.expectedRevision + 1, workspace: { planningSession: { id: 'session', messages: [{ id: body.messageId, role: 'user', text: '矛盾内容' }] } } }));
    };
    const ui = host(storage, sendAgentChat, undefined, session()); await ui.flush(); ui.type('保留旅行者原文'); await ui.submit();
    assert.equal(ui.input(), '保留旅行者原文'); assert.ok(storage.getItem('conversation:pending-message')?.includes('保留旅行者原文'));
    assert.equal(storage.getItem('conversation:input:session'), '保留旅行者原文');
  } finally { globalThis.fetch = original; }
});

test('原始首尾空格草稿丢回执刷新恢复按签名清理，普通发送不产生替代身份', async () => {
  const storage = memory(); let calls = 0, originalId = '', reads = 0;
  const send = async (body: any) => { calls++; originalId = body.messageId; throw Error('响应丢失'); };
  const ui = host(storage, send);
  ui.type(' A '); await ui.submit(); await ui.flush();
  assert.equal(ui.input(), ' A '); assert.equal(storage.getItem('conversation:input:new'), ' A ');
  assert.ok(storage.getItem('conversation:pending-message')); assert.ok(storage.getItem('conversation:input:new:edit'));
  ui.unmount();
  const reloaded = host(storage, send, undefined, undefined, undefined, undefined, {
    getPlanningMessageSaveStatus: async (identity: any) => { reads++; assert.equal(identity.messageId, originalId); return localStatus('session', originalId); }
  });
  await reloaded.flush(); assert.ok(reads > 0);
  assert.equal(reloaded.input(), ''); assert.equal(storage.getItem('conversation:pending-message'), null);
  assert.equal(storage.getItem('conversation:input:new'), null); assert.equal(storage.getItem('conversation:input:new:edit'), null);
  await reloaded.submit(); assert.equal(calls, 1);
});

test('同文本新编辑经过刷新后旧回执仍保留新草稿', async () => {
  const storage = memory(); let resolve!: (value: unknown) => void;
  const ui = host(storage, async () => { throw Error('响应丢失'); }, undefined, session(), undefined, undefined, { getPlanningMessageSaveStatus: () => new Promise(done => { resolve = done; }) });
  await ui.flush(); ui.type('A'); await ui.submit();
  ui.click('Check original save'); await ui.flush(); assert.equal(typeof resolve, 'function');
  ui.type('B'); ui.type('A');
  const pending = identities.pendingPlanningMessage(storage, 'conversation:pending-message', 'session')!;
  const reloaded = host(storage, async () => { throw Error('禁止替代发送'); }, undefined, session(), undefined, undefined, { getPlanningMessageSaveStatus: async () => localStatus('session', pending.identity.messageId) });
  await reloaded.flush(); assert.equal(reloaded.input(), 'A'); assert.equal(storage.getItem('conversation:input:session'), 'A');
  resolve(localStatus('session', pending.identity.messageId)); await ui.flush(); assert.equal(ui.input(), 'A');
});

test('外部首次进入已有会话恢复其历史和草稿，保留无会话原稿', async () => {
  const storage = memory();
  const ui = host(storage, async () => { throw Error('禁止发送'); }); ui.type('无会话原稿');
  identities.persistPlanningDraft(storage, 'conversation:input:B', 'B草稿', true);
  ui.setSession({ ...session(), id: 'B', messages: [{ id: 'B-history', role: 'user', text: 'B历史' }] } as any); await ui.flush();
  assert.equal(ui.input(), 'B草稿'); assert.ok(ui.text().includes('B历史')); assert.equal(storage.getItem('conversation:input:new'), '无会话原稿');
});


function readyForContinuation() {
  return { ...session(), status: 'proposal_ready', proposal: { version: 1, title: 'Fictional trip' },
    facts: ['destination','purpose','travel_dates','arrival','departure','party_size','transport_preference'].map(key => ({ key, value: 'fictional', confirmed: true })) } as any;
}
test('explicit development continuation uses actual handler once; reads never confirm and production remains blocked', async () => {
  let confirmations = 0, checks = 0;
  const ready = readyForContinuation();
  const port = continuationPorts.createIsolatedPlanningContinuation(async scope => { checks++; return { ...scope, ready: true, validUntil: Date.now() + 10000 }; });
  const api = { confirmPlanningProposal: async (sessionId: string, proposalVersion: number, expectedRevision: number) => {
    confirmations++; assert.equal(sessionId, ready.id); assert.equal(proposalVersion, ready.proposal.version); assert.equal(expectedRevision, 1);
    return { generated: false, planningSession: ready, workspace: { planningSession: ready } };
  }};
  const blocked = host(memory(), async () => {}, undefined, ready, undefined, undefined, api);
  await blocked.flush(); assert.equal(blocked.generationDisabled(), true); assert.equal(confirmations, 0);
  const ui = host(memory(), async () => {}, undefined, ready, undefined, undefined, api, port);
  await ui.flush(); assert.ok(checks >= 1); assert.equal(ui.generationDisabled(), false); assert.equal(confirmations, 0);
  ui.click('Generate plan'); ui.click('Generate plan'); await ui.flush();
  assert.equal(confirmations, 1); assert.ok(checks >= 2, 'Click must check again before the existing API');
});
test('development continuation revoked or scope changed during click cannot confirm or clear the draft', async () => {
  for (const change of ['revoked','scope','edit'] as const) {
    let reads = 0, confirmations = 0, resolve!: (value: continuationPorts.PlanningContinuationObservation) => void;
    const ready = readyForContinuation();
    const port = continuationPorts.createIsolatedPlanningContinuation(async scope => {
      if (++reads === 1) return { ...scope, ready: true, validUntil: Date.now() + 10000 };
      return new Promise(done => { resolve = done; });
    });
    const ui = host(memory(), async () => {}, undefined, ready, undefined, undefined,
      { confirmPlanningProposal: async () => { confirmations++; } }, port);
    await ui.flush(); ui.type('Keep this newer draft'); ui.click('Generate plan');
    if (change === 'scope') ui.setSession({ ...ready, id: 'other-session' });
    if (change === 'edit') ui.type('Edited during the explicit check');
    resolve({ sessionId: ready.id, revision: 1, proposalVersion: 1, ready: change !== 'revoked', validUntil: Date.now() + 10000 });
    await ui.flush(); assert.equal(confirmations, 0);
    if (change === 'revoked') assert.equal(ui.input(), 'Keep this newer draft');
    if (change === 'edit') assert.equal(ui.input(), 'Edited during the explicit check');
  }
});


test('removing or replacing the development port while its check is pending cannot confirm', async () => {
  for (const replace of [false, true]) {
    let checks = 0, confirmations = 0, resolve!: (value: continuationPorts.PlanningContinuationObservation) => void;
    const ready = readyForContinuation();
    const port = continuationPorts.createIsolatedPlanningContinuation(async scope => {
      if (++checks === 1) return { ...scope, ready: true, validUntil: Date.now() + 10000 };
      return new Promise(done => { resolve = done; });
    });
    const ui = host(memory(), async () => {}, undefined, ready, undefined, undefined,
      { confirmPlanningProposal: async () => { confirmations++; } }, port);
    await ui.flush(); ui.click('Generate plan');
    ui.setContinuation(replace ? continuationPorts.createIsolatedPlanningContinuation(async scope => ({ ...scope, ready: true, validUntil: Date.now() + 10000 })) : undefined);
    resolve({ sessionId: ready.id, revision: 1, proposalVersion: 1, ready: true, validUntil: Date.now() + 10000 });
    await ui.flush(); assert.equal(confirmations, 0);
  }
});


test('port removal or replacement after confirmation HTTP starts releases only its own busy state', async () => {
  for (const replace of [false, true]) {
    let confirmations = 0, resolve!: (value: any) => void;
    const ready = readyForContinuation();
    const port = continuationPorts.createIsolatedPlanningContinuation(async scope => ({ ...scope, ready: true, validUntil: Date.now() + 10000 }));
    const ui = host(memory(), async () => {}, undefined, ready, undefined, undefined,
      { confirmPlanningProposal: async () => { confirmations++; return new Promise(done => { resolve = done; }); } }, port);
    await ui.flush(); ui.type('Keep an unsent draft'); ui.click('Generate plan'); await ui.flush();
    assert.equal(confirmations, 1); assert.equal(ui.disabled(), true);
    ui.setContinuation(replace ? continuationPorts.createIsolatedPlanningContinuation(async scope => ({ ...scope, ready: true, validUntil: Date.now() + 10000 })) : undefined);
    resolve({ accepted: true, workspace: { planningSession: { ...ready, status: 'generating' } } });
    await ui.flush(); assert.equal(ui.disabled(), false); assert.equal(ui.input(), 'Keep an unsent draft');
    assert.equal(confirmations, 1); assert.equal(ui.text().includes('Generating your complete plan'), false);
  }
});
test('a late confirmation cannot release busy owned by a newer session save', async () => {
  let resolveConfirm!: (value: any) => void, resolveSave!: (value: any) => void;
  const ready = readyForContinuation();
  const port = continuationPorts.createIsolatedPlanningContinuation(async scope => ({ ...scope, ready: true, validUntil: Date.now() + 10000 }));
  const ui = host(memory(), async () => new Promise(done => { resolveSave = done; }), undefined, ready, undefined, undefined,
    { confirmPlanningProposal: async () => new Promise(done => { resolveConfirm = done; }) }, port);
  await ui.flush(); ui.click('Generate plan'); await ui.flush(); assert.equal(ui.disabled(), true);
  ui.setSession({ ...session(), id: 'new-session' }); await ui.flush(); ui.type('Newer session draft'); await ui.submit();
  assert.equal(ui.disabled(), true);
  resolveConfirm({ accepted: true, workspace: { planningSession: { ...ready, status: 'generating' } } });
  await ui.flush(); assert.equal(ui.disabled(), true);
  resolveSave({ requirementsSaved: true, saveReceipt: { sessionId: 'new-session', messageId: 'unused', expectedRevision: 1, savedRevision: 2 } });
  await ui.flush();
});


test('expired admission is checked again without confirming or submitting a task', async () => {
  let checks = 0, confirmations = 0;
  const port = continuationPorts.createIsolatedPlanningContinuation(async scope => {
    checks++;
    return { ...scope, ready: true, validUntil: Date.now() + 10000 };
  });
  const ui = host(memory(), async () => { throw Error('must not submit'); }, undefined, readyForContinuation(),
    undefined, undefined, { confirmPlanningProposal: async () => { confirmations++; } }, port);
  await ui.flush();
  const initialChecks = checks;
  assert.equal(ui.generationDisabled(), false);
  ui.expireAdmission();
  assert.equal(ui.generationDisabled(), true);
  await ui.flush();
  assert.equal(checks, initialChecks + 1);
  assert.equal(ui.generationDisabled(), false);
  assert.equal(confirmations, 0);
  ui.unmount();
});


test('reopened recoverable generation shows Continue and keeps the existing confirmation protocol', async () => {
  const ready = { ...readyForContinuation(), confirmedProposalVersion: 1 };
  let reads = 0, confirmations = 0;
  const port = continuationPorts.createIsolatedPlanningContinuation(async scope => ({ ...scope, ready: true, validUntil: Date.now() + 10000 }));
  const ui = host(memory(), async () => { throw Error('must not resubmit requirements'); }, undefined, ready,
    undefined, undefined, {
      getPlanningGeneration: async () => { reads++; return { sessionStatus: 'proposal_ready',
        generation: { generationKey: 'saved-generation', status: 'failed', stage: 'research' },
        snapshot: { generationKey: 'saved-generation', status: 'failed', proposalRef: { sessionId: ready.id, proposalVersion: 1 }, failure: { resumable: true } } }; },
      confirmPlanningProposal: async (id: string, version: number, revision: number) => {
        confirmations++; assert.equal(id, ready.id); assert.equal(version, 1); assert.equal(revision, 1);
        return { generated: false, planningSession: ready, workspace: { planningSession: ready } };
      }
    }, port);
  await ui.flush();
  assert.equal(reads, 1); assert.equal(confirmations, 0);
  assert.match(ui.text(), /Continue plan generation/);
  ui.click('Continue plan generation'); await ui.flush();
  assert.equal(confirmations, 1);
  ui.unmount();
});

test('reopened failure from another proposal or without resumable proof keeps the ordinary generation action', async () => {
  for (const change of ['proposal', 'not-resumable', 'key'] as const) {
    const ready = { ...readyForContinuation(), confirmedProposalVersion: 1 };
    const ui = host(memory(), async () => {}, undefined, ready, undefined, undefined, {
      getPlanningGeneration: async () => ({ sessionStatus: 'proposal_ready',
        generation: { generationKey: 'saved-generation', status: 'failed', stage: 'research' },
        snapshot: { generationKey: change === 'key' ? 'other-generation' : 'saved-generation', status: 'failed',
          proposalRef: { sessionId: ready.id, proposalVersion: change === 'proposal' ? 2 : 1 }, failure: { resumable: change !== 'not-resumable' } } })
    });
    await ui.flush();
    assert.doesNotMatch(ui.text(), /Continue plan generation/);
    ui.unmount();
  }
});
