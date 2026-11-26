import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bookingRelationshipReviewContext, blueprintBookingConstraintsFromTravelBookings, type BookingRelationshipAssessment, compileTripBlueprint, TRIP_BLUEPRINT_SCHEMA_VERSION, type ResearchSet, type TripBlueprint, type TravelAdjustmentInput, type TravelAdjustmentObservation } from '@c-assistant/core';
import { SqliteWorkspaceStore } from './index.js';
const now='2026-11-17T02:00:00.000Z';
function fixture(path:string,bind=true,adjustReplacement?:(blueprint:TripBlueprint)=>void,withFixedBooking=false) {
  const store=new SqliteWorkspaceStore(path),session=store.createPlanningSession('travel');
  store.savePlanningSession({...session,status:'proposal_ready',proposal:{version:1,title:'虚构东京',objective:'游览',theme:'文化',segments:['Tokyo'],skeleton:['2026-11-17'],tradeoffs:[],assumptions:[],decisionPoints:[]}});
  store.confirmPlanningSession(session.id,1);
  const shared={generationKey:`${session.id}:1:interactive-trip-planner@0.2.0`,proposalRef:{sessionId:session.id,proposalVersion:1},skillLineage:{skillId:'interactive-trip-planner',skillVersion:'0.2.0'}};
  store.saveBlueprintGeneration({...shared,status:'running',stage:'research',createdAt:now,updatedAt:now});
  const research:ResearchSet={schemaVersion:TRIP_BLUEPRINT_SCHEMA_VERSION,id:'研究',...shared,status:'completed',batches:[],places:[{id:'a',name:'虚构公园',city:'Tokyo',locationLabel:'Tokyo',category:'sight',durationMinutes:30,priority:'preferred',coordinates:[35.68,139.76],whyWorthIt:'虚构测试',plan:'游览',evidence:[]}],events:[],sources:[],actionRequirements:[],createdAt:now,updatedAt:now,completedAt:now};
  store.saveResearchSet(research);
  let blueprint:TripBlueprint={schemaVersion:TRIP_BLUEPRINT_SCHEMA_VERSION,id:'蓝图',version:1,...shared,researchSetId:research.id,title:'虚构东京',summary:'隔离旅行',language:'en',destinations:['Tokyo'],startDate:'2026-11-17',endDate:'2026-11-17',places:research.places,events:[],sources:[],days:[{id:'d',date:'2026-11-17',kind:'scheduled',city:'Tokyo',title:'游览',summary:'虚构',stops:[{placeId:'a',order:1,time:'09:00'}],candidatePlaceIds:[]}],movements:[],actionRequirements:[],createdAt:now};
  if(withFixedBooking){
    const source=store.saveTravelBooking({id:'固定真实源',planningSessionId:session.id,type:'ticket',status:'confirmed',title:'虚构固定公园场次',source:'user',sourceHash:'fictional-fixed-source',sourceLabel:'虚构旅人声明',importedAt:now,updatedAt:now,constraintStrength:'hard',segments:[{id:'固定真实源分段',segmentType:'event_window',title:'固定公园场次',status:'confirmed',startAtLocal:'2026-11-17T09:00',startTimeZone:'Asia/Tokyo',endAtLocal:'2026-11-17T09:30',endTimeZone:'Asia/Tokyo',location:'Tokyo',constraintStrength:'hard',fixedCommitment:true,needsReviewReasons:[]}]});
    blueprint.bookingConstraints=blueprintBookingConstraintsFromTravelBookings([source]);
  }
  store.saveTripBlueprint(blueprint);store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint,{createdAt:now}));
  if(withFixedBooking){
    const w=store.getWorkspace(),context=bookingRelationshipReviewContext(blueprint),evidenceRefs=['traveler-declaration:虚构固定到访'];
    const assessment:BookingRelationshipAssessment={schemaVersion:1,blueprintId:blueprint.id,blueprintVersion:blueprint.version,universeDigest:context.universeDigest,status:'reviewed',units:context.units.map(unit=>({...unit,coverage:'complete',relations:[{id:'固定直接承诺',scope:'occurrence',targets:[{kind:'occurrence',dayId:'d',placeId:'a'}],role:'direct_commitment',operations:['remove','move','add','priority'],rationale:'虚构旅人确认固定票直接对应公园到访',evidenceRefs}],rationale:'已完整核对固定预订及全部跨日依赖',evidenceRefs})),decision:{source:'traveler',actorId:'local-traveler',decidedAt:now,rationale:'已明确审阅完整行程固定承诺',evidenceRefs,obligations:['核对全部直接、间接和跨日依赖']}};
    store.applyDirectBlueprintRevisionBatch({expectedPlanId:w.activePlan.id,expectedVersion:w.activePlan.version,expectedBlueprintVersion:blueprint.version,revisions:[{kind:'review_booking_relationships',assessment,expectedSourceSetDigest:store.getCurrentTravelBookingSourceSetDigest(w.activePlan.id),createdAt:now}]});
    blueprint=store.getWorkspace().activeBlueprint!;
  }
  store.confirmPlan(store.getWorkspace().activePlan.id);
  store.email.updateSettings({recipient:'fixture@example.test',cityTimeZones:{Tokyo:'Asia/Tokyo'}});store.email.beginVerification('000000','2026-11-17T02:15:00.000Z');store.email.finishVerificationSend(store.email.settings().revision,'accepted');store.email.verifyRecipient('000000',now);store.email.setEnabled(true);
  store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'on_trip',basis:'traveler_statement',recordedAt:now,evidenceRefs:['traveler:fixture']});
  const context=store.captureAdjustmentContext(),next={...blueprint,version:blueprint.version+1,summary:'可靠变化后的完整替代'};adjustReplacement?.(next);store.saveTripBlueprint(next);
  store.createCompiledBlueprintPlan(compileTripBlueprint(next,{createdAt:now}),'codex',undefined,bind?{input:{context,observations:[observation()],decision:decision(),now},verifyExecution:()=>true}:undefined);
  return store;
}
const observation=(status:TravelAdjustmentObservation['status']='changed'):TravelAdjustmentObservation=>({key:'venue:d:a',fingerprint:status==='changed'?'关闭':null,objectRef:'d:a',sourceKind:'venue',provider:'fixture',targetDate:'2026-11-17',timeZone:'Asia/Tokyo',factObservedAt:now,retrievedAt:now,validUntil:'2026-11-17T03:00:00.000Z',status,reason:'虚构已核实来源',evidenceRefs:['public:fixture']});
const decision=():NonNullable<TravelAdjustmentInput['decision']>=>({verdict:'eligible',changeKind:'objective_disruption',agentId:'fixture-agent',modelId:'fixture-model',executionRef:'fixture-execution',rationale:'负责Agent确认客观事件与完整替代',obligations:['完整核对旅行与预订'],evidenceRefs:['public:fixture']});
function request(store:SqliteWorkspaceStore,requestId='请求'):TravelAdjustmentInput {const w=store.getWorkspace();return {requestId,context:store.captureAdjustmentContext(),observations:[observation()],decision:{verdict:'eligible',changeKind:'objective_disruption',agentId:'fixture-agent',modelId:'fixture-model',executionRef:'fixture-execution',rationale:'负责Agent确认客观事件与完整替代',obligations:['完整核对旅行与预订'],evidenceRefs:['public:fixture']},replacement:{planId:w.activePlan.id,version:w.activePlan.version,blueprintVersion:w.activeBlueprint?.version??1,proposalDigest:store.travelAdjustmentProposalDigest()},now};}
const authority={verifyExecution:()=>true};
function confirmedConsumption(path:string) {
 const store=fixture(path);
 store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'pre_departure',basis:'traveler_statement',recordedAt:now,evidenceRefs:['traveler:虚构出发前声明']});
 const context=store.captureAdjustmentContext(),w=store.getWorkspace(),proposalDigest=store.travelAdjustmentProposalDigest();
 store.confirmPlan(w.activePlan.id,w.activePlan.version,{adjustmentContext:context,proposalDigest,expectedBase:context.execution!,expectedBlueprintVersion:w.activeBlueprint!.version,expectedRecipientRevision:context.recipientRevision,confirmedAt:now});
 return {store,requestId:'manual:'+proposalDigest};
}
function isolated(run:(path:string)=>void){const dir=mkdtempSync(join(tmpdir(),'landi-adjustment-'));try{run(join(dir,'fixture.sqlite'));}finally{rmSync(dir,{recursive:true,force:true});}}

