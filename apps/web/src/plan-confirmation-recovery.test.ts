import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as apiClient from "./api-client.js";
import * as recovery from "./plan-confirmation-recovery.js";
import type { WorkspaceSnapshot } from "@c-assistant/core";

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
      if (name.includes("plan-confirmation-recovery")) return recovery;
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

const draft = () => ({ ...workspace(), activePlan: { ...workspace().activePlan, status: "draft" } }) as unknown as WorkspaceSnapshot;
const active = () => ({ ...draft(), activePlan: { ...draft().activePlan, status: "active" as const } });
const review = () => recovery.reviewedPlanConfirmation(draft());

test("lost confirmation response reconciles the active reviewed version with one submission", async () => {
  let submissions = 0, reads = 0;
  const result = await recovery.confirmWithReadback(review(), {
    submit: async () => { submissions++; throw new Error("Lost response"); },
    read: async () => { reads++; return active(); }
  });
  assert.equal(result.activePlan.status, "active");
  assert.equal(submissions, 1); assert.equal(reads, 1);
});

test("a failed read remains uncertain and a retry cannot submit while reading is unavailable", async () => {
  let submissions = 0;
  const dependencies = {
    submit: async () => { submissions++; throw new Error("Lost response"); },
    read: async (): Promise<WorkspaceSnapshot> => { throw new Error("Offline"); }
  };
  const uncertain = (error: unknown) => error instanceof recovery.PlanConfirmationReadbackError && error.uncertain;
  await assert.rejects(recovery.confirmWithReadback(review(), dependencies), uncertain);
  await assert.rejects(recovery.confirmWithReadback(review(), dependencies, true), uncertain);
  assert.equal(submissions, 1);
});

test("a draft read after lost response does not automatically resubmit or claim rejection", async () => {
  let submissions = 0;
  await assert.rejects(recovery.confirmWithReadback(review(), {
    submit: async () => { submissions++; throw new Error("Lost response"); }, read: async () => draft()
  }), (error: unknown) => error instanceof recovery.PlanConfirmationReadbackError && error.uncertain && error.workspace?.activePlan.status === "draft");
  assert.equal(submissions, 1);
});

test("未核对草稿隐藏原始异常并保留安全的修正原因", async () => {
  await assert.rejects(recovery.confirmWithReadback(review(), {
    submit: async () => { throw new apiClient.ApiRequestError("raw diagnostic sentinel", 409, {code:"activation_review_required"}); }, read: async () => draft()
  }), (error: unknown) => error instanceof recovery.PlanConfirmationReadbackError && !error.uncertain
    && /before approving it/.test(error.message) && !error.message.includes("raw diagnostic"));
});

test("explicit retry first reads: active needs no submission; unchanged draft allows one", async () => {
  const order: string[] = [];
  await recovery.confirmWithReadback(review(), {
    read: async () => { order.push("read-active"); return active(); },
    submit: async () => { throw new Error("Must not submit"); }
  }, true);
  await recovery.confirmWithReadback(review(), {
    read: async () => { order.push("read-draft"); return draft(); },
    submit: async () => { order.push("submit"); return active(); }
  }, true);
  assert.deepEqual(order, ["read-active", "read-draft", "submit"]);
});

test("changed plan, Blueprint or executing base requires review and cannot be accepted as the receipt", async () => {
  const scoped = { ...review(), blueprint: { id: "bp", version: 2 }, base: { id: "old", version: 3 } };
  const scopedDraft = { ...draft(), activeBlueprint: { id: "bp", version: 2 }, executionPlan: { id: "old", version: 3 } } as unknown as WorkspaceSnapshot;
  for (const current of [
    { ...active(), activePlan: { ...active().activePlan, version: 2 } },
    { ...active(), activeBlueprint: { id: "different-bp", version: 2 } },
    { ...scopedDraft, executionPlan: { id: "old", version: 4 } }
  ] as WorkspaceSnapshot[]) {
    let submissions = 0;
    await assert.rejects(recovery.confirmWithReadback(scoped, {
      submit: async () => { submissions++; return active(); }, read: async () => current
    }, true), (error: unknown) => error instanceof recovery.PlanConfirmationReadbackError && !error.uncertain && error.workspace === current);
    assert.equal(submissions, 0);
  }
});

