import assert from "node:assert/strict";
import test from "node:test";
import {validateBookingSourceSelection,parseBookingSourceLegacyBindings,type BookingSourceLegacyBinding,type BookingSourceSelectionDecision} from "./booking-source-selection.js";
import {workspaceMutationDigestInput,WorkspaceMutationError} from "./workspace-mutation-error.js";
import type {BlueprintBookingConstraint} from "./trip-blueprint.js";

const decision:BookingSourceSelectionDecision={source:"traveler",actorId:"local-traveler",decidedAt:"2026-11-16T00:00:00Z"};
function fixture(){
  const old:BlueprintBookingConstraint={id:"旧约束",type:"ticket",title:"原固定承诺",status:"confirmed",sourceLabel:"旧声明",importedAt:decision.decidedAt,constraintStrength:"hard",segments:[
    {id:"旧固定段",segmentType:"event_window",title:"固定场次",startAtLocal:"2026-12-01T10:00",startTimeZone:"Asia/Shanghai",endAtLocal:"2026-12-01T11:00",endTimeZone:"Asia/Shanghai",location:"合成场馆",constraintStrength:"hard",fixedCommitment:true,needsReviewReasons:[]},
    {id:"旧软段",segmentType:"other",title:"辅助安排",status:"pending",constraintStrength:"soft",fixedCommitment:false,needsReviewReasons:["仍待核对"]},
    {id:"旧取消段",segmentType:"other",title:"保留历史",status:"cancelled",constraintStrength:"ignored",fixedCommitment:false,needsReviewReasons:[]}
  ]};
  const source:BlueprintBookingConstraint={...structuredClone(old),id:"新投影",sourceBookingId:"真实来源",sourceLabel:"新资料展示",importedAt:"2026-11-16T01:00:00Z",segments:old.segments.map((segment,index)=>({...structuredClone(segment),id:"新段"+index,sourceSegmentId:"真实段"+index,status:segment.status??old.status}))};
  const binding:BookingSourceLegacyBinding={bookingConstraintId:old.id,sourceBookingId:source.sourceBookingId!,segments:old.segments.map((segment,index)=>({segmentId:segment.id,sourceSegmentId:source.segments[index]!.sourceSegmentId!})),rationale:"旅行者逐段核对并明确选择此来源",evidenceRefs:["traveler-declaration:明确来源选择"]};
  return {old,source,binding};
}
const assisted=(error:unknown)=>error instanceof WorkspaceMutationError&&error.code==='assisted_replanning_required';
const invalid=(error:unknown)=>error instanceof WorkspaceMutationError&&error.code==='invalid_edit';

test("固定旧来源完整显式等价绑定可恢复，缺status仅用旧booking保护基准且不改历史",()=>{
  const {old,source,binding}=fixture(),before=structuredClone(old);
  const audit=validateBookingSourceSelection([old],[source],[binding],decision);
  assert.deepEqual(old,before);assert.equal(old.segments[0]!.status,undefined);assert.equal(source.segments[0]!.status,"confirmed");
  assert.deepEqual(audit.legacyBindings,[binding]);assert.deepEqual(audit.decision,decision);assert.equal(audit.legacySegmentStatusRule,"booking_status_protection_baseline");
  const reversed={...source,segments:[...source.segments].reverse()};assert.doesNotThrow(()=>validateBookingSourceSelection([old],[reversed],[binding],decision));
});

test("固定来源逐语义字段差异均需辅助重规划，来源展示元数据不承担身份判断",()=>{
  const mutations:Array<(value:BlueprintBookingConstraint)=>void>=[
    value=>{value.title="同名不能代替身份";},value=>{value.type="event";},value=>{value.status="pending";},value=>{value.constraintStrength="soft";},
    value=>{value.segments[0]!.title="另一履行条件";},value=>{value.segments[0]!.segmentType="other";},value=>{value.segments[0]!.status="cancelled";},
    value=>{value.segments[0]!.startAtLocal="2026-12-01T12:00";},value=>{value.segments[0]!.endAtLocal="2026-12-01T13:00";},value=>{value.segments[0]!.startTimeZone="Asia/Tokyo";},value=>{value.segments[0]!.endTimeZone="Asia/Tokyo";},
    value=>{value.segments[0]!.origin="不同起点";},value=>{value.segments[0]!.destination="不同终点";},value=>{value.segments[0]!.location="另一个地点";},value=>{value.segments[0]!.constraintStrength="soft";},value=>{value.segments[0]!.fixedCommitment=false;},value=>{value.segments[0]!.needsReviewReasons=["不同复核责任"];},
    value=>{delete value.segments[0]!.startTimeZone;},value=>{value.segments.pop();},value=>{value.segments.push({...structuredClone(value.segments[0]!),id:"新增段",sourceSegmentId:"新增真实段"});}
  ];
  for(const mutate of mutations){const {old,source,binding}=fixture();mutate(source);assert.throws(()=>validateBookingSourceSelection([old],[source],[binding],decision),assisted);}
  const {old,source,binding}=fixture();source.segments[0]!.status="pending";assert.throws(()=>validateBookingSourceSelection([old],[source],[binding],decision),assisted);
});

