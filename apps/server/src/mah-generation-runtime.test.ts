import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { SqliteWorkspaceStore } from '@c-assistant/storage';
import { LANDI_BLUEPRINT_SKILL, buildSkillImageEnrichmentPrompt, codexStrictOutputSchema, skillImageEnrichmentSchema } from '@c-assistant/agent-adapters';
import { MahCliTransport, MAH_SUPERVISION_STOP_REASON, type MahCommandRunner } from './mah-cli-transport.js';
import { canonicalJson, sha256, assertMahStageRequest, assertPersistedMahMapping, parseAndValidateMahStageResult,
  MAH_QUEUE_PROTOCOL, MAH_QUEUE_STAGE_RESULT_CONTRACT, MAH_STAGE_RESULT_SUBPATH,
  type MahStageRequest, type MahCarrierMapping, type MahGenerationMappings } from './mah-generation-contract.js';
import { MahBlueprintRuntimeAdapter, buildMahImageOnlyPrompt, mahStageBatchId } from './mah-blueprint-runtime.js';
import { queueRunner, json } from './mah-queue.fixture.test.js';
const ROOT='/tmp/landi-mah-contract-test';
const ENV={LANDI_MAH_CLI_COMMAND:'/受控/mah',LANDI_MAH_CLI_EXECUTABLE:'/受控/node',LANDI_MAH_CLI_MAIN:'/受控/index.js'};
async function fixture(adaptive = false, maxRuntimeSeconds = 60) {
  const directory=await mkdtemp(join(tmpdir(),'landi-queue-test-')),path=join(directory,'workspace.sqlite');
  const storage=new SqliteWorkspaceStore(path),mappings=storage.generationCarriers as MahGenerationMappings;
  const lineage=LANDI_BLUEPRINT_SKILL,generationKey=`受控会话:1:${lineage.skillId}@${lineage.skillVersion}`;
  const now=new Date().toISOString();
  storage.savePlanningSession({id:'受控会话',status:'proposal_confirmed',objectiveType:'travel',messages:[],facts:[],unresolved:[],deferred:[],
    proposal:{version:1,title:'虚构测试',objective:'测试',theme:'测试',segments:['测试市'],skeleton:['2026-11-10'],tradeoffs:[],assumptions:[],decisionPoints:[]},confirmedProposalVersion:1,createdAt:now,updatedAt:now});
  storage.saveBlueprintGeneration({generationKey,proposalRef:{sessionId:'受控会话',proposalVersion:1},skillLineage:lineage,status:'running',stage:'research',createdAt:now,updatedAt:now});
  const businessInput={prompt:'受控测试',outputSchema:{type:'object',required:['accepted'],properties:{accepted:{type:'boolean'}}},outputBusinessContract:'landi.skill-itinerary.v1'};
  const mapping=mappings.prepare({generationKey,operation:'itinerary_draft',inputSha256:sha256(canonicalJson(businessInput)),expectedSubpath:MAH_STAGE_RESULT_SUBPATH,
    projectRoot:ROOT,protocol:MAH_QUEUE_PROTOCOL,preparedStatus:'prepared',retryableTerminalStatuses:[],serializeRequest:canonicalJson,hashRequest:sha256,
    createRequest:({carrierTaskId,requestId,attempt})=>({schemaVersion:3,protocol:MAH_QUEUE_PROTOCOL,projectRoot:ROOT,kind:'landi_generation_stage_request',
      requestId,carrierTaskId,generationKey,proposalRef:{sessionId:'受控会话',proposalVersion:1},skillLineage:lineage,operation:'itinerary_draft',attempt,parentCheckpoint:storage.getGenerationCarrierCheckpoint(generationKey),
      input:{businessContract:'landi.skill-itinerary-input.v1',sha256:sha256(canonicalJson(businessInput)),businessInput},
      output:{subpath:MAH_STAGE_RESULT_SUBPATH,envelopeContract:MAH_QUEUE_STAGE_RESULT_CONTRACT},
      execution:{preferredLanguage:'zh-CN',webSearch:false,maxRuntimeSeconds,capabilityRequirements:['structured_output'], ...(adaptive ? { adaptiveProducerClockV1: { validatorNodePath: '/test/Node A/bin/node' } } : {})},createdAt:now})}) as MahCarrierMapping;
  const mock=queueRunner();
  const transport=(run:MahCommandRunner=mock.run)=>new MahCliTransport({mahProjectRoot:ROOT,store:mappings,environment:ENV,run,schedulerWaitMs:25,cancelWaitMs:10,pollIntervalMs:1});
  return {storage,mappings,mapping,mock,transport,path,close:async()=>{try { storage.close(); } catch {} await rm(directory,{recursive:true,force:true});}};
}
test('普通队列只提交冻结附件一次，公开来源决定实际 Agent 与模型',async()=>{
  const f=await fixture();try {
    const result=await f.transport().execute(f.mapping);
    assert.equal(result.mapping.status,'validated');assert.equal(result.result.provenance.agentId,'claude-code');
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);
    assert.ok(f.mock.commands.every(a=>a[0]==='task'&&['submit','show','context'].includes(a[1]!)));
    const saved=f.mappings.getByTaskId(f.mapping.carrierTaskId)!;
    assert.equal(saved.requestJson,f.mock.rawRequests.get(saved.carrierTaskId));
    assert.equal(saved.resultSha256,sha256(f.mock.artifacts.get(saved.carrierTaskId)!));
    assert.ok(saved.submitReceiptJson);assert.equal(saved.slotClass,undefined);assert.ok(saved.runningAt);
  } finally {await f.close();}
});
test('随普通任务传递原始 Schema 和可独立验证完整工件的校验器', async () => {
  const f = await fixture();
  try {
    await f.transport(async (command, args, options) => {
      const response = await f.mock.run(command, args, options);
      if (args[1] !== 'submit') return response;
      const attachments = args.flatMap((arg, index) => arg === '--attach' ? [args[index + 1]!] : []);
      assert.equal(attachments.length, 3);
      const [requestPath, schemaPath, validatorPath] = attachments as [string, string, string];
      const schema = await readFile(schemaPath);
      const validator = await readFile(validatorPath);
      assert.deepEqual(schema, await readFile(new URL('../../../docs/contracts/landi-mah-stage-result.v2.schema.json', import.meta.url)));
      const description = await readFile(args[args.indexOf('--description-file') + 1]!, 'utf8');
      assert.ok(description.includes('独立验收者只读执行复核，证据由 MAH 原生工具事件留痕，不创建临时文件或报告。'));
      assert.ok(description.includes(sha256(schema.toString('utf8'))));
      assert.ok(description.includes(sha256(validator.toString('utf8'))));
      const artifact = JSON.parse(f.mock.artifacts.get(f.mapping.carrierTaskId)!);
      const artifactPath = join(f.path, '..', 'validation-candidate.json');
      const validate = async (candidate: unknown) => {
        const raw = JSON.stringify(candidate);
        await writeFile(artifactPath, raw, 'utf8');
        const output = execFileSync(process.execPath, ['--input-type=commonjs', '-', schemaPath, requestPath, artifactPath],
          { input: validator, encoding: 'utf8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] });
        assert.deepEqual(JSON.parse(output), { valid: true, schemaSha256: sha256(schema.toString('utf8')),
          requestSha256: f.mapping.requestSha256, artifactSha256: sha256(raw) });
      };
      await validate(artifact);
      const { kind, ...withoutKind } = artifact;
      assert.equal(kind, 'landi_generation_stage_result');
      await assert.rejects(validate(withoutKind), /required property 'kind'/);
      await assert.rejects(validate({ ...artifact, diagnostics: ['not a diagnostic object'] }), /diagnostics/);
      await assert.rejects(validate({ ...artifact, startedAt: artifact.provenance.startedAt }), /additional properties/);
      await assert.rejects(validate({ ...artifact, requestSha256: '0'.repeat(64) }), /Frozen request mismatch/);
      await assert.rejects(validate({ ...artifact, payload: { accepted: 'yes' } }), /payload:.*accepted/);
      return response;
    }).execute(f.mapping);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally {
    await f.close();
  }
});
test('两个主库连接竞争同一阶段，两个监督者总共只调用一次提交 CLI',async()=>{
  const f=await fixture();const second=new SqliteWorkspaceStore(f.path);
  try {
    const run:MahCommandRunner=async(command,args,options)=>{
      if(args[1]==='show'&&!f.mock.requests.has(args[2]!))return {code:1,stdout:'{"error":{"code":"task_not_found"}}',stderr:''};
      return f.mock.run(command,args,options);
    };
    const make=(store:MahGenerationMappings)=>new MahCliTransport({mahProjectRoot:ROOT,store,environment:ENV,run,schedulerWaitMs:1000,pollIntervalMs:1});
    const other=second.generationCarriers as MahGenerationMappings;
    const results=await Promise.all([make(f.mappings).execute(f.mapping),make(other).execute(other.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping)]);
    assert.ok(results.every(result=>result.mapping.carrierTaskId===f.mapping.carrierTaskId));
    assert.equal(f.mock.commands.filter(args=>args[1]==='submit').length,1);
    assert.ok(f.mock.commands.filter(args=>args[1]==='show'||args[1]==='context').every(args=>args[2]===f.mapping.carrierTaskId));
  }finally{second.close();await f.close();}
});
for(const response of [{code:1,stdout:'',stderr:''},{code:0,stdout:'{',stderr:''},json({ok:true,task_id:'错误'}),json({ok:false})])test('提交回执未知只查原 UUID，不重提',async()=>{
  const f=await fixture();try {f.mock.setSubmitResponse(response);await f.transport().execute(f.mapping);await f.transport().execute(f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping);
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);assert.equal(f.mappings.listForGeneration(f.mapping.generationKey).length,1);
  } finally {await f.close();}
});
for(const [name,mutate] of [
  ['缺附件',(v:any)=>{v.task.attachments=[];}],['重复附件',(v:any)=>{v.task.attachments.push({...v.task.attachments[0]});}],
  ['附件摘要',(v:any)=>{v.task.attachments[0].sha256='0'.repeat(64);}],['附件大小',(v:any)=>{v.task.attachments[0].size++;}],
  ['附件缺失',(v:any)=>{v.task.attachments[0].read_state='missing';}],['显式未物化',(v:any)=>{v.task_record_materialized=false;}],
  ['缺失路由模型族',(v:any)=>{delete v.task.model_routing.selected.model_family_id;}],
  ['显式路由模型冲突',(v:any)=>{v.task.model_routing.selected.model_id='其他';}],
  ['实际模型',(v:any)=>{v.task.direct_runtime_model_id='其他';}],['路由冲突',(v:any)=>{v.task.model_routing.selected.agent_id='其他';}],
  ['时间倒置',(v:any)=>{v.task.observability.lifecycle.running_at='2099-01-01T00:00:00Z';}],
  ['未知投影',(v:any)=>{v.schema_version=99;}],['错误项目',(v:any)=>{v.task.root_dir='/其他';}],
] as const)test(`公开证据拒绝${name}`,async()=>{
  const f=await fixture();try {f.mock.mutateShow(mutate);await assert.rejects(f.transport().execute(f.mapping));
    assert.notEqual(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status,'validated');assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);
  }finally{await f.close();}
});
for(const [name,mutate] of [
  ['请求摘要',(v:any)=>{v.requestSha256='0'.repeat(64);}],['父检查点',(v:any)=>{v.parentCheckpoint={version:99};}],
  ['旧外层',(v:any)=>{v.schemaVersion=1;}],['未知字段',(v:any)=>{v.extra=true;}],['业务合同',(v:any)=>{v.businessContract='其他';}],
  ['来源自述',(v:any)=>{v.provenance.agentId='codex';}],['实际模型自述',(v:any)=>{delete v.provenance.modelId;}],
  ['候选开始越界',(v:any)=>{v.provenance.startedAt='2000-01-01T00:00:00Z';}],
  ['候选完成越界',(v:any)=>{v.provenance.completedAt='2099-01-01T00:00:00Z';}],
  ['候选时间倒置',(v:any)=>{v.provenance.startedAt='2099-01-01T00:00:00Z';v.provenance.completedAt='2000-01-01T00:00:00Z';}],
] as const)test(`结果拒绝${name}`,async()=>{
  const f=await fixture();try {f.mock.mutateResult(mutate);await assert.rejects(f.transport().execute(f.mapping));assert.notEqual(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status,'validated');}finally{await f.close();}
});
for(const [name,mutate] of [
  ['重复工件',(r:any[])=>[...r,...r]],['字符串大小',(r:any[])=>[{...r[0],size:String(r[0].size)}]],
  ['超限',(r:any[])=>[{...r[0],size:16777217}]],['错误字节',(r:any[])=>[{...r[0],size:r[0].size-1}]],['缺工件',()=>[]],
] as const)test(`工件列表拒绝${name}`,async()=>{const f=await fixture();try{f.mock.mutateList(mutate);await assert.rejects(f.transport().execute(f.mapping));}finally{await f.close();}});
test('摘要按实际字节核验，同任务变化结果拒绝并保留旧结果',async()=>{
  const f=await fixture();try {
    await f.transport().execute(f.mapping);const saved=f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping;
    const old=saved.resultJson!;f.mock.artifacts.set(saved.carrierTaskId,old+' ');
    await assert.rejects(f.transport().execute(saved),{code:'mah_artifact_changed'});
    assert.equal(f.mappings.getByTaskId(saved.carrierTaskId)?.resultJson,old);
  } finally {await f.close();}
});
test('prepared 重启只读，CAS 后断线与 not_found 保留同一提交身份',async()=>{
  const f=await fixture();try {
    const run:MahCommandRunner=async(_c,a)=>{f.mock.commands.push(a);return {code:1,stdout:'{"error":{"code":"task_not_found"}}',stderr:''};};
    await f.transport(run).recoverActiveMappings();assert.equal(f.mock.commands.length,0);
    assert.equal(f.mappings.claimSubmission(f.mapping.carrierTaskId,f.mapping.requestSha256),true);
    assert.equal(f.mappings.claimSubmission(f.mapping.carrierTaskId,f.mapping.requestSha256),false);
    await f.transport(run).recoverActiveMappings();await assert.rejects(f.transport(run).execute(f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping),{code:'mah_queue_wait_timed_out'});
    assert.ok(f.mock.commands.every(a=>a[1]==='show'));assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status,'submission_unknown');
  }finally{await f.close();}
});
test('排队等待超时不启动执行时限，不取消或重提',async()=>{
  const f=await fixture();try {f.mock.setStatus('queued');await assert.rejects(f.transport().execute(f.mapping),{code:'mah_queue_wait_timed_out'});
    const saved=f.mappings.getByTaskId(f.mapping.carrierTaskId)!;assert.equal(saved.runningAt,undefined);assert.equal(saved.status,'queued');
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);assert.equal(f.mock.commands.filter(a=>a[1]==='cancel').length,0);
  }finally{await f.close();}
});
test('执行超时先保存取消意图再取消，晚到工件不可验证',async()=>{
  const f=await fixture();try {
    f.mappings.claimSubmission(f.mapping.carrierTaskId,f.mapping.requestSha256);
    f.mappings.recordRunningAt(f.mapping.carrierTaskId,'2000-01-01T00:00:00Z');f.mock.setStatus('running');f.mock.mutateShow(v=>{v.task.created_at='2000-01-01T00:00:00Z';v.task.observability.lifecycle.running_at='2000-01-01T00:00:00Z';});
    const run:MahCommandRunner=async(c,a,o)=>{if(a[1]==='cancel')assert.ok(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.cancelRequestedAt);return f.mock.run(c,a,o);};
    await assert.rejects(f.transport(run).execute(f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping),{code:'mah_task_timed_out'});
    assert.ok(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.cancelRequestedAt);assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,0);
  }finally{await f.close();}
});
test('停机只停止本地监督，不取消远端任务',async()=>{
  const f=await fixture();try {f.mappings.claimSubmission(f.mapping.carrierTaskId,f.mapping.requestSha256);const abort=new AbortController();
    const run:MahCommandRunner=async()=>{abort.abort(MAH_SUPERVISION_STOP_REASON);return {code:-1,stdout:'',stderr:'',aborted:true};};
    await assert.rejects(f.transport(run).execute(f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping,abort.signal),{code:'mah_supervision_stopped'});
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.cancelRequestedAt,undefined);
  }finally{await f.close();}
});
test('请求 Schema 1/2 保留严格历史读取，未知字段拒绝且禁止旧协议执行',async()=>{
  const f=await fixture();try {
    const {protocol:_p,projectRoot:_r,...base}=f.mapping.request as Extract<MahStageRequest,{schemaVersion:3}>;
    for(const version of [1,2] as const){const legacy={...base,schemaVersion:version,output:{...base.output,envelopeContract:'landi.mah-generation-stage-result.v1'},execution:{...base.execution,agentPreference:'codex',...(version===2?{personalOsSlotClass:'interactive'}:{})}} as MahStageRequest;
      assertMahStageRequest(legacy);const bytes=canonicalJson(legacy);
      const mapping={...f.mapping,request:legacy,protocol:version===1?'mah_slot_v1':'mah_slot_v2',slotClass:version===1?'background':'interactive',requestJson:bytes,requestSha256:sha256(bytes),requestByteLength:Buffer.byteLength(bytes)} as MahCarrierMapping;
      assertPersistedMahMapping(mapping);await assert.rejects(f.transport().execute(mapping),{code:'mah_legacy_protocol_read_only'});
    }
    assert.throws(()=>assertMahStageRequest({...f.mapping.request,execution:{...f.mapping.request.execution,agentPreference:'codex'}} as MahStageRequest));
    assert.equal(f.mock.commands.length,0);
  }finally{await f.close();}
});
test('公开完成版本在读取期间前进后，重新核验稳定候选',async()=>{
  const f=await fixture();try {let shows=0;f.mock.mutateShow(v=>{shows++;if(shows>=3)v.task.task_lifecycle_revision++;});
    const result=await f.transport().execute(f.mapping);assert.equal(result.mapping.status,'validated');
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);
  }finally{await f.close();}
});
test('取消命令失联仍先保存意图，晚到 completed 只收敛取消',async()=>{
  const f=await fixture();try {await f.transport().execute(f.mapping);
    const run:MahCommandRunner=async(c,a,o)=>{if(a[1]==='cancel'){assert.ok(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.cancelRequestedAt);return {code:1,stdout:'',stderr:''};}return f.mock.run(c,a,o);};
    await f.transport(run).cancelGeneration(f.mapping.generationKey);
    const saved=f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping;assert.equal(saved.status,'cancelled');assert.ok(saved.cancelRequestedAt);
    await assert.rejects(f.transport().execute(saved),{code:'cancelled'});
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);
  }finally{await f.close();}
});
test('提交回执丢失后关闭文件库，重启恢复原映射且不再 submit',async()=>{
  const f=await fixture();let reopened:SqliteWorkspaceStore|undefined;
  try {
    f.mock.setSubmitResponse({code:1,stdout:'',stderr:''});await f.transport().execute(f.mapping);
    const before=f.mappings.getByTaskId(f.mapping.carrierTaskId)!;f.storage.close();
    reopened=new SqliteWorkspaceStore(f.path);
    const store=reopened.generationCarriers as MahGenerationMappings;
    const transport=new MahCliTransport({mahProjectRoot:ROOT,store,environment:ENV,run:f.mock.run,pollIntervalMs:1,schedulerWaitMs:25});
    await transport.recoverActiveMappings();const saved=store.getByTaskId(f.mapping.carrierTaskId)!;
    assert.equal(saved.requestJson,before.requestJson);assert.equal(saved.requestSha256,before.requestSha256);assert.equal(saved.runningAt,before.runningAt);
    assert.equal(saved.resultSha256,before.resultSha256);assert.equal(saved.status,'validated');
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);
  }finally{reopened?.close();await f.close();}
});
test('提交前冻结请求被改动时无外部调用',async()=>{
  const f=await fixture();try {await assert.rejects(f.transport().execute({...f.mapping,requestSha256:'0'.repeat(64)}),{code:'mah_request_invalid'});assert.equal(f.mock.commands.length,0);}finally{await f.close();}
});
test('当前公开回执允许省略 ok，但固定引用必须完全一致',async()=>{
  const f=await fixture();try {const id=f.mapping.carrierTaskId;
    f.mock.setSubmitResponse(json({task_id:id,title:'Landi 有界生成：itinerary_draft',audit_ref:`.mah/tasks/${id}/audit/audit.ndjson`,events_ref:`.mah/tasks/${id}/stream.jsonl`,result_ref:{type:'none'}}));
    await f.transport().execute(f.mapping);const saved=f.mappings.getByTaskId(id) as MahCarrierMapping;assert.ok(saved.submitReceiptJson);
    const receipt=JSON.parse(saved.submitReceiptJson!);receipt.audit_ref='错误引用';
    assert.throws(()=>assertPersistedMahMapping({...saved,submitReceiptJson:canonicalJson(receipt)}),{code:'mah_request_invalid'});
  }finally{await f.close();}
});
test('重启后的公开执行起点变化拒绝，持久执行预算不重置',async()=>{
  const f=await fixture();let reopened:SqliteWorkspaceStore|undefined;
  try {await f.transport().execute(f.mapping);const before=f.mappings.getByTaskId(f.mapping.carrierTaskId)!;
    f.storage.close();reopened=new SqliteWorkspaceStore(f.path);const store=reopened.generationCarriers as MahGenerationMappings;
    f.mock.mutateShow(v=>{v.task.created_at=new Date(Date.parse(before.runningAt!)-2).toISOString();v.task.observability.lifecycle.running_at=new Date(Date.parse(before.runningAt!)-1).toISOString();});
    const transport=new MahCliTransport({mahProjectRoot:ROOT,store,environment:ENV,run:f.mock.run,pollIntervalMs:1,schedulerWaitMs:25});
    await assert.rejects(transport.execute(store.getByTaskId(before.carrierTaskId) as MahCarrierMapping),{code:'mah_task_lifecycle_conflict'});
    assert.equal(store.getByTaskId(before.carrierTaskId)?.runningAt,before.runningAt);
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);
  }finally{reopened?.close();await f.close();}
});

