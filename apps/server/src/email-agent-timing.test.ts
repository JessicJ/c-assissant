import {DatabaseSync} from "node:sqlite";
import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SqliteWorkspaceStore} from "@c-assistant/storage";
import {emailPlanFixture,verifiedEmailFixture,emailTimingFixture} from "./email.fixture.test.js";
import {emailTimingOpportunities,validateEmailTiming} from "./email-schedule.js";
import {createAgentEmailSchedule,prepareAgentEmailTiming} from "./email-agent-timing.js";
import {createEmailExecutionWorker} from "./email-execution-worker.js";
const zones=new Map([["paris","UTC"]]);const now=()=>new Date("2026-11-10T07:00:00Z");
test("Agent decisions persist across restart; concurrent planning and repeated ticks do not duplicate work",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"landi-timing-"));const file=join(directory,"workspace.sqlite");let store=new SqliteWorkspaceStore(file);let calls=0;
 try{
  const plan=emailPlanFixture(store);verifiedEmailFixture(store);
  const generate=async(request:Parameters<typeof emailTimingFixture>[0])=>{calls++;assert.ok(!JSON.stringify(request).includes("traveler@example.test"));const result=emailTimingFixture(request);result.decisions[0]!.sendAtLocal="2026-11-10T07:12";return result;};
  const schedule=createAgentEmailSchedule(store,generate,now);await Promise.all([schedule(plan,zones,now()),schedule(plan,zones,now())]);assert.equal(calls,1);
  store.close();store=new SqliteWorkspaceStore(file);const saved=createAgentEmailSchedule(store,generate,now);const jobs=await saved(store.getExecutionPlan()!,zones,now());assert.equal(calls,1);assert.equal(jobs.find(item=>item.kind==="morning")?.dueAt,"2026-11-10T07:12:00.000Z");
  let sent=0;let clock=now();const worker=createEmailExecutionWorker({store,schedule:saved,now:()=>clock,getTransport:()=>({configured:()=>true,verify:async()=>({ready:true}),send:async message=>{sent++;return{status:"accepted",messageId:message.messageId};}}),render:async()=>({subject:"Example",html:"<p>Example</p>",text:"Example"})});
  await worker.tick(zones);assert.equal(sent,0);clock=new Date("2026-11-10T07:12:00Z");await worker.tick(zones);await worker.tick(zones);assert.equal(sent,1);assert.equal(calls,1);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test("invalid identity, duplicate decisions, invalid dates and late notifications are rejected",()=>{
 const store=new SqliteWorkspaceStore(":memory:");try{
  const request={opportunities:emailTimingOpportunities(emailPlanFixture(store),zones),now:now().toISOString()};
  for(const change of ["identity","duplicate","late","date"]){const result=emailTimingFixture(request);if(change==="identity")result.decisions[0]!.id="not-in-plan";if(change==="duplicate")result.decisions[1]!.id=result.decisions[0]!.id;if(change==="late")result.decisions[1]!.sendAtLocal="2026-11-10T09:00";if(change==="date")result.decisions[0]!.sendAtLocal="2026-02-30T07:30";assert.throws(()=>validateEmailTiming(request,result));}
 }finally{store.close();}
});
test("failed generation never falls back to fixed timing; paused or replaced plans cannot publish in-flight work",async()=>{
 for(const scenario of ["failure","pause","replace","timezone"]){const store=new SqliteWorkspaceStore(":memory:");try{
  const plan=emailPlanFixture(store);verifiedEmailFixture(store);const schedule=createAgentEmailSchedule(store,async request=>{if(scenario==="failure")throw new Error("Unavailable");if(scenario==="pause")store.email.setEnabled(false);if(scenario==="replace")emailPlanFixture(store,"Replacement");if(scenario==="timezone")store.email.updateSettings({...store.email.settings(),cityTimeZones:{paris:"Europe/Paris"}});return emailTimingFixture(request);},now);
  assert.equal((await schedule(plan,zones,now())).length,0);assert.ok(store.email.timingStatus(plan.id,plan.version)!=="ready");assert.equal(store.email.list().length,0);
 }finally{store.close();}}
});
test("untimed activities and unresolved destination zones do not invent notification opportunities",()=>{
 const store=new SqliteWorkspaceStore(":memory:");try{const plan=emailPlanFixture(store);assert.equal(emailTimingOpportunities(plan,zones).length,4);assert.equal(emailTimingOpportunities(plan,new Map()).length,0);assert.ok(emailTimingOpportunities(plan,zones).every(item=>item.title!=="Rest when you like"));}finally{store.close();}
});

test("schema 24 removes legacy timing settings and preserves verified recipient and delivery history",()=>{
 const directory=mkdtempSync(join(tmpdir(),"landi-timing-migration-"));const file=join(directory,"workspace.sqlite");let store=new SqliteWorkspaceStore(file);
 try{
  const plan=emailPlanFixture(store);verifiedEmailFixture(store);const verifiedSettings=store.email.settings();store.email.enqueue({id:"old-fixed-time",planId:plan.id,planVersion:plan.version,kind:"morning",date:"2026-11-10",dueAt:"2026-11-10T07:30:00Z",expiresAt:"2026-11-10T23:59:00Z",recipientRevision:verifiedSettings.revision});const delivery=store.email.list().find(job=>job.id==="old-fixed-time")!;store.close();
  const database=new DatabaseSync(file);database.exec("ALTER TABLE email_settings ADD COLUMN morning_time TEXT DEFAULT '08:00'; ALTER TABLE email_settings ADD COLUMN transfer_lead INTEGER DEFAULT 20; ALTER TABLE email_settings ADD COLUMN dining_lead INTEGER DEFAULT 30; DELETE FROM schema_migrations WHERE version>=24;");database.close();
  store=new SqliteWorkspaceStore(file);const maintenance=store.getDatabaseMaintenanceStatus();assert.equal(maintenance.schemaVersion,maintenance.latestSchemaVersion);assert.deepEqual(store.email.settings(),verifiedSettings);assert.equal(store.email.settings().verified,true);assert.equal(store.email.settings().enabled,true);assert.deepEqual(store.email.list().find(job=>job.id==="old-fixed-time"),{...delivery,status:"cancelled",failureCode:"timing_replaced"});assert.ok(!("morningTime" in store.email.settings()));
  const check=new DatabaseSync(file,{readOnly:true});try{assert.ok(!check.prepare("PRAGMA table_info(email_settings)").all().some(column=>["morning_time","transfer_lead","dining_lead"].includes(String(column.name))));}finally{check.close();}
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test("缺少安排服务或时区时持久保存可恢复待处理状态，不生成固定时刻工作", async () => {
 const { prepareAgentEmailTiming } = await import("./email-agent-timing.js");
 const directory=mkdtempSync(join(tmpdir(),"landi-pending-timing-"));const file=join(directory,"workspace.sqlite");let store=new SqliteWorkspaceStore(file);
 try {
  const plan=emailPlanFixture(store);verifiedEmailFixture(store);
  const unavailable=prepareAgentEmailTiming(store,plan,new Map(),now());
  assert.equal(store.email.timing(unavailable.id)?.failureCode,"timing_context_unavailable");
  const pending=prepareAgentEmailTiming(store,plan,zones,now());
  assert.deepEqual(await createAgentEmailSchedule(store,undefined,now)(plan,zones,now()),[]);
  assert.equal(store.email.timing(pending.id)?.failureCode,"timing_provider_unavailable");
  store.close();store=new SqliteWorkspaceStore(file);
  assert.equal(store.email.timing(pending.id)?.status,"pending");
  assert.equal(store.email.timing(pending.id)?.failureCode,"timing_provider_unavailable");
  const later=()=>new Date("2026-11-10T07:06:00Z");
  assert.ok((await createAgentEmailSchedule(store,async request=>emailTimingFixture(request),later)(store.getExecutionPlan()!,zones,later())).length);
  assert.equal(store.email.timing(pending.id)?.status,"ready");
  assert.equal(store.email.list().length,0);
 } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test("真实确认交接后来源时区更正，磁盘重开沿当前指针读回且保留旧记录和冻结字节", async () => {
 const { prepareTravelAdjustmentDevelopmentFixture } = await import(new URL("../../../tests/browser/travel-adjustment-development-fixture.ts", import.meta.url).href);
 const { compileTripBlueprint } = await import("@c-assistant/core");
 const { consumeTravelAdjustmentHandoffs, readTravelAdjustmentEmailEffects } = await import("./email-plan-review.js");
 const directory=mkdtempSync(join(tmpdir(),"landi-handoff-timing-current-"));const file=join(directory,"workspace.sqlite");
 const at=new Date("2026-11-18T00:00:00Z");let store:SqliteWorkspaceStore|undefined;
 try {
  await prepareTravelAdjustmentDevelopmentFixture(file);
  store=new SqliteWorkspaceStore(file);
  const blueprint=structuredClone(store.getWorkspace().activeBlueprint!);blueprint.version++;
  for(const day of blueprint.days)for(const [index,block] of (day.blocks??[]).entries()){
   block.startTime=`${String(9+index*2).padStart(2,"0")}:00`;block.durationMinutes=60;
   const stop=day.stops.find(item=>item.placeId===block.placeId);if(stop)stop.time=block.startTime;
  }
  store.saveTripBlueprint(blueprint);
  store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint,{createdAt:at.toISOString()}));
  const context=store.captureAdjustmentContext(),workspace=store.getWorkspace(),digest=store.travelAdjustmentProposalDigest();
  store.confirmPlan(workspace.activePlan.id,workspace.activePlan.version,{expectedBase:context.execution!,expectedBlueprintVersion:workspace.activeBlueprint!.version,expectedRecipientRevision:context.recipientRevision,adjustmentContext:context,proposalDigest:digest,confirmedAt:at.toISOString()});
  const requestId="manual:"+digest;
  consumeTravelAdjustmentHandoffs(store,at);
  const receipt=store.getTravelAdjustmentReceipt(requestId)!;
  assert.equal(store.listPendingTravelAdjustmentHandoffs().length,0);
  const notificationId=receipt.handoff!.readbackRef!.slice("email-outbox:".length);
  const frozen=structuredClone(store.email.get(notificationId)!);
  const initialId=frozen.content!.adjustment!.timingId;
  const initialTiming=structuredClone(store.email.timing(initialId));
  assert.equal(initialTiming?.status,"pending");
  assert.equal(initialTiming?.failureCode,"timing_pending");
  const plan=store.getExecutionPlan()!;
  assert.equal(store.email.currentTiming(plan.id,plan.version)?.id,initialId);
  const knownZones=new Map((plan.presentation?.days??[]).flatMap(day=>day.city?[[day.city.trim().toLowerCase(),"Asia/Shanghai"] as const]:[]));
  const jobs=await createAgentEmailSchedule(store,async request=>emailTimingFixture(request),()=>at)(plan,knownZones,at);
  assert.ok(jobs.length);
  const recovered=store.email.currentTiming(plan.id,plan.version)!;
  assert.notEqual(recovered.id,initialId);assert.equal(recovered.status,"ready");
  assert.equal(readTravelAdjustmentEmailEffects(store,notificationId)?.timing?.id,recovered.id);
  assert.deepEqual(store.email.timing(initialId),initialTiming);
  assert.deepEqual(store.email.get(notificationId),frozen);
  store.close();store=new SqliteWorkspaceStore(file);
  assert.deepEqual(store.email.currentTiming(plan.id,plan.version),recovered);
  assert.equal(readTravelAdjustmentEmailEffects(store,notificationId)?.timing?.id,recovered.id);
  assert.equal(readTravelAdjustmentEmailEffects(store,notificationId)?.timing?.status,"ready");
  assert.deepEqual(store.email.timing(initialId),initialTiming);
  assert.deepEqual(store.email.get(notificationId),frozen);
 } finally {store?.close();rmSync(directory,{recursive:true,force:true});}
});

test("旧时区安排迟到时不能覆盖当前安排或发布旧邮件工作", async () => {
 const store=new SqliteWorkspaceStore(":memory:");
 try {
  const plan=emailPlanFixture(store);verifiedEmailFixture(store);
  let release!:(result:ReturnType<typeof emailTimingFixture>)=>void;
  let oldRequest!:Parameters<typeof emailTimingFixture>[0];
  const oldWork=createAgentEmailSchedule(store,request=>{oldRequest=request;return new Promise(resolve=>{release=resolve;});},now)(plan,zones,now());
  const oldId=store.email.currentTiming(plan.id,plan.version)!.id;
  const newZones=new Map([["paris","Europe/Paris"]]);
  const jobs=await createAgentEmailSchedule(store,async request=>emailTimingFixture(request),now)(plan,newZones,now());
  assert.ok(jobs.length);
  const current=structuredClone(store.email.currentTiming(plan.id,plan.version)!);
  assert.notEqual(current.id,oldId);assert.equal(current.status,"ready");
  release(emailTimingFixture(oldRequest));
  assert.deepEqual(await oldWork,[]);
  assert.notEqual(store.email.timing(oldId)?.status,"ready");
  assert.deepEqual(store.email.currentTiming(plan.id,plan.version),current);
 } finally {store.close();}
});

test('安排当前关联从 A 切至 B 后复用 A，用户状态与重启读回都跟随 A',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'landi-timing-return-current-')),file=join(directory,'workspace.sqlite');let store=new SqliteWorkspaceStore(file);
 try{
  const plan=emailPlanFixture(store);verifiedEmailFixture(store);let calls=0;
  const schedule=createAgentEmailSchedule(store,async request=>{calls++;return emailTimingFixture(request);},now);
  await schedule(plan,zones,now());const original=structuredClone(store.email.currentTiming(plan.id,plan.version)!);assert.equal(original.status,'ready');
  const alternative=prepareAgentEmailTiming(store,plan,new Map([['paris','Europe/Paris']]),now());
  assert.notEqual(alternative.id,original.id);assert.equal(store.email.timingStatus(plan.id,plan.version),'pending');
  assert.ok((await schedule(plan,zones,now())).length);assert.equal(calls,1);assert.equal(store.email.timingStatus(plan.id,plan.version),'ready');assert.deepEqual(store.email.currentTiming(plan.id,plan.version),original);
  store.close();store=new SqliteWorkspaceStore(file);assert.equal(store.email.timingStatus(plan.id,plan.version),'ready');assert.deepEqual(store.email.currentTiming(plan.id,plan.version),original);assert.equal(store.email.timing(alternative.id)?.status,'pending');
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
