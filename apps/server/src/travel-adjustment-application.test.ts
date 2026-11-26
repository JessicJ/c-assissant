import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import test from 'node:test';
import { copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import { SqliteWorkspaceStore } from '@c-assistant/storage';
import {bookingRelationshipDigest,compileTripBlueprint, type TravelAdjustmentInput, type TravelAdjustmentObservation} from '@c-assistant/core';
import {verifiedEmailFixture} from './email.fixture.test.js';
const {prepareTravelAdjustmentDevelopmentFixture}=await import(new URL('../../../tests/browser/travel-adjustment-development-fixture.ts',import.meta.url).href);
import {registerPlanManagementRoutes} from './plan-management-routes.js';
import {createTravelAdjustmentApplication,exactPlanConfirmation} from './travel-adjustment-application.js';
import {consumeTravelAdjustmentHandoffs,enqueueAppliedAdjustment,createEmailReviewDelivery} from './email-plan-review.js';
import {createEmailExecutionWorker} from './email-execution-worker.js';
import {emailJobId} from './email-schedule.js';

const now=new Date('2026-11-17T00:00:00Z');
const observation:TravelAdjustmentObservation={key:'虚构场馆到访',fingerprint:'虚构闭馆',objectRef:'fixture-place-1',sourceKind:'venue',provider:'虚构来源替身',targetDate:'2026-12-01',timeZone:'Asia/Tokyo',factObservedAt:now.toISOString(),retrievedAt:now.toISOString(),validUntil:'2026-12-02T00:00:00Z',status:'changed',reason:'虚构场馆闭馆，等待负责判断。',evidenceRefs:['https://fixture.invalid/closure']};
function evidence(name:string,value:unknown){const directory=process.env.LANDI_T3_EVIDENCE_DIRECTORY;if(directory){mkdirSync(directory,{recursive:true});writeFileSync(join(directory,name+'.json'),JSON.stringify(value,null,2));}}
async function fixture(automatic=false,scenario="workspace"){
 const dir=mkdtempSync(join(tmpdir(),'landi-adjustment-application-')),file=join(dir,'workspace.sqlite');
 if(!automatic){await prepareTravelAdjustmentDevelopmentFixture(file,scenario);return {dir,file,store:new SqliteWorkspaceStore(file)};}
 const {initializeWorkspaceFixture}=await import(new URL('../../../tests/browser/isolated-workspace-fixture.mjs',import.meta.url).href);initializeWorkspaceFixture(file);
 const store=new SqliteWorkspaceStore(file);const original=store.getWorkspace();verifiedEmailFixture(store);store.email.updateSettings({recipient:'traveler@example.test',cityTimeZones:Object.fromEntries(original.activeBlueprint!.days.map(day=>[day.city,'Asia/Tokyo']))});store.confirmPlan(original.activePlan.id);
 store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'on_trip',basis:'traveler_statement',recordedAt:now.toISOString(),evidenceRefs:['虚构旅行者明确已出发']});
 const context=store.captureAdjustmentContext(),blueprint=structuredClone(original.activeBlueprint!);blueprint.version++;blueprint.title='虚构事件关联完整替代';for(const day of blueprint.days){for(const [index,block] of (day.blocks??[]).entries()){block.startTime=String(9+index*2).padStart(2,'0')+':00';block.endTime=String(10+index*2).padStart(2,'0')+':00';const stop=day.stops.find(s=>s.placeId===block.placeId);if(stop)stop.time=block.startTime;}}blueprint.movements=blueprint.movements.map(move=>({...move,status:'verified',durationMinutes:1}));store.saveTripBlueprint(blueprint);
 const decision={verdict:'eligible' as const,changeKind:'objective_disruption' as const,agentId:'虚构责任Agent',modelId:'虚构模型',executionRef:'虚构隔离执行',rationale:'虚构可靠闭馆影响已核对，完整替代可执行。',obligations:['旧版未发送提醒失效','新版后续提醒更新'],evidenceRefs:observation.evidenceRefs};
 store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint,{createdAt:now.toISOString()}),'codex',undefined,{input:{context,observations:[observation],decision,now:now.toISOString()},verifyExecution:()=>true});
 return {dir,file,store};
}
function serverFor(store:SqliteWorkspaceStore,travelAdjustmentCandidates?:Parameters<typeof registerPlanManagementRoutes>[1]["travelAdjustmentCandidates"]){const server=Fastify();registerPlanManagementRoutes(server,{store,getMaps:()=>{throw Error('隔离开发禁止外部地图。');},startActivePlanMonitoring:()=>{},...(travelAdjustmentCandidates?{travelAdjustmentCandidates}:{})});return server;}