test('可信邮件消费只读取真实出发前确认，磁盘重开与交接ACK不丢完整事实',()=>isolated(path=>{
 let {store,requestId}=confirmedConsumption(path);
 const original=store.getTravelAdjustmentEmailConsumption(requestId,now);assert.ok(original);
 assert.equal(original.decision,null);assert.deepEqual(original.observations,[]);assert.deepEqual(original.receipt.events,[]);
 assert.equal(original.confirmation!.confirmedAt,now);assert.equal(original.context.phase.value,'pre_departure');
 store.close();store=new SqliteWorkspaceStore(path);assert.deepEqual(store.getTravelAdjustmentEmailConsumption(requestId,now),original);
 store.acknowledgeTravelAdjustmentHandoff(original.receipt.handoff!.intentId,'email-outbox:虚构持久读回');
 assert.equal(store.getTravelAdjustmentEmailConsumption(requestId,now)!.receipt.handoff!.status,'acknowledged');
 assert.equal(store.getTravelAdjustmentEmailConsumption('不存在',now),undefined);assert.equal(store.getTravelAdjustmentEmailConsumption(requestId,'不是时刻'),undefined);store.close();
}));

test('真实客观应用虽有布尔核验与自报执行引用，缺持久公开核验仍拒绝邮件消费',()=>isolated(path=>{
 let store=fixture(path);const input=request(store,'缺持久公开执行核验'),receipt=store.commitTravelAdjustment(input,authority);assert.equal(receipt.status,'applied');store.close();
 store=new SqliteWorkspaceStore(path);assert.equal(store.getTravelAdjustmentEmailConsumption(input.requestId,now),undefined);assert.equal(store.getTravelAdjustmentReceipt(input.requestId)!.status,'applied');store.close();
}));

test('同一替代精确版本存在多个已生效交接时磁盘重开拒绝歧义',()=>isolated(path=>{
 let {store,requestId}=confirmedConsumption(path);assert.ok(store.getTravelAdjustmentEmailConsumption(requestId,now));store.close();
 const db=new DatabaseSync(path),other='虚构重复应用请求',intent='虚构重复应用交接';
 db.prepare(`INSERT INTO travel_adjustment_receipts
   SELECT ?,request_digest,context_json,observations_json,decision_json,json_set(result_json,'$.requestId',?,'$.handoff.requestId',?,'$.handoff.intentId',?)
   FROM travel_adjustment_receipts WHERE request_id=?`).run(other,other,other,intent,requestId);
 db.prepare(`INSERT INTO travel_adjustment_handoffs
   SELECT ?,?,json_set(content_json,'$.requestId',?,'$.intentId',?) FROM travel_adjustment_handoffs WHERE request_id=?`).run(intent,other,other,intent,requestId);db.close();
 store=new SqliteWorkspaceStore(path);
 assert.equal(store.getTravelAdjustmentEmailConsumption(requestId,now),undefined);assert.equal(store.getTravelAdjustmentEmailConsumption(other,now),undefined);
 assert.equal(store.getTravelAdjustmentReceipt(requestId)!.status,'applied');assert.equal(store.listPendingTravelAdjustmentHandoffs().length,2);store.close();
}));

test('消费多次查询共享磁盘快照，并发授权暂停仅在下一次消费读取生效',()=>isolated(path=>{
 const {store,requestId}=confirmedConsumption(path),db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL');db.close();
 const writer=new SqliteWorkspaceStore(path),settings=store.email.settings.bind(store.email);
 let changed=false;
 store.email.settings=()=>{if(!changed){changed=true;writer.email.setEnabled(false);}return settings();};
 try{
  assert.ok(store.getTravelAdjustmentEmailConsumption(requestId,now));assert.equal(changed,true);
  assert.equal(store.getTravelAdjustmentEmailConsumption(requestId,now),undefined);assert.equal(writer.email.settings().enabled,false);
 }finally{writer.close();store.close();}
}));

