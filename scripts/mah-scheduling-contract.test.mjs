import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
// Reuse the installed server validator dependencies; no installation/build required.
const serverRequire = createRequire(new URL('../apps/server/package.json', import.meta.url));
const fastifyRequire = createRequire(serverRequire.resolve('fastify'));
const compilerRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'));
const Ajv = compilerRequire('ajv/dist/2020.js').default;
const formats = compilerRequire('ajv-formats');
const ajv = new Ajv({ strict: false, allErrors: true }); formats(ajv);
const read = name => JSON.parse(readFileSync(new URL(`../docs/contracts/${name}`, import.meta.url),'utf8'));
const scheduling = ajv.compile(read('landi-mah-scheduling.v1.schema.json'));
const lifecycle = ajv.compile(read('landi-mah-service-lifecycle.v1.schema.json'));
const projection = ajv.compile(read('landi-mah-background-runtime.schema.json'));
const scope = {planId:'fictional',planVersion:1,recipientConfigRevision:0};
const at='2026-10-22T00:00:00Z', hash='a'.repeat(64);
const schedule=()=>({schemaVersion:1,kind:'landi_mah_schedule',owner:'mah',scheduleId:'fictional',revision:1,scope,operation:'email_research',desiredState:'enabled',timeZone:'Asia/Tokyo',validFrom:at,expiresAt:'2026-10-23T00:00:00Z',trigger:{kind:'interval',seconds:300},policy:{overlap:'forbid',missed:'skip_expired_coalesce_latest',uncertainDelivery:'reconcile_only',scopeChange:'invalidate_before_effect',dst:'skip_gap_run_once_fold'},authority:'artifact_only'});
const action=()=>({schemaVersion:1,kind:'landi_mah_service_action',requestId:'fictional',serviceId:'landi',projectRoot:'/fictional/landi',componentId:'c-assissant',launcherContractVersion:1,action:'start',expectedRevision:0,desiredState:'running'});
function valid(validator,value){assert.equal(validator(value),true,JSON.stringify(validator.errors));}
function invalid(validator,value){assert.equal(validator(value),false);}
test('schedule supports declared triggers, MAH ownership, and strict scope',()=>{
 for(const trigger of [{kind:'interval',seconds:60},{kind:'cron',expression:'0 8 * * *'},{kind:'once',at}])valid(scheduling,{...schedule(),trigger});
 for(const patch of [{owner:'landi'},{scope:{...scope,planVersion:0}},{scope:{...scope,extra:'bad'}},{agent:'codex'},{expiresAt:'invalid'}])invalid(scheduling,{...schedule(),...patch});
});
test('research does not authorize email delivery or change retry/overlap policy',()=>{
 invalid(scheduling,{...schedule(),authority:'approved_email_delivery'});
 invalid(scheduling,{...schedule(),operation:'email_delivery'});
 valid(scheduling,{...schedule(),operation:'email_delivery',authority:'approved_email_delivery'});
 for(const policy of [{...schedule().policy,overlap:'allow'},{...schedule().policy,uncertainDelivery:'retry'},{...schedule().policy,missed:'replay_all'}])invalid(scheduling,{...schedule(),policy});
});
test('occurrence identity and authoritative receipt are required for success',()=>{
 const run={schemaVersion:1,kind:'landi_mah_schedule_run',scheduleId:'fictional',scheduleRevision:1,occurrenceId:'occurrence',requestId:'request',scope,scheduledFor:at,expiresAt:at,status:'uncertain',executionReceipt:null};
 valid(scheduling,run); invalid(scheduling,{...run,status:'succeeded'});
 valid(scheduling,{...run,status:'succeeded',executionReceipt:{taskId:'task',requestSha256:hash,resultSha256:hash,receiptRef:'public-receipt'}});
 const missing={...run};delete missing.occurrenceId;invalid(scheduling,missing);
});
test('service actions preserve stop intent and require version comparison',()=>{
 valid(lifecycle,action());invalid(lifecycle,{...action(),desiredState:'stopped'});
 for(const name of ['stop','unregister']){invalid(lifecycle,{...action(),action:name});valid(lifecycle,{...action(),action:name,desiredState:'stopped'});}
 invalid(lifecycle,{...action(),expectedRevision:-1});invalid(lifecycle,{...action(),command:'kill'});
});
test('completed service receipt requires ownership and a projection digest',()=>{
 const receipt={schemaVersion:1,kind:'landi_mah_service_receipt',requestId:'request',requestSha256:hash,transitionId:'transition',revision:1,status:'unknown',beforeState:'stopped',desiredState:'running',ownership:'unknown',projectionSha256:null,observedAt:at};
 valid(lifecycle,receipt);invalid(lifecycle,{...receipt,status:'completed'});
 valid(lifecycle,{...receipt,status:'completed',ownership:'verified',projectionSha256:hash});
 invalid(lifecycle,{...receipt,status:'completed',ownership:'conflict',projectionSha256:hash});
});
test('existing service projection still rejects ready without verified instance',()=>{
 const p={schemaVersion:1,kind:'landi_mah_background_runtime_projection',serviceId:'landi',project:{projectRoot:'/fictional',componentId:'c-assissant',launcherContractVersion:1},desiredState:'stopped',observedState:'stopped',supervisor:{owner:'mah_scheduler',registrationId:'reg',reconcileGeneration:0,restartPolicy:'never',restartCount:0},instance:null,readiness:{ownership:false,server:false,homepage:false,workspaceApi:false},persistence:{desiredStatePersisted:true,recoveredAfterMahRestart:false,recoveredAfterHostRestart:false},observedAt:at};
 valid(projection,p);invalid(projection,{...p,desiredState:'running',observedState:'ready'});
});
test('documentation states future contract and current non-execution boundaries',()=>{
 const doc=readFileSync(new URL('../docs/mah-background-runtime.md',import.meta.url),'utf8');
 assert.ok(doc.includes('MAH 管理定时、AI 执行和持续运行监督'));assert.ok(doc.includes('不停用现有定时器'));
 assert.ok(!doc.includes('Landi Scheduler 继续拥有提醒与执行计划'));
 for(const file of ['landi-mah-scheduling-v1.md','landi-mah-service-lifecycle-v1.md']){
  assert.ok(doc.includes(file));assert.ok(readFileSync(new URL(`../docs/contracts/${file}`,import.meta.url),'utf8').includes('待公开接口对接'));
 }
});
