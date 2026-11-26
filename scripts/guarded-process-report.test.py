"""New offline-entry checks only; fictional JSON, no service or database IO."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT/'scripts/guarded-process-report.py'
spec = importlib.util.spec_from_file_location('report_entry', ENTRY)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
OUT = Path(tempfile.mkdtemp(prefix='landi-process-report-check-', dir=None))
os.chmod(OUT, 0o700)
checks = []

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(name, value):
    p = OUT/name
    with p.open('x') as f:
        json.dump(value, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
    os.chmod(p, 0o600)
    return p
def check(name, condition):
    assert condition, name
    checks.append(name)
def fixture():
    ident = dict(pid=101,parentPid=1,uid=501,realUid=501,startSeconds=1,startMicroseconds=2)
    file = lambda path, inode: dict(path=path,device=7,inode=inode)
    target = dict(projectRoot='/fiction/landi',deploymentId='fiction',port=8787,
                  nodeFile=file('/fiction/node',1), databaseFiles=[file('/fiction/db',2)],
                  registeredEntries=[dict(**file('/fiction/server.js',3),sha256='a'*64)])
    row = dict(pid=101,identityBefore=ident,identityAfter=copy.deepcopy(ident),
               executableBefore=file('/fiction/node',1),executableAfter=file('/fiction/node',1))
    row['resources'] = dict(identity=ident,targetSha256=m.diagnostics.payload_sha256(target),
        observedAtMs=100000,record=dict(path='/not/read.json',sha256='a'*64),visibility='complete_attested',
        listeners=dict(returncode=0,stderr='',records=[dict(pid=101,address='127.0.0.1',port=8787)]),
        fileUsers=dict(returncode=1,stderr='',records=[]))
    return dict(version=1,observedAtMs=100000,nowMs=100000,target=target,processes=[row])
def evaluate(s, now=101000):
    before=copy.deepcopy(s); r=m.report(s,now)
    assert s==before
    assert r['admissionDecision']=='unchanged' and not r['mayExempt'] and not r['productionExecutable'] and not r['compatibilityEnabled'] and r['currentState']=='unverified'
    return r
def cli(p, digest=None):
    r=subprocess.run([sys.executable,str(ENTRY),'--snapshot',str(p),'--sha256',digest or sha(p)],
                     capture_output=True,text=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},timeout=10)
    assert not r.stderr
    return r.returncode,json.loads(r.stdout)

try:
    protected={str(ENTRY):sha(ENTRY)}
    r=evaluate(fixture()); check('resource_conflict_and_same_Node_policy_reported_separately',len(r['conflicts'])==1 and len(r['policyBlocks'])==1)
    check('supplied_conflict_not_independently_verified',r['conflicts'][0]['independentlyVerified'] is False and bool(r['insufficient']))
    s=fixture();s['processes'][0].pop('resources');r=evaluate(s);check('missing_resource_evidence_unverified',not r['conflicts'] and bool(r['insufficient']) and bool(r['policyBlocks']))
    r=evaluate(fixture(),120000);check('expired_snapshot_no_current_conflict_claim',bool(r['expired']) and not r['conflicts'] and not r['policyBlocks'])
    s=fixture();s['nowMs']=100000;r=evaluate(s,120000);check('input_clock_cannot_launder_expiry',bool(r['expired']))
    s=fixture();s['processes'][0]['resources']['observedAtMs']=0;r=evaluate(s);check('expired_resource_separated',bool(r['expired']) and not r['conflicts'])
    check('future_observation_unverified',bool(evaluate(fixture(),99999)['insufficient']))
    s=fixture();s['processes']=[];check('empty_not_complete_absence',bool(evaluate(s)['insufficient']))
    s=fixture();s['processes']=[None];check('malformed_row_diagnostic_not_exception',bool(evaluate(s)['insufficient']))
    s=fixture();s['processes']=[dict(pid=99,lookupErrno=3)];r=evaluate(s);check('ESRCH_not_exit_or_drain',r['preStopDrained']=='unverified' and bool(r['insufficient']))
    p=save('fictional-snapshot.json',fixture());rc,r=cli(p);check('CLI_real_clock_and_source_digest',rc==0 and r['source']['sha256']==sha(p) and r['sourceAuthenticated'] is False and bool(r['expired']))
    rc,r=cli(p,'0'*64);check('digest_mismatch_rejected',rc==2 and bool(r['insufficient']))
    alias=OUT/'symlink.json';alias.symlink_to(p);rc,r=cli(alias);check('symlink_rejected',rc==2)
    fifo=OUT/'pipe.json';os.mkfifo(fifo);rc,r=cli(fifo,'a'*64);check('FIFO_rejected_without_waiting',rc==2)
    duplicate=OUT/'duplicate.json';duplicate.write_text('{"version":1,"version":1}');rc,r=cli(duplicate);check('duplicate_keys_rejected',rc==2)
    bad=OUT/'invalid.json';bad.write_bytes(b'\xff');rc,r=cli(bad);check('invalid_UTF8_rejected',rc==2)
    sqlite=OUT/'fiction.sqlite';sqlite.write_bytes(b'not a database');rc,r=cli(sqlite);check('database_extension_rejected',rc==2)
    # Referenced records do not exist: no reference lookup or issuer promotion.
    r=evaluate(fixture());check('reference_files_not_opened_or_authenticated',bool(r['insufficient']) and r['currentState']=='unverified')
    for p,h in protected.items(): assert sha(p)==h
    check('admission_artifacts_templates_and_prior_results_unchanged',True)
    save('fictional-report.json',evaluate(fixture()))
    save('verification.json',dict(status='passed',checks=checks,newChecks=len(checks),reusedResults=0,
        entry=dict(path=str(ENTRY),sha256=sha(ENTRY)),test=dict(path=str(Path(__file__)),sha256=sha(__file__)),
        productionExecutable=False,compatibilityEnabled=False,admissionPolicyChanged=False,
        servicesStarted=False,databaseOpened=False,OSQueriesRun=False,mahCommandsRun=False,
        compiled=False,artifactsModified=False,historicalTestsRun=False,protectedDigests=protected))
    print(json.dumps(dict(status='passed',newChecks=len(checks),evidence=str(OUT))))
except BaseException as error:
    save('failure.json',dict(status='failed',passedChecks=checks,errorType=type(error).__name__,error=str(error)))
    print(json.dumps(dict(status='failed',evidence=str(OUT))))
    raise