for(const kind of ['暂停','时区更正','收件地址更正','确认缺失','确认旧基线','确认时间不符','错请求','错版本','错蓝图来源','丢失快照','跨表快照冲突','阶段错误','摘要冲突','伪造判断','迟到执行'] as const)test('可信消费磁盘反例拒绝且保留生效事实：'+kind,()=>isolated(path=>{
 let {store,requestId}=confirmedConsumption(path);assert.ok(store.getTravelAdjustmentEmailConsumption(requestId,now));
 const receipt=store.getTravelAdjustmentReceipt(requestId)!;
 if(kind==='暂停')store.email.setEnabled(false);
 if(kind==='时区更正')store.email.updateSettings({recipient:store.email.settings().recipient,cityTimeZones:{Tokyo:'Asia/Shanghai'}});
 if(kind==='收件地址更正')store.email.updateSettings({recipient:'another-fixture@example.test',cityTimeZones:{Tokyo:'Asia/Tokyo'}});
 store.close();const db=new DatabaseSync(path);
 if(kind==='确认缺失')db.exec('DELETE FROM email_plan_confirmations');
 if(kind==='确认旧基线')db.exec('UPDATE email_plan_confirmations SET base_version=999');
 if(kind==='确认时间不符')db.exec("UPDATE email_plan_confirmations SET confirmed_at='2026-11-17T01:59:00.000Z'");
 if(kind==='错请求')db.exec("UPDATE travel_adjustment_handoffs SET content_json=json_set(content_json,'$.requestId','错误请求')");
 if(kind==='错版本')db.exec("UPDATE travel_adjustment_receipts SET context_json=json_set(context_json,'$.draft.version',999)");
 if(kind==='错蓝图来源')db.prepare('UPDATE plan_blueprint_lineage SET blueprint_version=? WHERE plan_id=?').run(receipt.handoff!.base.blueprint.version,receipt.handoff!.replacement.plan.id);
 if(kind==='丢失快照')db.exec("UPDATE travel_adjustment_handoffs SET content_json=json_remove(content_json,'$.arrangement.blueprint')");
 if(kind==='跨表快照冲突')db.exec("UPDATE travel_adjustment_handoffs SET content_json=json_set(content_json,'$.arrangement.plan.title','错误安排')");
 if(kind==='阶段错误')db.exec("UPDATE travel_adjustment_receipts SET context_json=json_set(context_json,'$.phase.value','on_trip')");
 if(kind==='摘要冲突')db.exec("UPDATE travel_adjustment_receipts SET request_digest='错误摘要'");
 if(kind==='伪造判断')db.exec("UPDATE travel_adjustment_receipts SET decision_json='{}'");
 if(kind==='迟到执行')db.prepare('UPDATE plans SET version=version+1 WHERE id=?').run(receipt.handoff!.replacement.plan.id);
 db.close();store=new SqliteWorkspaceStore(path);
 assert.equal(store.getTravelAdjustmentEmailConsumption(requestId,now),undefined);assert.equal(store.getTravelAdjustmentReceipt(requestId)!.status,'applied');store.close();
}));

test('原子应用重开、丢回执与交接读回，不伪造人工确认',()=>isolated(path=>{
  let store=fixture(path);const input=request(store),old=input.context.execution!;
  const result=store.commitTravelAdjustment(input,authority);assert.equal(result.status,'applied');assert.equal(result.basis,'objective_change');assert.equal(store.getExecutionPlan()!.id,input.replacement!.planId);assert.equal(store.email.planConfirmation(input.replacement!.planId,input.replacement!.version),undefined);
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);store.close();store=new SqliteWorkspaceStore(path);
  assert.deepEqual(store.commitTravelAdjustment(input,authority),result);assert.equal(store.getTravelAdjustmentReceipt(input.requestId)!.status,'applied');
  assert.equal(store.readTravelAdjustmentArrangement(input.requestId)!.plan.id,input.replacement!.planId);assert.notEqual(old.id,store.getExecutionPlan()!.id);
  store.acknowledgeTravelAdjustmentHandoff(result.handoff!.intentId,'persistent-consumer:fixture');assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);assert.equal(store.getTravelAdjustmentReceipt(input.requestId)!.handoff!.status,'acknowledged');store.close();
}));

test('公共合同缺失、主观判断与未知阶段保留旧执行和未决',()=>isolated(path=>{
  const store=fixture(path),old=store.getExecutionPlan()!.id;
  assert.equal(store.commitTravelAdjustment(request(store,'缺公共')).status,'unresolved');assert.equal(store.listTravelAdjustmentObservations(old,1)[0]!.lastReliable,null);
  const subjective=request(store,'主观');subjective.decision!.changeKind='subjective_preference';assert.equal(store.commitTravelAdjustment(subjective,authority).status,'unresolved');
  store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'unknown',basis:'unresolved',recordedAt:now,evidenceRefs:[]});
  assert.equal(store.commitTravelAdjustment(request(store,'未知阶段'),authority).status,'unresolved');assert.equal(store.getExecutionPlan()!.id,old);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);store.close();
}));

test('授权与阶段并发拒绝陈旧观察，完整判断运行时校验',()=>isolated(path=>{
  const store=fixture(path),input=request(store);store.email.setEnabled(false);
  assert.equal(store.commitTravelAdjustment(input,authority).status,'rejected');assert.equal(store.listTravelAdjustmentObservations(input.context.execution!.id,1).length,0);
  const malformed=request(store,'坏判断');(malformed.decision as any).modelId=undefined;assert.throws(()=>store.commitTravelAdjustment(malformed,authority),/结构无效|缺少/);store.close();
}));

