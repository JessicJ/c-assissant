import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { MahCliBusinessGateway, MahBusinessTaskReadbackError, type BusinessSubmission, type MahBusinessSubmissionJournal } from './mah-business-gateway.js';
import { MahBusinessRuntimeAdapter, type MahBusinessWorkContext } from './mah-business-runtime.js';
import type { MahBusinessRequest } from './mah-business-contract.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import type { MahPublicRead } from './mah-business-public-result.js';

const ROOT='/fiction/landi',ID='22222222-2222-4222-8222-222222222222',NOW='2026-10-26T00:00:00Z';
const input={message:'Fictional dates',session:{status:'collecting',messages:[],facts:[],unresolved:[],proposal:null},profile:{displayName:'Fictional traveler',preferredLanguage:'en',nationality:'fictional',gender:'unspecified',immigrationStatus:'visitor',assistantPersonality:'local_insider'}} as any;
const context:MahBusinessWorkContext={requestId:'11111111-1111-4111-8111-111111111111',operation:'planning_conversation',businessTime:NOW,scope:{kind:'conversation',sessionId:'fiction',requirementsVersion:1}};
function fixture() {
  let mapping:BusinessSubmission|undefined,request:MahBusinessRequest|undefined;
  const commands:string[][]=[],states:string[]=[];let submits=0,receiptCalls=0,claims=0;
  const journal:MahBusinessSubmissionJournal={reserve:async(r,root)=>{
    request=structuredClone(r);mapping??={taskId:ID,requestSha256:sha256(canonicalJson(r)),projectRoot:root,state:'prepared'};
    return {...mapping};
  },claimSubmission:async()=>{claims++;if(mapping?.state!=='prepared')return false;mapping.state='submission_unknown';states.push('submission_unknown');return true;},
  mark:async(_id,state)=>{mapping!.state=state;states.push(state);}};
  const raw=()=>JSON.stringify({schemaVersion:1,kind:'landi_business_result',requestId:request!.requestId,operation:request!.operation,scope:request!.scope,businessTime:request!.businessTime,inputSha256:request!.input.sha256,outcome:'succeeded',contract:request!.output.contract,payload:{reply:'Which dates work?',facts:[],clarification:null}});
  const show=()=>({ok:true,task:{task_id:ID,root_dir:ROOT,status:'completed',task_lifecycle_revision:1}});
  const run:MahPublicRead=async args=>{
    commands.push([...args]);let value:unknown;
    if(args[1]==='submit'){
      submits++;assert.equal(mapping?.state,'submission_unknown');assert.ok(args.includes('--no-write'));assert.ok(!args.includes('--write'));
      assert.ok(!args.includes('--personal-os-slot'));
      const attachment=JSON.parse(await readFile(args[args.indexOf('--attach')+1]!,'utf8'));assert.deepEqual(attachment,request);
      value={ok:true,task_id:ID,project_root:ROOT,admission_status:'queued',personal_os_slot:{slot_class:'interactive',workload_ref:`task:${ID}`}};
    }else if(args[1]==='show')value=show();
    else if(args.includes('--read'))value={content:raw()};
    else value=[{subpath:'artifacts/landi-business-result.json',size:Buffer.byteLength(raw())}];
    return {code:0,stdout:JSON.stringify(value)};
  };
  const options={projectRoot:ROOT,journal,run,assertContract:async(_r:MahBusinessRequest)=>{},verifyReceipt:async(r:MahBusinessRequest,c:any)=>{
    receiptCalls++;return {requestSha256:sha256(canonicalJson(r)),artifactSha256:c.artifactSha256,taskId:ID,agentId:'fictional-mah-selected',modelId:'fictional-model',startedAt:NOW,completedAt:NOW};
  }};
  return {options,commands,states,get submits(){return submits;},get receiptCalls(){return receiptCalls;},get claims(){return claims;},get mapping(){return mapping;},
    adapter:()=>new MahBusinessRuntimeAdapter(new MahCliBusinessGateway(options))};
}
test('full conversation: frozen request -> journal -> public submit/show/context -> receipt -> domain parser',async()=>{
  const f=fixture();const adapter=f.adapter();const result=await adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input));
  assert.equal(result.reply,'Which dates work?');assert.equal(f.submits,1);assert.equal(f.receiptCalls,1);
  assert.deepEqual(f.states,['submission_unknown','submitted','result_read']);
  assert.ok(f.commands.every(a=>!a.includes('resume')&&!a.includes('cancel')&&!a.includes('--agent')));
});
test('invalid ordinary read-only preview blocks before journal reservation',async()=>{
  const f=fixture();const {assertContract,...options}=f.options;
  const adapter=new MahBusinessRuntimeAdapter(new MahCliBusinessGateway(options));
  await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)));
  assert.equal(f.mapping,undefined);
});
test('ambiguous submit retains ID; explicit continuation reads same Task without resubmit',async()=>{
  const f=fixture();const real=f.options.run;let dropped=false;
  f.options.run=async(a,s)=>{const v=await real(a,s);if(a[1]==='submit'&&!dropped){dropped=true;throw new Error('lost receipt');}return v;};
  const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/lost receipt/);
  assert.equal(f.mapping!.state,'submission_unknown');
  const out=await adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input));assert.equal(out.reply,'Which dates work?');assert.equal(f.submits,1);
});
for(const [name,change] of [
 ['wrong task',(v:any)=>{v.task_id='33333333-3333-4333-8333-333333333333';}],
 ['wrong project',(v:any)=>{v.project_root='/other';}],
 ['wrong slot',(v:any)=>{v.personal_os_slot.slot_class='background';}],
 ['missing explicit ok',(v:any)=>{delete v.ok;}],
 ['wrong workload',(v:any)=>{v.personal_os_slot.workload_ref='other';}],
] as const)test(`submit ${name} remains unknown without retry`,async()=>{
  const f=fixture();const real=f.options.run;f.options.run=async(a,s)=>{const v=await real(a,s);if(a[1]==='submit'){const body=JSON.parse(v.stdout);change(body);return {code:0,stdout:JSON.stringify(body)};}return v;};
  const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/submission_unknown/);
  assert.equal(f.mapping!.state,'submission_unknown');assert.equal(f.submits,1);assert.equal(f.commands.length,1);
});
test('atomic journal claim prevents losing caller from submitting again',async()=>{
  const f=fixture();f.options.journal.claimSubmission=async()=>false;
  const adapter=f.adapter();assert.equal((await adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input))).reply,'Which dates work?');assert.equal(f.submits,0);
});
test('journal identity mismatch prevents all CLI activity',async()=>{
  const f=fixture();const real=f.options.journal.reserve;f.options.journal.reserve=async(r,p)=>({...await real(r,p),requestSha256:'0'.repeat(64)});
  const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/identity_mismatch/);assert.equal(f.commands.length,0);
});
test('failed task never reads artifact or manufactures receipt',async()=>{
  const f=fixture();const real=f.options.run;f.options.run=async(a,s)=>a[1]==='show'?{code:0,stdout:JSON.stringify({ok:true,task:{task_id:ID,root_dir:ROOT,status:'failed'}})}:real(a,s);
  const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/not_successful/);assert.equal(f.receiptCalls,0);
});
test('missing authenticated receipt blocks result-read marking',async()=>{
  const f=fixture();f.options.verifyReceipt=async()=>{throw new Error('route_receipt_unverified');};
  const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/route_receipt_unverified/);assert.equal(f.mapping!.state,'submitted');
});
test('receipt for different request is rejected',async()=>{
  const f=fixture();const verify=f.options.verifyReceipt;f.options.verifyReceipt=async(r,c)=>({...await verify(r,c),requestSha256:'0'.repeat(64)});
  const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/receipt_unverified/);assert.equal(f.mapping!.state,'submitted');
});
test('reading result never claims validation or applies a plan',async()=>{
  const f=fixture();const adapter=f.adapter();await adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input));
  assert.equal(f.mapping!.state,'result_read');assert.ok(!f.states.includes('validated')&&!f.states.includes('imported'));
});
test('current public submit receipt waits for project-bound materialization before reading result',async()=>{
  const f=fixture();const real=f.options.run;let shows=0;
  f.options.run=async(a,s)=>{
    const response=await real(a,s);
    if(a[1]==='submit')return {code:0,stdout:JSON.stringify({task_id:ID,title:'Fictional current receipt',admission_status:'ready',personal_os_slot:{slot_class:'interactive',workload_ref:`task:${ID}`},result_ref:{type:'none'},audit_ref:`.mah/tasks/${ID}/audit/audit.ndjson`,events_ref:`.mah/tasks/${ID}/stream.jsonl`})};
    if(a[1]==='show'&&++shows===1)return {code:0,stdout:JSON.stringify({ok:true,task:{task_id:ID,status:'running'},task_record_materialized:false,scheduled_task:{task_id:ID}})};
    return response;
  };
  const adapter=new MahBusinessRuntimeAdapter(new MahCliBusinessGateway({...f.options,pollMs:1}));
  assert.equal((await adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input))).reply,'Which dates work?');
  assert.equal(f.submits,1);assert.equal(f.receiptCalls,1);assert.equal(shows,4);
});
test('current public submit receipt rejects cross-task refs without any readback',async()=>{
  const f=fixture();const real=f.options.run;
  f.options.run=async(a,s)=>{await real(a,s);return {code:0,stdout:JSON.stringify({task_id:ID,title:'Fictional',admission_status:'ready',personal_os_slot:{slot_class:'interactive',workload_ref:`task:${ID}`},result_ref:{type:'none'},audit_ref:'.mah/tasks/other/audit/audit.ndjson',events_ref:`.mah/tasks/${ID}/stream.jsonl`})};};
  const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/submission_unknown/);
  assert.equal(f.commands.length,1);assert.equal(f.mapping!.state,'submission_unknown');
});

