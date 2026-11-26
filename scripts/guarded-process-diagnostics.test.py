"""New pure diagnostics checks only. No OS observation or admission execution."""
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
import builtins,copy,hashlib,importlib.util,json,os,sys,tempfile
C=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('process_diagnostics',C/'scripts/guarded-process-diagnostics.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-process-diagnostics-check-',dir=None)).resolve();os.chmod(OUT,0o700)
checks=[];examples={}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pin(p):return dict(path=str(p),sha256=sha(p))
def read(p):return json.loads(Path(p).read_text())
def write(name,v):
 p=OUT/name
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(p,0o600)
def ref(name):return dict(path='/fixture/evidence/'+name,sha256='a'*64)
def identity(pid=101,parent=1):return dict(pid=pid,parentPid=parent,uid=501,realUid=501,startSeconds=1700000000,startMicroseconds=123456)
def file(path,inode,hashed=False):
 v=dict(path=path,device=7,inode=inode)
 if hashed:v['sha256']='b'*64
 return v
def attest(payload,name='receipt'):return dict(status='verified_upstream',issuer=ref('issuer'),record=ref(name),payloadSha256=m.payload_sha256(payload))
def fixture():
 target=dict(projectRoot='/fixture/landi',deploymentId='landi-bound-1',port=8787,nodeFile=file('/fixture/node',10),databaseFiles=[file('/fixture/landi.sqlite',20),file('/fixture/landi.sqlite-wal',21),file('/fixture/landi.sqlite-shm',22)],registeredEntries=[file('/fixture/landi/server.js',30,True)])
 instance=identity();exe=file('/fixture/node',10)
 resources=dict(identity=copy.deepcopy(instance),targetSha256=m.payload_sha256(target),observedAtMs=1700000009000,record=ref('resources'),visibility='complete_attested',listeners=dict(returncode=1,stderr='',records=[]),fileUsers=dict(returncode=1,stderr='',records=[]))
 payload=dict(identity=copy.deepcopy(instance),projectRoot='/fixture/domore',entryFile=file('/fixture/domore/server.js',40,True),deploymentId='other-project-1')
 row=dict(pid=101,identityBefore=instance,identityAfter=copy.deepcopy(instance),executableBefore=exe,executableAfter=copy.deepcopy(exe),resources=resources,launchReceipt=dict(payload=payload,attestation=attest(payload)))
 return dict(version=1,observedAtMs=1700000008000,nowMs=1700000010000,target=target,processes=[row])
def evaluate(s):
 before=copy.deepcopy(s);out=m.diagnose_process_snapshot(s)
 assert s==before
 assert out['diagnosticOnly'] is True and out['admissionDecision']=='unchanged' and out['mayExempt'] is False and out['productionExecutable'] is False and out['compatibilityEnabled'] is False and out['preStopDrained']=='unverified'
 assert all(x['mayExempt'] is False for x in out['processes'])
 return out
def first(s):return evaluate(s)['processes'][0]
def launch_update(s,mutate):
 r=s['processes'][0]['launchReceipt'];mutate(r['payload']);r['attestation']=attest(r['payload'])
def owned_fixture():
 s=fixture();owner=identity(222);child=identity(333,222);exe=file('/fixture/collector',50,True)
 payload=dict(identity=copy.deepcopy(child),ownerIdentity=copy.deepcopy(owner),executable=copy.deepcopy(exe))
 registered=dict(payload=payload,attestation=attest(payload,'creation'))
 s.update(observerIdentity=owner,observerIdentityAfter=copy.deepcopy(owner),ownedCollectors=[registered])
 row=dict(pid=333,identityBefore=child,executableBefore=exe,lookupErrno=3,lifecycle=dict(creationRecord=registered['attestation']['record'],pipeEof=True,wait=dict(identity=copy.deepcopy(child),ownerIdentity=copy.deepcopy(owner),returned=True,exitCode=0,observedAtMs=1700000009000,record=ref('wait'))))
 s['processes']=[row];return s
