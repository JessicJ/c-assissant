"""Pure supplied-evidence diagnostics. Never imported by the admission controller.

No OS/filesystem lookup, process operation, privilege change, timer or database IO.
Attestations are inputs from an upstream verifier; this module does not authenticate
an issuer or independently establish OS truth. No classification grants exemption.
"""
import hashlib
import json
import re
from pathlib import PurePosixPath

IDENTITY_KEYS = {'pid', 'parentPid', 'uid', 'realUid', 'startSeconds', 'startMicroseconds'}
WINDOW_MS = 15_000


def payload_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=True).encode()).hexdigest()


def _int(value, minimum=0):
    return type(value) is int and value >= minimum


def _path(value):
    return (isinstance(value, str) and '\x00' not in value and
            PurePosixPath(value).is_absolute() and '..' not in PurePosixPath(value).parts)


def _pin(value):
    return (isinstance(value, dict) and set(value) == {'path', 'sha256'} and
            _path(value['path']) and isinstance(value['sha256'], str) and
            re.fullmatch('[0-9a-f]{64}', value['sha256']) is not None)


def _identity(value):
    return (isinstance(value, dict) and set(value) == IDENTITY_KEYS and
            all(_int(value[k]) for k in IDENTITY_KEYS) and value['pid'] > 0 and
            value['startSeconds'] > 0 and value['startMicroseconds'] < 1_000_000)


def _file(value, hashed=False):
    return (isinstance(value, dict) and _path(value.get('path')) and
            _int(value.get('device')) and _int(value.get('inode'), 1) and
            (not hashed or _pin({'path': value['path'], 'sha256': value.get('sha256')})))


def _same_file(one, two):
    return _file(one) and _file(two) and (one['device'], one['inode']) == (two['device'], two['inode'])


def _fresh(at, snapshot):
    return (_int(at) and snapshot['observedAtMs'] <= at <= snapshot['nowMs'] and
            snapshot['nowMs'] - at <= WINDOW_MS)


def _attested(record, payload):
    """Only check supplied attestation shape/consensus, never issuer authenticity."""
    return (isinstance(record, dict) and record.get('status') == 'verified_upstream' and
            _pin(record.get('issuer')) and _pin(record.get('record')) and
            record.get('payloadSha256') == payload_sha256(payload))


def _launch(record, identity):
    if not isinstance(record, dict) or not isinstance(record.get('payload'), dict):
        return None
    p = record['payload']
    if (p.get('identity') != identity or not _path(p.get('projectRoot')) or
            not _file(p.get('entryFile'), hashed=True) or
            not PurePosixPath(p['entryFile']['path']).is_relative_to(PurePosixPath(p['projectRoot'])) or
            not isinstance(p.get('deploymentId'), str) or not p['deploymentId'] or
            not _attested(record.get('attestation'), p)):
        return None
    return p


def _resources(value, identity, snapshot):
    target = snapshot['target']
    if not isinstance(value, dict):
        return False, [], ['resource_evidence_missing']
    if (value.get('identity') != identity or value.get('targetSha256') != payload_sha256(target) or
            not _fresh(value.get('observedAtMs'), snapshot) or not _pin(value.get('record'))):
        return False, [], ['resource_subject_or_time_unverified']
    conflicts = []
    complete = value.get('visibility') == 'complete_attested'
    for name in ['listeners', 'fileUsers']:
        q = value.get(name)
        if not isinstance(q, dict) or not isinstance(q.get('records'), list):
            complete = False
            continue
        records = q['records']
        valid = (type(q.get('returncode')) is int and q['returncode'] in (0, 1) and
                 q.get('stderr') == '' and (q['returncode'] == 0 if records else q['returncode'] == 1))
        if not valid:
            complete = False
            continue
        for item in records:
            if not isinstance(item, dict) or item.get('pid') != identity['pid']:
                complete = False
                continue
            if name == 'listeners':
                if not _int(item.get('port'), 1) or not isinstance(item.get('address'), str):
                    complete = False
                elif item['port'] == target['port']:
                    if item['address'] in ['127.0.0.1', '0.0.0.0']:
                        conflicts.append('target_port_owner_observed')
                    elif item['address'] in ['::', '::1', '::ffff:127.0.0.1']:
                        conflicts.append('target_port_overlap_unverified')
            else:
                if not _file(item.get('file')):
                    complete = False
                    continue
                for bound in target['databaseFiles']:
                    if _same_file(item['file'], bound):
                        conflicts.append('target_database_file_owner_observed')
                    elif item['file']['path'] == bound['path']:
                        conflicts.append('target_database_path_identity_conflict')
    return complete, sorted(set(conflicts)), [] if complete else ['resource_visibility_unverified']


