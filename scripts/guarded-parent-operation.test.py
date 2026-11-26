"""New parent-only checks. Virtual OS/controller/business child; actual private pipes
and locks on a byte-identical independent copy. No service/SQLite/listener/build.
"""
from pathlib import Path
from guarded_test_fixtures import runtime as fixture_runtime
import ast,copy,hashlib,importlib.util,json,os,shutil,subprocess,sys,tempfile,threading
C=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('parent_control',C/'scripts/guarded-deployment-control.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
OUT=Path(tempfile.mkdtemp(prefix='landi-parent-operation-',dir=None)).resolve();os.chmod(OUT,0o700)
checks=[];operations=[];controllers=[];counter=0;reused_parent=[]

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pin(p):return {'path':str(p),'sha256':sha(p)}
def read(p):return json.loads(Path(p).read_text())
def write(name,value):
 p=OUT/name;fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2)
 return pin(p)
def reject(name,fn,code=None):
 try:fn()
 except (m.ControlError,BlockingIOError) as e:
  if code:assert code in str(e),(name,str(e),code)
  checks.append(name);return
 raise AssertionError(name+' unexpectedly accepted')

snapshot=OUT/'fictional-source.sqlite';snapshot.write_bytes(b'fictional bytes, not SQLite')
snapshot_before=sha(snapshot)
work=OUT/'independent.sqlite';shutil.copyfile(snapshot,work);os.chmod(work,0o600);work_before=sha(work)
template=dict(purpose='guarded_control_session',explicitStart=False,productionExecutable=False,databasePath=str(work),controller=pin(C/'scripts/guarded-deployment-control.py'),spec=dict(executable='/fixture/node',manifest_sha256='a'*64,origin='http://127.0.0.1:8787'))
template_pin=write('fictional-static-template.json',template)
request=dict(purpose='guarded_parent_operation',explicitStart=True,productionExecutable=False,sessionTemplate=template_pin,runtimeBinding=write('runtime.json',dict(python=fixture_runtime())))
template['runtimeBinding']=request['runtimeBinding']
# Re-pin the static template after consensus fields are complete.
Path(template_pin['path']).write_text(json.dumps(template));template_pin=pin(template_pin['path']);request['sessionTemplate']=template_pin
original_template=template_pin

class Kernel:
 def __init__(self):self.child=None;self.change_parent=False;self.change_child=False;self.change_pipe=False
 def identity(self,pid):
  if pid==os.getpid():return dict(pid=pid,uid=os.getuid(),realUid=os.getuid(),startSeconds=123+(1 if self.change_parent else 0),startMicroseconds=456)
  assert self.child and pid==self.child.pid
  return dict(pid=pid,uid=os.getuid(),realUid=os.getuid(),startSeconds=567+(1 if self.change_child else 0),startMicroseconds=890)
 def endpoint(self,pid,fd):
  if self.child and pid==self.child.pid:access=1
  else:access=1 if m.fcntl.fcntl(fd,m.fcntl.F_GETFL)&os.O_ACCMODE==os.O_RDONLY else 2
  handle=101 if access==1 else 202
  if self.change_pipe and access==2:handle=303
  return dict(handle=handle,peer=202 if access==1 else 101,access=access)

