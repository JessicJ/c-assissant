"""Read-only OS source adapter scaffold: fixture replies only, no OS executor.

No subprocess, ctypes, database, descriptor or filesystem operations. Parsing
fictional replies never authenticates a live source or creates verifier trust.
"""
import copy
import importlib.util
from pathlib import Path
import re

_spec = importlib.util.spec_from_file_location('landi_scope', Path(__file__).with_name('guarded-resource-scope.py'))
_scope = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_scope)
LIMIT = 4_000_000


def lock_inheritance_requirements(controller_identity, binding=None):
    """Describe FD subjects, not acquisition or continuous ownership evidence."""
    result = dict(status='unverified', holderRole='control_session', receiverRole='business_child',
                  controllerIdentity=copy.deepcopy(controller_identity),
                  inheritedIdentityMatched=False, heldContinuously=False,
                  reason='actual_lease_capability_not_observed')
    if binding is None:
        result['reason'] = 'holder_FD_and_inheritance_evidence_missing'
        return result
    _scope._require(isinstance(binding,dict) and _scope._identity(controller_identity) and
                    _scope._same(binding.get('holderIdentity'),controller_identity) and
                    _scope._int(binding.get('holderFd'),3), 'lock_holder_subject_invalid')
    phase = binding.get('phase')
    if phase == 'before_business_spawn':
        _scope._require(binding.get('receiverIdentity') is None and binding.get('receiverFd') is None and
                        binding.get('inheritedIdentityMatched') is False, 'future_inheritance_cannot_be_verified')
        result['reason'] = 'business_child_not_created_inheritance_pending'
    else:
        _scope._require(phase=='after_business_spawn' and _scope._identity(binding.get('receiverIdentity')) and
                        binding['receiverIdentity']['parentPid']==controller_identity['pid'] and
                        binding['receiverIdentity']['pid']!=controller_identity['pid'] and
                        _scope._int(binding.get('receiverFd'),3) and
                        _scope._file(binding.get('holderLockFile')) and
                        _scope._same(binding['holderLockFile'],binding.get('receiverLockFile')),
                        'lock_receiver_subject_invalid')
        result['reason'] = 'fixture_descriptor_consensus_not_actual_lease_proof'
    result['binding'] = copy.deepcopy(binding)
    return result


