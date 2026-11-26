import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {SqliteWorkspaceStore} from '@c-assistant/storage';
const {prepareTravelAdjustmentDevelopmentFixture}=await import(new URL('../../../tests/browser/travel-adjustment-development-fixture.ts',import.meta.url).href);
import {enqueueAppliedAdjustment,reviewArrangement} from './email-plan-review.js';
import {registerPlanManagementRoutes} from './plan-management-routes.js';

test('完整安排包含空 blocks 的全部停留、未定时、交通及固定承诺，并完整渲染邮件',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'landi-review-projection-'));const file=join(dir,'workspace.sqlite');
 await prepareTravelAdjustmentDevelopmentFixture(file);const store=new SqliteWorkspaceStore(file);
 try {
  const blueprint=structuredClone(store.getWorkspace().activeBlueprint!);const plan=store.getWorkspace().activePlan;
  blueprint.days[0]!.blocks=[];blueprint.days[0]!.stops[0]!.time='09:00';blueprint.places[0]!.durationMinutes=90;
  blueprint.days[1]!.blocks![0]!.startTime='14:00';blueprint.days[1]!.blocks![0]!.endTime='15:30';blueprint.days[1]!.blocks![0]!.durationMinutes=90;
  blueprint.days[1]!.blocks![0]!.summary='长安排全部保留。'.repeat(120);
  blueprint.bookingConstraints=[{id:'private-booking-key',title:'虚构固定预约',type:'event',status:'confirmed',sourceLabel:'本地保存',importedAt:'2026-11-17T00:00:00Z',constraintStrength:'hard',segments:[{id:'private-segment-key',segmentType:'event_window',title:'工坊预约',startAtLocal:'2026-12-02T14:00',endAtLocal:'2026-12-02T15:30',location:'虚构工坊二楼',fixedCommitment:true,constraintStrength:'hard',needsReviewReasons:[]}]}];
  const projection=reviewArrangement(blueprint);const serialized=JSON.stringify(projection);
  for(const value of ['海湾市场','灯塔茶馆','陶艺工坊','90 min','14:00–15:30','Time to be confirmed','Fixed commitment','虚构工坊二楼','Transport'])assert.ok(serialized.includes(value),value);
  assert.ok(!serialized.includes('private-booking-key'));
  let content:any;
  // 明确的领域消费 fixture：只验证邮件渲染，不冒充真实公开执行 producer。
  const fake={getTravelAdjustmentEmailConsumption:()=>({receipt:{status:'applied',reason:'虚构客观变化',basis:'objective_change',appliedAt:'2026-11-17T00:00:00Z',handoff:{intentId:'synthetic-intent',replacement:{plan:{id:plan.id,version:plan.version}}}},context:store.captureAdjustmentContext(),arrangement:{plan,blueprint}}),email:{settings:()=>store.email.settings(),ensureTiming:()=>{},enqueue:(input:any)=>{content=input.content;}}} as unknown as SqliteWorkspaceStore;
  assert.ok(enqueueAppliedAdjustment(fake,'synthetic-request',new Date('2026-11-17T00:00:00Z')));
  assert.match(content.html, /<html lang="en">/);
  assert.match(content.subject, /^Your itinerary is updated/);
  assert.ok(content.text.includes('UPDATE APPLIED'));
  assert.ok(!content.text.includes('行程已调整'));
  for(const rendered of [content.html,content.text])for(const value of ['海湾市场','灯塔茶馆','陶艺工坊','90 min','14:00–15:30','Fixed commitment','虚构工坊二楼','长安排全部保留。'.repeat(120)])assert.ok(rendered.includes(value),value);
  const originalTimeZone = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    const saved = fake.getTravelAdjustmentEmailConsumption('synthetic-request', '2026-11-17T00:00:00Z')!;
    const confirmed = {
      ...fake,
      getTravelAdjustmentEmailConsumption: () => ({ ...saved, receipt: { ...saved.receipt, basis: 'user_confirmation' }, confirmation: { confirmedAt: '2026-11-17T00:00:00Z' } })
    } as unknown as SqliteWorkspaceStore;
    assert.ok(enqueueAppliedAdjustment(confirmed, 'synthetic-confirmed-request', new Date('2026-11-17T00:00:00Z')));
    assert.ok(content.text.includes('Confirmed: 17/11/2026, 8:00:00 GMT+8'));
    assert.ok(!content.text.includes('Confirmed: 17/11/2026, 00:00:00 UTC'));
    assert.ok(enqueueAppliedAdjustment(fake, 'synthetic-applied-request', new Date('2026-11-17T00:00:00Z')));
    assert.ok(content.text.includes('Applied: 17/11/2026, 8:00:00 GMT+8'));
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }

 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('确认读取投影活动、具体场馆事实与未知影响，不泄露 provider、refs 或异常',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'landi-review-source-'));const file=join(dir,'workspace.sqlite');await prepareTravelAdjustmentDevelopmentFixture(file);const store=new SqliteWorkspaceStore(file);const server=Fastify();
 registerPlanManagementRoutes(server,{store,getMaps:()=>{throw Error('no external maps');},startActivePlanMonitoring:()=>{}});
 try {
  const base=store.listTravelAdjustmentObservations(store.getExecutionPlan()!.id,store.getExecutionPlan()!.version)[0]!.observation;
  store.commitTravelAdjustment({requestId:'synthetic-extra-facts',context:store.captureAdjustmentContext(),now:'2026-11-17T00:01:00Z',observations:[{...base,key:'虚构第二日到访',objectRef:'fixture-place-3',targetDate:'2026-12-02',status:'expired',factObservedAt:'2026-11-16T00:00:00Z',retrievedAt:'2026-11-16T00:00:00Z',validUntil:'2026-11-16T01:00:00Z',provider:'private-provider-id',reason:'internal/path raw exception',evidenceRefs:['private-ref']}]});
  const response=await server.inject({method:'GET',url:`/api/plans/${store.getWorkspace().activePlan.id}/confirmation-review`});assert.equal(response.statusCode,200);
  const body=response.json();assert.equal(body.observations.length,2);
  assert.ok(body.observations.every((fact:any)=>fact.impact.includes('The itinerary impact needs verification')));
  assert.ok(body.observations.every((fact:any)=>fact.safeFacts.some((item:any)=>item.value?.includes('Temporarily closed'))));
  assert.ok(body.observations.every((fact:any)=>!('candidate' in fact)));
  assert.ok(body.observations.some((fact:any)=>fact.activities.some((activity:any)=>activity.title==='海湾市场'&&activity.date==='2026-12-01')));
  assert.ok(body.observations.some((fact:any)=>fact.status==='expired'&&fact.targetDate==='2026-12-02'&&fact.activities.some((activity:any)=>activity.title==='陶艺工坊')));
  for(const secret of ['private-provider-id','private-ref','internal/path raw exception'])assert.ok(!JSON.stringify(body.observations).includes(secret));
  assert.ok(body.arrangements.original.days.length);assert.ok(body.arrangements.replacement.days.length);
 }finally{await server.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('普通已保存预订夹具的旧新审阅均保留固定承诺',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'landi-review-booking-'));const file=join(dir,'workspace.sqlite');await prepareTravelAdjustmentDevelopmentFixture(file,'booking-relationships');const store=new SqliteWorkspaceStore(file);const server=Fastify();
 registerPlanManagementRoutes(server,{store,getMaps:()=>{throw Error('no external maps');},startActivePlanMonitoring:()=>{}});
 try {
  const response=await server.inject({method:'GET',url:`/api/plans/${store.getWorkspace().activePlan.id}/confirmation-review`});assert.equal(response.statusCode,200);
  for(const side of ['original','replacement'])assert.ok(response.json().arrangements[side].commitments.some((line:string)=>line.includes('Fixed commitment')));
 }finally{await server.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
