import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { listPlanHistory } from "./api-client.js";
import * as apiClient from "./api-client.js";

const originalNetworkFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = async () => { throw new Error("测试禁止未模拟的网络访问"); }; });
test.afterEach(() => { globalThis.fetch = originalNetworkFetch; });

type Element = { type: any; props: Record<string, any> };
function compile(name: string) {
  return ts.transpileModule(readFileSync(new URL(name, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}
function find(node: any, predicate: (element: Element) => boolean): Element | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
// The actual App handlers run against fictional responses in a deterministic hook
// host. No browser storage, backend, database, email or MAH process is accessed.
function appHost(api: Record<string, any>) {
  const slots: any[] = [];
  let cursor = 0, dirty = true, tree: Element, effects: Array<() => unknown> = [];
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (update: any) => {
        const next = typeof update === "function" ? update(slots[index]) : update;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect: () => unknown, dependencies: unknown[]) {
      const index = cursor++, old = slots[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old[i]))) { slots[index] = dependencies; effects.push(effect); }
    }
  };
  const exports: any = {};
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  vm.runInNewContext(compile("App.tsx"), {
    exports, URLSearchParams, Error,
    window: { location: { search: "" }, setTimeout: () => 0, clearTimeout() {} },
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.includes("api-client")) return { ...apiClient, ...api };
      if (name.includes("PlansWorkspace")) return { PlansWorkspace: "PlansWorkspace" };
      if (name.includes("FirstRunTour")) return { shouldShowFirstRunTour: () => false };
      if (name.includes("plan-display")) return { isStarterPlan: () => false };
      return {};
    }
  });
  function render() {
    for (let i = 0; dirty && i < 30; i++) {
      dirty = false; cursor = 0; effects = []; tree = exports.default();
      for (const effect of effects) effect();
    }
    assert.equal(dirty, false);
  }
  render();
  return {
    async flush() { await new Promise<void>((resolve) => setImmediate(resolve)); render(); },
    plans: () => find(tree, (element) => element.type === "PlansWorkspace")!.props,
    error: () => find(tree, (element) => element.props?.className === "inline-alert")?.props.children[0]
  };
}
const workspace = () => ({ profile: { status: "ready" }, activePlan: { id: "fictional-plan", version: 1 }, destinationArrivals: [] });
const baseApi = () => ({ getWorkspace: async () => workspace(), getSettingsSnapshot: async () => ({}), listPlanHistory: async () => [] });

test("history query distinguishes HTTP, network and malformed responses from a genuine empty history", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_path, init) => { assert.equal(init?.cache, "no-store"); return new Response("[]"); };
  assert.deepEqual(await listPlanHistory(), []);
  globalThis.fetch = async () => new Response('{"error":"History temporarily unavailable"}', { status: 503 });
  await assert.rejects(listPlanHistory(), /The operation could not be completed/);
  globalThis.fetch = async () => { throw new Error("offline"); };
  await assert.rejects(listPlanHistory(), /Landi could not be reached/);
  for (const body of ["{}", "null", "", "invalid JSON"]) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(listPlanHistory());
  }
});

test("initial history failure surfaces an error while keeping the current workspace available", async () => {
  const ui = appHost({ ...baseApi(), listPlanHistory: async () => { throw new Error("History unavailable"); } });
  await ui.flush();
  assert.equal(ui.plans().currentPlan.id, "fictional-plan");
  assert.equal(ui.error(), apiClient.safePlanError(undefined));
  assert.equal(ui.error().includes("History unavailable"), false);
});

test("failed history refresh retains archived plans and does not reject an acknowledged workspace save", async () => {
  const archived = { id: "fictional-archive" };
  let fail = false, history = [archived];
  const ui = appHost({ ...baseApi(), listPlanHistory: async () => { if (fail) throw new Error("History refresh unavailable"); return history; } });
  await ui.flush(); fail = true;
  const next = { ...workspace(), activePlan: { id: "fictional-plan", version: 2 } };
  await assert.doesNotReject(ui.plans().onPlanCreated(next));
  await ui.flush();
  assert.equal(ui.plans().currentPlan.version, 2);
  assert.equal(ui.plans().history[0], archived);
  assert.equal(ui.error(), apiClient.safePlanError(undefined));
  assert.equal(ui.error().includes("History refresh unavailable"), false);
  fail = false; history = [];
  await ui.plans().onPlanCreated(next); await ui.flush();
  assert.equal(ui.plans().history.length, 0);
});

test("preparation save failure reaches the caller, preserves the workspace and permits a later successful save", async () => {
  const failure = new Error("Checklist save unavailable");
  let fail = true, calls = 0;
  const saved = { ...workspace(), activePlan: { id: "fictional-plan", version: 2 } };
  const ui = appHost({ ...baseApi(), setPlanTaskChecked: async () => { calls++; if (fail) throw failure; return saved; } });
  await ui.flush();
  await assert.rejects(ui.plans().onTaskToggle("fictional-plan", "packing", true), (error) => error === failure);
  await ui.flush();
  assert.equal(ui.error(), apiClient.safePlanError(failure));
  assert.notEqual(ui.error(), failure.message);
  assert.equal(ui.plans().currentPlan.version, 1);
  fail = false;
  await ui.plans().onTaskToggle("fictional-plan", "packing", true); await ui.flush();
  assert.equal(ui.plans().currentPlan.version, 2);
  assert.equal(calls, 2);
});

test("legacy preparation checkbox consumes the propagated rejection after the App reports it", async () => {
  const exports: any = {};
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  vm.runInNewContext(compile("PlanTaskSections.tsx"), { exports, require(name: string) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("plan-external-display")) return { appDownloads: () => [] };
    if (name.includes("plan-preparation-display")) return { groupPreparationItems: (items: unknown) => [{ title: "Packing", items }], isExplicitPreparationTask: () => true };
    return {};
  } });
  const task = { id: "packing", title: "Fictional bag", status: "waiting_user" };
  let calls = 0;
  const reject = async () => {
    calls++;
    throw new Error("Already reported by App");
  };
  const checklist = exports.FeaturedChecklist({ plan: { id: "fictional", sources: [] }, index: 0, items: [{ task }], onTaskToggle: reject });
  find(checklist, (element) => element.type === "input")!.props.onChange({ target: { checked: true } });
  const section = exports.PlanContentSection({ plan: { id: "fictional" }, stage: { presentationKind: "reservations", tasks: [task] }, index: 0, onTaskToggle: reject });
  const reservation = find(section, (element) => typeof element.type === "function")!;
  const table = reservation.type(reservation.props);
  find(table, (element) => element.type === "input")!.props.onChange({ target: { checked: true } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});
