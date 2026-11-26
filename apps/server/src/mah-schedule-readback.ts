import { keys, row, text, int, time, one, same, parse, reject, zone } from './mah-preflight-values.js';
const statuses=['queued','running','completed','failed','cancelled','yielded','skipped'];
function array(v: unknown): unknown[] {if(!Array.isArray(v)) reject('invalid_array');return v;}
function unique(values: unknown[]): void {if(new Set(values).size!==values.length)reject('duplicate_identity');}
function trigger(v: unknown): void {
 const r=row(v);
 switch(r.kind){
 case 'manual': keys(r,['kind']);break;
 case 'cron': keys(r,['kind','expression','timezone']);text(r.expression);zone(r.timezone);break;
 case 'interval':keys(r,['kind','interval_ms']);int(r.interval_ms,1);break;
 case 'defer_until':keys(r,['kind','run_at']);time(r.run_at);break;
 case 'after':keys(r,['kind','depends_on']);if(!array(r.depends_on).length)reject('missing_dependencies');array(r.depends_on).forEach(text);break;
 default:reject('unknown_trigger');
 }
}
function nullableTime(v:unknown):void {if(v!==null)time(v);}
/** Parses public JSON only. Missing revision/receipt is never inferred from metadata or timestamps. */
export function parseMahScheduleList(raw: string, projectRoot: string) {
 const e=keys(parse(raw),['schema_version','ok','project_root','generated_at','count','schedules']);same(e.schema_version,1);same(e.ok,true);same(e.project_root,text(projectRoot));time(e.generated_at);
 const rows=array(e.schedules);same(int(e.count),rows.length);
 const schedules=rows.map(value=>{
 const r=keys(value,['scheduled_task_id','registration_state','title','description','schedule','attachments','status','priority','meta','updated_at','next_fire_state','next_fire_at','last_run_state','last_run','run_counts','runtime_recovery']);text(r.scheduled_task_id);
 one(r.registration_state,['missing','registered']);
 if(r.registration_state==='missing'){
 for(const k of ['title','description','schedule','attachments','status','priority','meta','updated_at','next_fire_at','last_run','run_counts','runtime_recovery'])same(r[k],null);
 same(r.next_fire_state,'not_registered');same(r.last_run_state,'not_registered');
 }else{
 text(r.title);text(r.description);trigger(r.schedule);array(r.attachments);row(r.meta);int(r.priority,-155);time(r.updated_at);
 one(r.status,['waiting','queued','running','paused','completed','failed','aborted','yielded']);one(r.next_fire_state,['available','no_next_fire']);nullableTime(r.next_fire_at);same(r.next_fire_state==='available',r.next_fire_at!==null);
 one(r.last_run_state,['available','no_run_records']);same(r.last_run_state==='available',r.last_run!==null);
 if(r.last_run!==null){const l=keys(r.last_run,['run_id','trigger','status','scheduled_for','started_at','finished_at','duration_ms','error_message']);text(l.run_id);one(l.trigger,['cron','interval','defer','after','manual','recovery']);one(l.status,statuses);time(l.scheduled_for);nullableTime(l.started_at);nullableTime(l.finished_at);if(l.duration_ms!==null)int(l.duration_ms);if(l.error_message!==null)text(l.error_message);}
 const c=keys(r.run_counts,['total','succeeded','failed','cancelled','skipped']);Object.values(c).forEach(v=>int(v));if(['succeeded','failed','cancelled','skipped'].reduce((n,k)=>n+Number(c[k]),0)>Number(c.total))reject('invalid_counts');
 if(r.runtime_recovery!==null){const x=keys(r.runtime_recovery,['code','action']);same(x.code,'scheduled_task_runtime_invalid');same(x.action,'start_schedule');}
 }
 return {scheduleId:r.scheduled_task_id,status:r.status,registrationState:r.registration_state,nextFireAt:r.next_fire_at,revision:null,executionVerified:false as const};
 });unique(schedules.map(s=>s.scheduleId));return {projectRoot,observedAt:e.generated_at,schedules};
}
export function parseMahScheduleRuns(raw: string, projectRoot: string, scheduleId: string) {
 const e=keys(parse(raw),['ok','project_root','scheduled_task_id','count','runs']);same(e.ok,true);same(e.project_root,text(projectRoot));same(e.scheduled_task_id,text(scheduleId));
 const rows=array(e.runs);same(int(e.count),rows.length);
 const runs=rows.map(value=>{
 const r=keys(value,['run_id','scheduled_task_id','project_root','trigger','status','scheduled_for','enqueued_at'],['started_at','finished_at','duration_ms','scheduler_task_id','error_message','trace_id','agentMinutesUsage']);
 text(r.run_id);same(r.project_root,projectRoot);same(r.scheduled_task_id,scheduleId);one(r.trigger,['cron','interval','defer','after','manual','recovery','first_build_skip']);one(r.status,statuses);time(r.scheduled_for);time(r.enqueued_at);
 for(const k of ['started_at','finished_at'])if(r[k]!==undefined)time(r[k]);
 if(r.started_at!==undefined && r.finished_at!==undefined && time(r.finished_at)<time(r.started_at))reject('invalid_time_order');
 if(r.duration_ms!==undefined)int(r.duration_ms);for(const k of ['scheduler_task_id','error_message','trace_id'])if(r[k]!==undefined)text(r[k]);
 // Usage is deliberately not used as execution or business provenance.
 if(r.agentMinutesUsage!==undefined)row(r.agentMinutesUsage);
 return {runId:r.run_id,scheduleId,status:r.status,scheduledFor:r.scheduled_for,taskId:r.scheduler_task_id??null,scheduleRevision:null,requestId:null,resultSha256:null,businessResultVerified:false as const};
 });unique(runs.map(r=>r.runId));return {projectRoot,scheduleId,runs};
}