test('事务末端故障全部回滚，恢复后仅应用一次',()=>isolated(path=>{
  const store=fixture(path),input=request(store),before=store.getExecutionPlan()!.id,db=new DatabaseSync(path);
  db.exec("CREATE TRIGGER fail_adjustment BEFORE INSERT ON travel_adjustment_receipts BEGIN SELECT RAISE(ABORT,'注入事务故障'); END");
  assert.throws(()=>store.commitTravelAdjustment(input,authority),/注入事务故障/);assert.equal(store.getExecutionPlan()!.id,before);assert.equal(store.listTravelAdjustmentObservations(before,1).length,0);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);assert.equal(store.getTravelAdjustmentReceipt(input.requestId),undefined);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM travel_episodes').get()!.count,0);
  db.exec('DROP TRIGGER fail_adjustment');assert.equal(store.commitTravelAdjustment(input,authority).status,'applied');assert.throws(()=>store.commitTravelAdjustment({...input,now:'2026-11-17T02:01:00.000Z'},authority),/身份/);db.close();store.close();
}));

test('无关新草稿与来源过期不能替换执行旅行',()=>isolated(path=>{
  const store=fixture(path),old=store.getExecutionPlan()!.id;
  store.createPlan({request:'虚构无关新旅行'});assert.equal(store.commitTravelAdjustment(request(store,'无关草稿'),authority).status,'unresolved');assert.equal(store.getExecutionPlan()!.id,old);
  const expired=request(store,'过期');expired.observations[0]!.validUntil='2026-11-17T01:00:00Z';assert.equal(store.commitTravelAdjustment(expired,authority).status,'unresolved');store.close();
}));

test('两连接同事件复用持久应用结果',()=>isolated(path=>{
  const store=fixture(path),input=request(store),other=new SqliteWorkspaceStore(path);const result=store.commitTravelAdjustment(input,authority);
  assert.deepEqual(other.commitTravelAdjustment({...input,requestId:'另一连接'},authority),result);assert.equal(other.listPendingTravelAdjustmentHandoffs().length,1);other.close();store.close();
}));

test('可靠恢复结束原事件，再异常新增episode；失败不覆盖最后可靠事实',()=>isolated(path=>{
  const store=fixture(path);const first=request(store,'首次异常');delete first.replacement;const opened=store.commitTravelAdjustment(first,authority);assert.equal(opened.events[0]!.episode,1);
  const failure=request(store,'来源失败');delete failure.replacement;delete failure.decision;failure.observations=[{...observation('failed'),fingerprint:null}];store.commitTravelAdjustment(failure);
  let rows=store.listTravelAdjustmentObservations(first.context.execution!.id,1);assert.equal(rows[0]!.observation.status,'failed');assert.equal(rows[0]!.lastReliable!.status,'changed');
  const recovery=request(store,'可靠恢复');delete recovery.replacement;recovery.observations=[observation('unchanged')];recovery.decision!.changeKind='none';const recovered=store.commitTravelAdjustment(recovery,authority);assert.equal(recovered.status,'observed');assert.equal(recovered.events[0]!.status,'recovered');
  const again=request(store,'再次异常');delete again.replacement;assert.equal(store.commitTravelAdjustment(again,authority).events[0]!.episode,2);store.close();
}));

test('精确人工确认落独立真实依据与持久交接，时区更正也使旧授权失效',()=>isolated(path=>{
  const store=fixture(path);store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'pre_departure',basis:'traveler_statement',recordedAt:now,evidenceRefs:['traveler:出发前明确陈述']});
  const before=store.captureAdjustmentContext(),w=store.getWorkspace(),digest=store.travelAdjustmentProposalDigest();
  store.email.updateSettings({recipient:store.email.settings().recipient,cityTimeZones:{Tokyo:'Asia/Shanghai'}});
  assert.equal(store.email.settings().revision,before.recipientRevision);assert.throws(()=>store.confirmPlan(w.activePlan.id,w.activePlan.version,{adjustmentContext:before,proposalDigest:digest}),/变化/);
  const current=store.captureAdjustmentContext();store.confirmPlan(w.activePlan.id,w.activePlan.version,{adjustmentContext:current,proposalDigest:digest,expectedBase:current.execution!,expectedBlueprintVersion:w.activeBlueprint!.version});
  const receipt=store.getTravelAdjustmentReceiptForPlan(w.activePlan.id,w.activePlan.version)!;assert.equal(receipt.basis,'user_confirmation');assert.ok(store.email.planConfirmation(w.activePlan.id,w.activePlan.version));assert.equal(receipt.handoff!.status,'pending');
  assert.equal(store.captureAdjustmentContext().phase.value,'unknown');store.close();
}));

test('候选按封闭类型保存，额外私密字段与跨来源类型在运行时拒绝',()=>isolated(path=>{
  const store=fixture(path),input=request(store,'安全候选');delete input.decision;delete input.replacement;
  input.observations[0]!.candidate={kind:'venue',name:'虚构公园',city:'Tokyo',matches:[{name:'虚构公园',city:'Tokyo',status:'temporarily_closed'}],queryObservedAt:now};
  assert.equal(store.commitTravelAdjustment(input).status,'unresolved');assert.equal(store.listTravelAdjustmentObservations(input.context.execution!.id,1)[0]!.lastReliable,null);
  const bad=request(store,'非法字段');(bad.observations[0] as any).confirmationCode='虚构禁用字段';assert.throws(()=>store.commitTravelAdjustment(bad),/不支持/);
  const mismatch=request(store,'错来源类型');mismatch.observations[0]!.candidate={kind:'saved_booking',bookingId:'虚构',segmentId:'虚构',status:'confirmed',segmentStatus:'confirmed',bookingConstraintStrength:'hard',segmentConstraintStrength:'hard',fixedCommitment:true};assert.throws(()=>store.commitTravelAdjustment(mismatch),/候选结构/);store.close();
}));

