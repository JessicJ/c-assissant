"""Pure two-stage lease contract. Supplied facts only; never launch/open authority."""
import importlib.util
from pathlib import Path

_spec=importlib.util.spec_from_file_location('landi_scope',Path(__file__).with_name('guarded-resource-scope.py'))
_s=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_s)
POLICY='landi-lease-stages-v1'


def _base(stage):
    return dict(policyVersion=POLICY,stage=stage,status='rejected',reasons=[],
                admissionDecision='unchanged',executable=False,maySpawn=False,mayOpenDatabase=False,
                productionExecutable=False,compatibilityEnabled=False,
                preStopDrained='unverified',externalOperationOutcomes='unverified',
                evidenceBasis='caller_verified_facts_not_independently_authenticated')


def _authenticated(e,stage,trust,now):
    _s._require(_s._int(now) and isinstance(e,dict) and type(e.get('version')) is int and e['version']==1 and
                e.get('policyVersion')==POLICY and e.get('stage')==stage,'stage_schema_invalid')
    _s._require(e.get('productionExecutable') is False and e.get('compatibilityEnabled') is False,'closed_gates_required')
    _s._require(isinstance(trust,dict) and trust.get('verified') is True and
                trust.get('evidenceSha256')==_s.canonical_sha256(e) and _s._file(trust.get('verifier'),True) and
                _s._int(trust.get('verifiedAtMs')) and _s._int(trust.get('expiresAtMs')) and
                trust['verifiedAtMs']<=now<=trust['expiresAtMs'] and
                trust['expiresAtMs']-trust['verifiedAtMs']<=_s.WINDOW_MS,'source_unverified_or_expired')
    start,end=e.get('startedAtMs'),e.get('endedAtMs')
    _s._require(_s._int(start) and _s._int(end) and start<=end<=trust['verifiedAtMs']<=now and
                now-start<=_s.WINDOW_MS,'stage_time_unverified')
    sub=e.get('subject')
    _s._require(isinstance(sub,dict) and _s._identity(sub.get('controllerIdentity')) and
                _s._file(sub.get('workFile')) and sub['workFile'].get('nlink')==1 and type(sub['workFile']['nlink']) is int and
                _s._file(sub.get('lockFile')) and sub['lockFile'].get('nlink')==1 and type(sub['lockFile']['nlink']) is int and
                type(sub['lockFile'].get('mode')) is int and sub['lockFile']['mode']==0o600 and
                _s._int(sub['lockFile'].get('uid')) and sub['lockFile']['uid']==sub['controllerIdentity']['uid'] and
                _s._file(sub.get('nodeFile'),True) and _s._file(sub.get('entryFile'),True) and
                _s._sha(sub.get('manifestSha256')) and _s._sha(sub.get('channelId')) and
                _s._sha(sub.get('resourceSubjectSha256')) and
                _s._sha(sub.get('challenge')) and isinstance(sub.get('deploymentId'),str) and bool(sub['deploymentId']),
                'subject_unverified')
    expected=str(Path(sub['workFile']['path']).parent/'.landi-control'/
                 (_s.hashlib.sha256(sub['workFile']['path'].encode()).hexdigest()+'.lock'))
    _s._require(sub['lockFile']['path']==expected and trust.get('subjectSha256')==_s.canonical_sha256(sub),
                'subject_or_lock_binding_invalid')
    return sub


def _lease(e,sub):
    lease=e.get('lease')
    _s._require(isinstance(lease,dict) and _s._sha(lease.get('leaseId')) and
                _s._same(lease.get('holderIdentity'),sub['controllerIdentity']) and
                _s._same(lease.get('holderIdentityAfter'),sub['controllerIdentity']) and
                _s._int(lease.get('holderFd'),3) and _s._same(lease.get('lockFile'),sub['lockFile']) and
                _s._same(lease.get('workFile'),sub['workFile']) and
                lease.get('acquiredNonblocking') is True and lease.get('heldContinuously') is True and
                lease.get('privateDirectoryVerified') is True and lease.get('capabilityVerified') is True and
                lease.get('unknowns')==[] and _s._int(lease.get('acquiredAtMs')) and
                lease['acquiredAtMs']<=e['startedAtMs'] and lease.get('continuousThroughMs')==e['endedAtMs'] and
                type(lease.get('continuousThroughMs')) is int,'lease_capability_unverified')
    return lease


