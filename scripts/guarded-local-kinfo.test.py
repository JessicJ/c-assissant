"""New local SPI cases only. All OS/syscall/host replies are fictional."""
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
import ast,copy,ctypes,hashlib,importlib.util,json,os,struct,subprocess,sys,tempfile,types
C=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('local_kinfo_control',C/'scripts/guarded-deployment-control.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-local-kinfo-check-',dir=None)).resolve();os.chmod(OUT,0o700)
checks=[];counter=0;original_cdll=ctypes.CDLL;original_uname=os.uname
NODE='/fixture/node';OTHER='/fixture/other'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pin(p):return dict(path=str(p),sha256=sha(p))
def read(p):return json.loads(Path(p).read_text())
def write(name,v):
 p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(p,0o600);return pin(p)
def reject(name,fn):
 try:fn()
 except (m.ControlError,OSError,ValueError):checks.append(name);return
 raise AssertionError(name+' incorrectly accepted')
def no_native(*a,**kw):raise AssertionError('real native call forbidden')
ctypes.CDLL=no_native
class Fixture:
 def __init__(self):
  self.fields=dict(pid=100,parentPid=1,uid=0,realUid=0,startSeconds=1700000000,startMicroseconds=123456)
  self.rc=0;self.errno=0;self.size=648;self.length=648;self.short_change={};self.calls=0;self.change=False;self.path=OTHER;self.raw_calls=0
 def raw(self,pid):
  self.raw_calls+=1;fields=dict(self.fields)
  if self.change and self.raw_calls>1:fields['startMicroseconds']+=1
  b=bytearray(648)
  for k,fmt in [('pid','<i'),('parentPid','<i'),('uid','<I'),('realUid','<I'),('startSeconds','<q'),('startMicroseconds','<i')]:struct.pack_into(fmt,b,m.LocalKinfoCompatibility.LAYOUT['offsets'][k],fields[k])
  data=bytes(b[:self.length]) if self.length<=648 else bytes(b)+b'x'*(self.length-648)
  return dict(returncode=self.rc,errno=self.errno,size=self.size,data=data)
 def short(self,pid):return {**{k:self.fields[k] for k in ['pid','parentPid','uid','realUid']},**self.short_change}
 def host(self,p):return dict(platform=p['platform'],layout=m.LocalKinfoCompatibility.LAYOUT,pointerSize=8,sourcesVerified=True)
 def runner(self,argv):
  if argv[0]=='/bin/ps':return subprocess.CompletedProcess(argv,0,'100 1 0 Mon Oct 26 10:00:00 2026 node\n','')
  if argv[0]=='/bin/launchctl':
   if argv[1]=='print':return subprocess.CompletedProcess(argv,113,'','Could not find service "io.landi.fixture" in domain for user gui: 501')
   return subprocess.CompletedProcess(argv,0,'"io.landi.fixture" => disabled','')
  assert argv[0]=='/usr/sbin/lsof';return subprocess.CompletedProcess(argv,1,'','')
 def resolve(self,p):
  if p not in [NODE,OTHER]:raise FileNotFoundError(p)
  return dict(path=p,device=1,inode=100 if p==NODE else 200)
class FakeProc:
 def __init__(self,f):self.f=f;self.rc=0;self.error=1
 def proc_pidinfo(self,pid,flavor,arg,ptr,size):
  assert flavor==3 and size==136;ctypes.set_errno(self.error)
  if self.rc==136:
   v=ctypes.cast(ptr,ctypes.POINTER(m._ProcBSDInfo)).contents
   v.pid=pid;v.ppid=1;v.uid=0;v.ruid=0;v.startsec=1700000000;v.startusec=123456
  return self.rc
 def proc_pidpath(self,pid,buf,size):
  self.f.calls+=1;b=self.f.path.encode();ctypes.memmove(buf,b,len(b));return len(b)
def setup(profile=None,native_host=False):
 global counter
 counter+=1;f=Fixture();p=copy.deepcopy(profile or base_profile);p_ref=write(f'profile-{counter}.json',p);j=m.Journal(OUT/f'journal-{counter}')
 kw=dict(reader=f.raw,short_reader=f.short)
 if not native_host:kw['host_probe']=f.host
 compat=m.LocalKinfoCompatibility(p_ref,j,**kw)
 return compat,f,p_ref,j