for (const finishAfterBudget of [false, true]) test(`公开 run_started 替换初始时间时仍使用原预算：${finishAfterBudget}`, async () => {
  const f = await fixture();
  try {
    const current = new Date(Date.now() - 1000).toISOString();
    const initial = new Date(Date.parse(current) - 20).toISOString();
    const created = new Date(Date.parse(initial) - 200).toISOString();
    const completed = new Date(Date.parse(current) + (finishAfterBudget ? 59_990 : 1)).toISOString();
    f.mappings.recordRunningAt(f.mapping.carrierTaskId, initial);
    f.mock.mutateShow(v => {
      v.task.created_at = created; v.task.updated_at = completed;
      v.task.observability.lifecycle = {running_at:current, first_event_at:current, completed_at:completed, last_status:v.task.status};
    });
    f.mock.mutateResult(v => { v.provenance.startedAt = current; v.provenance.completedAt = current; });
    if (finishAfterBudget) await assert.rejects(f.transport().execute(f.mapping), {code:'mah_task_timed_out'});
    else assert.equal((await f.transport().execute(f.mapping)).mapping.status, 'validated');
    const saved = f.mappings.getByTaskId(f.mapping.carrierTaskId)!;
    assert.equal(saved.runningAt, initial);
    if (finishAfterBudget) assert.equal(saved.resultJson, undefined);
    assert.equal(f.mock.commands.filter(a => a[1] === 'submit').length, 1);
  } finally { await f.close(); }
});

