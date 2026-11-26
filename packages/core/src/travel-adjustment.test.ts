import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTravelAdjustmentReplacement, travelAdjustmentEventIdentityBlocker, type TravelAdjustmentObservation, type TravelAdjustmentCandidate } from './travel-adjustment.js';
import {applyDirectBlueprintRevisionBatchWithMetadata} from './blueprint-revision.js';
import {bookingRelationshipReviewContext,type BookingRelationshipAssessment} from './booking-relationship.js';
import { TRIP_BLUEPRINT_SCHEMA_VERSION, type TripBlueprint } from './trip-blueprint.js';
function blueprint():TripBlueprint {
  return {schemaVersion:TRIP_BLUEPRINT_SCHEMA_VERSION,id:'虚构蓝图',version:1,generationKey:'虚构生成',proposalRef:{sessionId:'虚构会话',proposalVersion:1},skillLineage:{skillId:'interactive-trip-planner',skillVersion:'0.2.0'},researchSetId:'虚构研究',title:'虚构旅行',summary:'完整安排',language:'en',destinations:['Tokyo'],startDate:'2026-11-17',endDate:'2026-11-17',places:['a','b'].map(id=>({id,name:id,city:'Tokyo',locationLabel:'Tokyo',category:'sight',durationMinutes:30,priority:'preferred',coordinates:[35.68,139.76],whyWorthIt:'虚构测试',plan:'游览',evidence:[]})),events:[],sources:[],days:[{id:'d',date:'2026-11-17',city:'Tokyo',kind:'scheduled',title:'虚构日程',summary:'逐段安排',stops:[{placeId:'a',order:1,time:'09:00'},{placeId:'b',order:2,time:'10:00'}],candidatePlaceIds:[]}],movements:[{id:'m',dayId:'d',originPlaceId:'a',destinationPlaceId:'b',mode:'walking',status:'verified',durationMinutes:20,label:'步行',detail:'虚构核实路线',evidence:[]}],actionRequirements:[],createdAt:'2026-11-17T00:00:00Z'};
}
test('完整替代复用交通邻接并拒绝缺时区、未核路线与时刻冲突',()=>{
  const base=blueprint(),next={...structuredClone(base),version:2};assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}));
  assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{}),/时区/);
  const unverified=structuredClone(next);unverified.movements[0]!.status='recheck';assert.throws(()=>assertTravelAdjustmentReplacement(base,unverified,{Tokyo:'Asia/Tokyo'}),/交通|路线/);
  const conflict=structuredClone(next);conflict.days[0]!.stops[1]!.time='08:30';assert.throws(()=>assertTravelAdjustmentReplacement(base,conflict,{Tokyo:'Asia/Tokyo'}),/时间/);
  const window=structuredClone(next);window.movements[0]!.durationMinutes=90;assert.throws(()=>assertTravelAdjustmentReplacement(base,window,{Tokyo:'Asia/Tokyo'}),/交通窗口|交通/);
  const unrelated=structuredClone(next);unrelated.id='无关旅行';assert.throws(()=>assertTravelAdjustmentReplacement(base,unrelated,{Tokyo:'Asia/Tokyo'}),/同一/);
});

test('活动占时与交通合并核验，无时刻安排保留人工编辑但拒绝自动完整声明',()=>{
 const base=blueprint(),next=structuredClone(base);next.version++;
 next.places[0]!.durationMinutes=90;
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/重叠|交通/);
 next.places[0]!.durationMinutes=50;
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/交通/);
 next.places[0]!.durationMinutes=30;
 assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}));
 next.days[0]!.blocks=[{id:'a',kind:'stop',order:1,placeId:'a',startTime:'09:00',endTime:'09:50',evidence:[]},{id:'b',kind:'stop',order:2,placeId:'b',startTime:'10:00',endTime:'11:00',evidence:[]}];
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/交通/);
 next.days[0]!.blocks![0]!.endTime='09:30';assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}));
 delete next.days[0]!.blocks;delete next.days[0]!.stops[0]!.time;
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/活动时间/);
});

