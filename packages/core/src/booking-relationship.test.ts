import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {applyDirectBlueprintRevision,applyDirectBlueprintRevisionWithMetadata,applyDirectBlueprintRevisionBatchWithMetadata, previewDirectBlueprintRevisionImpact, undoDirectBlueprintRevision, DirectBlueprintHighImpactError} from "./blueprint-revision.js";
import {bookingRelationshipDigest,canonicalBookingRelationshipJson,bookingRelationshipReviewContext,bookingRelationshipImpact,bookingRelationshipAssessmentIssues,bookingRelationshipSourceUnits,bookingRelationshipFixedProtection,bookingRelationshipProtection,reconcileBookingRelationshipAssessment,bookingTaskRequirementId,type BookingRelationshipSourceContext,type BookingRelationshipAssessment,type BookingRelationship} from "./booking-relationship.js";
import {WorkspaceMutationError} from "./workspace-mutation-error.js";
import {compileTripBlueprint} from "./blueprint-plan-compiler.js";
import {blueprintBookingConstraintsFromTravelBookings} from "./booking-projection.js";
import {type TripBlueprint,type BlueprintBookingConstraint} from "./trip-blueprint.js";
const now="2026-11-16T10:00:00Z";
function fixture():TripBlueprint{return {schemaVersion:1,id:"旅行蓝图",version:1,generationKey:"生成",proposalRef:{sessionId:"会话",proposalVersion:1},skillLineage:{skillId:"landi",skillVersion:"1.0.0"},researchSetId:"研究",title:"示例旅行",summary:"隔离测试",language:"zh",destinations:["示例城市"],startDate:"2026-12-01",endDate:"2026-12-02",places:["a","b","c","d"].map(id=>({id,name:"同名地点",locationLabel:"示例城市",category:"sight",priority:id==="a"?"must":"preferred",whyWorthIt:"测试",plan:"测试",evidence:[]})),events:[],sources:[],days:[{id:"d1",date:"2026-12-01",kind:"scheduled",city:"示例城市",title:"第一天",summary:"测试",stops:["a","b","c","d"].map((placeId,index)=>({placeId,order:index+1})),candidatePlaceIds:[]},{id:"d2",date:"2026-12-02",kind:"scheduled",city:"示例城市",title:"第二天",summary:"测试",stops:[{placeId:"a",order:1}],candidatePlaceIds:[]}],movements:[['a','b'],['b','c'],['c','d']].map(([originPlaceId,destinationPlaceId],i)=>({id:"m"+(i+1),dayId:"d1",originPlaceId:originPlaceId!,destinationPlaceId:destinationPlaceId!,mode:"walking",status:"recheck",evidence:[]})),actionRequirements:[],bookingConstraints:[booking("一"),booking("二")],createdAt:now};}
function booking(id:string):BlueprintBookingConstraint{return {id,sourceBookingId:"来源"+id,type:"ticket",title:"无名称推断",status:"pending",sourceLabel:"旅行者输入",importedAt:now,constraintStrength:"soft",segments:[{id:"分段"+id,sourceSegmentId:"来源分段"+id,status:"pending",segmentType:"event_window",title:"场次",constraintStrength:"soft",fixedCommitment:false,needsReviewReasons:[]}]};}
function relation(id:string,targets:BookingRelationship['targets'],scope:BookingRelationship['scope']='occurrence'):BookingRelationship{return {id,scope,targets,role:"itinerary_context",operations:["remove","move","add","priority"],...(scope==='dependency'?{direction:'booking_depends_on_targets' as const}:{}),rationale:"旅行者明确核对的关联",evidenceRefs:["traveler-declaration:合成审阅"]};}
function reviewed(base:TripBlueprint,relations:BookingRelationship[]=[]):TripBlueprint {const context=bookingRelationshipReviewContext(base);const assessment:BookingRelationshipAssessment={schemaVersion:1,blueprintId:base.id,blueprintVersion:base.version,universeDigest:context.universeDigest,units:context.units.map((unit,index)=>({...unit,coverage:"complete",relations:index===0?relations:[],rationale:"已核对全部直接及跨日依赖",evidenceRefs:["traveler-declaration:合成审阅"]})),decision:{source:"traveler",actorId:"local-traveler",decidedAt:now,rationale:"确认全量覆盖",evidenceRefs:["traveler-declaration:合成审阅"],obligations:["核对全部直接、间接及跨日依赖"]},status:"reviewed"};return applyDirectBlueprintRevisionBatchWithMetadata(base,[{kind:"review_booking_relationships",assessment,createdAt:now}]).blueprint;}
const removal={kind:"remove_place_from_day" as const,dayId:"d1",placeId:"a",createdAt:now};
test("规范SHA-256与Node标准实现逐字节一致，覆盖中文、多块和边界",()=>{for(const value of ["", "abc", "中文关系", ...[54,55,56,63,64,65,127,128,1024].map(n=>"x".repeat(n)),{乙:[1,2],甲:{z:true,a:"内容"}}]) assert.equal(bookingRelationshipDigest(value),createHash("sha256").update(canonicalBookingRelationshipJson(value)).digest("hex"));assert.equal(bookingRelationshipDigest({a:1,b:2}),bookingRelationshipDigest({b:2,a:1}));});
test("真实Core审阅产生单一新版本；同日及跨日无关不能因同名误列",()=>{const b=reviewed(fixture(),[relation("关系一",[{kind:"occurrence",dayId:"d2",placeId:"a"}])]);const impact=previewDirectBlueprintRevisionImpact(b,[removal])!;assert.deepEqual(impact.bookingConstraintIds,[]);assert.equal(impact.bookingImpact.unknown.length,0);assert.equal(impact.bookingImpact.unaffected.length,2);assert.equal(b.version,2);assert.ok(b.bookingRelationshipAssessment?.reviewedTargetDigests);});
test("明确软关联必须可确认保存；真实预订保留且撤销恢复关系",()=>{const b=reviewed(fixture(),[relation("关系一",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]);const impact=previewDirectBlueprintRevisionImpact(b,[removal])!;assert.deepEqual(impact.bookingConstraintIds,["一"]);assert.equal(impact.bookingImpact.canConfirm,true);assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[removal]),DirectBlueprintHighImpactError);const after=applyDirectBlueprintRevisionBatchWithMetadata(b,[removal],{highImpactConfirmation:impact.id}).blueprint;assert.equal(after.bookingConstraints?.length,2);assert.equal(after.bookingRelationshipAssessment?.status,"invalidated");const undone=undoDirectBlueprintRevision(after,b,after,now);assert.equal(undone.days[0]!.stops[0]!.placeId,"a");assert.equal(bookingRelationshipImpact(undone,[removal]).affected.length,1);});
test("旧缺失、空数组、partial与漏分段不证明无影响；局部正关系与unknown共存",()=>{const old=fixture();assert.equal(bookingRelationshipImpact(old,[removal]).unknown.length,2);const b=reviewed(old,[relation("关系一",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]);b.bookingRelationshipAssessment!.units.pop();b.bookingRelationshipAssessment!.status="invalidated";const result=bookingRelationshipImpact(b,[removal]);assert.equal(result.affected.length,1);assert.equal(result.unknown.length,2);assert.equal(result.canConfirm,false);assert.equal(result.unaffected.length,0);});
test("movement依赖按实际编辑端点命中，不以同日全部命中",()=>{const b=reviewed(fixture(),[relation("路线",[{kind:"movement",movementId:"m3"}],"dependency")]);assert.equal(bookingRelationshipImpact(b,[removal]).affected.length,0);assert.equal(bookingRelationshipImpact(b,[{kind:"remove_place_from_day",dayId:"d1",placeId:"d"}]).affected.length,1);});
test("跨日依赖任一完整成员变化使正关系unknown，旧确认失效",()=>{const b=reviewed(fixture(),[relation("跨日",[{kind:"occurrence",dayId:"d1",placeId:"a"},{kind:"occurrence",dayId:"d2",placeId:"a"}],"dependency")]);const first=previewDirectBlueprintRevisionImpact(b,[removal])!;assert.equal(first.bookingImpact.affected.length,1);b.days[1]!.date="2026-12-03";reconcileBookingRelationshipAssessment(b);const changed=previewDirectBlueprintRevisionImpact(b,[removal])!;assert.equal(changed.bookingImpact.affected.length,0);assert.equal(changed.bookingImpact.canConfirm,false);assert.notEqual(first.id,changed.id);});
test("同日酒店多次blocks与legacy stop-only身份不能混淆",()=>{const b=fixture();b.days[0]!.blocks=[{id:"入住",kind:"lodging",order:1,placeId:"a",evidence:[]},{id:"取行李",kind:"lodging",order:2,placeId:"a",evidence:[]}];const context=bookingRelationshipReviewContext(b);assert.equal(context.targets.filter(t=>t.kind==='occurrence'&&t.dayId==='d1').length,2);const a:BookingRelationshipAssessment={schemaVersion:1,blueprintId:b.id,blueprintVersion:1,universeDigest:context.universeDigest,units:context.units.map((u,i)=>({...u,coverage:"complete",relations:i===0?[relation("错误",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]:[],rationale:"完整审阅",evidenceRefs:["traveler-declaration:合成审阅"]})),decision:{source:"traveler",actorId:"local-traveler",decidedAt:now,rationale:"审阅",evidenceRefs:["traveler-declaration:合成审阅"],obligations:["核对全部直接、间接及跨日依赖"]},status:"reviewed"};assert.ok(bookingRelationshipAssessmentIssues(b,a,true).some(v=>v.includes("目标")));});
test("取消分段及稳定源映射进入摘要，私密非结构资料不进入投影",()=>{const b=fixture();const first=bookingRelationshipReviewContext(b);b.bookingConstraints![0]!.segments[0]!.status="cancelled";assert.notEqual(first.units[0]!.sourceDigest,bookingRelationshipReviewContext(b).units[0]!.sourceDigest);assert.equal(bookingRelationshipImpact(b,[removal]).unaffected[0]?.bookingConstraintId,"一");const projected=blueprintBookingConstraintsFromTravelBookings([{id:"原源",planningSessionId:"会话",source:"user",sourceHash:"脱敏摘要",sourceLabel:"输入",title:"确认",status:"cancelled",type:"ticket",constraintStrength:"soft",segments:[],importedAt:now,updatedAt:now,notes:"私密资料"}]);assert.equal(projected[0]?.sourceBookingId,"原源");assert.equal(projected[0]?.status,"cancelled");assert.equal('notes' in projected[0]!,false);assert.equal(bookingRelationshipReviewContext({...b,bookingConstraints:projected}).units[0]?.segmentId,undefined);});
test("坏runtime JSON必须结构拒绝，review不能携坏目标或混删",()=>{const b=reviewed(fixture());const a=structuredClone(b.bookingRelationshipAssessment!);a.blueprintVersion=b.version;for(const units of [[null],[{...a.units[0],relations:[null]}]])assert.ok(bookingRelationshipAssessmentIssues(b,{...a,units} as unknown as BookingRelationshipAssessment,true).length);assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[{kind:"review_booking_relationships",assessment:a,createdAt:now},removal]));});
test("取消与ignored不编译执行；完成条件源语义改变不得复活completed",()=>{const b=reviewed(fixture());const constraint=b.bookingConstraints![0]!;constraint.constraintStrength="hard";constraint.status="confirmed";constraint.segments[0]!.constraintStrength="hard";constraint.segments[0]!.startAtLocal="2026-12-01T10:00:00";constraint.segments[0]!.location="示例城市";reconcileBookingRelationshipAssessment(b);const oldKey=bookingTaskRequirementId(constraint,constraint.segments[0]!.id);const first=compileTripBlueprint(b,{createdAt:now,completedRequirementIds:[oldKey]});assert.equal(first.plan.stages.flatMap(s=>s.tasks).find(t=>t.requirementId===oldKey)?.status,"completed");constraint.segments[0]!.startAtLocal="2026-12-01T11:00:00";reconcileBookingRelationshipAssessment(b);const second=compileTripBlueprint(b,{createdAt:now,completedRequirementIds:[oldKey]});assert.equal(second.plan.stages.flatMap(s=>s.tasks).some(t=>t.requirementId===oldKey),false);constraint.segments[0]!.status="cancelled";reconcileBookingRelationshipAssessment(b);assert.equal(compileTripBlueprint(b,{createdAt:now}).plan.stages.flatMap(s=>s.tasks).some(t=>t.title.includes("场次")),true);assert.equal(compileTripBlueprint(b,{createdAt:now}).plan.stages.flatMap(s=>s.tasks).some(t=>t.requirementId?.startsWith("booking:一:")),false);});