def _disappearance(row, snapshot):
    before, after = row.get('identityBefore'), row.get('identityAfter')
    if _identity(before) and _identity(after) and before != after:
        changed_start = before['pid'] == after['pid'] and (before['startSeconds'], before['startMicroseconds']) != (after['startSeconds'], after['startMicroseconds'])
        return ('pid_reused' if changed_start else 'identity_conflict', ['instance_identity_changed'])
    if row.get('lookupErrno') != 3:
        return 'unverified', ['identity_or_executable_evidence_missing']
    if _identity(after):
        return 'unverified', ['lookup_and_live_identity_conflict']
    life = row.get('lifecycle')
    if _identity(before) and isinstance(life, dict):
        registry = snapshot.get('ownedCollectors', [])
        owner = snapshot.get('observerIdentity')
        candidates = [r for r in registry if isinstance(r, dict) and
                      isinstance(r.get('payload'), dict) and r['payload'].get('identity') == before]
        if len(candidates) != 1:
            candidates = []
        for registered in candidates:
            if not isinstance(registered, dict):
                continue
            payload = registered.get('payload')
            if not isinstance(payload, dict):
                continue
            if (payload.get('identity') != before or payload.get('ownerIdentity') != owner or
                    not _identity(owner) or before['parentPid'] != owner['pid'] or
                    snapshot.get('observerIdentityAfter') != owner or
                    not _file(payload.get('executable'), hashed=True) or
                    not _attested(registered.get('attestation'), payload) or
                    row.get('executableBefore') != payload['executable'] or
                    life.get('creationRecord') != registered['attestation']['record']):
                continue
            wait = life.get('wait')
            if (life.get('pipeEof') is True and isinstance(wait, dict) and
                    wait.get('identity') == before and wait.get('ownerIdentity') == owner and
                    wait.get('returned') is True and type(wait.get('exitCode')) is int and
                    wait['exitCode'] == 0 and _fresh(wait.get('observedAtMs'), snapshot) and
                    wait['observedAtMs'] >= before['startSeconds'] * 1000 + before['startMicroseconds'] // 1000 and
                    _pin(wait.get('record'))):
                return 'owned_collector_exit_evidence', ['creation_pipe_EOF_and_bound_zero_exit_supplied']
    recheck = row.get('recheck')
    if (isinstance(recheck, dict) and recheck.get('status') == 'complete_attested' and
            _fresh(recheck.get('observedAtMs'), snapshot) and _pin(recheck.get('record')) and
            isinstance(recheck.get('pids'), list) and all(_int(x, 1) for x in recheck['pids']) and
            len(recheck['pids']) == len(set(recheck['pids'])) and row.get('pid') not in recheck['pids']):
        return 'not_seen_on_recheck_unverified', ['later_inventory_absence_is_not_exit_or_drain_proof']
    return 'unverified', ['ESRCH_is_not_exit_proof', 'missing_initial_identity' if not _identity(before) else 'exit_receipt_missing']


