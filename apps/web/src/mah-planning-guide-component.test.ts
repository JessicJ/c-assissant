import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { planningSessionCheckMessage } from './mah-planning-readiness.js';

const compiled = ts.transpileModule(readFileSync(new URL('MahPlanningGuide.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
}).outputText;
function host() {
  const slots: any[] = [], events = new Map<string, () => void>(), timers = new Map<number, () => void>();
  const requests: { baseline: any; resolve: (value: any) => void }[] = [];
  let cursor = 0, dirty = true, tree: any, effects: (() => void)[] = [], timerId = 0, rechecks = 0;
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect: () => any, dependencies: any[]) { const i = cursor++, old = slots[i]; if (!old || dependencies.some((v, j) => !Object.is(v, old.dependencies[j]))) { const next = { dependencies, cleanup: undefined as any }; slots[i] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } }
  };
  const listener = { addEventListener: (name: string, fn: () => void) => { events.set(name, fn); }, removeEventListener: (name: string) => { events.delete(name); } };
  const timer = (fn: () => void) => { timers.set(++timerId, fn); return timerId; };
  const jsx = (type: any, props: any) => ({ type, props }), exports: any = {};
  const document = { ...listener, visibilityState: 'visible' };
  vm.runInContext(compiled, vm.createContext({ exports, document, window: { ...listener, setInterval: timer, clearInterval: (id: number) => timers.delete(id), setTimeout: timer, clearTimeout: (id: number) => timers.delete(id) },
    require(name: string) { if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name.includes('mah-planning-readiness')) return { MAH_SETUP_URL: 'https://mah.bot/docs', planningSessionCheckMessage, checkMahPlanningReadiness: (baseline: any) => new Promise(resolve => { requests.push({ baseline, resolve }); }) };
      return {}; }
  }));
  const props: any = { baseline: { sessionId: 'A', revision: 1, proposalVersion: 1 }, onRecheck: () => { rechecks++; } };
  function render() { for (let i = 0; dirty && i < 30; i++) { dirty = false; cursor = 0; effects = []; tree = exports.MahPlanningGuide(props); effects.forEach(fn => fn()); } assert.equal(dirty, false); }
  async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); render(); }
  function find(node: any): any { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.map(find).find(Boolean); if (node.type === 'button') return node; return find(node.props?.children); }
  render();
  return { requests, timers, events, flush,
    admission(value: any) { props.generationAdmission = value; dirty = true; render(); },
    resumable(value: boolean) { props.generationResumable = value; dirty = true; render(); },
    generating(value: boolean) { props.generationInProgress = value; dirty = true; render(); },
    text: () => JSON.stringify(tree), rechecks: () => rechecks,
    check() { find(tree).props.onClick(); render(); }, event(name: string) { events.get(name)?.(); render(); },
    visible(value: boolean) { document.visibilityState = value ? 'visible' : 'hidden'; },
    scope(id: string) { props.baseline = { ...props.baseline, sessionId: id }; dirty = true; render(); },
    timer(id: number) { timers.get(id)?.(); render(); },
    unmount() { for (const value of slots) value?.cleanup?.(); },
    verified(index: number, submissionConfigured = false) { requests[index]!.resolve({ submissionConfigured, configuration: 'verified', executable: false, session: { comparison: 'matched', status: 'collecting' }, validUntil: Date.now() + 60000 }); }
  };
}

test('内联guide真实effect的挂载聚焦返回轮询与过期只触发只读核对', async () => {
  const ui = host(); assert.equal(ui.requests.length, 1);
  ui.verified(0); await ui.flush(); assert.ok(ui.text().includes('Configuration verified.'));
  ui.event('focus'); assert.equal(ui.requests.length, 2); assert.equal(ui.text().includes('Configuration verified.'), false);
  ui.verified(1); await ui.flush();
  ui.event('visibilitychange'); assert.equal(ui.requests.length, 3);
  ui.visible(false); ui.event('focus'); ui.event('visibilitychange'); assert.equal(ui.requests.length, 3);
  ui.visible(true); ui.verified(2); await ui.flush();
  const expiry = [...ui.timers.keys()].at(-1)!; ui.timer(expiry);
  assert.equal(ui.requests.length, 4); assert.equal(ui.text().includes('Configuration verified.'), false);
  const interval = [...ui.timers.keys()][0]!; ui.timer(interval); assert.equal(ui.requests.length, 5);
  assert.equal(ui.rechecks(), 5);
  assert.ok(ui.requests.every(request => request.baseline.sessionId === 'A'));
  assert.ok(ui.text().includes('Public execution is unverified'));
});