test('公开来源合法但业务 payload 无效，由原研究 parser 拒绝并保留候选检查点',async()=>{
  const f=await fixture();try {
    const adapter=new MahBlueprintRuntimeAdapter({mappings:f.mappings,transport:f.transport(),checkpoint:key=>f.storage.getGenerationCarrierCheckpoint(key)});
    const request=f.mapping.request;
    await assert.rejects(adapter.runWithGenerationContext({generationKey:request.generationKey,proposalRef:request.proposalRef,skillLineage:request.skillLineage},()=>adapter.generateSkillResearchBatch({
      request:'虚构测试市研究',batch:{id:'虚构批次',scopeLabel:'测试市'},completedAt:new Date().toISOString(),
      profile:{preferredLanguage:'zh-CN',nationality:'中国',gender:'not_specified',immigrationStatus:'unknown'}
    })),{code:'mah_business_payload_invalid'});
    const rejected=f.mappings.listForGeneration(request.generationKey).find(m=>m.operation==='research_batch');
    assert.equal(rejected?.status,'artifact_invalid');assert.ok(rejected?.resultSha256);assert.equal(f.storage.getResearchSetByGenerationKey(request.generationKey),undefined);
  }finally{await f.close();}
});

test('停机较久后恢复时限内完成的任务，以公开完成时间核定预算',async()=>{
  const f=await fixture();let reopened:SqliteWorkspaceStore|undefined;
  try {
    await f.transport().execute(f.mapping);
    const id=f.mapping.carrierTaskId,past='2000-01-01T00:00:00Z',done='2000-01-01T00:00:01Z';
    // 模拟已提交后停机，远端在原预算内完成；本地首次恢复才观察到完成。
    const original=JSON.parse(f.mock.artifacts.get(id)!);original.provenance.startedAt=past;original.provenance.completedAt=done;
    f.mock.artifacts.set(id,JSON.stringify(original));
    const database=new (await import('node:sqlite')).DatabaseSync(f.path);
    database.prepare("UPDATE mah_generation_carriers SET running_at=?,status='running',result_json=NULL,result_sha256=NULL WHERE carrier_task_id=?").run(past,id);database.close();
    f.storage.close();reopened=new SqliteWorkspaceStore(f.path);const store=reopened.generationCarriers as MahGenerationMappings;
    f.mock.mutateShow(v=>{v.task.created_at=past;v.task.updated_at=done;v.task.observability.lifecycle.running_at=past;v.task.observability.lifecycle.completed_at=done;});
    const transport=new MahCliTransport({mahProjectRoot:ROOT,store,environment:ENV,run:f.mock.run,pollIntervalMs:1,schedulerWaitMs:25});
    await transport.recoverActiveMappings();const restored=store.getByTaskId(id) as MahCarrierMapping;
    assert.equal(restored.status,'validated');await transport.execute(restored);
    assert.equal(store.getByTaskId(id)?.cancelRequestedAt,undefined);assert.equal(f.mock.commands.filter(a=>a[1]==='cancel').length,0);
    assert.equal(f.mock.commands.filter(a=>a[1]==='submit').length,1);
  }finally{reopened?.close();await f.close();}
});
test('结果读取命令超时，即使 stdout 完整也不能接受',async()=>{
  const f=await fixture();try {const run:MahCommandRunner=async(c,a,o)=>{const r=await f.mock.run(c,a,o);return a[1]==='context'&&a.includes('--read')?{...r,timedOut:true}:r;};
    await assert.rejects(f.transport(run).execute(f.mapping),{code:'mah_public_read_incomplete'});assert.notEqual(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status,'validated');
  }finally{await f.close();}
});

test('候选工作时间在公开执行区间内即可，预算由公开生命周期决定',async()=>{
  const f=await fixture();try {f.mock.mutateShow(v=>{const life=v.task.observability.lifecycle;v.task.created_at=new Date(Date.parse(life.running_at)-10).toISOString();life.running_at=v.task.created_at;life.completed_at=new Date(Date.parse(life.completed_at)+10).toISOString();v.task.updated_at=life.completed_at;});
    await f.transport().execute(f.mapping);assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status,'validated');
  }finally{await f.close();}
});

