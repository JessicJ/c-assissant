"""New fixtures only: no host OS queries, SQLite, real child or listener."""
import dataclasses
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('guarded_control', Path(__file__).with_name('guarded-deployment-control.py'))
m = importlib.util.module_from_spec(spec); sys.modules[spec.name] = m; spec.loader.exec_module(m)
root = Path(tempfile.mkdtemp(prefix='landi-os-observer-check-', dir=None)).resolve()
checks = []
def save(name, value):
    p = root/name; p.write_text(json.dumps(value)); return {'path': str(p), 'sha256': m.digest(p)}
def rejected(name, fn):
    try: fn()
    except (m.ControlError, KeyError, ValueError): checks.append(name); return
    raise AssertionError(name+' unexpectedly accepted')

class FakeOS:
    def __init__(self): self.mode = 'normal'; self.calls = []
    def __call__(self, argv):
        self.calls.append(argv)
        if argv[0] == '/bin/ps':
            text = '100 1 501 Fri Oct 23 10:00:00 2026 /fixture/other\n'
            if self.mode == 'replacement': text += '101 1 501 Fri Oct 23 10:00:00 2026 /fixture/old\n'
            if self.mode == 'parse': text = 'invalid\n'
            return subprocess.CompletedProcess(argv, 0, text, '')
        if argv[1] == 'print':
            return subprocess.CompletedProcess(argv, 113, '', 'Could not find service "io.landi.fixture" in domain for user gui: 501')
        if argv[1] == 'print-disabled':
            value = 'false' if self.mode == 'disabled' else 'true'
            return subprocess.CompletedProcess(argv, 0, '"io.landi.fixture" => '+value, '')
        if self.mode == 'permission': return subprocess.CompletedProcess(argv, 1, '', 'permission denied')
        if self.mode == 'occupied': return subprocess.CompletedProcess(argv, 0, 'p100\ncnode\nf13\ntREG\nn/fixture/database\n', '')
        return subprocess.CompletedProcess(argv, 1, '', '')

def kernel(operation,pid):
    if operation=='path':return '/fixture/old' if pid==101 else '/fixture/other'
    return dict(pid=pid,parentPid=1,uid=501,realUid=501,startSeconds=100,startMicroseconds=1)
def resolver(path):
    if path not in ['/fixture/old','/fixture/other']:raise FileNotFoundError(path)
    return dict(path=path,device=1,inode=1 if path=='/fixture/old' else 2)
try:
    journal = m.Journal(root/'journal'); fake = FakeOS(); observer = m.OSObserver(journal, fake, path_resolver=resolver,kernel_reader=kernel)
    database = root/'fictional.sqlite'; database.write_bytes(b'fictional data, not SQLite')
    subject = dict(old_pid=999, label='io.landi.fixture', replacement_executables=['/fixture/old'])
    observation = observer.exclusive(str(database), 'http://127.0.0.1:18787', **subject)
    assert observation['fixture'] and observation['fileUsersAbsent'] and len(observation['records']) == 20
    checks.append('two_rounds_fixture_observation_with_raw_pins')
    for mode in ['replacement', 'parse', 'disabled', 'permission', 'occupied']:
        fake.mode = mode
        rejected(mode+'_rejects_unverified', lambda: observer.exclusive(str(database), 'http://127.0.0.1:18787', **subject))
    fake.mode = 'occupied'
    assert observer.lsof(['--',str(database)])[0]['fd'] == '13'
    checks.append('numeric_f13_retained')
    fake.mode = 'normal'
    times = iter([100, 116]); stale = m.OSObserver(journal, fake, lambda: next(times),path_resolver=resolver,kernel_reader=kernel)
    rejected('observation_window_expired', lambda: stale.exclusive(str(database), 'http://127.0.0.1:18787', **subject))
    rejected('missing_subject', lambda: observer.exclusive(str(database), 'http://127.0.0.1:18787', old_pid=999,label='io.landi.fixture',replacement_executables=[]))
    lease = m.DeploymentLease(str(database), journal)
    def controller():
        c = m.OwnedProcess(lease,journal,observer.observe_process,observer.observe_listener,observer.observe_file_users)
        c.observer = observer; return c
    launch = m.LaunchSpec('/fixture/node','a'*64,'/fixture/release','b'*64,'/fixture/manifest','c'*64,'/fixture/admission','d'*64,'http://127.0.0.1:18787',True)
    template = dict(version=1,purpose='post_stop_guarded_workbench',scope='post_stop_preserved_copy',
                    productionExecutable=False,automaticResume=False,restoreDatabase=False,
                    preStopDrained='unverified',gracefulExit='unverified',externalOperationOutcomes='unverified',
                    working={'path':str(database),'sha256':m.digest(database)},
                    candidate={'artifactSha256':'c'*64,'origin':launch.origin},
                    rollback={'artifactSha256':'e'*64,'origin':launch.origin}, evidence={})
    template_pin = save('template.json',template)
    validations=[]
    def fixture_validator(db,pin):
        value=m.read_pin(pin); assert db == str(database)
        obs=m.read_pin(value['evidence']['currentObservation']); assert obs['fixture'] is True
        assert value['preStopDrained']=='unverified'; validations.append(pin)
    c=controller(); prepared=m.prepare_admission(c,launch,template_pin,subject,fixture_validator,fixture=True)
    assert validations and c.child is None and prepared.admission_sha256 == validations[-1]['sha256']
    checks.append('same_lease_prepare_calls_validator_no_launch')
    rejected('fixture_cannot_prepare_real_admission', lambda:m.prepare_admission(controller(),launch,template_pin,subject,fixture_validator))
    bad=dict(template); bad['preStopDrained']='verified'
    rejected('historical_unknown_preserved',lambda:m.prepare_admission(controller(),launch,save('bad.json',bad),subject,fixture_validator,fixture=True))
    def deny(db,pin): raise m.ControlError('full_validator_denied')
    c=controller()
    rejected('full_validator_failure_blocks', lambda:m.prepare_admission(c,launch,template_pin,subject,deny,fixture=True))
    assert c.failed
    rejected('no_live_prepare_no_launch',lambda:controller().launch(dataclasses.replace(launch,fixture=False)))
    c=controller(); c.observer.fixture=False
    c.prepared=({'path':launch.admission_path,'sha256':launch.admission_sha256},'2020-01-01T00:00:00+00:00',launch.manifest_sha256,False)
    rejected('expired_live_prepare_no_launch',lambda:c.launch(dataclasses.replace(launch,fixture=False)))
    c.prepared=({'path':'/conflicting','sha256':'f'*64},datetime.datetime.now(datetime.timezone.utc).isoformat(),launch.manifest_sha256,False)
    rejected('conflicting_live_prepare_no_launch',lambda:c.launch(dataclasses.replace(launch,fixture=False)))
    lease.close_descriptor_without_unlock()
    result={'status':'passed','checks':checks,'scope':'fictional_OS_command_results_and_private_files_only',
            'actualOSCommandsRun':False,'servicesStarted':False,'databaseOpened':False,
            'productionExecutable':False,'realAdmissionCreated':False,'historicalTestsRun':False}
    save('verification.json',result)
    print(json.dumps({'evidence':str(root/'verification.json'),'checks':len(checks),'status':'passed'}))
except BaseException as error:
    save('failure.json',{'status':'failed_stopped','error':repr(error),'passed':checks,'automaticRetry':False})
    print(str(root/'failure.json')); raise
