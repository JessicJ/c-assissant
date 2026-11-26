import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MahBusinessRuntimeAdapter, type MahBusinessGateway, type MahBusinessWorkContext } from './mah-business-runtime.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import { businessContracts, type MahBusinessRequest } from './mah-business-contract.js';
import { productionReadiness } from './production-readiness.js';
import type { PlanningConversationRequest, EmailResearchRequest, EmailTimingRequest } from '@c-assistant/agent-adapters';

const time='2026-10-26T00:00:00Z';
const conversation={message:'A fictional three-day trip',session:{status:'collecting',messages:[],facts:[],unresolved:[],proposal:null},
  profile:{displayName:'Fictional traveler',preferredLanguage:'en',nationality:'fictional',gender:'unspecified',immigrationStatus:'visitor',assistantPersonality:'local_insider'}} as unknown as PlanningConversationRequest;
const research: EmailResearchRequest={kind:'morning',date:'2026-10-26',city:'Fictional City',places:[],constraints:[],language:'en',now:time};
const timing: EmailTimingRequest={now:time,opportunities:[{id:'fictional-opportunity',kind:'morning',date:'2026-10-26',timeZone:'Etc/UTC',title:'Fictional visit',plannedTime:'09:00',timeKind:'planned',earliestLocal:'2026-10-26T07:00',deadlineLocal:'2026-10-26T09:00'}]};
const payloads={planning_conversation:{reply:'Which dates work for you?',facts:[],clarification:null},email_research:{introduction:'',notes:[],sources:[]},email_timing:{decisions:[{id:'fictional-opportunity',sendAtLocal:'2026-10-26T08:00',rationale:'Before the planned visit.'}]}};
function context(operation: MahBusinessWorkContext['operation']): MahBusinessWorkContext {
  return {requestId:'11111111-1111-4111-8111-111111111111',operation,businessTime:time,
    scope:operation==='planning_conversation'?{kind:'conversation',sessionId:'fictional-session',requirementsVersion:1}:
      {kind:'email',planId:'fictional-plan',planVersion:1,businessDate:'2026-10-26',recipientConfigRevision:0}};
}
function result(request: MahBusinessRequest,payload: Record<string,unknown>) {
  const raw=JSON.stringify({schemaVersion:1,kind:'landi_business_result',requestId:request.requestId,operation:request.operation,scope:request.scope,businessTime:request.businessTime,inputSha256:request.input.sha256,outcome:'succeeded',contract:businessContracts(request.operation).output,payload});
  return {raw,receipt:{requestSha256:sha256(canonicalJson(request)),artifactSha256:sha256(raw),taskId:'22222222-2222-4222-8222-222222222222',agentId:'fictional-mah-selected-agent',modelId:'fictional-mah-selected-model',startedAt:time,completedAt:time}};
}
function fixture() {
  const requests:MahBusinessRequest[]=[];const admission:MahBusinessRequest[]=[];
  const gateway:MahBusinessGateway={assertPublicContract:async r=>{admission.push(r);},execute:async r=>{
    requests.push(structuredClone(r));return result(r,payloads[r.operation as keyof typeof payloads]);
  }};
  return {gateway,requests,admission,adapter:new MahBusinessRuntimeAdapter(gateway)};
}
for (const operation of ['planning_conversation','email_research','email_timing'] as const) {
  test(`${operation}: MAH request -> authenticated envelope -> existing domain parser`,async()=>{
    const f=fixture();const c=context(operation);
    const output=await f.adapter.runWithWorkContext<unknown>(c,()=>operation==='planning_conversation'?f.adapter.continuePlanningConversation(conversation):operation==='email_research'?f.adapter.generateEmailResearch(research):f.adapter.generateEmailTiming(timing));
    assert.ok(output);assert.equal(f.requests.length,1);assert.equal(f.admission.length,1);
    const r=f.requests[0]!;assert.deepEqual(r.scope,c.scope);assert.equal(r.requestId,c.requestId);
    assert.equal(r.execution.selectionOwner,'mah');assert.equal(r.execution.authority,'artifact_only');
    assert.ok(!('agentPreference' in r.execution));assert.ok(!('modelId' in r.execution));
    assert.equal(r.input.sha256,sha256(canonicalJson(r.input.payload)));
    assert.ok(r.input.payload.prompt);assert.ok(r.input.payload.outputSchema);
    assert.equal(r.execution.capabilities.includes('external_current_research'),operation==='email_research');
  });
}
test('missing/frozen work context rejects before gateway',async()=>{
  const f=fixture();await assert.rejects(f.adapter.continuePlanningConversation(conversation),/context_mismatch/);
  await assert.rejects(f.adapter.runWithWorkContext(context('email_timing'),()=>f.adapter.continuePlanningConversation(conversation)),/context_mismatch/);
  assert.equal(f.requests.length,0);
});
test('default runtime remains blocked without local Agent fallback',async()=>{
  const adapter=new MahBusinessRuntimeAdapter();await assert.rejects(adapter.runWithWorkContext(context('planning_conversation'),()=>adapter.continuePlanningConversation(conversation)),/MAH integration is not ready/);
});
test('public contract failure prevents execution',async()=>{
  const f=fixture();f.gateway.assertPublicContract=async()=>{throw new Error('public_contract_unverified');};
  await assert.rejects(f.adapter.runWithWorkContext(context('planning_conversation'),()=>f.adapter.continuePlanningConversation(conversation)),/public_contract_unverified/);
  assert.equal(f.requests.length,0);
});
test('receipt is required and is never sourced from Agent payload',async()=>{
  const f=fixture();f.gateway.execute=async r=>({...result(r,payloads.planning_conversation),receipt:undefined as never});
  await assert.rejects(f.adapter.runWithWorkContext(context('planning_conversation'),()=>f.adapter.continuePlanningConversation(conversation)),/receipt_unverified/);
});
test('stale session result rejected before import',async()=>{
  const f=fixture();f.gateway.execute=async r=>result({...r,scope:{kind:'conversation',sessionId:'different',requirementsVersion:99}},payloads.planning_conversation);
  await assert.rejects(f.adapter.runWithWorkContext(context('planning_conversation'),()=>f.adapter.continuePlanningConversation(conversation)),/identity_mismatch/);
});
test('existing planning parser rejects blank reply',async()=>{
  const f=fixture();f.gateway.execute=async r=>result(r,{reply:' ',facts:[]});
  await assert.rejects(f.adapter.runWithWorkContext(context('planning_conversation'),()=>f.adapter.continuePlanningConversation(conversation)),/empty response/);
});
test('existing timing parser rejects unknown opportunity',async()=>{
  const f=fixture();f.gateway.execute=async r=>result(r,{decisions:[{id:'other',sendAtLocal:null,rationale:'Unknown'}]});
  await assert.rejects(f.adapter.runWithWorkContext(context('email_timing'),()=>f.adapter.generateEmailTiming(timing)),/Invalid email timing/);
});
test('research date and business time must match frozen email scope',async()=>{
  const f=fixture();await assert.rejects(f.adapter.runWithWorkContext(context('email_research'),()=>f.adapter.generateEmailResearch({...research,date:'2026-10-27'})),/context_mismatch/);
  await assert.rejects(f.adapter.runWithWorkContext(context('email_timing'),()=>f.adapter.generateEmailTiming({...timing,now:'2026-10-27T00:00:00Z'})),/context_mismatch/);
  assert.equal(f.requests.length,0);
});
test('unknown credential fields rejected before prompt generation',async()=>{
  const f=fixture();await assert.rejects(f.adapter.runWithWorkContext(context('email_research'),()=>f.adapter.generateEmailResearch({...research,smtpPassword:'fictional-only'} as EmailResearchRequest)),/fields_invalid/);
  assert.equal(f.requests.length,0);
});
test('abort signal stays outside serialized request and abort blocks late result',async()=>{
  const f=fixture();const controller=new AbortController();f.gateway.execute=async(r,signal)=>{
    assert.equal(signal,controller.signal);assert.ok(!('signal' in (r.input.payload.data as object)));
    controller.abort();return result(r,payloads.email_timing);
  };
  await assert.rejects(f.adapter.runWithWorkContext(context('email_timing'),()=>f.adapter.generateEmailTiming({...timing,signal:controller.signal})),{name:'AbortError'});
});
test('ambiguous failure is propagated once without retry or new identity',async()=>{
  const f=fixture();let calls=0;f.gateway.execute=async()=>{calls++;throw new Error('submission_unknown');};
  await assert.rejects(f.adapter.runWithWorkContext(context('planning_conversation'),()=>f.adapter.continuePlanningConversation(conversation)),/submission_unknown/);
  assert.equal(calls,1);
});
test('gateway mutation cannot change frozen request or domain context',async()=>{
  const f=fixture();f.gateway.assertPublicContract=async r=>{r.scope={kind:'conversation',sessionId:'tampered',requirementsVersion:99};};
  await f.adapter.runWithWorkContext(context('planning_conversation'),()=>f.adapter.continuePlanningConversation(conversation));
  assert.deepEqual(f.requests[0]!.scope,context('planning_conversation').scope);
});
test('parallel sessions retain distinct business identities',async()=>{
  const f=fixture();const a=context('planning_conversation'),b=context('planning_conversation');
  b.requestId='33333333-3333-4333-8333-333333333333';b.scope={kind:'conversation',sessionId:'second',requirementsVersion:2};
  await Promise.all([a,b].map(c=>f.adapter.runWithWorkContext(c,()=>f.adapter.continuePlanningConversation(conversation))));
  assert.deepEqual(new Set(f.requests.map(r=>r.requestId)),new Set([a.requestId,b.requestId]));
});
test('active production wiring, UI and gates remain unchanged',()=>{
  const gates=productionReadiness();assert.ok(['conversation','generation','revision','hosting','unattendedEmail'].every(k=>gates[k as keyof typeof gates]===false));
  const runtime=readFileSync(new URL('./runtime-services.ts',import.meta.url),'utf8');assert.ok(!runtime.includes('mah-business-runtime'));
});
