import assert from "node:assert/strict";
import test from "node:test";
import type { TripBlueprint } from "@c-assistant/core";
import { bookingRelationshipImpact, bookingRelationshipReviewContext, bookingRelationshipSourceUnits, stampReviewedBookingRelationshipAssessment, type BookingRelationshipSourceContext } from "@c-assistant/core/booking-relationship";
import { checkedBlueprintImpact, checkedBookingImpact } from "./blueprint-impact-review.js";

const plan={id:"当前计划",version:4};
const edits=[{kind:"remove_place_from_day",placeId:"place",dayId:"day"}];
function fixture() {
  const blueprint={id:"blueprint",version:3,days:[{id:"day",date:"2026-12-01",stops:[{placeId:"place",order:1}]}],places:[{id:"place",evidence:[]}],movements:[],actionRequirements:[],bookingConstraints:[{id:"booking",sourceBookingId:"source",type:"ticket",title:"示例场次",status:"pending",constraintStrength:"soft",segments:[{id:"segment",sourceSegmentId:"source-segment",title:"场次",segmentType:"event_window",status:"pending",constraintStrength:"soft",fixedCommitment:false,needsReviewReasons:[]}]}]} as unknown as TripBlueprint;
  const context:BookingRelationshipSourceContext={planId:plan.id,planVersion:plan.version,blueprintId:blueprint.id,blueprintVersion:blueprint.version,sourceSetDigest:"a".repeat(64),adoptedUnits:bookingRelationshipSourceUnits(blueprint.bookingConstraints!),pendingSources:[],resolutionIssues:[]};
  return {blueprint,context};
}
function reviewed(blueprint:TripBlueprint) {
  const review=bookingRelationshipReviewContext(blueprint);
  blueprint.bookingRelationshipAssessment=stampReviewedBookingRelationshipAssessment(blueprint,{schemaVersion:1,blueprintId:blueprint.id,blueprintVersion:blueprint.version,universeDigest:review.universeDigest,status:"reviewed",units:review.units.map(unit=>({...unit,coverage:"complete",relations:[{id:"relation",scope:"occurrence",targets:[{kind:"occurrence",dayId:"day",placeId:"place"}],role:"itinerary_context",operations:["remove","priority"],rationale:"旅客明确关联",evidenceRefs:["traveler-declaration:fixture"]}],rationale:"核对完整直接间接跨日范围",evidenceRefs:["traveler-declaration:fixture"]})),decision:{source:"traveler",actorId:"local-traveler",decidedAt:"2026-11-16T00:00:00Z",rationale:"旅客明确全量核对",evidenceRefs:["traveler-declaration:fixture"],obligations:["核对直接、间接与跨日依赖"]}});
}
function preview(blueprint:TripBlueprint,context:BookingRelationshipSourceContext) {
  const bookingImpact=bookingRelationshipImpact(blueprint,edits,context);
  return {id:"review-token",blueprintId:blueprint.id,blueprintVersion:blueprint.version,sourceContext:context,dayIds:["day"],dates:["2026-12-01"],placeIds:["place"],movementIds:[],reminderRequirementIds:[],bookingConstraintIds:[...new Set(bookingImpact.affected.map(unit=>unit.bookingConstraintId))],bookingImpact,evidence:[],nextActions:bookingImpact.canConfirm?["confirm_removal","cancel"]:["review_booking_relationships","cancel"]};
}
test("真实入口拒绝缺失来源上下文，离线快照计算仍可用",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);
  const value=preview(blueprint,context);
  assert.ok(checkedBlueprintImpact(value,blueprint,plan,edits));
  const {sourceContext:omitted,...missing}=value;
  assert.equal(checkedBlueprintImpact(missing,blueprint,plan,edits),null);
  assert.ok(checkedBookingImpact(bookingRelationshipImpact(blueprint,edits),blueprint));
});
test("真实入口拒绝错Plan与Blueprint身份及缺失Plan",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);const value=preview(blueprint,context);
  for(const patch of [{planId:"other"},{planVersion:5},{blueprintId:"other"},{blueprintVersion:2}]) assert.equal(checkedBlueprintImpact({...value,sourceContext:{...context,...patch}},blueprint,plan,edits),null);
  assert.equal(checkedBlueprintImpact(value,blueprint,undefined,edits),null);
});
test("真实入口拒绝遗漏pending或resolution覆盖",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);
  context.pendingSources=[{sourceBookingId:"pending",sourceDigest:"b".repeat(64)}];context.resolutionIssues=[{code:"unverified_ancestor"}];
  const value=preview(blueprint,context);assert.ok(checkedBlueprintImpact(value,blueprint,plan,edits));
  for(const kind of ["source_obligation","source_resolution"]) assert.equal(checkedBlueprintImpact({...value,bookingImpact:{...value.bookingImpact,unknown:value.bookingImpact.unknown.filter(unit=>unit.kind!==kind)}},blueprint,plan,edits),null);
});
test("真实入口拒绝遗漏已采用未知单元及伪造可确认",()=>{
  const {blueprint,context}=fixture();const value=preview(blueprint,context);assert.equal(value.bookingImpact.unknown.length,1);
  assert.ok(checkedBlueprintImpact(value,blueprint,plan,edits));
  assert.equal(checkedBlueprintImpact({...value,bookingImpact:{...value.bookingImpact,unknown:[],canConfirm:true},nextActions:["confirm_removal","cancel"]},blueprint,plan,edits),null);
});
test("真实入口拒绝删去已知影响并同步清空约束摘要",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);const value=preview(blueprint,context);assert.equal(value.bookingImpact.affected.length,1);
  assert.equal(checkedBlueprintImpact({...value,bookingConstraintIds:[],bookingImpact:{...value.bookingImpact,affected:[]}},blueprint,plan,edits),null);
});
test("真实入口拒绝改写assessment摘要及重复影响单元",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);const value=preview(blueprint,context);
  for(const bookingImpact of [{...value.bookingImpact,assessmentDigest:"f".repeat(64)},{...value.bookingImpact,affected:[...value.bookingImpact.affected,...value.bookingImpact.affected]}]) assert.equal(checkedBlueprintImpact({...value,bookingImpact},blueprint,plan,edits),null);
});

