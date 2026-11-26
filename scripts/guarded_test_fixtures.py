"""Fresh synthetic facts shared by offline guarded tests; never load deployment data."""
import copy, hashlib, importlib.util, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(name):
 spec=importlib.util.spec_from_file_location(name.replace('-', '_'),ROOT/'scripts'/(name+'.py'))
 module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);return module
_scope=load('guarded-resource-scope')
_lease=load('guarded-lease-stages')
def runtime():
 p=Path(sys.executable).resolve(strict=True)
 return dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),version='.'.join(map(str,sys.version_info[:3])))
def identity(pid):return dict(pid=pid,parentPid=1,uid=501,realUid=501,startSeconds=1,startMicroseconds=123)
def file(path,inode):return dict(path=path,device=7,inode=inode,sha256='a'*64)
def resource_fixture():
    work=dict(**file('/fiction/work.sqlite',20),nlink=1)
    lock=dict(**file('/fiction/.landi-control/'+hashlib.sha256(work['path'].encode()).hexdigest()+'.lock',21),nlink=1,mode=0o600,uid=501)
    sub=dict(projectRoot='/fiction/landi',controllerIdentity=identity(10),oldIdentity=identity(11),
             deploymentIds=['candidate','baseline'],managerLabel='io.landi.local',host='127.0.0.1',port=8787,
             nodeFile=file('/fiction/node',30),entries=[file('/fiction/landi/index.js',40)],workFile=work,lockFile=lock)
    scope=_scope.canonical_sha256(sub);ident=identity(101);exe=file('/fiction/node',30)
    row=dict(identityBefore=ident,identityAfter=copy.deepcopy(ident),executableBefore=exe,executableAfter=copy.deepcopy(exe),
             launch=dict(source='authenticated_launcher',identity=ident,executable=exe,entry=file('/fiction/other/index.js',41),
                         projectRoot='/fiction/other',deploymentId='other',receiptSha256='b'*64),
             targetResourceCheck=dict(subjectSha256=scope,complete=True,listeners=[],fileUsers=[],controlOwners=[]))
    scan=dict(startedAtMs=100000,endedAtMs=100100,subjectSha256=scope,visibility='verified_complete_scoped',unknowns=[],
              manager=dict(label=sub['managerLabel'],absent=True,disabled=True),listeners=[],fileUsers=[],controlOwners=[],
              workFile=work,absentSidecars=['-wal','-shm','-journal'],
              lease=dict(lockFile=lock,ownerIdentity=sub['controllerIdentity'],acquiredNonblocking=True,heldContinuously=True,inheritedIdentityMatched=True),processes=[row])
    second=copy.deepcopy(scan);second.update(startedAtMs=100200,endedAtMs=100300)
    return dict(version=2,policyVersion=_scope.POLICY,productionExecutable=False,compatibilityEnabled=False,subject=sub,scans=[scan,second])
def trust(e):return dict(verified=True,evidenceSha256=_scope.canonical_sha256(e),subjectSha256=_scope.canonical_sha256(e.get('subject')),verifier=file('/fiction/verifier',99),verifiedAtMs=100400,expiresAtMs=115000)
def lease_fixture(sub):
 s=copy.deepcopy(sub);s['resourceSubjectSha256']=hashlib.sha256(__import__('json').dumps(sub,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();s.update(deploymentId='candidate',entryFile=s.pop('entries')[0],manifestSha256='b'*64,challenge='c'*64,channelId='d'*64)
 s.pop('deploymentIds');s.pop('oldIdentity');s.pop('managerLabel');s.pop('host');s.pop('port');s.pop('projectRoot')
 lease=dict(leaseId='e'*64,holderIdentity=s['controllerIdentity'],holderIdentityAfter=copy.deepcopy(s['controllerIdentity']),holderFd=8,
  lockFile=s['lockFile'],workFile=s['workFile'],acquiredNonblocking=True,heldContinuously=True,privateDirectoryVerified=True,
  capabilityVerified=True,unknowns=[],acquiredAtMs=99000,continuousThroughMs=100200)
 pre=dict(version=1,policyVersion=_lease.POLICY,stage='pre_start',productionExecutable=False,compatibilityEnabled=False,
  startedAtMs=100000,endedAtMs=100200,subject=s,lease=lease,childCreated=False,childIdentity=None,receiverFd=None,inheritance='pending',
  resourceAssessment=dict(policyVersion='landi-resource-conflicts-v1',subjectSha256=_lease._s.canonical_sha256(s),outcome='consistent',conflicts=[],unknowns=[],launcherSourcesVerified=True,evidenceSha256='f'*64,observedAtMs=100100))
 child=dict(pid=222,parentPid=s['controllerIdentity']['pid'],uid=501,realUid=501,startSeconds=100,startMicroseconds=500000)
 post=dict(version=1,policyVersion=_lease.POLICY,stage='pre_open',productionExecutable=False,compatibilityEnabled=False,
  startedAtMs=100400,endedAtMs=100800,subject=copy.deepcopy(s),lease=copy.deepcopy(lease),preStartSha256=_lease._s.canonical_sha256(pre),
  child=dict(identityBefore=child,identityAfter=copy.deepcopy(child),executableBefore=s['nodeFile'],executableAfter=copy.deepcopy(s['nodeFile']),entryFile=s['entryFile']),
  inheritance=dict(holderIdentity=s['controllerIdentity'],receiverIdentity=child,holderFd=8,receiverFd=9,holderLockFile=s['lockFile'],receiverLockFile=copy.deepcopy(s['lockFile']),sameInheritedCapabilityVerified=True),
  launcherSourceVerified=True,privateChannelVerified=True,
  barrier=dict(state='waiting_pre_open',deploymentId=s['deploymentId'],channelId=s['channelId'],manifestSha256=s['manifestSha256'],workFile=s['workFile'],childIdentity=child,databaseOpened=False,listenerStarted=False,backgroundStarted=False,continueReceived=False))
 post['lease']['continuousThroughMs']=post['endedAtMs']
 return pre,post
