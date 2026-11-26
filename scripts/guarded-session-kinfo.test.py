"""Only new formal configuration wiring checks; fake OS/kernel/child replies."""
from pathlib import Path
from guarded_test_fixtures import resource_fixture, lease_fixture, trust as resource_trust, runtime as fixture_runtime
import ast,copy,ctypes,fcntl,hashlib,importlib.util,json,os,shutil,struct,subprocess,sys,tempfile
C=Path(__file__).resolve().parents[1]
SOURCE=C/'scripts/guarded-deployment-control.py'
spec=importlib.util.spec_from_file_location('session_kinfo_control',SOURCE)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-session-kinfo-check-',dir=None)).resolve();os.chmod(OUT,0o700)
checks=[];counter=0;sessions=[];parents=[];host_calls=[];observer_calls=[];launches=[];current={}
originals={k:getattr(m,k) for k in ['OSObserver','OwnedProcess','prepare_admission','storage_validator','LocalKinfoCompatibility']}
original_host=m.LocalKinfoCompatibility._host_probe;original_raw=m.LocalKinfoCompatibility._read_kinfo;original_short=m.LocalKinfoCompatibility._read_short;original_cdll=ctypes.CDLL

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pin(p):return dict(path=str(p),sha256=sha(p))
def read(p):return json.loads(Path(p).read_text())
def write(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('w') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(p,0o600);return pin(p)
def reject(name,fn,code=None):
 try:fn()
 except m.ControlError as error:
  if code:assert code in str(error),(name,str(error),code)
  checks.append(name);return
 raise AssertionError(name+' incorrectly accepted')
def journal(name):return m.Journal(OUT/(name+'-'+str(counter)))
def forbid_native(*a,**kw):raise AssertionError('native call forbidden')
ctypes.CDLL=forbid_native

def fixture(enabled=False,role='candidate'):
 global counter
 counter+=1;d=OUT/f'fixture-{counter}';root=d/role;controller=root/'scripts/guarded-deployment-control.py';controller.parent.mkdir(parents=True);shutil.copyfile(SOURCE,controller)
 m.__file__=str(controller)
 db=d/'fictional.sqlite';db.write_bytes(b'fictional bytes; never SQLite opened')
 p=read(C/'docs/contracts/local-kinfo-profile.json');p['sdkRoot']='/fixture/sdk'
 p['headers']=[dict(path='/fixture/sdk/usr/include/'+name,sha256='a'*64) for name in m.LocalKinfoCompatibility.HEADER_NAMES]
 origin=write(d/'origin.json',dict(layout=p['layout'],SDKRoot=p['sdkRoot'],headers=p['headers'],platform=p['platform']))
 p['layoutEvidence']=origin;pp=write(root/'docs/contracts/local-kinfo-profile.json',p)
 config=dict(profile=pp,enabled=enabled,interface=m.LocalKinfoCompatibility.INTERFACE,sessionPlanConsumption='wired_disabled_by_default')
 manifest=dict(mode='guarded-workbench',projectRoot=str(root),databasePath=str(db),origin='http://127.0.0.1:18787',files=[dict(path='scripts/guarded-deployment-control.py',sha256=sha(controller)),dict(path='docs/contracts/local-kinfo-profile.json',sha256=pp['sha256'])])
 mp=write(d/'manifest.json',manifest)
 runtime=dict(python=runtime_python,productionExecutable=False,controllerDigests={role:pin(controller)},localKinfoCompatibility=dict(interface=config['interface'],enabled=enabled,profiles={role:pp},layoutOrigin=origin))
 rp=write(d/'runtime.json',runtime)
 template=write(d/'admission-template.json',dict(working=dict(path=str(db))))
 plan=dict(purpose='guarded_control_session',explicitStart=True,productionExecutable=False,controller=pin(controller),runtimeBinding=rp,localKinfoCompatibility=config,databasePath=str(db),template=template,subject=dict(old_pid=999,label='io.landi.fixture',replacement_executables=['/fixture/node']),node=dict(path='/fixture/node',sha256='0'*64),loader=dict(path='/fixture/loader',sha256='0'*64),spec=dict(executable='/fixture/node',executable_sha256='0'*64,release_root=str(root),entry_sha256='0'*64,manifest_path=mp['path'],manifest_sha256=mp['sha256'],admission_path=str(d/'not-generated.json'),admission_sha256='0'*64,origin='http://127.0.0.1:18787',fixture=False))
 ctx=dict(d=d,root=root,db=db,profile=p,profilePin=pp,config=config,manifest=manifest,manifestPath=d/'manifest.json',runtime=runtime,runtimePath=d/'runtime.json',plan=plan,enabled=enabled,path='/fixture/other',micro=123456,rawCount=0)
 current.clear();current.update(ctx)
 return current

def repin_runtime(c):c['plan']['runtimeBinding']=write(c['runtimePath'],c['runtime'])
def repin_manifest(c):
 pp=write(c['manifestPath'],c['manifest']);c['plan']['spec'].update(manifest_path=pp['path'],manifest_sha256=pp['sha256'])
def resolve(c):return m.resolve_session_kinfo(c['plan'],journal('resolve'))
def session(c):
 pp=write(c['d']/'live-plan.json',c['plan']);s=m.ControlledSession(pp,journal('session'));sessions.append(s);return s

def fake_host(p):
 host_calls.append(p)
 return dict(platform=p['platform'],layout=m.LocalKinfoCompatibility.LAYOUT,pointerSize=8,sourcesVerified=True)
def fields():return dict(pid=100,parentPid=1,uid=0,realUid=0,startSeconds=1700000000,startMicroseconds=current['micro'])
def fake_raw(self,pid):
 current['rawCount']+=1;v=fields();b=bytearray(648)
 for k,fmt in [('pid','<i'),('parentPid','<i'),('uid','<I'),('realUid','<I'),('startSeconds','<q'),('startMicroseconds','<i')]:struct.pack_into(fmt,b,self.LAYOUT['offsets'][k],v[k])
 return dict(returncode=0,errno=0,size=648,data=bytes(b))
def fake_short(self,pid):return {k:fields()[k] for k in ['pid','parentPid','uid','realUid']}
m.LocalKinfoCompatibility._host_probe=staticmethod(fake_host);m.LocalKinfoCompatibility._read_kinfo=fake_raw;m.LocalKinfoCompatibility._read_short=fake_short
class Proc:
 def proc_pidinfo(self,pid,flavor,arg,ptr,size):
  assert flavor==3
  if current['enabled']:ctypes.set_errno(1);return 0
  ctypes.set_errno(0);b=ctypes.cast(ptr,ctypes.POINTER(m._ProcBSDInfo)).contents
  b.pid=pid;b.ppid=1;b.uid=0;b.ruid=0;b.startsec=1700000000;b.startusec=123456;return 136
 def proc_pidpath(self,pid,buf,size):
  text=current['path'].encode();ctypes.memmove(buf,text,len(text));return len(text)
def os_reply(argv):
 if argv[0]=='/bin/ps':return subprocess.CompletedProcess(argv,0,'100 1 0 Mon Oct 26 10:00:00 2026 node\n','')
 if argv[0]=='/bin/launchctl':
  if argv[1]=='print':return subprocess.CompletedProcess(argv,113,'','Could not find service "io.landi.fixture" in domain for user gui: 501')
  return subprocess.CompletedProcess(argv,0,'"io.landi.fixture" => disabled','')
 assert argv[0]=='/usr/sbin/lsof';return subprocess.CompletedProcess(argv,1,'','')
def resolver(p):
 assert p in ['/fixture/node','/fixture/other'];return dict(path=p,device=1,inode=100 if p=='/fixture/node' else 200)
def observer_spy(j,**kw):
 observer_calls.append(kw)
 o=originals['OSObserver'](j,**kw);o.runner=os_reply;o.path_resolver=resolver;o._process_lib=Proc();return o
m.OSObserver=observer_spy
class Owned:
 def __init__(self,lease,j,*observers):self.lease=lease;self.journal=j;self.observer=None;self.child=None;self.deployment_id='fixture-only';self.failed=False
 def launch(self,spec):launches.append(spec);return dict(pid=424242)
m.OwnedProcess=Owned
m.storage_validator=lambda *a:None
def prepare(c,spec,*a):
 c.lease.assert_identity();assert c.observer is not None
 c.observer.exclusive(str(c.lease.database),spec.origin,999,'io.landi.fixture',['/fixture/node']);return spec
m.prepare_admission=prepare
class Native:
 def identity(self,pid):return dict(pid=pid,uid=os.getuid(),realUid=os.getuid(),startSeconds=100,startMicroseconds=123)
 def endpoint(self,pid,fd):
  read=fcntl.fcntl(fd,fcntl.F_GETFL)&os.O_ACCMODE==os.O_RDONLY
  return dict(handle=101 if read else 202,peer=202 if read else 101,access=1 if read else 2)

def parent(c,config_change=None,runtime_change=None):
 template=copy.deepcopy(c['plan']);template['explicitStart']=False;tp=write(c['d']/'static-session.json',template)
 request=dict(purpose='guarded_parent_operation',explicitStart=True,productionExecutable=False,sessionTemplate=tp,runtimeBinding=template['runtimeBinding'])
 if 'localKinfoCompatibility' in template:request['localKinfoCompatibility']=copy.deepcopy(template['localKinfoCompatibility'])
 if config_change:config_change(request)
 if runtime_change:runtime_change(request)
 captured=[]
 def never_spawn(args,**kw):
  captured.append(m.read_pin(dict(path=args[args.index('--session-plan')+1],sha256=args[args.index('--plan-sha256')+1])))
  raise m.ControlError('fixture_stop_before_subprocess')
 op=m.ParentOperation(write(c['d']/'parent-request.json',request),journal('parent'),inspector=Native(),popen=never_spawn);parents.append(op)
 return op,captured
try:
 runtime_python=fixture_runtime();protected={str(SOURCE):sha(SOURCE)}
 for role in ['candidate','controlled-baseline']:
  c=fixture(False,role);before=len(host_calls);r=resolve(c);assert r['enabled'] is False and r['role']==role and len(host_calls)==before
  checks.append(role+'_disabled_static_binding_no_host_probe')
  c=fixture(True,role);s=session(c);s.start();assert s.state=='running' and observer_calls[-1]==dict(kinfo_profile=c['profilePin']) and c['rawCount']==4 and not s.lease.released
  checks.append(role+'_formal_session_passes_exact_profile_after_lease')
  s.lease.close_descriptor_without_unlock()
 c=fixture(False);before=len(host_calls);s=session(c);s.start();assert observer_calls[-1]=={} and len(host_calls)==before and c['rawCount']==0
 checks.append('disabled_session_never_initializes_compatibility');s.lease.close_descriptor_without_unlock()
 c=fixture();c['plan'].pop('localKinfoCompatibility');r=resolve(c);assert r==dict(enabled=False,profile=None,status='unconfigured_unverified')
 checks.append('missing_optional_config_stays_unverified_and_off')
 c=fixture(True);c['plan'].pop('localKinfoCompatibility');reject('missing_config_cannot_inherit_enabled_runtime',lambda:resolve(c))
 for name,mutate in [('enabled_type',lambda c:c['plan']['localKinfoCompatibility'].update(enabled=1)),('runtime_enabled',lambda c:c['runtime']['localKinfoCompatibility'].update(enabled=True)),('role',lambda c:c['runtime'].update(controllerDigests={'controlled-baseline':dict(path='/other/controller',sha256='0'*64)})),('duplicate_role',lambda c:c['runtime']['controllerDigests'].update({'controlled-baseline':c['plan']['controller']})),('manifest_profile',lambda c:c['manifest']['files'][1].update(sha256='0'*64)),('duplicate_profile_entry',lambda c:c['manifest']['files'].append(copy.deepcopy(c['manifest']['files'][1]))),('manifest_controller',lambda c:c['manifest']['files'][0].update(sha256='0'*64)),('root',lambda c:c['manifest'].update(projectRoot='/wrong/root')),('origin',lambda c:c['manifest'].update(origin='http://127.0.0.1:19999')),('profile_path',lambda c:c['plan']['localKinfoCompatibility']['profile'].update(path=str(c['root'].parent/'controlled-baseline/docs/contracts/local-kinfo-profile.json'))),('interface',lambda c:c['plan']['localKinfoCompatibility'].update(interface='stable_public_API')),('missing_runtime',lambda c:c['plan'].pop('runtimeBinding'))]:
  c=fixture();mutate(c);repin_runtime(c);repin_manifest(c)
  if name=='missing_runtime':c['plan'].pop('runtimeBinding',None)
  reject(name+'_unverified_before_lease',lambda:session(c))
 c=fixture();path=Path(c['profilePin']['path']);path.write_text('{}');reject('profile_digest_change_before_lease',lambda:session(c))
 c=fixture();c['runtime']['localKinfoCompatibility']['layoutOrigin']['sha256']='0'*64;repin_runtime(c)
 reject('layout_origin_conflict_before_lease',lambda:session(c))
 c=fixture();s=session(c);c['runtime']['productionExecutable']=True;write(c['runtimePath'],c['runtime'])
 reject('runtime_change_between_constructor_and_start',s.start);assert s.lease is None and s.state=='unverified'
 c=fixture();s=session(c);read(c['d']/'live-plan.json');(c['d']/'live-plan.json').write_text('{}')
 reject('session_plan_change_before_lock',s.start);assert s.lease is None
 # File mutation while the lock is being acquired must fail under the retained lease.
 c=fixture(True);s=session(c);oldlease=m.DeploymentLease
 def lease_then_mutate(*args):
  lease=oldlease(*args);Path(c['profilePin']['path']).write_text('{}');return lease
 m.DeploymentLease=lease_then_mutate
 try:reject('profile_change_during_lease_acquisition',s.start)
 finally:m.DeploymentLease=oldlease
 assert s.lease and not s.lease.released and s.controller is None
 s.lease.close_descriptor_without_unlock()
 c=fixture(True);s=session(c);c['path']='/fixture/node';before=len(launches)
 reject('same_Node_blocks_formal_session_before_business_spawn',s.start)
 assert s.state=='unverified' and len(launches)==before and not s.lease.released
 s.lease.close_descriptor_without_unlock()
 # Parent agreement is checked before any native inspector call or process creation.
 c=fixture();reject('parent_config_mismatch',lambda:parent(c,config_change=lambda q:q['localKinfoCompatibility'].update(enabled=True)))
 c=fixture();reject('parent_runtime_pin_mismatch',lambda:parent(c,runtime_change=lambda q:q['runtimeBinding'].update(sha256='0'*64)))
 for enabled in [False,True]:
  c=fixture(enabled);op,captured=parent(c);before=len(host_calls)
  reject('parent_'+str(enabled)+'_virtual_spawn_boundary',op.start,'fixture_stop_before_subprocess')
  assert len(captured)==1 and captured[0]['localKinfoCompatibility']==c['config'] and captured[0]['runtimeBinding']==c['plan']['runtimeBinding'] and captured[0]['productionExecutable'] is False and len(host_calls)==before
  checks.append('parent_'+str(enabled)+'_preserves_config_in_pinned_live_child_plan')
 c=fixture();op,captured=parent(c);Path(op.request['sessionTemplate']['path']).write_text('{}')
 reject('parent_template_change_before_pipe',op.start);assert op.reader is None and op.writer is None and captured==[]
 # Confirm that explicit fixture compatibility cannot be used for a real session.
 c=fixture(True);resolution=resolve(c);native_class=m.LocalKinfoCompatibility
 def fixture_compat(*args):
  v=native_class(*args);v.fixture=True;return v
 m.LocalKinfoCompatibility=types_proxy=type('FixtureCompatibilityProxy',(),{'INTERFACE':native_class.INTERFACE,'LAYOUT':native_class.LAYOUT,'__new__':staticmethod(lambda cls,*args:fixture_compat(*args))})
 try:reject('fixture_provider_cannot_authorize_real_session',lambda:m.create_session_observer(c['plan'],journal('fixture-reject'),resolution))
 finally:m.LocalKinfoCompatibility=native_class
 for p,h in protected.items():assert sha(p)==h
 write(OUT/'verification.json',dict(status='passed',checks=checks,reusedChecks=0,source=pin(SOURCE),test=pin(Path(__file__)),runtime=runtime_python,actualOSCommandsRun=False,nativeKernelCallsRun=False,servicesStarted=False,processesSignalled=False,databaseOpened=False,permissionsChanged=False,compiled=False,historicalTestsRun=False,mahCommandsRun=False,productionExecutable=False,releaseArtifactsModified=False,defaultCompatibilityEnabled=False,realAdmissionCreated=False))
 print(json.dumps(dict(status='passed',newChecks=len(checks),reusedChecks=0,evidence=str(OUT/'verification.json'))))
except BaseException as error:
 write(OUT/'failure.json',dict(status='failed_stopped',error=repr(error),passed=checks,automaticRetry=False,source=pin(SOURCE),servicesStarted=False,productionExecutable=False));print(str(OUT/'failure.json'));raise
finally:
 for s in sessions:
  if s.lease and not s.lease.released:s.lease.close_descriptor_without_unlock()
 for op in parents:
  for key in ['reader','writer']:
   fd=getattr(op,key,None)
   if fd is not None:os.close(fd);setattr(op,key,None)
 for k,v in originals.items():setattr(m,k,v)
 m.LocalKinfoCompatibility._host_probe=staticmethod(original_host);m.LocalKinfoCompatibility._read_kinfo=original_raw;m.LocalKinfoCompatibility._read_short=original_short;ctypes.CDLL=original_cdll
