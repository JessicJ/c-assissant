import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { randomUUID, createHash } from "node:crypto";
import { workspaceMutationDigestInput } from "@c-assistant/core";
import ts from "typescript";
import * as apiClient from "./api-client.js";
import * as impactReview from "./blueprint-impact-review.js";
import * as directRecovery from "./direct-blueprint-recovery.js";
import * as recovery from "./plan-mutation-recovery.js";
import * as confirmation from "./plan-confirmation-recovery.js";
import type { WorkspaceSnapshot } from "@c-assistant/core";

const originalNetworkFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = async () => { throw new Error("测试禁止未模拟的网络访问"); }; });
test.afterEach(() => { globalThis.fetch = originalNetworkFetch; });

type Element = { type: any; props: Record<string, any> };
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "异步操作未在测试时限内完成");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
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
      if (name.includes("plan-mutation-recovery")) return recovery;
      if (name.includes("plan-confirmation-recovery")) return confirmation;
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

const edit = { kind: "remove_place_from_day" as const, placeId: "fictional-place", placeName: "Fictional museum", dayId: "day", dayLabel: "Day 1", advisories: [] };

// A second host exercises the actual itinerary components without mounting maps or
// child panels. Child event props remain callable, so no DOM or network is needed.
function componentHost(file: string, exported: string, props: any, modules: Record<string, any>, storage?: Map<string, string>) {
  const slots: any[] = [];
  let cursor = 0, dirty = true, tree: Element, effects: Array<() => unknown> = [];
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: (factory: () => any) => factory(), useCallback: (callback: unknown) => callback,
    useEffect(effect: () => unknown, dependencies: any[]) {
      const index = cursor++, old = slots[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old[i]))) { slots[index] = dependencies; effects.push(effect); }
    }
  };
  const exports: any = {};
  const savedDrafts = storage ?? new Map<string, string>();
  vm.runInNewContext(compile(file), { exports, Error, console, crypto: { randomUUID }, sessionStorage: { getItem: (key: string) => savedDrafts.get(key) ?? null, setItem: (key: string, value: string) => savedDrafts.set(key, value), removeItem: (key: string) => savedDrafts.delete(key) },
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx: (type: any, props: any, key: unknown) => ({ type, props, key }), jsxs: (type: any, props: any, key: unknown) => ({ type, props, key }) };
      if (name.includes("plan-mutation-recovery")) return recovery;
      if (name.includes("direct-blueprint-recovery")) return directRecovery;
      if (name.includes("blueprint-impact-review")) return impactReview;
      if (name.includes("api-client")) return { ...apiClient, ...modules[name] };
      return modules[name] ?? {};
    }
  });
  function render() {
    for (let i = 0; dirty && i < 30; i++) {
      dirty = false; cursor = 0; effects = []; tree = exports[exported](props);
      for (const effect of effects) effect();
    }
    assert.equal(dirty, false);
  }
  render();
  return {
    storage: savedDrafts,
    find: (predicate: (element: Element) => boolean) => find(tree, predicate),
    element: (name: string) => find(tree, (element) => element.type?.name === name || element.type === name),
    render() { dirty = true; render(); },
    async flush() { await new Promise<void>((resolve) => setImmediate(resolve)); render(); }
  };
}

function stagedHost(apply: () => Promise<void> = async () => {}, storage?: Map<string, string>, seed?: any) {
  const errors: string[] = [], previews: any[] = [];
  const props: any = { plan: { id: "fictional-plan", version: 1 }, presentation: { days: [], places: [] },
    onTaskToggle: async () => {}, onApplyItineraryEdits: async (_edits: unknown, _extra: unknown, _impact: unknown, committed: () => void) => { await apply(); committed(); }, onWorkspace: async () => {}, onStatus() {}, onError: (message: string) => errors.push(message), ...seed };
  const display = { initialDayId: "day", initialPlaceId: "fictional-place", days: [{ id: "day" }], places: [], areas: [], planAlternatives: [], guideFilters: [], itineraries: [] };
  const ui = componentHost("LandiBlueprintWorkspace.tsx", "LandiBlueprintWorkspace", props, {
    "./landi-blueprint-workspace-display.js": {
      buildBlueprintWorkspaceDisplay: () => display,
      contextualTipsForWorkspace: () => [],
      guideCardsForWorkspace: (_workspace: any, edits: any) => { previews.push(edits); return []; },
      detailDisplayForWorkspacePlace: () => ({ id: "fictional-place" }),
      itineraryDisplayForWorkspace: () => ({ items: [], dayId: "day" }),
      itineraryTimelineNodesForItems: () => [],
      scheduledDayIdForPlace: () => "day", buildPendingItineraryRemoveForWorkspace: () => edit,
      mergePendingItineraryEdit: (_old: any, next: any) => [next], compactPendingItineraryEdits: (edits: any) => edits
    },
    "./current-plan-route-refresh.js": { automaticRouteRefreshGate: () => undefined }
  }, storage);
  return { ui, props, errors, previews, reload: () => stagedHost(apply, ui.storage, { plan: props.plan, blueprintIdentity: props.blueprintIdentity }), stage() { ui.element("DetailPanel")!.props.onRemove("fictional-place"); ui.render(); }, bar: () => ui.element("ItineraryEditBar") };
}

