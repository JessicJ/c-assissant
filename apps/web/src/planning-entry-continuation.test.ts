import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

type Element = { type: any; props: any };
const serverPort = Object.freeze({ read: async () => { throw Error('render must not read admission'); } });
const composer = () => null;
function component(filename: string) {
  const source = ts.transpileModule(readFileSync(new URL(filename, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports: any = {};
  const jsx = (type: any, props: any) => ({ type, props });
  vm.runInContext(source, vm.createContext({ exports, require(name: string) {
    if (name === 'react') return { useState: (initial: any) => [initial, () => {}], useEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('planning-continuation')) return { serverPlanningContinuation: serverPort };
    if (name.includes('PlanComposer')) return { PlanComposer: composer };
    return new Proxy({}, { get: () => () => null });
  } }));
  return exports;
}
function find(node: any, predicate: (node: Element) => boolean): Element | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}

test('new and restored planning entries use the same server admission port without submitting on render', () => {
  const session = { id: 'saved-session', status: 'proposal_ready' };
  const callbacks = { onPlanCreated: async () => {}, onStatus() {}, onError() {} };
  const inline = component('PlanComposer.tsx').InlineComposerWorkspace({ ...callbacks, mode: 'new_plan',
    currentPlan: null, planningSession: session, initialMessage: '', onClose() {} });
  const inlineComposer = find(inline, node => node.props?.continuation === serverPort);
  assert.ok(inlineComposer);
  const workspace = component('PlansWorkspace.tsx').PlansWorkspace({ ...callbacks,
    currentPlan: null, executionPlan: null, planningSession: session, hidePlanningSession: false,
    destinationArrivals: [], history: [], tab: 'current', confirming: false });
  const panel = find(workspace, node => node.type?.name === 'PlanningSessionPanel');
  assert.ok(panel);
  const restoredComposer = find(panel.type(panel.props), node => node.type === composer);
  assert.ok(restoredComposer);
  assert.equal(restoredComposer.props.continuation, inlineComposer.props.continuation);
  assert.equal(restoredComposer.props.planningSession, session);
});
