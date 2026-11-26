# Local maintenance and drain evidence

This source change does not instrument an already running process. It does not
replace the frozen candidate/baseline, update their inventories, or establish
real cutover readiness. Production execution gates remain closed.

## Opt-in and identity

Only a future standard-mode process started with an explicit
`LANDI_MAINTENANCE_TOKEN` (at least 32 characters; use a random secret) enables
these controls. Without it, no maintenance routes or work registry are installed.
The generated `maintenanceInstanceId` is logged at startup; the secret is not.
The guarded-workbench and readonly-diagnostics startup paths are unchanged.
This is not authorization to start, restart or take over any existing service.

Register `registerMaintenanceControl` before all business routes. Both endpoints
require a loopback socket peer, `Authorization: Bearer <secret>` and
`X-Landi-Instance-Id` matching that process. Forwarded headers are not identity
evidence. Responses use `Cache-Control: no-store`.

- `GET /internal/maintenance/snapshot`: process-local reads only; no storage or
  CLI access and no state transition, cancellation, sending or recovery.
- `POST /internal/maintenance/drain`: optional `timeoutMs` integer, 1–300000,
  default 30000. Closes admission synchronously and pauses lifecycle timers.
  Repetition does not reopen admission or reset the deadline. No resume endpoint.

## Work boundaries

Maintenance rejects all subsequent business requests, including GETs, to avoid
assuming that a route is free of side effects. Already admitted requests retain
their lease until their handler and response finish. A disconnect is an
uncertainty, not proof that a handler stopped. Detached work needs its own lease.

The shared monitor wrapper registers scheduled and manually triggered monitor
work. New monitor triggers and generation enqueue calls are refused/skipped
before business storage access. The generation observer counts actual generation
promises and background image continuations without querying a database.

The scheduled email worker stops claiming further messages after drain. A claimed
message finishes through its existing processing path; maintenance does not
abort SMTP, cancel a Task, clear a queue or force delivery. Unknown send results
remain explicitly uncertain. Delivery counts cover this worker; other HTTP send
operations remain covered by their HTTP lease, and their persisted outcomes are
not inferred from that lease.

## Meaning of the snapshot

`normal → draining → locally_drained`, or `blocked` on deadline expiry. Even a
previous local-zero observation expires at that deadline; GET does not renew it. Failed
pause callbacks, background work failures and ambiguous delivery/disconnect
outcomes remain recorded. Missing or invalid observers produce `unverified` and
`count: null`, never zero. Snapshot timestamps describe this observation only;
they do not refresh historical evidence.

`locally_drained` means only that all installed local observers report zero and
no recorded issue remains. Historical queued mail, persisted uncertain operations,
external MAH Task state and manager/stop evidence are not collected here.
`writesDrained: null`, `readyToStop: false` and `executable: false` remain explicit,
even for local zero counts. Queued mail is preserved separately from active sends.

The opt-in lifecycle refuses its stop operation while `readyToStop` is false;
it does not invoke generation abort or exit on that refusal. This implementation
does not expose a stop action, complete manager control, or provide a deployment
procedure. Do not use it as a launchd shutdown/cutover mechanism. Enabling a real
stop path requires separate verified evidence and review.

## Targeted verification

Run only `node --import tsx --test src/maintenance-control.test.ts` from
`apps/server`. These new tests use request injection, in-memory fake storage,
fake transport receipts and a fake lifecycle/listener/scheduler. They do not open
SQLite, listen on a socket, invoke MAH or send email. Source type checking uses
`noEmit` and workspace source mappings rather than rebuilding stale dependency
declarations. Existing compiled releases and historical tests remain untouched.

## Separate startup in maintenance

`LANDI_SERVER_MODE=maintenance-bootstrap` selects a separate branch before standard
startup. It starts with business admission closed; it imports no business storage,
Agent/CLI runtime, recovery, monitor or business routes, and never loads `.env`.
Explicit inputs are `LANDI_MAINTENANCE_APP_ROOT`,
`LANDI_MAINTENANCE_MANIFEST_PATH`, `LANDI_MAINTENANCE_MANIFEST_SHA256`,
`LANDI_MAINTENANCE_PORT` and `LANDI_MAINTENANCE_TOKEN`. No default paths or ports
are used. Its separate manifest pins canonical root, temporary loopback origin,
a distinct old-service origin, Node version, all compiled server files and the
lockfile. Unknown fields, mutations, unlisted files, escaping paths and symlink
files fail closed. This manifest has no database or configuration-file path.
Installed dependency completeness is not inferred from a lockfile digest.

The construction factory supports injection without listening. The listening
entry also checks its compiled entry path against the pinned root. Only the two
authenticated maintenance endpoints are registered. There is no storage attach,
business activation, service-manager operation, takeover or resume endpoint.
The snapshot role is `candidate_bootstrap`. Uninstalled business observers stay
unverified. Closing this instance only closes its own temporary diagnostic server;
it never stops the old service. A future listen failure is returned without a
port retry or fallback. Existing frozen releases do not contain this new code.

## First takeover assertions

`first-takeover-contract.ts` is a pure evaluator, not a collector or executor.
The version-1 envelope declares old instance ID, role `old_service`, PID, start
time, origin, artifact SHA-256 and database path. Each fact must bind exactly this
identity and carry status `observed`, its allowed source, a fresh observation
time (at most 60 seconds old, not future) and raw-record references with SHA-256.
Assessment never opens those references, a database or any CLI.

| Fact | Allowed source | Required assertion |
| --- | --- | --- |
| identity | os_identity_and_startup_record | OS owner and running artifact match |
| admission | old_process_admission | All old business entrypoints closed |
| drain | old_process_work_registry | Schedulers paused; requests, background, generation and active delivery counts zero |
| persisted | consistent_storage_snapshot | Uncertain count zero, queued-mail count known, queue preserved |
| manager | os_service_manager | Automatic restart prevented |
| exit | os_process_and_listener | Same old owner exited, port released, no replacement |
| backup | consistent_backup_verification | Consistent, integrity OK, correct DB path, schema/file SHA and drain-record binding |
| compatibility | backup_copy_readonly_inspection | Same backup copy, schema 27 and full schema SHA match candidate/baseline, historical compatibility, no mutations |

Temporal order is admission → drain → exit → backup → compatibility/persisted,
with manager pause before exit. Historical queued mail may be nonzero and is
preserved. Candidate zero counts, reused PIDs, missing records, unknown sources,
stale/future samples and mismatched backup/schema identities cannot satisfy old
service facts. The old process still needs its own first-stop evidence.

Even complete assertions return only `consistent_unverified`, with
`rawRecordsIndependentlyVerified=false`, `oldServiceDrained=null`,
`readyToStop=false` and `executable=false`. A declaration is not independent proof.
Missing evidence is `unverified`; no evaluation triggers an operation.

For this addition, run only
`node --import tsx --test src/maintenance-bootstrap.test.ts` from `apps/server`.
It uses temporary fictional release metadata, injection and fictional evidence;
it does not compile a release, open SQLite, start a listener or rerun historical
tests. Type checking uses source mappings and `noEmit`.
