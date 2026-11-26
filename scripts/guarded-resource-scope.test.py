"""Fictional contract checks only. No controller import or OS/database observation."""
import builtins
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
MODULE=ROOT/'scripts/guarded-resource-scope.py'
spec=importlib.util.spec_from_file_location('resource_scope',MODULE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-resource-scope-check-',dir=None)).resolve();os.chmod(OUT,0o700)
checks=[]
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(name,value):
    p=OUT/name
    with p.open('x') as f:
        json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    os.chmod(p,0o600)
def identity(pid):return dict(pid=pid,parentPid=1,uid=501,realUid=501,startSeconds=1,startMicroseconds=123)
def file(path,inode):return dict(path=path,device=7,inode=inode,sha256='a'*64)
def fixture():
    work=dict(**file('/fiction/work.sqlite',20),nlink=1)
    lock=dict(**file('/fiction/.landi-control/'+hashlib.sha256(work['path'].encode()).hexdigest()+'.lock',21),nlink=1,mode=0o600,uid=501)
    sub=dict(projectRoot='/fiction/landi',controllerIdentity=identity(10),oldIdentity=identity(11),
             deploymentIds=['candidate','baseline'],managerLabel='io.landi.local',host='127.0.0.1',port=8787,
             nodeFile=file('/fiction/node',30),entries=[file('/fiction/landi/index.js',40)],workFile=work,lockFile=lock)
    scope=m.canonical_sha256(sub);ident=identity(101);exe=file('/fiction/node',30)
    row=dict(identityBefore=ident,identityAfter=copy.deepcopy(ident),executableBefore=exe,executableAfter=copy.deepcopy(exe),
             launch=dict(source='authenticated_launcher',identity=ident,executable=exe,entry=file('/fiction/other/index.js',41),
                         projectRoot='/fiction/other',deploymentId='other',receiptSha256='b'*64),
             targetResourceCheck=dict(subjectSha256=scope,complete=True,listeners=[],fileUsers=[],controlOwners=[]))
    scan=dict(startedAtMs=100000,endedAtMs=100100,subjectSha256=scope,visibility='verified_complete_scoped',unknowns=[],
              manager=dict(label=sub['managerLabel'],absent=True,disabled=True),listeners=[],fileUsers=[],controlOwners=[],
              workFile=work,absentSidecars=['-wal','-shm','-journal'],
              lease=dict(lockFile=lock,ownerIdentity=sub['controllerIdentity'],acquiredNonblocking=True,heldContinuously=True,inheritedIdentityMatched=True),processes=[row])
    second=copy.deepcopy(scan);second.update(startedAtMs=100200,endedAtMs=100300)
    return dict(version=2,policyVersion=m.POLICY,productionExecutable=False,compatibilityEnabled=False,subject=sub,scans=[scan,second])
def trust(e):return dict(verified=True,evidenceSha256=m.canonical_sha256(e),subjectSha256=m.canonical_sha256(e.get('subject')),verifier=file('/fiction/verifier',99),verifiedAtMs=100400,expiresAtMs=115000)
def evaluate(e,ctx=True,now=101000):
    before=copy.deepcopy(e);t=trust(e) if ctx is True else ctx
    r=m.evaluate_resource_scope(e,now_ms=now,trust=t)
    assert e==before and r['executable'] is False and r['mayExempt'] is False and r['admissionDecision']=='unchanged'
    assert r['productionExecutable'] is False and r['compatibilityEnabled'] is False and r['preStopDrained']=='unverified'
    return r
def reject(name,mutate):
    e=fixture();mutate(e);r=evaluate(e);assert r['status']=='rejected' and r['reasons'] and not r['excludedFromProposedScope'],name
    checks.append(name)

try:
    protected={str(MODULE):sha(MODULE)}
    e=fixture();r=evaluate(e);assert r['status']=='consistent_not_authorization' and r['excludedFromProposedScope']==[dict(pid=101,reason='bound_other_deployment_no_target_resources')]
    checks.append('complete_same_Node_foreign_instance_consistent_never_authorizes')
    assert evaluate(e,None)['status']=='rejected';checks.append('no_authenticated_ingestion_rejected')
    t=trust(e);t['evidenceSha256']='0'*64;assert evaluate(e,t)['status']=='rejected';checks.append('envelope_digest_mismatch_rejected')
    t=trust(e);t['subjectSha256']='0'*64;assert evaluate(e,t)['status']=='rejected';checks.append('subject_binding_mismatch_rejected')
    t=trust(e);t['verifiedAtMs']=102000;assert evaluate(e,t)['status']=='rejected';checks.append('future_verification_rejected')
    assert evaluate(e,now=116000)['status']=='rejected';checks.append('expired_verification_rejected')
    cases=[
      ('legacy_version_rejected',lambda e:e.update(version=1)),
      ('unknown_policy_rejected',lambda e:e.update(policyVersion='legacy')),
      ('production_enabled_rejected',lambda e:e.update(productionExecutable=True)),
      ('compatibility_enabled_rejected',lambda e:e.update(compatibilityEnabled=True)),
      ('missing_second_scan',lambda e:e['scans'].pop()),
      ('stale_scan_rejected',lambda e:e['scans'][0].update(startedAtMs=1)),
      ('future_scan_rejected',lambda e:e['scans'][1].update(endedAtMs=102000)),
      ('scan_order_rejected',lambda e:e['scans'][1].update(startedAtMs=100000)),
      ('visibility_missing_rejected',lambda e:e['scans'][0].pop('visibility')),
      ('permission_denied_unknown_rejected',lambda e:e['scans'][0]['unknowns'].append('EPERM')),
      ('port_owner_rejected',lambda e:e['scans'][0]['listeners'].append(dict(pid=101,address='0.0.0.0',port=8787))),
      ('IPv6_overlap_rejected',lambda e:e['scans'][0]['listeners'].append(dict(pid=101,address='::',port=8787))),
      ('database_alias_owner_rejected',lambda e:e['scans'][0]['fileUsers'].append(file('/alias',20))),
      ('missing_file_query_rejected',lambda e:e['scans'][0].pop('fileUsers')),
      ('control_owner_rejected',lambda e:e['scans'][0]['controlOwners'].append(101)),
      ('manager_enabled_rejected',lambda e:e['scans'][0]['manager'].update(disabled=False)),
      ('manager_bool_integer_rejected',lambda e:e['scans'][0]['manager'].update(absent=1)),
      ('work_file_replaced_rejected',lambda e:e['scans'][0]['workFile'].update(inode=999)),
      ('work_hardlink_scope_rejected',lambda e:e['subject']['workFile'].update(nlink=2)),
      ('work_bool_link_count_rejected',lambda e:e['subject']['workFile'].update(nlink=True)),
      ('sidecar_presence_rejected',lambda e:e['scans'][0].update(absentSidecars=[])),
      ('lost_lease_rejected',lambda e:e['scans'][0]['lease'].update(heldContinuously=False)),
      ('lock_path_alias_rejected',lambda e:e['subject']['lockFile'].update(path='/alias.lock')),
      ('lock_mode_rejected',lambda e:e['subject']['lockFile'].update(mode=0o644)),
      ('owner_identity_changed_rejected',lambda e:e['scans'][1]['lease']['ownerIdentity'].update(startMicroseconds=999)),
      ('PID_reuse_rejected',lambda e:e['scans'][0]['processes'][0]['identityAfter'].update(startMicroseconds=999)),
      ('missing_launcher_rejected',lambda e:e['scans'][0]['processes'][0].pop('launch')),
      ('self_asserted_verified_upstream_rejected',lambda e:e['scans'][0]['processes'][0]['launch'].update(source='verified_upstream')),
      ('target_deployment_rejected',lambda e:e['scans'][0]['processes'][0]['launch'].update(deploymentId='candidate')),
      ('target_entry_alias_rejected',lambda e:e['scans'][0]['processes'][0]['launch']['entry'].update(inode=40)),
      ('target_project_rejected',lambda e:e['scans'][0]['processes'][0]['launch'].update(projectRoot='/fiction/landi')),
      ('resource_check_missing_rejected',lambda e:e['scans'][0]['processes'][0].pop('targetResourceCheck')),
      ('duplicate_PID_rejected',lambda e:e['scans'][0]['processes'].append(copy.deepcopy(e['scans'][0]['processes'][0]))),
      ('candidate_disappears_rejected',lambda e:e['scans'][1].update(processes=[])),
      ('old_PID_present_or_reused_rejected',lambda e:e['subject']['oldIdentity'].update(pid=101)),
      ('empty_subject_rejected',lambda e:e.update(subject={})),
    ]
    for name,mutate in cases:reject(name,mutate)
    # Pure evaluation must not open any reference, source, lock, or database file.
    original=builtins.open
    def denied(*a,**kw):raise AssertionError('unexpected IO')
    builtins.open=denied
    try:assert evaluate(fixture())['status']=='consistent_not_authorization'
    finally:builtins.open=original
    checks.append('pure_evaluation_without_filesystem_access')
    for p,h in protected.items():assert sha(p)==h
    checks.append('controller_Storage_server_artifacts_and_previous_results_unchanged')
    save('fictional-example.json',dict(evidence=e,trust=trust(e),result=evaluate(e)))
    save('verification.json',dict(status='passed',newChecks=len(checks),checks=checks,module=dict(path=str(MODULE),sha256=sha(MODULE)),
         protectedDigests=protected,productionExecutable=False,compatibilityEnabled=False,controllerIntegrated=False,
         storageIntegrated=False,currentAdmissionChanged=False,databaseOpened=False,servicesStarted=False,
         OSQueriesRun=False,compiled=False,mahCommandsRun=False,historicalTestsRun=False))
    print(json.dumps(dict(status='passed',newChecks=len(checks),evidence=str(OUT))))
except BaseException as error:
    save('failure.json',dict(status='failed',passedChecks=checks,errorType=type(error).__name__,error=str(error)))
    print(json.dumps(dict(status='failed',evidence=str(OUT))))
    raise
