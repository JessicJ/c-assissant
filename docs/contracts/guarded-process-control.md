# Owned guarded deployment control

This increment implements controller primitives and the guarded child protocol.
It does not start a real service, replace compiled releases/static manifests,
collect real launch admission, or enable any production execution. The Python
entry point reports library-only status; there is no real-service run command.
A future caller must supply fresh independently collected OS evidence and a
reviewed launch plan. No claim here establishes pre-stop drain or delivery.

## Advisory kernel lease

`scripts/guarded-deployment-control.py` requires an existing canonical, owner-held,
single-link work database. It never opens SQLite. A private `.landi-control`
directory next to that work database holds a stable path-keyed lockfile. The
lockfile is never deleted or treated as authoritative merely because it exists.
`flock(LOCK_EX|LOCK_NB)` fails before child creation if another cooperating
controller holds the lease. Working-file device/inode and lockfile identity are
rechecked; replacing the database or lockfile is rejected. Hard-link work aliases
and symlink paths are rejected.

The child inherits the same open lock description. Closing/crashing the parent
alone therefore does not release the lease while the child holds it. The child
retains that FD until exit. A normal release requires a closed receipt plus
verified exit, listener absence and no work-file users. No automatic stale-lock
cleanup, database restore or restart occurs. This is advisory mutual exclusion;
it does not prevent an unrelated program ignoring the protocol from opening the
file. Actual OS file-user observation remains necessary.

## Explicit owned process and private pipes

`OwnedProcess` validates explicit executable/entry hashes, manifest/admission
pins, canonical release/work paths and matching origin before its sole spawn.
No shell is used. The environment is constructed from explicit guarded inputs;
ambient NODE_OPTIONS and credentials are not forwarded. No service-manager
commands, signals, kill, restart, install, backup or SQLite calls are present.

Two anonymous pipes carry newline-delimited JSON frames, bounded at 4096 bytes.
The child receives their FDs, an inherited lock FD/path, expected parent PID,
random deployment ID and nonce. The controller never logs the nonce or a complete
environment. Stdout/stderr are private evidence, not control acknowledgements.

`guarded-process-control.ts` validates inherited pipe types, lock FD identity and
permissions, parent PID and tokens before post-stop guarded storage construction.
That real listening entry requires capabilities; the non-listening construction
factory remains usable for injection. Child events bind deployment ID, nonce,
PID, parent PID, manifest SHA, work path and origin. Ready additionally requires
an independent OS observation matching stable process identity and listening
ownership. Fresh observation times/raw records are not compared as immutable
process identity; PID, parent, UID, executable and start time are.

Observers passed to the controller must distinguish unknown from absent. Only
an independently confirmed absence may return None/False. Fictional test
observers are labelled fixture and cannot be used as real deployment evidence.
This module does not implement that real OS collector or a collector's trust
policy. It checks the child's full admission again through the actual guarded
entry; Python structural checks alone are not a startup authorization.

## Close and failure meaning

The owning controller verifies unchanged process identity before writing one
shutdown request. No PID-only signalling is implemented. The guarded child waits
for its shared stop Promise to close admitted HTTP work and its own store before
emitting `closed`. It exits zero only after successfully emitting that receipt.
Close exceptions emit `shutdown_failed`; no retry or successful exit is claimed.
Controller-pipe EOF routes through the same resource close, retaining the child
lease until exit. Invalid IDs, malformed/oversized frames and pipe errors remain
failed/unverified rather than initiating cancellation of another instance.

The controlled lifecycle shares the same Promise for concurrent stop requests,
including a rejected one. Guarded signal failure no longer uses finally-exit(0).
Standard startup behavior is unchanged except that concurrent closes now share
their existing operation. No generation cancel/recovery or scheduler is added.

The controller accepts `closed` only for its child, then requires process exit,
listener release and no database users before lease release. Timeout, mismatch,
missing acknowledgement, nonzero exit or unknown observation is append-only
failure evidence. No automatic kill, second close, fallback or restart follows.
A failed live child retains its inherited lease. A future operator must resolve
that condition explicitly; exiting a controller is not proof of safe closure.

## New checks only

- `scripts/guarded-process-control.test.mjs`: fictional streams/stub lifecycle;
  missing capabilities, one shared close, invalid identity/frames, failure and
  parent EOF. Native Node TypeScript stripping reads source without emitting any
  compiled artifact; no real server/listener or database is constructed.
- `scripts/guarded-deployment-control.test.py`: finite fictional Node children,
  actual private pipes/kernel locks, and new byte-copied work databases. Children
  import only the process-control source and open their own copies read-only.
  No Fastify service or listener is started. Duplicate lock, inherited lock,
  identity conflict, failed/timeout close, EOF and wrong nonce are tested. Fixture
  timers terminate only those fictional children; the controller never kills.

Both scripts require an explicit private `LANDI_CONTROL_CHECK_EVIDENCE` directory;
the Python script also requires `LANDI_CONTROL_PRESERVATION`. Failures stop the
check sequence and retain records. Historical tests and formal work databases
are not used. Implemented sources must be separately compiled and their release
manifests updated before a future real deployment; prior artifacts stay intact.

## Close handshake completion

After authenticating a `closed` frame, the controller first closes its command
pipe write end and records `command-pipe-closed`. Only then does it wait for
child exit and verify OS absence/listener/file-user evidence. Closing the command
pipe lets a pending child pipe read reach EOF during Node process teardown. The
event pipe closes after exit verification, before lease release. Invalid/missing
closed frames do not take this success path. Fixture cleanup can separately end
its test-owned pipes; this is not production retry, kill, or successful release.