test("普通软关联移动与删除均精确确认，未知单项和混批不绕过",()=>{const ordinary=fixture();ordinary.places[0]!.priority="preferred";assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(ordinary,[removal]),DirectBlueprintHighImpactError);const b=reviewed(ordinary,[relation("普通关联",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]);const move={kind:"move_place_within_day" as const,dayId:"d1",placeId:"a",position:{kind:"end" as const},createdAt:now};const preview=previewDirectBlueprintRevisionImpact(b,[move])!;assert.equal(preview.bookingImpact.affected.length,1);assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[move]),DirectBlueprintHighImpactError);assert.equal(applyDirectBlueprintRevisionBatchWithMetadata(b,[move],{highImpactConfirmation:preview.id}).blueprint.version,b.version+1);const batch=[{kind:"update_place_priority" as const,placeId:"a",priority:"preferred" as const,createdAt:now},removal];const old=fixture();assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(old,batch));assert.equal(old.days[0]!.stops.length,4);});
test("旧无关系固定承诺失败关闭，明确无关后可解除该未知且不解除booked保护",()=>{const old=fixture();old.bookingConstraints![0]!.segments[0]!.fixedCommitment=true;old.bookingConstraints![0]!.segments[0]!.constraintStrength="hard";old.bookingConstraints![0]!.segments[0]!.startAtLocal="2026-12-01T20:00";old.bookingConstraints![0]!.segments[0]!.location="示例城市";assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(old,[removal]),/固定承诺/);const b=reviewed(old);const p=previewDirectBlueprintRevisionImpact(b,[removal])!;assert.equal(p.bookingImpact.canConfirm,true);assert.equal(applyDirectBlueprintRevisionBatchWithMetadata(b,[removal],{highImpactConfirmation:p.id}).blueprint.version,b.version+1);b.places[0]!.priority="booked";assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[removal]),/固定承诺/);});
test("仅改变展示文案或抓取时刻不失效，同ID换源与地点语义改变必失效",()=>{const b=reviewed(fixture(),[relation("同物异名",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]);const digest=bookingRelationshipReviewContext(b).universeDigest;b.places[0]!.whyWorthIt="新文案";b.places[0]!.evidence=[];b.days[0]!.summary="新概述";assert.equal(bookingRelationshipReviewContext(b).universeDigest,digest);assert.equal(bookingRelationshipImpact(b,[removal]).canConfirm,true);b.bookingConstraints![0]!.sourceBookingId="另一来源";reconcileBookingRelationshipAssessment(b);assert.equal(bookingRelationshipImpact(b,[removal]).canConfirm,false);const second=reviewed(fixture(),[relation("地点",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]);second.places[0]!.city="不同城市";reconcileBookingRelationshipAssessment(second);assert.equal(bookingRelationshipImpact(second,[removal]).affected.length,0);});
test("显式来源选择只接受可信投影且必须独立保存，不产生complete",()=>{const b=fixture();const command={kind:"select_booking_sources" as const,sourceBookingIds:["来源一","来源二"],expectedSourceSetDigest:"规范集合摘要",createdAt:now};assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[command]));assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[command,removal],{resolvedBookingConstraints:[booking("一"),booking("二")]}));const result=applyDirectBlueprintRevisionBatchWithMetadata(b,[command],{resolvedBookingConstraints:[booking("一"),booking("二")],sourceSelectionDecision:{source:"traveler",actorId:"local-traveler",decidedAt:now}});const selected=result.blueprint;assert.equal(selected.version,2);assert.equal(selected.bookingRelationshipAssessment,undefined);assert.equal(bookingRelationshipImpact(selected,[removal]).unknown.length,2);assert.equal(result.metadata.sourceSelectionAudit?.decision.actorId,"local-traveler");assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[{...command,sourceBookingIds:["来源一"]}],{resolvedBookingConstraints:[booking("一")],sourceSelectionDecision:{source:"traveler",actorId:"local-traveler",decidedAt:now}}));});

