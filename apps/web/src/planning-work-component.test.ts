import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as identities from "./planning-message-identity.js";
import { PlanningRequirementsSaved } from './api-client.js';
import * as workDisplay from './planning-work-display.js';

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
function host(storage: ReturnType<typeof memory>, send: (body: any) => Promise<any>, publish: (workspace: any) => Promise<void> = async () => {}, savedSession?: ReturnType<typeof session>, readStatus: (sessionId: string, messageId: string) => Promise<unknown> = async () => null) {
  const slots: any[] = [];
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
  class Rejected extends Error {}
  const api = { PlanningMessageRejected: Rejected, PlanningRequirementsSaved,
    getPlanningMessageSaveStatus: async () => null, getPlanningWorkStatus: readStatus, sendAgentChat: send, getPlanningRevision: async () => 1 };
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  const exports: any = {};
  const context = vm.createContext({ exports, localStorage: storage, crypto: { randomUUID: (() => { let i = 0; return () => `display-${++i}`; })() },
    window: { setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} },
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.includes("planning-message-identity")) return identities;
      if (name.includes('planning-work-display')) return workDisplay;
      if (name.includes("api-client")) return api;
      if (name.includes("assistant-personality")) return { resolveAssistantPersonality: () => ({ id: "local_insider" }), assistantPlanningWelcome: () => "Welcome" };
      if (name.includes("planning-budget")) return { hasStatedBudgetAmount: () => false };
      if (name.includes("conversation-state")) return { conversationStorageKey: () => "conversation", conversationFromPlanningSession: (value: any) => value?.messages ?? [], loadConversation: () => [] };
      return new Proxy({}, { get: () => () => "" });
    }
  });
  vm.runInContext(compiled, context);
  const props: any = { mode: "new_plan", currentPlan: null, planningSession: savedSession, initialMessage: "", profile: {}, onPlanCreated: publish, onError() {}, onStatus() {}, onComplete() {} };
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
  return { flush, setSession(value: ReturnType<typeof session>) { props.planningSession = value; dirty = true; render(); },
    text: () => JSON.stringify(tree),
    input: () => find((element) => element.type === "textarea", tree)!.props.value,
    type(value: string) { find((element) => element.type === "textarea", tree)!.props.onChange({ target: { value } }); render(); },
    async retry() { find((element) => element.type === 'button' && element.props.children === 'Retry original save', tree)!.props.onClick(); await flush(); },
    async submit() { find((element) => element.props?.className === "send-button", tree)!.props.onClick(); await flush(); }
  };
}

function localStatus(sessionId: string, messageId: string, status = 'submission_unknown') {
  return { schemaVersion: 1, sessionId, messageId, observedAt: new Date().toISOString(), executable: false,
    requirementsSaved: true, saveReceipt: { sessionId, messageId, expectedRevision: 0, savedRevision: 1 }, planningRevision: 1,
    localWork: { workId: 'work', requestId: 'request', taskId: 'same-task', status, savedRevision: 1, resultApplied: false },
    mahStatus: { status: 'unverified', reason: 'not_queried' } };
}
test('actual status integration: refresh reads existing message without submitting and preserves unsent text', async () => {
  const storage = memory(), calls: string[][] = []; let posts = 0;
  storage.setItem('conversation:input:session', 'Keep this unsent preference');
  const persisted = { ...session(), messages: [{ id: 'saved-message', role: 'user', text: 'Saved fictional requirement' }] } as any;
  const ui = host(storage, async () => { posts++; throw Error('No POST on refresh'); }, undefined, persisted,
    async (sessionId, messageId) => { calls.push([sessionId, messageId]); return localStatus(sessionId, messageId); });
  await ui.flush();
  assert.equal(posts, 0); assert.deepEqual(calls, [['session', 'saved-message']]);
  assert.equal(ui.input(), 'Keep this unsent preference'); assert.ok(ui.text().includes('Your requirements have not been saved to the server.'));
  assert.ok(ui.text().includes('Previously submitted requirements: '));
  assert.ok(ui.text().includes(workDisplay.savedProcessingUnverified));
});
test('actual status integration: acknowledged save with downstream failure clears input once and only queries same message', async () => {
  const storage = memory(), calls: any[] = [], reads: string[][] = [];
  const ui = host(storage, async body => { calls.push(body); throw new PlanningRequirementsSaved({ sessionId: 'session', messageId: body.messageId, expectedRevision: body.expectedRevision, savedRevision: body.expectedRevision + 1 }); }, undefined, session(),
    async (sessionId, messageId) => { reads.push([sessionId, messageId]); return localStatus(sessionId, messageId); });
  await ui.flush(); ui.type('Fictional trip'); await ui.submit();
  assert.equal(ui.input(), ''); assert.equal(storage.getItem('conversation:pending-message'), null);
  assert.equal(calls.length, 1); assert.equal(reads.length, 1); assert.deepEqual(reads[0], ['session', calls[0].messageId]);
  assert.ok(ui.text().includes(workDisplay.savedProcessingUnverified));
  await ui.submit(); assert.equal(calls.length, 1);
});
test('actual status integration: unavailable status is unverified and never triggers a retry', async () => {
  let posts = 0;
  const persisted = { ...session(), messages: [{ id: 'saved-message', role: 'user', text: 'Saved fictional requirement' }] } as any;
  const ui = host(memory(), async () => { posts++; throw Error('No POST'); }, undefined, persisted,
    async () => { throw Error('Fictional status service unavailable'); });
  await ui.flush(); assert.equal(posts, 0); assert.ok(ui.text().includes(workDisplay.unverifiedPlanningWork));
});