test("真实入口核对已知不受影响单元，不能遗漏或换成已知影响",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);blueprint.bookingRelationshipAssessment!.units[0]!.relations=[];
  const value=preview(blueprint,context);assert.equal(value.bookingImpact.unaffected.length,1);assert.ok(checkedBlueprintImpact(value,blueprint,plan,edits));
  assert.equal(checkedBlueprintImpact({...value,bookingImpact:{...value.bookingImpact,unaffected:[]}},blueprint,plan,edits),null);
  assert.equal(checkedBlueprintImpact({...value,bookingConstraintIds:["booking"],bookingImpact:{...value.bookingImpact,affected:value.bookingImpact.unaffected,unaffected:[]}},blueprint,plan,edits),null);
});
test("混合原批次只用实际地点编辑重算关系，内容修改不制造关系命中",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);const value=preview(blueprint,context);
  assert.ok(checkedBlueprintImpact(value,blueprint,plan,[{kind:"set_tip_pinned"},...edits,{kind:"set_preparation_completed"}]));
  assert.equal(checkedBlueprintImpact(value,blueprint,plan,[{kind:"update_place_priority",placeId:"other"}]),null);
});
test("规范投影比较遇到不可序列化数据拒绝而不抛异常",()=>{
  const {blueprint,context}=fixture();reviewed(blueprint);const value=preview(blueprint,context);
  const cyclic:Record<string,unknown>={};cyclic.self=cyclic;
  for(const extra of [1n,cyclic]) assert.equal(checkedBlueprintImpact({...value,bookingImpact:{...value.bookingImpact,extra}},blueprint,plan,edits),null);
});


for(const scope of ['pending','resolution','mixed'] as const) for(const boundary of ['helper','runtime'] as const) {
  test('合法'+scope+'上下文的'+boundary+'入口遇JSON畸形unknown返回null且不抛异常',()=>{
    const {blueprint,context}=fixture();reviewed(blueprint);
    if(scope!=='resolution')context.pendingSources=[{sourceBookingId:'pending-source',sourceDigest:'b'.repeat(64)}];
    if(scope!=='pending')context.resolutionIssues=[{code:'unverified_ancestor'}];
    const value=JSON.parse(JSON.stringify(preview(blueprint,context)));
    const accepted=checkedBlueprintImpact(value,blueprint,plan,edits);assert.ok(accepted);assert.equal(accepted.bookingImpact.canConfirm,false);assert.equal(accepted.bookingImpact.unknown.length,scope==='mixed'?2:1);
    for(const unknown of [[null],[null,...value.bookingImpact.unknown],[...value.bookingImpact.unknown,null],[0],[false],['错误类型'],[{}],null,0,false,'错误类型',{}]) {
      const damaged=JSON.parse(JSON.stringify({...value,bookingImpact:{...value.bookingImpact,unknown}}));
      const actual=boundary==='helper'?checkedBookingImpact(damaged.bookingImpact,blueprint,context):checkedBlueprintImpact(damaged,blueprint,plan,edits);
      assert.equal(actual,null,'畸形JSON不得抛错，必须失败关闭');
    }
  });
}