test('活动缺少占时不能当零分钟，区块沿同地点占时核验并优先本次明确时间',()=>{
 const base=blueprint(),next=structuredClone(base);next.version++;
 delete next.places[0]!.durationMinutes;
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/活动时间/);
 next.places[0]!.durationMinutes=90;
 next.days[0]!.blocks=[{id:'首次到访',kind:'stop',order:1,placeId:'a',startTime:'09:00',evidence:[]},{id:'下一到访',kind:'stop',order:2,placeId:'b',startTime:'10:00',evidence:[]}];
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/重叠|交通/);
 next.days[0]!.blocks![0]!.durationMinutes=30;
 assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}));
 delete next.days[0]!.blocks![0]!.durationMinutes;next.days[0]!.blocks![0]!.endTime='09:50';
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/交通/);
 delete next.days[0]!.blocks![0]!.endTime;delete next.days[0]!.blocks![0]!.durationMinutes;delete next.places[0]!.durationMinutes;
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/活动时间/);
});


test('所有地点与区块入口拒绝损坏占时，人工审阅也不能绕过结构边界',()=>{
 for(const duration of [-30,NaN,Infinity,-Infinity,1441,'30'] as unknown[]){
  for(const entry of ['地点','区块','交通'] as const){
   const base=blueprint(),next=structuredClone(base);next.version++;
   if(entry==='地点')next.places[0]!.durationMinutes=duration as number;
   if(entry==='交通')next.movements[0]!.durationMinutes=duration as number;
   if(entry==='区块')next.days[0]!.blocks=[{id:'坏占时',kind:'stop',order:1,placeId:'a',startTime:'09:00',durationMinutes:duration as number,evidence:[]}];
   for(const requireCompleteTiming of [true,false])assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming}));
  }
 }
});

test('完整活动区间逐次校验末活动、重复到访、倒置与跨日期边界',()=>{
 for(const entry of ['末停靠','首次区块','末区块','重复到访'] as const){
  const base=blueprint(),next=structuredClone(base);next.version++;
  if(entry==='末停靠'){next.days[0]!.stops[1]!.time='23:50';next.places[1]!.durationMinutes=120;}
  else {
   next.days[0]!.blocks=[{id:'首次到访',kind:'stop',placeId:'a',order:1,startTime:'09:00',endTime:'09:30',evidence:[]},{id:'末次到访',kind:'stop',placeId:'b',order:2,startTime:'10:00',endTime:'10:30',evidence:[]}];
   if(entry==='首次区块')next.days[0]!.blocks![0]!.endTime='08:00';
   else if(entry==='末区块'){next.days[0]!.blocks![1]!.startTime='23:50';delete next.days[0]!.blocks![1]!.endTime;next.days[0]!.blocks![1]!.durationMinutes=120;next.days[0]!.stops[1]!.time='23:50';}
   else {next.days[0]!.blocks!.push({id:'再次到访',kind:'stop',placeId:'a',order:3,startTime:'23:50',durationMinutes:120,evidence:[]});next.movements.push({...next.movements[0]!,id:'返回交通',originPlaceId:'b',destinationPlaceId:'a'});}
  }
  for(const requireCompleteTiming of [true,false])assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming}),/时间|跨出/);
 }
 const base=blueprint(),next=structuredClone(base);next.version++;
 next.places[1]!.durationMinutes=0;next.days[0]!.stops[1]!.time='23:59';
 assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}));
 delete next.places[1]!.durationMinutes;
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}),/活动时间/);
 assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming:false}));
});

test('人工保留待核交通和未知占时，自动严校验且已知冲突与邻接仍拒绝',()=>{
 for(const status of ['recheck','stale','verified'] as const){
  const base=blueprint(),next=structuredClone(base);next.version++;
  next.movements[0]!.status=status;delete next.movements[0]!.durationMinutes;
  delete next.days[0]!.stops[0]!.time;delete next.places[0]!.durationMinutes;
  assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming:false}));
  assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'}));
 }
 const base=blueprint(),next=structuredClone(base);next.version++;
 next.movements[0]!.status='recheck';next.movements[0]!.durationMinutes=90;
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming:false}),error=>typeof error==='object'&&error!==null&&'code' in error&&error.code==='activation_review_required');
 next.movements[0]!.durationMinutes=20;next.movements[0]!.originPlaceId='b';next.movements[0]!.destinationPlaceId='a';
 assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming:false}));
});