test("actual itinerary component retains staged edits on a preparation version change and blocks stale application", async () => {
  let submissions = 0;
  const host = stagedHost(async () => { submissions++; });
  host.stage(); assert.equal(host.bar()!.props.edits[0], edit);
  host.props.plan = { id: "fictional-plan", version: 2 }; host.ui.render();
  assert.equal(host.bar()!.props.edits[0], edit);
  assert.equal(host.bar()!.props.canConfirm, false);
  assert.equal(host.previews.at(-1).length, 0);
  await host.bar()!.props.onConfirm();
  assert.equal(submissions, 0); assert.match(host.errors.at(-1)!, /original version/);
  host.props.plan = { id: "different-plan", version: 1 }; host.ui.render();
  assert.equal(host.bar()!.props.edits[0], edit); assert.equal(host.bar()!.props.canConfirm, false);
  host.bar()!.props.onDiscard(); host.ui.render(); assert.equal(host.bar(), undefined);
  host.stage(); assert.equal(host.bar()!.props.canConfirm, true);
  await host.bar()!.props.onConfirm(); await host.ui.flush();
  assert.equal(submissions, 1); assert.equal(host.bar(), undefined);
});

test("actual itinerary component preserves an unacknowledged edit after failure without submitting again", async () => {
  let submissions = 0;
  const host = stagedHost(async () => { submissions++; throw new Error("Lost edit response"); });
  host.stage(); await host.bar()!.props.onConfirm(); await host.ui.flush();
  assert.equal(submissions, 1); assert.equal(host.bar()!.props.edits[0], edit);
});

test("an acknowledged edit's own version update does not produce a stale-draft warning", async () => {
  const host = stagedHost(async () => {
    host.props.itineraryEditBusy = true;
    host.props.plan = { id: "saved-plan", version: 1 };
    host.ui.render();
  });
  host.stage(); await host.bar()!.props.onConfirm(); await host.ui.flush();
  host.props.itineraryEditBusy = false; host.ui.render();
  assert.equal(host.bar(), undefined); assert.equal(host.errors.length, 0);
});

test("draft updates retain the original version until explicitly discarded", () => {
  const original = recovery.updateStagedItineraryDraft(null, { id: "plan", version: 1 }, [edit])!;
  const next = recovery.updateStagedItineraryDraft(original, { id: "plan", version: 2 }, (edits) => [...edits]);
  assert.equal(next?.version, 1); assert.equal(recovery.stagedItineraryMatches(next, { id: "plan", version: 2 }), false);
  assert.equal(recovery.updateStagedItineraryDraft(next, { id: "plan", version: 2 }, []), null);
});

test("mutation reconciliation reports unknown on read failure and never publishes a fabricated result", async () => {
  let reads = 0, published = 0;
  const message = await recovery.reconcilePlanMutationFailure(new Error("Lost edit response"), {
    read: async (): Promise<WorkspaceSnapshot> => { reads++; throw new Error("Offline"); }, publish: () => { published++; }
  });
  assert.equal(reads, 1); assert.equal(published, 0); assert.match(message, /original operation result is still unknown/);
});

test("actual App reads latest state after reorder or undo errors without repeating either mutation", async () => {
  for (const kind of ["reorder", "undo"]) {
    let reads = 0, mutations = 0;
    const ui = appHost({ ...baseApi(), getWorkspace: async () => ({ ...workspace(), activePlan: { id: "fictional-plan", version: ++reads } }),
      reorderPlanTask: async () => { mutations++; throw new Error("Lost response"); }, undoPlanChange: async () => { mutations++; throw new Error("Lost response"); } });
    await ui.flush();
    if (kind === "reorder") await ui.plans().onTaskReorder("fictional-plan", "task", "up");
    else await ui.plans().onUndoChange("fictional-plan", "change");
    await ui.flush();
    assert.equal(mutations, 1); assert.equal(reads, 2); assert.equal(ui.plans().currentPlan.version, 2);
    assert.match(ui.error(), /original operation is still unconfirmed/g);
  }
});

