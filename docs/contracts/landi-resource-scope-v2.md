# Proposed Landi resource scope v2

The separate `landi-resource-conflicts-v1` pure entry and
[fixture stage composition](landi-stage-authentication-v1.md) split resource/instance
checks from lease inheritance. This document's existing v2 entry retains its lease
requirement; it is not used to manufacture pre-start inherited-match evidence.

The independent proposed [two-stage lease contract](landi-lease-stages-v1.md)
separates pre-start holder proof from post-spawn pre-open inheritance. Its pure
evaluators are not connected here. Existing v2 semantics and rejection stay intact.

## Independent OS source scaffold

`scripts/guarded-os-evidence-source.py` provides one-attempt `OSReadOnlySource`.
Its default rejects `real_OS_collection_not_connected`; no real executor, CLI,
native library or controller/Storage connection exists. Only explicitly injected
fictional byte replies are parsed. It checks fixed argv and complete reply sets
for inventory, manager absence/disable state, target listeners and file users;
strict UTF-8, bounded output, explicit status codes, metadata for work and all
sidecars, and full before/after process/executable consensus. The decoded native
fixture frame uses the existing 136-byte BSD layout marker but does not decode or
authenticate real ABI bytes. All process inventory rows require matching frames;
there is no filtering by title or same-Node exception. Occupancy, stderr warnings,
unknowns, changed identity, missing replies or stale/future scope reject observation.

Clean parsing yields only `consistent_fixture_observation_only`. Overall status
remains `rejected`, with launcher and lease `unverified`, no trust or verifier
receipt, and real-source authentication false. A digest records fictional raw
bytes by deterministic hex encoding, not provenance. This scaffold does not call
or change the existing authentication layer or pure evaluator entry.

Lock inheritance subjects are explicit: the control-session process holds
`holderFd`; the business child, whose PPID is that holder PID, receives
`receiverFd`. These FD numbers can differ. Both subjects use full process-instance
identity and must refer to the same lock-file identity. Before business spawn,
receiver identity/FD are null and inheritance is pending, never true. After spawn,
matching supplied FD subjects remain fictional consensus, not capability or
continuous-lock proof. `inheritedIdentityMatched` and `heldContinuously` in the
adapter's result remain false. No actual descriptors are opened or inspected.

The v2 evaluator's existing pre-start `inheritedIdentityMatched` boolean is not
yet integrated and cannot be populated as true for a future business child.
Future integration must explicitly stage pre-start controller lease possession
and post-spawn business-child inheritance, updating both producer and consumer
contracts under separate authorization. This change clarifies the boundary only;
it does not alter that evaluator or weaken its current rejection.

## Independent evidence verification scaffold

`scripts/guarded-evidence-verifier.py` adds a single-attempt `EvidenceVerifier`.
The default instance rejects with `real_source_adapter_not_connected`. There is
no real source registry, collection adapter, CLI, controller or Storage hook.
Only an explicitly injected in-memory `fixture_sources` policy supports fictional
producers. It is not accepted from evidence JSON. Test-only HMAC-SHA256 keys and
role permissions authenticate fixture messages, not native OS or launcher truth.
Do not provision production keys into this fixture-only API.

The fictional protocol covers two observation receipts, two lease receipts, and
one launcher receipt for each candidate in each scan. Every receipt binds source
ID and permitted role, session challenge, envelope and subject digests, scan index,
PID, exact facts digest, observation time and expiry. The HMAC input is the ASCII
canonical SHA-256 of that exact message. Unknown roles/sources, duplicate or missing
coverage, changed subjects, stale/future replies and altered signatures reject.
The caller supplies a fresh challenge per session; the verifier consumes one
attempt even on failure. It never retries. In-memory state prevents reusing the
same verifier, not replay across independently constructed fixture instances;
future real ingestion must establish its own fresh challenge and trusted clock.

Only after all fixture receipts pass does the verifier build a non-exported
short-lived fixture trust context and call the pure evaluator. A signed conflict,
missing launch identity or lost lease still rejects. Missing launcher or lease
source/facts remain unverified. Success is explicitly
`consistent_fixture_not_authorization`, `verification: fixture_sources_only` and
`realEvidenceAuthenticated: false`; no result authorizes exclusion or startup.
The verifier neither authenticates historical launchers nor acquires/checks real
locks. Its consistency result must never be passed into current admission as a
real source receipt. Future live producer authentication remains unimplemented.

This is a standalone contract and pure evaluator, not an active admission rule.
`scripts/guarded-resource-scope.py` exposes
`evaluate_resource_scope(evidence, *, now_ms, trust=None)`. It has no CLI, IO,
OS adapter, authenticated reader, controller or Storage integration. Production
and local kinfo compatibility remain disabled. Existing same-Node admission
blocking is unchanged. No deployment artifact is updated by this work.

## Trust and subject binding