test('阶段绑定精确执行修订，陈旧阶段写与有缺口完整替代均拒绝',()=>isolated(path=>{
  const store=fixture(path),context=store.captureAdjustmentContext();
  store.recordTravelPhase({context,value:'unknown',basis:'unresolved',recordedAt:now,evidenceRefs:[]});assert.throws(()=>store.recordTravelPhase({context,value:'on_trip',basis:'traveler_statement',recordedAt:now,evidenceRefs:['traveler:旧依据']}),/变化/);
  assert.equal(store.captureAdjustmentContext().phase.value,'unknown');store.close();
}));

test('Schema30受控打开保留原字节，Schema31标记故障回滚所有新增表',()=>isolated(path=>{
  const initial=fixture(path),before=initial.getWorkspace();initial.close();const db=new DatabaseSync(path);
  const drop='DROP TABLE email_timing_current; DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DELETE FROM schema_migrations WHERE version>=31';db.exec(drop);
  const digest=createHash('sha256').update(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all())).digest('hex');db.close();
  const bytes=readFileSync(path);const guarded=new SqliteWorkspaceStore(path,{guardedSchemaSha256:digest});assert.equal(guarded.getDatabaseMaintenanceStatus().schemaVersion,30);assert.deepEqual(guarded.getWorkspace(),before);guarded.close();assert.deepEqual(readFileSync(path),bytes);
  const fault=new DatabaseSync(path);fault.exec("CREATE TRIGGER fail_schema31 BEFORE INSERT ON schema_migrations WHEN NEW.version=31 BEGIN SELECT RAISE(ABORT,'隔离阶段迁移故障'); END");assert.throws(()=>new SqliteWorkspaceStore(path),/隔离阶段迁移故障/);assert.equal(fault.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'travel_%' AND name!='travel_bookings'").get()!.n,0);assert.equal(fault.prepare('SELECT max(version) AS n FROM schema_migrations').get()!.n,30);fault.exec('DROP TRIGGER fail_schema31');fault.close();
  const recovered=new SqliteWorkspaceStore(path);assert.equal(recovered.getDatabaseMaintenanceStatus().schemaVersion,32);assert.deepEqual(recovered.getWorkspace(),before);recovered.close();
}));

test('同Blueprint无关既存草稿不能借事件判断应用，也不能事后登记',()=>isolated(path=>{
  const store=fixture(path,false),input=request(store,'无关同蓝图'),before=store.getWorkspace();
  const result=store.commitTravelAdjustment(input,authority);assert.equal(result.status,'unresolved');assert.match(result.reason,/不属于本次/);assert.equal(store.getExecutionPlan()!.id,input.context.execution!.id);assert.equal(store.getWorkspace().activePlan.id,before.activePlan.id);
  assert.throws(()=>store.createCompiledBlueprintPlan(compileTripBlueprint(before.activeBlueprint!,{createdAt:now}),'codex',undefined,{input:{context:store.captureAdjustmentContext(),observations:[observation()],decision:decision(),now},verifyExecution:()=>true}),/已有草稿/);
  const newer={...structuredClone(before.activeBlueprint!),version:3};store.saveTripBlueprint(newer);
  assert.throws(()=>store.createCompiledBlueprintPlan(compileTripBlueprint(newer,{createdAt:now}),'codex',undefined,{input:{context:store.captureAdjustmentContext(),observations:[observation()],decision:decision(),now},verifyExecution:()=>true}),/原执行版本/);assert.equal(store.getWorkspace().activePlan.id,before.activePlan.id);store.close();
}));

test('旅行事件跨执行版本与重开只应用一次，可靠恢复才开启新episode',()=>isolated(path=>{
 let store=fixture(path);const first=store.commitTravelAdjustment(request(store,'应用A到B'),authority);assert.equal(first.status,'applied');
 assert.equal(store.captureAdjustmentContext().phase.value,'unknown');store.close();store=new SqliteWorkspaceStore(path);
 store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'on_trip',basis:'traveler_statement',recordedAt:now,evidenceRefs:['traveler:新版仍在途中']});
 const base=store.captureAdjustmentContext(),blueprint=structuredClone(store.getWorkspace().activeBlueprint!);blueprint.version++;
 const changed=observation();changed.fingerprint='同未恢复事件的另一来源摘要';store.saveTripBlueprint(blueprint);
 store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint,{createdAt:now}),'codex',undefined,{input:{context:base,observations:[changed],decision:decision(),now},verifyExecution:()=>true});
 const second=request(store,'试图B到C');second.observations=[changed];const blocked=store.commitTravelAdjustment(second,authority);assert.equal(blocked.status,'unresolved');assert.match(blocked.reason,/同一旅行事件/);assert.equal(blocked.events[0]!.eventId,first.events[0]!.eventId);assert.equal(store.getExecutionPlan()!.id,first.handoff!.replacement.plan.id);
 const other=new SqliteWorkspaceStore(path);const concurrent=request(other,'另一连接重试C');concurrent.observations=[changed];assert.equal(other.commitTravelAdjustment(concurrent,authority).status,'unresolved');other.close();
 const dateCandidate=request(store,'同对象不同适用日期');delete dateCandidate.replacement;dateCandidate.observations=[{...changed,targetDate:'2026-11-18'}];const otherDate=store.commitTravelAdjustment(dateCandidate,authority);assert.notEqual(otherDate.events[0]!.eventId,first.events[0]!.eventId);assert.equal(otherDate.events[0]!.episode,1);assert.doesNotMatch(otherDate.reason,/同一旅行事件/);
 const renamed=request(store,'同对象日期改候选键');delete renamed.replacement;renamed.observations=[{...changed,key:'另一个组织键'}];assert.equal(store.commitTravelAdjustment(renamed,authority).events[0]!.eventId,first.events[0]!.eventId);
 const recovery=request(store,'跨版本可靠恢复');delete recovery.replacement;recovery.observations=[observation('unchanged')];recovery.decision!.changeKind='none';assert.equal(store.commitTravelAdjustment(recovery,authority).events[0]!.status,'recovered');
 const again=request(store,'恢复后再异常');delete again.replacement;const reopened=store.commitTravelAdjustment(again,authority);assert.equal(reopened.events[0]!.episode,2);assert.notEqual(reopened.events[0]!.eventId,first.events[0]!.eventId);assert.doesNotMatch(reopened.reason,/同一旅行事件/);store.close();
}));