test("合法过期来源经独立审阅恢复，原始快照不变",()=>{const old=reviewed(fixture());old.bookingConstraints![0]!.sourceBookingId="更正来源";const snapshot=structuredClone(old);const next=reviewed(old);assert.equal(next.bookingRelationshipAssessment?.status,"reviewed");assert.deepEqual(old,snapshot);assert.equal(bookingRelationshipImpact(next,[removal]).canConfirm,true);});
test("失效不能洗白坏状态、坏目标、重复关系或缺证据",()=>{for(const mutate of [(a:BookingRelationshipAssessment)=>{a.status="损坏" as never;},(a:BookingRelationshipAssessment)=>{a.units[0]!.relations[0]!.targets=[{kind:"occurrence",placeId:"a"} as never];},(a:BookingRelationshipAssessment)=>{a.units.push(structuredClone(a.units[0]!));},(a:BookingRelationshipAssessment)=>{a.units[0]!.evidenceRefs=[];},(a:BookingRelationshipAssessment)=>{a.decision.evidenceRefs=[];},(a:BookingRelationshipAssessment)=>{a.decision.obligations=[];}]){const old=reviewed(fixture(),[relation("审阅关系",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]);old.bookingConstraints![0]!.sourceBookingId="新来源";mutate(old.bookingRelationshipAssessment!);const snapshot=structuredClone(old);assert.throws(()=>reviewed(old));assert.deepEqual(old,snapshot);}});
test("partial无正关系可诚实无来源，但不产生排除事实",()=>{const old=fixture();const context=bookingRelationshipReviewContext(old);const assessment:BookingRelationshipAssessment={schemaVersion:1,blueprintId:old.id,blueprintVersion:old.version,universeDigest:context.universeDigest,status:"candidate",decision:{source:"traveler",actorId:"local-traveler",decidedAt:now,rationale:"尚待补充",evidenceRefs:[],obligations:["继续核对"]},units:context.units.map(unit=>({...unit,coverage:"partial",relations:[],rationale:"尚待补充",evidenceRefs:[]}))};old.bookingRelationshipAssessment=assessment;assert.deepEqual(bookingRelationshipAssessmentIssues(old),[]);assert.equal(bookingRelationshipImpact(old,[removal]).unaffected.length,0);assert.equal(bookingRelationshipImpact(old,[removal]).canConfirm,false);});

test("movement局部证明绑定日期、端点语义及相关排程",()=>{for(const mutate of [(b:TripBlueprint)=>{b.days[0]!.date="2026-12-03";},(b:TripBlueprint)=>{b.places[2]!.city="另一城市";},(b:TripBlueprint)=>{b.days[0]!.stops[2]!.time="14:00";}]){const b=reviewed(fixture(),[relation("交通依赖",[{kind:"movement",movementId:"m3"}],"dependency")]);const edit={kind:"remove_place_from_day",dayId:"d1",placeId:"d"};assert.equal(bookingRelationshipImpact(b,[edit]).affected.length,1);mutate(b);reconcileBookingRelationshipAssessment(b);assert.equal(bookingRelationshipImpact(b,[edit]).affected.length,0);assert.equal(bookingRelationshipImpact(b,[edit]).canConfirm,false);}});

function runtimeSources(blueprint:TripBlueprint,pending=true):BookingRelationshipSourceContext {
  return {planId:"隔离草稿",planVersion:1,blueprintId:blueprint.id,blueprintVersion:blueprint.version,sourceSetDigest:bookingRelationshipDigest({sources:pending?["未采用真源"]:[]}),adoptedUnits:bookingRelationshipSourceUnits(blueprint.bookingConstraints??[]),pendingSources:pending?[{sourceBookingId:"未采用真源",sourceDigest:bookingRelationshipDigest({source:"合成真实资料"})}]:[],resolutionIssues:[]};
}
test("全局来源缺口保留已核正关系，精确坏源与摘要变化仅撤对应单元",()=>{
  const b=reviewed(fixture(),[relation('已知关系',[{kind:'occurrence',dayId:'d1',placeId:'a'}])]);
  const context=runtimeSources(b,false);
  context.resolutionIssues=[{code:'unverified_ancestor'}];
  const global=bookingRelationshipImpact(b,[removal],context);
  assert.deepEqual(global.affected.map(unit=>unit.bookingConstraintId),['一']);
  assert.ok(global.unknown.some(unit=>unit.kind==='source_resolution'&&unit.reason==='unverified_ancestor'));
  assert.equal(global.canConfirm,false);
  for(const issue of [{code:'missing_source' as const,bookingConstraintId:'二'},{code:'invalid_mapping' as const,sourceBookingId:'来源二'},{code:'source_scope_unresolved' as const,sourceBookingId:'来源二'}]) {
    const local=bookingRelationshipImpact(b,[removal],{...context,resolutionIssues:[issue]});
    assert.deepEqual(local.affected.map(unit=>unit.bookingConstraintId),['一']);
    assert.ok(local.unknown.some(unit=>unit.kind!=='source_resolution'&&unit.kind!=='source_obligation'&&unit.bookingConstraintId==='二'));
    assert.equal(local.canConfirm,false);
  }
  for(const issue of [{code:'missing_source' as const,bookingConstraintId:'一'},{code:'invalid_mapping' as const,sourceBookingId:'来源一'}]) assert.equal(bookingRelationshipImpact(b,[removal],{...context,resolutionIssues:[issue]}).affected.length,0);
  const changed=structuredClone(context);changed.adoptedUnits[0]!.sourceDigest=bookingRelationshipDigest('真实更正');
  assert.equal(bookingRelationshipImpact(b,[removal],changed).affected.length,0);
});
const sourceReviewRequired=(error:unknown)=>error instanceof WorkspaceMutationError&&error.code==='booking_source_review_required';

test("预览来源投影克隆隔离，single与metadata删除确认归一且冲突拒绝",()=>{
  const b=reviewed(fixture(),[relation('软关联',[{kind:'occurrence',dayId:'d1',placeId:'a'}])]);
  const context=runtimeSources(b,false),snapshot=structuredClone(b);
  const preview=previewDirectBlueprintRevisionImpact(b,[removal],context)!;
  assert.deepEqual(preview.sourceContext,context);
  preview.sourceContext!.resolutionIssues.push({code:'unverified_ancestor'});
  assert.deepEqual(context.resolutionIssues,[]);
  for(const apply of [applyDirectBlueprintRevision, (base:TripBlueprint,edit:typeof removal,options:Parameters<typeof applyDirectBlueprintRevision>[2])=>applyDirectBlueprintRevisionWithMetadata(base,edit,options).blueprint]) {
    for(const command of [removal,{...removal,highImpactConfirmation:preview.id}]) assert.equal(apply(b,command,{sourceContext:context,highImpactConfirmation:preview.id}).version,b.version+1);
    assert.equal(apply(b,{...removal,highImpactConfirmation:preview.id},{sourceContext:context}).version,b.version+1);
    assert.throws(()=>apply(b,{...removal,highImpactConfirmation:'冲突'},{sourceContext:context,highImpactConfirmation:preview.id}),WorkspaceMutationError);
    assert.throws(()=>apply(b,removal,{sourceContext:context}),DirectBlueprintHighImpactError);
    assert.throws(()=>apply(b,removal,{sourceContext:{...context,sourceSetDigest:bookingRelationshipDigest('新来源')},highImpactConfirmation:preview.id}),DirectBlueprintHighImpactError);
  }
  assert.deepEqual(b,snapshot);
});

test("Undo新增删除移动优先级与来源缺口矩阵，安全同源可恢复",()=>{
  const base=reviewed(fixture());
  const commands:Parameters<typeof applyDirectBlueprintRevision>[1][]=[
    {kind:'add_place_to_day',placeId:'b',dayId:'d2',position:{kind:'end'},createdAt:now},
    removal,
    {kind:'move_place_within_day',placeId:'b',dayId:'d1',position:{kind:'end'},createdAt:now},
    {kind:'update_place_priority',placeId:'b',priority:'must',createdAt:now}
  ];
  for(const command of commands) {
    const preview=previewDirectBlueprintRevisionImpact(base,[command]);
    const after=applyDirectBlueprintRevision(base,command,preview?{highImpactConfirmation:preview.id}:{});
    for(const issue of ['pending','scope','changed']) {
      const context=runtimeSources(after,issue==='pending');
      if(issue==='scope')context.resolutionIssues=[{code:'source_scope_unresolved'}];
      if(issue==='changed')context.adoptedUnits[0]!.sourceDigest=bookingRelationshipDigest('更正');
      const snapshot=structuredClone(after);
      assert.throws(()=>undoDirectBlueprintRevision(after,base,after,now,context),sourceReviewRequired);
      assert.deepEqual(after,snapshot);
    }
    const restored=undoDirectBlueprintRevision(after,base,after,now,runtimeSources(after,false));
    assert.deepEqual(restored.days,base.days);assert.deepEqual(restored.places,base.places);
  }
});

test("Undo覆盖同Place多块跨日、block顺序与movement端点，当前固定保护优先",()=>{
  const plain=fixture();
  plain.days[0]!.blocks=['a','b','c','d','a'].map((placeId,index)=>({id:'块'+index,kind:'stop',order:index+1,placeId,evidence:[]}));
  plain.movements.push({id:'返回',dayId:'d1',originPlaceId:'d',destinationPlaceId:'a',mode:'walking',status:'recheck',evidence:[]});
  const base=reviewed(plain);
  const after=applyDirectBlueprintRevision(base,{kind:'move_place_within_day',dayId:'d1',placeId:'a',position:{kind:'end'},createdAt:now});
  assert.throws(()=>undoDirectBlueprintRevision(after,base,after,now,runtimeSources(after)),sourceReviewRequired);
  assert.equal(undoDirectBlueprintRevision(after,base,after,now,runtimeSources(after,false)).days[0]!.blocks?.filter(block=>block.placeId==='a').length,2);
  for(const modify of [(b:TripBlueprint)=>{b.days[0]!.blocks!.reverse();},(b:TripBlueprint)=>{b.movements[0]!.mode='driving';}]) {
    const changed=structuredClone(base);modify(changed);changed.version++;
    assert.throws(()=>undoDirectBlueprintRevision(changed,base,changed,now,runtimeSources(changed)),sourceReviewRequired);
  }
  const added=applyDirectBlueprintRevision(base,{kind:'add_place_to_day',placeId:'b',dayId:'d2',position:{kind:'end'},createdAt:now});
  added.places.find(place=>place.id==='b')!.priority='booked';
  const snapshot=structuredClone(added);
  assert.throws(()=>undoDirectBlueprintRevision(added,base,added,now,runtimeSources(added,false)),(error:unknown)=>error instanceof WorkspaceMutationError&&error.code==='assisted_replanning_required');
  assert.deepEqual(added,snapshot);
  assert.throws(()=>undoDirectBlueprintRevision({...added,version:added.version+1},base,added,now),/无法撤销/);
});

test("空与缺失约束快照的真实来源义务独立unknown，不伪造constraint或固定承诺",()=>{
  for(const missing of [false,true]) {
    const b=fixture();if(missing) delete b.bookingConstraints;else b.bookingConstraints=[];
    const context=runtimeSources(b),snapshot=structuredClone(b);
    assert.equal(bookingRelationshipImpact(b,[removal]).canConfirm,true);
    const impact=bookingRelationshipImpact(b,[removal],context);
    assert.equal(impact.canConfirm,false);assert.deepEqual(impact.affected,[]);assert.deepEqual(impact.unaffected,[]);
    assert.equal(impact.unknown[0]?.kind,'source_obligation');assert.equal('bookingConstraintId' in impact.unknown[0]!,false);
    assert.equal(bookingRelationshipFixedProtection(b,removal,context),false);assert.deepEqual(b,snapshot);
    const noSources=runtimeSources(b,false);assert.equal(bookingRelationshipImpact(b,[removal],noSources).canConfirm,true);
  }
});

test("待核对来源贯通single、metadata、batch及混合优先级操作，伪确认无效",()=>{
  const b=fixture();b.bookingConstraints=[];const context=runtimeSources(b);const snapshot=structuredClone(b);
  const preview=previewDirectBlueprintRevisionImpact(b,[removal],context)!;
  for(const apply of [()=>applyDirectBlueprintRevision(b,{...removal,highImpactConfirmation:preview.id},{sourceContext:context}),()=>applyDirectBlueprintRevisionWithMetadata(b,{...removal,highImpactConfirmation:preview.id},{sourceContext:context}),()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[removal],{sourceContext:context,highImpactConfirmation:preview.id}),()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[{kind:'update_place_priority',placeId:'a',priority:'preferred',createdAt:now},removal],{sourceContext:context,highImpactConfirmation:preview.id})]) assert.throws(apply,(error:unknown)=>error instanceof DirectBlueprintHighImpactError&&!error.impact.bookingImpact.canConfirm&&error.impact.bookingImpact.unknown[0]?.kind==='source_obligation');
  assert.deepEqual(b,snapshot);
});