test("固定聚合不可漏软段取消段、重复真实分段、混父来源或合并预订",()=>{
  for(const mutate of [(binding:BookingSourceLegacyBinding)=>{binding.segments.splice(1,1);},(binding:BookingSourceLegacyBinding)=>{binding.segments[1]!.sourceSegmentId=binding.segments[0]!.sourceSegmentId;},(binding:BookingSourceLegacyBinding)=>{binding.segments[0]!.sourceSegmentId="其他预订的分段";}]){const {old,source,binding}=fixture();mutate(binding);assert.throws(()=>validateBookingSourceSelection([old],[source],[binding],decision),assisted);}
  const {old,source,binding}=fixture();assert.throws(()=>validateBookingSourceSelection([old],[source],[],decision),assisted);
  const second={...structuredClone(old),id:"第二旧约束"};assert.throws(()=>validateBookingSourceSelection([old,second],[source],[binding,{...structuredClone(binding),bookingConstraintId:second.id}],decision),assisted);
  const bound={...structuredClone(old),sourceBookingId:"真实来源",segments:old.segments.map((segment,index)=>({...segment,sourceSegmentId:"真实段"+index}))};
  assert.doesNotThrow(()=>validateBookingSourceSelection([bound],[source],[],decision));source.constraintStrength="soft";assert.throws(()=>validateBookingSourceSelection([bound],[source],[],decision),assisted);
});

test("无分段hard完整绑定可恢复，不能以有分段源替代；普通bound漏选仍无效",()=>{
  const {old,source,binding}=fixture();old.segments=[];source.segments=[];binding.segments=[];
  assert.doesNotThrow(()=>validateBookingSourceSelection([old],[source],[binding],decision));
  source.segments=fixture().source.segments;assert.throws(()=>validateBookingSourceSelection([old],[source],[binding],decision),assisted);
  const soft={...fixture().old,constraintStrength:"soft" as const,segments:[],sourceBookingId:"已采用来源"};assert.throws(()=>validateBookingSourceSelection([soft],[source],[],decision),invalid);
  assert.doesNotThrow(()=>validateBookingSourceSelection([],[source],[],decision));
});

test("来源绑定坏结构及自述责任typed拒绝，规范请求摘要绑定全部对应与理由",()=>{
  for(const value of [null,{},[null],[{...fixture().binding,evidenceRefs:[]}],[{...fixture().binding,segments:[null]}],[{...fixture().binding,extra:"未知字段"}]])assert.throws(()=>parseBookingSourceLegacyBindings(value),invalid);
  const {old,source,binding}=fixture();assert.throws(()=>validateBookingSourceSelection([old],[source],[binding],undefined),invalid);assert.throws(()=>validateBookingSourceSelection([old],[source],[binding],{...decision,actorId:"自述Agent"}),invalid);
  const body={expectedVersion:1,expectedBlueprintVersion:1,revisions:[{kind:"select_booking_sources",sourceBookingIds:["真实来源"],expectedSourceSetDigest:"已冻结集合",legacyBindings:[binding]}]};
  const original=workspaceMutationDigestInput("save","计划",body);const changed=structuredClone(body);changed.revisions[0]!.legacyBindings[0]!.rationale="不同声明";assert.notEqual(workspaceMutationDigestInput("save","计划",changed),original);
  changed.revisions[0]!.legacyBindings[0]!.segments[0]!.sourceSegmentId="另一分段";assert.notEqual(workspaceMutationDigestInput("save","计划",changed),original);
});