test('late historical status does not describe or erase a newer editable draft', async () => {
  const storage = memory(); let resolveStatus!: (value: unknown) => void;
  const persisted = { ...session(), messages: [{ id: 'saved-message', role: 'user', text: 'Earlier requirements' }] } as any;
  const ui = host(storage, async () => { throw Error('No POST'); }, undefined, persisted,
    () => new Promise(resolve => { resolveStatus = resolve; }));
  ui.type('New unsent preference');
  resolveStatus(localStatus('session', 'saved-message'));
  await ui.flush();
  assert.equal(ui.input(), 'New unsent preference');
  assert.ok(ui.text().includes('Your requirements have not been saved to the server.'));
  assert.ok(ui.text().includes('Previously submitted requirements: '));
});

test('matching pending draft restores unknown status after reload', async () => {
  const storage = memory();
  storage.setItem('conversation:input:session', 'Uncertain requirement');
  storage.setItem('conversation:pending-message', JSON.stringify({ version: 2, pending: [{ message: 'Uncertain requirement', identity: { sessionId: 'session', messageId: 'pending', expectedRevision: 1 } }] }));
  const ui = host(storage, async () => { throw Error('No POST'); }, undefined, session(), async () => { throw Error('offline'); });
  await ui.flush();
  assert.equal(ui.input(), 'Uncertain requirement');
  assert.ok(ui.text().includes('original save is still unverified'));
  assert.ok(!ui.text().includes('Your requirements have not been saved to the server.'));
});

test('a late successful save cannot clear text edited while its response is pending', async () => {
  const storage = memory(); let resolveSend!: (value: any) => void;
  const ui = host(storage, () => new Promise(resolve => { resolveSend = resolve; }), undefined, session());
  await ui.flush(); ui.type('Earlier requirement');
  const sending = ui.submit(); ui.type('Newer requirement');
  resolveSend({ workspace: { planningSession: session(), activePlan: { id: 'plan' } }, planningSession: session(), planningRevision: 1, generated: false });
  await sending;
  assert.equal(ui.input(), 'Newer requirement');
  assert.equal(storage.getItem('conversation:input:session'), 'Newer requirement');
  assert.ok(ui.text().includes('Your requirements have not been saved to the server.'));
});

test('late status for an old session cannot replace the current session notice', async () => {
  const storage = memory(), pending: Record<string, (value: unknown) => void> = {};
  const first = { ...session(), messages: [{ id: 'first-message', role: 'user', text: 'First session' }] } as any;
  const second = { ...session(), id: 'second', messages: [{ id: 'second-message', role: 'user', text: 'Second session' }] } as any;
  const ui = host(storage, async () => { throw Error('No POST'); }, undefined, first,
    (id) => new Promise(resolve => { pending[id] = resolve; }));
  ui.setSession(second); await ui.flush();
  assert.ok(pending.second); pending.second(localStatus('second', 'second-message', 'failed')); await ui.flush();
  assert.ok(pending.session); pending.session(localStatus('session', 'first-message')); await ui.flush();
  assert.ok(ui.text().includes('Requirements saved. Processing did not finish.'));
  assert.ok(!ui.text().includes(workDisplay.savedProcessingUnverified));
});

