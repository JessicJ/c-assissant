"""New fail-fast checks. Only fictional child processes and copied databases."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('landi_control', ROOT/'scripts/guarded-deployment-control.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
OUT = Path(tempfile.mkdtemp(prefix='landi-owned-control-')).resolve()
PRESERVED = OUT/'synthetic-source.sqlite'
# SQLite is created entirely by this test; it contains no application records.
import sqlite3
with sqlite3.connect(PRESERVED) as db:db.execute('CREATE TABLE fictional_record(value TEXT)');db.execute("INSERT INTO fictional_record VALUES ('synthetic')")
BEFORE = m.digest(PRESERVED)
NODE = str(Path(shutil.which('node')).resolve(strict=True))
checks = []
children = []
leases = []
sequence = 0


def fixture(scenario='normal'):
    global sequence
    sequence += 1
    area = OUT/f'fictional-{sequence}'
    area.mkdir(mode=0o700)
    work = area/'copied-work.sqlite'
    shutil.copyfile(PRESERVED, work)
    os.chmod(work, 0o600)
    journal = m.Journal(area/'journal')
    lease = m.DeploymentLease(work, journal)
    leases.append(lease)
    root = area/'fake-release'
    entry = root/'apps/server/lib/index.js'
    entry.parent.mkdir(parents=True)
    (root/'package.json').write_text('{"type":"module"}')
    marker = area/'owned-close-marker.json'
    source = '''import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {guardedProcessControlConfig,attachGuardedProcessControl} from MODULE;
const scenario=SCENARIO;
const config=guardedProcessControlConfig(process.env,true);
const identity={manifestSha256:process.env.LANDI_GUARDED_MANIFEST_SHA256,databasePath:process.env.LANDI_GUARDED_DATABASE_PATH,origin:'http://127.0.0.1:39973'};
if(scenario==='wrong-frame'){
 fs.writeSync(config.eventFd,JSON.stringify({version:1,deploymentId:config.deploymentId,nonce:'0'.repeat(64),event:'ready',pid:process.pid,parentPid:process.ppid,...identity})+'\\n');
 process.exit(0);
}
const database=new DatabaseSync(identity.databasePath,{readOnly:true});database.exec('PRAGMA query_only=ON');
const control=attachGuardedProcessControl(config,identity,async()=>{
 if(scenario==='close-failure')throw Error('fictional resource failure');
 if(scenario==='close-timeout')await new Promise(()=>{});
 database.close();fs.writeFileSync(MARKER,JSON.stringify({closed:true,fixture:true}),{mode:0o600});
});
await control.ready();
// A finite fictional fixture lifetime permits test cleanup without kill/retry.
if(scenario!=='normal')setTimeout(()=>process.exit(0),1200);
'''
    source = source.replace('MODULE', json.dumps((ROOT/'apps/server/src/guarded-process-control.ts').as_uri())).replace('SCENARIO', json.dumps(scenario)).replace('MARKER', json.dumps(str(marker)))
    entry.write_text(source)
    env = area/'fake.env'
    env.write_text('# fictional, never loaded\n')
    manifest = area/'manifest.json'
    manifest.write_text(json.dumps({'mode':'guarded-workbench','projectRoot':str(root),'databasePath':str(work),'origin':'http://127.0.0.1:39973','envPath':str(env)}))
    admission = area/'admission.json'
    admission.write_text(json.dumps({'purpose':'post_stop_guarded_workbench','productionExecutable':False,'automaticResume':False,'restoreDatabase':False,'fixture':True}))
    launch = m.LaunchSpec(executable=NODE,executable_sha256=m.digest(NODE),release_root=str(root),entry_sha256=m.digest(entry),manifest_path=str(manifest),manifest_sha256=m.digest(manifest),admission_path=str(admission),admission_sha256=m.digest(admission),origin='http://127.0.0.1:39973',fixture=True)
    state = {'changed':False}
    holder = {}
    def process(pid):
        c = holder['controller']
        if c.child.poll() is not None:
            return None
        return {'pid':pid,'parentPid':os.getpid(),'uid':os.getuid(),'executable':NODE,
                'startedAt':'fictional-reused-start' if state['changed'] else f'fictional-start-{pid}'}
    controller = m.OwnedProcess(lease,journal,process,lambda pid,origin: pid is not None,lambda work:False)
    holder['controller'] = controller
    children.append(controller)
    return area, work, lease, controller, launch, state, marker


def expected(error, fn):
    try:
        fn()
    except error:
        return
    raise AssertionError('Expected rejection did not occur')


def cleanup_fake(controller, lease):
    # Explicit fixture-only cleanup, not controller retry/restart/kill. End the
    # test-owned pipe so the finite fake child can finish its pipe-reader thread.
    if controller.child is not None:
        fd = getattr(controller, 'command_fd', None)
        if isinstance(fd, int):
            os.close(fd)
            controller.command_fd = None
        controller.child.wait(timeout=5)
        fd = getattr(controller, 'event_fd', None)
        if isinstance(fd, int):
            os.close(fd)
            controller.event_fd = None
    lease.close_descriptor_without_unlock()


try:
    area,work,lease,c,launch,state,marker = fixture()
    second = m.Journal(area/'second-journal')
    expected(BlockingIOError,lambda:m.DeploymentLease(work,second))
    checks.append({'name':'duplicate lock rejected before child creation','status':'passed'})
    c.launch(launch)
    c.request_shutdown(timeout=3)
    assert marker.exists() and lease.released and c.child.returncode == 0 and m.digest(work) == BEFORE
    events = [json.loads(p.read_text()) for p in sorted((area/'journal').glob('*.json'))]
    closed = next(x['sequence'] for x in events if x.get('protocolEvent')=='closed')
    pipe = next(x['sequence'] for x in events if x.get('event')=='command-pipe-closed')
    verified = next(x['sequence'] for x in events if x.get('event')=='closed-verified')
    released = next(x['sequence'] for x in events if x.get('event')=='lease-released')
    assert closed < pipe < verified < released
    assert c.command_fd is None and c.event_fd is None
    checks.append({'name':'private pipes, inherited capabilities, owner receipt, normal close and lock release','status':'passed'})

    area,work,lease,c,launch,state,marker = fixture()
    c.launch(launch)
    lease.close_descriptor_without_unlock()
    second = m.Journal(area/'second-journal')
    expected(BlockingIOError,lambda:m.DeploymentLease(work,second))
    os.write(c.command_fd,(json.dumps({'version':1,'deploymentId':c.deployment_id,'nonce':c.nonce,'op':'shutdown'})+'\n').encode())
    assert c._event(3)['event']=='closed'
    os.close(c.command_fd)
    c.command_fd = None
    c.child.wait(timeout=3)
    os.close(c.event_fd)
    fresh = m.DeploymentLease(work,m.Journal(area/'after-exit-journal'))
    fresh.release_verified(child_exited=True,listener_absent=True,file_users_absent=True,closed_receipt=True)
    checks.append({'name':'child retains kernel lock after controller descriptor disappears','status':'passed'})

    area,work,lease,c,launch,state,marker = fixture('identity-conflict')
    c.launch(launch)
    state['changed']=True
    expected(m.ControlError,lambda:c.request_shutdown(timeout=1))
    assert c.failed and not marker.exists() and not lease.released
    cleanup_fake(c,lease)
    checks.append({'name':'changed OS start identity rejected before shutdown command','status':'passed'})

    area,work,lease,c,launch,state,marker = fixture('close-failure')
    c.launch(launch)
    expected(m.ControlError,lambda:c.request_shutdown(timeout=1))
    assert c.failed and not lease.released and not marker.exists()
    expected(m.ControlError,lambda:c.request_shutdown(timeout=1))
    cleanup_fake(c,lease)
    checks.append({'name':'shutdown failure stays unverified and cannot retry or unlock','status':'passed'})

    area,work,lease,c,launch,state,marker = fixture('close-timeout')
    c.launch(launch)
    expected(m.ControlError,lambda:c.request_shutdown(timeout=0.05))
    assert c.failed and c.child.poll() is None and not lease.released
    cleanup_fake(c,lease)
    checks.append({'name':'timeout neither kills nor restarts fictional child','status':'passed'})

    area,work,lease,c,launch,state,marker = fixture()
    c.launch(launch)
    os.close(c.command_fd)
    assert c._event(3)['event']=='closed'
    c.child.wait(timeout=3)
    assert marker.exists()
    lease.release_verified(child_exited=True,listener_absent=True,file_users_absent=True,closed_receipt=True)
    os.close(c.event_fd)
    checks.append({'name':'parent pipe EOF closes owned fake database and child exits','status':'passed'})

    area,work,lease,c,launch,state,marker = fixture('wrong-frame')
    expected(m.ControlError,lambda:c.launch(launch))
    assert c.failed and not lease.released
    cleanup_fake(c,lease)
    checks.append({'name':'wrong deployment nonce cannot establish owner','status':'passed'})

    area,work,lease,c,launch,state,marker = fixture()
    expected(m.ControlError,lambda:lease.release_verified(child_exited=True,listener_absent=True,file_users_absent=True,closed_receipt=False))
    lease.close_descriptor_without_unlock()
    assert m.digest(PRESERVED)==BEFORE
    assert all(m.digest(p)==BEFORE for p in OUT.glob('fictional-*/copied-work.sqlite'))
    checks.append({'name':'missing close receipt blocks release; protected and copied bytes unchanged','status':'passed'})
    (OUT/'python-control-checks.json').write_text(json.dumps({'status':'passed','checks':checks,'scope':'fictional_Node_children_and_private_pipes_only','productionExecutable':False,'realServicesStarted':False,'OSObservers':'explicitly_fictional','preservedUnchanged':True},indent=2))
    os.chmod(OUT/'python-control-checks.json',0o600)
    print(json.dumps({'status':'passed','checks':len(checks)}))
except BaseException as error:
    failure={'status':'failed_stopped','error':repr(error),'checks':checks,'automaticRetry':False,
             'fictionalChildPids':[c.child.pid for c in children if c.child is not None],
             'note':'No process was killed or restarted. Any fixture timers may still complete.'}
    (OUT/'python-control-failure.json').write_text(json.dumps(failure,indent=2))
    os.chmod(OUT/'python-control-failure.json',0o600)
    print(json.dumps(failure))
    raise SystemExit(1)
