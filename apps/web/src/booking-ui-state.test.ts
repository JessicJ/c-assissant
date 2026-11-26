import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as apiClient from "./api-client.js";
import * as importRecovery from "./booking-import-recovery.js";
import * as reviewDisplay from "./booking-relationship-review.js";
import * as relationships from "@c-assistant/core/booking-relationship";
import * as sourceSelection from "@c-assistant/core/booking-source-selection";

type Element = { type: any; props: Record<string, any> };
function nodes(value: any): Element[] { if (!value || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
function text(value: any): string { if (value === null || value === undefined || typeof value === "boolean") return ""; if (Array.isArray(value)) return value.map(text).join(""); return typeof value === "object" ? text(value.props?.children) : String(value); }
function memory() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
/** 真实 React 组件事件和 effect 的确定性宿主，不运行浏览器、DOM、地图或网络。 */
function host(file: string, name: string, props: any, api: any, storage = memory()) {
  const slots: any[] = []; let cursor = 0, dirty = true, tree: Element, effects: (() => unknown)[] = [];
  const hooks = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (update: any) => { const next = typeof update === "function" ? update(slots[index]) : update; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect: () => unknown, deps: any[]) { const index = cursor++, before = slots[index]; if (!before || deps.some((value, i) => !Object.is(value, before[i]))) { slots[index] = deps; effects.push(effect); } }
  };
  const exports: any = {}, jsx = (type: any, props: any) => typeof type==="function"?type(props):({ type, props });
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, crypto: globalThis.crypto, sessionStorage: storage, require(module: string) {
    if (module === "react") return hooks; if (module === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (module === "react-dom") return { createPortal: (element: unknown) => element };
    if (module.includes("api-client")) return { ...apiClient, ...api };
    if (module.includes("booking-import-recovery")) return importRecovery;
    if (module.includes("booking-relationship-review.js")) return reviewDisplay;
    if (module.includes("core/booking-relationship")) return relationships;
    if (module.includes("core/booking-source-selection")) return sourceSelection;
    return {};
  } });
  function render() { for (let i = 0; dirty && i < 30; i++) { dirty = false; cursor = 0; effects = []; tree = exports[name](props); for (const effect of effects) effect(); } assert.equal(dirty, false); }
  async function flush() { for (let i = 0; i < 3; i++) { await new Promise<void>((resolve) => setImmediate(resolve)); render(); } }
  render();
  return { storage, flush, tree: () => tree, render, all: () => nodes(tree), button: (label: string) => nodes(tree).find((node) => node.type === "button" && text(node) === label)!, label: (label: string) => nodes(tree).find((node) => node.type === "label" && text(node).startsWith(label))!, setProps(update: any) { Object.assign(props, update); dirty = true; render(); } };
}
const booking = (id = "预订甲") => ({ id, title: id, type: "other", status: "pending", segments: [], sourceLabel: "合成资料" });
test("真实导入组件双击只提交原身份，未知恢复不自动POST，多项需重新预览", async () => {
  const posts: any[] = [], statuses: any[] = []; let committed = false;
  const baseline = { scope: { type: "planning", sessionId: "会话" }, expectedRevision: 5, records: [], bookings: [] };
  const ui = host("BookingImportPanel.tsx", "BookingImportPanel", { scope: baseline.scope, onWorkspace: async () => {}, onStatus: (value: any) => statuses.push(value), onError() {} }, {
    listBookings: async () => ({ bookings: [] }), getBookingImportBaseline: async () => baseline,
    previewBookingImport: async () => ({ bookings: [booking(), booking("预订乙")] }),
    confirmBookingImport: async (_scope: any, body: any) => { posts.push(structuredClone(body)); if (!committed) throw new Error("合成丢响应"); return { workspace: {} }; },
    readBookingImportReceipt: async (record: any) => committed ? { status: "committed", workspace: {} } : { status: "not_found" }
  });
  await ui.flush(); ui.button("Import").props.onClick(); ui.render();
  ui.all().find((node) => node.type === "textarea")!.props.onChange({ target: { value: "合成两份预订输入" } }); ui.render();
  ui.button("Preview import").props.onClick(); await ui.flush();
  assert.ok(text(ui.tree()).includes("2 bookings to review")); assert.equal(ui.button("Accept all"), undefined);
  const accept = ui.button("确认本项预订"); accept.props.onClick(); accept.props.onClick(); await ui.flush(); assert.equal(posts.length, 1); assert.equal(posts[0].expectedRevision, 5);
  ui.button("Check original booking receipt").props.onClick(); await ui.flush(); assert.equal(posts.length, 1);
  committed = true; ui.button("Retry unchanged original request").props.onClick(); await ui.flush();
  assert.equal(posts.length, 1); assert.equal(ui.storage.getItem(importRecovery.bookingImportRecoveryKey), null); assert.equal(ui.button("确认本项预订"), undefined);
  assert.ok(statuses.some((status) => status.text.includes("Preview the remaining bookings again")));
});
test("真实导入组件刷新丢失私密payload，只保留查询入口；切换scope不串预览", async () => {
  const baseline = { scope: { type: "planning", sessionId: "会话" }, expectedRevision: 3, records: [], bookings: [] };
  const frozen = importRecovery.frozenBookingImport(baseline as any, booking() as any, "私密合成原文"), storage = memory(); importRecovery.persistBookingImportRecovery(storage, frozen.recovery);
  let posts = 0, reads = 0;
  const ui = host("BookingImportPanel.tsx", "BookingImportPanel", { scope: baseline.scope, onWorkspace: async () => {}, onStatus() {}, onError() {} }, { listBookings: async () => ({ bookings: [] }), confirmBookingImport: async () => { posts++; }, readBookingImportReceipt: async () => { reads++; return { status: "not_found" }; } }, storage);
  await ui.flush(); assert.equal(posts, 0); assert.equal(ui.button("Retry unchanged original request"), undefined);
  ui.button("Check original booking receipt").props.onClick(); await ui.flush(); assert.equal(reads, 1); assert.equal(posts, 0);
  ui.setProps({ scope: { type: "planning", sessionId: "另一会话" } }); await ui.flush(); assert.equal(posts, 0); assert.ok(storage.getItem(importRecovery.bookingImportRecoveryKey));
});
test("真实审阅面板先展示完整清单，再明确生产完整无关联与未知决定", async () => {
  for (const coverage of ["complete", "unknown"]) {
    const blueprint: any = { id: "蓝图", version: 1, sources: [], places: [{ id: "地点", name: "合成美术馆" }], days: [{ id: "日一", date: "2026-12-01", stops: [{ placeId: "地点" }] }], movements: [], bookingConstraints: [{ id: "约束", title: "软预订", segments: [] }] };
    const context = { ...relationships.bookingRelationshipReviewContext(blueprint), sourceSetDigest: "a".repeat(64),pendingSourceBookingIds:[], sourceIssues: [], sourceCandidates: [], constraints: blueprint.bookingConstraints };
    const saved: any[] = [];
    const ui = host("BookingRelationshipReviewPanel.tsx", "BookingRelationshipReviewPanel", { plan: { id: "计划", version: 1 }, blueprint, busy: false, onSave: async (value: any) => saved.push(value), onError() {}, onClose() {} }, { getBookingRelationshipReview: async () => context });
    await ui.flush(); assert.ok(text(ui.tree()).includes("本次须核对的完整日程与交通清单")); assert.ok(text(ui.tree()).includes("合成美术馆"));
    function change(label: string, value: string) { const control = nodes(ui.label(label)).find((node) => ["textarea", "input", "select"].includes(node.type))!; control.props.onChange({ target: { value } }); ui.render(); }
    change("审阅范围", coverage); change("本项判断理由", "已核对实际预订与逐日目标"); change("本项来源", "旅行者本人的逐项声明");
    const check = ui.all().find((node) => node.type === "input" && node.props.type === "checkbox")!; assert.equal(check.props.disabled, false); check.props.onChange({ target: { checked: true } }); ui.render();
    change("整体审阅理由", "明确本次核对范围"); change("整体审阅来源", "旅行者本人的逐项声明");
    assert.equal(ui.button("单独保存关联审阅").props.disabled, false); ui.button("单独保存关联审阅").props.onClick(); await ui.flush();
    assert.equal(saved[0].kind, "review_booking_relationships"); assert.equal(saved[0].assessment.units[0].coverage, coverage); assert.equal(saved[0].assessment.units[0].relations.length, 0); assert.equal(saved[0].assessment.decision.source, "traveler"); assert.equal(saved[0].assessment.decision.actorId, "local-traveler"); assert.equal(saved[0].assessment.decision.model, undefined);
  }
});

