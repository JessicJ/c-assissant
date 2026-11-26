"""New kernel-path observer cases only; all OS and libproc replies are fictional."""
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
import ast,copy,ctypes,hashlib,importlib.util,json,os,subprocess,sys,tempfile
C=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('kernel_observer_control',C/'scripts/guarded-deployment-control.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-kernel-observer-check-',dir=None)).resolve();os.chmod(OUT,0o700)
checks=[];counter=0
NODE='/fixture/cellar/node';OTHER='/fixture/canonical-other';ALIAS='/fixture/opt/node'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pin(p):return dict(path=str(p),sha256=sha(p))
def read(p):return json.loads(Path(p).read_text())
def write(name,v):
 p=OUT/name
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(p,0o600);return pin(p)
def reject(name,fn):
 try:fn()
 except m.ControlError:checks.append(name);return
 raise AssertionError(name+' incorrectly accepted')
class Fixture:
 def __init__(self):
  self.reported='node';self.kernelPath=OTHER;self.failure=None;self.n={};self.calls=[];self.fileChange=False;self.resolves=0
 def runner(self,argv):
  self.calls.append(argv)
  if argv[0]=='/bin/ps':
   text='1586 1555 501 Thu Oct 22 15:47:13 2026 '+self.reported+'\n'
   if self.failure=='duplicate_pid':text+=text
   return subprocess.CompletedProcess(argv,0,text,'')
  if argv[0]=='/bin/launchctl':
   if argv[1]=='print':return subprocess.CompletedProcess(argv,113,'','Could not find service "io.landi.fixture" in domain for user gui: 501')
   return subprocess.CompletedProcess(argv,0,'"io.landi.fixture" => disabled','')
  assert argv[0]=='/usr/sbin/lsof'
  return subprocess.CompletedProcess(argv,1,'','')
 def kernel(self,operation,pid):
  assert pid==1586
  self.n[operation]=self.n.get(operation,0)+1;n=self.n[operation]
  if self.failure==operation+'_permission':raise PermissionError('fixture denied')
  if self.failure==operation+'_gone':raise ProcessLookupError('fixture ESRCH')
  if operation=='path':
   if self.failure=='path_empty':return ''
   if self.failure=='path_relative':return 'node'
   if self.failure=='path_nul':return OTHER+'\x00x'
   if self.failure=='path_type':return None
   if self.failure=='path_changed' and n%2==0:return NODE
   if self.failure=='unresolved':return '/fixture/missing'
   return self.kernelPath
  v=dict(pid=pid,parentPid=1555,uid=501,realUid=501,startSeconds=1792655233,startMicroseconds=572374)
  if self.failure in ['pid','uid','parentPid']:v[{'pid':'pid','uid':'uid','parentPid':'parentPid'}[self.failure]]+=1
  if self.failure=='missing_start':v.pop('startMicroseconds')
  if self.failure=='invalid_microseconds':v['startMicroseconds']=1000000
  if self.failure=='bool_uid':v['uid']=True
  if n%2==0:
   for key in ['startSeconds','startMicroseconds','realUid','parentPid']:
    if self.failure=='changed_'+key:v[key]+=1
  return v
 def resolve(self,path):
  if path not in [NODE,ALIAS,OTHER,'/fixture/hard-node']:raise FileNotFoundError(path)
  inode=100 if path in [NODE,ALIAS,'/fixture/hard-node'] else 200
  self.resolves+=1
  if self.fileChange and path==OTHER:inode+=self.resolves
  return dict(path=NODE if path==ALIAS else path,device=1,inode=inode)
def fixture():
 global counter
 counter+=1;f=Fixture();o=m.OSObserver(m.Journal(OUT/f'journal-{counter}'),runner=f.runner,path_resolver=f.resolve,kernel_reader=f.kernel)
 return o,f