function currentHost(api: any, read?: () => Promise<any>, publish?: () => Promise<void>, storage?: Map<string, string>, seed?: any) {
  const errors: string[] = [], published: any[] = [];
  const plan: any = { id: "fictional-plan", version: 1, status: "draft", stages: [], assumptions: [], presentation: { kind: "itinerary", places: [{ id: "fictional-place" }] } };
  const props: any = { plan, latestPlanReplacement: {}, onWorkspace: async (next: any) => { published.push(next); await publish?.(); }, onStatus() {}, onError: (error: string) => errors.push(error), onOperationBusy() {}, ...seed };
  const ui = componentHost("CurrentPlanWorkspace.tsx", "CurrentPlan", props, {
    "./api-client.js": { ...apiClient, ...api, getWorkspace: read ?? (async () => ({ activePlan: { id: "latest-plan", version: 2 } })) },
    "./current-plan-read-model.js": { currentPlanReadModel: (plan: any) => ({ plan, presentation: plan.presentation, mutationVersion: { expectedVersion: plan.version, expectedBlueprintVersion: 1 }, workspaceKey: "old-remount-key" }) },
    "./plan-external-display.js": { visibleDocumentPolicySources: () => [] },
    "./plan-display.js": { planRefinementQuestion: () => undefined },
    "./plan-preparation-display.js": { isExplicitPreparationTask: () => false },
    "./landi-blueprint-workspace-display.js": { compactPendingItineraryEdits: (edits: any) => edits, appliedItineraryRevisionSummary: () => ({ statusText: "Saved" }) },
    "./current-plan-route-refresh.js": { automaticRouteRefreshRequestForRevision: () => undefined },
    "./LandiBlueprintWorkspace.js": { LandiBlueprintWorkspace: "LandiBlueprintWorkspace" },
    "./PlanStatusWidgets.js": { PlanReplacementNotice: "PlanReplacementNotice" }
  }, storage);
  return { ui, props, errors, published };
}

test("actual itinerary edit error reads latest state and does not invoke assisted replanning", async () => {
  let mutations = 0, assisted = 0, reads = 0, acknowledged = 0;
  const failure = { payload: { replanRequirement: { status: "assisted_replanning_required", explanation: "Needs review" } } };
  const host = currentHost({ applyDirectBlueprintRevisionBatch: async () => { mutations++; throw failure; },
    prepareDirectBlueprintAssistedReplanning: async () => { assisted++; }, sendAgentChat: async () => { assisted++; } },
  async () => { reads++; return { activePlan: { id: "latest-plan", version: 2 } }; });
  const child = host.ui.element("LandiBlueprintWorkspace")!;
  assert.equal((child as any).key, undefined, "Plan identity changes must not remount the staged-edit component");
  await assert.rejects(child.props.onApplyItineraryEdits([edit], [], undefined, () => { acknowledged++; }));
  assert.equal(acknowledged, 0);
  assert.equal(mutations, 1); assert.equal(reads, 1); assert.equal(assisted, 0);
  assert.equal(host.published[0].activePlan.id, "latest-plan"); assert.match(host.errors.at(-1)!, /it has not been submitted again/);
});

test("actual replacement undo error reads current state without claiming success or repeating undo", async () => {
  let mutations = 0;
  const host = currentHost({ undoPlanReplacement: async () => { mutations++; throw new Error("Lost undo response"); } });
  await host.ui.element("PlanReplacementNotice")!.props.onUndo();
  assert.equal(mutations, 1); assert.equal(host.published.length, 1);
  assert.match(host.errors.at(-1)!, /original operation is still unconfirmed/g);
});

test("仅优先级草稿绑定完整身份，新Plan同版本不得重绑旧批次", async () => {
  let mutations = 0;
  const host = stagedHost(async () => { mutations++; });
  host.props.blueprintIdentity = { id: "blueprint-a", version: 1 }; host.ui.render();
  host.ui.element("DetailPanel")!.props.onPriority("must"); host.ui.render();
  assert.equal(host.bar()!.props.extraLabels.length, 1);
  host.props.plan = { id: "another-plan", version: 1 };
  host.props.blueprintIdentity = { id: "blueprint-a", version: 2 }; host.ui.render();
  assert.equal(host.bar()!.props.canConfirm, false);
  await host.bar()!.props.onConfirm(); await host.ui.flush();
  assert.equal(mutations, 0);
  assert.equal(host.bar()!.props.extraLabels.length, 1);
  assert.match(host.errors.at(-1)!, /changed|latest|review/i);
  const refreshed = host.reload();
  assert.equal(refreshed.bar()!.props.canConfirm, false);
  assert.equal(refreshed.bar()!.props.extraLabels.length, 1);
  await refreshed.bar()!.props.onConfirm(); await refreshed.ui.flush();
  assert.equal(mutations, 0);
  assert.equal(refreshed.bar()!.props.extraLabels.length, 1);
  refreshed.bar()!.props.onDiscard(); refreshed.ui.render();
  assert.equal(refreshed.bar(), undefined);
  assert.equal(refreshed.ui.storage.size, 0);
});