test('late save from another session cannot publish or clear the new session draft', async () => {
  const storage = memory(); let resolveSend!: (value: any) => void; let published = 0;
  const ui = host(storage, () => new Promise(resolve => { resolveSend = resolve; }), async () => { published++; }, session());
  await ui.flush(); ui.type('First requirement'); const sending = ui.submit();
  storage.setItem('conversation:input:second', 'Second draft');
  ui.setSession({ ...session(), id: 'second' }); await ui.flush();
  resolveSend({ workspace: { planningSession: session(), activePlan: { id: 'plan' } }, planningSession: session(), planningRevision: 1, generated: false });
  await sending;
  assert.equal(ui.input(), 'Second draft'); assert.equal(storage.getItem('conversation:input:second'), 'Second draft'); assert.equal(published, 0);
});

test('switching sessions restores matching pending draft as unknown', async () => {
  const storage = memory();
  storage.setItem('conversation:input:second', 'Second unknown');
  storage.setItem('conversation:pending-message', JSON.stringify({ version: 2, pending: [{ message: 'Second unknown', identity: { sessionId: 'second', messageId: 'second-pending', expectedRevision: 0 } }] }));
  const ui = host(storage, async () => { throw Error('No POST'); }, undefined, session());
  ui.setSession({ ...session(), id: 'second' }); await ui.flush();
  assert.equal(ui.input(), 'Second unknown');
  assert.ok(ui.text().includes('original save is still unverified'));
});


test('deferred failed read cannot downgrade checked saved status for the same message', async () => {
  const scope = { sessionId: 'session', messageId: 'message' };
  let notice: workDisplay.SubmittedPlanningNotice | null = { ...scope, text: workDisplay.savedProcessingUnverified, verified: true };
  let reject!: (error: Error) => void;
  const read = new Promise<never>((_resolve, rejectRead) => { reject = rejectRead; }).catch(() => {
    notice = workDisplay.mergeSubmittedPlanningNotice(notice, { ...scope, text: workDisplay.unverifiedPlanningWork, verified: false });
  });
  reject(Error('offline')); await read;
  assert.equal(notice?.text, workDisplay.savedProcessingUnverified);
  assert.equal(notice?.verified, true);
});

for (const outcome of ['success', 'saved-error'] as const) test(`stale ${outcome} retains original identity for return and retry`, async () => {
  const storage = memory(), calls: any[] = []; let finish!: (value: any) => void, fail!: (error: Error) => void, saves = 0, published = 0;
  const ui = host(storage, body => {
    calls.push(body);
    if (calls.length === 1) { saves++; return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); }
    return Promise.resolve({ workspace: { planningSession: session(), activePlan: { id: 'plan' } }, planningSession: session(), planningRevision: 1, generated: false });
  }, async () => { published++; }, session());
  await ui.flush(); ui.type('Original requirement'); const sending = ui.submit();
  storage.setItem('conversation:input:second', 'Second draft'); ui.setSession({ ...session(), id: 'second' }); await ui.flush();
  if (outcome === 'success') finish({ workspace: { planningSession: session(), activePlan: { id: 'plan' } }, planningSession: session(), planningRevision: 1, generated: false });
  else fail(new PlanningRequirementsSaved({ sessionId: 'session', messageId: calls[0].messageId, expectedRevision: calls[0].expectedRevision, savedRevision: calls[0].expectedRevision + 1 }));
  await sending;
  assert.equal(published, 0); assert.equal(ui.input(), 'Second draft'); assert.equal(storage.getItem('conversation:input:second'), 'Second draft');
  assert.ok(storage.getItem('conversation:pending-message')?.includes(calls[0].messageId));
  ui.setSession(session()); await ui.flush(); assert.equal(ui.input(), 'Original requirement');
  await ui.submit();
  assert.equal(calls.length, 1);
  await ui.retry();
  assert.equal(calls.length, 2); assert.equal(calls[1].messageId, calls[0].messageId); assert.equal(calls[1].expectedRevision, calls[0].expectedRevision);
  assert.equal(saves, 1); assert.equal(storage.getItem('conversation:input:second'), 'Second draft');
});