test("真实关联建立入口分别生产出现位置、全局地点及完整跨日交通依赖", async () => {
  for (const scope of ["occurrence", "place_global", "dependency"]) {
    const blueprint: any = { id: "蓝图", version: 1, sources: [{ id: "内部原来源", title: "旅客提供的预订材料" }], places: [{ id: "酒店", name: "合成酒店" }], days: [{ id: "日一", date: "2026-12-01", stops: [{ placeId: "酒店" }], blocks: [{ id: "入住", placeId: "酒店" }, { id: "取行李", placeId: "酒店" }] }, { id: "日二", date: "2026-12-02", stops: [{ placeId: "酒店" }] }], movements: [{ id: "交通", dayId: "日二", originPlaceId: "酒店", destinationPlaceId: "酒店" }], bookingConstraints: [{ id: "约束", title: "软预订", segments: [] }] };
    const context = { ...relationships.bookingRelationshipReviewContext(blueprint), sourceSetDigest: "a".repeat(64),pendingSourceBookingIds:[], sourceIssues: [], sourceCandidates: [], constraints: blueprint.bookingConstraints };
    const saved: any[] = [];
    const ui = host("BookingRelationshipReviewPanel.tsx", "BookingRelationshipReviewPanel", { plan: { id: "计划", version: 1 }, blueprint, busy: false, onSave: async (value: any) => saved.push(value), onError() {}, onClose() {} }, { getBookingRelationshipReview: async () => context });
    await ui.flush(); ui.button("建立关联").props.onClick(); ui.render();
    function change(label: string, value: string) { nodes(ui.label(label)).find((node) => ["textarea", "input", "select"].includes(node.type))!.props.onChange({ target: { value } }); ui.render(); }
    change("关系范围", scope);
    for (let index = 0; index < 20; index++) { const input = ui.all().filter((node) => node.type === "div" && node.props.className === "booking-review-targets").flatMap(nodes).find((node) => node.type === "input" && !node.props.checked); if (!input) break; input.props.onChange({ target: { checked: true } }); ui.render(); }
    change("关联理由", "该预订依赖所列完整集合"); change("关联来源", "旅行者亲自核对的声明"); change("审阅范围", "complete"); change("本项判断理由", "已检查直接间接与跨日依赖"); change("本项来源", "旅行者亲自核对的声明");
    const check = ui.all().filter((node) => node.type === "input" && node.props.type === "checkbox").at(-1)!; assert.equal(check.props.disabled, false); check.props.onChange({ target: { checked: true } }); ui.render();
    change("整体审阅理由", "已逐项核对本次旅行"); change("整体审阅来源", "旅行者亲自核对的声明"); ui.button("单独保存关联审阅").props.onClick(); await ui.flush();
    const relation = saved[0].assessment.units[0].relations[0]; assert.equal(relation.scope, scope); assert.ok(saved[0].assessment.decision.obligations.length);
    if (scope === "occurrence") assert.equal(relation.targets.filter((target: any) => target.dayId === "日一").length, 2);
    if (scope === "place_global") { assert.equal(relation.targets.length, 1); assert.equal(relation.targets[0].kind, "place_global"); }
    if (scope === "dependency") { assert.equal(relation.direction, "booking_depends_on_targets"); assert.ok(relation.targets.some((target: any) => target.dayId === "日二")); assert.ok(relation.targets.some((target: any) => target.kind === "movement")); }
  }
});