test("同组件保存到新Plan后第二轮草稿使用唯一Blueprint存储键，刷新完整恢复", async () => {
  const host = stagedHost(async () => {
    host.props.plan = { id: "new-plan", version: 1 };
    host.props.blueprintIdentity = { id: "blueprint", version: 2 };
    host.ui.render();
  });
  host.props.blueprintIdentity = { id: "blueprint", version: 1 }; host.ui.render();
  host.ui.element("DetailPanel")!.props.onPriority("must"); host.ui.render();
  await host.bar()!.props.onConfirm(); await host.ui.flush();
  assert.equal(host.bar(), undefined);
  host.ui.element("DetailPanel")!.props.onPriority("nearby"); host.ui.render();
  assert.equal(host.ui.storage.size, 1);
  assert.equal(host.ui.storage.has("landi:pending-blueprint:blueprint:blueprint"), true);
  const reloaded = host.reload();
  assert.equal(reloaded.bar()!.props.extraLabels.length, 1);
  assert.equal(reloaded.bar()!.props.canConfirm, true);
});

test("关系回执重绑后真实子组件保留原修改，后续新编辑仍能持久保存", () => {
  const host = stagedHost(undefined, undefined, { blueprintIdentity: { id: "blueprint", version: 1 } });
  host.ui.element("DetailPanel")!.props.onPriority("must"); host.ui.render();
  const key = "landi:pending-blueprint:blueprint:blueprint", value = JSON.parse(host.ui.storage.get(key)!);
  value.binding = { planId: "reviewed-plan", planVersion: 1, blueprintId: "blueprint", blueprintVersion: 2 };
  const signature = JSON.stringify(value); host.ui.storage.set(key, signature);
  host.props.plan = { id: "reviewed-plan", version: 1 }; host.props.blueprintIdentity = { id: "blueprint", version: 2 }; host.props.rebasedDraft = { key, signature }; host.ui.render();
  assert.equal(host.bar()!.props.canConfirm, true); assert.equal(host.ui.storage.get(key), signature);
  host.ui.element("DetailPanel")!.props.onPriority("nearby"); host.ui.render();
  assert.equal(JSON.parse(host.ui.storage.get(key)!).extra[0].revision.priority, "nearby");
});

test("来源更正不自动重绑，旅行者明确核对原目标后可重新预览原草稿", () => {
  const host = stagedHost(undefined, undefined, { blueprintIdentity: { id: "blueprint", version: 1 } });
  host.stage(); host.props.plan = { id: "corrected-plan", version: 1 }; host.props.blueprintIdentity = { id: "blueprint", version: 2 };
  host.props.reviewBlueprint = { days: [{ id: "day", date: "2026-12-01" }], places: [{ id: "fictional-place", name: "合成场馆" }] }; host.ui.render();
  assert.equal(host.bar()!.props.canConfirm, false);
  const button = (label: string) => host.ui.find((node) => node.type === "button" && node.props.children === label)!;
  button("按当前行程重新审阅原修改").props.onClick(); host.ui.render();
  button("我已逐项核对，重新预览原修改").props.onClick(); host.ui.render();
  assert.equal(host.bar()!.props.canConfirm, true); assert.equal(host.bar()!.props.edits[0].placeId, edit.placeId);
  const restored = JSON.parse(host.ui.storage.get("landi:pending-blueprint:blueprint:blueprint")!);
  assert.equal(restored.draft.planId, "corrected-plan"); assert.equal(restored.binding.blueprintVersion, 2);
});

test("成功API回执先确认精确草稿，再发布可能永不返回的工作区刷新", async () => {
  let acknowledged = false;
  const host = currentHost({ applyDirectBlueprintRevisionBatch: async () => ({ workspace: { activePlan: { id: "saved-plan", version: 1 } }, revision: { id: "saved-revision" } }) }, undefined, async () => {
    assert.equal(acknowledged, true);
    return new Promise<void>(() => {});
  });
  let settled = false;
  const action = host.ui.element("LandiBlueprintWorkspace")!.props.onApplyItineraryEdits([edit], [], undefined, () => { acknowledged = true; });
  void action.finally(() => { settled = true; });
  await waitFor(() => acknowledged); await host.ui.flush();
  assert.equal(acknowledged, true);
  assert.equal(host.published.length, 1);
  assert.equal(settled, false);
});

