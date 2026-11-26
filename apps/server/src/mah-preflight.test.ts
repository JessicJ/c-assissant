import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMahScheduleList,parseMahScheduleRuns} from './mah-schedule-readback.js';
import {preflightMahSchedule,assertMahScheduleRetry} from './mah-schedule-contract-validation.js';
import {preflightMahService} from './mah-service-contract-validation.js';
import {hash} from './mah-preflight-values.js';
const at='2026-10-22T00:00:00Z',later='2026-10-22T01:00:00Z',root='/fictional/landi',digest='a'.repeat(64);
const scope={planId:'fictional',planVersion:1,recipientConfigRevision:0};
function schedule(){return {schemaVersion:1,kind:'landi_mah_schedule',owner:'mah',scheduleId:'schedule',revision:1,scope,operation:'email_research',desiredState:'enabled',timeZone:'Asia/Tokyo',validFrom:at,expiresAt:later,trigger:{kind:'interval',seconds:300},policy:{overlap:'forbid',missed:'skip_expired_coalesce_latest',uncertainDelivery:'reconcile_only',scopeChange:'invalidate_before_effect',dst:'skip_gap_run_once_fold'},authority:'artifact_only'};}
function run(){return {schemaVersion:1,kind:'landi_mah_schedule_run',scheduleId:'schedule',scheduleRevision:1,occurrenceId:'occurrence',requestId:'request',scope,scheduledFor:at,expiresAt:later,status:'succeeded',executionReceipt:{taskId:'task',requestSha256:digest,resultSha256:digest,receiptRef:'public'}};}
function scheduleInput(){return {definition:schedule(),run:run(),frozenRun:run(),currentScope:scope,now:at,expectedRequestSha256:digest,expectedResultSha256:digest};}
function publicRow(){return {scheduled_task_id:'schedule',registration_state:'registered',title:'fictional',description:'fictional',schedule:{kind:'interval',interval_ms:60000},attachments:[],status:'waiting',priority:0,meta:{},updated_at:at,next_fire_state:'available',next_fire_at:later,last_run_state:'no_run_records',last_run:null,run_counts:{total:0,succeeded:0,failed:0,cancelled:0,skipped:0},runtime_recovery:null};}
function list(rows:unknown[]=[publicRow()]){return JSON.stringify({schema_version:1,ok:true,project_root:root,generated_at:at,count:rows.length,schedules:rows});}
function history(){return {ok:true,project_root:root,scheduled_task_id:'schedule',count:1,runs:[{run_id:'run',scheduled_task_id:'schedule',project_root:root,trigger:'interval',status:'completed',scheduled_for:at,enqueued_at:at}]};}
test('public list preserves missing revision and rejects project/count/duplicate/state mismatch',()=>{
 const r=parseMahScheduleList(list(),root);assert.equal(r.schedules[0]?.revision,null);assert.equal(r.schedules[0]?.executionVerified,false);
 assert.throws(()=>parseMahScheduleList(list(),'/other'));assert.throws(()=>parseMahScheduleList(list([publicRow(),publicRow()]),root));
 assert.throws(()=>parseMahScheduleList(list().replace('"count":1','"count":2'),root));
 assert.throws(()=>parseMahScheduleList(list([{...publicRow(),next_fire_at:null}]),root));
 assert.throws(()=>parseMahScheduleList(list([{...publicRow(),revision:1}]),root));
 const missing={...publicRow(),registration_state:'missing',title:null,description:null,schedule:null,attachments:null,status:null,priority:null,meta:null,updated_at:null,next_fire_state:'not_registered',next_fire_at:null,last_run_state:'not_registered',run_counts:null};
 assert.equal(parseMahScheduleList(list([missing]),root).schedules[0]?.registrationState,'missing');
});
test('run completed never means business verified; optional task ID stays null',()=>{
 const h=history(),r=parseMahScheduleRuns(JSON.stringify(h),root,'schedule');assert.equal(r.runs[0]?.taskId,null);assert.equal(r.runs[0]?.businessResultVerified,false);assert.equal(r.runs[0]?.requestId,null);
 assert.throws(()=>parseMahScheduleRuns(JSON.stringify(h),root,'other'));
 h.runs[0]!.project_root='/other';assert.throws(()=>parseMahScheduleRuns(JSON.stringify(h),root,'schedule'));
});
test('invalid time, unknown enum and malformed JSON are rejected',()=>{
 assert.throws(()=>parseMahScheduleList('{',root));assert.throws(()=>parseMahScheduleList(list([{...publicRow(),updated_at:'2026-02-30T00:00:00Z'}]),root));
 const h=history();h.runs[0]!.status='succeeded';assert.throws(()=>parseMahScheduleRuns(JSON.stringify(h),root,'schedule'));
});
test('consistent schedule data remains blocked without public provenance',()=>{
 const r=preflightMahSchedule(scheduleInput());assert.equal(r.executable,false);assert.equal(r.blocker,'public_execution_receipt_unverified');
 const i=scheduleInput();i.run.status='uncertain';assert.equal(preflightMahSchedule(i).blocker,'reconcile_only');
});
test('stale version, expiry, pause and changed scope block late results',()=>{
 for(const mutate of [(i:ReturnType<typeof scheduleInput>)=>{i.definition.desiredState='paused';}, (i:ReturnType<typeof scheduleInput>)=>{i.run.scheduleRevision=2;}, (i:ReturnType<typeof scheduleInput>)=>{i.now=later;}, (i:ReturnType<typeof scheduleInput>)=>{i.currentScope={...scope,planVersion:2};}, (i:ReturnType<typeof scheduleInput>)=>{i.run.expiresAt='2026-10-23T00:00:00Z';}, (i:ReturnType<typeof scheduleInput>)=>{i.definition.timeZone='invalid/zone';}]){
 const i=scheduleInput();mutate(i);assert.throws(()=>preflightMahSchedule(i));
 }
});
test('retry identity and receipt digests cannot be replaced',()=>{
 const i=scheduleInput();i.run.requestId='different';assert.throws(()=>preflightMahSchedule(i));
 const j=scheduleInput();j.expectedResultSha256='b'.repeat(64);assert.throws(()=>preflightMahSchedule(j));
 assertMahScheduleRetry(run(),structuredClone(run()));assert.throws(()=>assertMahScheduleRetry(run(),{...run(),scheduledFor:later}));
});
function serviceInput(){
 const action={schemaVersion:1,kind:'landi_mah_service_action',requestId:'request',serviceId:'landi',projectRoot:root,componentId:'c-assissant',launcherContractVersion:1,action:'stop',expectedRevision:1,desiredState:'stopped'};
 const projection={schemaVersion:1,kind:'landi_mah_background_runtime_projection',serviceId:'landi',project:{projectRoot:root,componentId:'c-assissant',launcherContractVersion:1},desiredState:'stopped',observedState:'stopped',supervisor:{owner:'mah_scheduler',registrationId:'reg',reconcileGeneration:1,restartPolicy:'never',restartCount:0},instance:null,readiness:{ownership:false,server:false,homepage:false,workspaceApi:false},persistence:{desiredStatePersisted:true,recoveredAfterMahRestart:false,recoveredAfterHostRestart:false},observedAt:at,transition:{transitionId:'transition',action:'stop',idempotent:true,acceptedAt:at}};
 const receipt={schemaVersion:1,kind:'landi_mah_service_receipt',requestId:'request',requestSha256:hash(action),transitionId:'transition',revision:2,status:'completed',beforeState:'running',desiredState:'stopped',ownership:'verified',projectionSha256:hash(projection),observedAt:at};
 return {action,projection,receipt,currentRevision:1,beforeState:'running' as const,projectRoot:root,now:at,maxAgeMs:60000};
}
test('consistent stopped service is not a trusted receipt or authorization',()=>{const r=preflightMahService(serviceInput());assert.equal(r.executable,false);assert.equal(r.blocker,'public_service_receipt_unverified');});
test('service refuses stale revision, wrong root, altered digest, ownership conflict and stale observation',()=>{
 for(const mutate of [(i:ReturnType<typeof serviceInput>)=>{i.currentRevision=2;}, (i:ReturnType<typeof serviceInput>)=>{i.projectRoot='/other';}, (i:ReturnType<typeof serviceInput>)=>{i.receipt.requestSha256=digest;}, (i:ReturnType<typeof serviceInput>)=>{i.receipt.ownership='conflict';}, (i:ReturnType<typeof serviceInput>)=>{i.now=later;}, (i:ReturnType<typeof serviceInput>)=>{i.receipt.revision=1;}]){const i=serviceInput();mutate(i);assert.throws(()=>preflightMahService(i));}
});
test('completed stop must be stopped, persistent and correlate transition',()=>{
 for(const mutate of [(i:ReturnType<typeof serviceInput>)=>{i.projection.observedState='ready';}, (i:ReturnType<typeof serviceInput>)=>{i.projection.persistence.desiredStatePersisted=false;}, (i:ReturnType<typeof serviceInput>)=>{i.projection.transition.transitionId='other';}]){const i=serviceInput();mutate(i);i.receipt.projectionSha256=hash(i.projection);assert.throws(()=>preflightMahService(i));}
 const i=serviceInput();i.receipt.status='unknown';assert.equal(preflightMahService(i).blocker,'reconcile_only');
});
test('pure modules have no execution/storage/UI dependencies and gates remain false',()=>{
 for(const name of ['mah-schedule-readback','mah-schedule-contract-validation','mah-service-contract-validation','mah-preflight-values']){
 const s=readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8');assert.ok(!/from\s+['"](?:node:(?:fs|child_process|net|http)|@c-assistant\/storage)/.test(s));
 }
 const gates=readFileSync(new URL('./production-readiness.ts',import.meta.url),'utf8');for(const field of ['conversation','generation','revision','unattendedEmail','hosting'])assert.ok(gates.includes(`${field}: false`));
});
