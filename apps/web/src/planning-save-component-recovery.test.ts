import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as identities from "./planning-message-identity.js";
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
function host(storage: ReturnType<typeof memory>, send: (body: any) => Promise<any>, publish: (workspace: any) => Promise<void> = async () => {}, savedSession?: ReturnType<typeof session>) {
  const slots: any[] = [];
  let cursor = 0, dirty = true, tree: Element, effects: Array<() => void> = [];
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (update: any) => { const next = typeof update === "function" ? update(slots[index]) : update; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect: () => void, dependencies: unknown[]) {
      const index = cursor++, old = slots[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old[i]))) { slots[index] = dependencies; effects.push(effect); }
    }
  };
  class Rejected extends Error {}
  const api = { PlanningMessageRejected: Rejected, PlanningRequirementsSaved: class extends Error {},
    getPlanningMessageSaveStatus: async () => null, getPlanningWorkStatus: async () => null, sendAgentChat: send, getPlanningRevision: async () => 1 };
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
  return { flush, importSession(value: ReturnType<typeof session>) { find((element) => typeof element.props?.onPlanningSession === 'function', tree)!.props.onPlanningSession(value); render(); }, setSession(value: ReturnType<typeof session>) { props.planningSession = value; dirty = true; render(); },
    input: () => find((element) => element.type === "textarea", tree)!.props.value,
    type(value: string) { find((element) => element.type === "textarea", tree)!.props.onChange({ target: { value } }); render(); },
    async retry() { find((element) => element.type === "button" && element.props.children === "Retry original save", tree)!.props.onClick(); await flush(); },
    async submit() { find((element) => element.props?.className === "send-button", tree)!.props.onClick(); await flush(); }
  };
}
const saved = () => ({ workspace: { planningSession: session(), activePlan: { id: "plan" } }, planningSession: session(), planningRevision: 1, blocked: true, generated: false });

test("actual composer keeps input empty after acknowledged save followed by history failure", async () => {
  const storage = memory(), calls: any[] = [];
  const ui = host(storage, async (body) => { calls.push(body); return saved(); }, async () => { throw new Error("Fictional history failure"); });
  ui.type("Trip details"); await ui.submit();
  assert.equal(ui.input(), "");
  await ui.submit();
  assert.equal(calls.length, 1);
  assert.equal(storage.getItem("conversation:pending-message"), null);
});

test("actual composer restores unresolved text and reuses its identity after another save and reload", async () => {
  const storage = memory(), calls: any[] = [];
  const send = async (body: any) => { calls.push(body); if (calls.length === 1) throw new Error("Fictional response loss"); return saved(); };
  const ui = host(storage, send, undefined, session()); await ui.flush();
  ui.type("A"); await ui.submit();
  assert.equal(ui.input(), "A");
  ui.type("B"); await ui.submit();
  const reloaded = host(storage, send, undefined, session()); await reloaded.flush();
  assert.equal(reloaded.input(), "A");
  await reloaded.submit();
  assert.equal(calls.length, 2);
  await reloaded.retry();
  assert.equal(calls[2].messageId, calls[0].messageId);
  assert.equal(calls[2].expectedRevision, calls[0].expectedRevision);
});

test("actual composer migrates an unsent draft when booking import creates a session", async () => {
  const storage = memory(), ui = host(storage, async () => { throw new Error("No transmission expected"); });
  ui.type("Unsent requirements"); ui.importSession(session()); await ui.flush();
  assert.equal(storage.getItem("conversation:input:session"), "Unsent requirements");
  assert.equal(storage.getItem("conversation:input:new"), null);
  const reloaded = host(storage, async () => { throw new Error("No transmission expected"); }, undefined, session());
  assert.equal(reloaded.input(), "Unsent requirements");
});

test("switching between named sessions preserves each draft without copying it into the other", async () => {
  const storage = memory(), ui = host(storage, async () => { throw new Error("No transmission expected"); }, undefined, session());
  await ui.flush(); ui.type("Session A only");
  ui.setSession({ ...session(), id: "other-session" }); await ui.flush();
  assert.equal(ui.input(), "");
  assert.equal(storage.getItem("conversation:input:session"), "Session A only");
  assert.equal(storage.getItem("conversation:input:other-session"), null);
});