def _row(row, snapshot):
    result = {'pid': row.get('pid') if isinstance(row, dict) else None,
              'classification': 'unverified', 'reasons': [], 'sameNodeFile': None,
              'existingAdmissionPolicy': 'unchanged_not_evaluated', 'mayExempt': False}
    if not isinstance(row, dict) or not _int(row.get('pid'), 1):
        result['reasons'] = ['malformed_process_record']
        return result
    before, after = row.get('identityBefore'), row.get('identityAfter')
    executable, next_executable = row.get('executableBefore'), row.get('executableAfter')
    stable = (_identity(before) and before == after and before['pid'] == row['pid'] and
              _file(executable) and executable == next_executable)
    if not stable or row.get('lookupErrno') is not None:
        kind, reasons = _disappearance(row, snapshot)
        result.update(classification=kind, reasons=reasons)
        return result
    result['sameNodeFile'] = _same_file(executable, snapshot['target']['nodeFile'])
    if result['sameNodeFile']:
        result['existingAdmissionPolicy'] = 'still_blocked_same_Node'
    complete, conflicts, reasons = _resources(row.get('resources'), before, snapshot)
    launch = _launch(row.get('launchReceipt'), before)
    target = snapshot['target']
    if conflicts:
        result.update(classification='resource_conflict_evidence', reasons=conflicts + reasons)
    elif launch and any(_same_file(launch['entryFile'], x) and
                        launch['entryFile']['sha256'] == x['sha256'] for x in target['registeredEntries']):
        result.update(classification='target_entry_conflict_evidence', reasons=['registered_target_entry_binding_supplied'])
    elif launch and launch['deploymentId'] == target['deploymentId']:
        result.update(classification='target_instance_conflict_evidence', reasons=['target_deployment_identity_claim_requires_review'])
    elif launch and launch['projectRoot'] == target['projectRoot']:
        result['reasons'] = ['Landi_project_hint_without_bound_entry_or_deployment'] + reasons
    elif complete and launch and launch['projectRoot'] != target['projectRoot']:
        result.update(classification='other_project_evidence_consistent', reasons=['launcher_binding_and_complete_resource_observation_supplied'])
    else:
        result['reasons'] = reasons + ['project_ownership_unverified']
    return result


def diagnose_process_snapshot(snapshot):
    """Return diagnostics only. Incomplete evidence never grants admission."""
    output = {'version': 1, 'policyVersion': 'process-diagnostics-v1', 'diagnosticOnly': True,
              'admissionDecision': 'unchanged', 'mayExempt': False,
              'productionExecutable': False, 'compatibilityEnabled': False,
              'preStopDrained': 'unverified', 'externalOperationOutcomes': 'unverified',
              'evidenceBasis': 'supplied_attestations_not_independent_OS_or_issuer_verification',
              'status': 'unverified', 'processes': []}
    try:
        if not isinstance(snapshot, dict) or type(snapshot.get('version')) is not int or snapshot['version'] != 1:
            raise ValueError('snapshot_schema_unverified')
        if (not _int(snapshot.get('observedAtMs')) or not _int(snapshot.get('nowMs')) or
                not 0 <= snapshot['nowMs'] - snapshot['observedAtMs'] <= WINDOW_MS):
            raise ValueError('snapshot_time_unverified')
        target = snapshot.get('target')
        if (not isinstance(target, dict) or not _path(target.get('projectRoot')) or
                not _int(target.get('port'), 1) or target['port'] > 65535 or
                not isinstance(target.get('deploymentId'), str) or not target['deploymentId'] or
                not _file(target.get('nodeFile')) or not isinstance(target.get('databaseFiles'), list) or
                not target['databaseFiles'] or not all(_file(x) for x in target['databaseFiles']) or
                not isinstance(target.get('registeredEntries'), list) or not target['registeredEntries'] or
                not all(_file(x, hashed=True) for x in target['registeredEntries'])):
            raise ValueError('target_scope_unverified')
        rows = snapshot.get('processes')
        if not isinstance(rows, list) or len(rows) > 10_000:
            raise ValueError('process_records_unverified')
        pids = [r.get('pid') for r in rows if isinstance(r, dict)]
        if len(pids) != len(set(pids)):
            raise ValueError('duplicate_PID_unverified')
        output['processes'] = [_row(r, snapshot) for r in rows]
        output['status'] = 'diagnostics_only_not_admission'
        if not rows:
            output['reason'] = 'empty_snapshot_is_not_absence_proof'
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        output['reason'] = str(error)
    return output
