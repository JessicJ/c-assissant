"""New session checks: virtual Popen/OS, private pipes, synthetic bytes and filesystem loader.
No actual service, listener, OS command, SQLite construction or historical suite.
"""
from pathlib import Path
import dataclasses,datetime,fcntl,hashlib,importlib.util,json,os,shutil,subprocess,sys,tempfile
C=Path(__file__).resolve().parents[1]
OUT=Path(tempfile.mkdtemp(prefix='landi-control-session-',dir=None)).resolve();os.chmod(OUT,0o700)
spec=importlib.util.spec_from_file_location('session_control',C/'scripts/guarded-deployment-control.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
checks=[];sessions=[];children=[];counter=0
original_popen=subprocess.Popen;original_write=os.write;original_os_run=m.OSObserver._run

def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def pin(p):return {'path':str(p),'sha256':digest(p)}
def write(name,v):
 p=OUT/name;fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:json.dump(v,f,indent=2)
 return pin(p)
def reject(name,fn,code=None,missing=False):
 try:fn()
 except (m.ControlError,BlockingIOError,ValueError,KeyError,FileNotFoundError) as e:
  if isinstance(e,FileNotFoundError) and not missing:raise
  if code:assert code in str(e),(name,str(e),code)
  checks.append(name);return
 raise AssertionError(name+' unexpectedly accepted')

# Current controller mechanics; byte fixtures never claim historical Storage acceptance.
reuse_pin=None;reused=[]
work=OUT/'independent.sqlite';work.write_bytes(b'fictional bytes, not a database');os.chmod(work,0o600)
work_before=digest(work);protected_before={}
record=dict(version=1,purpose='post_stop_guarded_workbench',scope='post_stop_preserved_copy',fixture=True,working=dict(path=str(work),sha256=work_before),productionExecutable=False,automaticResume=False,restoreDatabase=False,preStopDrained='unverified',gracefulExit='unverified',externalOperationOutcomes='unverified',evidence={})
testman={};releases={}
for role in ['candidate','controlled-baseline']:
 root=OUT/role;entry=root/'apps/server/lib/index.js';entry.parent.mkdir(parents=True);entry.write_text('// virtual child, never executed')
 loader=root/'packages/storage/lib/post-stop-admission.js';loader.parent.mkdir(parents=True)
 loader.write_text("import fs from 'node:fs';export function loadPostStopAdmission(database,pin){const r=JSON.parse(fs.readFileSync(pin.path));if(r.working.path!==database||r.productionExecutable!==false||r.preStopDrained!=='unverified')throw Error('fixture_record_rejected');}")
 (root/'package.json').write_text('{"type":"module"}')
 # Alternate loader exists solely for the wrong-loader rejection case.
 (loader.parent/'readonly-schema-admission.js').write_text('// wrong loader')
 env=root/'fixture.env';env.write_text('# fictional, never loaded')
 mm=dict(mode='guarded-workbench',projectRoot=str(root),databasePath=str(work),origin='http://127.0.0.1:8787',envPath=str(env),files=[dict(path='packages/storage/lib/post-stop-admission.js',sha256=digest(loader))])
 testman[role]=write(role+'-manifest.json',mm);releases[role]=dict(root=root,entry=entry,loader=loader)
 record['candidate' if role=='candidate' else 'rollback']=dict(databasePath=str(work),artifactSha256=testman[role]['sha256'],origin=mm['origin'])
template_pin=write('template.json',record)
import shutil
node_path=Path(shutil.which('node')).resolve(strict=True)

class VirtualOS:
 def __init__(self):self.child=None;self.permission=False
 def __call__(self,argv):
  assert argv[0] in ['/bin/ps','/bin/launchctl','/usr/sbin/lsof']
  if argv[0]=='/bin/ps':
   text='100 1 501 Fri Oct 23 10:00:00 2026 /fixture/other\n'
   if self.child and self.child.active:text+=f'{self.child.pid} {os.getpid()} {os.getuid()} Mon Oct 26 10:00:00 2026 {self.child.executable}\n'
   return subprocess.CompletedProcess(argv,0,text,'')
  if argv[0]=='/bin/launchctl':
   if argv[1]=='print':return subprocess.CompletedProcess(argv,113,'','Could not find service "io.landi.fixture" in domain for user gui: 501')
   return subprocess.CompletedProcess(argv,0,'"io.landi.fixture" => true','')
  if self.permission:return subprocess.CompletedProcess(argv,1,'','permission denied')
  if self.child and self.child.active and any(x.startswith('-iTCP:') for x in argv):
   return subprocess.CompletedProcess(argv,0,f'p{self.child.pid}\ncnode\nf13\ntIPv4\nn127.0.0.1:8787\n','')
  return subprocess.CompletedProcess(argv,1,'','')
osview=VirtualOS();m.OSObserver._run=staticmethod(osview)
original_observer=m.create_session_observer
def make_observer(plan,journal,resolution):
 o=m.OSObserver(journal,runner=osview,path_resolver=lambda p:dict(path=p,device=1,inode=100 if p=='/fixture/old' else 200))
 def kernel(operation,pid):
  child=osview.child
  if operation=='path':return child.executable if child and pid==child.pid else '/fixture/other'
  return dict(pid=pid,parentPid=os.getpid() if child and pid==child.pid else 1,uid=os.getuid() if child and pid==child.pid else 501,realUid=os.getuid() if child and pid==child.pid else 501,startSeconds=100,startMicroseconds=1)
 o.kernel_reader=kernel;o.fixture=False
 return o
m.create_session_observer=make_observer

class VirtualChild:
 def __init__(self,args,kw):
  self.pid=47890;self.active=True;self.code=None;self.executable=args[0];self.env=kw['env']
  self.cmd=os.dup(int(self.env['LANDI_DEPLOY_COMMAND_FD']));self.event=os.dup(int(self.env['LANDI_DEPLOY_EVENT_FD']));self.lock=os.dup(int(self.env['LANDI_DEPLOY_LOCK_FD']))
  self.controller_command=None;self.closed=False;self.bad_ready=False
  self.emit('ready');children.append(self);osview.child=self
 def emit(self,event):
  payload=dict(version=1,deploymentId=self.env['LANDI_DEPLOY_ID'],nonce=self.env['LANDI_DEPLOY_NONCE'],event=event,pid=self.pid,parentPid=os.getpid(),manifestSha256=self.env['LANDI_GUARDED_MANIFEST_SHA256'],databasePath=str(work),origin='http://127.0.0.1:8787')
  original_write(self.event,(json.dumps(payload)+'\n').encode())
 def poll(self):return None if self.active else self.code
 def wait(self,timeout=None):
  assert self.closed,'wait before valid shutdown command'
  assert self.controller_command is not None
  # writer must be closed before wait. Checking its descriptor gives EBADF.
  try:os.fstat(self.controller_command)
  except OSError:pass
  else:raise AssertionError('controller command writer retained during wait')
  self.active=False;self.code=0;self.cleanup();return 0
 def cleanup(self):
  for field in ['cmd','event','lock']:
   fd=getattr(self,field,None)
   if fd is not None:
    os.close(fd);setattr(self,field,None)

def virtual_popen(args,*a,**kw):
 if len(args)==2 and args[1].endswith('/apps/server/lib/index.js'):
  return VirtualChild(args,kw)
 # Only filesystem-loader Node queries are allowed to run as real subprocesses.
 assert len(args)>3 and args[1:3]==['--input-type=module','-e'],args
 return original_popen(args,*a,**kw)

def virtual_write(fd,data):
 result=original_write(fd,data)
 child=osview.child
 if child and child.active and child.controller_command==fd:
  frame=os.read(child.cmd,4096);assert json.loads(frame)['op']=='shutdown'
  child.closed=True;child.emit('closed')
 return result
subprocess.Popen=virtual_popen;os.write=virtual_write

def plan(role='candidate'):
 release=releases[role]
 p=dict(purpose='guarded_control_session',explicitStart=True,productionExecutable=False,controller=pin(C/'scripts/guarded-deployment-control.py'),databasePath=str(work),template=template_pin,node=pin(node_path),loader=pin(release['loader']),spec=dict(executable=str(node_path),executable_sha256=digest(node_path),release_root=str(release['root']),entry_sha256=digest(release['entry']),manifest_path=testman[role]['path'],manifest_sha256=testman[role]['sha256'],admission_path=str(OUT/'not-created.json'),admission_sha256='0'*64,origin='http://127.0.0.1:8787',fixture=False),subject=dict(old_pid=999,label='io.landi.fixture',replacement_executables=['/fixture/old']))
 return p

def create(value=None):
 global counter
 counter+=1;p=write(f'plan-{counter}.json',value or plan());j=m.Journal(OUT/f'journal-{counter}')
 s=m.ControlledSession(p,j);sessions.append(s);return s

def drop_fixture(s):
 # Test-owned cleanup only. Never part of the production session implementation.
 if s.controller and s.controller.child:
  child=s.controller.child;child.active=False;child.cleanup()
  for key in ['command_fd','event_fd']:
   fd=getattr(s.controller,key,None)
   if fd is not None:os.close(fd);setattr(s.controller,key,None)
 if s.lease and not s.lease.released:s.lease.close_descriptor_without_unlock()
 osview.child=None

try:
 if not reused:
  # Nonfixture controller prepare branch with synthetic filesystem validator and virtual process.
  for role in ['candidate','controlled-baseline']:
   s=create(plan(role));status=s.start();child=s.controller.child;child.controller_command=s.controller.command_fd
   assert status['state']=='running' and status['leaseDescriptorRetained'] and s.spec.fixture is False
   assert s.controller.prepared[3] is False
   checks.append(role+'_formal_prepare_fixture_loader_virtual_launch')
   other=m.Journal(OUT/(role+'-competing-journal'))
   reject(role+'_continuous_lease_blocks_competing_owner',lambda:m.DeploymentLease(str(work),other))
   reject(role+'_wrong_command_identity',lambda:s.command({'op':'shutdown','deploymentId':'wrong'}))
   reject(role+'_no_resume_or_rollback',lambda:s.command({'op':'resume','deploymentId':s.controller.deployment_id}))
   assert s.command({'op':'status','deploymentId':s.controller.deployment_id})['cachedOnly']
   r=s.command({'op':'shutdown','deploymentId':s.controller.deployment_id});assert r['state']=='closed' and not r['leaseDescriptorRetained']
   events=[read(p)['event'] for p in sorted(s.journal.directory.glob('*.json'))]
   assert events.index('admission-validated')<events.index('session-launch-requested')<events.index('session-running')<events.index('closed-verified')<events.index('lease-released')<events.index('session-closed')
   assert events.count('lease-acquired')==1 and events.count('spawned')==1
   checks.append(role+'_same_session_explicit_close_and_release_order')
   reject(role+'_cannot_restart_closed_session',s.start)
   drop_fixture(s)
  # Plan rejection before lease or subprocess.
  for kind in ['purpose','explicitStart','productionExecutable','controller','fixture','work']:
   value=plan()
   if kind=='controller':value[kind]['sha256']='0'*64
   elif kind=='fixture':value['spec']['fixture']=True
   elif kind=='work':value['databasePath']='/fictional/mismatched.sqlite'
   else:value[kind]={'purpose':'wrong','explicitStart':False,'productionExecutable':True}[kind]
   reject('plan_'+kind+'_rejected',lambda value=value:create(value))
 # Actual formal binding checks (not fixture=True shortcuts).
 for kind in ['node','loader','origin','root','permission','workDigest']:
  value=plan()
  if kind=='node':value['node']={**value['node'],'path':'/fixture/wrong-node'}
  elif kind=='loader':value['loader']=pin(Path(value['spec']['release_root'])/'packages/storage/lib/readonly-schema-admission.js')
  elif kind=='origin':value['spec']['origin']='http://127.0.0.1:18787'
  elif kind=='root':value['spec']['release_root']='/fixture/wrong-root'
  elif kind=='workDigest':
   v=json.loads(json.dumps(record));v['working']['sha256']='0'*64;value['template']=write('bad-work-template.json',v)
  osview.permission=kind=='permission';s=create(value)
  reject('formal_'+kind+'_rejected',s.start,missing=(kind=='node'))
  assert s.state=='unverified' and s.controller.child is None and not s.lease.released
  reject('failed_session_cannot_retry',s.start)
  drop_fixture(s);osview.permission=False
 # Successful preparation becoming stale/conflicting before launch must retain lease.
 original_prepare=m.prepare_admission
 for kind in ['stale','conflict']:
  def corrupt(*args,kind=kind,**kwargs):
   result=original_prepare(*args,**kwargs);c=args[0];pin_,at,manifest,fixture=c.prepared
   c.prepared=(pin_, '2020-01-01T00:00:00+00:00' if kind=='stale' else at,
               '0'*64 if kind=='conflict' else manifest,fixture);return result
  m.prepare_admission=corrupt;s=create();reject('formal_'+kind+'_admission_blocks_launch',s.start)
  assert s.controller.child is None and not s.lease.released;drop_fixture(s)
 m.prepare_admission=original_prepare
 # Explicit close loses owner evidence: no pipe write or release, no second attempt.
 s=create();s.start();s.controller.child.controller_command=s.controller.command_fd;osview.permission=True
 # A process-query failure is injected here rather than issuing a real command.
 prior=s.controller.observe_process
 s.controller.observe_process=lambda pid:None
 reject('close_owner_loss_retains_lease',lambda:s.command({'op':'shutdown','deploymentId':s.controller.deployment_id}))
 assert s.state=='unverified' and not s.lease.released and not s.controller.child.closed
 reject('uncertain_close_cannot_retry',lambda:s.command({'op':'shutdown','deploymentId':s.controller.deployment_id}))
 drop_fixture(s);osview.permission=False
 # Anonymous operator-pipe acceptance is now the separate guarded-operator-pipe.test.py entry.
 assert digest(work)==work_before
 for p,h in protected_before.items():assert digest(p)==h
 write('verification.json',{'status':'passed','checks':checks,'reusedChecks':reused,'reuseEvidence':reuse_pin,'source':pin(C/'scripts/guarded-deployment-control.py'),'test':pin(Path(__file__)),'productionExecutable':False,'realOSCommandsRun':False,'realServicesStarted':False,'listenersStarted':False,'formalBranch':True,'PopenServiceCalls':'virtual_only','validator':'synthetic_loader_mechanism_only','databaseOpened':False,'historicalTestsRun':False,'realAdmissionCreated':False,'preservedAndIndependentBytesUnchanged':True,'artifactUnitsModified':False})
 print(json.dumps({'status':'passed','newChecks':len(checks),'reusedChecks':len(reused),'evidence':str(OUT/'verification.json')}))
except BaseException as e:
 write('failure.json',{'status':'failed_stopped','error':repr(e),'passed':checks,'reusedChecks':reused,'reuseEvidence':reuse_pin,'source':pin(C/'scripts/guarded-deployment-control.py'),'automaticRetry':False,'realServicesStarted':False});print(str(OUT/'failure.json'));raise
finally:
 for s in sessions:drop_fixture(s)
 os.write=original_write;subprocess.Popen=original_popen;m.OSObserver._run=original_os_run;m.create_session_observer=original_observer