for (const scenario of ['overrun', 'acceptance', 'race'] as const) {
  test(`Adaptive 生产计时 ${scenario}`, async () => {
    const f = await fixture(true);
    try {
      const taskId = f.mapping.carrierTaskId;
      const runningAt = new Date(Date.now() - 180_000).toISOString();
      const startedAt = new Date(Date.now() - 90_000).toISOString();
      const endedAt = new Date(Date.parse(startedAt) + 30_000).toISOString();
      const traceId = 'synthetic-trace';
      const requestId = 'synthetic-request';
      const task = {
        task_id: taskId, root_dir: ROOT, status: 'running', trace_id: traceId, active_request_id: requestId,
        orchestration_topology: 'adaptive', task_lifecycle_revision: 6, created_at: runningAt,
        updated_at: new Date().toISOString(), observability: { lifecycle: { running_at: runningAt } },
      };
      f.mappings.claimSubmission(taskId, f.mapping.requestSha256);
      const controller = new AbortController();
      let replays = 0;
      let cancels = 0;
      const run: MahCommandRunner = async (_command, args) => {
        assert.equal(args[2], taskId);
        if (args[1] === 'show') return json({ ok: true, task: { ...task, status: cancels ? 'cancelled' : 'running' } });
        if (args[1] === 'cancel') {
          assert.equal(scenario, 'overrun');
          assert.ok(f.mappings.getByTaskId(taskId)?.cancelRequestedAt);
          cancels++;
          return json({ ok: true, task_id: taskId });
        }
        assert.equal(args[1], 'replay');
        replays++;
        const productionEnded = scenario === 'acceptance' || (scenario === 'race' && replays > 1);
        if (productionEnded) queueMicrotask(() => controller.abort(MAH_SUPERVISION_STOP_REASON));
        return json({
          metadata: task, project_identity: { canonical_root: ROOT, requested_root: ROOT },
          orchestration: { schema_version: 2, topology: 'adaptive', task_id: taskId, task_state: {
            schema_version: 1, task_id: taskId, lifecycle_state: 'active', activation_epoch: 1,
            subtask_revisions: [{ revision_id: 'production', activation_epoch: 1, intent_frame: { operation: 'synthesize' } }],
            attempts: [{
              revision_id: 'production', attempt_id: 'attempt', executor_agent_id: 'test-agent',
              resolved_model_id: 'test-model', executor_model_family_id: 'test-family',
              model_routing: { selected: { agent_id: 'test-agent', model_family_id: 'test-family' } },
              started_at: startedAt, status: productionEnded ? 'completed' : 'running',
              ...(productionEnded ? { ended_at: endedAt } : {}),
            }],
          } },
        });
      };
      await assert.rejects(f.transport(run).execute(f.mappings.getByTaskId(taskId) as MahCarrierMapping, controller.signal), {
        code: scenario === 'overrun' ? 'mah_task_timed_out' : 'mah_supervision_stopped',
      });
      assert.ok(replays >= (scenario === 'acceptance' ? 1 : 2));
      assert.equal(cancels, scenario === 'overrun' ? 1 : 0);
      assert.equal(Boolean(f.mappings.getByTaskId(taskId)?.cancelRequestedAt), scenario === 'overrun');
    } finally { await f.close(); }
  });
}

test('Scheduler running may outlive the queue window without authorizing results before materialization', async () => {
  const f = await fixture();
  try {
    let firstShow = 0, materialized = false;
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] === 'show') {
        firstShow ||= Date.now();
        if (Date.now() - firstShow < 45) {
          f.mock.commands.push([...args]);
          assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
          return { code: 0, stdout: JSON.stringify({ ok: true, task_record_materialized: false,
            task: { task_id: f.mapping.carrierTaskId, status: 'running' },
            scheduled_task: { task_id: f.mapping.carrierTaskId } }), stderr: '' };
        }
        materialized = true;
      }
      if (args[1] === 'context') assert.equal(materialized, true);
      return f.mock.run(command, args, options);
    };
    const result = await f.transport(run).execute(f.mapping);
    assert.equal(result.mapping.status, 'validated');
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    assert.ok(result.mapping.runningAt);
  } finally { await f.close(); }
});

test('a later supervision attempt gets a new bounded query window for the same Task without resubmission', async t => {
  const f = await fixture();
  try {
    const unavailable: MahCommandRunner = async (command, args, options) => {
      if (args[1] !== 'show') return f.mock.run(command, args, options);
      f.mock.commands.push([...args]);
      return { code: 1, stdout: JSON.stringify({ error: { code: 'task_not_found' } }), stderr: '' };
    };
    await assert.rejects(f.transport(unavailable).execute(f.mapping), { code: 'mah_queue_wait_timed_out' });
    const original = f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping;
    assert.equal(original.status, 'submission_unknown');
    let shows = 0;
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] === 'show' && ++shows === 1) {
        f.mock.commands.push([...args]);
        return { code: 0, stdout: JSON.stringify({ ok: true, task_record_materialized: false,
          task: { task_id: original.carrierTaskId, status: 'queued' }, scheduled_task: { task_id: original.carrierTaskId } }), stderr: '' };
      }
      return f.mock.run(command, args, options);
    };
    // Advance beyond a request-origin deadline without requiring tiny timer
    // intervals. Only this supervision attempt receives the larger test window.
    const realNow = Date.now.bind(Date);
    t.mock.method(Date, 'now', () => realNow() + 10000);
    const resumed = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV,
      run, schedulerWaitMs: 5000, cancelWaitMs: 10, pollIntervalMs: 1 });
    const result = await resumed.execute(original);
    assert.equal(result.mapping.carrierTaskId, original.carrierTaskId);
    assert.equal(result.mapping.requestSha256, original.requestSha256);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    assert.ok(shows > 1);
  } finally { await f.close(); }
});

for (const [name, mutate] of [
  ['conflicting Task', (value: any) => { value.task.task_id = '33333333-3333-4333-8333-333333333333'; }],
  ['conflicting scheduled Task', (value: any) => { value.scheduled_task.task_id = '33333333-3333-4333-8333-333333333333'; }],
  ['conflicting project', (value: any) => { value.project_root = '/other-project'; }],
  ['fake completed projection', (value: any) => { value.task.status = 'completed'; }],
] as const) test(`scheduler-only ${name} never grants artifact access or execution timing`, async () => {
  const f = await fixture();
  try {
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] !== 'show') return f.mock.run(command, args, options);
      f.mock.commands.push([...args]);
      const value: any = { ok: true, task_record_materialized: false,
        task: { task_id: f.mapping.carrierTaskId, status: 'running' }, scheduled_task: { task_id: f.mapping.carrierTaskId } };
      mutate(value);
      return { code: 0, stdout: JSON.stringify(value), stderr: '' };
    };
    await assert.rejects(f.transport(run).execute(f.mapping), { code: 'mah_queue_wait_timed_out' });
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
    assert.ok(f.mock.commands.every(args => args[1] !== 'context'));
  } finally { await f.close(); }
});

test('scheduler-only running has a fixed materialization bound that polling cannot refresh', { timeout: 5000 }, async () => {
  const f = await fixture(false, 1);
  try {
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] !== 'show') return f.mock.run(command, args, options);
      f.mock.commands.push([...args]);
      return { code: 0, stdout: JSON.stringify({ ok: true, task_record_materialized: false,
        task: { task_id: f.mapping.carrierTaskId, status: 'running' }, scheduled_task: { task_id: f.mapping.carrierTaskId } }), stderr: '' };
    };
    const started = Date.now();
    await assert.rejects(f.transport(run).execute(f.mapping), { code: 'mah_queue_wait_timed_out' });
    assert.ok(Date.now() - started >= 1000);
    const stored = f.mappings.getByTaskId(f.mapping.carrierTaskId)!;
    assert.equal(stored.runningAt, undefined);
    assert.equal(stored.status, 'queued');
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    assert.equal(f.mock.commands.filter(args => args[1] === 'cancel').length, 0);
  } finally { await f.close(); }
});

test('recovery and cancellation retain scheduler projection uncertainty without artifact acceptance', async () => {
  const f = await fixture();
  try {
    f.mock.setStatus('queued');
    await assert.rejects(f.transport().execute(f.mapping), { code: 'mah_queue_wait_timed_out' });
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] !== 'show') return f.mock.run(command, args, options);
      f.mock.commands.push([...args]);
      return { code: 0, stdout: JSON.stringify({ ok: true, task_record_materialized: false,
        task: { task_id: f.mapping.carrierTaskId, status: 'running' }, scheduled_task: { task_id: f.mapping.carrierTaskId } }), stderr: '' };
    };
    await f.transport(run).recoverActiveMappings();
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
    await assert.rejects(f.transport(run).cancelGeneration(f.mapping.generationKey), { code: 'mah_cancel_unconfirmed' });
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status, 'cancel_requested');
    assert.ok(f.mock.commands.every(args => args[1] !== 'context'));
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally { await f.close(); }
});

for (const scenario of ['immediate', 'delayed', 'never', 'no_prior_end', 'wrong_project', 'changed_identity', 'acceptance_limit'] as const) {
  test(`Adaptive close projection convergence: ${scenario}`, { timeout: 5000 }, async () => {
    const f = await fixture(true);
    try {
      const taskId = f.mapping.carrierTaskId;
      const expiredAcceptance = scenario === 'acceptance_limit';
      const runningAt = new Date(Date.now() - (expiredAcceptance ? 3900000 : 180000)).toISOString();
      const startedAt = new Date(Date.now() - (expiredAcceptance ? 3700000 : 90000)).toISOString();
      const endedAt = new Date(Date.parse(startedAt) + 30000).toISOString();
      const task = { task_id: taskId, root_dir: ROOT, status: 'running', trace_id: 'close-trace', active_request_id: 'close-request',
        orchestration_topology: 'adaptive', task_lifecycle_revision: 6, created_at: runningAt,
        updated_at: new Date().toISOString(), observability: { lifecycle: { running_at: runningAt } } };
      f.mappings.claimSubmission(taskId, f.mapping.requestSha256);
      let replays = 0, closingShows = 0, contexts = 0, cancels = 0;
      let closing = false;
      const run: MahCommandRunner = async (_command, args) => {
        assert.equal(args[2], taskId);
        if (args[1] === 'cancel') { cancels++; throw Error('No automatic cancellation is allowed after verified production ended.'); }
        if (args[1] === 'context') { contexts++; throw Error('full_validation_requested'); }
        if (args[1] === 'show') {
          if (closing) closingShows++;
          const completed = closing && ((scenario === 'immediate') || (scenario === 'delayed' && closingShows >= 2));
          return json({ ok: true, task: { ...task,
            ...(closing && scenario === 'wrong_project' ? { root_dir: '/other-project' } : {}),
            ...(closing && scenario === 'changed_identity' ? { active_request_id: 'other-request' } : {}),
            status: completed ? 'completed' : 'running',
            observability: { lifecycle: { running_at: runningAt, ...(completed ? { completed_at: new Date().toISOString() } : {}) } } } });
        }
        assert.equal(args[1], 'replay');
        replays++;
        closing = scenario === 'no_prior_end' || replays > 1;
        return json({ metadata: task, project_identity: { canonical_root: ROOT, requested_root: ROOT },
          orchestration: { schema_version: 2, topology: 'adaptive', task_id: taskId, task_state: {
            schema_version: 1, task_id: taskId, lifecycle_state: closing ? 'closed' : 'active', activation_epoch: 1,
            subtask_revisions: [{ revision_id: 'production', activation_epoch: 1, intent_frame: { operation: 'synthesize' } }],
            attempts: [{ revision_id: 'production', attempt_id: 'ended-production', executor_agent_id: 'test-agent',
              resolved_model_id: 'test-model', executor_model_family_id: 'test-family',
              model_routing: { selected: { agent_id: 'test-agent', model_family_id: 'test-family' } },
              started_at: startedAt, ended_at: endedAt, status: 'completed' }],
          } } });
      };
      const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV,
        run, schedulerWaitMs: 100, cancelWaitMs: 10, pollIntervalMs: 1 });
      const expected = scenario === 'immediate' || scenario === 'delayed' ? /full_validation_requested/
        : { code: scenario === 'wrong_project' ? 'mah_task_project_mismatch'
          : scenario === 'acceptance_limit' ? 'mah_acceptance_wait_timed_out' : 'mah_execution_clock_unverified' };
      await assert.rejects(transport.execute(f.mappings.getByTaskId(taskId) as MahCarrierMapping), expected);
      assert.equal(cancels, 0);
      assert.equal(f.mappings.getByTaskId(taskId)?.runningAt, runningAt);
      assert.notEqual(f.mappings.getByTaskId(taskId)?.status, 'validated');
      assert.equal(contexts > 0, scenario === 'immediate' || scenario === 'delayed');
      if (scenario === 'no_prior_end') assert.equal(closingShows, 1);
      if (scenario === 'never') assert.equal(replays, 2, 'The close wait polls show without refreshing the clock or deadline.');
    } finally { await f.close(); }
  });
}

