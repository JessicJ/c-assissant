"""New fictional composition checks, not historical test execution."""
import builtins,copy,hashlib,hmac,importlib.util,json,os,sys,tempfile
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
ROOT=Path(__file__).resolve().parents[1];ENTRY=ROOT/'scripts/guarded-stage-evidence-verifier.py'
spec=importlib.util.spec_from_file_location('stage_verifier',ENTRY);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-stage-wiring-check-',dir=None)).resolve();os.chmod(OUT,0o700);checks=[]
SOURCES={role:dict(key=hashlib.sha256(('fiction-only-'+role).encode()).digest(),roles=frozenset({role})) for role in m.ROLES}
CHALLENGE='c'*64
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(name,value):
 with (OUT/name).open('x') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(OUT/name,0o600)
def fixture():
 old=resource_fixture()
 r=copy.deepcopy(old);r.update(version=1,policyVersion='landi-resource-conflicts-v1')
 for scan in r['scans']:scan.pop('lease')
 pre,post=lease_fixture(resource_fixture()['subject']);stages=dict(preStart=pre,preOpen=post)
 a=stages['preStart'];b=stages['preOpen'];a.pop('resourceAssessment');a.update(startedAtMs=99900,endedAtMs=100400)
 a['lease']['continuousThroughMs']=100400
 for stage in [a,b]:stage['subject']['resourceSubjectSha256']=m._r.canonical_sha256(r['subject'])
 b.pop('launcherSourceVerified');b.pop('privateChannelVerified')
 return a,b,r
def sign(msg):return dict(message=msg,signature=hmac.new(SOURCES[msg['sourceId']]['key'],m._r.canonical_sha256(msg).encode('ascii'),hashlib.sha256).hexdigest())
def receipts(a,r=None,pre_hash=None):
 phase=a['stage'];package={'stage':a,'resource':r} if phase=='pre_start' else {'stage':a,'preStartSha256':pre_hash}
 expected={('stage-observation','all'):a}
 if phase=='pre_start':
  expected[('resource-observation','all')]=r;expected[('pre-lease','holder')]=a.get('lease')
  for i,scan in enumerate(r['scans']):
   for row in scan['processes']:expected[('foreign-launch',f'{i}:{row["identityBefore"]["pid"]}')]=row.get('launch')
 else:
  for role,field in [('post-lease','lease'),('child-launch','child'),('inheritance','inheritance'),('barrier','barrier')]:expected[(role,'subject')]=a.get(field)
 return [sign(dict(sourceId=role,role=role,item=item,stage=phase,challenge=CHALLENGE,packageSha256=m._r.canonical_sha256(package),factsSha256=m._r.canonical_sha256(facts),expiresAtMs=114900)) for (role,item),facts in expected.items()]
def pre(v,a,r,rs=None,now=100450):
 before=copy.deepcopy((a,r));out=v.verify_pre_start(a,r,receipts(a,r) if rs is None else rs,challenge=CHALLENGE,now_ms=now)
 assert (a,r)==before;closed(out);return out
def closed(out):
 assert out['executable'] is False and out['maySpawn'] is False and out['mayOpenDatabase'] is False and out['mayExempt'] is False and out['productionExecutable'] is False and out['compatibilityEnabled'] is False and out['realEvidenceAuthenticated'] is False
 assert 'trust' not in out
def reject_pre(name,mutate=None,receipt_mutate=None):
 a,b,r=fixture()
 if mutate:mutate(a,r)
 rs=receipts(a,r)
 if receipt_mutate:receipt_mutate(rs)
 v=m.StageEvidenceVerifier(fixture_sources=SOURCES);out=pre(v,a,r,rs)
 assert out['status']=='rejected' and out['reasons'] and 'contractResult' not in out,name
 checks.append(name)
def prepared():
 a,b,r=fixture();v=m.StageEvidenceVerifier(fixture_sources=SOURCES);out=pre(v,a,r)
 assert out['status']=='consistent_fixture_pre_start_not_authorization'
 b['preStartSha256']=out['preStartSha256'];return v,a,b,r,out
def reject_post(name,mutate=None,receipt_mutate=None,now=101000,challenge=CHALLENGE):
 v,a,b,r,p=prepared()
 if mutate:mutate(b)
 rs=receipts(b,pre_hash=p['preStartSha256'])
 if receipt_mutate:receipt_mutate(rs)
 out=v.verify_pre_open(b,rs,challenge=challenge,now_ms=now);closed(out)
 assert out['status']=='rejected' and out['reasons'] and 'contractResult' not in out,name
 checks.append(name)