try:
 controller=C/"scripts/guarded-deployment-control.py"
 protected={str(controller):sha(controller)}
 s=fixture();r=first(s);assert r['classification']=='other_project_evidence_consistent' and r['sameNodeFile'] and r['existingAdmissionPolicy']=='still_blocked_same_Node'
 checks.append('other_project_same_Node_diagnostic_never_exempts');examples['otherProjectSameNode']=evaluate(s)
 for name,kind in [('cwd','/fixture/domore'),('parentPid',222),('comm','ps')]:
  s=fixture();s['processes'][0].pop('launchReceipt');s['processes'][0]['hints']={name:kind}
  assert first(s)['classification']=='unverified';checks.append(name+'_hint_alone_does_not_establish_other_project')
 for address in ['127.0.0.1','0.0.0.0','::']:
  s=fixture();s['processes'][0]['resources']['listeners']=dict(returncode=0,stderr='',records=[dict(pid=101,address=address,port=8787)])
  assert first(s)['classification']=='resource_conflict_evidence';checks.append('external_receipt_cannot_hide_port_'+address)
 s=fixture();s['processes'][0]['resources']['fileUsers']=dict(returncode=0,stderr='',records=[dict(pid=101,file=file('/fixture/hardlink-alias',20))])
 assert first(s)['classification']=='resource_conflict_evidence';checks.append('database_alias_device_inode_conflict');examples['resourceConflict']=evaluate(s)
 s=fixture();s['processes'][0]['resources']['fileUsers']=dict(returncode=0,stderr='',records=[dict(pid=101,file=file('/fixture/landi.sqlite',999))])
 assert 'target_database_path_identity_conflict' in first(s)['reasons'];checks.append('database_path_changed_identity_unverified')
 s=fixture();launch_update(s,lambda p:p.update(entryFile=file('/fixture/domore/target-alias.js',30,True)))
 assert first(s)['classification']=='target_entry_conflict_evidence';checks.append('target_entry_alias_overrides_other_project_claim')
 s=fixture();launch_update(s,lambda p:p.update(deploymentId='landi-bound-1'))
 assert first(s)['classification']=='target_instance_conflict_evidence';checks.append('target_deployment_identity_cannot_be_external_exemption')
 for name,mutate in [('partial_visibility',lambda r:r['resources'].update(visibility='limited')),('query_warning',lambda r:r['resources']['fileUsers'].update(stderr='permission denied')),('wrong_resource_instance',lambda r:r['resources']['identity'].update(startMicroseconds=999)),('wrong_target_digest',lambda r:r['resources'].update(targetSha256='0'*64)),('stale_resource',lambda r:r['resources'].update(observedAtMs=0)),('wrong_record_owner',lambda r:r['resources']['listeners'].update(returncode=0,records=[dict(pid=999,address='127.0.0.1',port=4850)])),('unverified_launcher',lambda r:r['launchReceipt']['attestation'].update(status='unverified')),('launcher_payload_tamper',lambda r:r['launchReceipt']['payload'].update(projectRoot='/other')),('nonexistent_resource_record',lambda r:r['resources'].update(record=None)),('no_file_query',lambda r:r['resources'].pop('fileUsers'))]:
  s=fixture();mutate(s['processes'][0]);assert first(s)['classification']=='unverified';checks.append(name+'_cannot_establish_other_project')
 s=fixture();launch_update(s,lambda p:p.update(projectRoot='/fixture/landi',entryFile=file('/fixture/landi/unregistered.js',99,True)))
 assert first(s)['classification']=='unverified';checks.append('same_project_without_registered_entry_unverified')
 s=fixture();s['processes'][0]['executableAfter']['inode']=999;assert first(s)['classification']=='unverified';checks.append('executable_changed_unverified')
 s=fixture();s['processes'][0]['identityAfter']['startMicroseconds']+=1;assert first(s)['classification']=='pid_reused';checks.append('microsecond_PID_reuse_is_new_instance');examples['pidReuse']=evaluate(s)
 s=fixture();s['processes'][0]['identityAfter']['uid']=0;assert first(s)['classification']=='identity_conflict';checks.append('credential_change_is_conflict')
 s=fixture();s['processes']=[dict(pid=999,lookupErrno=3,hints=dict(comm='<defunct>'))]
 assert first(s)['classification']=='unverified' and 'missing_initial_identity' in first(s)['reasons'];checks.append('ESRCH_defunct_name_is_not_exit_proof');examples['unknownDisappearance']=evaluate(s)
 s['processes'][0]['recheck']=dict(status='complete_attested',observedAtMs=1700000009000,pids=[],record=ref('recheck'))
 assert first(s)['classification']=='not_seen_on_recheck_unverified';checks.append('later_absence_is_not_exit_or_drain_proof')
 s=owned_fixture();assert first(s)['classification']=='owned_collector_exit_evidence';checks.append('bound_owned_collector_receipt_EOF_zero_exit_evidence_only');examples['ownedCollectorExit']=evaluate(s)
 for name,mutate in [('no_creation',lambda s:s.update(ownedCollectors=[])),('duplicate_creation',lambda s:s['ownedCollectors'].append(copy.deepcopy(s['ownedCollectors'][0]))),('no_pipe_EOF',lambda s:s['processes'][0]['lifecycle'].update(pipeEof=False)),('no_wait',lambda s:s['processes'][0]['lifecycle'].pop('wait')),('wrong_wait_instance',lambda s:s['processes'][0]['lifecycle']['wait']['identity'].update(startMicroseconds=999)),('nonzero_exit',lambda s:s['processes'][0]['lifecycle']['wait'].update(exitCode=1)),('stale_wait',lambda s:s['processes'][0]['lifecycle']['wait'].update(observedAtMs=0)),('changed_owner',lambda s:s['observerIdentityAfter'].update(startMicroseconds=999)),('false_parent',lambda s:s['processes'][0]['identityBefore'].update(parentPid=444)),('live_identity_with_ESRCH',lambda s:s['processes'][0].update(identityAfter=copy.deepcopy(s['processes'][0]['identityBefore'])))]:
  s=owned_fixture();mutate(s);assert first(s)['classification']!='owned_collector_exit_evidence';checks.append(name+'_cannot_prove_collector_exit')
 s=fixture();s['nowMs']+=15001;assert evaluate(s)['status']=='unverified';checks.append('expired_snapshot_unverified')
 s=fixture();s['processes'].append(copy.deepcopy(s['processes'][0]));assert evaluate(s)['status']=='unverified';checks.append('duplicate_PID_snapshot_unverified')
 s=fixture();s['processes']=[];assert evaluate(s)['reason']=='empty_snapshot_is_not_absence_proof';checks.append('empty_inventory_does_not_prove_absence')
 s=fixture();s['target']['nodeFile']['inode']=0;assert evaluate(s)['status']=='unverified';checks.append('missing_target_file_identity_unverified')
 s=fixture();s['processes'][0]['pid']=[];assert evaluate(s)['status']=='unverified';checks.append('malformed_PID_no_exception_or_permission')
 # Calling diagnostics must remain pure even when filesystem opening is forbidden.
 original_open=builtins.open
 def no_open(*a,**kw):raise AssertionError('diagnostics attempted filesystem IO')
 s=fixture();builtins.open=no_open
 try:out=evaluate(s);assert out['processes'][0]['existingAdmissionPolicy']=='still_blocked_same_Node'
 finally:builtins.open=original_open
 checks.append('diagnostics_execute_without_filesystem_access')
 for p,h in protected.items():assert sha(p)==h
 write('fictional-examples.json',examples)
 write('verification.json',dict(status='passed',checks=checks,reusedChecks=0,module=pin(C/'scripts/guarded-process-diagnostics.py'),test=pin(Path(__file__)),unchangedAdmissionController=pin(controller),examples=pin(OUT/'fictional-examples.json'),actualOSCommandsRun=False,nativeKernelCallsRun=False,permissionsChanged=False,servicesStarted=False,processesSignalled=False,databaseOpened=False,compiled=False,historicalTestsRun=False,mahCommandsRun=False,productionExecutable=False,compatibilityEnabled=False,releaseArtifactsModified=False,admissionPolicyChanged=False,protectedEvidenceUnchanged=protected))
 print(json.dumps(dict(status='passed',newChecks=len(checks),reusedChecks=0,evidence=str(OUT/'verification.json'))))
except BaseException as error:
 write('failure.json',dict(status='failed_stopped',error=repr(error),passed=checks,automaticRetry=False,servicesStarted=False,productionExecutable=False));print(str(OUT/'failure.json'));raise