test('readback compatibility: project-bound active waits for running and completed before artifact access',async()=>{
  const f=fixture(),real=f.options.run;let polls=0;
  f.options.run=async(a,s)=>{
    if(a[1]==='show'&&++polls<=2)return {code:0,stdout:JSON.stringify({ok:true,task:{task_id:ID,root_dir:ROOT,status:polls===1?'active':'running',task_lifecycle_revision:polls}})};
    if(a[1]==='context')assert.ok(polls>=3);
    return real(a,s);
  };
  const adapter=new MahBusinessRuntimeAdapter(new MahCliBusinessGateway({...f.options,pollMs:1}));
  assert.equal((await adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input))).reply,'Which dates work?');
  assert.equal(f.submits,1);assert.equal(f.receiptCalls,1);
});
for(const status of ['failed','cancelled','yielded','waiting_for_user','follow_up','unknown_status'])test(`readback compatibility: ${status} remains blocked with bounded diagnostic`,async()=>{
  const f=fixture(),real=f.options.run;
  f.options.run=async(a,s)=>a[1]==='show'?{code:0,stdout:JSON.stringify({ok:true,task:{task_id:ID,root_dir:ROOT,status,task_lifecycle_revision:7,description:'private prompt must not escape'}})}:real(a,s);
  const adapter=f.adapter();
  await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),error=>{
    assert.ok(error instanceof MahBusinessTaskReadbackError);assert.equal(error.code,'mah_business_task_not_successful');
    assert.equal(error.observations.length,1);assert.equal(error.observations[0]!.status,status);
    assert.equal(error.observations[0]!.projectMatched,true);assert.equal(error.observations[0]!.revision,7);
    assert.ok(!JSON.stringify(error.observations).includes('private prompt'));return true;
  });
  assert.equal(f.receiptCalls,0);assert.ok(!f.commands.some(a=>a[1]==='context'));
});
test('readback compatibility: active cannot bypass project identity or scheduler materialization',async()=>{
  for(const task of [{task_id:ID,root_dir:'/other',status:'active'},{task_id:ID,status:'active'}]) {
    const f=fixture(),real=f.options.run;
    f.options.run=async(a,s)=>a[1]==='show'?{code:0,stdout:JSON.stringify({ok:true,task,task_record_materialized:false,scheduled_task:{task_id:ID}})}:real(a,s);
    const adapter=f.adapter();await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),/readback_invalid/);
    assert.equal(f.receiptCalls,0);
  }
});
test('readback compatibility: active timeout keeps only sixteen sanitized observations',async()=>{
  const f=fixture(),real=f.options.run;let count=0;
  f.options.run=async(a,s)=>{
    if(a[1]!=='show')return real(a,s);
    count++;if(count===22)await new Promise(resolve=>setTimeout(resolve,60));
    return {code:0,stdout:JSON.stringify({ok:true,task:{task_id:ID,root_dir:ROOT,status:'active',task_lifecycle_revision:count}})};
  };
  const adapter=new MahBusinessRuntimeAdapter(new MahCliBusinessGateway({...f.options,waitMs:60,pollMs:1}));
  await assert.rejects(adapter.runWithWorkContext(context,()=>adapter.continuePlanningConversation(input)),error=>{
    assert.ok(error instanceof MahBusinessTaskReadbackError);assert.equal(error.code,'mah_business_task_wait_expired');
    assert.ok(error.observations.length<=16);assert.equal(error.observations.at(-1)!.status,'active');return true;
  });
  assert.equal(f.receiptCalls,0);
});

