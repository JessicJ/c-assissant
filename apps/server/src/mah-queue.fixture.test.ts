import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { canonicalJson, sha256, mahOperationContracts, type MahStageRequest } from './mah-generation-contract.js';
import type { MahCommandRunner, MahCommandResult } from './mah-cli-transport.js';
export const QUEUE_NOW = new Date().toISOString();
export const json = (value: unknown): MahCommandResult => ({ code:0,stdout:JSON.stringify(value),stderr:'' });
/** 仅供离线故障注入，绝不启动进程或访问网络。 */
export function queueRunner(payloadFor: (request: MahStageRequest) => Record<string, unknown> = () => ({ accepted:true }), root = '/tmp/landi-mah-contract-test') {
  const requests = new Map<string, MahStageRequest>();
  const rawRequests = new Map<string,string>();
  const artifacts = new Map<string,string>();
  const commands: string[][] = [];
  let status = 'completed';
  let submitResponse: MahCommandResult | undefined;
  let mutateShow: ((value: any) => void) | undefined;
  let mutateResult: ((value: any) => void) | undefined;
  let mutateList: ((value: any[]) => unknown) | undefined;
  let showFailure: MahCommandResult | undefined;
  const run: MahCommandRunner = async (_command,args) => {
    commands.push([...args]);
    assert.equal(args[0],'task');
    assert.ok(['submit','show','context','cancel'].includes(args[1]!));
    assert.equal(args[args.indexOf('--cwd')+1],root);
    if(args[1]==='submit') {
      const path=args[args.indexOf('--attach')+1]!;
      const raw=await readFile(path,'utf8');
      assert.equal((await stat(path)).mode & 0o777,0o600);
      assert.equal((await stat(args[args.indexOf('--description-file')+1]!)).mode & 0o777,0o600);
      const request=JSON.parse(raw) as MahStageRequest;
      assert.equal(raw,canonicalJson(request));
      assert.equal(request.schemaVersion,3);
      assert.ok(args.includes('--no-write'));
      assert.ok(!args.includes('--write')&&!args.includes('--personal-os-slot'));
      requests.set(request.carrierTaskId,request);rawRequests.set(request.carrierTaskId,raw);
      const result:any={schemaVersion:2,kind:'landi_generation_stage_result',requestId:request.requestId,
        carrierTaskId:request.carrierTaskId,generationKey:request.generationKey,proposalRef:request.proposalRef,skillLineage:request.skillLineage,
        operation:request.operation,...(request.batchId?{batchId:request.batchId}:{}),attempt:request.attempt,
        inputSha256:request.input.sha256,requestSha256:sha256(raw),parentCheckpoint:request.parentCheckpoint,outcome:'succeeded',
        businessContract:mahOperationContracts(request.operation).output,payload:payloadFor(request),diagnostics:[],
        provenance:{carrier:'mah_task',taskId:request.carrierTaskId,agentId:'claude-code',modelId:'受控模型',startedAt:QUEUE_NOW,completedAt:QUEUE_NOW}};
      mutateResult?.(result);artifacts.set(request.carrierTaskId,JSON.stringify(result));
      return submitResponse??json({ok:true,task_id:request.carrierTaskId,title:args[args.indexOf('--title')+1],
        audit_ref:`.mah/tasks/${request.carrierTaskId}/audit/audit.ndjson`,events_ref:`.mah/tasks/${request.carrierTaskId}/stream.jsonl`,result_ref:{type:'none'}});
    }
    const id=args[2]!;
    if(args[1]==='cancel') {status='cancelled';return json({ok:true,task_id:id});}
    if(args[1]==='show') {
      if(showFailure)return showFailure;
      const raw=rawRequests.get(id)??'';
      const value:any={ok:true,task:{task_id:id,root_dir:root,status,orchestration_topology:"direct",task_lifecycle_revision:6,
        agent:'claude-code',direct_runtime_model_id:'受控模型',model_routing:{selected:{agent_id:'claude-code',model_family_id:'测试模型族',runtime_profile:'claude-cli'}},
        attachments:[{sha256:sha256(raw),size:Buffer.byteLength(raw),read_state:'present'}],created_at:QUEUE_NOW,updated_at:QUEUE_NOW,
        observability:{lifecycle:{running_at:QUEUE_NOW,completed_at:QUEUE_NOW,last_status:status}}}};
      mutateShow?.(value);return json(value);
    }
    const raw=artifacts.get(id)??'';
    if(args.includes('--read'))return json({content:raw});
    const rows=[{subpath:'artifacts/landi-stage-result.json',size:Buffer.byteLength(raw)}];return json(mutateList?.(rows)??rows);
  };
  return {run,commands,requests,rawRequests,artifacts,setStatus:(s:string)=>{status=s;},
    setSubmitResponse:(r:MahCommandResult)=>{submitResponse=r;},setShowFailure:(r:MahCommandResult)=>{showFailure=r;},
    mutateShow:(f:(value:any)=>void)=>{mutateShow=f;},mutateResult:(f:(value:any)=>void)=>{mutateResult=f;},mutateList:(f:(value:any[])=>unknown)=>{mutateList=f;}};
}
