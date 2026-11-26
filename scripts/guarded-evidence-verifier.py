"""Independent rejection chain; only explicitly fictional producers are supported.

HMAC authenticates fixture producer messages, not OS truth. No real ingestion,
controller/Storage integration, database, process, permission or lock operations.
"""
import copy
import hashlib
import hmac
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location('landi_resource_scope', Path(__file__).with_name('guarded-resource-scope.py'))
_scope = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_scope)


class EvidenceVerifier:
    """Single-attempt fixture session. Source policy is out-of-band, never JSON.

    fixture_sources maps ID to {key: bytes, roles: frozenset[str]}. The holder of
    these test keys is the fixture trust root. No production source adapter exists.
    """
    def __init__(self, *, fixture_sources=None):
        self._attempted = False
        self._sources = copy.deepcopy(fixture_sources)

    def verify(self, evidence, receipts=None, *, challenge, now_ms):
        out = dict(status='rejected', verification='unverified', reasons=[],
                   fixtureOnly=self._sources is not None, realEvidenceAuthenticated=False,
                   productionExecutable=False, compatibilityEnabled=False,
                   admissionDecision='unchanged', executable=False, mayExempt=False,
                   preStopDrained='unverified', externalOperationOutcomes='unverified')
        if self._attempted:
            out['reasons'] = ['session_already_attempted']
            return out
        self._attempted = True
        try:
            _scope._require(self._sources is not None, 'real_source_adapter_not_connected')
            _scope._require(isinstance(self._sources,dict) and bool(self._sources), 'source_policy_missing')
            for source in self._sources.values():
                _scope._require(isinstance(source,dict) and type(source.get('key')) is bytes and
                                len(source['key']) >= 32 and type(source.get('roles')) is frozenset and
                                source['roles'] and source['roles'] <= {'observation','launcher','lease'},
                                'source_policy_invalid')
            _scope._require(_scope._sha(challenge) and _scope._int(now_ms), 'session_context_invalid')
            # Snapshot inputs before any digest comparison. No consumer receives
            # a mutable external envelope or caller-supplied trust context.
            value = copy.deepcopy(evidence)
            _scope._require(isinstance(value,dict) and isinstance(value.get('subject'),dict) and
                            isinstance(value.get('scans'),list) and len(value['scans'])==2,
                            'evidence_shape_unverified')
            envelope = _scope.canonical_sha256(value)
            subject = _scope.canonical_sha256(value['subject'])
            expected = {}
            starts = []
            for index, scan in enumerate(value['scans']):
                _scope._require(isinstance(scan,dict) and _scope._int(scan.get('startedAtMs')) and
                                _scope._int(scan.get('endedAtMs')) and
                                scan['startedAtMs'] <= scan['endedAtMs'] <= now_ms and
                                now_ms-scan['startedAtMs'] <= _scope.WINDOW_MS,
                                'scan_expired_or_future')
                starts.append(scan['startedAtMs'])
                _scope._require(isinstance(scan.get('lease'),dict), 'lease_evidence_unverified')
                expected[('observation',index,0)] = scan
                expected[('lease',index,0)] = scan['lease']
                rows = scan.get('processes')
                _scope._require(isinstance(rows,list), 'candidate_inventory_unverified')
                for row in rows:
                    _scope._require(isinstance(row,dict) and _scope._identity(row.get('identityBefore')),
                                    'process_identity_unverified')
                    pid = row['identityBefore']['pid']
                    _scope._require(isinstance(row.get('launch'),dict), 'launcher_evidence_unverified')
                    key = ('launcher',index,pid)
                    _scope._require(key not in expected, 'duplicate_candidate')
                    expected[key] = row['launch']
            _scope._require(isinstance(receipts,list), 'source_receipts_missing')
            verified = set()
            for receipt in copy.deepcopy(receipts):
                _scope._require(isinstance(receipt,dict) and set(receipt)=={'message','signature'}, 'receipt_shape_invalid')
                message = receipt['message']
                keys = {'sourceId','role','scanIndex','pid','challenge','envelopeSha256','subjectSha256',
                        'factsSha256','observedAtMs','expiresAtMs'}
                _scope._require(isinstance(message,dict) and set(message)==keys and
                                isinstance(message['sourceId'],str) and isinstance(message['role'],str) and
                                _scope._int(message['scanIndex']) and _scope._int(message['pid']), 'receipt_message_invalid')
                source = self._sources.get(message['sourceId'])
                _scope._require(source is not None and message['role'] in source['roles'], 'source_or_role_not_trusted')
                _scope._require(_scope._sha(receipt['signature']) and hmac.compare_digest(receipt['signature'],
                                hmac.new(source['key'],_scope.canonical_sha256(message).encode('ascii'),hashlib.sha256).hexdigest()),
                                'source_authentication_failed')
                key = (message['role'],message['scanIndex'],message['pid'])
                _scope._require(key in expected and key not in verified, 'receipt_coverage_conflict')
                scan = value['scans'][message['scanIndex']]
                _scope._require(message['challenge']==challenge and message['envelopeSha256']==envelope and
                                message['subjectSha256']==subject and
                                message['factsSha256']==_scope.canonical_sha256(expected[key]), 'receipt_binding_mismatch')
                _scope._require(type(message['observedAtMs']) is int and message['observedAtMs']==scan['endedAtMs'] and
                                _scope._int(message['expiresAtMs']) and
                                now_ms <= message['expiresAtMs'] <= scan['startedAtMs']+_scope.WINDOW_MS,
                                'receipt_expired_or_future')
                verified.add(key)
            missing = set(expected)-verified
            _scope._require(not any(x[0]=='launcher' for x in missing), 'launcher_source_unverified')
            _scope._require(not any(x[0]=='lease' for x in missing), 'lease_source_unverified')
            _scope._require(not missing, 'observation_source_unverified')
            # Internal, short-lived fixture context. Never exported or loaded from JSON.
            trust = dict(verified=True,evidenceSha256=envelope,subjectSha256=subject,
                         verifier=dict(path='/fictional/guarded-evidence-verifier.py',device=0,inode=1,
                                       sha256=_scope.canonical_sha256({'fixtureVerifier':1})),
                         verifiedAtMs=now_ms,expiresAtMs=min(starts)+_scope.WINDOW_MS)
            result = _scope.evaluate_resource_scope(value,now_ms=now_ms,trust=trust)
            _scope._require(result['status']=='consistent_not_authorization', 'resource_contract_rejected')
            out.update(status='consistent_fixture_not_authorization',verification='fixture_sources_only',
                       contractResult=result)
        except (ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:
            code = str(error)
            out['reasons'] = [code if type(error) is ValueError and code.replace('_','').isalpha() else 'malformed_evidence']
        return out