for (const missing of ['observability', 'lifecycle', 'running_at', 'created_at', 'updated_at'] as const) {
  test(`initial running projection converges from missing ${missing} without recording a clock early`, async () => {
    const f = await fixture();
    try {
      f.mock.setStatus('running');
      let shows = 0;
      f.mock.mutateShow(value => {
        shows++;
        if (shows < 3) {
          assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
          if (missing === 'observability') delete value.task.observability;
          else if (missing === 'lifecycle') delete value.task.observability.lifecycle;
          else if (missing === 'running_at') delete value.task.observability.lifecycle.running_at;
          else delete value.task[missing];
        }
      });
      const run: MahCommandRunner = async (command, args, options) => {
        if (args[1] === 'show' && shows >= 2) f.mock.setStatus('completed');
        return f.mock.run(command, args, options);
      };
      const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV,
        run, schedulerWaitMs: 5000, cancelWaitMs: 10, pollIntervalMs: 1 });
      assert.equal((await transport.execute(f.mapping)).mapping.status, 'validated');
      assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
      assert.equal(f.mock.commands.filter(args => args[1] === 'cancel').length, 0);
    } finally { await f.close(); }
  });
}

for (const [name, mutate] of [
  ['malformed time', (value: any) => { value.task.observability.lifecycle.running_at = 'not-a-time'; }],
  ['contradictory complete times', (value: any) => { value.task.observability.lifecycle.running_at = '2000-01-01T00:00:00Z'; }],
  ['contradictory partial times', (value: any) => { delete value.task.observability.lifecycle.running_at; value.task.updated_at = '2000-01-01T00:00:00Z'; }],
  ['future partial time', (value: any) => { delete value.task.observability.lifecycle.running_at; value.task.created_at = new Date(Date.now() + 60000).toISOString(); }],
  ['malformed observability', (value: any) => { value.task.observability = 'unreadable'; }],
  ['malformed lifecycle', (value: any) => { value.task.observability.lifecycle = 'unreadable'; }],
] as const) test(`initial lifecycle observation immediately refuses ${name}`, async () => {
  const f = await fixture();
  try {
    f.mock.setStatus('running'); f.mock.mutateShow(mutate);
    await assert.rejects(f.transport().execute(f.mapping), { code: 'mah_task_lifecycle_unverified' });
    assert.equal(f.mock.commands.filter(args => args[1] === 'show').length, 1);
    assert.equal(f.mock.commands.filter(args => args[1] === 'cancel').length, 0);
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
  } finally { await f.close(); }
});

test('missing initial lifecycle has a fixed bounded wait and recovery remains read-only', { timeout: 5000 }, async () => {
  const f = await fixture();
  try {
    f.mappings.claimSubmission(f.mapping.carrierTaskId, f.mapping.requestSha256);
    f.mock.setStatus('running'); f.mock.mutateShow(value => { delete value.task.observability.lifecycle.running_at; });
    const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV,
      run: f.mock.run, schedulerWaitMs: 100, cancelWaitMs: 10, pollIntervalMs: 1 });
    await transport.recoverActiveMappings();
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
    await assert.rejects(transport.execute(f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping), { code: 'mah_task_lifecycle_unverified' });
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status, 'submission_unknown');
    assert.ok(f.mock.commands.every(args => args[1] === 'show'));
  } finally { await f.close(); }
});

test('a completed task without a lifecycle and a previously verified running clock disappearing remain refused', async () => {
  for (const completed of [true, false]) {
    const f = await fixture();
    try {
      f.mock.setStatus(completed ? 'completed' : 'running');
      let shows = 0;
      f.mock.mutateShow(value => { if (completed || ++shows > 1) delete value.task.observability.lifecycle.running_at; });
      await assert.rejects(f.transport().execute(f.mapping), { code: 'mah_task_lifecycle_unverified' });
      assert.notEqual(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status, 'validated');
      assert.equal(f.mock.commands.filter(args => args[1] === 'cancel').length, 0);
      assert.equal(Boolean(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt), !completed);
    } finally { await f.close(); }
  }
});

for (const resultChange of ['valid', 'binding', 'route'] as const) test(`completed-version reread discards the old result and formally validates the new one: ${resultChange}`, async () => {
  const f = await fixture();
  try {
    let revision = 6, reads = 0;
    f.mock.mutateShow(value => { value.task.task_lifecycle_revision = revision; });
    const run: MahCommandRunner = async (command, args, options) => {
      const response = await f.mock.run(command, args, options);
      if (args[1] === 'context' && args.includes('--read') && ++reads === 1) {
        const next = JSON.parse(f.mock.artifacts.get(f.mapping.carrierTaskId)!);
        next.payload.accepted = false;
        if (resultChange === 'binding') next.requestSha256 = '0'.repeat(64);
        if (resultChange === 'route') next.provenance.agentId = 'unverified-agent';
        f.mock.artifacts.set(f.mapping.carrierTaskId, JSON.stringify(next));
        revision++;
      }
      return response;
    };
    if (resultChange === 'valid') {
      const result = await f.transport(run).execute(f.mapping);
      assert.equal(result.result.payload.accepted, false);
      assert.equal(result.mapping.resultSha256, sha256(f.mock.artifacts.get(f.mapping.carrierTaskId)!));
      assert.ok(reads >= 3, 'The new candidate is independently reread by its public receipt verifier.');
    } else {
      await assert.rejects(f.transport(run).execute(f.mapping), { code: resultChange === 'binding' ? 'mah_artifact_correlation_mismatch' : 'mah_provider_route_unverified' });
      assert.notEqual(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status, 'validated');
    }
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    assert.equal(f.mock.commands.filter(args => args[1] === 'cancel').length, 0);
  } finally { await f.close(); }
});

test('a forward completed version before the first candidate triggers a fresh full snapshot', async () => {
  const f = await fixture();
  try {
    let shows = 0, reads = 0;
    f.mock.mutateShow(value => { value.task.task_lifecycle_revision = ++shows === 1 ? 6 : 7; });
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] === 'context' && args.includes('--read')) reads++;
      return f.mock.run(command, args, options);
    };
    assert.equal((await f.transport(run).execute(f.mapping)).mapping.status, 'validated');
    assert.ok(reads >= 3);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally { await f.close(); }
});

test('continuously changing completed versions stop after three full reads and preserve the race error', async () => {
  const f = await fixture();
  try {
    let revision = 6, reads = 0;
    f.mock.mutateShow(value => { value.task.task_lifecycle_revision = revision; });
    const run: MahCommandRunner = async (command, args, options) => {
      const response = await f.mock.run(command, args, options);
      if (args[1] === 'context' && args.includes('--read')) { reads++; revision++; }
      return response;
    };
    await assert.rejects(f.transport(run).execute(f.mapping), { code: 'mah_business_task_changed_during_read' });
    assert.equal(reads, 3);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.resultJson, undefined);
  } finally { await f.close(); }
});

test('artifact read permissions are not retried even when the completed version advances', async () => {
  const f = await fixture();
  try {
    let revision = 6, reads = 0;
    f.mock.mutateShow(value => { value.task.task_lifecycle_revision = revision; });
    const run: MahCommandRunner = async (command, args, options) => {
      if (args[1] === 'context' && args.includes('--read')) {
        reads++; revision++;
        return { code: 1, stdout: JSON.stringify({ ok: false, error: { code: 'permission_denied' } }), stderr: '' };
      }
      return f.mock.run(command, args, options);
    };
    await assert.rejects(f.transport(run).execute(f.mapping), { code: 'mah_business_public_read_failed' });
    assert.equal(reads, 1);
  } finally { await f.close(); }
});

test('a known result digest conflict is not hidden by a simultaneous completed-version race', async () => {
  const f = await fixture();
  try {
    const accepted = await f.transport().execute(f.mapping);
    const old = accepted.mapping.resultJson!;
    f.mock.artifacts.set(f.mapping.carrierTaskId, old + ' ');
    let revision = 6, reads = 0;
    f.mock.mutateShow(value => { value.task.task_lifecycle_revision = revision; });
    const run: MahCommandRunner = async (command, args, options) => {
      const response = await f.mock.run(command, args, options);
      if (args[1] === 'context' && args.includes('--read')) { reads++; revision++; }
      return response;
    };
    await assert.rejects(f.transport(run).execute(accepted.mapping), { code: 'mah_artifact_changed' });
    assert.equal(reads, 1);
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.resultJson, old);
  } finally { await f.close(); }
});