test("部分已知影响与pending并存，真实采用源变化撤回旧正关系且摘要绑定完整context",()=>{
  const b=reviewed(fixture(),[relation('已知关系',[{kind:'occurrence',dayId:'d1',placeId:'a'}])]);const context=runtimeSources(b);
  const first=previewDirectBlueprintRevisionImpact(b,[removal],context)!;
  assert.equal(first.bookingImpact.affected.length,1);assert.equal(first.bookingImpact.canConfirm,false);assert.equal(first.bookingImpact.unknown[0]?.kind,'source_obligation');
  const changed=structuredClone(context);changed.adoptedUnits[0]!.sourceDigest=bookingRelationshipDigest('真实时地已更正');
  const second=previewDirectBlueprintRevisionImpact(b,[removal],changed)!;
  assert.equal(second.bookingImpact.affected.length,0);assert.ok(second.bookingImpact.unknown.some(unit=>unit.kind!=='source_obligation'&&unit.kind!=='source_resolution'&&unit.bookingConstraintId==='一'));
  for(const mutate of [(c:BookingRelationshipSourceContext)=>{c.planVersion++;},(c:BookingRelationshipSourceContext)=>{c.sourceSetDigest=bookingRelationshipDigest('候选变化');},(c:BookingRelationshipSourceContext)=>{c.pendingSources[0]!.sourceDigest=bookingRelationshipDigest('源变化');},(c:BookingRelationshipSourceContext)=>{c.resolutionIssues.push({code:'unverified_ancestor'});}]) {const next=structuredClone(context);mutate(next);assert.notEqual(previewDirectBlueprintRevisionImpact(b,[removal],next)!.id,first.id);}
});