test('ordinary public preview permits one submit with no slot and preserves result checks', async () => {
  const f = fixture();
  const { assertContract, ...options } = f.options;
  const run = options.run;
  let previews = 0;
  options.run = async (args, signal) => {
    if (args.includes('--preview')) {
      previews++;
      return { code: 0, stdout: JSON.stringify({ ok: true, project_root: ROOT, mode: 'read_only',
        will_not_execute: ['write', 'commit', 'push'] }) };
    }
    return run(args, signal);
  };
  const adapter = new MahBusinessRuntimeAdapter(new MahCliBusinessGateway(options));
  const result = await adapter.runWithWorkContext(context, () => adapter.continuePlanningConversation(input));
  assert.equal(result.reply, 'Which dates work?');
  assert.equal(previews, 1);
  assert.equal(f.submits, 1);
  assert.equal(f.receiptCalls, 1);
});

test('current ordinary queue receipt needs no obsolete admission or slot fields', async () => {
  const f = fixture(), run = f.options.run;
  f.options.run = async (args, signal) => {
    const response = await run(args, signal);
    return args[1] === 'submit' ? { code: 0, stdout: JSON.stringify({ ok: true, task_id: ID,
      project_root: ROOT, title: 'Fictional ordinary queue receipt', result_ref: { type: 'none' },
      audit_ref: `.mah/tasks/${ID}/audit/audit.ndjson`, events_ref: `.mah/tasks/${ID}/stream.jsonl` }) } : response;
  };
  const adapter = f.adapter();
  assert.equal((await adapter.runWithWorkContext(context, () => adapter.continuePlanningConversation(input))).reply, 'Which dates work?');
  assert.equal(f.submits, 1);
});
