import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { buildMahReadinessReport, type MahDiagnosticItem } from './mah-readiness-report.js';
import { parseMahScheduleList, parseMahScheduleRuns } from './mah-schedule-readback.js';

const CLI = '/Applications/MAH.app/Contents/Resources/bin/mah';
const LIMIT = 1024 * 1024;
const TIMEOUT = 3000;
const TTL = 15000;
const MAX_AGE = 60000;
const MAX_SCHEDULES = 3;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Result = { code: number; stdout: string };
export type ReadonlySnapshotRunner = (args: readonly string[], projectRoot: string) => Promise<Result>;
function validateArgs(args: readonly string[], root: string): void {
  if (!isAbsolute(root)) throw new Error('snapshot_project_invalid');
  const list = ['task','schedule','list','--cwd',root,'--format','json'];
  const runs = ['task','schedule','runs','--cwd',root,'--id',args[6] ?? '', '--limit','20','--format','json'];
  if (JSON.stringify(args) !== JSON.stringify(list) && !(UUID.test(args[6] ?? '') && JSON.stringify(args) === JSON.stringify(runs))) throw new Error('snapshot_command_rejected');
}
/** Fixed executable, fixed read commands, no shell, no caller-supplied command/flags. */
export const runReadonlySnapshot: ReadonlySnapshotRunner = (args, root) => {
  validateArgs(args,root);
  return new Promise((resolve,reject) => {
    const child = spawn(CLI,[...args],{cwd:root,shell:false,stdio:['ignore','pipe','pipe']});
    child.stdout.setEncoding('utf8');
    let size=0, stdout='', settled=false;
    const finish = (error?: string, code=1) => {
      if(settled)return; settled=true;clearTimeout(timer);
      if(error){child.kill('SIGKILL');reject(new Error(error));}else resolve({code,stdout});
    };
    const timer=setTimeout(()=>finish('snapshot_timeout'),TIMEOUT);
    child.stdout.on('data',(chunk:string)=>{size+=Buffer.byteLength(chunk);if(size>LIMIT)finish('snapshot_output_too_large');else stdout+=chunk;});
    child.stderr.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>LIMIT)finish('snapshot_output_too_large');});
    child.on('error',()=>finish('snapshot_query_failed'));
    child.on('close',code=>finish(undefined,code??1));
  });
};
const safeFailures=new Set(['snapshot_timeout','snapshot_output_too_large','snapshot_stale','snapshot_project_invalid','snapshot_command_rejected','snapshot_input_invalid']);
function failure(error:unknown):string{return error instanceof Error&&safeFailures.has(error.message)?error.message:'snapshot_query_failed';}
/** Lazy request-time collection; no timers except bounded command timeout, no persistence. */
export function createMahReadonlySnapshots(options:{projectRoot:()=>string;run?:ReadonlySnapshotRunner;now?:()=>number}) {
  const now=options.now??Date.now, run=options.run??runReadonlySnapshot;
  let cached: Awaited<ReturnType<typeof collect>> | undefined;
  let cachedAt=0;
  let pending:Promise<Awaited<ReturnType<typeof collect>>>|undefined;
  async function query(args:string[],root:string):Promise<string>{
    validateArgs(args,root);
    const result=await run(args,root);
    if(result.code!==0)throw new Error('snapshot_query_failed');
    if(Buffer.byteLength(result.stdout)>LIMIT)throw new Error('snapshot_output_too_large');
    return result.stdout;
  }
  async function collect(){
    const report=buildMahReadinessReport();
    const source={kind:'mah_public_cli' as const,commands:[] as string[],collectedAt:new Date(now()).toISOString(),maxAgeMs:MAX_AGE,cacheTtlMs:TTL,projectScopeVerified:false,snapshotGeneratedAt:null as string|null,queriedSchedules:0,omittedSchedules:0,observedRuns:0,historyLimitPerSchedule:20};
    const set=(id:MahDiagnosticItem['id'],status:MahDiagnosticItem['status'],code:string)=>{const item=report.items.find(i=>i.id===id)!;item.status=status;item.code=code;};
    try{
      const root=options.projectRoot();
      source.commands.push('schedule list');
      const raw=await query(['task','schedule','list','--cwd',root,'--format','json'],root);
      let list:ReturnType<typeof parseMahScheduleList>;
      try{list=parseMahScheduleList(raw,root);}catch{throw new Error('snapshot_input_invalid');}
      const age=now()-Date.parse(String(list.observedAt));
      if(age<0||age>MAX_AGE)throw new Error('snapshot_stale');
      source.projectScopeVerified=true;source.snapshotGeneratedAt=String(list.observedAt);
      const ids=list.schedules.filter(s=>s.registrationState==='registered').map(s=>String(s.scheduleId));
      if(ids.some(id=>!UUID.test(id)))throw new Error('snapshot_input_invalid');
      set('schedule_readback','consistent_unverified',ids.length?'public_schedule_revision_unavailable':'no_schedule_registrations');
      set('schedule_runs','not_assessed',ids.length?'runs_not_queried':'runs_not_queried_no_registrations');
      source.omittedSchedules=Math.max(0,ids.length-MAX_SCHEDULES);
      let issue:string|undefined;
      for(const id of ids.slice(0,MAX_SCHEDULES)){
        source.commands.push('schedule runs');
        try{
          const rawRuns=await query(['task','schedule','runs','--cwd',root,'--id',id,'--limit','20','--format','json'],root);
          try{source.observedRuns+=parseMahScheduleRuns(rawRuns,root,id).runs.length;}catch{throw new Error('snapshot_input_invalid');}
          source.queriedSchedules++;
        }catch(error){issue??=failure(error);}
      }
      if(ids.length)set('schedule_runs',issue?'invalid':'consistent_unverified',issue??(source.omittedSchedules?'snapshot_partial':source.observedRuns?'public_execution_receipt_unverified':'no_run_records'));
    }catch(error){set('schedule_readback','invalid',failure(error));set('schedule_runs','not_assessed','runs_not_queried');}
    if(source.snapshotGeneratedAt && (now()-Date.parse(source.snapshotGeneratedAt)>MAX_AGE || now()<Date.parse(source.snapshotGeneratedAt))){
      set('schedule_readback','invalid','snapshot_stale');
      if(source.commands.includes('schedule runs'))set('schedule_runs','invalid','snapshot_stale');
    }
    return {...report,evidenceMode:'public_readonly_snapshots' as const,source};
  }
  return async () => {
    const elapsed=now()-cachedAt;
    if(cached&&elapsed>=0&&elapsed<TTL){
      const generated=cached.source.snapshotGeneratedAt;
      if(!generated || now()-Date.parse(generated)<=MAX_AGE && now()>=Date.parse(generated))return structuredClone(cached);
    }
    if(!pending)pending=collect().then(value=>{cached=value;cachedAt=now();return value;}).finally(()=>{pending=undefined;});
    return structuredClone(await pending);
  };
}
