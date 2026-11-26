"""Only new observer normalization cases; fake OS outputs and private fake files.
No real OS commands, process signals, service, SQLite, builds or historical suite.
"""
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
import ast,copy,hashlib,importlib.util,json,os,subprocess,sys,tempfile
C=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('observer_control',C/'scripts/guarded-deployment-control.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-observer-normalization-',dir=None)).resolve();os.chmod(OUT,0o700)
checks=[];case=0

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pin(p):return {'path':str(p),'sha256':sha(p)}
def read(p):return json.loads(Path(p).read_text())
def write(name,v):
 p=OUT/name;fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:json.dump(v,f,indent=2)
 return pin(p)
def reject(name,fn,code=None):
 try:fn()
 except m.ControlError as error:
  if code:assert code == str(error),(name,str(error),code)
  checks.append(name);return
 raise AssertionError(name+' incorrectly accepted')

NODE='/fixture/cellar/node';OPT='/fixture/opt/node';OTHER='/fixture/other';HARD='/fixture/hard-node'
class Resolver:
 def __init__(self):
  self.values={NODE:{'path':NODE,'device':1,'inode':100},OPT:{'path':NODE,'device':1,'inode':100},HARD:{'path':HARD,'device':1,'inode':100},OTHER:{'path':OTHER,'device':1,'inode':200}}
  self.counts={};self.change=None;self.threshold=1
 def __call__(self,path):
  if path not in self.values:raise FileNotFoundError(path)
  self.counts[path]=self.counts.get(path,0)+1;v=dict(self.values[path])
  if self.change==path and self.counts[path]>self.threshold:v['inode']+=10
  return v
class FakeOS:
 def __init__(self):self.executable=OTHER;self.output='"io.landi.fixture" => disabled';self.stderr='';self.returncode=0;self.calls=[]
 def __call__(self,argv):
  assert argv[0] in ['/bin/ps','/bin/launchctl','/usr/sbin/lsof'];self.calls.append(argv)
  if argv[0]=='/bin/ps':return subprocess.CompletedProcess(argv,0,'100 1 501 Mon Oct 26 10:00:00 2026 '+self.executable+'\n','')
  if argv[0]=='/bin/launchctl':
   if argv[1]=='print':return subprocess.CompletedProcess(argv,113,'','Could not find service "io.landi.fixture" in domain for user gui: 501')
   return subprocess.CompletedProcess(argv,self.returncode,self.output,self.stderr)
  return subprocess.CompletedProcess(argv,1,'','')
def fixture():
 global case
 case+=1;j=m.Journal(OUT/('journal-'+str(case)));runner=FakeOS();resolver=Resolver()
 def kernel(operation,pid):
  if operation=='path':return runner.executable
  return dict(pid=pid,parentPid=1,uid=501,realUid=501,startSeconds=100,startMicroseconds=1)
 return m.OSObserver(j,runner,path_resolver=resolver,kernel_reader=kernel),runner,resolver