test("真实来源恢复先单独选择，失效关联必须明确移除，旧内部来源不进入输入", async () => {
  const blueprint: any = { id: "蓝图", version: 1, sources: [{ id: "旧内部来源", title: "旅行者原预订材料" }], places: [{ id: "地点", name: "合成地点" }], days: [{ id: "日一", date: "2026-12-01", stops: [{ placeId: "地点" }] }], movements: [], bookingConstraints: [{ id: "约束", title: "原预订快照", segments: [] }] };
  const base = relationships.bookingRelationshipReviewContext(blueprint), saved: any[] = [];
  const context: any = { ...base, sourceSetDigest: "a".repeat(64),pendingSourceBookingIds:[], sourceIssues: ["待选来源"], sourceCandidates: [{ bookingId: "合法候选", title: "可选择的真实预订", sourceLabel: "旅行者提供",constraintStrength:"soft", segments: [], status: "pending" }], constraints: blueprint.bookingConstraints, assessment: { units: [{ ...base.units[0], coverage: "complete", rationale: "旧判断", evidenceRefs: ["旧内部来源"], relations: [{ id: "旧内部关系", scope: "occurrence", role: "itinerary_context", targets: [{ kind: "occurrence", dayId: "已移除日期", placeId: "已移除地点" }], operations: ["remove"], rationale: "旧关联", evidenceRefs: ["旧内部来源"] }] }] } };
  const ui = host("BookingRelationshipReviewPanel.tsx", "BookingRelationshipReviewPanel", { plan: { id: "计划", version: 1 }, blueprint, busy: false, onSave: async (value: any) => saved.push(value), onError() {}, onClose() {} }, { getBookingRelationshipReview: async () => context });
  await ui.flush(); assert.ok(text(ui.tree()).includes("A stop or journey in this relationship has changed"));
  for (const input of ui.all().filter((node) => node.type === "input")) assert.equal(String(input.props.value ?? "").includes("旧内部来源"), false);
  const sourceCheckbox = nodes(ui.label("可选择的真实预订")).find((node) => node.type === "input")!; sourceCheckbox.props.onChange({ target: { checked: true } }); ui.render();
  ui.button("保存所选原预订并重新核对").props.onClick(); await ui.flush();
  assert.equal(saved[0].kind, "select_booking_sources"); assert.equal(saved[0].sourceBookingIds.length, 1); assert.equal(saved[0].assessment, undefined); assert.equal(saved[0].resolvedConstraints, undefined);
  ui.button("移除此关联").props.onClick(); ui.render(); assert.equal(ui.button("移除此关联"), undefined); assert.equal(saved.length, 1);
});