try:
 protected={str(ENTRY):sha(ENTRY)}
 changed={}
 v,a,b,r,p=prepared();out=v.verify_pre_open(b,receipts(b,pre_hash=p['preStartSha256']),challenge=CHALLENGE,now_ms=101000);closed(out)
 assert out['status']=='consistent_fixture_pre_open_not_authorization';checks.append('full_fixture_resource_prestart_preopen_chain_no_authority')
 assert all('lease' not in scan for scan in r['scans']);checks.append('resource_checks_no_lease_or_future_inheritance_required')
 a,b,r=fixture();assert pre(m.StageEvidenceVerifier(),a,r)['status']=='rejected';checks.append('real_sources_disabled')
 reject_pre('resource_conflict',lambda a,r:r['scans'][0]['listeners'].append(dict(pid=101,port=8787)))
 reject_pre('resource_unknown',lambda a,r:r['scans'][0]['unknowns'].append('EPERM'))
 reject_pre('resource_expired',lambda a,r:r['scans'][0].update(startedAtMs=0))
 reject_pre('foreign_target_entry',lambda a,r:r['scans'][0]['processes'][0]['launch']['entry'].update(inode=30))
 reject_pre('resource_rejects_embedded_lease',lambda a,r:r['scans'][0].update(lease={'inheritedIdentityMatched':True}))
 reject_pre('untrusted_resource_summary',lambda a,r:a.update(resourceAssessment={'outcome':'consistent'}))
 reject_pre('wrong_resource_subject',lambda a,r:a['subject'].update(resourceSubjectSha256='0'*64))
 reject_pre('premature_inheritance',lambda a,r:a.update(inheritance='verified'))
 reject_pre('missing_pre_lease',lambda a,r:a.pop('lease'))
 reject_pre('lost_pre_lease',lambda a,r:a['lease'].update(heldContinuously=False))
 reject_pre('pre_gate_open',lambda a,r:a.update(productionExecutable=True))
 for role in ['resource-observation','foreign-launch','pre-lease','stage-observation']:
  reject_pre('missing_'+role,receipt_mutate=lambda rs,role=role:rs.__setitem__(slice(None),[x for x in rs if x['message']['role']!=role]))
 reject_pre('duplicate_receipt',receipt_mutate=lambda rs:rs.append(copy.deepcopy(rs[0])))
 reject_pre('bad_signature',receipt_mutate=lambda rs:rs[0].update(signature='0'*64))
 def wrong_role(rs):
  msg=rs[0]['message'];msg['sourceId']='pre-lease';rs[0]=sign(msg)
 reject_pre('source_role_substitution',receipt_mutate=wrong_role)
 def phase_substitution(rs):
  msg=rs[0]['message'];msg['stage']='pre_open';rs[0]=sign(msg)
 reject_pre('receipt_phase_substitution',receipt_mutate=phase_substitution)
 reject_post('post_missing_inheritance',lambda b:b.pop('inheritance'))
 reject_post('post_lease_reacquired',lambda b:b['lease'].update(leaseId='0'*64))
 reject_post('post_wrong_pre_digest',lambda b:b.update(preStartSha256='0'*64))
 reject_post('post_opened_early',lambda b:b['barrier'].update(databaseOpened=True))
 reject_post('post_ready_not_barrier',lambda b:b['barrier'].update(state='ready'))
 reject_post('post_missing_child_source',receipt_mutate=lambda rs:rs.__setitem__(slice(None),[x for x in rs if x['message']['role']!='child-launch']))
 reject_post('post_missing_barrier_source',receipt_mutate=lambda rs:rs.__setitem__(slice(None),[x for x in rs if x['message']['role']!='barrier']))
 reject_post('post_input_verified_flag',lambda b:b.update(privateChannelVerified=True))
 reject_post('post_other_session',challenge='d'*64)
 reject_post('post_expired_pre_chain',now=116000)
 reject_post('post_identity_reused',lambda b:b['child']['identityAfter'].update(startMicroseconds=999))
 a,b,r=fixture();v=m.StageEvidenceVerifier(fixture_sources=SOURCES);out=v.verify_pre_open(b,[],challenge=CHALLENGE,now_ms=101000);assert out['status']=='rejected';checks.append('post_before_pre_rejected')
 assert pre(v,a,r)['status']=='rejected';checks.append('failure_terminal_no_retry')
 v,a,b,r,p=prepared();assert pre(v,a,r)['status']=='rejected';checks.append('pre_success_cannot_replay')
 v,a,b,r,p=prepared();rs=receipts(b,pre_hash=p['preStartSha256']);v.verify_pre_open(b,rs,challenge=CHALLENGE,now_ms=101000)
 assert v.verify_pre_open(b,rs,challenge=CHALLENGE,now_ms=101000)['status']=='rejected';checks.append('post_success_cannot_replay')
 # Dedicated compatibility assertion, not an old test-suite rerun.
 old=dict(evidence=resource_fixture(),trust=resource_trust(resource_fixture()))
 assert m._r.evaluate_resource_scope(old['evidence'],now_ms=101000,trust=old['trust'])['status']=='consistent_not_authorization';checks.append('legacy_v2_contract_behavior_retained')
 v,a,b,r,p=prepared();rs=receipts(b,pre_hash=p['preStartSha256']);original=builtins.open
 def denied(*a,**kw):raise AssertionError('unexpected filesystem access')
 builtins.open=denied
 try:assert v.verify_pre_open(b,rs,challenge=CHALLENGE,now_ms=101000)['status']=='consistent_fixture_pre_open_not_authorization'
 finally:builtins.open=original
 checks.append('composition_no_filesystem_access')
 for p,h in protected.items():assert sha(p)==h
 checks.append('controller_Storage_OS_source_legacy_verifier_artifacts_prior_evidence_unchanged')
 save('fictional-result.json',out)
 save('verification.json',dict(status='passed',newChecks=len(checks),checks=checks,entry=dict(path=str(ENTRY),sha256=sha(ENTRY)),protectedDigests=protected,authorizedModuleChanges=changed,realSourcesConnected=False,controllerIntegrated=False,storageIntegrated=False,productionExecutable=False,compatibilityEnabled=False,servicesStarted=False,databaseOpened=False,OSQueriesRun=False,compiled=False,artifactsModified=False,mahCommandsRun=False,historicalTestsRun=False))
 print(json.dumps(dict(status='passed',newChecks=len(checks),evidence=str(OUT))))
except BaseException as error:
 save('failure.json',dict(status='failed',passedChecks=checks,errorType=type(error).__name__,error=str(error)))
 print(json.dumps(dict(status='failed',evidence=str(OUT))));raise