test("an invalid success body is reconciled without repeating the mutation", async () => {
  for (const invalid of [null, {}, { activePlan: { id: "different" } }]) {
    let submissions = 0;
    const result = await recovery.confirmWithReadback(review(), {
      submit: async () => { submissions++; return invalid as WorkspaceSnapshot; }, read: async () => active()
    });
    assert.equal(result.activePlan.status, "active"); assert.equal(submissions, 1);
  }
});

test("actual App synchronizes a lost confirmation response and suppresses concurrent clicks", async () => {
  let confirmations = 0, reads = 0, release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const ui = appHost({ ...baseApi(), getWorkspace: async () => ++reads === 1 ? draft() : active(),
    confirmPlan: async () => { confirmations++; await waiting; throw new Error("Lost response"); } });
  await ui.flush();
  const first = ui.plans().onConfirm("fictional-plan");
  await ui.plans().onConfirm("fictional-plan");
  release(); await first; await ui.flush();
  assert.equal(confirmations, 1); assert.equal(reads, 2);
  assert.equal(ui.plans().currentPlan.status, "active"); assert.equal(ui.error(), undefined);
});

test("actual App retains uncertain review scope and checks it before a manual retry", async () => {
  let confirmations = 0, reads = 0;
  const ui = appHost({ ...baseApi(), getWorkspace: async () => { reads++; return reads < 3 ? draft() : active(); },
    confirmPlan: async () => { confirmations++; throw new Error("Lost response"); } });
  await ui.flush();
  await ui.plans().onConfirm("fictional-plan"); await ui.flush();
  assert.match(ui.error(), /still unknown/);
  assert.equal(ui.plans().currentPlan.status, "draft");
  await ui.plans().onConfirm("fictional-plan"); await ui.flush();
  assert.equal(confirmations, 1); assert.equal(reads, 3);
  assert.equal(ui.plans().currentPlan.status, "active");
});

test('确定拒绝先对账：active优先；坏响应、500与未知code仍未决',async()=>{
 const known=new apiClient.ApiRequestError('不公开',409,{code:'version_conflict'});
 assert.equal((await recovery.confirmWithReadback(review(),{submit:async()=>{throw known;},read:async()=>active()})).activePlan.status,'active');
 for(const caught of [new apiClient.ApiRequestError('不公开',500,{code:'version_conflict'}),new apiClient.ApiRequestError('不公开',409,{code:'internal_error'}),new apiClient.ApiRequestError('不公开',409,{code:'unknown'}),new Error('malformed response')]){
  let submits=0;
  await assert.rejects(recovery.confirmWithReadback(review(),{submit:async()=>{submits++;throw caught;},read:async()=>draft()}),error=>error instanceof recovery.PlanConfirmationReadbackError&&error.uncertain);
  assert.equal(submits,1);
 }
});

test('actual App 确定409后相同Plan重读来源与新binding，下一显式点击才确认',async()=>{
 const scopedDraft=()=>({...draft(),executionPlan:{id:'old',version:1,status:'active'}}) as unknown as WorkspaceSnapshot;
 let workspaceReads=0,reviewReads=0,confirmations=0;
 const bindings:unknown[]=[];
 const ui=appHost({...baseApi(),getWorkspace:async()=>{workspaceReads++;return scopedDraft();},getPlanConfirmationReview:async()=>({workspace:scopedDraft(),exactConfirmation:{proposalDigest:`digest-${++reviewReads}`,context:{phase:{value:'pre_departure'}}},observations:[],arrangements:{original:null,replacement:null}}),confirmPlan:async(...args:unknown[])=>{
  confirmations++;bindings.push(args[4]);
  if(confirmations===1)throw new apiClient.ApiRequestError('安全拒绝',409,{code:'version_conflict'});
  return active();
 }});
 await ui.flush();await ui.flush();
 await ui.plans().onConfirm('fictional-plan');await ui.flush();await ui.flush();
 assert.equal(confirmations,1);assert.equal(workspaceReads,2);assert.equal(reviewReads,2);
 assert.equal(ui.plans().currentPlan.status,'draft');assert.doesNotMatch(ui.error(),/still unknown/);
 await ui.plans().onConfirm('fictional-plan');await ui.flush();
 assert.equal(confirmations,2);assert.deepEqual(bindings.map(value=>(value as {proposalDigest:string}).proposalDigest),['digest-1','digest-2']);
 assert.equal(ui.plans().currentPlan.status,'active');
});