test("已确认提交同步清理存储，父发布尚未返回时立即刷新无旧批次", async () => {
  const host = stagedHost();
  host.props.blueprintIdentity = { id: "blueprint", version: 1 }; host.ui.render();
  host.ui.element("DetailPanel")!.props.onPriority("must"); host.ui.render();
  assert.equal(host.ui.storage.size, 1);
  host.props.onApplyItineraryEdits = async (_edits: unknown, _extra: unknown, _impact: unknown, committed: () => void) => {
    committed();
    assert.equal(host.ui.storage.size, 0, "确认同步完成，不依赖React effect");
    host.props.plan = { id: "saved-plan", version: 1 };
    host.props.blueprintIdentity = { id: "blueprint", version: 2 };
    const reloaded = host.reload();
    assert.equal(reloaded.bar(), undefined);
    return new Promise<void>(() => {});
  };
  host.ui.render();
  void host.bar()!.props.onConfirm();
  assert.equal(host.ui.storage.size, 0);
});

test("提交失败不确认也不清草稿，提交中不允许替换已捕获的批次", async () => {
  let reject!: (error: Error) => void;
  const host = stagedHost(() => new Promise<void>((_resolve, rejected) => { reject = rejected; }));
  host.ui.element("DetailPanel")!.props.onPriority("must"); host.ui.render();
  const original = [...host.ui.storage.values()][0];
  const pending = host.bar()!.props.onConfirm();
  host.ui.element("DetailPanel")!.props.onPriority("nearby"); host.ui.render();
  assert.equal([...host.ui.storage.values()][0], original);
  reject(new Error("保存回执未知")); await pending; await host.ui.flush();
  assert.equal([...host.ui.storage.values()][0], original);
  assert.equal(host.reload().bar()!.props.extraLabels.length, 1);
});

const pendingSave = (): directRecovery.PendingBlueprintOperation => { const operation = ({
  identity: { operation: "save", requestId: "original-request", expectedPlanId: "fictional-plan", expectedVersion: 1, expectedBlueprintVersion: 1 },
  body: { requestId: "original-request", expectedVersion: 1, expectedBlueprintVersion: 1, highImpactConfirmation: "review", revisions: [{ kind: "set_tip_state", tipId: "tip", pinned: true }] },
  draft: { key: "fictional-draft", signature: "original-draft" }
}); return { ...operation, identity: { ...operation.identity, operation: "save", requestDigest: createHash("sha256").update(workspaceMutationDigestInput("save", operation.identity.expectedPlanId, operation.body)).digest("hex") } }; };
const storagePort = (values: Map<string, string>) => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });

test("原请求持久化为不可变快照，迟到回执只清理匹配草稿", () => {
  const values = new Map<string, string>([["fictional-draft", "original-draft"]]);
  const storage = storagePort(values), original = pendingSave();
  const saved = directRecovery.persistPendingBlueprintOperation(storage, original);
  (original.body as any).highImpactConfirmation = "changed";
  assert.equal((directRecovery.readPendingBlueprintOperation(storage)!.body as any).highImpactConfirmation, "review");
  assert.throws(() => directRecovery.persistPendingBlueprintOperation(storage, pendingSave()));
  values.set("fictional-draft", "newer-draft");
  directRecovery.acknowledgeBlueprintOperation(storage, saved);
  assert.equal(values.get("fictional-draft"), "newer-draft");
  assert.equal(values.has(directRecovery.pendingBlueprintOperationKey), false);
});

test("真实CurrentPlan组件刷新只读匹配回执并清理原草稿，不再次提交", async () => {
  const saved = pendingSave(), storage = new Map([[directRecovery.pendingBlueprintOperationKey, JSON.stringify(saved)], [saved.draft!.key, saved.draft!.signature]]);
  let posts = 0, reads = 0;
  const host = currentHost({ getDirectBlueprintReceipt: async (identity: unknown) => { reads++; assert.deepEqual(identity, saved.identity); return { ...saved.identity, status: "committed", workspace: { activePlan: { id: "current-plan", version: 7 } }, revision: { id: "saved-revision" } }; }, applyDirectBlueprintRevisionBatch: async () => { posts++; } }, undefined, undefined, storage);
  await waitFor(() => host.published.length > 0 && storage.size === 0);
  await host.ui.flush();
  assert.equal(reads, 1); assert.equal(posts, 0); assert.equal(storage.size, 0);
  assert.equal(host.published[0].activePlan.id, "current-plan");
  assert.deepEqual(host.ui.element("LandiBlueprintWorkspace")!.props.acknowledgedDraft, saved.draft);
});