test("来源继承缺损入口保留草稿进入正规重新规划，不自动保存或假称来源已恢复",async()=>{
  const blueprint:any={id:"蓝图",version:1,places:[],days:[],movements:[],sources:[],bookingConstraints:[]};
  const context:any={...relationships.bookingRelationshipReviewContext(blueprint),sourceSetDigest:"c".repeat(64),pendingSourceBookingIds:[],sourceIssues:["来源继承记录无法核对"],constraints:[],sourceCandidates:[]};
  let posts=0,replans=0;
  const ui=host("BookingRelationshipReviewPanel.tsx","BookingRelationshipReviewPanel",{plan:{id:"计划",version:1},blueprint,busy:false,onSave:async()=>{posts++;},onError(){},onClose(){},onReplan(){replans++;}},{getBookingRelationshipReview:async()=>context});
  await ui.flush();assert.ok(text(ui.tree()).includes("If the source history cannot be verified"));assert.ok(text(ui.tree()).includes("Your draft and pending edits are kept while planning is unavailable"));
  ui.button("保留此草稿，重新核对并规划").props.onClick();await ui.flush();assert.equal(replans,1);assert.equal(posts,0);assert.equal(ui.button("单独保存关联审阅").props.disabled,true);
});

test("固定来源界面完整并列核对且逐约束逐分段明确绑定，拒绝后保留输入不自动发送",async()=>{
  const segments=[{id:"旧内部段甲",segmentType:"event_window",title:"虚构入场",status:"confirmed",startAtLocal:"2026-12-01T10:00",startTimeZone:"UTC",endAtLocal:"2026-12-01T11:00",endTimeZone:"UTC",origin:"虚构出发处",destination:"虚构到达处",location:"虚构场馆",constraintStrength:"hard",fixedCommitment:true,needsReviewReasons:["核对虚构材料"]},{id:"旧内部段乙",segmentType:"event_window",title:"虚构已取消分段",status:"cancelled",constraintStrength:"ignored",fixedCommitment:false,needsReviewReasons:[]}];
  const original={id:"旧内部约束",type:"ticket",title:"虚构固定预订",status:"confirmed",constraintStrength:"hard",sourceLabel:"历史保存资料",segments};
  const candidate={bookingId:"真实内部源",type:"ticket",title:"虚构固定预订",status:"confirmed",constraintStrength:"hard",sourceLabel:"旅行者原始材料",segments:segments.map((segment,index)=>({...segment,id:`投影内部段${index}`,sourceSegmentId:`真实内部段${index}`})),ownership:"plan",recordDigest:"a".repeat(64),sourceDigest:"b".repeat(64)};
  const blueprint:any={id:"蓝图",version:1,places:[],days:[],movements:[],sources:[],bookingConstraints:[original]};
  const context:any={...relationships.bookingRelationshipReviewContext(blueprint),sourceSetDigest:"c".repeat(64),pendingSourceBookingIds:[candidate.bookingId],sourceIssues:["旧固定资料尚未明确来源"],constraints:[original],sourceCandidates:[candidate]};
  const saved:any[]=[];let reject=true;
  const ui=host("BookingRelationshipReviewPanel.tsx","BookingRelationshipReviewPanel",{plan:{id:"计划",version:1},blueprint,busy:false,onSave:async(value:any)=>{saved.push(structuredClone(value));if(reject)throw new apiClient.ApiRequestError("原始异常不可展示",409,"assisted_replanning_required");},onError(){},onClose(){}},{getBookingRelationshipReview:async()=>context});
  await ui.flush();
  for(const label of ["预订类型","保存状态","预订整体约束","分段类型","分段状态","开始当地时间","结束当地时间","出发位置","到达位置","场所或住宿位置","分段约束","固定承诺","已记录的复核原因","虚构已取消分段"])assert.ok(text(ui.tree()).includes(label),label);
  for(const internal of ["旧内部约束","旧内部段甲","真实内部源","真实内部段0"])assert.equal(text(ui.tree()).includes(internal),false);
  const control=(label:string)=>nodes(ui.label(label)).find(node=>["select","input","textarea"].includes(node.type))!;
  assert.equal(control("为「虚构固定预订」选择真实预订").props.value,"");assert.equal(ui.button("保存所选原预订并重新核对").props.disabled,true);
  function change(label:string,value:string){control(label).props.onChange({target:{value}});ui.render();}
  change("为「虚构固定预订」选择真实预订",candidate.bookingId);assert.equal(control("为原分段 1").props.value,"");
  change("为原分段 1","真实内部段0");change("为原分段 2","真实内部段0");change("为何认定「虚构固定预订」","本人逐项核对全部固定与取消分段");change("「虚构固定预订」的对应依据","旅行者本人的材料核对声明");assert.equal(ui.button("保存所选原预订并重新核对").props.disabled,true);
  change("为原分段 2","真实内部段1");assert.equal(ui.button("保存所选原预订并重新核对").props.disabled,false);
  ui.button("保存所选原预订并重新核对").props.onClick();await ui.flush();assert.equal(saved.length,1);assert.equal(control("为何认定「虚构固定预订」").props.value,"本人逐项核对全部固定与取消分段");
  reject=false;ui.button("保存所选原预订并重新核对").props.onClick();await ui.flush();assert.equal(saved.length,2);assert.deepEqual(saved[0],saved[1]);assert.equal(saved[0].legacyBindings[0].bookingConstraintId,original.id);assert.equal(saved[0].legacyBindings[0].segments[1].sourceSegmentId,"真实内部段1");assert.equal(saved[0].sourceSelectionDecision,undefined);assert.equal(saved[0].assessment,undefined);
});