test("来源范围缺口保持typed unknown，context坏身份或重复项在Core拒绝",()=>{
  const b=fixture();b.bookingConstraints=[];const context=runtimeSources(b,false);context.resolutionIssues=[{code:'unverified_ancestor'}];
  const impact=bookingRelationshipImpact(b,[removal],context);assert.equal(impact.unknown[0]?.kind,'source_resolution');assert.equal(impact.canConfirm,false);assert.equal('sourceBookingId' in impact.unknown[0]!,false);
  assert.throws(()=>bookingRelationshipImpact(b,[removal],{...context,blueprintVersion:b.version+1}),(error:unknown)=>error instanceof WorkspaceMutationError&&error.code==='version_conflict');
  const duplicate=runtimeSources(b);duplicate.pendingSources.push(structuredClone(duplicate.pendingSources[0]!));assert.throws(()=>bookingRelationshipImpact(b,[removal],duplicate),WorkspaceMutationError);
});

test("pending下Tip准备项可保存与撤销，来源完整审阅独立拒绝",()=>{
  const b=fixture();b.bookingConstraints=[];b.travelTips=[{id:'提示',title:'合成提示',body:'合成内容',theme:'transport',context:'合成情境',evidence:[]}];b.preparationChecklist=[{id:'准备',title:'合成准备',group:'other',completionCondition:'旅行者核对',evidence:[]}];
  const context=runtimeSources(b);const after=applyDirectBlueprintRevisionBatchWithMetadata(b,[{kind:'set_tip_state',tipId:'提示',pinned:true,createdAt:now},{kind:'set_preparation_completed',preparationId:'准备',completed:true,createdAt:now}],{sourceContext:context}).blueprint;
  assert.equal(after.travelTips?.[0]?.pinned,true);assert.equal(after.preparationChecklist?.[0]?.completed,true);
  const undone=undoDirectBlueprintRevision(after,b,after,now,{...context,blueprintVersion:after.version});assert.equal(undone.travelTips?.[0]?.pinned,undefined);assert.equal(undone.preparationChecklist?.[0]?.completed,true);
  const offlineReviewed=reviewed(b);const assessment=structuredClone(offlineReviewed.bookingRelationshipAssessment!);assessment.blueprintVersion=b.version;
  assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,[{kind:'review_booking_relationships',assessment,createdAt:now}],{sourceContext:context}),sourceReviewRequired);
});