for (const cancelAt of ['read', 'refresh'] as const) test(`cancellation arriving during version ${cancelAt} prevents any new snapshot read`, async () => {
  const f = await fixture();
  try {
    let revision = 6, reads = 0, shows = 0;
    f.mock.mutateShow(value => {
      value.task.task_lifecycle_revision = revision; shows++;
      if (cancelAt === 'refresh' && shows === 4) f.mappings.updateStatus(f.mapping.carrierTaskId, 'cancel_requested');
    });
    const run: MahCommandRunner = async (command, args, options) => {
      const response = await f.mock.run(command, args, options);
      if (args[1] === 'context' && args.includes('--read')) {
        reads++; revision++;
        if (cancelAt === 'read') f.mappings.updateStatus(f.mapping.carrierTaskId, 'cancel_requested');
      }
      return response;
    };
    await assert.rejects(f.transport(run).execute(f.mapping), { code: 'cancelled' });
    assert.equal(reads, 1);
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.status, 'cancel_requested');
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.resultJson, undefined);
  } finally { await f.close(); }
});

for (const fault of ['project', 'task', 'request', 'time', 'backward_version', 'unchanged_version', 'not_completed'] as const) test(`a version reread cannot hide a new ${fault} conflict`, async () => {
  const f = await fixture();
  try {
    let revision = 6, reads = 0, shows = 0;
    f.mock.mutateShow(value => {
      shows++; value.task.task_lifecycle_revision = revision;
      value.task.trace_id = 'snapshot-trace'; value.task.last_request_id = 'snapshot-request';
      if (shows < 4) return;
      if (fault === 'project') value.task.root_dir = '/other-project';
      if (fault === 'task') value.task.task_id = '33333333-3333-4333-8333-333333333333';
      if (fault === 'request') value.task.last_request_id = 'other-request';
      if (fault === 'backward_version') value.task.task_lifecycle_revision = 5;
      if (fault === 'unchanged_version') value.task.task_lifecycle_revision = 6;
      if (fault === 'not_completed') value.task.status = 'running';
      if (fault === 'time') {
        value.task.observability.lifecycle.running_at = new Date(Date.parse(value.task.created_at) + 1).toISOString();
        value.task.updated_at = new Date().toISOString();
      }
    });
    const run: MahCommandRunner = async (command, args, options) => {
      const response = await f.mock.run(command, args, options);
      if (args[1] === 'context' && args.includes('--read')) { reads++; revision++; }
      return response;
    };
    const code = fault === 'project' ? 'mah_task_project_mismatch' : fault === 'task' ? 'mah_task_projection_invalid'
      : fault === 'time' ? 'mah_task_lifecycle_conflict' : 'mah_business_task_changed_during_read';
    await assert.rejects(f.transport(run).execute(f.mapping), { code });
    assert.equal(reads, 1);
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.resultJson, undefined);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally { await f.close(); }
});


for (const frozenTimeout of [83_000, 480_000]) test(`two failed image batches retain original identities and frozen ${frozenTimeout}ms budgets on normal retry`, async () => {
  const f = await fixture();
  try {
    f.mock.setStatus('failed');
    const adapter = new MahBlueprintRuntimeAdapter({ mappings: f.mappings, transport: f.transport(), checkpoint: key => f.storage.getGenerationCarrierCheckpoint(key) });
    const context = { generationKey: f.mapping.generationKey, proposalRef: f.mapping.request.proposalRef, skillLineage: f.mapping.request.skillLineage };
    const imageInput = { request: 'photos only', scopeLabel: 'test city',
      profile: { preferredLanguage: 'zh-CN', nationality: '中国', gender: 'not_specified' as const, immigrationStatus: 'unknown' as const },
      completedAt: '2026-11-10T00:00:00Z',
      places: [{ id: 'museum', name: 'Museum', locationLabel: 'test city', city: 'test city', category: 'museum', priority: 'preferred' as const, whyWorthIt: 'Visit', plan: 'Explore', evidence: [] }] };
    const run = (timeoutMs: number, index: number) => adapter.runWithGenerationContext(context, () => adapter.runWithStageContext({ phase: '图片初次补充', round: 1 }, () => adapter.generatePlannedPlaceImageEnrichment({ ...imageInput, places: imageInput.places.map(place => ({ ...place, id: `museum-${index}` })), timeoutMs })));
    for (const index of [1, 2]) await assert.rejects(run(frozenTimeout, index), { code: 'mah_task_failed' });
    const first = f.mappings.listForGeneration(context.generationKey).filter(mapping => mapping.operation === 'planned_place_image_enrichment');
    assert.equal(first.length, 2);
    assert.ok(first.every(mapping => mapping.request.execution.maxRuntimeSeconds === frozenTimeout / 1000));
    for (const index of [1, 2]) await assert.rejects(run(480_000, index), { code: 'mah_task_failed' });
    const second = f.mappings.listForGeneration(context.generationKey).filter(mapping => mapping.operation === 'planned_place_image_enrichment');
    assert.deepEqual(second.map(mapping => mapping.carrierTaskId), first.map(mapping => mapping.carrierTaskId));
    assert.deepEqual(second.map(mapping => mapping.requestJson), first.map(mapping => mapping.requestJson));
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 2);
  } finally { await f.close(); }
});


function photoInput() {
  return { request: 'PRIVATE_USER_REQUEST: anniversary trip with private medical notes', scopeLabel: 'Kyoto',
    profile: { preferredLanguage: 'zh-CN', nationality: 'PRIVATE_NATIONALITY', gender: 'not_specified' as const, immigrationStatus: 'unknown' as const },
    completedAt: '2026-11-10T00:00:00Z',
    sources: [{ id: 'museum-source', title: 'Gallery', authority: 'Museum', url: 'https://museum.example/kyoto/gallery', retrievedAt: '2026-11-10', status: 'verified' as const },
      { id: 'unrelated-source', title: 'Private booking', authority: 'Unrelated', url: 'https://unrelated.example/private-booking', retrievedAt: '2026-11-10', status: 'verified' as const }],
    places: [{ id: 'museum', name: 'Museum Kyoto branch', localizedName: '京都本店', locationLabel: 'Kyoto centre', city: 'Kyoto', category: 'museum', priority: 'preferred' as const,
      coordinates: [35, 135] as [number, number], officialUrl: 'https://museum.example/kyoto', whyWorthIt: 'Private personal preferences', plan: 'Route details irrelevant to photos', evidence: [{ sourceId: 'museum-source', status: 'verified' as const }] }] };
}

function oldPhotoPrompt(input: ReturnType<typeof photoInput>): string {
  const { sources: _sources, places, ...request } = input;
  return buildSkillImageEnrichmentPrompt({ ...request, batch: { id: 'planned-place-images', scopeLabel: input.scopeLabel } }, {
    id: 'planned-place-images', scopeLabel: input.scopeLabel, completedAt: input.completedAt,
    sources: [], places: places.map(place => ({ ...place, sourceUrls: [] })),
    events: [], relationships: [], localFoods: [], localProducts: [], experienceThemes: [], travelTips: [], actionRequirements: []
  });
}

test('MAH image-only prompt is compact, source-bound and excludes the whole trip/profile', () => {
  const input = photoInput(), prompt = buildMahImageOnlyPrompt(input), old = oldPhotoPrompt(input);
  assert.ok(Buffer.byteLength(prompt) < Buffer.byteLength(old) / 2, `${Buffer.byteLength(prompt)} vs ${Buffer.byteLength(old)}`);
  assert.ok(prompt.includes(input.places[0]!.officialUrl));
  assert.ok(prompt.includes(input.sources[0]!.url));
  assert.ok(prompt.includes('京都本店'));
  assert.ok(prompt.includes('[35,135]'));
  assert.match(prompt, /exact branch/);
  for (const unrelated of ['PRIVATE_USER_REQUEST', 'PRIVATE_NATIONALITY', 'private-booking', 'Route details irrelevant', 'Trip Blueprint generation policy', 'Profile context:', 'personality']) assert.equal(prompt.includes(unrelated), false, unrelated);
  assert.match(prompt, /sources, images, omitted/);
  assert.match(prompt, /sourceUrl/);
  const fieldOnly = { ...input, places: input.places.map(place => ({ ...place, evidence: [], fieldEvidence: [{ path: "officialUrl", status: "verified" as const, evidence: place.evidence }] })) };
  assert.ok(buildMahImageOnlyPrompt(fieldOnly).includes(input.sources[0]!.url));
  assert.match(prompt, /omit uncertain matches/);
  assert.ok(buildMahImageOnlyPrompt({ ...input, rejectedImageUrls: ["https://museum.example/broken.jpg"] }).includes("https://museum.example/broken.jpg"));
});

