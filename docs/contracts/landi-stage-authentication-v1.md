# Fixture-only two-stage authentication composition

`scripts/guarded-stage-evidence-verifier.py` adds a standalone
`StageEvidenceVerifier`. Real sources are not connected; no collector, controller,
Storage, service, artifact or UI entry is changed. The existing v2 verifier and
same-Node admission policy remain unchanged. No successful result authorizes spawn,
database opening, process exclusion, continuation or production execution.

## Independent resource prerequisite

`evaluate_resource_conflicts` in `guarded-resource-scope.py` accepts a new explicit
envelope (`version: 1`, `policyVersion: landi-resource-conflicts-v1`). It shares
the existing resource and instance checks: complete fresh ordered scans, manager
absence/disabled state, clean target listeners/file users/control owners, standalone
work-file identity, complete candidate identities and authenticated foreign launch
bindings. It does not require a lease or future child inheritance and rejects lease
fields embedded in scans. This result does not establish lock possession.

The existing `evaluate_resource_scope` v2 API still requires its original lease
evidence and policy/version; it is not relabelled or silently relaxed. The new
resource contract is only composed with the independent staged lease contract.

## Authentication and assembly

Test-only source policies (key bytes and permitted roles) are supplied in memory,
never loaded from evidence. Fixtures use HMAC-SHA256 of the canonical message
digest; no production key or source registry exists. Every receipt covers its
source/role/item, stage, challenge, complete package digest, exact facts digest and
expiry. Coverage must be exact, with no missing or duplicate receipts. Source role,
payload, package and cross-stage substitutions reject even with a valid signature.
OS fixture observations remain supplied facts, not independently authenticated
OS truth. The OS source adapter is unchanged and does not mint these receipts.

Pre-start input supplies raw stage facts and separate resource evidence, not an
externally populated resource success summary. Required roles are resource
observation, per-scan/per-candidate foreign launch, stage observation and holder
lease. The stage subject pins `resourceSubjectSha256`; controller/work/Node,
registered entry and deployment membership must also match. The full resource
subject (including target port, root and instance scope) is therefore bound rather
than reconstructed from the smaller lease subject.

After receipt verification, the new resource evaluator must pass before the
composer creates `resourceAssessment` internally. That summary names the new
resource policy and binds the original resource digest/time and staged subject.
The composer then constructs private ephemeral fixture trust and calls the
pre-start evaluator. Caller-provided summaries are rejected. No synthetic
`inheritedIdentityMatched: true` is manufactured to satisfy the legacy v2 contract.

Only one successful pre-start attempt advances the object to pre-verified state.
It stores copies of the assembled original facts and trust, challenge and digest.
Pre-open requires the same object and challenge, the exact pre-start digest, and
separate receipts for stage observation, post-start lease, child launch, inherited
capability and private-channel waiting barrier. Caller verification flags are
rejected; only the verified fixture receipts populate those internal flags. The
staged evaluator rechecks the original pre-start evidence and trust at current
time, lease continuity, child and barrier. An ordinary ready receipt cannot replace
the waiting barrier. No API returns the internal trust context.

All failures are terminal for that object, including wrong order and malformed
inputs; success can advance pre-start to pre-open exactly once. The caller must
provide a fresh challenge for each future real session and a genuine clock.
Expiry remains 15 seconds; a pure session object cannot guarantee cross-process
replay prevention or actual lock continuity. Real acquisition, descriptor inheritance,
foreign launch authority and OS provenance remain unverified/unimplemented.

Success statuses are `consistent_fixture_pre_start_not_authorization` and
`consistent_fixture_pre_open_not_authorization`, always with execution/spawn/open/
exemption flags false, real authentication false and production/compatibility off.
Missing, conflicting or expired resource, launcher, lease, child or barrier sources
reject and expose no contract success result. No retry, process or database action
is performed. Historical evidence and test files are preserved.