database=OUT/'fictional.sqlite';database.write_bytes(b'fictional bytes; not a SQLite database')
def observe(observer,replacements=None):return observer.exclusive(str(database),'http://127.0.0.1:18787',old_pid=999,label='io.landi.fixture',replacement_executables=replacements or [NODE])
try:
 runtime=fixture_runtime()
 for token in ['true','disabled']:
  observer,runner,resolver=fixture();runner.output='disabled services = {\n  "unrelated" => enabled\n  "io.landi.fixture" => '+token+'\n}'
  value=observe(observer)
  assert value['disabledConfirmed'] and value['replacementAbsent'] and value['fixture'] and len(value['records'])==20
  checks.append(token+'_single_disabled_declaration_with_complete_fixture_evidence')
 for name,text in [('false','"io.landi.fixture" => false'),('enabled','"io.landi.fixture" => enabled'),('missing','"unrelated" => disabled'),('duplicate','"io.landi.fixture" => disabled\n"io.landi.fixture" => disabled'),('conflicting','"io.landi.fixture" => disabled\n"io.landi.fixture" => enabled'),('unknown','"io.landi.fixture" => unknown'),('prefix','"io.landi.fixture" => disabled_extra'),('malformed','"io.landi.fixture" => disabled trailing')]:
  observer,runner,resolver=fixture();runner.output=text
  reject('disabled_'+name+'_remains_unverified',lambda:observe(observer),'disabled_state_unverified')
 for name,rc,stderr in [('failed',1,''),('warning',0,'permission denied')]:
  observer,runner,resolver=fixture();runner.returncode=rc;runner.stderr=stderr
  reject('disabled_query_'+name+'_remains_unverified',lambda:observe(observer),'disabled_query_unverified')
 for name,reported,configured in [('exact',NODE,NODE),('symlink_alias',OPT,NODE),('reverse_symlink',NODE,OPT),('hardlink_alias',HARD,NODE)]:
  observer,runner,resolver=fixture();runner.executable=reported
  reject(name+'_same_Node_file_still_blocks',lambda:observe(observer,[configured]),'old_or_replacement_process_present_unverified')
  # Rejection occurs before the code can produce an absence/admission record.
  assert not any('print-disabled' in argv for argv in runner.calls)
 observer,runner,resolver=fixture();runner.executable='/fixture/missing-node'
 reject('unresolved_observed_executable',lambda:observe(observer),'executable_resolution_unverified')
 observer,runner,resolver=fixture();runner.executable='node'
 reject('relative_executable_no_PATH_fallback',lambda:observe(observer),'process_kernel_evidence_unverified')
 assert not any('print-disabled' in argv for argv in runner.calls)
 observer,runner,resolver=fixture()
 reject('unresolved_configured_executable',lambda:observe(observer,['/fixture/missing']),'executable_resolution_unverified')
 observer,runner,resolver=fixture();resolver.change=NODE
 reject('configured_identity_changes',lambda:observe(observer),'replacement_identity_changed_unverified')
 assert resolver.counts[NODE]==2 and not runner.calls
 assert not any('print-disabled' in argv for argv in runner.calls)
 observer,runner,resolver=fixture();resolver.change=OTHER
 reject('observed_identity_changes_during_kernel_snapshot',lambda:observe(observer),'process_kernel_executable_changed_unverified')
 assert resolver.counts[OTHER]==2 and resolver.counts[NODE]==2
 assert not any('print-disabled' in argv for argv in runner.calls)
 observer,runner,resolver=fixture();resolver.change=OTHER;resolver.threshold=3
 reject('observed_identity_changes_after_kernel_snapshot',lambda:observe(observer),'executable_identity_changed_unverified')
 assert resolver.counts[OTHER]==4 and resolver.counts[NODE]==2
 assert not any('print-disabled' in argv for argv in runner.calls)
 observer,runner,resolver=fixture()
 reject('duplicate_alias_configuration',lambda:observe(observer,[NODE,OPT]),'replacement_identity_duplicate_unverified')
 observer,runner,resolver=fixture();resolver.values[OTHER]={'path':NODE,'device':1,'inode':777};resolver.change=NODE;resolver.threshold=2
 resolver.values[NODE]['inode']=100
 # NODE3 must resolve to conflicting777; the first2 reads remain pinned100.
 original_resolver=resolver.__class__.__call__
 def conflict_resolution(path):
  value=original_resolver(resolver,path)
  if path==NODE and resolver.counts[path]>2:value['inode']=777
  return value
 observer.path_resolver=conflict_resolution
 reject('same_canonical_path_conflicting_file_identity',lambda:observe(observer),'executable_identity_conflict_unverified')
 assert resolver.counts[NODE]==3 and resolver.counts[OTHER]==2
 assert not any('print-disabled' in argv for argv in runner.calls)
 observer,runner,resolver=fixture();resolver.values[OTHER]={'path':OTHER,'device':1,'inode':0}
 reject('missing_filesystem_identity',lambda:observe(observer),'executable_identity_unverified')
 observer=m.OSObserver(m.Journal(OUT/'resolver-provenance'),path_resolver=Resolver())
 assert observer.fixture is True
 checks.append('resolver_injection_is_fixture_only')
 # Native path resolution uses only fake local executable bytes, never OS queries.
 file=OUT/'fake-node';file.write_bytes(b'not an executable, fixture identity only')
 alias=OUT/'fake-node-alias';alias.symlink_to(file.name)
 hard=OUT/'fake-node-hard';os.link(file,hard)
 one=m.OSObserver._resolve_executable(str(file));two=m.OSObserver._resolve_executable(str(alias));three=m.OSObserver._resolve_executable(str(hard))
 assert one==two and one['inode']==three['inode'] and one['device']==three['device']
 checks.append('strict_filesystem_resolver_symlink_and_hardlink_fixture_identity')
 # Verify the default resolver plus fake ps still rejects the alias end-to-end.
 observer,runner,resolver=fixture();observer.path_resolver=m.OSObserver._resolve_executable;runner.executable=str(alias)
 reject('native_fixture_alias_end_to_end_blocks',lambda:observe(observer,[str(file)]),'old_or_replacement_process_present_unverified')
 write('verification.json',{'status':'passed','checks':checks,'reusedChecks':0,'source':pin(C/'scripts/guarded-deployment-control.py'),'test':pin(Path(__file__)),'runtime':runtime,'actualOSCommandsRun':False,'servicesStarted':False,'processesSignalled':False,'databaseOpened':False,'compiled':False,'historicalTestsRun':False,'mahCommandsRun':False,'productionExecutable':False,'releaseArtifactsModified':False,'realAdmissionCreated':False})
 print(json.dumps({'status':'passed','newChecks':len(checks),'reusedChecks':0,'evidence':str(OUT/'verification.json')}))
except BaseException as error:
 write('failure.json',{'status':'failed_stopped','error':repr(error),'passed':checks,'automaticRetry':False,'source':pin(C/'scripts/guarded-deployment-control.py'),'servicesStarted':False});print(str(OUT/'failure.json'));raise
