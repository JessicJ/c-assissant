import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptMahBusinessCandidate, createMahBusinessPublicRead, MahBusinessPublicResultReader, MAH_BUSINESS_RESULT_SUBPATH, type MahPublicRead } from './mah-business-public-result.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import { businessContracts, type MahBusinessRequest } from './mah-business-contract.js';
import { productionReadiness } from './production-readiness.js';
const ROOT='/fiction/landi', ID='22222222-2222-4222-8222-222222222222';
const contracts=businessContracts('planning_conversation'), input={message:'Fictional trip'};
const request:MahBusinessRequest={schemaVersion:1,kind:'landi_business_request',requestId:'11111111-1111-4111-8111-111111111111',operation:'planning_conversation',scope:{kind:'conversation',sessionId:'fiction',requirementsVersion:1},businessTime:'2026-10-26T00:00:00Z',input:{contract:contracts.input,sha256:sha256(canonicalJson(input)),payload:input},output:{contract:contracts.output},execution:{selectionOwner:'mah',preferredLanguage:'en',capabilities:['structured_output'],maxRuntimeSeconds:120,authority:'artifact_only'}};
const artifact=JSON.stringify({schemaVersion:1,kind:'landi_business_result',requestId:request.requestId,operation:request.operation,scope:request.scope,businessTime:request.businessTime,inputSha256:request.input.sha256,outcome:'succeeded',contract:contracts.output,payload:{reply:'A fictional response — 旅行'}});
function fixture() {
  const show={ok:true,task:{task_id:ID,root_dir:ROOT,status:'completed',task_lifecycle_revision:2}};
  const replies:unknown[]=[show,[{subpath:MAH_BUSINESS_RESULT_SUBPATH,size:Buffer.byteLength(artifact),path:'/must/not/be/opened/private.json'}],{content:artifact},structuredClone(show)];
  const calls:string[][]=[];
  let override:((index:number,args:string[])=>{code:number;stdout:string}|undefined)|undefined;
  const run:MahPublicRead=async args=>{const i=calls.length;calls.push([...args]);return override?.(i,args)??{code:0,stdout:JSON.stringify(replies[i])};};
  return {replies,calls,reader:new MahBusinessPublicResultReader(ROOT,run),override:(fn:NonNullable<typeof override>)=>{override=fn;}};
}
test('completed public readback binds task/root/revision and UTF-8 bytes; candidate stays unverified',async()=>{
  const f=fixture(),candidate=await f.reader.readCandidate(ID);
  assert.equal(candidate.verified,false);assert.equal(candidate.raw,artifact);assert.equal(candidate.artifactSha256,sha256(artifact));
  assert.deepEqual(f.calls,[['task','show',ID,'--cwd',ROOT,'--format','json'],['task','context',ID,'--cwd',ROOT,'--format','json'],['task','context',ID,'--cwd',ROOT,'--read',MAH_BUSINESS_RESULT_SUBPATH,'--format','json'],['task','show',ID,'--cwd',ROOT,'--format','json']]);
});
for(const [name,mutate] of [
  ['task UUID mismatch',(x:any)=>{x.task.task_id='33333333-3333-4333-8333-333333333333';}],
  ['failed task',(x:any)=>{x.task.status='failed';}],
  ['running task',(x:any)=>{x.task.status='running';}],
  ['missing root',(x:any)=>{delete x.task.root_dir;}],
  ['wrong root',(x:any)=>{x.task.root_dir='/other';}],
  ['contradictory root',(x:any)=>{x.project_root='/other';}],
  ['missing lifecycle revision',(x:any)=>{delete x.task.task_lifecycle_revision;}],
  ['false ok',(x:any)=>{x.ok=false;}]
] as const)test(name,async()=>{
  const f=fixture();mutate(f.replies[0]);await assert.rejects(f.reader.readCandidate(ID));assert.equal(f.calls.length,1);
});
for(const [name,value] of [
  ['empty artifact list',[]],['duplicate fixed path',[{subpath:MAH_BUSINESS_RESULT_SUBPATH,size:1},{subpath:MAH_BUSINESS_RESULT_SUBPATH,size:1}]],
  ['numeric string size',[{subpath:MAH_BUSINESS_RESULT_SUBPATH,size:'1'}]],['boolean size',[{subpath:MAH_BUSINESS_RESULT_SUBPATH,size:true}]],
  ['oversized artifact',[{subpath:MAH_BUSINESS_RESULT_SUBPATH,size:16777217}]],['wrong path',[{subpath:'../private',size:1}]],
] as const)test(name,async()=>{
  const f=fixture();f.replies[1]=value;await assert.rejects(f.reader.readCandidate(ID));assert.equal(f.calls.length,2);
});
test('size uses bytes, not characters',async()=>{
  const f=fixture();f.replies[1]=[{subpath:MAH_BUSINESS_RESULT_SUBPATH,size:artifact.length}];await assert.rejects(f.reader.readCandidate(ID),/size_mismatch/);
});
test('changed lifecycle revision after artifact read rejects',async()=>{
  const f=fixture();f.replies[3]={ok:true,task:{task_id:ID,root_dir:ROOT,status:'completed',task_lifecycle_revision:3}};
  await assert.rejects(f.reader.readCandidate(ID),/changed_during_read/);
});
test('cancellation racing artifact read rejects',async()=>{
  const f=fixture();f.replies[3]={ok:true,task:{task_id:ID,root_dir:ROOT,status:'cancelled',task_lifecycle_revision:3}};
  await assert.rejects(f.reader.readCandidate(ID),/not_completed/);
});
test('nonzero exit and malformed JSON reject without retry',async()=>{
  for(const response of [{code:1,stdout:'{}'},{code:0,stdout:'invalid JSON'}]) {
    const f=fixture();f.override(()=>response);await assert.rejects(f.reader.readCandidate(ID));assert.equal(f.calls.length,1);
  }
});
test('abort stops before read or acceptance',async()=>{
  const f=fixture(),abort=new AbortController();abort.abort();await assert.rejects(f.reader.readCandidate(ID,abort.signal),{name:'AbortError'});assert.equal(f.calls.length,0);
});
test('invalid task identifier and relative project reject',async()=>{
  const f=fixture();await assert.rejects(f.reader.readCandidate('../other'));assert.equal(f.calls.length,0);
  assert.throws(()=>new MahBusinessPublicResultReader('relative',async()=>({code:0,stdout:'{}'})));
});
test('read adapter refuses submit, arbitrary artifact and mismatched project before spawning',async()=>{
  const run=createMahBusinessPublicRead(ROOT,{LANDI_MAH_CLI_COMMAND:'/fiction/never-executed'});
  for(const args of [['task','submit',ID,'--cwd',ROOT,'--format','json'],['task','context',ID,'--cwd',ROOT,'--read','artifacts/other.json','--format','json'],['task','show',ID,'--cwd','/other','--format','json']])await assert.rejects(run(args),/command_rejected/);
});
test('candidate alone cannot become accepted result; separate receipt and domain validation required',async()=>{
  const candidate=await fixture().reader.readCandidate(ID);let calls=0;
  assert.throws(()=>acceptMahBusinessCandidate(candidate,request,undefined,()=>{calls++;return '';}),/receipt_unverified/);assert.equal(calls,0);
  const receipt={requestSha256:sha256(canonicalJson(request)),artifactSha256:sha256(artifact),taskId:ID,agentId:'fictional-mah-agent',modelId:'fictional-mah-model',startedAt:request.businessTime,completedAt:request.businessTime};
  assert.equal(acceptMahBusinessCandidate(candidate,request,receipt,p=>p.reply),'A fictional response — 旅行');
  assert.throws(()=>acceptMahBusinessCandidate(candidate,request,{...receipt,taskId:'33333333-3333-4333-8333-333333333333'},()=>''),/receipt_unverified/);
  assert.throws(()=>acceptMahBusinessCandidate({...candidate,raw:'changed'},request,receipt,()=>''),/receipt_unverified/);
  assert.throws(()=>acceptMahBusinessCandidate(candidate,request,receipt,()=>{throw new Error('domain rejected');}),/domain rejected/);
});
test('production remains closed',()=>{
  for(const k of ['generation','conversation','revision','hosting','unattendedEmail'] as const)assert.equal(productionReadiness()[k],false);
});