test('已应用事件可靠恢复后，同对象再次异常可创建并应用新episode',()=>isolated(path=>{
 const store=fixture(path);const first=store.commitTravelAdjustment(request(store,'首次应用'),authority);assert.equal(first.status,'applied');
 store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'on_trip',basis:'traveler_statement',recordedAt:now,evidenceRefs:['traveler:继续旅行']});
 const recovery=request(store,'恢复后新周期');delete recovery.replacement;recovery.observations=[observation('unchanged')];recovery.decision!.changeKind='none';assert.equal(store.commitTravelAdjustment(recovery,authority).status,'observed');
 const context=store.captureAdjustmentContext(),next=structuredClone(store.getWorkspace().activeBlueprint!);next.version++;store.saveTripBlueprint(next);
 store.createCompiledBlueprintPlan(compileTripBlueprint(next,{createdAt:now}),'codex',undefined,{input:{context,observations:[observation()],decision:decision(),now},verifyExecution:()=>true});
 const second=store.commitTravelAdjustment(request(store,'新周期应用'),authority);assert.equal(second.status,'applied',second.reason);assert.equal(second.events[0]!.episode,2);assert.notEqual(second.applicationKey,first.applicationKey);assert.notEqual(second.events[0]!.eventId,first.events[0]!.eventId);store.close();
}));

for(const recovered of [true,false])test(recovered?'已应用A可靠恢复后完整批次A无变化与B变化仍可应用B':'已应用A未恢复而本批次无变化时不能阻塞独立B变化',()=>isolated(path=>{
 let store=fixture(path);const first=store.commitTravelAdjustment(request(store,'应用事件A'),authority);assert.equal(first.status,'applied',first.reason);
 store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'on_trip',basis:'traveler_statement',recordedAt:now,evidenceRefs:['旅行者明确继续旅行']});
 if(recovered){const recovery=request(store,'恢复事件A');delete recovery.replacement;recovery.observations=[observation('unchanged')];recovery.decision!.changeKind='none';assert.equal(store.commitTravelAdjustment(recovery,authority).status,'observed');}
 const observations=[observation('unchanged'),{...observation(),key:'新事件B',objectRef:'独立场馆B',fingerprint:'虚构B闭馆'}];
 const context=store.captureAdjustmentContext(),next=structuredClone(store.getWorkspace().activeBlueprint!);next.version++;store.saveTripBlueprint(next);
 store.createCompiledBlueprintPlan(compileTripBlueprint(next,{createdAt:now}),'codex',undefined,{input:{context,observations,decision:decision(),now},verifyExecution:()=>true});
 const input=request(store,'应用独立事件B');input.observations=observations;
 const result=store.commitTravelAdjustment(input,authority);assert.equal(result.status,'applied',result.reason);
 assert.equal(result.events.find(event=>event.key===observation().key)!.status,recovered?'recovered':'open');
 assert.equal(result.events.find(event=>event.key==='新事件B')!.status,'open');assert.equal(store.getExecutionPlan()!.id,input.replacement!.planId);
 const db=new DatabaseSync(path);assert.equal(db.prepare('SELECT applied_request_id AS id FROM travel_episodes WHERE event_id=?').get(first.events[0]!.eventId)!.id,'应用事件A');
 assert.equal(db.prepare('SELECT applied_request_id AS id FROM travel_episodes WHERE event_id=?').get(result.events.find(event=>event.key==='新事件B')!.eventId)!.id,'应用独立事件B');db.close();
 store.close();store=new SqliteWorkspaceStore(path);assert.deepEqual(store.getTravelAdjustmentReceipt('应用独立事件B'),result);assert.equal(store.getExecutionPlan()!.id,input.replacement!.planId);store.close();
}));

test('完整替代缺活动占时时保留旧执行与草稿，明确占时的同路径正例可应用',()=>isolated(path=>{
 let store=fixture(path,true,next=>{delete next.places[0]!.durationMinutes;});
 const before=store.getExecutionPlan(),draft=store.getWorkspace().activePlan,input=request(store,'缺少活动占时');
 const control=fixture(path+'.明确占时');const accepted=control.commitTravelAdjustment(request(control,'明确活动占时'),authority);assert.equal(accepted.status,'applied',accepted.reason);control.close();
 const result=store.commitTravelAdjustment(input,authority);assert.equal(result.status,'unresolved');assert.match(result.reason,/完整替代安排未通过/);assert.deepEqual(store.getExecutionPlan(),before);assert.deepEqual(store.getWorkspace().activePlan,draft);
 store.close();store=new SqliteWorkspaceStore(path);assert.deepEqual(store.getTravelAdjustmentReceipt(input.requestId),result);assert.deepEqual(store.getExecutionPlan(),before);assert.deepEqual(store.getWorkspace().activePlan,draft);store.close();
}));


for(const kind of ['负占时','倒置区块','末活动跨日'] as const)test('真实替代提交保留旧执行并持久未决：'+kind,()=>isolated(path=>{
 let store=fixture(path,true,next=>{
  if(kind==='负占时')next.places[0]!.durationMinutes=-30;
  if(kind==='倒置区块')next.days[0]!.blocks=[{id:'倒置活动',kind:'stop',placeId:'a',order:1,startTime:'09:00',endTime:'08:00',evidence:[]}];
  if(kind==='末活动跨日'){next.days[0]!.stops[0]!.time='23:50';next.places[0]!.durationMinutes=120;}
 });
 const before=store.getExecutionPlan(),draft=store.getWorkspace().activePlan,input=request(store,'损坏区间'+kind);
 const result=store.commitTravelAdjustment(input,authority);
 assert.equal(result.status,'unresolved',result.reason);assert.match(result.reason,/完整替代安排未通过/);
 assert.deepEqual(store.getExecutionPlan(),before);assert.deepEqual(store.getWorkspace().activePlan,draft);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
 store.close();store=new SqliteWorkspaceStore(path);
 assert.deepEqual(store.getTravelAdjustmentReceipt(input.requestId),result);assert.deepEqual(store.getExecutionPlan(),before);assert.deepEqual(store.getWorkspace().activePlan,draft);store.close();
}));