test("公开批次每子预览沿原始context，同源完整审阅后安全修改可确认",()=>{
  const b=reviewed(fixture());const context=runtimeSources(b,false);
  const revisions=[{kind:'update_place_priority' as const,placeId:'b',priority:'must' as const,createdAt:now},removal];
  const preview=previewDirectBlueprintRevisionImpact(b,revisions,context)!;
  const after=applyDirectBlueprintRevisionBatchWithMetadata(b,revisions,{sourceContext:context,highImpactConfirmation:preview.id}).blueprint;
  assert.equal(after.version,b.version+1);assert.equal(after.days[0]!.stops.some(stop=>stop.placeId==='a'),false);
  const changed=structuredClone(context);changed.sourceSetDigest=bookingRelationshipDigest('并发新增来源');
  assert.throws(()=>applyDirectBlueprintRevisionBatchWithMetadata(b,revisions,{sourceContext:changed,highImpactConfirmation:preview.id}),DirectBlueprintHighImpactError);
});

test("Undo按逆向真实日程检查当前pending与源变更，拒绝时不先删除目标",()=>{
  const b=reviewed(fixture());const edit={kind:'add_place_to_day' as const,placeId:'b',dayId:'d2',position:{kind:'end' as const},createdAt:now};
  const after=applyDirectBlueprintRevisionBatchWithMetadata(b,[edit]).blueprint;const snapshot=structuredClone(after);
  assert.throws(()=>undoDirectBlueprintRevision(after,b,after,now,runtimeSources(after)),sourceReviewRequired);assert.deepEqual(after,snapshot);
  const changed=runtimeSources(after,false);changed.adoptedUnits[0]!.sourceDigest=bookingRelationshipDigest('真实预订已更正');assert.throws(()=>undoDirectBlueprintRevision(after,b,after,now,changed),sourceReviewRequired);assert.deepEqual(after,snapshot);
  const safe=undoDirectBlueprintRevision(after,b,after,now,runtimeSources(after,false));assert.equal(safe.days[1]!.stops.some(stop=>stop.placeId==='b'),false);
});