for(const kind of ['null','missing','blank','mixed'] as const)test(`普通应用逐观察事件身份不足保持未决：${kind}`,async()=>{
 const f=await fixture(true);let store=f.store;
 const before=store.getExecutionPlan()!;
 const invalid={...observation,key:'无身份到访',objectRef:'无身份对象',fingerprint:kind==='blank'?'   ':null};
 if(kind==='missing')delete (invalid as Partial<TravelAdjustmentObservation>).fingerprint;
 const observations=kind==='mixed'?[observation,invalid]:[invalid];
 const draft=store.getWorkspace();
 const approved:TravelAdjustmentInput={requestId:`缺失事件-${kind}`,context:store.captureAdjustmentContext(),observations,now:now.toISOString(),decision:{verdict:'eligible',changeKind:'objective_disruption',agentId:'虚构责任Agent',modelId:'虚构模型',executionRef:'虚构隔离执行',rationale:'隔离替身核对完整输入，身份仍须由领域边界核验。',obligations:['逐变化事件覆盖'],evidenceRefs:observation.evidenceRefs},replacement:{planId:draft.activePlan.id,version:draft.activePlan.version,blueprintVersion:draft.activeBlueprint!.version,proposalDigest:store.travelAdjustmentProposalDigest()}};
 let verified=false;
 const server=serverFor(store,{now:()=>now,collect:async()=>({observations:approved.observations,decision:approved.decision!,replacement:approved.replacement!}),verifyExecution:(decision,input)=>(verified=isDeepStrictEqual(input,approved)&&isDeepStrictEqual(decision,approved.decision))});
 try{
  const response=await server.inject({method:'POST',url:`/api/travel-adjustments/${encodeURIComponent(approved.requestId)}/evaluate`});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(verified,true,'负责替身必须先核对完整输入，不能以验证器拒绝掩盖身份门禁。');
  const receipt=response.json<import('@c-assistant/core').TravelAdjustmentReceipt>();
  assert.equal(receipt.status,'unresolved',receipt.reason);
  assert.deepEqual(store.getExecutionPlan(),before);
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
  await server.close();store.close();store=new SqliteWorkspaceStore(f.file);
  assert.deepEqual(store.getExecutionPlan(),before);
  assert.equal(store.getTravelAdjustmentReceipt(approved.requestId)?.status,'unresolved');
  const persisted=store.listTravelAdjustmentObservations(before.id,before.version);
  assert.equal(persisted.length,observations.length);
  assert.equal(store.email.list().filter(job=>job.kind==='change').length,0);
  evidence(`r3-server-identity-${kind}`,{before,receipt,reopened:{execution:store.getExecutionPlan(),receipt:store.getTravelAdjustmentReceipt(approved.requestId),observations:persisted,handoffs:store.listPendingTravelAdjustmentHandoffs(),outbox:store.email.list()}});
 }finally{await server.close();store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('普通 Fastify 精确确认、只读、旧摘要与授权冲突、丢响应后磁盘读回',async()=>{
 const f=await fixture();let store=f.store;let server=serverFor(store);
 try{
  const before=store.getWorkspace(),base=store.getExecutionPlan()!;
  const review=await server.inject({method:'GET',url:`/api/plans/${before.activePlan.id}/confirmation-review`});assert.equal(review.statusCode,200);
  assert.equal((await server.inject({method:'POST',url:'/api/travel-adjustments/伪造候选/evaluate',payload:{publicExecution:true}})).statusCode,409);
  const body=review.json();assert.equal(store.getExecutionPlan()!.id,base.id);
  const payload={expectedVersion:before.activePlan.version,expectedBlueprintVersion:before.activeBlueprint!.version,expectedBasePlanId:base.id,expectedBaseVersion:base.version};
  assert.equal((await server.inject({method:'POST',url:`/api/plans/${before.activePlan.id}/confirm`,payload})).statusCode,409);
  const wrong=structuredClone(body.exactConfirmation);wrong.proposalDigest='0'.repeat(64);
  assert.equal((await server.inject({method:'POST',url:`/api/plans/${before.activePlan.id}/confirm`,payload:{...payload,exactConfirmation:wrong}})).statusCode,409);
  store.email.setEnabled(false);
  assert.equal((await server.inject({method:'POST',url:`/api/plans/${before.activePlan.id}/confirm`,payload:{...payload,exactConfirmation:body.exactConfirmation}})).statusCode,409);
  store.email.setEnabled(true);
  const exact=exactPlanConfirmation(store);
  const context=store.captureAdjustmentContext();
  assert.equal((await server.inject({method:'POST',url:'/api/travel-adjustments/phase',payload:{context,value:'pre_departure',declaration:true}})).statusCode,200);
  assert.equal(store.getExecutionPlan()!.id,base.id);
  const confirmation=exactPlanConfirmation(store);
  const response=await server.inject({method:'POST',url:`/api/plans/${before.activePlan.id}/confirm`,payload:{...payload,exactConfirmation:confirmation}});
  assert.equal(response.statusCode,200,response.body);
  const after=store.getWorkspace();assert.equal(store.getExecutionPlan()!.id,before.activePlan.id);
  evidence('server-confirmation-before-after',{before,after});
  await server.close();store.close();store=new SqliteWorkspaceStore(f.file);server=serverFor(store);
  assert.equal(store.getExecutionPlan()!.id,before.activePlan.id);
  evidence('server-confirmation-reopened',{workspace:store.getWorkspace(),handoffs:store.listPendingTravelAdjustmentHandoffs()});
  assert.equal(store.email.planConfirmation(before.activePlan.id,before.activePlan.version)?.planId,before.activePlan.id);
  const receipt=store.getTravelAdjustmentReceiptForPlan(before.activePlan.id,before.activePlan.version)!;
  assert.equal(receipt.status,'applied');assert.equal(receipt.basis,'user_confirmation');
  assert.equal(receipt.handoff?.status,'acknowledged');
  const changeJobs=store.email.list().filter(job=>job.kind==='change');assert.equal(changeJobs.length,1);
  assert.equal(receipt.handoff?.readbackRef,`email-outbox:${changeJobs[0]!.id}`);
  assert.equal(changeJobs[0]!.planId,before.activePlan.id);assert.equal(changeJobs[0]!.planVersion,before.activePlan.version);
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
  consumeTravelAdjustmentHandoffs(store,now,()=>{throw Error('已确认的交接不得重复消费。');});
  assert.deepEqual(store.getTravelAdjustmentReceiptForPlan(before.activePlan.id,before.activePlan.version),receipt);
  assert.deepEqual(store.email.list().filter(job=>job.kind==='change'),changeJobs);
  const jobs=store.email.list();assert.match(jobs.find(job=>job.kind==='change')!.content!.html,/<html lang="zh-CN">/);assert.doesNotMatch(jobs.find(job=>job.kind==='change')!.content!.html,/IMPORTANT UPDATE|UPDATE CONFIRMED|Confirmed:/);consumeTravelAdjustmentHandoffs(store,now);assert.equal(store.email.list().length,jobs.length);
 }finally{await server.close();store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('await 中授权变化拒绝迟到候选，生产缺少公开执行合同保持原执行',async()=>{
 const f=await fixture();try{
  const service=createTravelAdjustmentApplication({store:f.store,now:()=>now}),base=f.store.getExecutionPlan()!;
  assert.equal((await service.run('迟到候选',async()=>{f.store.email.setEnabled(false);return {observations:[observation]};})).status,'rejected');
  f.store.email.setEnabled(true);
  const result=await service.run('无公开合同',async()=>({observations:[observation],decision:{verdict:'eligible',changeKind:'objective_disruption',agentId:'虚构责任Agent',modelId:'虚构模型',executionRef:'虚构隔离执行',rationale:'虚构判断',obligations:['核对完整安排'],evidenceRefs:observation.evidenceRefs},replacement:{planId:f.store.getWorkspace().activePlan.id,version:f.store.getWorkspace().activePlan.version,blueprintVersion:f.store.getWorkspace().activeBlueprint!.version,proposalDigest:f.store.travelAdjustmentProposalDigest()}}));
  assert.equal(result.status,'unresolved');assert.equal(f.store.getExecutionPlan()!.id,base.id);
  assert.deepEqual(await service.run('无公开合同',()=>{throw Error('丢回执后不得重复生成。');}),result);
 }finally{f.store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('隔离负责判断应用保留事实，缺持久公开核验时拒绝邮件消费',async()=>{
 const f=await fixture(true);let store=f.store;
 try{
  const draft=store.getWorkspace().activePlan;
  const server=serverFor(store,{now:()=>now,verifyExecution:decision=>decision.executionRef==='虚构隔离执行',collect:async()=>({observations:[observation],decision:{verdict:'eligible',changeKind:'objective_disruption',agentId:'虚构责任Agent',modelId:'虚构模型',executionRef:'虚构隔离执行',rationale:'虚构可靠闭馆影响已核对，完整替代可执行。',obligations:['旧版未发送提醒失效','新版后续提醒更新'],evidenceRefs:observation.evidenceRefs},replacement:{planId:draft.id,version:draft.version,blueprintVersion:store.getWorkspace().activeBlueprint!.version,proposalDigest:store.travelAdjustmentProposalDigest()}})});
  const response=await server.inject({method:'POST',url:'/api/travel-adjustments/行中虚构闭馆/evaluate'});await server.close();
  assert.equal(response.statusCode,200,response.body);
  const receipt=response.json<import('@c-assistant/core').TravelAdjustmentReceipt>();
  assert.equal(receipt.status,'applied',receipt.reason);
  assert.equal(store.email.planConfirmation(draft.id,draft.version),undefined);
  consumeTravelAdjustmentHandoffs(store,now,()=>{throw Error('虚构交接故障。');});
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);assert.equal(store.getExecutionPlan()!.id,draft.id);
  store.close();store=new SqliteWorkspaceStore(f.file);
  consumeTravelAdjustmentHandoffs(store,now);
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);
  assert.equal(store.email.list().filter(job=>job.kind==='change').length,0);
  evidence('server-automatic-reopened',{workspace:store.getWorkspace(),receipt:store.getTravelAdjustmentReceipt(receipt.requestId),outbox:store.email.list()});
  assert.equal(enqueueAppliedAdjustment(store,receipt.requestId,now),undefined);
  consumeTravelAdjustmentHandoffs(store,now);assert.equal(store.email.list().filter(job=>job.kind==='change').length,0);
  assert.equal(store.getTravelAdjustmentReceipt(receipt.requestId)?.status,'applied');
 }finally{store.close();rmSync(f.dir,{recursive:true,force:true});}
});

function 完整候选(store:SqliteWorkspaceStore) {
 return {observations:[structuredClone(observation)],decision:{verdict:'eligible' as const,changeKind:'objective_disruption' as const,agentId:'虚构责任Agent',modelId:'虚构模型',executionRef:'虚构隔离执行',rationale:'虚构可靠判断',obligations:['核验完整候选'],evidenceRefs:observation.evidenceRefs},replacement:{planId:store.getWorkspace().activePlan.id,version:store.getWorkspace().activePlan.version,blueprintVersion:store.getWorkspace().activeBlueprint!.version,proposalDigest:store.travelAdjustmentProposalDigest()}};
}

test('升级重开后旧版客观应用待发拒绝出站，发送中及已接受或不明历史原样保留',async()=>{
 for(const status of ['pending','retry','sending','accepted','uncertain'] as const){
  const f=await fixture(true);let store=f.store;
  try{
   const receipt=store.commitTravelAdjustment({...完整候选(store),requestId:'旧客观通知-'+status,context:store.captureAdjustmentContext(),now:now.toISOString()},{verifyExecution:()=>true});
   assert.equal(receipt.status,'applied');
   const plan=store.getExecutionPlan()!,id=emailJobId(['travel-adjustment',receipt.handoff!.intentId,store.email.settings().revision]);
   const content={subject:'旧版已应用通知',html:'<p>旧版冻结安排</p>',text:'旧版冻结安排'};
   store.email.enqueue({id,planId:plan.id,planVersion:plan.version,kind:'change',date:'2026-12-01',dueAt:now.toISOString(),expiresAt:'2026-12-02T00:00:00Z',recipientRevision:store.email.settings().revision,content});
   if(status!=='pending'){
    const claim=store.email.claim(plan.id,plan.version,now.toISOString())!;
    if(status!=='sending')store.email.settle(claim.id,claim.lease!,status,now.toISOString());
   }
   const before=store.email.get(id)!;store.close();store=new SqliteWorkspaceStore(f.file);
   assert.equal(store.getTravelAdjustmentEmailConsumption(receipt.requestId,now.toISOString()),undefined);
   let sends=0;
   await createEmailExecutionWorker({store,now:()=>now,prepareDelivery:createEmailReviewDelivery(store),getTransport:()=>({configured:()=>true,verify:async()=>({ready:true}),send:async message=>{sends++;return{status:'accepted',messageId:message.messageId};}}),render:async()=>{throw Error('旧通知不得重新组装');}}).drain();
   assert.equal(sends,0);
   const after=store.email.get(id)!;
   assert.equal(after.status,status==='pending'||status==='retry'?'cancelled':status);
   assert.deepEqual(after.content,content);
   if(status!=='pending'&&status!=='retry')assert.deepEqual(after,before);
   evidence('升级旧版客观通知-'+status,{receipt,before,after,sends});
  }finally{store.close();rmSync(f.dir,{recursive:true,force:true});}
 }
});

test('相同完整候选新鲜时应用，收集等待期间仅可信时钟越过有效期时持久未决',async()=>{
 const f=await fixture(true);f.store.close();
 const controlFile=join(f.dir,'新鲜对照.sqlite');copyFileSync(f.file,controlFile);
 let store=new SqliteWorkspaceStore(f.file);const control=new SqliteWorkspaceStore(controlFile);
 try {
  const candidate=完整候选(store),context=store.captureAdjustmentContext(),before=store.getExecutionPlan(),draft=store.getWorkspace().activePlan;
  assert.deepEqual(control.captureAdjustmentContext(),context);
  const requestId='相同来源窗口候选';
  const calls:TravelAdjustmentInput[]=[];
  let clock=now;
  const verifier=(decision:NonNullable<TravelAdjustmentInput['decision']>,input:TravelAdjustmentInput)=>{
   calls.push(structuredClone(input));
   assert.deepEqual(decision,candidate.decision);
   assert.deepEqual(input,{...candidate,requestId,context,now:clock.toISOString()});
   return true;
  };
  const fresh=await createTravelAdjustmentApplication({store:control,now:()=>clock,verifyExecution:verifier}).run(requestId,async()=>structuredClone(candidate));
  assert.equal(fresh.status,'applied',fresh.reason);assert.equal(calls.length,1);
  const expired=await createTravelAdjustmentApplication({store,now:()=>clock,verifyExecution:verifier}).run(requestId,async()=>{
   assert.ok(clock.getTime()<Date.parse(candidate.observations[0]!.validUntil!));
   await Promise.resolve();clock=new Date('2026-12-03T00:00:00Z');return structuredClone(candidate);
  });
  assert.equal(calls.length,2);assert.deepEqual({...calls[1],now:calls[0]!.now},calls[0]);
  assert.equal(expired.status,'unresolved');assert.match(expired.reason,/来源有效窗口已经结束/);
  assert.deepEqual(store.getExecutionPlan(),before);assert.deepEqual(store.getWorkspace().activePlan,draft);
  assert.deepEqual(store.getTravelAdjustmentReceipt(requestId),expired);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
  store.close();store=new SqliteWorkspaceStore(f.file);
  assert.deepEqual(store.getTravelAdjustmentReceipt(requestId),expired);assert.deepEqual(store.getExecutionPlan(),before);assert.deepEqual(store.getWorkspace().activePlan,draft);
  evidence('可信时钟跨越有效期正反对照',{calls,fresh,expired,重启回执:store.getTravelAdjustmentReceipt(requestId)});
 } finally {control.close();store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('相同执行引用不能复用到篡改来源、替代摘要、上下文或责任身份的输入',async()=>{
 for(const kind of ['来源','替代摘要','上下文','责任Agent','责任模型'] as const){
  const f=await fixture(true);try {
   const candidate=完整候选(f.store),requestId='篡改'+kind,context=f.store.captureAdjustmentContext();
   const approved:TravelAdjustmentInput={...structuredClone(candidate),requestId,context:structuredClone(context),now:now.toISOString()};
   const altered=structuredClone(candidate);
   if(kind==='来源')altered.observations[0]!.fingerprint='被替换的来源事实';
   if(kind==='替代摘要')altered.replacement.proposalDigest='0'.repeat(64);
   if(kind==='上下文')approved.context.phase.evidenceRefs=['另一个责任上下文'];
   if(kind==='责任Agent')altered.decision.agentId='另一个责任Agent';
   if(kind==='责任模型')altered.decision.modelId='另一个责任模型';
   let calls=0;const inputs:TravelAdjustmentInput[]=[];
   const verify=(decision:NonNullable<TravelAdjustmentInput['decision']>,input:TravelAdjustmentInput)=>{
    calls++;inputs.push(structuredClone(input));assert.equal(decision.executionRef,approved.decision!.executionRef);
    return bookingRelationshipDigest(input)===bookingRelationshipDigest(approved);
   };
   // 正对照使用完全相同的验证函数，证明批准输入确实获准。
   assert.equal(verify(approved.decision!,approved),true);calls=0;inputs.length=0;
   const before=f.store.getExecutionPlan(),draft=f.store.getWorkspace().activePlan;
   const result=await createTravelAdjustmentApplication({store:f.store,now:()=>now,verifyExecution:verify}).run(requestId,async()=>altered);
   assert.equal(calls,1);assert.deepEqual(inputs[0],{...altered,requestId,context,now:now.toISOString()});
   assert.equal(result.status,'unresolved');assert.equal(result.reason,'缺少经验证的公开判断执行合同。');
   assert.deepEqual(f.store.getExecutionPlan(),before);assert.deepEqual(f.store.getWorkspace().activePlan,draft);
   evidence('完整执行绑定反例'+kind,{approved,received:inputs[0],result});
  } finally {f.store.close();rmSync(f.dir,{recursive:true,force:true});}
 }
});


test('收集等待期间真实存储逐项变化拒绝迟到提交且重开回执，不污染当前观察与草稿',async()=>{
 for(const kind of ['执行计划','蓝图','草稿','来源集合','阶段','观察集合','授权','时区'] as const){
  const f=await fixture(false,kind==='来源集合'?'booking-priority':'workspace');let store=f.store;
  try {
   const context=store.captureAdjustmentContext(),candidate=完整候选(store),requestId='真实并发变化'+kind;
   const service=createTravelAdjustmentApplication({store,now:()=>now,verifyExecution:()=>true});
   let release!:()=>void,entered!:()=>void;
   const waiting=new Promise<void>(resolve=>{entered=resolve;});
   const gate=new Promise<void>(resolve=>{release=resolve;});
   const pending=service.run(requestId,async received=>{assert.deepEqual(received,context);entered();await gate;return candidate;});
   await waiting;
   const oldExecution=store.getExecutionPlan()!,oldDraft=store.getWorkspace().activePlan;
   if(kind==='执行计划')store.updatePlanTravelContext(oldExecution.id,{partySize:3,luggage:'heavy'});
   if(kind==='蓝图'){
    const blueprint=structuredClone(store.getWorkspace().activeBlueprint!);blueprint.version++;blueprint.summary='等待期间正式修订蓝图';
    store.saveTripBlueprint(blueprint);store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint,{createdAt:now.toISOString()}));
   }
   if(kind==='草稿')store.createPlan({request:'等待期间创建无关旅行草稿'});
   if(kind==='来源集合'){
    const w=store.getWorkspace(),review=store.getBookingRelationshipReviewContext(w.activePlan.id),source=store.listCurrentTravelBookingSourcesForPlan(w.activePlan.id)[0]!;
    assert.ok(source,'夹具须包含正规导入的预订源');
    store.savePlanTravelBooking({targetPlanId:w.activePlan.id,booking:{...source,title:'等待期间更正虚构凭证',updatedAt:now.toISOString()},expectedVersion:w.activePlan.version,expectedBlueprintVersion:w.activeBlueprint!.version,expectedSourceSetDigest:review.sourceSetDigest,expectedRecordDigest:bookingRelationshipDigest(source)});
   }
   if(kind==='阶段')store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'on_trip',basis:'traveler_statement',recordedAt:now.toISOString(),evidenceRefs:['等待期间旅行者明确已出发']});
   if(kind==='观察集合')store.commitTravelAdjustment({requestId:'并发正规来源观察',context:store.captureAdjustmentContext(),observations:[{...observation,key:'并发来源',fingerprint:'并发已保存事实'}],now:now.toISOString()});
   if(kind==='授权')store.email.setEnabled(false);
   if(kind==='时区')store.email.updateSettings({recipient:'traveler@example.test',cityTimeZones:{...store.email.settings().cityTimeZones,'虚构新增城市':'Asia/Shanghai'}});
   const changed=store.captureAdjustmentContext();assert.notDeepEqual(changed,context);
   if(kind==='执行计划')assert.notDeepEqual(changed.execution,context.execution);
   if(kind==='蓝图')assert.notDeepEqual(changed.draftBlueprint,context.draftBlueprint);
   if(kind==='草稿')assert.notDeepEqual(changed.draft,context.draft);
   if(kind==='来源集合')assert.notEqual(changed.sourceSetDigest,context.sourceSetDigest);
   if(kind==='观察集合')assert.notEqual(changed.observationSetDigest,context.observationSetDigest);
   const execution=store.getExecutionPlan(),draft=store.getWorkspace().activePlan,observations=store.listTravelAdjustmentObservations(execution!.id,execution!.version);
   release();const result=await pending;
   assert.equal(result.status,'rejected',kind+':'+result.reason);assert.deepEqual(result.events,[]);
   assert.deepEqual(store.getExecutionPlan(),execution);assert.deepEqual(store.getWorkspace().activePlan,draft);
   if(kind!=='执行计划')assert.deepEqual(execution,oldExecution);
   if(!['蓝图','草稿','来源集合'].includes(kind))assert.deepEqual(draft,oldDraft);
   assert.deepEqual(store.listTravelAdjustmentObservations(execution!.id,execution!.version),observations);
   assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
   store.close();store=new SqliteWorkspaceStore(f.file);
   assert.deepEqual(store.getTravelAdjustmentReceipt(requestId),result);assert.deepEqual(store.captureAdjustmentContext(),changed);
   assert.deepEqual(store.getExecutionPlan(),execution);assert.deepEqual(store.getWorkspace().activePlan,draft);
   assert.deepEqual(store.listTravelAdjustmentObservations(execution!.id,execution!.version),observations);
   assert.deepEqual(await createTravelAdjustmentApplication({store,now:()=>now}).run(requestId,()=>{throw Error('已持久拒绝不得再收集');}),result);
   evidence('真实动态并发反例'+kind,{context,changed,result,重开回执:store.getTravelAdjustmentReceipt(requestId)});
  } finally {store.close();rmSync(f.dir,{recursive:true,force:true});}
 }
});
