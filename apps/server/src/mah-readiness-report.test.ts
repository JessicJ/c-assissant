import { registerMahReadinessRoute } from './mah-readiness-route.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildMahReadinessReport } from './mah-readiness-report.js';
import { registerRuntimeRoutes } from './runtime-routes.js';
import { productionReadiness } from './production-readiness.js';
import { hash } from './mah-preflight-values.js';
const at='2026-10-22T00:00:00Z', end='2026-10-22T01:00:00Z', root='/fictional', digest='a'.repeat(64);
const scope={planId:'fictional',planVersion:1,recipientConfigRevision:0};
function scheduleInput(){
 const definition={schemaVersion:1,kind:'landi_mah_schedule',owner:'mah',scheduleId:'schedule',revision:1,scope,operation:'email_research',desiredState:'enabled',timeZone:'Asia/Tokyo',validFrom:at,expiresAt:end,trigger:{kind:'interval',seconds:60},policy:{overlap:'forbid',missed:'skip_expired_coalesce_latest',uncertainDelivery:'reconcile_only',scopeChange:'invalidate_before_effect',dst:'skip_gap_run_once_fold'},authority:'artifact_only'};
 const run={schemaVersion:1,kind:'landi_mah_schedule_run',scheduleId:'schedule',scheduleRevision:1,occurrenceId:'occurrence',requestId:'request',scope,scheduledFor:at,expiresAt:end,status:'succeeded',executionReceipt:{taskId:'task',requestSha256:digest,resultSha256:digest,receiptRef:'fictional'}};
 return {definition,run,frozenRun:structuredClone(run),currentScope:scope,now:at,expectedRequestSha256:digest,expectedResultSha256:digest};
}
const find=(r:ReturnType<typeof buildMahReadinessReport>,id:string)=>r.items.find(x=>x.id===id)!;
test('missing inputs are unassessed, MAH owns selection, all permissions stay false',()=>{
 const r=buildMahReadinessReport();assert.equal(r.selectionOwner,'mah');assert.equal(r.status,'blocked');assert.equal(r.executable,false);assert.ok(r.items.every(x=>x.status==='not_assessed'&&!x.executable));
});
test('bad JSON is isolated and secrets are not copied into diagnostics',()=>{
 const r=buildMahReadinessReport({scheduleList:{raw:'{"SECRET-trip":',projectRoot:root},scheduleRuns:{raw:JSON.stringify({ok:true,project_root:root,scheduled_task_id:'schedule',count:0,runs:[]}),projectRoot:root,scheduleId:'schedule'}});
 assert.equal(find(r,'schedule_readback').status,'invalid');assert.equal(find(r,'schedule_runs').status,'consistent_unverified');assert.ok(!JSON.stringify(r).includes('SECRET'));assert.ok(!JSON.stringify(r).includes(root));
});
test('completed public runs do not become verified business success',()=>{
 const raw=JSON.stringify({ok:true,project_root:root,scheduled_task_id:'schedule',count:1,runs:[{run_id:'run',scheduled_task_id:'schedule',project_root:root,trigger:'interval',status:'completed',scheduled_for:at,enqueued_at:at,scheduler_task_id:'task'}]});
 const r=buildMahReadinessReport({scheduleRuns:{raw,projectRoot:root,scheduleId:'schedule'}});assert.equal(find(r,'schedule_runs').code,'public_execution_receipt_unverified');assert.equal(r.executable,false);
});
test('wrong project and stale revision retain attributable blocking codes',()=>{
 const schedule=scheduleInput();schedule.run.scheduleRevision=2;
 const r=buildMahReadinessReport({scheduleList:{raw:JSON.stringify({schema_version:1,ok:true,project_root:'/other',generated_at:at,count:0,schedules:[]}),projectRoot:root},schedulePreflight:schedule});
 assert.equal(find(r,'schedule_readback').code,'identity_mismatch');assert.equal(find(r,'schedule_contract').code,'stale_revision');
});
test('consistent preflight still requires public receipt and cannot select an Agent',()=>{
 const r=buildMahReadinessReport({schedulePreflight:scheduleInput()});assert.equal(find(r,'schedule_contract').status,'consistent_unverified');assert.equal(find(r,'schedule_contract').code,'public_execution_receipt_unverified');assert.equal(find(r,'agent_selection').status,'not_assessed');
});
test('unknown service outcome stays reconcile-only without touching the projection',()=>{
 const action={schemaVersion:1,kind:'landi_mah_service_action',requestId:'request',serviceId:'landi',projectRoot:root,componentId:'c-assissant',launcherContractVersion:1,action:'stop',expectedRevision:1,desiredState:'stopped'};
 const receipt={schemaVersion:1,kind:'landi_mah_service_receipt',requestId:'request',requestSha256:hash(action),transitionId:'transition',revision:2,status:'unknown',beforeState:'running',desiredState:'stopped',ownership:'unknown',projectionSha256:null,observedAt:at};
 const r=buildMahReadinessReport({servicePreflight:{action,receipt,projection:null,currentRevision:1,beforeState:'running',projectRoot:root,now:at,maxAgeMs:60000}});assert.equal(find(r,'service_contract').code,'reconcile_only');assert.equal(r.executable,false);
});
test('readiness API preserves old fields, adds diagnostics and never touches dependencies',async()=>{
 const app=Fastify();let accesses=0;
 const forbidden=new Proxy({}, {get(){accesses++;throw new Error('No database/runtime access allowed');}});
 registerRuntimeRoutes(app,{store:forbidden as Parameters<typeof registerRuntimeRoutes>[1]['store'],runtimes:forbidden as Parameters<typeof registerRuntimeRoutes>[1]['runtimes'],getLocalConfiguration:()=>{throw new Error('No configuration read');}});
 try{
 const response=await app.inject({method:'GET',url:'/api/agent-readiness'});assert.equal(response.statusCode,200);
 const {diagnostics,connection,...existing}=response.json();assert.equal(connection.selectionOwner,"mah");assert.equal(connection.executable,false);assert.equal(connection.configuration,"unverified");assert.deepEqual(existing,productionReadiness());assert.deepEqual(diagnostics,buildMahReadinessReport());assert.equal(accesses,0);
 }finally{await app.close();}
});

test('submission capability belongs to the configured instance and never grants full execution readiness', async () => {
 for (const configured of [false, true]) {
  const app = Fastify();
  registerMahReadinessRoute(app, undefined, configured);
  try {
   const response = await app.inject({ method: 'GET', url: '/api/agent-readiness' });
   const body = response.json();
   assert.equal(body.conversation, false); assert.equal(body.generation, false); assert.equal(body.unattendedEmail, false);
   assert.equal(body.conversationSubmission?.configured === true, configured);
   if (configured) assert.deepEqual(body.conversationSubmission, { configured: true, mode: 'read_only', preflight: 'required_per_request' });
  } finally { await app.close(); }
 }
});
