import assert from 'node:assert/strict';
import test from 'node:test';
import { createMahBusinessPublicReceiptVerifier } from './mah-business-public-receipt.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import { businessContracts, type MahBusinessRequest } from './mah-business-contract.js';
import type { MahPublicRead } from './mah-business-public-result.js';

const ROOT='/fictional/landi', ID='22222222-2222-4222-8222-222222222222', NOW='2026-10-26T00:00:00Z';
function fixture() {
  const payload={message:'Fictional only'};
  const request:MahBusinessRequest={schemaVersion:1,kind:'landi_business_request',requestId:'11111111-1111-4111-8111-111111111111',operation:'planning_conversation',scope:{kind:'conversation',sessionId:'fictional',requirementsVersion:1},businessTime:NOW,
    input:{contract:businessContracts('planning_conversation').input,payload,sha256:sha256(canonicalJson(payload))},output:{contract:businessContracts('planning_conversation').output},
    execution:{selectionOwner:'mah',preferredLanguage:'en',capabilities:['structured_output'],maxRuntimeSeconds:60,authority:'artifact_only'}};
  const raw=JSON.stringify({fictionalResult:true}), digest=sha256(canonicalJson(request));
  const task={task_id:ID,root_dir:ROOT,status:'completed',task_lifecycle_revision:6,agent:'codex',direct_runtime_model_id:'fictional-model',model_routing:{selected:{agent_id:'codex'}},
    attachments:[{sha256:digest,size:Buffer.byteLength(canonicalJson(request)),read_state:'present',path:'/must/not/open'}],created_at:NOW,updated_at:NOW,
    observability:{lifecycle:{running_at:NOW,completed_at:NOW,last_status:'completed'}}};
  let shows=0;const commands:string[][]=[];
  const read:MahPublicRead=async args=>{commands.push(args);let value:unknown;
    if(args[1]==='show'){shows++;value={ok:true,task};}
    else if(args.includes('--read'))value={content:raw};
    else value=[{subpath:'artifacts/landi-business-result.json',size:Buffer.byteLength(raw)}];
    return {code:0,stdout:JSON.stringify(value)};
  };
  const candidate={taskId:ID,projectRoot:ROOT,raw,artifactSha256:sha256(raw),lifecycleRevision:6,verified:false as const};
  return {request,task,candidate,read,commands,get shows(){return shows;}};
}
test('public attachment, fresh artifact and actual MAH route produce a correlated receipt',async()=>{
  const f=fixture();const receipt=await createMahBusinessPublicReceiptVerifier(ROOT,f.read)(f.request,f.candidate);
  assert.equal(receipt.requestSha256,sha256(canonicalJson(f.request)));assert.equal(receipt.taskId,ID);
  assert.equal(receipt.agentId,'codex');assert.equal(receipt.modelId,'fictional-model');assert.equal(f.shows,3);
  assert.ok(f.commands.every(a=>a[0]==='task'&&['show','context'].includes(a[1]!)&&a[2]===ID));
});
for(const [name,mutate] of [
  ['missing attachment',(t:any)=>{t.attachments=[];}],
  ['wrong attachment digest',(t:any)=>{t.attachments[0].sha256='0'.repeat(64);}],
  ['wrong attachment size',(t:any)=>{t.attachments[0].size++;}],
  ['duplicate attachment',(t:any)=>{t.attachments.push({...t.attachments[0]});}],
  ['attachment absent',(t:any)=>{t.attachments[0].read_state='missing';}],
  ['missing actual Agent',(t:any)=>{delete t.agent;}],
  ['missing actual model',(t:any)=>{delete t.direct_runtime_model_id;}],
  ['route disagreement',(t:any)=>{t.model_routing.selected.agent_id='other';}],
  ['not completed',(t:any)=>{t.status='running';}],
  ['missing completion time',(t:any)=>{delete t.observability.lifecycle.completed_at;}],
  ['reversed execution time',(t:any)=>{t.observability.lifecycle.running_at='2026-10-27T00:00:00Z';}],
  ['different project',(t:any)=>{t.root_dir='/other';}],
] as const)test(`rejects ${name}`,async()=>{
  const f=fixture();mutate(f.task);await assert.rejects(createMahBusinessPublicReceiptVerifier(ROOT,f.read)(f.request,f.candidate),/mah_business_/);
});
test('forged candidate with a self-consistent digest still disagrees with public artifact',async()=>{
  const f=fixture(),raw='{"forged":true}';
  await assert.rejects(createMahBusinessPublicReceiptVerifier(ROOT,f.read)(f.request,{...f.candidate,raw,artifactSha256:sha256(raw)}),/receipt_unverified/);
});
test('lifecycle change after artifact read rejects otherwise valid public metadata',async()=>{
  const f=fixture();const read:MahPublicRead=async(a,s)=>{
    const response=await f.read(a,s);
    if(f.shows===3&&a[1]==='show'){const v=JSON.parse(response.stdout);v.task.task_lifecycle_revision++;return {...response,stdout:JSON.stringify(v)};}
    return response;
  };
  await assert.rejects(createMahBusinessPublicReceiptVerifier(ROOT,read)(f.request,f.candidate),/receipt_unverified/);
});
