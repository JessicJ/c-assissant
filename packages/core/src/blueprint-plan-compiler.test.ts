import {bookingTaskRequirementId} from "./booking-relationship.js";
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

import { blueprintPlanCompilationIdentity, resolveBlueprintPlanCompilationIdentity, compileTripBlueprint, type BlueprintPlanCompilerInput, type BlueprintPlanCompilation } from "./blueprint-plan-compiler.js";
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type TripBlueprint } from "./trip-blueprint.js";

const blueprint = (): TripBlueprint => ({
  schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: "blueprint-1", version: 1, generationKey: "generation-1",
  proposalRef: { sessionId: "session-1", proposalVersion: 1 }, skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, researchSetId: "research-1",
  title: "Tokyo", summary: "Tokyo", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-01",
  places: [{ id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred", whyWorthIt: "A matters", plan: "Visit A", evidence: [] }],
  events: [], sources: [],
  days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: [] }], movements: [],
  actionRequirements: [
    { id: "visa", kind: "travel_authorization", title: "Review visa guidance", description: "Use official evidence", accountableParty: "traveler", completionCondition: "Guidance reviewed", evidence: [] },
    { id: "booking", kind: "reservation", title: "Choose museum slot", description: "Choose a slot before payment", accountableParty: "traveler", completionCondition: "Slot selected", placeId: "a", evidence: [] }
  ], createdAt: "2026-08-26T00:00:00.000Z"
});

test("规范创建身份核对真实旧compiler夹具，未知版本失败关闭",()=>{
  const historical=JSON.parse(readFileSync(new URL("../../storage/test-fixtures/blueprint-compiler-v2.json",import.meta.url),"utf8")) as {cases:Array<{blueprint:TripBlueprint;compilation:BlueprintPlanCompilation}>};
  for(const entry of historical.cases) assert.deepEqual(blueprintPlanCompilationIdentity(entry.blueprint.id,entry.blueprint.version,entry.compilation.lineage.compilerVersion),{planId:entry.compilation.plan.id,compilationKey:entry.compilation.lineage.compilationKey});
  assert.deepEqual(blueprintPlanCompilationIdentity('fixture-blueprint',1,'2.0.0'),{planId:'plan-mql131',compilationKey:'fixture-blueprint:1:2.0.0'});
  for(const version of ['','2.9.0','prefix:2.0.0']) assert.throws(()=>blueprintPlanCompilationIdentity('fixture-blueprint',1,version));
  for(const version of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>blueprintPlanCompilationIdentity('fixture-blueprint',version,'2.1.0'));
});

test("创建身份解析保留真实旧版本，当前投影版本不能替代出生版本",()=>{
  const historical=JSON.parse(readFileSync(new URL("../../storage/test-fixtures/blueprint-compiler-v2.json",import.meta.url),"utf8")) as {cases:Array<{blueprint:TripBlueprint;compilation:BlueprintPlanCompilation}>};
  for(const entry of historical.cases) {
    const result=resolveBlueprintPlanCompilationIdentity(entry.blueprint.id,entry.blueprint.version,entry.compilation.plan.id);
    assert.equal(result?.compilerVersion,"2.0.0");
    assert.equal(result?.compilationKey,entry.compilation.lineage.compilationKey);
    assert.equal(resolveBlueprintPlanCompilationIdentity(entry.blueprint.id,entry.blueprint.version+1,entry.compilation.plan.id),undefined);
  }
  const current=compileTripBlueprint(blueprint(),{createdAt:blueprint().createdAt});
  assert.equal(resolveBlueprintPlanCompilationIdentity(blueprint().id,1,current.plan.id)?.compilerVersion,"2.1.0");
  assert.equal(resolveBlueprintPlanCompilationIdentity(blueprint().id,1,"虚构未知计划"),undefined);
});

