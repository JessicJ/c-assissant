import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createMahReadonlySnapshots, runReadonlySnapshot } from './mah-readonly-snapshots.js';
import { registerRuntimeRoutes } from './runtime-routes.js';
import { productionReadiness } from './production-readiness.js';
const root='/fictional/project',at='2026-10-22T00:00:00Z';
const id=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
function row(n:number){return {scheduled_task_id:id(n),registration_state:'registered',title:'SECRET TITLE',description:'SECRET DESCRIPTION',schedule:{kind:'interval',interval_ms:60000},attachments:[],status:'waiting',priority:0,meta:{},updated_at:at,next_fire_state:'available',next_fire_at:'2026-10-22T00:01:00Z',last_run_state:'no_run_records',last_run:null,run_counts:{total:0,succeeded:0,failed:0,cancelled:0,skipped:0},runtime_recovery:null};}
const list=(count=0,generated=at)=>JSON.stringify({schema_version:1,ok:true,project_root:root,generated_at:generated,count,schedules:Array.from({length:count},(_,i)=>row(i+1))});
const runs=(scheduleId:string)=>JSON.stringify({ok:true,project_root:root,scheduled_task_id:scheduleId,count:0,runs:[]});
const item=(report:Awaited<ReturnType<ReturnType<typeof createMahReadonlySnapshots>>>,id:string)=>report.items.find(x=>x.id===id)!;
test('empty list records source and skips runs; no identifiers or business text leak',async()=>{
 const seen:string[][]=[];
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>Date.parse(at),run:async args=>{seen.push([...args]);return {code:0,stdout:list()};}});
 const r=await collect();assert.equal(seen.length,1);assert.equal(item(r,'schedule_readback').code,'no_schedule_registrations');assert.equal(item(r,'schedule_runs').code,'runs_not_queried_no_registrations');assert.equal(r.source.projectScopeVerified,true);assert.equal(r.executable,false);assert.ok(!JSON.stringify(r).includes(root));
});
test('query only listed UUIDs; enforce command and total history bounds',async()=>{
 const seen:string[][]=[];
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>Date.parse(at),run:async args=>{seen.push([...args]);return {code:0,stdout:args[2]==='list'?list(5):runs(args[6]!)};}});
 const r=await collect();assert.equal(seen.length,4);assert.equal(r.source.queriedSchedules,3);assert.equal(r.source.omittedSchedules,2);assert.equal(item(r,'schedule_runs').code,'snapshot_partial');
 for(const args of seen.slice(1))assert.deepEqual(args,['task','schedule','runs','--cwd',root,'--id',id(seen.indexOf(args)),'--limit','20','--format','json']);
 assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('concurrent requests coalesce and cache expires without background work',async()=>{
 let now=Date.parse(at),calls=0;let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>now,run:async()=>{calls++;await gate;return {code:0,stdout:list(0,new Date(now).toISOString())};}});
 const a=collect(),b=collect();release();const [x,y]=await Promise.all([a,b]);assert.equal(calls,1);assert.deepEqual(x,y);
 x.items[0]!.code='changed';assert.notEqual((await collect()).items[0]!.code,'changed');assert.equal(calls,1);
 now+=16000;await collect();assert.equal(calls,2);
});
test('old/future/wrong-project/malformed snapshots never query runs',async()=>{
 for(const raw of [list(1,'2026-10-21T00:00:00Z'),list(1,'2026-10-23T00:00:00Z'),list(1).replace(root,'/other'),'{SECRET']){
 let count=0;const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>Date.parse(at),run:async()=>{count++;return {code:0,stdout:raw};}});
 const r=await collect();assert.equal(item(r,'schedule_readback').status,'invalid');assert.equal(count,1);assert.ok(!JSON.stringify(r).includes('SECRET'));
 }
});
test('failure, timeout and oversized output are sanitized; no stale successful fallback',async()=>{
 for(const mode of ['error','timeout','large','exit']){
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>Date.parse(at),run:async()=>{if(mode==='error')throw new Error('SECRET');if(mode==='timeout')throw new Error('snapshot_timeout');return {code:mode==='exit'?1:0,stdout:'x'.repeat(1024*1024+1)};}});
 const r=await collect();assert.equal(item(r,'schedule_readback').status,'invalid');assert.ok(!JSON.stringify(r).includes('SECRET'));
 }
 let now=Date.parse(at),count=0;
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>now,run:async()=>{if(count++)throw new Error('fail');return {code:0,stdout:list()};}});
 await collect();now+=16000;assert.equal(item(await collect(),'schedule_readback').status,'invalid');
});
test('one run query failure is reported without discarding list diagnosis',async()=>{
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>Date.parse(at),run:async args=>({code:0,stdout:args[2]==='list'?list(1):runs(id(2))})});
 const r=await collect();assert.equal(item(r,'schedule_readback').status,'consistent_unverified');assert.equal(item(r,'schedule_runs').code,'snapshot_input_invalid');
});
test('runner rejects non-read commands before spawn',()=>{
 assert.throws(()=>runReadonlySnapshot(['task','resume','anything'],root),/snapshot_command_rejected/);
 assert.throws(()=>runReadonlySnapshot(['task','schedule','list','--cwd','relative','--format','json'],'relative'),/snapshot_project_invalid/);
});
test('API injected collector keeps old gates and never touches store/runtime',async()=>{
 const app=Fastify();let reads=0;const denied=new Proxy({}, {get(){reads++;throw new Error('forbidden');}});
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>Date.parse(at),run:async()=>({code:0,stdout:list()})});
 registerRuntimeRoutes(app,{store:denied as Parameters<typeof registerRuntimeRoutes>[1]['store'],runtimes:denied as Parameters<typeof registerRuntimeRoutes>[1]['runtimes'],getLocalConfiguration:()=>{throw new Error('forbidden');},getMahDiagnostics:collect});
 try{const res=await app.inject({method:'GET',url:'/api/agent-readiness?command=resume&projectRoot=/other'});assert.equal(res.statusCode,200);const {diagnostics,connection,...old}=res.json();assert.equal(connection.selectionOwner,"mah");assert.equal(connection.executable,false);assert.equal(connection.configuration,"unverified");assert.deepEqual(old,productionReadiness());assert.equal(diagnostics.selectionOwner,'mah');assert.equal(diagnostics.executable,false);assert.equal(reads,0);}finally{await app.close();}
});

test('empty run history is explicit and collection cannot outlive snapshot validity',async()=>{
 let now=Date.parse(at);
 const collect=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>now,run:async args=>({code:0,stdout:args[2]==='list'?list(1):runs(id(1))})});
 assert.equal(item(await collect(),'schedule_runs').code,'no_run_records');
 const slow=createMahReadonlySnapshots({projectRoot:()=>root,now:()=>now,run:async args=>{if(args[2]==='runs')now+=61000;return {code:0,stdout:args[2]==='list'?list(1):runs(id(1))};}});
 assert.equal(item(await slow(),'schedule_runs').code,'snapshot_stale');
});