The evidence envelope requires integer `version: 2`,
`policyVersion: landi-resource-scope-v2`, and false production/compatibility
fields. `subject` names project root, controller and old process identities,
candidate/baseline deployment IDs and registered entries, manager label,
127.0.0.1 target port, pinned Node, work file and lock file.
Process identities contain PID, PPID, UID, real UID, start seconds and microseconds.
Files contain absolute lexical-normal paths, device and inode; executable/entry
files also carry SHA-256. These spellings do not prove filesystem canonicality:
the future OS ingestion boundary must establish it independently.

`trust` is a separate caller argument, never extracted from the evidence JSON.
It must bind the canonical envelope and subject SHA-256, a hashed verifier file
identity, verified time and expiry. Canonical JSON uses sorted keys, compact
separators, ASCII escaping and disallows nonfinite numbers. Caller context is
not authenticated by this pure function: it only checks structure and consensus.
No real authenticated ingestion adapter exists yet. Self-supplied `verified`
flags, launcher receipts, diagnostic reports or issuer hashes alone establish
no authority. The future boundary must authenticate the producer and validate
original bounded OS replies, coverage and launcher receipts before constructing
this argument. It must not accept arbitrary JSON as trusted context.

## Two observations under one lease

Two ordered scans bind the subject digest, with start/end times no later than
verification time. The first scan and trust validity must both fit within 15
seconds of the caller's evaluation time. Future, stale or overlapping scan
windows are rejected. A future caller must provide an actual clock, not a saved
snapshot clock, and repeat observation under the same lease if it expires.
Evaluation consistency itself is not a reusable launch receipt.

Each scan requires authenticated complete scoped visibility, an empty unknowns
list, matching work identity and explicit absence of WAL/SHM/journal, verified
manager absence/disabled state, and complete empty target listener, file-user
and control-owner sets. Missing replies are not empty results. The producer must
cover wildcard and IPv6 overlaps and file aliases using device/inode identity.
It must cover Landi instance/entry/control candidates regardless of Node path;
"scoped" never means filtering solely by command title, UID, CWD or Node name.
Unclassifiable candidates remain unknown and cause rejection. This module does
not decide which inaccessible system processes are outside that scope.

The proposed initial admission permits only standalone, single-link work files.
This avoids using hardlink path aliases to derive separate lock names. The lock
path is the current canonical work-parent `.landi-control/<SHA256(path)>.lock`;
the lock must be single-link, mode 0600, owned by the controller UID. Both scans
must attest actual nonblocking acquisition, continuous ownership and matching
inherited file identity. The future adapter must verify the private directory,
real filesystem identity and lock capability; file presence or a stale PID is
not a lease proof. Locks remain advisory and do not replace resource queries.

## Instance and same-Node conditions

Candidate process sets and their full bound evidence must agree between scans
(row ordering is ignored). Each process needs stable before/after identity and
hashed executable, plus an authenticated launch record binding that identity,
executable, entry, project root, deployment ID and receipt digest. Missing launch
authority is rejected even if the process uses a different executable. An old
PID still present is rejected conservatively, including observed reuse.

A process conflicts if it names the Landi project, a registered deployment or
an entry matching registered path or device/inode, or any target resource/control
query is positive. A different project receipt cannot override these conflicts.
Every other candidate requires a complete clean subject-bound resource check.
Only then may a same-Node process appear in `excludedFromProposedScope`.
This list describes the proposed contract result; `mayExempt` remains false,
and the current controller still blocks it. CWD, parent, title, another port,
ESRCH, later absence or an unverified issuer cannot establish exclusion.

## Outputs, rejection and future integration

Success is `consistent_not_authorization`; failure is `rejected` with a bounded
reason code and no excluded processes. Every result retains `executable: false`,
`admissionDecision: unchanged`, `mayExempt: false`, closed gates and historical
`preStopDrained` / `externalOperationOutcomes: unverified`. No cancellation,
retry, signal, startup, permission change or lock operation is performed.

Future integration must version the controller observation and Storage consumer
together. Existing `replacementAbsent: true` cannot be reinterpreted as v2 proof;
old evidence keeps its original meaning. The independent report may explain
reasons but never issue authority. The current controller, Storage and artifacts
are intentionally untouched until separately authorized.

## New acceptance only

Fictional checks must exercise valid foreign same-Node consensus without launch
authority; missing trust and digest/scope mismatch; stale/future/changed scans;
port/IPv6/file alias/control/instance conflicts; missing or denied visibility;
work replacement/hardlinks; lock loss/path/permissions; PID reuse and disappearance;
false launcher claims; strict boolean handling; pure no-IO evaluation; and unchanged
controller, Storage, artifacts and prior result digests. A failure stops the run
and retains its completed cases and failure evidence. Historical checks are reused,
not rerun. Real OS authentication and actual startup remain unverified.
