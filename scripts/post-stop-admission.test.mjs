import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {DatabaseSync as NativeDatabase} from 'node:sqlite';
import {createSyntheticHistoryFixture} from './fixtures/readonly-mechanism.mjs';
const productionHistory=await import('../packages/storage/src/readonly-schema-admission.ts');
const root=fileURLToPath(new URL('../',import.meta.url));
const req=createRequire(root+'/apps/server/package.json'),ts=req('typescript');
const area=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'landi-post-stop-admission-check-')));fs.chmodSync(area,0o700);
const synthetic=createSyntheticHistoryFixture(join(area,'preserved'));
const snapshot=synthetic.databasePath;fs.chmodSync(snapshot,0o444);
const original=join(area,'fictional-original.sqlite');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const snapshotBefore=hash(snapshot);
const preserved=join(area,'preservation.json');
fs.writeFileSync(preserved,JSON.stringify({fixture:true,evidenceMode:'fixture_mechanism',status:'preserved',snapshotScope:'post_stop_file_set',sourceSqliteOpened:false,sourceUnchangedDuringCopy:true,fsync:true,darwinFullFsync:true,preservedDirectory:dirname(snapshot),sourceFiles:[{path:original,name:'fictional.sqlite',sha256:snapshotBefore}]}));
const preservationBefore=hash(preserved);
const forbidden=()=>{throw Error('External action or listener forbidden');};
const nativeListen=net.Server.prototype.listen;net.Server.prototype.listen=forbidden;
let opens=0,closes=0,seq=0;
const allowed=new Set();
const cache=new Map();
function load(input){const p=resolve(root,input);if(cache.has(p))return cache.get(p);const exports={};cache.set(p,exports);
 function require(n){
  if(n==='node:sqlite')return {DatabaseSync:class extends NativeDatabase{constructor(file,opts){assert.ok(allowed.has(file),'Only independent work copies may open');super(file,opts ?? {});opens++;}close(){super.close();closes++;}}};
  if(n==='node:child_process')return {spawn:forbidden,execFile:forbidden,execFileSync:forbidden,spawnSync:forbidden};
  if(n.startsWith('@c-assistant/')){const [pkg,...sub]=n.slice('@c-assistant/'.length).split('/');return load('packages/'+pkg+'/src/'+(sub.length?sub.join('/'):'index')+'.ts');}
  if(n.startsWith('.'))return load(resolve(dirname(p),n.replace(/\.js$/,'.ts')));
  return createRequire(p)(n);
 }
 let source=fs.readFileSync(p,'utf8');
 if(p===resolve(root,'packages/storage/src/readonly-schema-admission.ts')){const pattern=/export const reviewedHistorySchema = '[a-f0-9]{64}';/g;assert.equal([...source.matchAll(pattern)].length,1,'unique test-only schema constant seam');source=source.replace(pattern,`export const reviewedHistorySchema = '${synthetic.schemaSha256}';`);}
 source=source.replaceAll('import.meta.url',JSON.stringify(pathToFileURL(p).href));
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInThisContext('(function(exports,require,setInterval,clearInterval,fetch){'+code+'\n})',{filename:p})(exports,require,forbidden,forbidden,forbidden);return exports;
}
const storage=load('packages/storage/src/index.ts');
const history=load('packages/storage/src/readonly-schema-admission.ts');
const {loadGuardedStartupPolicy}=load('apps/server/src/guarded-startup-policy.ts');
function write(name,obj){const p=join(area,`${++seq}-${name}.json`);fs.writeFileSync(p,JSON.stringify(obj),{mode:0o600});return {path:p,sha256:hash(p)};}
function pin(p){return {path:p,sha256:hash(p)};}
const raw=write('fictional-raw-stop',{fixture:true,evidenceMode:'fixture_mechanism',status:'fictional_only'});
const stop=write('fictional-failed-stop',{fixture:true,status:'failed_stopped',evidence:[raw]}).path;
const exit=write('fictional-exit',{fixture:true,oldPidAbsent:true,managerDefinitionAbsent:true,disabledConfirmed:true,port8787Released:true,replacementProcessAbsentWithinScope:true,evidence:[raw]}).path;
const sealDir=join(area,'fictional-seal');fs.mkdirSync(sealDir);const seal=join(sealDir,'seal.json');fs.writeFileSync(seal,JSON.stringify({fixture:true,status:'sealed',snapshot:{path:join(sealDir,'never-opened.sqlite')}}));
const workVerification=write('fictional-work-verification',{fixture:true,status:'passed',schemaSha256:synthetic.schemaSha256,integrity:['ok']});
function inspect(file){const db=new NativeDatabase(file,{readOnly:true});assert.ok(allowed.has(file));try{return history.inspectReadonlyHistory(db);}finally{db.close();}}
function fixture(){
 const databasePath=join(area,`work-${++seq}.sqlite`);fs.copyFileSync(snapshot,databasePath);fs.chmodSync(databasePath,0o600);allowed.add(databasePath);
 const releases={};const manifests={};const envPath=join(area,`fictional-${seq}.env`);fs.writeFileSync(envPath,'# fictional configuration; never loaded\n',{mode:0o600});
 for(const role of ['candidate','rollback']){
  const release=join(area,`${role}-${++seq}`);fs.mkdirSync(release);
  const files=['apps/server/lib/index.js','packages/storage/lib/index.js','apps/web/dist/index.html','pnpm-lock.yaml'];
  for(const file of files){fs.mkdirSync(dirname(join(release,file)),{recursive:true});fs.writeFileSync(join(release,file),'Fictional metadata fixture; not an executable release');}
  const manifest={version:1,storageKeysSha256:'a'.repeat(64),mode:'guarded-workbench',projectRoot:release,databasePath,envPath,envSha256:hash(envPath),origin:'http://127.0.0.1:39971',schemaSha256:history.reviewedHistorySchema,files:files.map(path=>({path,sha256:hash(join(release,path))}))};
  const ref=write(role+'-manifest',manifest);manifests[role]=ref;
  releases[role]={mode:'guarded-workbench',artifactSha256:ref.sha256,dependenciesSha256:hash(join(release,'pnpm-lock.yaml')),storageKeysSha256:'a'.repeat(64),schemaSha256:manifest.schemaSha256,origin:manifest.origin,databasePath,configPath:envPath};
 }
 const record={version:1,purpose:'post_stop_guarded_workbench',scope:'post_stop_preserved_copy',fixture:true,originalDatabasePath:original,preserved:{path:snapshot,sha256:snapshotBefore},working:{path:databasePath,initialSha256:snapshotBefore,sha256:hash(databasePath)},candidate:releases.candidate,rollback:releases.rollback,preStopDrained:'unverified',gracefulExit:'unverified',externalOperationOutcomes:'unverified',productionExecutable:false,automaticResume:false,restoreDatabase:false,evidence:{stopFailure:pin(stop),exitConfirmation:pin(exit),preservation:pin(preserved),workVerification:workVerification,priorSeal:pin(seal),candidateManifest:manifests.candidate,rollbackManifest:manifests.rollback}};
 const f={record,databasePath,manifests};refresh(f);return f;
}
function refresh(f){const v=f.record;v.working.sha256=hash(f.databasePath);const facts=inspect(f.databasePath);history.assertReadonlyHistoryFacts(facts);
 v.evidence.compatibilityAudit=write('work-audit',{status:'passed',databasePath:f.databasePath,databaseSha256:v.working.sha256,retainedDifferences:history.retainedSchemaDifferences,facts,factsSha256:history.factsSha256(facts)});
 v.evidence.copyLineage=write('fictional-lineage',{status:'observed',workingPath:f.databasePath,preservedPath:snapshot,initialSha256:snapshotBefore,currentSha256:v.working.sha256});
 const raw=write('fictional-os-record',{fixture:true,status:'fictional_observation_only'});
 v.evidence.currentObservation=write('fictional-exclusive-observation',{fixture:true,observedAt:new Date().toISOString(),databasePath:f.databasePath,oldPidAbsent:true,managerDefinitionAbsent:true,disabledConfirmed:true,portReleased:true,replacementAbsent:true,fileUsersAbsent:true,records:[raw]});
 f.pin=write('fictional-admission',v);
}
function env(f,role='candidate'){const m=JSON.parse(fs.readFileSync(f.manifests[role].path));return {LANDI_SERVER_MODE:'guarded-workbench',LANDI_GUARDED_ADMISSION_KIND:'post-stop-preserved-copy',LANDI_GUARDED_APP_ROOT:m.projectRoot,LANDI_GUARDED_DATABASE_PATH:f.databasePath,LANDI_GUARDED_ENV_PATH:m.envPath,LANDI_GUARDED_PORT:'39971',LANDI_GUARDED_MANIFEST_PATH:f.manifests[role].path,LANDI_GUARDED_MANIFEST_SHA256:f.manifests[role].sha256,LANDI_GUARDED_POST_STOP_EVIDENCE_PATH:f.pin.path,LANDI_GUARDED_POST_STOP_EVIDENCE_SHA256:f.pin.sha256};}
function reject(f,change){const v=structuredClone(f.record);change(v);const p=write('negative',v),before=opens;assert.throws(()=>new storage.SqliteWorkspaceStore(f.databasePath,{guardedSchemaSha256:history.reviewedHistorySchema,postStopAdmission:p}));assert.equal(opens,before);}
test('unmodified production schema rejects synthetic fixture',()=>{const db=new NativeDatabase(snapshot,{readOnly:true});try{assert.throws(()=>productionHistory.inspectReadonlyHistory(db),/readonly_schema_not_reviewed/);}finally{db.close();}});
test('post-stop review and zero-write open/read/close preserve historical bytes and unknowns',()=>{
 const f=fixture(),before=hash(f.databasePath),policy=loadGuardedStartupPolicy(env(f));
 assert.equal(policy.blueprintGenerationEnabled,false);const a=storage.loadPostStopAdmission(f.databasePath,f.pin);assert.equal(a.preStopDrained,'unverified');assert.equal(a.productionExecutable,false);
 const s=new storage.SqliteWorkspaceStore(f.databasePath,{guardedSchemaSha256:policy.schemaSha256,postStopAdmission:policy.postStopAdmission});s.getWorkspace();s.email.list();s.close();assert.equal(hash(f.databasePath),before);
});
test('missing pins, original/preserved paths, and changed bytes fail before SQLite construction',()=>{
 const f=fixture(),before=opens;
 for(const file of [original,snapshot])assert.throws(()=>new storage.SqliteWorkspaceStore(file,{guardedSchemaSha256:history.reviewedHistorySchema,postStopAdmission:f.pin}));
 assert.throws(()=>storage.loadPostStopAdmission(f.databasePath,{...f.pin,sha256:'0'.repeat(64)}));
 reject(f,v=>v.working.sha256='0'.repeat(64));reject(f,v=>delete v.evidence.preservation);assert.equal(opens,before);
});
test('post-stop claims cannot be promoted to pre-stop drainage or external success',()=>{
 const f=fixture();for(const key of ['preStopDrained','gracefulExit','externalOperationOutcomes'])reject(f,v=>v[key]=true);
 for(const key of ['automaticResume','restoreDatabase','productionExecutable'])reject(f,v=>v[key]=true);
 assert.equal(load('apps/server/src/guarded-cutover-contract.ts').assessGuardedCutover(f.record).status,'unverified');
});
test('stale observations, missing raw records and mismatched rollback are refused',()=>{
 const f=fixture();reject(f,v=>{const o=JSON.parse(fs.readFileSync(v.evidence.currentObservation.path));o.observedAt='2020-01-01T00:00:00Z';v.evidence.currentObservation=write('stale',o);});
 reject(f,v=>{const o=JSON.parse(fs.readFileSync(v.evidence.currentObservation.path));o.records=[];v.evidence.currentObservation=write('no-records',o);});
 reject(f,v=>v.rollback.storageKeysSha256='b'.repeat(64));reject(f,v=>v.candidate.schemaSha256=history.reviewedReferenceSchema);
 assert.throws(()=>loadGuardedStartupPolicy({...env(f),LANDI_GUARDED_ADMISSION_KIND:'guess'}));
});
test('full historical audit, including missing CHECK predicates, is recomputed on work copy',()=>{
 const f=fixture();const audit=JSON.parse(fs.readFileSync(f.record.evidence.compatibilityAudit.path));audit.facts.counts.plans++;audit.factsSha256=history.factsSha256(audit.facts);f.record.evidence.compatibilityAudit=write('false-audit',audit);f.pin=write('negative-audit',f.record);
 assert.throws(()=>new storage.SqliteWorkspaceStore(f.databasePath,{guardedSchemaSha256:history.reviewedHistorySchema,postStopAdmission:f.pin}),/audit_facts_mismatch/);
 const facts=inspect(f.databasePath);for(const key of ['carrierOperation','carrierStatus','stagePresentation']){const changed=structuredClone(facts);changed.violations[key]=1;assert.throws(()=>history.assertReadonlyHistoryFacts(changed));}
 assert.equal(facts.coverage.carrierRuntime,'unverified');assert.equal(facts.coverage.receiptRuntime,'unverified');
});
test('injection permits local reads and blocks execution, email and recovery without listening',async()=>{
 const f=fixture(),before=hash(f.databasePath);const instance=await load('apps/server/src/guarded-workbench-startup.ts').createGuardedWorkbench(env(f));
 try{
  assert.equal(instance.server.server.listening,false);
  for(const url of ['/api/workspace','/api/email-execution','/api/agent-readiness'])assert.equal((await instance.server.inject({url})).statusCode,200);
  for(const url of ['/api/backups','/api/email-execution/verification','/api/tasks/resume'])assert.equal((await instance.server.inject({method:'POST',url})).statusCode,503);
  const ready=(await instance.server.inject({url:'/api/agent-readiness'})).json();assert.equal(ready.generation,false);assert.equal(ready.hosting,false);
 }finally{await instance.server.close();}assert.equal(hash(f.databasePath),before);
});
test('explicit fictional requirement save survives fresh admission of the matched rollback on same work copy',()=>{
 const f=fixture();let s=new storage.SqliteWorkspaceStore(f.databasePath,{guardedSchemaSha256:history.reviewedHistorySchema,postStopAdmission:f.pin});
 const session=s.createPlanningSession();const saved=s.savePlanningMessage({sessionId:session.id,messageId:'fictional-post-stop-save',expectedRevision:0,text:'A fictional trip to Lisbon'});s.close();assert.notEqual(hash(f.databasePath),snapshotBefore);
 refresh(f);[f.record.candidate,f.record.rollback]=[f.record.rollback,f.record.candidate];[f.record.evidence.candidateManifest,f.record.evidence.rollbackManifest]=[f.record.evidence.rollbackManifest,f.record.evidence.candidateManifest];f.pin=write('fictional-rollback-admission',f.record);
 const policy=loadGuardedStartupPolicy(env(f,'rollback'));s=new storage.SqliteWorkspaceStore(f.databasePath,{guardedSchemaSha256:policy.schemaSha256,postStopAdmission:policy.postStopAdmission});
 try{assert.equal(s.getPlanningSessionById(session.id).messages.at(-1).text,'A fictional trip to Lisbon');assert.equal(s.getPlanningRevision(session.id),1);}finally{s.close();}
 assert.equal(hash(snapshot),snapshotBefore);assert.ok(saved);
});
after(()=>{net.Server.prototype.listen=nativeListen;assert.equal(opens,closes);assert.equal(hash(snapshot),snapshotBefore);assert.equal(hash(preserved),preservationBefore);fs.writeFileSync(join(area,'verification.json'),JSON.stringify({scope:'fixture_mechanism',historicalSchemaAcceptance:'not_verified',productionSchemaConstantUnchanged:true,productionExecutable:false,realAdmissionCreated:false,servicesStarted:false,sourceDatabaseOpened:false,historicalTestsRun:false,opens,closes,snapshotUnchanged:true,preservationUnchanged:true}),{mode:0o600});console.log('Private check evidence: '+area);});
