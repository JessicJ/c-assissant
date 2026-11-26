"""Offline diagnostic report only: JSON evidence in, JSON report on stdout.

Never imports the admission controller, follows evidence references, queries the OS,
opens SQLite, or grants permission. Input attestations remain unauthenticated claims.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import time

MODULE = Path(__file__).with_name('guarded-process-diagnostics.py')
spec = importlib.util.spec_from_file_location('landi_process_diagnostics', MODULE)
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)
MAX_BYTES = 8 * 1024 * 1024


def report(snapshot, now_ms):
    result = dict(version=1, diagnosticOnly=True, admissionDecision='unchanged',
                  mayExempt=False, productionExecutable=False, compatibilityEnabled=False,
                  preStopDrained='unverified', externalOperationOutcomes='unverified',
                  currentState='unverified', evaluatedAtMs=now_ms,
                  evidenceBasis='supplied_claims_not_independently_verified',
                  conflicts=[], policyBlocks=[], insufficient=[], expired=[], observations=[])
    if type(now_ms) is not int or now_ms < 0 or not isinstance(snapshot, dict):
        result['insufficient'].append(dict(code='snapshot_or_clock_invalid'))
        return result
    at = snapshot.get('observedAtMs')
    if type(at) is not int or at < 0 or at > now_ms:
        result['insufficient'].append(dict(code='observation_time_missing_or_future'))
        return result
    if now_ms - at > diagnostics.WINDOW_MS:
        result['expired'].append(dict(code='snapshot_expired', observedAtMs=at,
                                      ageMs=now_ms-at, maxAgeMs=diagnostics.WINDOW_MS))
        # Do not re-date a stale observation to recover affirmative classifications.
        return result
    value = copy.deepcopy(snapshot)
    value['nowMs'] = now_ms  # Ignore a caller's saved/forged evaluation clock.
    assessed = diagnostics.diagnose_process_snapshot(value)
    if assessed['status'] != 'diagnostics_only_not_admission':
        result['insufficient'].append(dict(code=assessed.get('reason', 'snapshot_unverified')))
        return result
    if not assessed['processes']:
        result['insufficient'].append(dict(code='empty_snapshot_is_not_absence_proof'))
    for row in assessed['processes']:
        item = dict(pid=row['pid'], classification=row['classification'], reasons=row['reasons'],
                    independentlyVerified=False, mayExempt=False)
        result['observations'].append(item)
        if row['sameNodeFile'] is True:
            result['policyBlocks'].append(dict(pid=row['pid'], code='still_blocked_same_Node',
                                               mayExempt=False))
        if row['classification'] in {'resource_conflict_evidence', 'target_entry_conflict_evidence',
                                     'target_instance_conflict_evidence'}:
            result['conflicts'].append(item)
        # Even a structurally consistent receipt has no independent issuer verification here.
        result['insufficient'].append(dict(pid=row['pid'], code='independent_OS_and_issuer_verification_not_performed'))
        if row['classification'] in {'unverified', 'pid_reused', 'identity_conflict',
                                     'not_seen_on_recheck_unverified'}:
            result['insufficient'].append(item)
        raw_row = value['processes'][len(result['observations'])-1]
        resources = raw_row.get('resources') if isinstance(raw_row, dict) else None
        if isinstance(resources, dict):
            resource_at = resources.get('observedAtMs')
            if type(resource_at) is int and 0 <= resource_at <= now_ms and now_ms-resource_at > diagnostics.WINDOW_MS:
                result['expired'].append(dict(pid=row['pid'], code='resource_evidence_expired',
                                              observedAtMs=resource_at, ageMs=now_ms-resource_at))
    return result


def _unique(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError('duplicate_json_key')
        obj[key] = value
    return obj


def read_snapshot(path, expected_sha256):
    if not re.fullmatch('[0-9a-f]{64}', expected_sha256):
        raise ValueError('expected_digest_invalid')
    if Path(path).suffix != '.json':
        raise ValueError('only_explicit_json_evidence_allowed')
    # No FIFO/device/socket or final symlink may be opened. No reference is followed.
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
        raise ValueError('evidence_not_bounded_regular_file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino) or not stat.S_ISREG(opened.st_mode):
            raise ValueError('evidence_identity_changed')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(MAX_BYTES+1)
        after = os.fstat(fd)
        if len(raw) > MAX_BYTES or (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('evidence_changed_or_oversized')
    finally:
        os.close(fd)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha256:
        raise ValueError('evidence_digest_mismatch')
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite_json')))
    return value, dict(path=str(Path(path).absolute()), sha256=digest)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True, help='Explicit version-1 JSON evidence file')
    parser.add_argument('--sha256', required=True, help='Expected SHA-256 of that evidence file')
    args = parser.parse_args(argv)
    try:
        value, source = read_snapshot(args.snapshot, args.sha256)
        output = report(value, time.time_ns() // 1_000_000)
        output['source'] = source
        output['sourceAuthenticated'] = False
        output['diagnosticModuleSha256'] = hashlib.sha256(MODULE.read_bytes()).hexdigest()
        print(json.dumps(output, ensure_ascii=True, sort_keys=True))
        return 0  # Successful reporting, never an admission success code.
    except (OSError, ValueError, TypeError, RecursionError):
        output = report(None, time.time_ns() // 1_000_000)
        output['insufficient'] = [dict(code='evidence_read_or_validation_failed')]
        print(json.dumps(output, sort_keys=True))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