test("刷新未找到回执时保留请求和草稿，仅明确重试复用完整原载荷", async () => {
  const saved = pendingSave(), storage = new Map([[directRecovery.pendingBlueprintOperationKey, JSON.stringify(saved)], [saved.draft!.key, saved.draft!.signature]]);
  let posts = 0, reads = 0;
  const host = currentHost({ getDirectBlueprintReceipt: async () => { reads++; return { ...saved.identity, status: "not_found" }; }, applyDirectBlueprintRevisionBatch: async (planId: string, body: unknown) => { posts++; assert.equal(planId, saved.identity.expectedPlanId); assert.deepEqual(body, saved.body); return { workspace: { activePlan: { id: "saved-plan", version: 1 } }, revision: { id: "revision" } }; } }, undefined, undefined, storage);
  await waitFor(() => reads > 0 && host.errors.some((text: string) => /still unconfirmed/.test(text)));
  await host.ui.flush();
  assert.equal(reads, 1); assert.equal(posts, 0); assert.equal(storage.size, 2);
  assert.equal(host.ui.element("LandiBlueprintWorkspace")!.props.mutationRecoveryPending, true);
  assert.match(host.errors.at(-1)!, /still unconfirmed/);
  await assert.rejects(host.ui.element("LandiBlueprintWorkspace")!.props.onApplyItineraryEdits([edit]));
  assert.equal(posts, 0);
  const button = host.ui.element("LandiBlueprintWorkspace");
  assert.ok(button);
  // 只有实际恢复按钮可以再次提交已保留的原载荷。
  const recoveryButton = host.ui.find((element: Element) => element.type === "button" && element.props.children === "Resubmit original operation");
  await recoveryButton!.props.onClick(); await waitFor(() => posts === 1 && storage.size === 0); await host.ui.flush();
  assert.equal(reads, 2); assert.equal(posts, 1); assert.equal(storage.size, 0);
});

test("真实组件保存响应丢失后仅凭匹配回执确认结果", async () => {
  let posted: any, ack = 0;
  const host = currentHost({ applyDirectBlueprintRevisionBatch: async (_plan: string, body: any) => { posted = body; throw new Error("内部诊断哨兵"); }, getDirectBlueprintReceipt: async (identity: any) => ({ ...identity, status: "committed", workspace: { activePlan: { id: "committed", version: 1 } }, revision: { id: "revision" } }) });
  await host.ui.element("LandiBlueprintWorkspace")!.props.onApplyItineraryEdits([edit], [], undefined, () => { ack++; });
  assert.equal(ack, 1); assert.ok(posted.requestId); assert.equal(host.published[0].activePlan.id, "committed");
  assert.equal(host.ui.storage.size, 0); assert.equal(host.errors.some((text) => text.includes("诊断哨兵")), false);
});

test("保存和撤销匹配已提交回执后清除旧未知告警，后续加载失败仍显示", async () => {
  for (const operation of ["save", "undo"] as const) {
    const saved = pendingSave();
    if (operation === "undo") {
      Object.assign(saved.identity, { operation: "undo", revisionId: "original-revision" });
      saved.body = { requestId: saved.identity.requestId, expectedVersion: 1, expectedBlueprintVersion: 1 };
      saved.identity.requestDigest = createHash("sha256").update(workspaceMutationDigestInput("undo", saved.identity.expectedPlanId, { ...saved.body, revisionId: "original-revision" })).digest("hex");
    }
    for (const failedPublish of [false, true]) {
      const storage = new Map([[directRecovery.pendingBlueprintOperationKey, JSON.stringify(saved)]]);
      let committed = false;
      const host = currentHost({ getDirectBlueprintReceipt: async (identity: any) => committed
        ? { ...identity, status: "committed", workspace: { activePlan: { id: "current-plan", version: 1 } }, ...(operation === "save" ? { revision: { id: "saved-revision" } } : {}) }
        : { ...identity, status: "not_found" }
      }, undefined, failedPublish ? async () => { throw new Error("虚构加载故障"); } : undefined, storage);
      await waitFor(() => host.errors.length > 0); await host.ui.flush();
      assert.match(host.errors.at(-1)!, /still unconfirmed/);
      committed = true;
      const check = host.ui.find((element: Element) => element.type === "button" && element.props.children === "Check previous result")!;
      await check.props.onClick(); await waitFor(() => host.published.length > 0); await host.ui.flush();
      assert.equal(storage.size, 0);
      if (failedPublish) assert.equal(host.errors.at(-1), "The operation is confirmed, but the workspace could not be updated. Refresh to see the current plan.");
      else assert.equal(host.errors.at(-1), "");
      assert.equal(host.errors.at(-1)!.includes("尚未确认"), false);
    }
  }
});