class VirtualController:
 def __init__(self,args,kwargs,kernel,mode):
  self.pid=424242;self.kernel=kernel;self.kernel.child=self;self.mode=mode;self.code=None;self.commands=[];self.stopping=False;self.command_received=threading.Event();self.allow_close=threading.Event()
  assert args[1]==str(C/'scripts/guarded-deployment-control.py')
  self.plan=m.read_pin({'path':args[args.index('--session-plan')+1],'sha256':args[args.index('--plan-sha256')+1]})
  source_fd=int(args[args.index('--session-command-fd')+1]);self.reader=os.dup(source_fd)
  assert kwargs['pass_fds']==(source_fd,) and self.plan['operatorPipe']['writerFd'] not in kwargs['pass_fds']
  assert kwargs['close_fds'] is True and set(kwargs['env'])=={'PATH','LANG','PYTHONDONTWRITEBYTECODE'}
  assert not os.get_inheritable(self.plan['operatorPipe']['writerFd'])
  assert self.plan['explicitStart'] is True and self.plan['productionExecutable'] is False
  oldppid=m.os.getppid
  try:
   m.os.getppid=lambda:os.getpid()
   m.validate_operator_pipe(source_fd,self.plan['operatorPipe'],inspector=kernel)
  finally:m.os.getppid=oldppid
  self.journal=m.Journal(Path(args[args.index('--journal')+1]))
  self.lease=m.DeploymentLease(str(work),self.journal)
  self.id='a'*32;self.owner={'pid':424243,'parentPid':self.pid,'uid':os.getuid(),'executable':self.plan['spec']['executable'],'startedAt':'fictional'}
  self.journal.append('owner-verified',deploymentId=self.id,owner=self.owner,manifestSha256=self.plan['spec']['manifest_sha256'],databasePath=str(work),origin=self.plan['spec']['origin'])
  if mode!='ready-timeout':self.journal.append('session-running',deploymentId=self.id,owner=self.owner,continuousLease=True)
  self.thread=threading.Thread(target=self.worker,daemon=True);self.thread.start();controllers.append(self)
 def worker(self):
  try:
   data=os.read(self.reader,4096)
   if not data:return
   frame=json.loads(data);self.commands.append(frame)
   assert frame=={'op':'shutdown','deploymentId':self.id}
   self.command_received.set()
   if self.mode=='deterministic-race':assert self.allow_close.wait(1),'fixture close barrier timeout'
   if self.mode=='close-timeout':
    while not self.stopping:threading.Event().wait(.01)
    return
   if self.mode=='exit-without-close':self.code=0;return
   if self.mode=='bad-close':
    self.journal.append('session-closed',deploymentId=self.id,verifiedClose=True);return
   self.journal.append('closed-verified',deploymentId=self.id,fixture=True)
   self.lease.release_verified(child_exited=True,listener_absent=True,file_users_absent=True,closed_receipt=True)
   self.journal.append('session-closed',deploymentId=self.id,verifiedClose=True)
   self.code=2 if self.mode=='nonzero-close' else 0
  except BaseException as error:
   self.error=repr(error);self.code=2
 def poll(self):return self.code
 def wait(self,timeout=None):
  self.thread.join(timeout)
  if self.thread.is_alive():raise subprocess.TimeoutExpired('virtual-controller',timeout)
  return self.code
 def cleanup(self):
  self.stopping=True
  # Test-owned fixture cleanup; never part of real parent/child error handling.
  self.thread.join(.2)
  os.close(self.reader)
  if not self.lease.released:self.lease.close_descriptor_without_unlock()


def create(value=None,mode='normal'):
 global counter
 counter+=1;kernel=Kernel();calls=[]
 def spawn(args,**kwargs):calls.append(args);return VirtualController(args,kwargs,kernel,mode)
 p=write('request-'+str(counter)+'.json',value or request);journal=m.Journal(OUT/('parent-'+str(counter)))
 op=m.ParentOperation(p,journal,inspector=kernel,popen=spawn);operations.append(op)
 return op,kernel,calls

def cleanup(op):
 if op.writer is not None:os.close(op.writer);op.writer=None
 if op.reader is not None:os.close(op.reader);op.reader=None
 if op.child:op.child.cleanup()