try:
 runtime=fixture_runtime();protected_before={str(C/"scripts/guarded-deployment-control.py"):sha(C/"scripts/guarded-deployment-control.py")}
 base_profile=read(C/'docs/contracts/local-kinfo-profile.json')
 # All source files in the simulated profile are private fictional bytes.
 sdk=OUT/'sdk';base_profile['sdkRoot']=str(sdk);base_profile['headers']=[]
 for name in m.LocalKinfoCompatibility.HEADER_NAMES:
  path=sdk/'usr/include'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(('fake SDK '+name).encode());base_profile['headers'].append(pin(path))
 evidence=write('fake-origin.json',dict(layout=base_profile['layout'],SDKRoot=str(sdk),headers=base_profile['headers'],platform=base_profile['platform']))
 base_profile['layoutEvidence']=evidence
 os.uname=lambda:types.SimpleNamespace(sysname='Darwin',release='25.5.0',machine='arm64')
 compat,f,ref,j=setup(native_host=True);assert compat.identity(100)==f.fields and compat.fixture
 checks.append('bound_local_profile_fake_source_hashes_and_microseconds')
 compat,f,ref,j=setup();f.fields['startMicroseconds']=0;assert compat.identity(100)['startMicroseconds']==0
 checks.append('zero_microseconds_is_valid_not_missing')
 for name,change in [('empty',dict(size=0,length=0)),('short',dict(size=647,length=647)),('multiple',dict(size=1296,length=1296)),('oversize',dict(size=649,length=649)),('failed',dict(rc=-1,errno=1)),('success_with_errno',dict(errno=1)),('short_bytes_claim_full',dict(length=647))]:
  compat,f,ref,j=setup()
  for key,val in change.items():setattr(f,key,val)
  reject(name+'_reply_unverified',lambda:compat.identity(100))
 for field,value in [('pid',101),('parentPid',-1),('startSeconds',0),('startMicroseconds',-1),('startMicroseconds',1000000)]:
  compat,f,ref,j=setup();f.fields[field]=value
  reject(field+'_'+str(value)+'_unverified',lambda:compat.identity(100))
 for field in ['pid','parentPid','uid','realUid']:
  compat,f,ref,j=setup();f.short_change[field]=999
  reject('short_'+field+'_conflict',lambda:compat.identity(100))
 for name,mutate in [('version',lambda p:p.update(schemaVersion=2)),('stable_public_claim',lambda p:p.update(interface='stable_public_API')),('production',lambda p:p.update(productionExecutable=True)),('release',lambda p:p['platform'].update(release='25.6.0')),('layout',lambda p:p['layout'].update(kinfoSize=649)),('offset',lambda p:p['layout']['offsets'].update(uid=424)),('missing_header',lambda p:p['headers'].pop()),('unknown_source',lambda p:p.update(sources=['https://example.invalid']))]:
  p=copy.deepcopy(base_profile);mutate(p)
  reject('profile_'+name+'_unverified',lambda:setup(p))
 # Native host validation uses only fake uname and fake source files.
 p=copy.deepcopy(base_profile);p['headers'][0]['sha256']='0'*64
 reject('SDK_digest_change_unverified',lambda:setup(p,native_host=True))
 p=copy.deepcopy(base_profile);p['layoutEvidence']['sha256']='0'*64
 reject('origin_digest_change_unverified',lambda:setup(p,native_host=True))
 conflict=write('conflicting-origin.json',dict(layout=base_profile['layout'],SDKRoot='/wrong',headers=base_profile['headers'],platform=base_profile['platform']))
 p=copy.deepcopy(base_profile);p['layoutEvidence']=conflict
 reject('origin_content_conflict_unverified',lambda:setup(p,native_host=True))
 compat,f,ref,j=setup();original=compat.host_probe
 compat.host_probe=lambda p:{**original(p),'pointerSize':4}
 reject('host_pointer_mismatch_unverified',lambda:compat.identity(100))
 compat,f,ref,j=setup();p=Path(ref['path']);v=read(p);v['schemaVersion']=2;p.write_text(json.dumps(v))
 reject('profile_changes_after_binding_unverified',lambda:compat.identity(100))
 # Exercise native sysctl/short adapters against fake libraries only.
 compat,f,ref,j=setup()
 class FakeSystem:
  def sysctl(self,mib,n,buf,length,new,newlen):
   assert list(mib)==[1,14,1,100] and n==4 and new is None and newlen==0
   raw=f.raw(100);ctypes.memmove(buf,raw['data'],648);ctypes.cast(length,ctypes.POINTER(ctypes.c_size_t)).contents.value=648;return 0
 compat._system=FakeSystem();raw=compat._read_kinfo(100);assert raw['size']==648 and raw['data']==f.raw(100)['data']
 checks.append('native_sysctl_adapter_has_no_write_argument')
 class FakeShort:
  def proc_pidinfo(self,pid,flavor,arg,buf,size):
   assert flavor==13 and size==64
   for offset,value in [(0,100),(4,1),(36,0),(44,0)]:ctypes.memmove(ctypes.addressof(buf)+offset,struct.pack('<I',value),4)
   return 64
 compat._libproc=FakeShort();assert compat._read_short(100)==f.short(100)
 checks.append('native_short_adapter_field_offsets')
 # Formal observer calls real fallback implementation with virtual EPERM and transports.
 database=OUT/'fictional.sqlite';database.write_bytes(b'not a database; fixture filesystem metadata only')
 def observer_case():
  compat,f,ref,j=setup();o=m.OSObserver(j,runner=f.runner,path_resolver=f.resolve,kinfo_profile=ref,kinfo_factory=lambda p,j:compat);o._process_lib=FakeProc(f);return o,compat,f
 o,compat,f=observer_case();result=o.exclusive(str(database),'http://127.0.0.1:18787',999,'io.landi.fixture',[NODE]);assert result['fixture'] and result['replacementAbsent']
 checks.append('EPERM_only_fallback_complete_before_after_two_scan_observation')
 for rc,error in [(0,3),(0,13),(1,1),(135,1)]:
  o,compat,f=observer_case();o._process_lib.rc=rc;o._process_lib.error=error
  reject('no_fallback_'+str(rc)+'_'+str(error),lambda:o.kernel_query('identity',100));assert f.raw_calls==0
 o,compat,f=observer_case();o.kinfo_profile=None
 reject('missing_opt_in_profile_refuses_EPERM',lambda:o.kernel_query('identity',100));assert f.raw_calls==0
 o,compat,f=observer_case();o._process_lib.rc=136;o._process_lib.error=0;assert o.kernel_query('identity',100)==f.fields and f.raw_calls==0
 checks.append('native_full_identity_success_needs_no_compatibility')
 o,compat,f=observer_case();f.change=True
 reject('fallback_microsecond_change_between_observations',o.processes)
 o,compat,f=observer_case();f.path=NODE
 reject('same_Node_still_blocks_after_successful_compatibility',lambda:o.exclusive(str(database),'http://127.0.0.1:18787',999,'io.landi.fixture',[NODE]))
 assert f.raw_calls==2
 # Accepted provenance must identify SPI, pin, fixture and closed production gate.
 compat,f,ref,j=setup();compat.identity(100)
 record=read(next(j.directory.glob('*.json')))
 assert record['interface']==m.LocalKinfoCompatibility.INTERFACE and record['profile']==ref and record['fixture'] and record['productionExecutable'] is False
 checks.append('journal_binds_local_SPI_source_profile_and_fixture')
 for p,h in protected_before.items():assert sha(p)==h
 write('verification.json',dict(status='passed',checks=checks,reusedChecks=0,source=pin(C/'scripts/guarded-deployment-control.py'),profile=pin(C/'docs/contracts/local-kinfo-profile.json'),test=pin(Path(__file__)),runtime=runtime,compatibility='explicit_opt_in_local_SPI_not_stable_public_API',productionExecutable=False,actualOSCommandsRun=False,nativeKernelCallsRun=False,permissionsChanged=False,servicesStarted=False,processesSignalled=False,databaseOpened=False,compiled=False,historicalTestsRun=False,mahCommandsRun=False,releaseArtifactsModified=False,realAdmissionCreated=False))
 print(json.dumps(dict(status='passed',newChecks=len(checks),reusedChecks=0,evidence=str(OUT/'verification.json'))))
except BaseException as error:
 write('failure.json',dict(status='failed_stopped',error=repr(error),passed=checks,automaticRetry=False,source=pin(C/'scripts/guarded-deployment-control.py'),productionExecutable=False,servicesStarted=False));print(str(OUT/'failure.json'));raise
finally:ctypes.CDLL=original_cdll;os.uname=original_uname