test('真实固定预订经正规关系审阅后可靠客观变化原子自动应用并重开读回',()=>isolated(path=>{
 let store=fixture(path,true,undefined,true);
 try{
  const before=store.getExecutionPlan()!,w=store.getWorkspace();
  assert.ok(w.activeBlueprint!.bookingConstraints!.some(booking=>booking.constraintStrength==='hard'&&booking.segments.some(segment=>segment.fixedCommitment)));
  assert.ok(w.activeBlueprint!.bookingRelationshipAssessment!.blueprintVersion<w.activeBlueprint!.version);
  const input=request(store,'固定真实预订自动应用'),result=store.commitTravelAdjustment(input,authority);
  assert.equal(result.status,'applied');assert.equal(result.basis,'objective_change');
  assert.notEqual(store.getExecutionPlan()!.id,before.id);
  assert.equal(store.email.planConfirmation(w.activePlan.id,w.activePlan.version),undefined);
  store.close();store=new SqliteWorkspaceStore(path);
  assert.equal(store.getTravelAdjustmentReceipt(input.requestId)!.status,'applied');
  assert.deepEqual(store.readTravelAdjustmentArrangement(input.requestId)!.blueprint.bookingConstraints,w.activeBlueprint!.bookingConstraints);
 }finally{store.close();}
}));


for(const fingerprint of [null,undefined,'','  ','\t'])for(const mixed of [false,true])test(`变化身份无效时整批未决并持久保留原执行与草稿：${String(fingerprint)}，混合=${mixed}`,()=>isolated(path=>{
 let store=fixture(path);const before=store.getExecutionPlan(),draft=store.getWorkspace().activePlan,input=request(store,'无身份批次');
 const invalid={...observation(),key:'无身份变化',objectRef:'独立无身份对象',fingerprint} as TravelAdjustmentObservation;
 input.observations=mixed?[observation(),invalid]:[invalid];
 const result=store.commitTravelAdjustment(input,authority);
 assert.equal(result.status,'unresolved');assert.match(result.reason,/事件/);assert.equal(result.handoff,undefined);
 assert.deepEqual(store.getExecutionPlan(),before);assert.deepEqual(store.getWorkspace().activePlan,draft);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
 const rows=store.listTravelAdjustmentObservations(input.context.execution!.id,input.context.execution!.version);
 assert.equal(rows.find(row=>row.observation.key==='无身份变化')!.lastReliable,null);
 assert.ok(!result.events.some(event=>event.key==='无身份变化'&&event.status==='open'));
 store.close();store=new SqliteWorkspaceStore(path);
 assert.deepEqual(store.getTravelAdjustmentReceipt(input.requestId),JSON.parse(JSON.stringify(result)));assert.deepEqual(store.getExecutionPlan(),before);
 assert.deepEqual(store.commitTravelAdjustment(input,authority),JSON.parse(JSON.stringify(result)));assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);store.close();
}));

for(const fingerprint of [null,undefined,'','  '])for(const mixed of [false,true])test(`规范编译逐项拒绝无事件身份候选并保留已执行版本：${String(fingerprint)}，混合=${mixed}`,()=>isolated(path=>{
 const store=fixture(path);assert.equal(store.commitTravelAdjustment(request(store,'先应用可靠事件'),authority).status,'applied');
 store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'on_trip',basis:'traveler_statement',recordedAt:now,evidenceRefs:['旅行者明确仍在旅行']});
 const before=store.getWorkspace(),execution=store.getExecutionPlan(),context=store.captureAdjustmentContext(),next=structuredClone(before.activeBlueprint!);next.version++;store.saveTripBlueprint(next);
 const invalid={...observation(),key:'无身份新变化',objectRef:'独立无身份对象',fingerprint} as TravelAdjustmentObservation;
 assert.throws(()=>store.createCompiledBlueprintPlan(compileTripBlueprint(next,{createdAt:now}),'codex',undefined,{input:{context,observations:mixed?[observation(),invalid]:[invalid],decision:decision(),now},verifyExecution:()=>true}),/事件身份/);
 assert.deepEqual(store.getWorkspace().activePlan,before.activePlan);assert.deepEqual(store.getExecutionPlan(),execution);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);store.close();
}));

test('重复对象组织键不能形成部分事件覆盖或双重消费',()=>isolated(path=>{
 const store=fixture(path),input=request(store,'重复对象');input.observations=[observation(),{...observation(),key:'相同对象另一组织键'}];
 const before=store.getExecutionPlan();const result=store.commitTravelAdjustment(input,authority);
 assert.equal(result.status,'unresolved');assert.match(result.reason,/完整持久事件/);assert.deepEqual(store.getExecutionPlan(),before);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);store.close();
}));

test('事件消费被事务末端触发器忽略时不产生应用，可靠重试只消费一次',()=>isolated(path=>{
 const store=fixture(path),input=request(store,'消费失败'),before=store.getExecutionPlan(),db=new DatabaseSync(path);
 db.exec("CREATE TRIGGER ignore_consumption BEFORE UPDATE OF applied_request_id ON travel_episodes WHEN NEW.applied_request_id IS NOT NULL BEGIN SELECT RAISE(IGNORE); END");
 assert.throws(()=>store.commitTravelAdjustment(input,authority),/事件消费失败/);assert.deepEqual(store.getExecutionPlan(),before);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
 assert.equal(store.getTravelAdjustmentReceipt(input.requestId),undefined);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM travel_episodes').get()!.count,0);
 db.exec('DROP TRIGGER ignore_consumption');assert.equal(store.commitTravelAdjustment(input,authority).status,'applied');assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);db.close();store.close();
}));