for (const changed of ["none", "place", "profile", "request"] as const) test(`legacy image prompt restores only after exact recomputation; changed=${changed}`, async () => {
  const f = await fixture();
  try {
    const input = photoInput(), identity = { version: 2 as const, phase: '图片初次补充', scope: `图片-${sha256(canonicalJson(input.places.map(place => place.id))).slice(0, 16)}`, round: 1 };
    const businessInput = { stageIdentity: identity, parserContext: { placeIds: input.places.map(place => place.id) }, prompt: oldPhotoPrompt(input), outputSchema: codexStrictOutputSchema(skillImageEnrichmentSchema), outputBusinessContract: 'landi.planned-place-image-enrichment.v1' };
    const template = f.mapping.request as Extract<MahStageRequest, { schemaVersion: 3 }>;
    const mapping = f.mappings.prepare({ generationKey: template.generationKey, operation: 'planned_place_image_enrichment', batchId: mahStageBatchId(identity),
      inputSha256: sha256(canonicalJson(businessInput)), expectedSubpath: MAH_STAGE_RESULT_SUBPATH, protocol: MAH_QUEUE_PROTOCOL, projectRoot: ROOT,
      preparedStatus: 'prepared', retryableTerminalStatuses: [], serializeRequest: canonicalJson, hashRequest: sha256,
      createRequest: ids => ({ ...template, ...ids, batchId: mahStageBatchId(identity), operation: 'planned_place_image_enrichment',
        input: { businessContract: 'landi.planned-place-image-enrichment-input.v1', sha256: sha256(canonicalJson(businessInput)), businessInput },
        execution: { preferredLanguage: input.profile.preferredLanguage, webSearch: true, maxRuntimeSeconds: 83,
          adaptiveProducerClockV1: { validatorNodePath: f.transport().admissionIdentity().validatorNodePath, artifactValidation: 'worktree_then_published_v1' },
          capabilityRequirements: ['structured_output', 'native_schema_constrained_generation', 'external_current_research', 'filesystem_write'] } }) }) as MahCarrierMapping;
    f.mock.setStatus('failed');
    await assert.rejects(f.transport().execute(mapping), { code: 'mah_task_failed' });
    const adapter = new MahBlueprintRuntimeAdapter({ mappings: f.mappings, transport: f.transport(), checkpoint: key => f.storage.getGenerationCarrierCheckpoint(key) });
    const { completedAt: _date, ...withoutDate } = input;
    const current = changed === 'place' ? { ...withoutDate, places: input.places.map(place => ({ ...place, name: 'Different museum' })) }
      : changed === 'profile' ? { ...withoutDate, profile: { ...input.profile, nationality: 'OTHER_PRIVATE_NATIONALITY' } }
      : changed === 'request' ? { ...withoutDate, request: 'Different original request' } : withoutDate;
    await assert.rejects(adapter.runWithGenerationContext({ generationKey: template.generationKey, proposalRef: template.proposalRef, skillLineage: template.skillLineage },
      () => adapter.runWithStageContext({ phase: identity.phase, round: 1 }, () => adapter.generatePlannedPlaceImageEnrichment({ ...current, timeoutMs: 480_000 }))), { code: changed !== 'none' ? 'mah_request_conflict' : 'mah_task_failed' });
    assert.equal(f.mappings.getByTaskId(mapping.carrierTaskId)!.requestJson, mapping.requestJson);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally { await f.close(); }
});

test('compact image submission retains and actually runs the full result validator', async () => {
  const f = await fixture();
  try {
    const input = photoInput();
    const run: MahCommandRunner = async (command, args, options) => {
      const response = await f.mock.run(command, args, options);
      if (args[1] !== 'submit') return response;
      const attachments = args.flatMap((arg, index) => arg === '--attach' ? [args[index + 1]!] : []);
      assert.equal(attachments.length, 3);
      const [requestPath, schemaPath, validatorPath] = attachments as [string, string, string];
      const requestRaw = await readFile(requestPath, 'utf8');
      assert.equal(requestRaw.includes('PRIVATE_USER_REQUEST'), false);
      assert.equal(requestRaw.includes('PRIVATE_NATIONALITY'), false);
      assert.ok(requestRaw.includes(input.sources[0]!.url));
      const request = JSON.parse(requestRaw) as MahStageRequest;
      const artifact = JSON.parse(f.mock.artifacts.get(request.carrierTaskId)!);
      artifact.payload = { sources: [], images: [], omitted: [{ placeId: input.places[0]!.id, reason: 'No confirmed exact-branch photo' }] };
      const raw = JSON.stringify(artifact);
      f.mock.artifacts.set(request.carrierTaskId, raw);
      const artifactPath = join(f.path, '..', 'photo-validator-candidate.json');
      await writeFile(artifactPath, raw);
      const validator = await readFile(validatorPath, 'utf8');
      assert.equal(validator, await readFile(new URL('../lib/mah-stage-validation/landi-validate-stage-result.cjs.txt', import.meta.url), 'utf8'));
      const output = execFileSync(process.execPath, ['--input-type=commonjs', '-', schemaPath, requestPath, artifactPath], { input: validator, encoding: 'utf8', timeout: 5_000 });
      assert.deepEqual(JSON.parse(output), { valid: true, schemaSha256: sha256(await readFile(schemaPath, 'utf8')), requestSha256: sha256(requestRaw), artifactSha256: sha256(raw) });
      const description = await readFile(args[args.indexOf('--description-file') + 1]!, 'utf8');
      assert.match(description, /不必逐行通读或搜索其完整实现/);
      assert.match(description, /生产与独立验收仍须实际运行规范命令/);
      assert.ok(description.includes('独立验收者须对最终工件再次运行同一附件校验器'));
      return response;
    };
    const adapter = new MahBlueprintRuntimeAdapter({ mappings: f.mappings, transport: f.transport(run), checkpoint: key => f.storage.getGenerationCarrierCheckpoint(key) });
    const result = await adapter.runWithGenerationContext({ generationKey: f.mapping.generationKey, proposalRef: f.mapping.request.proposalRef, skillLineage: f.mapping.request.skillLineage }, () => adapter.generatePlannedPlaceImageEnrichment(input));
    assert.equal(result.omitted.length, 1);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally { await f.close(); }
});

function imageFailureContext(f: Awaited<ReturnType<typeof fixture>>, adapter: MahBlueprintRuntimeAdapter, phase: string, round = 1) {
  const context = { generationKey: f.mapping.generationKey, proposalRef: f.mapping.request.proposalRef, skillLineage: f.mapping.request.skillLineage };
  const input = photoInput();
  return () => adapter.runWithGenerationContext(context, () => adapter.runWithStageContext({ phase, round }, () => adapter.generatePlannedPlaceImageEnrichment({ ...input, timeoutMs: 480_000 })));
}

test('publicly failed image tasks can be explicitly retried once in a bound new stage', async () => {
  const f = await fixture(); try {
    f.mock.setStatus('failed');
    f.mock.mutateShow(value => { value.task.observability.lifecycle.failed_at = value.task.updated_at; });
    const adapter = new MahBlueprintRuntimeAdapter({ mappings: f.mappings, transport: f.transport(), checkpoint: key => f.storage.getGenerationCarrierCheckpoint(key) });
    await assert.rejects(imageFailureContext(f, adapter, 'initial-photo')(), { code: 'mah_task_failed' });
    const old = f.mappings.listForGeneration(f.mapping.generationKey).find(mapping => mapping.operation === 'planned_place_image_enrichment')!;
    assert.equal(old.errorCode, 'mah_public_task_failed');
    await assert.rejects(imageFailureContext(f, adapter, 'automatic-next-photo')(), { code: 'mah_stage_predecessor_pending' });
    const intent = { version: 1 as const, targetPhase: 'explicit-photo', targetRound: 1,
      predecessors: [{ carrierTaskId: old.carrierTaskId, requestSha256: old.requestSha256 }] };
    const context = { generationKey: f.mapping.generationKey, proposalRef: f.mapping.request.proposalRef, skillLineage: f.mapping.request.skillLineage };
    const explicit = () => adapter.runWithGenerationContext(context, () => adapter.runWithFailedImageRetry(intent, imageFailureContext(f, adapter, intent.targetPhase)));
    await assert.rejects(explicit(), { code: 'mah_task_failed' });
    await assert.rejects(explicit(), { code: 'mah_task_failed' });
    const photos = f.mappings.listForGeneration(f.mapping.generationKey).filter(mapping => mapping.operation === 'planned_place_image_enrichment');
    assert.equal(photos.length, 2);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 2);
    assert.equal(f.mappings.getByTaskId(old.carrierTaskId)!.requestJson, old.requestJson);
    const next = photos.find(mapping => mapping.carrierTaskId !== old.carrierTaskId)!;
    assert.deepEqual(next.request.input.businessInput.failedImageRetry, intent);
    await assert.rejects(adapter.runWithGenerationContext(context, () => adapter.runWithFailedImageRetry(intent, imageFailureContext(f, adapter, intent.targetPhase, 2))), { code: 'mah_image_retry_scope_mismatch' });
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 2);
  } finally { await f.close(); }
});

test('query-only recovery can upgrade an old failed image from a fresh exact public terminal projection', async () => {
  const f = await fixture(); try {
    f.mock.setStatus('failed');
    const adapter = new MahBlueprintRuntimeAdapter({ mappings: f.mappings, transport: f.transport(), checkpoint: key => f.storage.getGenerationCarrierCheckpoint(key) });
    await assert.rejects(imageFailureContext(f, adapter, 'old-image')(), { code: 'mah_task_failed' });
    const old = f.mappings.listForGeneration(f.mapping.generationKey).find(mapping => mapping.operation === 'planned_place_image_enrichment')!;
    assert.equal(old.errorCode, undefined);
    f.mock.mutateShow(value => { value.task.observability.lifecycle.failed_at = value.task.updated_at; });
    await f.transport().recoverActiveMappings(f.mapping.generationKey);
    const recovered = f.mappings.getByTaskId(old.carrierTaskId)!;
    assert.equal(recovered.errorCode, 'mah_public_task_failed');
    assert.equal(recovered.requestJson, old.requestJson);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    const proof = JSON.parse(recovered.errorMessage!);
    assert.equal(proof.carrierTaskId, old.carrierTaskId);
    assert.equal(proof.requestSha256, old.requestSha256);
  } finally { await f.close(); }
});