DB=OUT/'fictional.sqlite';DB.write_bytes(b'fictional metadata-only bytes, not SQLite')
def observe(o):return o.exclusive(str(DB),'http://127.0.0.1:18787',999,'io.landi.fixture',[NODE])
try:
 runtime=fixture_runtime();protected={str(C/"scripts/guarded-deployment-control.py"):sha(C/"scripts/guarded-deployment-control.py")}
 # Process names no longer supply executable identity.
 for name in ['node','npm run dev --port 4179','postgres: checkpointer','<defunct>','/not/a/real/path args']:
  o,f=fixture();f.reported=name;rows=o.processes()
  assert rows[0]['executable']==OTHER and rows[0]['reportedCommand']==name and rows[0]['kernelIdentity']['pid']==1586
  checks.append('display_only_'+name)
 o,f=fixture();result=observe(o)
 assert result['fixture'] and result['disabledConfirmed'] and result['replacementAbsent']
 checks.append('complete_kernel_evidence_two_scan_exclusive_observation')
 # All of these must refuse, including disappeared/zombie-named PIDs; no skip list.
 for failure in ['identity_permission','identity_gone','path_permission','path_gone','path_empty','path_relative','path_nul','path_type','path_changed','unresolved','pid','uid','parentPid','missing_start','invalid_microseconds','bool_uid','changed_startSeconds','changed_startMicroseconds','changed_realUid','changed_parentPid','duplicate_pid']:
  o,f=fixture();f.failure=failure
  reject(failure+'_unverified',o.processes)
 o,f=fixture();f.fileChange=True
 reject('file_identity_change_between_kernel_reads',o.processes)
 for path in [NODE,ALIAS,'/fixture/hard-node']:
  o,f=fixture();f.kernelPath=path
  reject('same_Node_'+path+'_still_blocks',lambda:observe(o))
  assert not any('print-disabled' in argv for argv in f.calls)
 o=m.OSObserver(m.Journal(OUT/'fixture-provenance'),kernel_reader=Fixture().kernel)
 assert o.fixture is True
 checks.append('kernel_reader_injection_marks_fixture')
 # Native adapter ABI and return handling, still no native calls.
 class FakeLib:
  def __init__(self):self.badIdentity=False;self.path=OTHER.encode();self.count=None
  def proc_pidinfo(self,pid,flavor,arg,ptr,size):
   assert flavor==3 and size==136
   value=ctypes.cast(ptr,ctypes.POINTER(m._ProcBSDInfo)).contents
   value.pid=pid;value.ppid=1555;value.uid=501;value.ruid=501;value.startsec=1792655233;value.startusec=572374
   return 0 if self.badIdentity else size
  def proc_pidpath(self,pid,buf,size):
   assert size==4096;ctypes.memmove(buf,self.path,len(self.path));return len(self.path) if self.count is None else self.count
 o,f=fixture();lib=FakeLib();o._process_lib=lib
 assert o._kernel_query('identity',1586)['startMicroseconds']==572374 and o._kernel_query('path',1586)==OTHER
 checks.append('native_adapter_uses_full_BSD_and_kernel_path_replies')
 lib.badIdentity=True;reject('native_partial_identity_rejected',lambda:o._kernel_query('identity',1586));lib.badIdentity=False
 for count in [0,4096,len(OTHER)+1]:
  lib.count=count;reject('native_path_count_'+str(count)+'_rejected',lambda:o._kernel_query('path',1586))
 o.kernel_reader=o._kernel_query
 lib.count=None;lib.path=b'\xff'
 reject('native_invalid_utf8_unverified',lambda:o.kernel_query('path',1586))
 for p,h in protected.items():assert sha(p)==h
 write('verification.json',dict(status='passed',checks=checks,reusedChecks=0,source=pin(C/'scripts/guarded-deployment-control.py'),test=pin(Path(__file__)),runtime=runtime,actualOSCommandsRun=False,nativeKernelCallsRun=False,processesSignalled=False,servicesStarted=False,databaseOpened=False,compiled=False,historicalTestsRun=False,mahCommandsRun=False,productionExecutable=False,releaseArtifactsModified=False,realAdmissionCreated=False,protectedEvidenceUnchanged=protected))
 print(json.dumps(dict(status='passed',newChecks=len(checks),reusedChecks=0,evidence=str(OUT/'verification.json'))))
except BaseException as error:
 write('failure.json',dict(status='failed_stopped',error=repr(error),passed=checks,source=pin(C/'scripts/guarded-deployment-control.py'),automaticRetry=False,servicesStarted=False,productionExecutable=False));print(str(OUT/'failure.json'));raise
