"""Live local OS metadata observation only. Always rejects deployment admission.

No controller/Storage import, SQLite, lock acquisition, service mutation or signing.
Database paths are stat/lsof subjects only; contents are never opened.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

LIMIT=4_000_000
WINDOW_MS=15000


class Gap(ValueError):
    pass


def require(value,code):
    if not value:raise Gap(code)


class BSD(ctypes.Structure):
    _fields_=[*[(k,ctypes.c_uint32) for k in ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved')],
              ('comm',ctypes.c_char*16),('name',ctypes.c_char*32),
              *[(k,ctypes.c_uint32) for k in ('nfiles','pgid','pjobc','tdev','tpgid')],
              ('nice',ctypes.c_int32),('startsec',ctypes.c_uint64),('startusec',ctypes.c_uint64)]


def decode_identity(raw,pid):
    require(type(raw.get('returned')) is int and raw['returned']==136 and raw.get('errno')==0 and
            type(raw.get('errno')) is int,'native_identity_unverified')
    data=bytes.fromhex(raw['bytesHex']);require(len(data)==136,'native_identity_short')
    b=BSD.from_buffer_copy(data)
    require(b.pid==pid and pid>0 and b.startsec>0 and b.startusec<1000000,'native_identity_invalid')
    return dict(pid=b.pid,parentPid=b.ppid,uid=b.uid,realUid=b.ruid,startSeconds=b.startsec,startMicroseconds=b.startusec)


def metadata(path):
    p=Path(path)
    try:s=p.lstat()
    except FileNotFoundError:return dict(path=str(p),exists=False)
    require(stat.S_ISREG(s.st_mode) and str(p.resolve(strict=True))==str(p),'file_path_or_type_unverified')
    return dict(path=str(p),exists=True,device=s.st_dev,inode=s.st_ino,nlink=s.st_nlink,
                uid=s.st_uid,mode=stat.S_IMODE(s.st_mode),size=s.st_size,mtimeNs=s.st_mtime_ns)


class LiveBackend:
    def __init__(self):
        require(sys.platform=='darwin' and ctypes.sizeof(ctypes.c_void_p)==8 and
                ctypes.sizeof(BSD)==136 and BSD.startsec.offset==120 and BSD.startusec.offset==128,'native_ABI_unverified')
        self.lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
        self.lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
        self.lib.proc_pidinfo.restype=ctypes.c_int
        self.lib.proc_pidpath.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]
        self.lib.proc_pidpath.restype=ctypes.c_int

    def command(self,argv):
        # Only collector-generated fixed argv reaches this private backend.
        # Query output is spooled to private temporary files to bound memory.
        with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
            try:
                r=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=5,
                                 env={'PATH':os.defpath,'LC_ALL':'C'},check=False)
                result=dict(returncode=r.returncode,timeout=False)
            except subprocess.TimeoutExpired:result=dict(returncode=None,timeout=True)
            out.seek(0);err.seek(0);a=out.read(LIMIT+1);b=err.read(LIMIT+1)
        return dict(**result,stdoutHex=a.hex(),stderrHex=b.hex(),truncated=len(a)+len(b)>LIMIT)

    metadata=staticmethod(metadata)

    def identity(self,pid):
        buffer=ctypes.create_string_buffer(136);ctypes.set_errno(0)
        count=self.lib.proc_pidinfo(pid,3,0,buffer,136);error=ctypes.get_errno()
        return dict(returned=count,errno=error,bytesHex=buffer.raw.hex())

    def path(self,pid):
        buffer=ctypes.create_string_buffer(4096);ctypes.set_errno(0)
        count=self.lib.proc_pidpath(pid,buffer,4096);error=ctypes.get_errno()
        return dict(returned=count,errno=error,bytesHex=buffer.raw[:min(max(count,0),4096)].hex())


def collect(subject,backend,*,clock=lambda:time.time_ns()//1_000_000):
    """Backend injection is for targeted checks; it cannot authenticate evidence."""
    report=dict(version=1,status='rejected',observationStatus='unverified',subject=subject,
                sourceMode='local_OS_metadata',realEvidenceAuthenticated=False,
                visibility='unverified_current_user_OS_view',launcherStatus='unverified',leaseStatus='unverified',
                productionExecutable=False,compatibilityEnabled=False,admissionDecision='unchanged',
                executable=False,mayExempt=False,preStopDrained='unverified',externalOperationOutcomes='unverified',
                queries=[],scans=[],gaps=['launcher_source_missing','actual_lease_capability_missing',
                                        'query_visibility_not_independently_established'],collectionStopped=False)
    start=clock();report['startedAtMs']=start
    try:
        require(isinstance(subject,dict) and type(subject.get('port')) is int and 0<subject['port']<65536 and
                type(subject.get('uid')) is int and subject['uid']>=0 and type(subject.get('oldPid')) is int and subject['oldPid']>0 and
                isinstance(subject.get('managerLabel'),str) and re.fullmatch('[A-Za-z0-9_.-]+',subject['managerLabel']) and
                all(isinstance(subject.get(k),str) and subject[k].startswith('/') and '..' not in Path(subject[k]).parts
                    for k in ['databasePath','nodePath']),'subject_invalid')
        def query(argv):
            at=clock();raw=backend.command(argv)
            report['queries'].append(dict(argv=argv,startedAtMs=at,endedAtMs=clock(),raw=raw))
            require(raw.get('timeout') is False and raw.get('truncated') is False and
                    type(raw.get('returncode')) is int,'query_failed_or_truncated')
            a=bytes.fromhex(raw['stdoutHex']);b=bytes.fromhex(raw['stderrHex'])
            require(len(a)+len(b)<=LIMIT,'query_output_limit')
            return raw['returncode'],a.decode('utf-8','strict'),b.decode('utf-8','strict')
        node=backend.metadata(subject['nodePath']);require(node.get('exists') is True,'node_file_missing')
        report['nodeMetadata']=node
        for index in range(2):
            scan=dict(index=index,startedAtMs=clock(),files=[],processes=[]);report['scans'].append(scan)
            paths=[]
            for suffix in ['', '-wal','-shm','-journal']:
                item=backend.metadata(subject['databasePath']+suffix);scan['files'].append(item)
                if item['exists']:paths.append(item['path'])
            require(scan['files'][0]['exists'],'work_file_missing')
            label=subject['managerLabel'];target=f'gui/{subject["uid"]}/{label}'
            rc,out,err=query(['/bin/launchctl','print',target]);scan['managerAbsenceObserved']=bool(rc!=0 and not out.strip() and re.search(r'Could not find service "'+re.escape(label)+r'" in domain',err))
            require(scan['managerAbsenceObserved'],'manager_absence_unverified')
            rc,out,err=query(['/bin/launchctl','print-disabled',f'gui/{subject["uid"]}'])
            lines=[line for line in out.splitlines() if re.search(r'"'+re.escape(label)+r'"\s*=>',line)]
            scan['disabledObserved']=bool(rc==0 and not err and len(lines)==1 and re.fullmatch(r'\s*"'+re.escape(label)+r'"\s*=>\s*(true|disabled)\s*',lines[0]))
            require(scan['disabledObserved'],'disabled_state_unverified')
            for name,argv in [('port',['/usr/sbin/lsof','-nP','-iTCP:'+str(subject['port']),'-sTCP:LISTEN','-Fpcftn']),
                              ('fileUsers',['/usr/sbin/lsof','-nP','-Fpcftn','--',*paths])]:
                rc,out,err=query(argv);scan[name]=dict(emptyWithinCurrentVisibility=rc==1 and not out.strip() and not err)
                require(scan[name]['emptyWithinCurrentVisibility'],'resource_occupied_or_visibility_unverified')
            rc,out,err=query(['/bin/ps','-axo','pid=,ppid=,uid=,lstart=,comm='])
            require(rc==0 and not err and bool(out.strip()),'inventory_unverified')
            inventory={}
            for line in out.splitlines():
                fields=line.split(None,8)
                require(len(fields)==9 and all(x.isdecimal() for x in fields[:3]) and int(fields[0])>0 and int(fields[0]) not in inventory,'inventory_parse_invalid')
                inventory[int(fields[0])]=(int(fields[1]),int(fields[2]))
            for pid,(ppid,uid) in inventory.items():
                raw=dict(pid=pid);scan['processes'].append(raw)
                raw['identityBefore']=backend.identity(pid);before=decode_identity(raw['identityBefore'],pid)
                require((before['parentPid'],before['uid'])==(ppid,uid),'inventory_identity_conflict')
                identities=[]
                for name in ['pathBefore','pathAfter']:
                    value=backend.path(pid);raw[name]=value;data=bytes.fromhex(value['bytesHex'])
                    require(type(value['returned']) is int and value['errno']==0 and 0<value['returned']<4096 and len(data)==value['returned'] and b'\x00' not in data,'kernel_path_unverified')
                    info=backend.metadata(data.decode('utf-8','strict'));raw[name+'Metadata']=info;require(info['exists'],'kernel_file_missing');identities.append(info)
                raw['identityAfter']=backend.identity(pid);after=decode_identity(raw['identityAfter'],pid)
                require(before==after and identities[0]==identities[1],'process_identity_changed')
                raw['identity']=before;raw['sameNodeFile']=(identities[0]['device'],identities[0]['inode'])==(node['device'],node['inode'])
                require(pid!=subject['oldPid'],'old_PID_present_or_reused')
            scan['endedAtMs']=clock()
            require(0<=scan['endedAtMs']-start<=WINDOW_MS,'observation_expired')
        require(report['scans'][0]['files']==report['scans'][1]['files'],'file_metadata_changed')
        report['observationStatus']='partial_local_observations_not_admission'
    except (OSError,ValueError,TypeError,KeyError,AttributeError,OverflowError) as error:
        report['collectionStopped']=True
        report['gaps'].append(str(error) if isinstance(error,Gap) else 'OS_collection_exception_'+type(error).__name__)
    report['endedAtMs']=clock();report['maxAgeMs']=WINDOW_MS
    report['subjectSha256']=hashlib.sha256(json.dumps(subject,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    report['expiresAtMs']=start+WINDOW_MS
    if not start<=report['endedAtMs']<=report['expiresAtMs']:
        report['observationStatus']='unverified';report['gaps'].append('observation_expired_or_clock_changed')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True);parser.add_argument('--node',required=True)
    parser.add_argument('--port',type=int,required=True);parser.add_argument('--manager',required=True)
    parser.add_argument('--old-pid',type=int,required=True);args=parser.parse_args()
    directory=Path(tempfile.mkdtemp(prefix='landi-live-os-observation-',dir='/private/tmp'));os.chmod(directory,0o700)
    subject=dict(databasePath=args.database,nodePath=args.node,port=args.port,managerLabel=args.manager,oldPid=args.old_pid,
                 uid=os.getuid(),collectorPid=os.getpid(),collectorParentPid=os.getppid(),collectorSourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    try:result=collect(subject,LiveBackend())
    except (OSError,ValueError,AttributeError) as error:
        result=dict(status='rejected',collectionStopped=True,gaps=['backend_initialization_unverified'],productionExecutable=False,compatibilityEnabled=False)
    path=directory/'observation.json'
    with path.open('x') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    os.chmod(path,0o600)
    print(json.dumps(dict(status='observation_saved_admission_rejected',path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                         collectionStopped=result['collectionStopped'],gaps=result['gaps'])))
    return 2 if result['collectionStopped'] else 0


if __name__=='__main__':raise SystemExit(main())