test("真实组件撤销回执丢失后刷新可恢复，重复点击不执行二次撤销", async () => {
  let posts = 0, identity: any, firstRead = true;
  const storage = new Map<string, string>();
  const api = { undoDirectBlueprintRevision: async () => { posts++; throw new Error("内部撤销诊断"); }, getDirectBlueprintReceipt: async (request: any) => { identity = request; if (firstRead) { firstRead = false; throw new Error("连接丢失"); } return { ...request, status: "committed", workspace: { activePlan: { id: "undone", version: 1 } } }; } };
  const seed = { latestDirectBlueprintRevision: { id: "revision", planId: "fictional-plan", planVersion: 1 } };
  const first = currentHost(api, undefined, undefined, storage, seed);
  const undo = first.ui.find((element: Element) => element.props.className === "blueprint-saved-undo")!;
  await undo.props.onClick(); await waitFor(() => posts === 1 && first.errors.length > 0); await first.ui.flush();
  assert.equal(posts, 1); assert.ok(storage.has(directRecovery.pendingBlueprintOperationKey));
  await undo.props.onClick(); assert.equal(posts, 1);
  const reloaded = currentHost(api, undefined, undefined, storage, seed); await waitFor(() => reloaded.published.length > 0); await reloaded.ui.flush();
  assert.equal(identity.operation, "undo"); assert.equal(identity.revisionId, "revision");
  assert.equal(posts, 1); assert.equal(storage.size, 0); assert.equal(reloaded.published[0].activePlan.id, "undone");
});

test("恢复信息持久化失败时阻止真实组件发送写请求", async () => {
  let posts = 0;
  const storage = new Map<string, string>();
  storage.set = () => { throw new Error("配额已满"); };
  const host = currentHost({ applyDirectBlueprintRevisionBatch: async () => { posts++; } }, undefined, undefined, storage);
  await assert.rejects(host.ui.element("LandiBlueprintWorkspace")!.props.onApplyItineraryEdits([edit]));
  assert.equal(posts, 0); assert.match(host.errors.at(-1)!, /were not submitted/);
});

test("同身份同版本但载荷摘要不匹配时不读回执、不确认也不清草稿", async () => {
  const saved = pendingSave();
  (saved.body as any).revisions[0].pinned = false;
  const storage = new Map([[directRecovery.pendingBlueprintOperationKey, JSON.stringify(saved)], [saved.draft!.key, saved.draft!.signature]]);
  let reads = 0;
  const host = currentHost({ getDirectBlueprintReceipt: async () => { reads++; throw new Error("不应读取"); } }, undefined, undefined, storage);
  await waitFor(() => host.errors.length > 0); await host.ui.flush();
  assert.equal(reads, 0); assert.equal(storage.size, 2); assert.equal(host.published.length, 0);
});

test("摘要生成期间同步锁阻止双击产生第二次请求身份", async () => {
  let posts = 0;
  const host = currentHost({ applyDirectBlueprintRevisionBatch: async () => { posts++; return { workspace: { activePlan: { id: "saved", version: 1 } }, revision: { id: "revision" } }; } });
  const apply = host.ui.element("LandiBlueprintWorkspace")!.props.onApplyItineraryEdits;
  await Promise.all([apply([edit]), apply([edit])]);
  assert.equal(posts, 1);
});

test("高影响预览拒绝后确认使用新身份与新载荷摘要，保持结构化预览", async () => {
  const bodies: any[] = [];
  const impact = { id: "impact", dates: [], dayIds: [], placeIds: [], movementIds: [], reminderRequirementIds: [], bookingConstraintIds: [], evidence: [] };
  const host = currentHost({ applyDirectBlueprintRevisionBatch: async (_plan: string, body: any) => {
    bodies.push(body);
    if (bodies.length === 1) throw new apiClient.ApiRequestError("内部诊断哨兵", 409, { code: "high_impact_confirmation_required", impact });
    return { workspace: { activePlan: { id: "saved", version: 1 } }, revision: { id: "revision" } };
  } });
  const apply = host.ui.element("LandiBlueprintWorkspace")!.props.onApplyItineraryEdits;
  await assert.rejects(apply([edit]), (caught: any) => caught.payload.impact === impact);
  await apply([edit], [], "impact");
  assert.equal(bodies.length, 2); assert.notEqual(bodies[0].requestId, bodies[1].requestId);
  assert.equal(bodies[1].highImpactConfirmation, "impact");
  assert.equal(host.errors.some((text) => text.includes("诊断哨兵")), false);
});

