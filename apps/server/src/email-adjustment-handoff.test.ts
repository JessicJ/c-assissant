import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {SqliteWorkspaceStore} from '@c-assistant/storage';
import {compileTripBlueprint} from '@c-assistant/core';
import {consumeTravelAdjustmentHandoffs,enqueueAppliedAdjustment,readTravelAdjustmentEmailEffects,createEmailReviewDelivery} from './email-plan-review.js';
import {createAgentEmailSchedule} from './email-agent-timing.js';
import {createEmailExecutionWorker} from './email-execution-worker.js';
import {emailTimingFixture} from './email.fixture.test.js';
const {prepareTravelAdjustmentDevelopmentFixture}=await import(new URL('../../../tests/browser/travel-adjustment-development-fixture.ts',import.meta.url).href);
const now=new Date('2026-11-18T00:00:00Z');
function evidence(name:string,value:unknown){const root=process.env.LANDI_EMAIL_HANDOFF_EVIDENCE;if(root){mkdirSync(root,{recursive:true});writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2));}}
async function fixture(timed=false){
 const directory=mkdtempSync(join(tmpdir(),'landi-email-handoff-')),file=join(directory,'workspace.sqlite');await prepareTravelAdjustmentDevelopmentFixture(file);
 const store=new SqliteWorkspaceStore(file);
 if(timed){
  const blueprint=structuredClone(store.getWorkspace().activeBlueprint!);blueprint.version++;
  for(const day of blueprint.days)for(const [index,block] of (day.blocks??[]).entries()){block.startTime=`${String(9+index*2).padStart(2,'0')}:00`;block.durationMinutes=60;const stop=day.stops.find(stop=>stop.placeId===block.placeId);if(stop)stop.time=block.startTime;}
  store.saveTripBlueprint(blueprint);store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint,{createdAt:now.toISOString()}));
 }
 const context=store.captureAdjustmentContext(),w=store.getWorkspace(),digest=store.travelAdjustmentProposalDigest();
 for(const status of ['pending','retry','sending','accepted','uncertain'] as const){
  const id='旧版-'+status;store.email.enqueue({id,planId:context.execution!.id,planVersion:context.execution!.version,kind:'change',date:'2026-12-01',dueAt:now.toISOString(),expiresAt:'2026-12-03T00:00:00Z',recipientRevision:store.email.settings().revision});
  if(status!=='pending'){
   const job=store.email.claim(context.execution!.id,context.execution!.version,now.toISOString())!;
   if(status!=='sending')store.email.settle(job.id,job.lease!,status,'2026-12-01T00:00:00Z');
  }
 }
 // 上述领取顺序不作为状态证明，显式核对隔离行后再进入真实确认入口。
 const db=new DatabaseSync(file);for(const status of ['pending','retry','sending','accepted','uncertain'])db.prepare('UPDATE email_outbox SET status=?,lease_expires=? WHERE id=?').run(status,'2026-11-18T00:02:00Z','旧版-'+status);db.close();
 const before={execution:store.getExecutionPlan(),oldWork:store.email.versionJobs(context.execution!.id,context.execution!.version)};
 store.confirmPlan(w.activePlan.id,w.activePlan.version,{expectedBase:context.execution!,expectedBlueprintVersion:w.activeBlueprint!.version,expectedRecipientRevision:context.recipientRevision,adjustmentContext:context,proposalDigest:digest,confirmedAt:now.toISOString()});
 return {directory,file,store,requestId:'manual:'+digest,before};
}