try:
 runtime=fixture_runtime()
 op,kernel,calls=create();op.start(timeout=1)
 output=op.shutdown(timeout=1)
 assert output['state']=='closed' and not output['writerRetained'] and op.child.code==0 and op.child.lease.released
 assert op.child.commands==[{'op':'shutdown','deploymentId':op.deployment_id}]
 parent_events=[read(p)['event'] for p in sorted(op.journal.directory.glob('*.json'))]
 assert parent_events.index('parent-controller-spawned')<parent_events.index('parent-session-ready')<parent_events.index('parent-shutdown-sent')<parent_events.index('parent-closed')
 checks.append('explicit_shutdown_verified_receipt_chain_exit_then_writer_close')
 reject('parent_cannot_start_twice',op.start)
 reject('parent_cannot_close_twice',op.shutdown)
 cleanup(op)
 # Force the final append+exit strictly between the snapshot and poll.
 op,kernel,calls=create(mode='deterministic-race');op.start(timeout=1)
 original_read=op._read_receipts;trace=[];forced=[False]
 def snapshot_then_finish():
  original_read()
  if op.shutdown_requested and not forced[0] and any(op.journal.directory.glob('*-parent-shutdown-sent.json')):
   assert not any(x['value']['event']=='session-closed' for x in op.receipts)
   assert op.child.command_received.wait(1)
   trace.append('snapshot_without_close')
   op.child.allow_close.set();op.child.thread.join(1)
   assert op.child.poll()==0 and not op.child.thread.is_alive()
   trace.append('child_closed_and_exited_after_snapshot');forced[0]=True
  elif forced[0]:trace.append('final_receipt_reread')
 op._read_receipts=snapshot_then_finish
 result=op.shutdown(timeout=1)
 assert forced[0] and result['state']=='closed' and not result['writerRetained']
 assert trace==['snapshot_without_close','child_closed_and_exited_after_snapshot','final_receipt_reread']
 assert len(op.child.commands)==1 and len(calls)==1
 write('deterministic-race.json',{'order':trace,'shutdownCommands':len(op.child.commands),'controllerSpawns':len(calls),'state':result['state'],'fixture':True})
 checks.append('deterministic_snapshot_then_close_exit_then_final_reread')
 cleanup(op)
 op,kernel,calls=create(mode='nonzero-close');op.start(timeout=1)
 reject('valid_close_chain_nonzero_exit_stays_unverified',lambda:op.shutdown(timeout=1),'controller_exit_failed')
 assert op.state=='unverified' and op.writer is not None and len(calls)==1
 cleanup(op)
 # Request authorization and template must fail before any virtual spawn.
 for field,value in [('purpose','wrong'),('explicitStart',False),('productionExecutable',True)]:
  invalid=copy.deepcopy(request);invalid[field]=value
  reject('request_'+field+'_rejected',lambda invalid=invalid:create(invalid))
 # Runtime/controller pin rejection before spawn.
 invalid=copy.deepcopy(template);invalid['controller']['sha256']='0'*64
 value={**request,'sessionTemplate':write('wrong-controller-template.json',invalid)}
 reject('controller_pin_mismatch_rejected',lambda:create(value))
 rb=read(request['runtimeBinding']['path']);rb['python']['sha256']='0'*64
 reject('python_digest_mismatch_rejected',lambda:create({**request,'runtimeBinding':write('bad-runtime.json',rb)}))
 for kind in ['symlink','version']:
  rb=read(request['runtimeBinding']['path'])
  if kind=='symlink':
   alias=OUT/'python-symlink';alias.symlink_to(rb['python']['path']);rb['python']['path']=str(alias)
  else:rb['python']['version']='0.0.0'
  reject('runtime_'+kind+'_rejected_before_spawn',lambda rb=rb:create({**request,'runtimeBinding':write('runtime-'+kind+'.json',rb)}))
 # Failure retains the writer and existing child lock; no second child or signal.
 for mode in ['ready-timeout','bad-close','exit-without-close','close-timeout','parent-change','child-change','pipe-change','journal-change']:
  op,kernel,calls=create(mode=mode)
  if mode=='ready-timeout':reject('ready_timeout_retains_parent_writer',lambda:op.start(timeout=.01),'ready_timeout')
  else:
   op.start(timeout=1)
   if mode=='parent-change':kernel.change_parent=True
   if mode=='child-change':kernel.change_child=True
   if mode=='pipe-change':kernel.change_pipe=True
   if mode=='journal-change':
    p=next(op.child.journal.directory.glob('000002-*.json'));v=read(p);v['owner']['uid']+=1
    p.write_text(json.dumps(v)+'\n')
   reject(mode+'_rejects_without_automatic_cleanup',lambda:op.shutdown(timeout=.03))
  assert op.state=='unverified' and op.writer is not None and not op.child.lease.released and len(calls)==1
  assert op.status()['writerRetained']
  reject(mode+'_cannot_retry_start',op.start)
  cleanup(op)
 assert sha(work)==work_before and sha(snapshot)==snapshot_before
 assert pin(template_pin['path'])==original_template
 checks.append('independent_copy_snapshot_and_static_template_unchanged')
 write('verification.json',{'status':'passed','checks':checks,'reusedChecks':0,'reusedParentChecks':reused_parent,'source':pin(C/'scripts/guarded-deployment-control.py'),'test':pin(Path(__file__)),'runtime':runtime,'realServicesStarted':False,'controllerAndBusinessProcesses':'virtual_only','OSAndKernelReplies':'fictional_only','anonymousPipes':'test_owned_only','databaseOpened':False,'databaseLock':'independent_fixture_only','compiled':False,'historicalTestsRun':False,'mahCommandsRun':False,'productionExecutable':False,'releaseArtifactsModified':False})
 print(json.dumps({'status':'passed','newChecks':len(checks),'reusedChecks':0,'evidence':str(OUT/'verification.json')}))
except BaseException as error:
 write('failure.json',{'status':'failed_stopped','error':repr(error),'passed':checks,'reusedParentChecks':reused_parent,'automaticRetry':False,'realServicesStarted':False,'source':pin(C/'scripts/guarded-deployment-control.py')});print(str(OUT/'failure.json'));raise
finally:
 for op in operations:
  try:cleanup(op)
  except OSError:pass