test('交接意图保存末端故障回滚执行、消费、观察与回执，重试恢复一次',()=>isolated(path=>{
 const store=fixture(path),input=request(store,'交接存储失败'),before=store.getExecutionPlan(),db=new DatabaseSync(path);
 db.exec("CREATE TRIGGER fail_handoff BEFORE INSERT ON travel_adjustment_handoffs BEGIN SELECT RAISE(ABORT,'注入交接事务故障'); END");
 assert.throws(()=>store.commitTravelAdjustment(input,authority),/注入交接事务故障/);assert.deepEqual(store.getExecutionPlan(),before);
 assert.equal(store.getTravelAdjustmentReceipt(input.requestId),undefined);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);assert.equal(store.listTravelAdjustmentObservations(before!.id,before!.version).length,0);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM travel_episodes').get()!.count,0);
 db.exec('DROP TRIGGER fail_handoff');assert.equal(store.commitTravelAdjustment(input,authority).status,'applied');assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);db.close();store.close();
}));

test('两个独立进程同时提交同事件只切换一次，锁冲突重读同一持久结果',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'landi-adjustment-process-')),path=join(dir,'fixture.sqlite');
 const store=fixture(path),input=request(store,'并发原请求');store.close();
 const script=`import { SqliteWorkspaceStore } from ${JSON.stringify(new URL('./index.ts',import.meta.url).href)};
 const store=new SqliteWorkspaceStore(process.argv[1]);
 process.send({ready:true});
 process.once('message',input=>{const approved=structuredClone(input);try{const receipt=store.commitTravelAdjustment(input,{verifyExecution:(decision,current)=>JSON.stringify(current)===JSON.stringify(approved)&&JSON.stringify(decision)===JSON.stringify(approved.decision)});process.send({receipt});}catch(error){process.send({error:String(error)});}finally{store.close();process.disconnect();}});`;
 const children:ReturnType<typeof spawn>[]=[];
 try{
  const pending=[];
  for(const index of [0,1]){
   const child=spawn(process.execPath,['--import',new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).pathname,'--input-type=module','-e',script,path],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);
   let errors='';child.stderr!.on('data',chunk=>errors+=chunk);
   let ready!:()=>void;const readiness=new Promise<void>(resolve=>ready=resolve);
   let result:unknown;const finished=new Promise<{receipt?:ReturnType<SqliteWorkspaceStore['commitTravelAdjustment']>;error?:string}>((resolve,reject)=>{
    child.on('message',(message:any)=>{if(message.ready)ready();else result=message;});child.once('error',reject);child.once('exit',code=>code===0&&result?resolve(result as any):reject(new Error('并发子进程失败：'+errors)));
   });await Promise.race([readiness,finished.then(()=>{throw new Error('并发子进程未进入就绪状态。');})]);pending.push({child,readiness,finished,input:{...input,requestId:'独立进程请求'+index}});
  }
  await Promise.all(pending.map(p=>p.readiness));for(const p of pending)p.child.send(p.input);
  const results=await Promise.all(pending.map(p=>p.finished));assert.ok(results.some(r=>r.receipt?.status==='applied'));for(const result of results)if(result.error)assert.match(result.error,/database is locked/);
  const reopened=new SqliteWorkspaceStore(path);
  try{
   const reconciled=pending.map(p=>reopened.commitTravelAdjustment(p.input,authority));assert.equal(new Set(reconciled.map(r=>r.applicationKey)).size,1);assert.ok(reconciled.every(r=>r.status==='applied'));
   assert.equal(reopened.listPendingTravelAdjustmentHandoffs().length,1);assert.equal(reopened.getExecutionPlan()!.id,input.replacement!.planId);
   const db=new DatabaseSync(path);let consumed:number;
   try{consumed=Number(db.prepare('SELECT COUNT(*) AS count FROM travel_episodes WHERE applied_request_id IS NOT NULL').get()!.count);assert.equal(consumed,1);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM travel_adjustment_receipts').get()!.count,1);}finally{db.close();}
   console.log(JSON.stringify({场景:'两个真实独立进程同时提交',进程结果:results.map(r=>({状态:r.receipt?.status,锁冲突:Boolean(r.error)})),重读应用键数:new Set(reconciled.map(r=>r.applicationKey)).size,消费事件数:consumed,交接数:reopened.listPendingTravelAdjustmentHandoffs().length}));
  }finally{reopened.close();}
 }finally{for(const child of children)if(child.exitCode===null)child.kill();rmSync(dir,{recursive:true,force:true});}
});

test('邮件安排关联迁移失败原子回滚，恢复后保留既有旅行及不明投递历史',()=>isolated(path=>{
 const store=fixture(path),before=store.getWorkspace(),plan=store.getExecutionPlan()!;
 store.email.enqueue({id:'迁移前不明投递',planId:plan.id,planVersion:plan.version,kind:'change',date:'2026-12-01',dueAt:now,expiresAt:'2026-12-03T00:00:00Z',recipientRevision:store.email.settings().revision,content:{subject:'隔离历史',html:'<p>隔离历史</p>',text:'隔离历史'}});
 const claim=store.email.claim(plan.id,plan.version,now)!;store.email.settle(claim.id,claim.lease!,'uncertain',now,'email_delivery_unknown');const history=store.email.get(claim.id);store.close();
 const database=new DatabaseSync(path);database.exec("DROP TABLE email_timing_current; DELETE FROM schema_migrations WHERE version=32; CREATE TRIGGER isolated_timing_migration_failure BEFORE INSERT ON schema_migrations WHEN NEW.version=32 BEGIN SELECT RAISE(ABORT,'隔离安排迁移中断'); END;");
 assert.throws(()=>new SqliteWorkspaceStore(path),/隔离安排迁移中断/);
 assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='email_timing_current'").get(),undefined);
 assert.equal(database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,31);
 database.exec('DROP TRIGGER isolated_timing_migration_failure');database.close();
 const recovered=new SqliteWorkspaceStore(path);assert.equal(recovered.getDatabaseMaintenanceStatus().schemaVersion,32);assert.deepEqual(recovered.getWorkspace(),before);assert.deepEqual(recovered.email.get(claim.id),history);recovered.close();
}));