def _pre(e,trust,now):
    sub=_authenticated(e,'pre_start',trust,now);lease=_lease(e,sub)
    _s._require(e.get('childCreated') is False and e.get('childIdentity') is None and
                e.get('receiverFd') is None and e.get('inheritance')=='pending','future_inheritance_overstated')
    resource=e.get('resourceAssessment')
    _s._require(isinstance(resource,dict) and resource.get('policyVersion')=='landi-resource-conflicts-v1' and
                resource.get('subjectSha256')==_s.canonical_sha256(sub) and resource.get('outcome')=='consistent' and
                resource.get('conflicts')==[] and resource.get('unknowns')==[] and
                resource.get('launcherSourcesVerified') is True and _s._sha(resource.get('evidenceSha256')) and
                _s._int(resource.get('observedAtMs')) and e['startedAtMs']<=resource['observedAtMs']<=e['endedAtMs'],
                'resource_or_launcher_prerequisite_unverified')
    return sub,lease


def _reason(out,error):
    text=str(error)
    out['reasons']=[text if type(error) is ValueError and text.replace('_','').isalpha() else 'malformed_stage_evidence']
    return out


def evaluate_pre_start(evidence,*,now_ms,trust=None):
    out=_base('pre_start')
    try:
        _pre(evidence,trust,now_ms)
        out.update(status='consistent_pre_start_not_authorization',inheritance='pending',
                   evidenceSha256=_s.canonical_sha256(evidence))
    except (ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:_reason(out,error)
    return out


def evaluate_pre_open(evidence,*,pre_start,now_ms,trust=None,pre_trust=None):
    out=_base('pre_open')
    try:
        # Re-evaluate original pre-start facts now, not a caller's success JSON.
        sub,old_lease=_pre(pre_start,pre_trust,now_ms)
        current=_authenticated(evidence,'pre_open',trust,now_ms)
        _s._require(_s._same(sub,current) and evidence.get('preStartSha256')==_s.canonical_sha256(pre_start) and
                    pre_start['endedAtMs']<=evidence['startedAtMs'],'stage_chain_mismatch')
        lease=_lease(evidence,sub)
        _s._require(all(_s._same(lease[k],old_lease[k]) for k in
                    ['leaseId','holderIdentity','holderFd','lockFile','workFile','acquiredAtMs']), 'lease_continuity_changed')
        child=evidence.get('child')
        _s._require(isinstance(child,dict) and _s._identity(child.get('identityBefore')) and
                    _s._same(child['identityBefore'],child.get('identityAfter')) and
                    child['identityBefore']['parentPid']==sub['controllerIdentity']['pid'] and
                    child['identityBefore']['pid']!=sub['controllerIdentity']['pid'] and
                    child['identityBefore']['uid']==sub['controllerIdentity']['uid'] and
                    child['identityBefore']['realUid']==sub['controllerIdentity']['realUid'], 'child_identity_unverified')
        birth=child['identityBefore']['startSeconds']*1000+child['identityBefore']['startMicroseconds']/1000
        _s._require(pre_start['endedAtMs']<=birth<=evidence['endedAtMs'] and
                    _s._same(child.get('executableBefore'),sub['nodeFile']) and
                    _s._same(child.get('executableAfter'),sub['nodeFile']) and
                    _s._same(child.get('entryFile'),sub['entryFile']), 'child_launch_binding_unverified')
        inheritance=evidence.get('inheritance')
        _s._require(isinstance(inheritance,dict) and
                    _s._same(inheritance.get('holderIdentity'),sub['controllerIdentity']) and
                    _s._same(inheritance.get('receiverIdentity'),child['identityBefore']) and
                    type(inheritance.get('holderFd')) is int and inheritance['holderFd']==lease['holderFd'] and
                    _s._int(inheritance.get('receiverFd'),3) and
                    _s._same(inheritance.get('holderLockFile'),sub['lockFile']) and
                    _s._same(inheritance.get('receiverLockFile'),sub['lockFile']) and
                    inheritance.get('sameInheritedCapabilityVerified') is True,'inherited_capability_unverified')
        barrier=evidence.get('barrier')
        expected=dict(state='waiting_pre_open',deploymentId=sub['deploymentId'],channelId=sub['channelId'],
                      manifestSha256=sub['manifestSha256'],workFile=sub['workFile'],childIdentity=child['identityBefore'],
                      databaseOpened=False,listenerStarted=False,backgroundStarted=False,continueReceived=False)
        _s._require(_s._same(barrier,expected),'pre_open_barrier_unverified')
        _s._require(evidence.get('launcherSourceVerified') is True and
                    evidence.get('privateChannelVerified') is True,'launch_or_channel_source_unverified')
        out.update(status='consistent_pre_open_not_authorization',inheritance='consistent_supplied_capability',
                   evidenceSha256=_s.canonical_sha256(evidence))
    except (ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:_reason(out,error)
    return out
