"""Pure landi-resource-scope-v2 contract evaluation; never a launch authority.

No IO, OS observation, verifier authentication, compatibility or execution hooks.
Trust must be supplied separately by a future authenticated ingestion boundary.
"""
import hashlib
import json
from pathlib import PurePosixPath
import re

POLICY = 'landi-resource-scope-v2'
WINDOW_MS = 15000


def canonical_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def _require(value, code):
    if not value:
        raise ValueError(code)


def _int(value, minimum=0):
    return type(value) is int and value >= minimum


def _path(value):
    return (isinstance(value, str) and value.startswith('/') and '\x00' not in value and
            '..' not in PurePosixPath(value).parts and str(PurePosixPath(value)) == value)


def _sha(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def _file(value, hashed=False):
    return (isinstance(value, dict) and _path(value.get('path')) and
            _int(value.get('device')) and _int(value.get('inode'), 1) and
            (not hashed or _sha(value.get('sha256'))))


def _identity(value):
    keys = {'pid','parentPid','uid','realUid','startSeconds','startMicroseconds'}
    return (isinstance(value, dict) and set(value) == keys and
            all(_int(value[k]) for k in keys) and value['pid'] > 0 and
            value['startSeconds'] > 0 and value['startMicroseconds'] < 1000000)


def _key(value):
    return value['device'], value['inode']


def _same(one, two):
    return canonical_sha256(one) == canonical_sha256(two)


def _evaluate(evidence, *, now_ms, trust=None, lease_required=True):
    """Evaluate authenticated *supplied* facts, not OS truth or runtime readiness.

    A positive result is only contract consistency. It is never executable and
    cannot exempt any process from the current controller's unchanged policy.
    """
    policy = POLICY if lease_required else 'landi-resource-conflicts-v1'
    out = dict(policyVersion=policy, status='rejected', reasons=[],
               admissionDecision='unchanged', executable=False, mayExempt=False,
               productionExecutable=False, compatibilityEnabled=False,
               preStopDrained='unverified', externalOperationOutcomes='unverified',
               excludedFromProposedScope=[], evidenceBasis='caller_verified_facts_not_independently_authenticated')
    try:
        _require(_int(now_ms), 'clock_invalid')
        _require(isinstance(evidence, dict) and type(evidence.get('version')) is int and
                 evidence['version'] == (2 if lease_required else 1) and evidence.get('policyVersion') == policy,
                 'policy_version_unverified')
        _require(evidence.get('productionExecutable') is False and
                 evidence.get('compatibilityEnabled') is False, 'closed_gates_required')
        _require(isinstance(trust, dict) and trust.get('verified') is True and
                 trust.get('evidenceSha256') == canonical_sha256(evidence) and
                 isinstance(trust.get('verifier'), dict) and
                 _file(trust['verifier'], hashed=True), 'authenticated_ingestion_required')
        _require(_int(trust.get('verifiedAtMs')) and _int(trust.get('expiresAtMs')) and
                 trust['verifiedAtMs'] <= now_ms <= trust['expiresAtMs'] and
                 trust['expiresAtMs']-trust['verifiedAtMs'] <= WINDOW_MS,
                 'verification_expired_or_future')
        subject = evidence.get('subject')
        _require(isinstance(subject, dict) and _path(subject.get('projectRoot')) and
                 _identity(subject.get('controllerIdentity')) and _identity(subject.get('oldIdentity')) and
                 isinstance(subject.get('deploymentIds'), list) and subject['deploymentIds'] and
                 all(isinstance(x, str) and x for x in subject['deploymentIds']) and
                 len(subject['deploymentIds']) == len(set(subject['deploymentIds'])) and
                 isinstance(subject.get('managerLabel'), str) and bool(subject['managerLabel']) and
                 subject.get('host') == '127.0.0.1' and _int(subject.get('port'),1) and subject['port'] <= 65535 and
                 _file(subject.get('nodeFile'), hashed=True), 'subject_unverified')
        entries = subject.get('entries')
        _require(isinstance(entries,list) and entries and all(_file(x,True) for x in entries), 'entry_scope_missing')
        work = subject.get('workFile'); lock = subject.get('lockFile')
        _require(_file(work) and type(work.get('nlink')) is int and work['nlink'] == 1,
                 'work_alias_unverified')
        if lease_required:
            _require(_file(lock) and type(lock.get('nlink')) is int and lock['nlink'] == 1 and
                 type(lock.get('mode')) is int and lock['mode'] == 0o600 and
                 _int(lock.get('uid')) and lock['uid'] == subject['controllerIdentity']['uid'],
                 'work_or_lock_alias_unverified')
            _require(lock['path'] == str(PurePosixPath(work['path']).parent / '.landi-control' /
                 (hashlib.sha256(work['path'].encode()).hexdigest()+'.lock')),
                 'lock_path_binding_invalid')
        _require(trust.get('subjectSha256') == canonical_sha256(subject), 'verification_scope_mismatch')
        scans = evidence.get('scans')
        _require(isinstance(scans,list) and len(scans)==2, 'two_scans_required')
        fingerprints=[]; excluded=[]; previous_end=None
        for scan in scans:
            _require(isinstance(scan,dict) and _int(scan.get('startedAtMs')) and _int(scan.get('endedAtMs')) and
                     scan['startedAtMs'] <= scan['endedAtMs'] <= trust['verifiedAtMs'] <= now_ms and
                     now_ms-scan['startedAtMs'] <= WINDOW_MS and
                     (previous_end is None or previous_end <= scan['startedAtMs']), 'scan_time_unverified')
            previous_end=scan['endedAtMs']
            _require(scan.get('subjectSha256')==canonical_sha256(subject) and
                     scan.get('visibility')=='verified_complete_scoped' and
                     scan.get('unknowns')==[], 'observation_visibility_unverified')
            _require(_same(scan.get('manager'),dict(label=subject['managerLabel'],absent=True,disabled=True)),
                     'old_manager_conflict_or_unknown')
            _require(scan.get('listeners')==[] and scan.get('fileUsers')==[] and
                     scan.get('controlOwners')==[], 'resource_conflict_or_missing_query')
            # An initial standalone work copy is required. Sidecar absence must
            # be observed, not inferred from an empty list of open file handles.
            _require(_same(scan.get('workFile'),work) and scan.get('absentSidecars')==['-wal','-shm','-journal'],
                     'work_identity_or_sidecar_unverified')
            if lease_required:
                _require(_same(scan.get('lease'),dict(lockFile=lock,ownerIdentity=subject['controllerIdentity'],
                         acquiredNonblocking=True,heldContinuously=True,inheritedIdentityMatched=True)),
                         'lease_conflict_or_unknown')
            else:
                _require('lease' not in scan, 'lease_not_part_of_resource_conflict_contract')
            rows=scan.get('processes')
            _require(isinstance(rows,list), 'candidate_inventory_missing')
            pids=[]; facts=[]; current_excluded=[]
            for row in rows:
                _require(isinstance(row,dict), 'process_invalid')
                identity=row.get('identityBefore'); exe=row.get('executableBefore')
                _require(_identity(identity) and _same(identity,row.get('identityAfter')) and
                         _file(exe,True) and _same(exe,row.get('executableAfter')), 'process_identity_unverified')
                pid=identity['pid']; pids.append(pid)
                _require(pid!=subject['oldIdentity']['pid'], 'old_PID_present_or_reused')
                launch=row.get('launch')
                _require(isinstance(launch,dict) and launch.get('source')=='authenticated_launcher' and
                         _same(launch.get('identity'),identity) and _same(launch.get('executable'),exe) and
                         _file(launch.get('entry'),True) and _path(launch.get('projectRoot')) and
                         isinstance(launch.get('deploymentId'),str) and bool(launch['deploymentId']) and
                         _sha(launch.get('receiptSha256')), 'launcher_binding_unverified')
                _require(launch['projectRoot']!=subject['projectRoot'] and
                         launch['deploymentId'] not in subject['deploymentIds'] and
                         not any(_key(launch['entry'])==_key(x) or launch['entry']['path']==x['path'] for x in entries),
                         'Landi_instance_conflict')
                _require(_same(row.get('targetResourceCheck'),dict(subjectSha256=canonical_sha256(subject),
                         complete=True,listeners=[],fileUsers=[],controlOwners=[])), 'process_resources_unverified')
                facts.append(row)
                if _key(exe)==_key(subject['nodeFile']):
                    current_excluded.append(dict(pid=pid,reason='bound_other_deployment_no_target_resources'))
            _require(len(pids)==len(set(pids)), 'duplicate_process_identity')
            fingerprints.append(canonical_sha256(sorted(facts,key=lambda x:x['identityBefore']['pid'])))
            excluded=current_excluded
        _require(fingerprints[0]==fingerprints[1], 'candidate_inventory_changed')
        out.update(status='consistent_not_authorization', excludedFromProposedScope=excluded)
    except (ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:
        # Stable codes only: never echo untrusted values or parser exceptions.
        code=str(error) if type(error) is ValueError and re.fullmatch('[a-zA-Z_]+',str(error)) else 'malformed_evidence'
        out['reasons']=[code]
    return out


def evaluate_resource_scope(evidence, *, now_ms, trust=None):
    """Existing v2 contract, retaining its lease requirement unchanged."""
    return _evaluate(evidence, now_ms=now_ms, trust=trust, lease_required=True)


def evaluate_resource_conflicts(evidence, *, now_ms, trust=None):
    """New independent resource/instance contract: no lease/inheritance claims."""
    return _evaluate(evidence, now_ms=now_ms, trust=trust, lease_required=False)