test('确认生效、通知入队后崩溃、磁盘重开和双连接重复消费只保留同一通知及独立效果',async()=>{
 const f=await fixture(true);let store=f.store;
 try{
  const receipt=store.getTravelAdjustmentReceipt(f.requestId)!;
  consumeTravelAdjustmentHandoffs(store,now,requestId=>{assert.ok(enqueueAppliedAdjustment(store,requestId,now));throw Error('隔离注入：入队后 ACK 前崩溃');});
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);
  const jobs=store.email.versionJobs(receipt.handoff!.replacement.plan.id,receipt.handoff!.replacement.plan.version);assert.equal(jobs.length,1);
  const frozen=structuredClone(jobs[0]!);assert.ok(frozen.content!.adjustment);
  const beforeRestart=readTravelAdjustmentEmailEffects(store,frozen.id)!;
  assert.equal(beforeRestart.timing?.status,'pending');assert.equal(beforeRestart.oldPending.length,0);
  for(const status of ['sending','accepted','uncertain'])assert.equal(beforeRestart.oldWork.find(job=>job.id==='旧版-'+status)?.status,status);
  for(const status of ['pending','retry'])assert.equal(beforeRestart.oldWork.find(job=>job.id==='旧版-'+status)?.status,'cancelled');
  store.close();store=new SqliteWorkspaceStore(f.file);const peer=new SqliteWorkspaceStore(f.file);
  try{await Promise.all([Promise.resolve().then(()=>consumeTravelAdjustmentHandoffs(store,now)),Promise.resolve().then(()=>consumeTravelAdjustmentHandoffs(peer,now))]);}finally{peer.close();}
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);assert.deepEqual(store.email.get(frozen.id),frozen);
  const effects=readTravelAdjustmentEmailEffects(store,frozen.id)!;assert.equal(effects.timing?.status,'pending');
  assert.equal(store.getTravelAdjustmentReceipt(f.requestId)?.handoff?.readbackRef,'email-outbox:'+frozen.id);
  const schedule=createAgentEmailSchedule(store,async()=>{throw Error('隔离安排失败');},()=>now);
  const zones=new Map(Object.entries(store.email.settings().cityTimeZones).map(([city,zone])=>[city.toLowerCase(),zone]));
  await schedule(store.getExecutionPlan()!,zones,now);
  assert.equal(readTravelAdjustmentEmailEffects(store,frozen.id)?.timing?.status,'pending');
  const retryTime=new Date(now.getTime()+5*60_000);
  const recovered=createAgentEmailSchedule(store,async request=>emailTimingFixture(request),()=>retryTime);
  const reminders=await recovered(store.getExecutionPlan()!,zones,retryTime);
  assert.ok(reminders.length);
  for(const job of reminders)store.email.enqueue(job);
  assert.equal(readTravelAdjustmentEmailEffects(store,frozen.id)?.timing?.status,'ready');
  evidence('新版安排失败及同身份恢复',{pending:effects,ready:readTravelAdjustmentEmailEffects(store,frozen.id),reminders});
  let calls=0;const sent:string[]=[];
  const worker=createEmailExecutionWorker({store,now:()=>now,prepareDelivery:createEmailReviewDelivery(store),getTransport:()=>({configured:()=>true,verify:async()=>({ready:true}),send:async message=>{calls++;sent.push(message.messageId);return {status:'uncertain',code:'email_delivery_unknown',retryable:false};}}),render:async()=>{throw Error('冻结通知不得重新组装');}});
  await worker.drain();await worker.drain();assert.equal(calls,1);assert.equal(store.email.get(frozen.id)?.status,'uncertain');
  store.close();store=new SqliteWorkspaceStore(f.file);consumeTravelAdjustmentHandoffs(store,now);assert.equal(store.email.get(frozen.id)?.status,'uncertain');
  assert.deepEqual(store.email.get(frozen.id)?.content,frozen.content);
  evidence('交接崩溃重启前后',{before:f.before,beforeRestart,after:readTravelAdjustmentEmailEffects(store,frozen.id),sent,说明:'虚构确认与假 SMTP，不证明收信或公开执行就绪。'});
 }finally{store.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('outbox事务中断不回滚应用，解除故障后同一意图恢复且精确读回不受100条限制',async()=>{
 const f=await fixture();try{
  const db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER isolated_outbox_failure BEFORE INSERT ON email_outbox BEGIN SELECT RAISE(ABORT,'隔离中断'); END;");
  consumeTravelAdjustmentHandoffs(f.store,now);assert.equal(f.store.listPendingTravelAdjustmentHandoffs().length,1);assert.equal(f.store.getTravelAdjustmentReceipt(f.requestId)?.status,'applied');
  db.exec('DROP TRIGGER isolated_outbox_failure');db.close();
  const plan=f.store.getExecutionPlan()!;
  for(let i=0;i<110;i++)f.store.email.enqueue({id:'隔离未来邮件-'+i,planId:plan.id,planVersion:plan.version,kind:'morning',date:'2026-12-02',dueAt:'2026-12-02T00:00:00Z',expiresAt:'2026-12-03T00:00:00Z',recipientRevision:f.store.email.settings().revision});
  consumeTravelAdjustmentHandoffs(f.store,now);assert.equal(f.store.listPendingTravelAdjustmentHandoffs().length,0);
  const id=f.store.getTravelAdjustmentReceipt(f.requestId)!.handoff!.readbackRef!.slice('email-outbox:'.length);
  assert.equal(f.store.email.list().some(job=>job.id===id),false);assert.ok(readTravelAdjustmentEmailEffects(f.store,id));
  evidence('事务中断恢复精确读回',{receipt:f.store.getTravelAdjustmentReceipt(f.requestId),effects:readTravelAdjustmentEmailEffects(f.store,id)});
 }finally{f.store.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('暂停恢复保持冻结内容、附件与同一逻辑身份，授权变化拒绝旧消费',async()=>{
 const f=await fixture();try{
  const id=enqueueAppliedAdjustment(f.store,f.requestId,now)!;assert.ok(id);
  const frozen=f.store.email.get(id)!.content!;f.store.email.setEnabled(false);assert.equal(enqueueAppliedAdjustment(f.store,f.requestId,now),undefined);
  f.store.email.setEnabled(true);assert.equal(enqueueAppliedAdjustment(f.store,f.requestId,now),id);assert.deepEqual(f.store.email.get(id)!.content,frozen);
  f.store.email.updateSettings({recipient:f.store.email.settings().recipient,cityTimeZones:{...f.store.email.settings().cityTimeZones,'虚构新城市':'UTC'}});
  assert.equal(enqueueAppliedAdjustment(f.store,f.requestId,now),undefined);
 }finally{f.store.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('真实子进程在入队后异常退出，两个独立进程并发恢复仍只有一个逻辑通知',async()=>{
 const f=await fixture();f.store.close();let store:SqliteWorkspaceStore|undefined;
 const children:ReturnType<typeof spawn>[]=[];
 const moduleUrl=new URL('./email-plan-review.ts',import.meta.url).href;
 try{
  const setup=`import {SqliteWorkspaceStore} from '@c-assistant/storage';import {consumeTravelAdjustmentHandoffs,enqueueAppliedAdjustment} from ${JSON.stringify(moduleUrl)};const store=new SqliteWorkspaceStore(process.argv[1]);const now=new Date('2026-11-18T00:00:00Z');`;
  const crash=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',setup+`consumeTravelAdjustmentHandoffs(store,now,requestId=>{enqueueAppliedAdjustment(store,requestId,now);process.exit(73);});`,f.file],{encoding:'utf8',timeout:15_000});
  assert.ifError(crash.error);assert.equal(crash.status,73,crash.stderr);
  store=new SqliteWorkspaceStore(f.file);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,1);store.close();store=undefined;
  const code=setup+`setTimeout(()=>process.exit(74),10000).unref();process.once('message',()=>{consumeTravelAdjustmentHandoffs(store,now);store.close();process.disconnect();});process.send('ready');`;
  // 初始化各连接后再同时放行消费，避免把并发建库锁误当成消费竞态。
  for(const index of [0,1]){
   const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',code,f.file],{stdio:['ignore','pipe','pipe','ipc']});children.push(child);
   let stderr='';child.stderr!.on('data',chunk=>{stderr+=chunk;});
   await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('message',()=>resolve());child.once('exit',code=>{if(code!==0)reject(Error(`并发恢复子进程${index}在准备前退出：${stderr}`));});});
  }
  const exits=children.map(child=>new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}));
  for(const child of children)child.send('start');
  const codes=await Promise.all(exits);assert.deepEqual(codes,[0,0]);
  store=new SqliteWorkspaceStore(f.file);consumeTravelAdjustmentHandoffs(store,now);
  const plan=store.getExecutionPlan()!,notifications=store.email.versionJobs(plan.id,plan.version).filter(job=>job.kind==='change');
  assert.equal(notifications.length,1);assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
  evidence('真实进程崩溃与并发恢复',{crashExitCode:crash.status,concurrentExitCodes:codes,effects:readTravelAdjustmentEmailEffects(store,notifications[0]!.id)});
 }finally{for(const child of children)if(child.exitCode===null)child.kill();store?.close();rmSync(f.directory,{recursive:true,force:true});}
});