class OSReadOnlySource:
    """One attempt. No default runner or live mode exists.

    Native frames are decoded synthetic values, not raw ABI authentication.
    Query stdout/stderr are bytes and must be parsed here, not supplied facts.
    """
    def __init__(self, *, fixture_replies=None):
        self._replies=copy.deepcopy(fixture_replies)
        self._attempted=False

    def observe(self, subject, *, now_ms, lock_binding=None):
        out=dict(status='rejected', observationStatus='unverified', fixtureOnly=self._replies is not None,
                 realEvidenceAuthenticated=False, executable=False, mayExempt=False,
                 admissionDecision='unchanged',productionExecutable=False,compatibilityEnabled=False,
                 launcherStatus='unverified',leaseStatus='unverified',reasons=[])
        if self._attempted:
            out['reasons']=['source_session_already_attempted'];return out
        self._attempted=True
        try:
            _scope._require(self._replies is not None,'real_OS_collection_not_connected')
            s=copy.deepcopy(subject);raw=self._replies
            _scope._require(isinstance(s,dict) and _scope._identity(s.get('controllerIdentity')) and
                            _scope._identity(s.get('oldIdentity')) and _scope._file(s.get('workFile')) and
                            _scope._int(s.get('port'),1) and s['port']<=65535 and
                            isinstance(s.get('managerLabel'),str) and
                            re.fullmatch('[A-Za-z0-9_.-]+',s['managerLabel']), 'subject_invalid')
            _scope._require(isinstance(raw,dict) and _scope._int(now_ms) and
                            _scope._int(raw.get('startedAtMs')) and _scope._int(raw.get('endedAtMs')) and
                            raw['startedAtMs']<=raw['endedAtMs']<=now_ms and
                            now_ms-raw['startedAtMs']<=_scope.WINDOW_MS and
                            raw.get('subjectSha256')==_scope.canonical_sha256(s), 'source_scope_or_time_invalid')
            metadata=raw.get('metadata')
            paths=[s['workFile']['path']+suffix for suffix in ['', '-wal','-shm','-journal']]
            _scope._require(isinstance(metadata,list) and len(metadata)==4 and
                            [x.get('path') for x in metadata]==paths, 'file_metadata_coverage_invalid')
            for index,item in enumerate(metadata):
                _scope._require(type(item.get('exists')) is bool, 'file_existence_unverified')
                if index==0:
                    _scope._require(item['exists'] and _scope._same(item.get('file'),s['workFile']) and
                                    item.get('canonicalPath')==paths[0], 'work_identity_changed')
                else:
                    _scope._require(item['exists'] is False,'sidecar_present_or_unknown')
            uid=s['controllerIdentity']['uid']; label=s['managerLabel']
            commands={
                'inventory':['/bin/ps','-axo','pid=,ppid=,uid=,lstart=,comm='],
                'manager':['/bin/launchctl','print',f'gui/{uid}/{label}'],
                'disabled':['/bin/launchctl','print-disabled',f'gui/{uid}'],
                'listeners':['/usr/sbin/lsof','-nP','-iTCP:'+str(s['port']),'-sTCP:LISTEN','-Fpcftn'],
                'fileUsers':['/usr/sbin/lsof','-nP','-Fpcftn','--',paths[0]]}
            queries=raw.get('queries')
            _scope._require(isinstance(queries,dict) and set(queries)==set(commands),'query_coverage_invalid')
            parsed={}
            for name,argv in commands.items():
                q=queries[name]
                _scope._require(isinstance(q,dict) and q.get('argv')==argv and
                                type(q.get('returncode')) is int and type(q.get('stdout')) is bytes and
                                type(q.get('stderr')) is bytes and len(q['stdout'])+len(q['stderr'])<=LIMIT,
                                'query_reply_invalid')
                parsed[name]=(q['returncode'],q['stdout'].decode('utf-8','strict'),q['stderr'].decode('utf-8','strict'))
            rc,text,err=parsed['inventory'];_scope._require(rc==0 and not err and bool(text.strip()),'inventory_unverified')
            inventory={}
            for line in text.splitlines():
                fields=line.split(None,8)
                _scope._require(len(fields)==9 and all(v.isdecimal() for v in fields[:3]) and
                                int(fields[0])>0 and int(fields[0]) not in inventory,'inventory_parse_invalid')
                inventory[int(fields[0])]=(int(fields[1]),int(fields[2]))
            frames=raw.get('nativeFrames')
            _scope._require(isinstance(frames,list) and len(frames)==len(inventory),'native_coverage_invalid')
            seen=set()
            for frame in frames:
                _scope._require(isinstance(frame,dict) and frame.get('errno')==0 and type(frame.get('errno')) is int and
                                frame.get('bytesReturned')==136 and type(frame.get('bytesReturned')) is int,
                                'native_reply_unverified')
                before=frame.get('identityBefore');after=frame.get('identityAfter')
                _scope._require(_scope._identity(before) and _scope._same(before,after),'process_identity_changed')
                pid=before['pid'];_scope._require(pid in inventory and pid not in seen and
                    inventory[pid]==(before['parentPid'],before['uid']), 'inventory_native_mismatch')
                seen.add(pid)
                _scope._require(_scope._file(frame.get('executableBefore'),True) and
                    _scope._same(frame['executableBefore'],frame.get('executableAfter')),'kernel_path_identity_unverified')
                _scope._require(pid!=s['oldIdentity']['pid'],'old_PID_present_or_reused')
            rc,text,err=parsed['manager']
            _scope._require(rc!=0 and not text.strip() and
                re.search(r'Could not find service "'+re.escape(label)+r'" in domain',err), 'manager_absence_unverified')
            rc,text,err=parsed['disabled']
            lines=[line for line in text.splitlines() if re.search(r'"'+re.escape(label)+r'"\s*=>',line)]
            _scope._require(rc==0 and not err and len(lines)==1 and
                re.fullmatch(r'\s*"'+re.escape(label)+r'"\s*=>\s*(true|disabled)\s*',lines[0]),'manager_disabled_unverified')
            for name in ['listeners','fileUsers']:
                rc,text,err=parsed[name]
                _scope._require(rc==1 and not text.strip() and not err,'resource_occupied_or_query_unverified')
            out['lockRequirements']=lock_inheritance_requirements(s['controllerIdentity'],lock_binding)
            out.update(observationStatus='consistent_fixture_observation_only',
                       rawReplyDigest=_scope.canonical_sha256(_json_bytes(raw)),
                       inventoryPids=sorted(inventory),subjectSha256=_scope.canonical_sha256(s))
            out['reasons']=['launcher_source_unverified','actual_lease_capability_unverified']
        except (ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:
            code=str(error)
            out['reasons']=[code if type(error) is ValueError and code.replace('_','').isalpha() else 'malformed_OS_reply']
        return out


def _json_bytes(value):
    if type(value) is bytes:return {'fixtureBytesHex':value.hex()}
    if isinstance(value,dict):return {k:_json_bytes(v) for k,v in value.items()}
    if isinstance(value,list):return [_json_bytes(v) for v in value]
    return value
