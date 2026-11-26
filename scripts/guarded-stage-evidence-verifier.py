"""Fixture-only authenticated composition. No live IO or execution authority."""
import copy
import hashlib
import hmac
import importlib.util
from pathlib import Path


def _load(name, file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

_r=_load('stage_resource_scope','guarded-resource-scope.py')
_l=_load('stage_lease_contract','guarded-lease-stages.py')
ROLES=frozenset({'resource-observation','foreign-launch','stage-observation','pre-lease',
                 'post-lease','child-launch','inheritance','barrier'})


class StageEvidenceVerifier:
    """A pre-start attempt followed by one pre-open attempt; failures are terminal.

    Source key/role policy is out-of-band and fictional. Nothing is read from disk,
    no sources are called, and no returned data can start a child or open storage.
    """
    def __init__(self, *, fixture_sources=None):
        self._sources=copy.deepcopy(fixture_sources);self._state='created'
        self._pre=None;self._pre_trust=None;self._challenge=None

    def _base(self,stage):
        return dict(stage=stage,status='rejected',verification='unverified',reasons=[],
                    fixtureOnly=self._sources is not None,realEvidenceAuthenticated=False,
                    executable=False,maySpawn=False,mayOpenDatabase=False,mayExempt=False,
                    admissionDecision='unchanged',productionExecutable=False,compatibilityEnabled=False)

    def _authenticate(self,package,expected,receipts,stage,challenge,now):
        _r._require(isinstance(self._sources,dict) and bool(self._sources),'real_stage_sources_not_connected')
        _r._require(_r._sha(challenge) and _r._int(now),'session_context_invalid')
        for source in self._sources.values():
            _r._require(isinstance(source,dict) and type(source.get('key')) is bytes and len(source['key'])>=32 and
                        type(source.get('roles')) is frozenset and source['roles'] and source['roles']<=ROLES,
                        'source_policy_invalid')
        _r._require(isinstance(receipts,list),'receipts_missing')
        seen=set();start=package['stage']['startedAtMs'];end=package['stage']['endedAtMs']
        _r._require(_r._int(start) and _r._int(end) and start<=end<=now and now-start<=15000,'stage_time_unverified')
        for receipt in receipts:
            _r._require(isinstance(receipt,dict) and set(receipt)=={'message','signature'},'receipt_shape_invalid')
            msg=receipt['message']
            _r._require(isinstance(msg,dict) and set(msg)=={'sourceId','role','item','stage','challenge','packageSha256','factsSha256','expiresAtMs'} and
                        isinstance(msg['sourceId'],str) and isinstance(msg['role'],str) and isinstance(msg['item'],str),
                        'receipt_message_invalid')
            source=self._sources.get(msg['sourceId']);key=(msg['role'],msg['item'])
            _r._require(source is not None and msg['role'] in source['roles'],'source_role_untrusted')
            signature=hmac.new(source['key'],_r.canonical_sha256(msg).encode('ascii'),hashlib.sha256).hexdigest()
            _r._require(_r._sha(receipt['signature']) and hmac.compare_digest(signature,receipt['signature']), 'source_signature_invalid')
            _r._require(key in expected and key not in seen,'receipt_coverage_conflict')
            _r._require(msg['stage']==stage and msg['challenge']==challenge and
                        msg['packageSha256']==_r.canonical_sha256(package) and
                        msg['factsSha256']==_r.canonical_sha256(expected[key]),'receipt_binding_mismatch')
            _r._require(_r._int(msg['expiresAtMs']) and now<=msg['expiresAtMs']<=start+15000,'receipt_expired')
            seen.add(key)
        _r._require(seen==set(expected),'source_coverage_unverified')

    @staticmethod
    def _trust(e,now,started=None):
        return dict(verified=True,evidenceSha256=_r.canonical_sha256(e),subjectSha256=_r.canonical_sha256(e['subject']),
                    verifier=dict(path='/fictional/stage-verifier',device=0,inode=1,sha256='a'*64),
                    verifiedAtMs=now,expiresAtMs=(e['startedAtMs'] if started is None else started)+15000)

    def verify_pre_start(self,stage,resource,receipts=None,*,challenge,now_ms):
        out=self._base('pre_start')
        try:
            _r._require(self._state=='created','stage_order_or_replay_invalid');self._state='failed'
            stage,resource,receipts=copy.deepcopy((stage,resource,receipts))
            _r._require(isinstance(stage,dict) and 'resourceAssessment' not in stage and
                        isinstance(resource,dict),'input_summary_not_trusted')
            package={'stage':stage,'resource':resource}
            expected={('resource-observation','all'):resource,('stage-observation','all'):stage,('pre-lease','holder'):stage.get('lease')}
            _r._require(isinstance(stage.get('lease'),dict),'lease_source_unverified')
            for index,scan in enumerate(resource['scans']):
                for row in scan['processes']:
                    key=('foreign-launch',f'{index}:{row["identityBefore"]["pid"]}')
                    _r._require(key not in expected and isinstance(row.get('launch'),dict),'launcher_source_unverified')
                    expected[key]=row['launch']
            self._authenticate(package,expected,receipts,'pre_start',challenge,now_ms)
            sub=stage['subject'];rs=resource['subject']
            _r._require(sub['challenge']==challenge and sub['resourceSubjectSha256']==_r.canonical_sha256(rs) and
                        all(_r._same(sub[k],rs[k]) for k in ['controllerIdentity','workFile','nodeFile']) and
                        sub['deploymentId'] in rs['deploymentIds'] and any(_r._same(sub['entryFile'],x) for x in rs['entries']),
                        'resource_stage_subject_mismatch')
            rt=self._trust(resource,now_ms,resource['scans'][0]['startedAtMs'])
            rr=_r.evaluate_resource_conflicts(resource,now_ms=now_ms,trust=rt)
            _r._require(rr['status']=='consistent_not_authorization','resource_conflict_contract_rejected')
            observed=resource['scans'][-1]['endedAtMs']
            stage['resourceAssessment']=dict(policyVersion='landi-resource-conflicts-v1',subjectSha256=_r.canonical_sha256(sub),
                outcome='consistent',conflicts=[],unknowns=[],launcherSourcesVerified=True,
                evidenceSha256=_r.canonical_sha256(resource),observedAtMs=observed)
            st=self._trust(stage,now_ms);result=_l.evaluate_pre_start(stage,now_ms=now_ms,trust=st)
            _r._require(result['status']=='consistent_pre_start_not_authorization','pre_start_contract_rejected')
            self._pre=stage;self._pre_trust=st;self._challenge=challenge;self._state='pre_verified'
            out.update(status='consistent_fixture_pre_start_not_authorization',verification='fixture_sources_only',
                       preStartSha256=_r.canonical_sha256(stage),contractResult=result)
        except (ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:self._reject(out,error)
        return out

    def verify_pre_open(self,stage,receipts=None,*,challenge,now_ms):
        out=self._base('pre_open')
        try:
            _r._require(self._state=='pre_verified','pre_start_session_unverified');self._state='failed'
            stage,receipts=copy.deepcopy((stage,receipts))
            _r._require(isinstance(stage,dict) and 'launcherSourceVerified' not in stage and
                        'privateChannelVerified' not in stage,'input_verification_flags_not_trusted')
            _r._require(challenge==self._challenge,'cross_session_challenge')
            package={'stage':stage,'preStartSha256':_r.canonical_sha256(self._pre)}
            expected={('stage-observation','all'):stage}
            for role,field in [('post-lease','lease'),('child-launch','child'),('inheritance','inheritance'),('barrier','barrier')]:
                _r._require(isinstance(stage.get(field),dict),'stage_source_unverified');expected[(role,'subject')]=stage[field]
            self._authenticate(package,expected,receipts,'pre_open',challenge,now_ms)
            stage['launcherSourceVerified']=True;stage['privateChannelVerified']=True
            result=_l.evaluate_pre_open(stage,pre_start=self._pre,now_ms=now_ms,
                                       trust=self._trust(stage,now_ms),pre_trust=self._pre_trust)
            _r._require(result['status']=='consistent_pre_open_not_authorization','pre_open_contract_rejected')
            self._state='complete'
            out.update(status='consistent_fixture_pre_open_not_authorization',verification='fixture_sources_only',contractResult=result)
        except (ValueError,TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:self._reject(out,error)
        return out

    def _reject(self,out,error):
        self._state='failed';text=str(error)
        out['reasons']=[text if type(error) is ValueError and text.replace('_','').isalpha() else 'malformed_stage_sources']
