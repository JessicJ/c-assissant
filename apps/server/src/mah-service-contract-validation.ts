import {keys,row,text,int,time,one,same,hash,blocked,reject} from './mah-preflight-values.js';
/** Pure consistency check. An input claiming verified ownership is NOT trusted public evidence. */
export function preflightMahService(input:{action:unknown;receipt:unknown;projection:unknown;currentRevision:number;beforeState:'running'|'stopped'|'unregistered';projectRoot:string;now:string;maxAgeMs:number}){
 const a=keys(input.action,['schemaVersion','kind','requestId','serviceId','projectRoot','componentId','launcherContractVersion','action','expectedRevision','desiredState']);
 same(a.schemaVersion,1);same(a.kind,'landi_mah_service_action');text(a.requestId);same(a.serviceId,'landi');same(a.projectRoot,text(input.projectRoot));same(a.componentId,'c-assissant');int(a.launcherContractVersion,1);same(int(a.expectedRevision),int(input.currentRevision),'stale_revision');
 one(a.action,['register','start','stop','reconcile','unregister']);one(a.desiredState,['running','stopped']);
 if(a.action==='start')same(a.desiredState,'running');if(['stop','unregister','register'].includes(String(a.action)))same(a.desiredState,'stopped');
 const r=keys(input.receipt,['schemaVersion','kind','requestId','requestSha256','transitionId','revision','status','beforeState','desiredState','ownership','projectionSha256','observedAt']);
 same(r.schemaVersion,1);same(r.kind,'landi_mah_service_receipt');same(r.requestId,a.requestId);same(r.requestSha256,hash(a),'request_digest_mismatch');text(r.transitionId);int(r.revision,1);same(r.beforeState,input.beforeState);same(r.desiredState,a.desiredState);one(r.status,['accepted','completed','rejected','unknown']);one(r.ownership,['verified','conflict','unknown']);
 const now=time(input.now),age=int(input.maxAgeMs);const observed=time(r.observedAt);if(observed>now||now-observed>age)reject('stale_observation');
 if(r.ownership==='conflict')reject('ownership_conflict');
 if(r.status!=='completed')return blocked(r.status==='unknown'?'reconcile_only':'service_not_completed');
 if(Number(r.revision)<=input.currentRevision)reject('stale_revision');same(r.ownership,'verified');
 const p=keys(input.projection,['schemaVersion','kind','serviceId','project','desiredState','observedState','supervisor','instance','readiness','persistence','observedAt'],['transition']);
 same(r.projectionSha256,hash(p),'projection_digest_mismatch');same(p.schemaVersion,1);same(p.kind,'landi_mah_background_runtime_projection');same(p.serviceId,a.serviceId);same(p.desiredState,a.desiredState);
 const project=keys(p.project,['projectRoot','componentId','launcherContractVersion']);for(const k of Object.keys(project))same(project[k],a[k]);
 const seen=time(p.observedAt);if(seen>now||now-seen>age||seen<observed)reject('stale_projection');
 const supervisor=keys(p.supervisor,['owner','registrationId','reconcileGeneration','restartPolicy','restartCount'],['backoffUntil','lastExit']);same(supervisor.owner,'mah_scheduler');text(supervisor.registrationId);int(supervisor.reconcileGeneration);int(supervisor.restartCount);one(supervisor.restartPolicy,['bounded_backoff','never']);
 if(supervisor.backoffUntil!==undefined)time(supervisor.backoffUntil);
 if(supervisor.lastExit!==undefined&&supervisor.lastExit!==null){const exit=keys(supervisor.lastExit,['observedAt','classification'],['exitCode','signal']);time(exit.observedAt);one(exit.classification,['clean','crash','ownership_conflict','startup_failure','unknown']);if(exit.exitCode!==undefined)int(exit.exitCode,-2147483648);if(exit.signal!==undefined)text(exit.signal);}
 const ready=keys(p.readiness,['ownership','server','homepage','workspaceApi'],['failureCode']);for(const k of ['ownership','server','homepage','workspaceApi'])one(ready[k],[true,false]);if(ready.failureCode!==undefined)text(ready.failureCode);
 const persist=keys(p.persistence,['desiredStatePersisted','recoveredAfterMahRestart','recoveredAfterHostRestart'],['lastRecoveryAt']);for(const k of ['desiredStatePersisted','recoveredAfterMahRestart','recoveredAfterHostRestart'])one(persist[k],[true,false]);same(persist.desiredStatePersisted,true);if(persist.lastRecoveryAt!==undefined)time(persist.lastRecoveryAt);
 if(a.desiredState==='stopped'){same(p.observedState,'stopped');same(p.instance,null);}else{
 same(p.observedState,'ready');for(const k of ['ownership','server','homepage','workspaceApi'])same(ready[k],true);
 const instance=keys(p.instance,['instanceId','receiptId','pid','processStartIdentity','port','healthProtocolVersion','healthProofSha256','startedAt']);for(const k of ['instanceId','receiptId','processStartIdentity'])text(instance[k]);int(instance.pid,1);int(instance.port,1);if(Number(instance.port)>65535)reject('invalid_port');int(instance.healthProtocolVersion,1);if(!/^[a-f0-9]{64}$/.test(text(instance.healthProofSha256)))reject('invalid_digest');if(time(instance.startedAt)>seen)reject('invalid_instance_time');
 }
 // Optional in legacy projection, mandatory here to correlate a completed action.
 if(p.transition===undefined)return blocked('public_transition_missing');
 const transition=keys(p.transition,['transitionId','action','idempotent','acceptedAt']);same(transition.transitionId,r.transitionId);same(transition.action,a.action);same(transition.idempotent,true);if(time(transition.acceptedAt)>observed)reject('invalid_transition_time');
 // Legacy projection cannot prove unregister. Never infer it from stopped alone.
 if(a.action==='unregister')return blocked('public_unregistration_unverified');
 return blocked('public_service_receipt_unverified');
}