test('固定预订正规审阅N至N+1可供人工及自动读取，真变更与未认证来源仍拒绝',()=>{
 const base=blueprint();base.bookingConstraints=[{id:'固定票',sourceBookingId:'虚构固定真源',type:'ticket',title:'固定到访',status:'confirmed',sourceLabel:'虚构旅人声明',importedAt:base.createdAt,constraintStrength:'hard',segments:[{id:'固定场次',sourceSegmentId:'固定源分段',status:'confirmed',segmentType:'event_window',title:'固定到访时段',location:'Tokyo',constraintStrength:'hard',fixedCommitment:true,startAtLocal:'2026-11-17T09:00',startTimeZone:'Asia/Tokyo',endAtLocal:'2026-11-17T09:30',endTimeZone:'Asia/Tokyo',needsReviewReasons:[]}]}];
 const context=bookingRelationshipReviewContext(base),evidenceRefs=['traveler-declaration:虚构固定到访'];
 const assessment:BookingRelationshipAssessment={schemaVersion:1,blueprintId:base.id,blueprintVersion:base.version,universeDigest:context.universeDigest,status:'reviewed',units:context.units.map(unit=>({...unit,coverage:'complete',relations:[{id:'固定直接承诺',scope:'occurrence',targets:[{kind:'occurrence',dayId:'d',placeId:'a'}],role:'direct_commitment',operations:['remove','move','add','priority'],rationale:'本人确认固定票直接对应首个到访',evidenceRefs}],rationale:'本人已核对完整安排及跨日依赖',evidenceRefs})),decision:{source:'traveler',actorId:'local-traveler',decidedAt:base.createdAt,rationale:'明确核对全部固定承诺',evidenceRefs,obligations:['逐项核对直接、间接和跨日依赖']}};
 const reviewed=applyDirectBlueprintRevisionBatchWithMetadata(base,[{kind:'review_booking_relationships',assessment,createdAt:base.createdAt}]).blueprint;
 assert.equal(reviewed.version,2);assert.equal(reviewed.bookingRelationshipAssessment!.blueprintVersion,1);
 for(const requireCompleteTiming of [true,false])assert.doesNotThrow(()=>assertTravelAdjustmentReplacement(base,reviewed,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming}));
 for(const mutate of [
  (next:TripBlueprint)=>{next.movements[0]!.durationMinutes=21;},
  (next:TripBlueprint)=>{next.bookingConstraints![0]!.segments[0]!.status='cancelled';},
  (next:TripBlueprint)=>{delete next.bookingConstraints![0]!.sourceBookingId;},
  (next:TripBlueprint)=>{delete next.bookingConstraints![0]!.segments[0]!.sourceSegmentId;},
  (next:TripBlueprint)=>{next.bookingRelationshipAssessment!.decision.source='agent';next.bookingRelationshipAssessment!.decision.model='虚构未认证模型';next.bookingRelationshipAssessment!.producerVerification='unverified';},
  (next:TripBlueprint)=>{next.bookingRelationshipAssessment!.status='candidate';},
 ]){const next=structuredClone(reviewed);mutate(next);for(const requireCompleteTiming of [true,false])assert.throws(()=>assertTravelAdjustmentReplacement(base,next,{Tokyo:'Asia/Tokyo'},{requireCompleteTiming}));}
});


test('逐项变化事件身份门禁拒绝缺失、空白及混合批次，未知观察仍可保留',()=>{
 const changed={status:'changed',fingerprint:'虚构关闭事件'} as TravelAdjustmentObservation;
 for(const fingerprint of [null,undefined,'','  ','\t']){
  const invalid={...changed,fingerprint} as TravelAdjustmentObservation;
  assert.match(travelAdjustmentEventIdentityBlocker([invalid])!,/事件身份/);
  assert.match(travelAdjustmentEventIdentityBlocker([changed,invalid])!,/事件身份/);
 }
 assert.equal(travelAdjustmentEventIdentityBlocker([changed,{status:'unchanged',fingerprint:null} as TravelAdjustmentObservation]),undefined);
});