test("Undo恢复软目标并保留已明确无关硬预订，当前来源缺口仍拒绝",()=>{
  const plain=fixture();const fixed=plain.bookingConstraints![1]!;fixed.constraintStrength="hard";fixed.segments[0]!.constraintStrength="hard";fixed.segments[0]!.fixedCommitment=true;Object.assign(fixed.segments[0]!,{startAtLocal:"2026-12-01T10:00",startTimeZone:"UTC",location:"虚构场馆"});
  const base=reviewed(plain,[relation("软关系",[{kind:"occurrence",dayId:"d1",placeId:"a"}])]);
  const preview=previewDirectBlueprintRevisionImpact(base,[removal],runtimeSources(base,false))!;
  const after=applyDirectBlueprintRevision(base,removal,{highImpactConfirmation:preview.id,sourceContext:runtimeSources(base,false)});
  const snapshot=structuredClone(after);
  const restored=undoDirectBlueprintRevision(after,base,after,now,runtimeSources(after,false));
  assert.deepEqual(restored.days,base.days);assert.deepEqual(restored.movements,base.movements);assert.deepEqual(restored.bookingConstraints,base.bookingConstraints);
  assert.equal(bookingRelationshipImpact(restored,[removal],runtimeSources(restored,false)).canConfirm,true);assert.deepEqual(after,snapshot);
  for(const scenario of ['pending','changed','resolution']) {
    const context=runtimeSources(after,scenario==='pending');
    if(scenario==='changed')context.adoptedUnits[0]!.sourceDigest=bookingRelationshipDigest('真实来源更正');
    if(scenario==='resolution')context.resolutionIssues=[{code:'unverified_ancestor'}];
    assert.throws(()=>undoDirectBlueprintRevision(after,base,after,now,context),(error:unknown)=>error instanceof WorkspaceMutationError&&(error.code==='booking_source_review_required'||error.code==='assisted_replanning_required'));
    assert.deepEqual(after,snapshot);
  }
});
test("Undo精确恢复基准仍阻止命中的硬直接承诺及独立预约",()=>{
  const plain=fixture();const fixed=plain.bookingConstraints![0]!;fixed.constraintStrength='hard';fixed.segments[0]!.constraintStrength='hard';fixed.segments[0]!.fixedCommitment=true;Object.assign(fixed.segments[0]!,{startAtLocal:"2026-12-01T10:00",startTimeZone:"UTC",location:"虚构场馆"});
  const direct={...relation('固定关系',[{kind:'place_global' as const,placeId:'b'}],'place_global'),role:'direct_commitment' as const,operations:['remove' as const]};
  const base=reviewed(plain,[direct]);
  const after=applyDirectBlueprintRevision(base,{kind:'add_place_to_day',placeId:'b',dayId:'d2',position:{kind:'end'},createdAt:now},{sourceContext:runtimeSources(base,false)});
  const snapshot=structuredClone(after);
  assert.throws(()=>undoDirectBlueprintRevision(after,base,after,now,runtimeSources(after,false)),(error:unknown)=>error instanceof WorkspaceMutationError&&error.code==='assisted_replanning_required');
  assert.deepEqual(after,snapshot);
  const soft=reviewed(fixture());const added=applyDirectBlueprintRevision(soft,{kind:'add_place_to_day',placeId:'b',dayId:'d2',position:{kind:'end'},createdAt:now});
  added.actionRequirements.push({id:'新增独立预约',kind:'reservation',placeId:'b',title:'预约',description:'真实预约义务',accountableParty:'traveler',completionCondition:'已确认',evidence:[]});
  assert.throws(()=>undoDirectBlueprintRevision(added,soft,added,now,runtimeSources(added,false)),(error:unknown)=>error instanceof WorkspaceMutationError&&error.code==='assisted_replanning_required');
});