for (const fault of ['missing-time', 'wrong-request', 'duplicate-attachment', 'duplicate-wrong-size', 'duplicate-missing', 'future-time', 'reverse-time', 'invalid-revision'] as const) test(`failed image ${fault} cannot establish public retry eligibility`, async () => {
  const f = await fixture(); try {
    f.mock.setStatus('failed');
    f.mock.mutateShow(value => {
      const life = value.task.observability.lifecycle;
      if (fault !== 'missing-time') life.failed_at = value.task.updated_at;
      if (fault === 'wrong-request') value.task.attachments[0].sha256 = '0'.repeat(64);
      if (fault === 'duplicate-attachment') value.task.attachments.push({ ...value.task.attachments[0] });
      if (fault === 'duplicate-wrong-size') value.task.attachments.push({ ...value.task.attachments[0], size: 1 });
      if (fault === 'duplicate-missing') value.task.attachments.push({ ...value.task.attachments[0], read_state: 'missing' });
      if (fault === 'future-time') life.failed_at = '2999-01-01T00:00:00Z';
      if (fault === 'reverse-time') value.task.created_at = '2999-01-01T00:00:00Z';
      if (fault === 'invalid-revision') value.task.task_lifecycle_revision = -1;
    });
    const adapter = new MahBlueprintRuntimeAdapter({ mappings: f.mappings, transport: f.transport(), checkpoint: key => f.storage.getGenerationCarrierCheckpoint(key) });
    await assert.rejects(imageFailureContext(f, adapter, 'invalid-proof')(), { code: 'mah_task_failed' });
    const old = f.mappings.listForGeneration(f.mapping.generationKey).find(mapping => mapping.operation === 'planned_place_image_enrichment')!;
    assert.equal(old.errorCode, undefined);
    const context = { generationKey: f.mapping.generationKey, proposalRef: f.mapping.request.proposalRef, skillLineage: f.mapping.request.skillLineage };
    assert.throws(() => adapter.runWithGenerationContext(context, () => adapter.runWithFailedImageRetry({ version: 1, targetPhase: 'next', targetRound: 1, predecessors: [{ carrierTaskId: old.carrierTaskId, requestSha256: old.requestSha256 }] }, imageFailureContext(f, adapter, 'next'))), { code: 'mah_image_retry_invalid' });
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally { await f.close(); }
});


function lagInitialRootUpdate(value: any) {
  const running = value.task.observability.lifecycle.running_at;
  value.task.created_at = new Date(Date.parse(running) - 1_000).toISOString();
  value.task.updated_at = new Date(Date.parse(running) - 1).toISOString();
  value.task.trace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  value.task.last_request_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  value.task.active_request_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
}

test('initial running root-update lag rereads the same identity without recording a clock or reading an artifact early', async () => {
  const f = await fixture();
  try {
    f.mock.setStatus('running'); let shows = 0;
    f.mock.mutateShow(value => {
      shows++; lagInitialRootUpdate(value);
      if (shows < 3) {
        assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
        assert.equal(f.mock.commands.some(args => args[1] === 'context'), false);
      } else value.task.updated_at = value.task.observability.lifecycle.running_at;
      if (shows >= 4) value.task.last_request_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      if (shows === 2) {
        const current = f.mappings.getByTaskId(f.mapping.carrierTaskId)!;
        assert.equal(current.errorCode, 'mah_initial_running_update_lag');
        const diagnostic = JSON.parse(current.errorMessage!);
        assert.equal(diagnostic.reason, 'initial_running_update_lag');
        assert.equal(diagnostic.taskId, current.carrierTaskId);
        assert.ok(Date.parse(diagnostic.createdAt) <= Date.parse(diagnostic.updatedAt));
        assert.ok(Date.parse(diagnostic.updatedAt) < Date.parse(diagnostic.runningAt));
      }
    });
    const run: MahCommandRunner = async (command, args, options) => { if (args[1] === 'show' && shows >= 3) f.mock.setStatus('completed'); return f.mock.run(command, args, options); };
    const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV, run, schedulerWaitMs: 5000, pollIntervalMs: 1 });
    const result = await transport.execute(f.mapping);
    assert.equal(result.mapping.status, 'validated');
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    assert.equal(f.mock.commands.filter(args => args[1] === 'cancel').length, 0);
  } finally { await f.close(); }
});

test('persistent initial root-update lag has one fixed bounded reread window and retains diagnostic fields', async t => {
  const f = await fixture();
  try {
    f.mappings.claimSubmission(f.mapping.carrierTaskId, f.mapping.requestSha256);
    f.mock.setStatus('running'); let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    f.mock.mutateShow(value => { lagInitialRootUpdate(value); enter(); });
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
    const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV, run: f.mock.run, schedulerWaitMs: 100, pollIntervalMs: 1 });
    const pending = transport.execute(f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping);
    const rejected = assert.rejects(pending, { code: 'mah_task_lifecycle_unverified' });
    await entered; await nextTurn();
    t.mock.timers.tick(100);
    await rejected;
    const saved = f.mappings.getByTaskId(f.mapping.carrierTaskId)!;
    assert.equal(saved.runningAt, undefined);
    assert.equal(saved.cancelRequestedAt, undefined);
    assert.equal(saved.errorCode, 'mah_initial_running_update_lag');
    assert.ok(JSON.parse(saved.errorMessage!).updatedAt);
    assert.ok(f.mock.commands.every(args => args[1] === 'show'));
  } finally { await f.close(); }
});

for (const fault of ['trace', 'request', 'active-request', 'project', 'task', 'completed', 'malformed', 'future', 'created-after-updated', 'future-first-event', 'lifecycle-created-after-running', 'first-event-before-running'] as const) test(`initial root-update reread refuses ${fault} conflict`, async () => {
  const f = await fixture();
  try {
    f.mock.setStatus('running'); let shows = 0;
    f.mock.mutateShow(value => {
      shows++; lagInitialRootUpdate(value);
      if (shows < 2) return;
      if (fault === 'trace') value.task.trace_id = 'other-trace';
      if (fault === 'request') value.task.last_request_id = 'other-request';
      if (fault === 'active-request') value.task.active_request_id = 'other-request';
      if (fault === 'project') value.task.root_dir = '/other-project';
      if (fault === 'task') value.task.task_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      if (fault === 'completed') value.task.status = 'completed';
      if (fault === 'malformed') value.task.updated_at = 'bad-time';
      if (fault === 'future') value.task.observability.lifecycle.running_at = new Date(Date.now() + 60_000).toISOString();
      if (fault === 'created-after-updated') value.task.created_at = value.task.observability.lifecycle.running_at;
      if (fault === 'future-first-event') value.task.observability.lifecycle.first_event_at = new Date(Date.now() + 60_000).toISOString();
      if (fault === 'lifecycle-created-after-running') value.task.observability.lifecycle.created_at = new Date(Date.parse(value.task.observability.lifecycle.running_at) + 1).toISOString();
      if (fault === 'first-event-before-running') value.task.observability.lifecycle.first_event_at = value.task.created_at;
    });
    const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV, run: f.mock.run, schedulerWaitMs: 5000, pollIntervalMs: 1 });
    const code = fault === 'project' ? 'mah_task_project_mismatch' : fault === 'task' ? 'mah_task_projection_invalid'
      : ['trace', 'request', 'active-request'].includes(fault) ? 'mah_task_lifecycle_conflict' : 'mah_task_lifecycle_unverified';
    await assert.rejects(transport.execute(f.mapping), { code });
    assert.equal(f.mock.commands.filter(args => args[1] === 'show').length, 2);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
    assert.equal(f.mock.commands.filter(args => ['context','cancel'].includes(args[1]!)).length, 0);
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
  } finally { await f.close(); }
});

test('root-update lag cannot reset a previously persisted running clock', async () => {
  const f = await fixture();
  try {
    f.mappings.claimSubmission(f.mapping.carrierTaskId, f.mapping.requestSha256);
    f.mock.setStatus('running'); f.mock.mutateShow(lagInitialRootUpdate);
    // Use the same original public running_at; only the root updated_at regresses.
    const first = JSON.parse((await f.mock.run('test', ['task','show',f.mapping.carrierTaskId,'--cwd',ROOT,'--format','json'], { cwd: ROOT, env: ENV, timeoutMs: 1000 })).stdout);
    f.mappings.recordRunningAt(f.mapping.carrierTaskId, first.task.observability.lifecycle.running_at);
    const original = f.mappings.getByTaskId(f.mapping.carrierTaskId)!.runningAt;
    await assert.rejects(f.transport().execute(f.mappings.getByTaskId(f.mapping.carrierTaskId) as MahCarrierMapping), { code: 'mah_task_lifecycle_unverified' });
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, original);
    assert.equal(f.mock.commands.filter(args => args[1] === 'cancel').length, 0);
  } finally { await f.close(); }
});


for (const field of ['trace_id', 'last_request_id', 'active_request_id'] as const) test(`queued regression cannot release the initial update-lag identity pin: ${field}`, async () => {
  const f = await fixture();
  try {
    f.mock.setStatus('running'); let shows = 0;
    f.mock.mutateShow(value => {
      shows++; lagInitialRootUpdate(value);
      if (shows === 2) value.task.status = 'queued';
      if (shows >= 3) {
        value.task.updated_at = value.task.observability.lifecycle.running_at;
        value.task[field] = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      }
    });
    const transport = new MahCliTransport({ mahProjectRoot: ROOT, store: f.mappings, environment: ENV, run: f.mock.run, schedulerWaitMs: 5000, pollIntervalMs: 1 });
    await assert.rejects(transport.execute(f.mapping), { code: 'mah_task_lifecycle_conflict' });
    assert.equal(f.mock.commands.filter(args => args[1] === 'show').length, 3);
    assert.equal(f.mappings.getByTaskId(f.mapping.carrierTaskId)?.runningAt, undefined);
    assert.equal(f.mock.commands.filter(args => ['context','cancel'].includes(args[1]!)).length, 0);
    assert.equal(f.mock.commands.filter(args => args[1] === 'submit').length, 1);
  } finally { await f.close(); }
});
