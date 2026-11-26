import {keys,row,text,int,time,one,same,scope,zone,blocked,reject,hash} from './mah-preflight-values.js';
/** Consistency only: no public verifier exists; even consistent input never authorizes execution. */
export function preflightMahSchedule(input: {
 definition:unknown; run:unknown; frozenRun:unknown; currentScope:unknown; now:string;
 expectedRequestSha256:string; expectedResultSha256:string;
}) {
 const d=keys(input.definition,['schemaVersion','kind','owner','scheduleId','revision','scope','operation','desiredState','timeZone','validFrom','expiresAt','trigger','policy','authority']);
 same(d.schemaVersion,1);same(d.kind,'landi_mah_schedule');same(d.owner,'mah');text(d.scheduleId);int(d.revision,1);scope(d.scope);same(d.scope,scope(input.currentScope),'stale_scope');
 one(d.operation,['travel_attention','email_research','email_timing','email_delivery']);one(d.desiredState,['enabled','paused','retired']);if(d.desiredState!=='enabled')reject('schedule_not_enabled');zone(d.timeZone);
 const begin=time(d.validFrom),end=time(d.expiresAt),now=time(input.now);if(begin>=end||now<begin||now>=end)reject('schedule_outside_validity');
 const t=row(d.trigger);
 if(t.kind==='interval'){keys(t,['kind','seconds']);int(t.seconds,1);}else if(t.kind==='cron'){keys(t,['kind','expression']);text(t.expression);}else {keys(t,['kind','at']);same(t.kind,'once');const at=time(t.at);if(at<begin||at>=end)reject('trigger_outside_validity');}
 same(d.policy,{overlap:'forbid',missed:'skip_expired_coalesce_latest',uncertainDelivery:'reconcile_only',scopeChange:'invalidate_before_effect',dst:'skip_gap_run_once_fold'},'unsupported_policy');
 same(d.authority,d.operation==='email_delivery'?'approved_email_delivery':'artifact_only','authority_mismatch');
 const r=keys(input.run,['schemaVersion','kind','scheduleId','scheduleRevision','occurrenceId','requestId','scope','scheduledFor','expiresAt','status','executionReceipt']);
 same(r.schemaVersion,1);same(r.kind,'landi_mah_schedule_run');same(r.scheduleId,d.scheduleId);same(r.scheduleRevision,d.revision,'stale_revision');scope(r.scope);same(r.scope,d.scope,'stale_scope');text(r.occurrenceId);text(r.requestId);
 // Frozen identity supplied by a future persistence layer; not invented from readback.
 const frozen=row(input.frozenRun);
 for(const k of ['scheduleId','scheduleRevision','occurrenceId','requestId','scope','scheduledFor','expiresAt'])same(r[k],frozen[k],'retry_identity_changed');
 const at=time(r.scheduledFor),expires=time(r.expiresAt);if(at<begin||at>=end||expires> end||expires<=at||now<at||now>=expires)reject('run_outside_validity');
 if(t.kind==='once')same(at,time(t.at),'trigger_identity_mismatch');
 one(r.status,['queued','running','succeeded','failed','skipped','cancelled','uncertain']);
 if(r.status==='uncertain')return blocked('reconcile_only');
 if(r.status!=='succeeded')return blocked('result_not_succeeded');
 if(r.executionReceipt===null)return blocked('public_execution_receipt_missing');
 const receipt=keys(r.executionReceipt,['taskId','requestSha256','resultSha256','receiptRef']);text(receipt.taskId);text(receipt.receiptRef);
 for(const k of ['requestSha256','resultSha256'])if(!/^[a-f0-9]{64}$/.test(text(receipt[k])))reject('invalid_digest');
 same(receipt.requestSha256,input.expectedRequestSha256,'request_digest_mismatch');same(receipt.resultSha256,input.expectedResultSha256,'result_digest_mismatch');
 return blocked('public_execution_receipt_unverified');
}
export function assertMahScheduleRetry(original:unknown,retry:unknown):void {
 // Reject any mutation, including policies and business time. Does not submit or retry.
 same(hash(original),hash(retry),'retry_identity_changed');
}