test('内联guide连续检查乱序旧scope与卸载晚到均不能发布陈旧核实', async () => {
  const ui = host(); ui.check(); ui.check(); assert.equal(ui.requests.length, 3);
  ui.verified(2); await ui.flush(); assert.ok(ui.text().includes('Configuration verified.'));
  ui.requests[0]!.resolve({ configuration: 'needs_setup', session: { comparison: 'missing' }, executable: false, validUntil: Date.now() + 60000 });
  await ui.flush(); assert.equal(ui.text().includes('Complete your MAH setup'), false);
  ui.scope('B'); assert.equal(ui.text().includes('Configuration verified.'), false);
  ui.verified(1); await ui.flush(); assert.equal(ui.text().includes('Configuration verified.'), false);
  ui.verified(3); await ui.flush(); assert.ok(ui.text().includes('Configuration verified.'));
  ui.check(); ui.unmount(); assert.equal(ui.events.size, 0); assert.equal(ui.timers.size, 0);
  ui.verified(4); await ui.flush(); assert.equal(ui.text().includes('Configuration verified.'), false);
});

test('configured workspace describes preflight submission without claiming task receipt or full plan readiness', async () => {
  const ui = host();
  ui.verified(0, true); await ui.flush();
  assert.match(ui.text(), /You can send travel requirements/);
  assert.match(ui.text(), /Landi checks MAH before submitting each request/);
  assert.match(ui.text(), /Plan generation is awaiting verification for this saved trip/);
  assert.doesNotMatch(ui.text(), /MAH received/);
  ui.unmount();
});


test('generation guidance uses only the current fresh saved-trip admission and distinguishes running work', async () => {
  const ui = host();
  ui.verified(0, true); await ui.flush();
  const valid = { sessionId: 'A', revision: 1, proposalVersion: 1, validUntil: Date.now() + 10000 };
  ui.admission(valid);
  assert.match(ui.text(), /This saved trip is ready to submit/);
  assert.doesNotMatch(ui.text(), /generation remains unavailable|awaiting verification/);
  ui.admission({ ...valid, sessionId: 'B' });
  assert.doesNotMatch(ui.text(), /This saved trip is ready/);
  ui.admission({ ...valid, revision: 2 });
  assert.doesNotMatch(ui.text(), /This saved trip is ready/);
  ui.admission({ ...valid, validUntil: Date.now() - 1 });
  assert.doesNotMatch(ui.text(), /This saved trip is ready/);
  ui.admission(valid); ui.scope('B');
  assert.doesNotMatch(ui.text(), /This saved trip is ready/);
  ui.generating(true);
  assert.match(ui.text(), /Your plan is being prepared/);
  assert.doesNotMatch(ui.text(), /ready to submit|generation remains unavailable/);
  ui.unmount();
});


test('recoverable failed generation describes saved progress instead of a new submission', async () => {
  const ui = host(); ui.verified(0, true); await ui.flush();
  ui.admission({ sessionId: 'A', revision: 1, proposalVersion: 1, validUntil: Date.now() + 10000 });
  ui.resumable(true);
  assert.match(ui.text(), /Your previous plan generation stopped/);
  assert.match(ui.text(), /Continue plan generation/);
  assert.doesNotMatch(ui.text(), /ready to submit/);
  ui.generating(true);
  assert.match(ui.text(), /Your plan is being prepared/);
  assert.doesNotMatch(ui.text(), /previous plan generation stopped/);
  ui.unmount();
});