test("唯一保护分类保留已知fixed与未知并存，旧boolean保守语义等价",()=>{
  for(const mode of ['known','unresolved','mixed-fixed','mixed-soft','source-only','clear']) {
    const plain=fixture();for(const [index,booking]of plain.bookingConstraints!.entries())if((index===0&&(mode==='known'||mode==='mixed-fixed'))||(index===1&&mode.startsWith('mixed'))||mode==='unresolved') {booking.constraintStrength='hard';Object.assign(booking.segments[0]!,{constraintStrength:'hard',fixedCommitment:true,startAtLocal:'2026-12-01T10:00',startTimeZone:'UTC',location:'虚构场馆'});}
    const b=reviewed(plain,mode==='known'||mode.startsWith('mixed')?[{...relation('明确关系',[{kind:'occurrence',dayId:'d1',placeId:'a'}]),role:'direct_commitment'}]:[]);
    if(mode==='unresolved')delete b.bookingRelationshipAssessment;
    if(mode.startsWith('mixed'))b.bookingRelationshipAssessment!.units[1]!.coverage='unknown';
    const context=runtimeSources(b,mode==='source-only'),result=bookingRelationshipProtection(b,removal,context);
    assert.equal(result.knownFixed,mode==='known'||mode==='mixed-fixed',mode);assert.equal(result.unresolvedFixed,mode==='unresolved'||mode.startsWith('mixed'),mode);assert.equal(bookingRelationshipFixedProtection(b,removal,context),['known','unresolved','mixed-fixed','mixed-soft'].includes(mode),mode);
  }
});
