# Two-stage lease contract v1

The [fixture-only authentication composition](landi-stage-authentication-v1.md)
now assembles the resource prerequisite internally after independently evaluating
`landi-resource-conflicts-v1`. The subject additionally binds its full resource
subject digest. No live source, controller or Storage integration is present.

`scripts/guarded-lease-stages.py` provides pure `evaluate_pre_start` and
`evaluate_pre_open`. This is an independent proposed contract; it does not change
resource-scope-v2, OS sources, authentication, the controller, Storage, or artifacts.
No IO, clock acquisition, process creation, lock acquisition, database opening,
signal, retry, continuation or permission change is performed.

## Shared subject and trust boundary

Version 1 evidence names `landi-lease-stages-v1`, its stage, closed production and
compatibility fields, observation start/end, and a subject containing controller
identity, work/lock identities, Node/entry pins, manifest digest, deployment ID,
challenge and private channel ID. Work and lock must be single-link. The lock
uses the canonical-work-path hash name in `.landi-control`, mode 0600 and the
controller's UID. Actual canonicality and private directory checks are trusted
source obligations, not established from string equality.

Each stage takes a separate caller `trust` argument binding its exact evidence
and subject digests, verifier pin, verified time and expiry. No stage extracts
trust from evidence. Like the other pure contracts, the evaluator checks supplied
consensus, not source authenticity; no real trusted ingestion exists yet. All
facts claiming capabilities or verification must come from that future boundary.
Fictional flags cannot be used as real proofs. Caller time must come from a real
clock in future integration. Evidence and trust expire within 15 seconds; the
pre-start evidence must still be fresh when evaluating pre-open.

## Stage A: pre_start

The control-session process is the holder. Its full identity before/after, actual
holder FD, lease ID, work/lock identity, nonblocking acquisition, acquisition time,
private directory/capability verification, empty unknowns and continuous ownership
through the observation end are required. The original acquisition and holder FD
must remain unchanged in stage B; reacquisition is not continuity.

The child does not yet exist: `childCreated: false`, child identity and receiver
FD null, `inheritance: pending`. No inherited-match assertion is accepted early.
The separate subject-bound resource prerequisite must describe current consistent
resource scope, no conflicts/unknowns, verified launcher sources and an original
evidence digest/time within this stage. `resourceAssessment` names
`landi-resource-conflicts-v1` and is assembled by the fictional authentication
composer after raw resource checks; it is not a legacy v2 success result.
A supplied summary cannot replace independent OS/resource/source verification.
Resource rules remain a separate necessary prerequisite. Real ingestion is still
absent; old evidence must not be relabelled as the new prerequisite.

Stage A returns only `consistent_pre_start_not_authorization`. Its conceptual
next step is a separately authorized controlled child creation, never opening a
database or claiming inheritance. `maySpawn` remains false in the pure result.

## Stage B: pre_open

The evaluator takes the original pre-start envelope and its trust separately,
re-evaluates them at the current time, and requires its digest in the post-spawn
envelope. Subject, challenge, deployment, manifest, channel, lease ID, acquisition,
holder identity/FD and work/lock identities must agree. Ordered observations and
extended continuous ownership are required; a cached success result is insufficient.

The business child must have stable full identity and matching controller PPID,
UID/real UID; its birth occurs after pre-start completion and before this observation
ends. Executable and entry must match the pinned subject. The inheritance binds
the holder identity/FD, receiver identity/FD, matching lock identities and a trusted
same-inherited-capability observation. Matching inode alone is insufficient.
Receiver and holder FD numbers may differ.

An authenticated private-channel barrier must be `waiting_pre_open`, bound to
child, deployment, manifest, work identity and channel. Database opening, listening,
background work and receiving a continuation must all still be false. An ordinary
`ready` event is rejected. Launcher source and private channel verification are
separate requirements. This stage returns `consistent_pre_open_not_authorization`;
`mayOpenDatabase` remains false. A future runtime handshake must obtain fresh
stage-B evidence, recheck the lease and only then issue a separately authorized
one-time continuation; none of that protocol is implemented here.

## Rejection and limits

Missing, stale, conflicting, future or malformed evidence returns `rejected` and
no success evidence digest. All results preserve unchanged admission, false
execution/spawn/open gates, disabled production/compatibility, and historical
drainage/external outcomes unverified. Pure evaluation has no persistent replay
ledger: challenges, single-attempt consumption and prevention of release/reacquire
must be enforced by a future live holder, not inferred from arbitrary JSON.

If future runtime verification fails, it must not open the work database, send
continuation, retry, or claim success. Any child already created, uncertain close
and lease retention require the existing controlled failure protocol; this pure
module neither kills the child nor releases the lock. Listening/ready verification
after opening is another runtime check, not part of these two pure stages.

## New fictional acceptance

Checks cover correct phase boundaries without execution rights; missing trust,
resource and launcher prerequisites; early inheritance/open/listening/background
claims; lease loss/reacquisition/FD or file replacement; parent/child reuse and
identity mismatch; private-channel and manifest binding; strict booleans; expiry;
pure no-IO evaluation and unchanged existing source/artifact/evidence digests.
No historical tests or real services are used. Failure stops and retains evidence.