test("迟到确认传到真实子组件时只清原签名，保留新编辑", async () => {
  const host = stagedHost();
  host.stage();
  const signature = [...host.ui.storage.values()][0]!;
  host.props.acknowledgedDraft = { key: "landi:pending-blueprint:plan:fictional-plan", signature: "older-signature" };
  host.ui.render();
  assert.ok(host.bar()); assert.equal([...host.ui.storage.values()][0], signature);
  host.props.acknowledgedDraft = { key: "landi:pending-blueprint:plan:fictional-plan", signature };
  host.ui.render();
  assert.equal(host.bar(), undefined); assert.equal(host.ui.storage.size, 0);
});


test("迟到确认后空草稿effect保留存储中较新的草稿签名", () => {
  const host = stagedHost(); host.stage();
  const key = "landi:pending-blueprint:plan:fictional-plan", signature = host.ui.storage.get(key)!;
  const newer = JSON.parse(signature); newer.draft.edits[0].placeName = "新的草稿地点";
  const newerSignature = JSON.stringify(newer); host.ui.storage.set(key, newerSignature);
  host.props.acknowledgedDraft = { key, signature }; host.ui.render();
  assert.equal(host.ui.storage.get(key), newerSignature);
});

test("internal_error与4xx状态矛盾时仍保留未知请求及草稿", async () => {
  const host = currentHost({
    applyDirectBlueprintRevisionBatch: async () => { throw new apiClient.ApiRequestError("内部诊断哨兵", 400, { code: "internal_error" }); },
    getDirectBlueprintReceipt: async (identity: unknown) => ({ ...identity as object, status: "not_found" })
  });
  await assert.rejects(host.ui.element("LandiBlueprintWorkspace")!.props.onApplyItineraryEdits([edit]));
  assert.ok(host.ui.storage.has(directRecovery.pendingBlueprintOperationKey));
  assert.equal(host.errors.some((text) => text.includes("内部诊断哨兵")), false);
});

test("损坏的恢复记录保留原字节并阻止同职责写入", async () => {
  const storage = new Map([[directRecovery.pendingBlueprintOperationKey, "{损坏的恢复信息"]]);
  let mutations = 0;
  const host = currentHost({ applyDirectBlueprintRevisionBatch: async () => { mutations++; }, undoDirectBlueprintRevision: async () => { mutations++; }, refreshPlanRoutes: async () => { mutations++; }, prepareDirectBlueprintAssistedReplanning: async () => { mutations++; } }, undefined, undefined, storage, { latestDirectBlueprintRevision: { id: "revision", planId: "fictional-plan", planVersion: 1 } });
  await host.ui.flush();
  const child = host.ui.element("LandiBlueprintWorkspace")!;
  assert.equal(child.props.mutationRecoveryPending, true);
  await assert.rejects(child.props.onApplyItineraryEdits([edit]));
  await child.props.onRequestRouteRefresh({ segmentIds: ["route"] });
  await child.props.onRequestAssistedReplanning([], [], {});
  const undo = host.ui.find((element: Element) => element.props.className === "blueprint-saved-undo")!;
  assert.equal(undo.props.disabled, true); await undo.props.onClick();
  assert.equal(mutations, 0); assert.equal(storage.get(directRecovery.pendingBlueprintOperationKey), "{损坏的恢复信息");
});

test("unsupported transport notice and readback stay English without exposing service text or repeating the write", async () => {
  let reads = 0;
  const failure = new apiClient.ApiRequestError("此交通方式暂不支持自动更新。 /private/internal-only", 409, { code: "unsupported_mode" });
  const message = await recovery.reconcilePlanMutationFailure(failure, {
    read: async () => { reads++; return workspace() as unknown as WorkspaceSnapshot; }, publish: () => {}
  });
  assert.equal(reads, 1);
  assert.equal(message, "Automatic route updates are not available for this transport mode. The latest plan is displayed. The original operation is still unconfirmed; it has not been submitted again.");
  assert.doesNotMatch(message, /[\p{Script=Han}]|\/private\/internal-only/u);
  const unavailable = await recovery.reconcilePlanMutationFailure(failure, {
    read: async () => { throw new Error("unknown service details"); }, publish: () => assert.fail("No workspace to publish")
  });
  assert.equal(unavailable, "Automatic route updates are not available for this transport mode. The latest plan could not be loaded. The original operation result is still unknown; it has not been submitted again.");
});