test("Blueprint Plan Compiler is deterministic and does not embed travel presentation", () => {
  const first = compileTripBlueprint(blueprint(), { createdAt: "2026-08-26T01:00:00.000Z" });
  const second = compileTripBlueprint(blueprint(), { createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(first, second);
  assert.equal(first.plan.presentation, undefined);
  assert.equal(first.plan.stages.length, 2);
  assert.equal(first.lineage.blueprintId, "blueprint-1");
  const visible = [first.plan.nextAction, ...first.plan.knownInformation, ...first.plan.assumptions, ...first.plan.stages.map(s=>s.description)].join('\n');
  assert.doesNotMatch(visible,/Trip Blueprint:|Place Catalog:|accountable decision|execution work|applicability and evidence/);
  assert.match(first.plan.nextAction,/your itinerary and preparations/);
});

test("Blueprint Plan Compiler carries completion by Requirement Identity", () => {
  const result = compileTripBlueprint(blueprint(), { createdAt: "2026-08-26T01:00:00.000Z", completedRequirementIds: ["visa"] });
  const tasks = result.plan.stages.flatMap((stage) => stage.tasks);
  assert.equal(tasks.find((task) => task.requirementId === "visa")?.status, "completed");
  assert.equal(tasks.find((task) => task.requirementId === "booking")?.status, "waiting_user");
});

test("Blueprint Plan Compiler emits only non-empty fixed modules", () => {
  const value = blueprint();
  value.actionRequirements = [];
  const result = compileTripBlueprint(value, { createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(result.plan.stages, []);
});

test("编译器不从行程名称或季节推断整理行李任务", () => {
  const value=blueprint();value.actionRequirements=[];value.summary="rain bath temple walking rail passport";
  value.preparationChecklist=[{id:"p",title:"准备雨具",completionCondition:"已准备",group:"packing",evidence:[]}];
  value.travelTips=[{id:"t",title:"雨具",body:"雨天出行建议",context:"雨天",theme:"weather",evidence:[]}];
  const result=compileTripBlueprint(value,{createdAt:"2026-08-26T01:00:00Z"});assert.deepEqual(result.plan.stages,[]);
});

test("Blueprint Plan Compiler carries booking constraints into Plan details", () => {
  const value = blueprint();
  value.actionRequirements = [];
  value.bookingConstraints = [{
    id: "booking-hotel",
    type: "accommodation",
    title: "Shinjuku Hotel",
    status: "confirmed",
    sourceLabel: "Hotel confirmation email",
    importedAt: "2026-08-27T00:00:00.000Z",
    constraintStrength: "hard",
    segments: [{
      id: "stay",
      segmentType: "hotel_stay",
      title: "Hotel stay",
      startAtLocal: "2026-09-01T15:00",
      startTimeZone: "Asia/Tokyo",
      endAtLocal: "2026-09-02T11:00",
      endTimeZone: "Asia/Tokyo",
      location: "Shinjuku, Tokyo",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  }];
  const result = compileTripBlueprint(value, { createdAt: "2026-08-26T01:00:00.000Z" });
  assert.equal(result.plan.configuration.accommodation.status, "confirmed");
  assert.equal(result.plan.configuration.accommodation.location, "Shinjuku, Tokyo");
  assert.ok(result.plan.knownInformation.some((item) => item.includes("Confirmed accommodation")));
  const bookingTasks = result.plan.stages.flatMap((stage) => stage.tasks).filter((task) => task.requirementId?.startsWith("booking:"));
  assert.equal(bookingTasks.length, 1);
  assert.equal(bookingTasks[0]?.preparationCategory, "booking");
  assert.equal(bookingTasks[0]?.reminder?.timeZone, "Asia/Tokyo");
});

test("无有效责任人与行动类型的要求不能编译执行工作",()=>{
  const missingOwner=blueprint();Object.assign(missingOwner.actionRequirements[0]!,{accountableParty:undefined});
  assert.throws(()=>compileTripBlueprint(missingOwner,{createdAt:"2026-08-26T01:00:00Z"}),/有效行动责任人/);
  const missingKind=blueprint();Object.assign(missingKind.actionRequirements[0]!,{kind:"tip"});
  assert.throws(()=>compileTripBlueprint(missingKind,{createdAt:"2026-08-26T01:00:00Z"}),/有效行动类型/);
});

test("编译保留结构化预订完成状态且不重新安排提醒",()=>{
 const value=blueprint();value.bookingConstraints=[{id:"flight",type:"flight",title:"虚构航班",status:"confirmed",sourceLabel:"旅客确认",importedAt:"2026-08-26T00:00:00Z",constraintStrength:"hard",segments:[{id:"outbound",segmentType:"flight_leg",title:"去程",startAtLocal:"2026-09-01T09:00",startTimeZone:"Asia/Tokyo",origin:"东京",destination:"大阪",constraintStrength:"hard",fixedCommitment:true,needsReviewReasons:[]}]}];
 const requirementId=bookingTaskRequirementId(value.bookingConstraints![0]!,"outbound");
 const compiled=compileTripBlueprint(value,{createdAt:"2026-08-26T01:00:00Z",completedRequirementIds:[requirementId]});
 const task=compiled.plan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId===requirementId)!;
 assert.equal(task.status,"completed");assert.equal(task.reminder,undefined);
});

test("真实旧2.0产物仅在完整身份与任务规范证据一致时继承完成",()=>{
  const fixture=JSON.parse(readFileSync(new URL("../../storage/test-fixtures/blueprint-compiler-v2.json",import.meta.url),"utf8")) as {cases:Array<{blueprint:TripBlueprint;compilation:BlueprintPlanCompilation}>};
  type Previous=NonNullable<BlueprintPlanCompilerInput['previousCompilation']>;
  const mutations:Array<[string,(previous:Previous,next:TripBlueprint)=>void]>=[
    ["编译键",p=>{p.lineage.compilationKey+="篡改";}],
    ["计划身份",p=>{p.plan.id+="篡改";}],
    ["蓝图身份",p=>{p.lineage.blueprintId+="篡改";}],
    ["蓝图版本",p=>{p.lineage.blueprintVersion+=1;}],
    ["创建事实",p=>{p.plan.createdAt="2026-01-01T00:00:00Z";}],
    ["低于编译版本",p=>{p.plan.version=0;}],
    ["任务标题",p=>{p.plan.stages[0]!.tasks[0]!.title+="改变";}],
    ["任务描述",p=>{p.plan.stages[0]!.tasks[0]!.description="不同履行条件";}],
    ["责任方",p=>{p.plan.stages[0]!.tasks[0]!.owner="assistant";}],
    ["到期条件",p=>{p.plan.stages[0]!.tasks[0]!.dueLabel="不同时间";}],
    ["新增履行触发",p=>{Object.assign(p.plan.stages[0]!.tasks[0]!,{activationTrigger:{kind:"不同触发"}});}],
    ["重复任务",p=>{p.plan.stages[0]!.tasks.push(structuredClone(p.plan.stages[0]!.tasks[0]!));}],
    ["重复履行身份",p=>{p.plan.stages[0]!.tasks.push({...structuredClone(p.plan.stages[0]!.tasks[0]!),id:"另一任务"});}],
    ["源时间",(_p,n)=>{n.bookingConstraints![0]!.segments[0]!.startAtLocal="2026-12-01T11:00";}],
    ["源地点",(_p,n)=>{n.bookingConstraints![0]!.segments[0]!.location="另一个地点";}],
    ["源身份",(_p,n)=>{n.bookingConstraints![0]!.sourceBookingId="另一个真实来源";}],
    ["源强度",(_p,n)=>{n.bookingConstraints![0]!.segments[0]!.constraintStrength="hard";}],
    ["取消分段",(_p,n)=>{n.bookingConstraints![0]!.segments[0]!.status="cancelled";}]
  ];
  for(const entry of fixture.cases){
    const original:Previous={blueprint:structuredClone(entry.blueprint),...structuredClone(entry.compilation)};
    original.plan.version=2;original.plan.stages[0]!.tasks[0]!.status="completed";
    const next=structuredClone(entry.blueprint);next.version+=1;
    const compile=(previous:Previous,current:TripBlueprint)=>compileTripBlueprint(current,{createdAt:"2026-11-16T00:00:00Z",previousCompilation:previous}).plan.stages.flatMap(stage=>stage.tasks);
    assert.equal(compile(original,next)[0]?.status,"completed");
    for(const [label,mutate] of mutations){const previous=structuredClone(original),current=structuredClone(next);mutate(previous,current);assert.equal(compile(previous,current).some(task=>task.status==='completed'),false,label);assert.equal(original.plan.stages[0]!.tasks[0]!.status,"completed");}
    assert.equal(compileTripBlueprint(next,{createdAt:"2026-11-16T00:00:00Z"}).plan.stages[0]?.tasks[0]?.status,"waiting_user");
  }
});


test("当前编译拒绝历史版本标签，历史身份仍只读可解析",()=>{
  const historical=JSON.parse(readFileSync(new URL("../../storage/test-fixtures/blueprint-compiler-v2.json",import.meta.url),"utf8")) as {cases:Array<{blueprint:TripBlueprint;compilation:BlueprintPlanCompilation}>};
  for(const entry of historical.cases) {
    const snapshot=structuredClone(entry);
    assert.throws(()=>compileTripBlueprint(entry.blueprint,{createdAt:entry.blueprint.createdAt,compilerVersion:"2.0.0"}),/当前编译器版本/);
    assert.equal(resolveBlueprintPlanCompilationIdentity(entry.blueprint.id,entry.blueprint.version,entry.compilation.plan.id)?.compilerVersion,"2.0.0");
    const current=compileTripBlueprint(entry.blueprint,{createdAt:entry.blueprint.createdAt,compilerVersion:"2.1.0"});
    assert.equal(current.lineage.compilerVersion,"2.1.0");
    assert.ok(current.plan.stages.flatMap(stage=>stage.tasks).some(task=>task.requirementId?.split(":").length===4));
    assert.deepEqual(entry,snapshot);
  }
});
