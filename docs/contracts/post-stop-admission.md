# Post-stop preserved-copy admission

This is a separate admission route for guarded local review and explicit requirement
saving. It is not evidence of pre-stop drainage, graceful exit, external delivery,
MAH execution, or production readiness. Existing drained-cutover and backup-only
readonly admission remain unchanged. The original database and preserved files
are never writable workbench inputs.

## Explicit selection

Use `LANDI_SERVER_MODE=guarded-workbench` together with
`LANDI_GUARDED_ADMISSION_KIND=post-stop-preserved-copy`. Explicit
`LANDI_GUARDED_POST_STOP_EVIDENCE_PATH` and
`LANDI_GUARDED_POST_STOP_EVIDENCE_SHA256` pin the new record. All existing guarded
root, database, configuration, origin and manifest inputs remain mandatory.
Missing/malformed pins or an unknown kind fail; there is no fallback. These
instructions do not authorize a service start. No actual deployment admission
was created by the implementation checks.

## Record version 1

- `purpose: post_stop_guarded_workbench`, `scope: post_stop_preserved_copy`.
- `preStopDrained`, `gracefulExit`, and `externalOperationOutcomes` must each be
  `unverified`. `productionExecutable`, `automaticResume`, and `restoreDatabase`
  must be false. Old unknown counts are never converted to zero.
- `originalDatabasePath`; `preserved: {path, sha256}`;
  `working: {path, sha256, initialSha256}`. Working path must be canonical and
  separate from original and preserved/old sealed files. Initial digest binds
  the preserved file; current digest binds the work-copy audit and copy lineage.
- `candidate` and `rollback` use the guarded release bindings: mode, manifest
  SHA, lockfile SHA, reviewed historical schema SHA, same origin/database/config
  and browser storage-key SHA. Both new manifests must include
  `storageKeysSha256`. Inventories and configuration digests are checked for
  both roles. Lockfile identity alone is not installed-dependency attestation;
  reuse independently verified release preparation evidence when deploying.
- `evidence` holds `{path, sha256}` references named `stopFailure`,
  `exitConfirmation`, `preservation`, `workVerification`, `priorSeal`,
  `currentObservation`, `copyLineage`, `compatibilityAudit`, `candidateManifest`,
  and `rollbackManifest`. Existing failure and historical records are not edited.

Every JSON pin is canonical, nonsymlink, size bounded and digest checked.
Stop-failure and exit-confirmation raw record references are checked too.
The preserved file is readonly; work and preserved copies must have no companion
files. Multi-file preservation must first be recovered into a separate work copy
and separately reviewed; the loader never recovers or normalizes preserved files.

`currentObservation` binds the work database, observation time, old PID absence,
manager removal/disable, port release, replacement absence and no file users,
plus nonempty raw-record pins. It expires after 60 seconds. This is fresh
exclusive-access evidence, not a new timestamp on old stop records. No collector
or OS command is invoked by the loader; supplied claims remain assertions until
an independent deployment controller verifies the actual observations and enforces
exclusive access. Consistency never proves the observations by itself.

`copyLineage` has `status: observed`, working/preserved paths, initial and current
SHA. For a new work copy, both SHA values equal the preserved SHA. After explicit
saves, a fresh reviewed lineage/audit/observation record must bind its current
bytes before another admission, including rollback. The loader does not create
or endorse lineage records, restore a database or discard saved requirements.

`compatibilityAudit` has status passed, work path/current SHA, exact
`retainedDifferences`, complete `facts` and canonical `factsSha256`. The storage
constructor rechecks evidence before constructing SQLite, then recomputes the
entire historical audit and rejects mismatching facts or any violation before
returning a store. There is no migrate/seed/backfill path in this mode.

## Historical structure and limits

The historical fingerprint remains
`b9379f042cd62eb08b907687111a7d080e3cb6267fa36a7f9720b81d31267bc3`.
The fresh-schema fingerprint is not substituted for it. Quoting/whitespace,
column order, the historical plan configuration default and missing carrier /
stage CHECKs stay unchanged. Data predicates compensate by checking current
values, not by adding constraints. Revisions, proposals, JSON, timestamps,
foreign keys, research/blueprint/lineage and receipt versions are audited.
Empty carrier/receipt tables still have unverified runtime coverage.

The existing guarded runtime and request allowlist remain in force: local reads
and explicit new-plan requirement saving only. No Agent selection in Landi,
Agent construction, CLI, SMTP, scheduler, recovery, confirmation or retry is
introduced. MAH remains responsible for Agent choice and eventual execution.

## Targeted checks

`scripts/post-stop-admission.test.mjs` 使用 `docs/guarded-workbench.md` 说明的共享合成 Schema 27 helper、虚构保全元数据和隔离工作副本。VM seam 只替换已审阅指纹；未修改的生产门禁必须拒绝夹具。测试不使用真实保全清单或原数据库。源码模块加载不生成或替换发布产物；监听器、定时器、fetch 和子进程操作均被截获，构造和请求注入不启动监听器。

检查覆盖无写入打开／读取／关闭、SQLite 打开前拒绝、未知状态保留、过期／缺失证据、回滚不匹配、完整审计重算、执行／邮件／恢复拦截，以及明确的虚构保存后在同一工作数据库重新进行精确回滚准入。既有历史测试和冻结产物不执行、不修改；原手工保全检查继续归档在 `scripts/manual/guarded-history/`。真实发布清单、OS 观察、复制 lineage 证明及部署准入仍是独立工作。

## Internal dependency links

Both manifests record `links: [{path, target, resolvedTarget}]` separately from
regular files. All three paths are relative to their specified bases: link path
and resolved destination to the release root; raw target to the link parent.
The raw target must exactly match readlink; canonical resolution must remain
inside the same release and equal resolvedTarget. Absolute, dangling/cyclic,
escaping, duplicate, ancestor-aliased and unregistered links are rejected. The
complete release tree is inventoried without following links; destination file
bytes are pinned by the regular-file inventory. Existing internal dependency
cycles are permitted when every link resolves to an existing in-unit target.
No new dependency resolution, installation or network request is performed.

## OS observer and prepare-only controller entry

`scripts/guarded-deployment-control.py` now provides `OSObserver` and
`prepare_admission`. The observer runs bounded, fixed read-only `ps`, `lsof`, and
`launchctl print/print-disabled` commands; it never signals a process or changes
service management. Raw results are pinned in the private journal. Parsing errors,
permission warnings, conflicting owners, missing subjects and observations taking
more than 15 seconds reject admission. Observations reflect OS visibility and do
not establish historical drainage or external delivery.

`--prepare-plan PATH --plan-sha256 SHA --journal NEW_PRIVATE_DIRECTORY` is a
prepare-only entry, with no real launch command. The pinned plan names
`databasePath`, `spec` (the LaunchSpec fields), `template` (existing admission JSON
pin), `subject` (`old_pid`, `label`, exact `replacement_executables`), `node` and
`loader` pins, and `productionExecutable: false`. Replacement scope must be
explicit and nonempty. The loader pin identifies the previously verified Storage
`post-stop-admission.js`; its existing filesystem-only loader validates the full
record before preparation succeeds. No SQLite construction is performed here.
The release inventory must bind that loader and its imported modules; preparation
is not a substitute for release/runtime attestation.

The live controller retains its deployment lease across observation, preparation
and any separately authorized launch. Nonfixture launch requires that controller's
matching prepared pin and observation no older than 60 seconds. The guarded child
still runs the complete existing policy. Prepare-only CLI exit releases its own
lock descriptor and never authorizes later launch: a later control session must
prepare afresh. Fixture observers cannot prepare a real controller admission.
Historical unknown fields remain unverified; failures are journaled without retry,
restart, cancellation or restoration. New source changes are not automatically
inserted into existing release units.

## Anonymous operator-pipe provenance

The explicit `--session-plan` mode keeps one foreground controller and lease from
admission through launch to verified close. Its pinned plan must name
`purpose: guarded_control_session`, `explicitStart: true`, the exact controller
file/SHA, and `operatorPipe: {version: 1, kind: inherited_anonymous_pipe,
parent: {pid, uid, startSeconds, startMicroseconds}, writerFd}`. The parent creates
an anonymous pipe, retains its write endpoint, and passes only its read endpoint
to the controller as `--session-command-fd`. The plan is ephemeral and separately
pinned; no automatic start is implied by a static prepare-only plan.

Darwin anonymous `fstat` mode/UID values are projections, not filesystem access
control or proof of the creator. Do not chmod the pipe, accept named FIFOs as an
anonymous channel, or merely whitelist mode 0660. Use libproc's exact-size
`PROC_PIDFDPIPEINFO` to establish kernel pipe endpoints and read/write flags;
match reciprocal peer handles to the parent's declared write FD. Bind the direct
parent's PID, UID, real UID and start time using `PROC_PIDTBSDINFO`. Check both ends
and parent twice and revalidate before start and before processing each command.
Retain the original endpoint identity to reject descriptor reuse or peer changes.
Missing, denied, short, unsupported or conflicting kernel evidence rejects input.
The controller FD must also be FIFO-shaped and exactly read-only by `F_GETFL`.

This proves the channel connects to the declared live parent endpoint; it does
not prove exclusive possession of every duplicate FD in the OS. The approved
parent must not share its writer with untrusted processes. No socket, named FIFO,
service-manager operation or additional launcher is introduced. Before spawn a
provenance failure rejects the session; after spawn uncertainty keeps the session
and lease and disables automatic actions. Status remains cached, not OS proof.

## One-shot foreground parent operation

The existing controller also owns the parent mode; no second launcher or service
manager is added. A pinned request for `--parent-plan` must say
`purpose: guarded_parent_operation`, `explicitStart: true`,
`productionExecutable: false`, and name `sessionTemplate` and `runtimeBinding`
JSON pins. The template stays static/disabled and pins the same controller file.
The parent verifies the canonical Python path, digest and version, creates one
anonymous pipe, keeps its non-inheritable writer, and passes only the read FD to
one invocation of the controller's existing `--session-plan` mode. It writes a
new private, pinned live plan with its own UID/start identity and writer FD;
static templates and old evidence are never changed.

Parent mode stays in the foreground. It checks the child's exact ownership and
kernel pipe pairing before sending commands, and reads the child's private
append-only journal with sequence/digest-chain and subject verification. A ready
record is accepted only with prior lease and owner records for that plan. The
parent does not own or reacquire the work-database lock: the same child controller
holds it continuously. Only explicit `shutdown` sends a bounded command. The
writer closes after the matching verified-close, lease-release, session-close
records and a zero exit of the same controller process. Timeout, EOF, changed
identity, malformed journal or uncertain exit retains the parent/writer and stops
automatic actions; there is no forced kill, restart, retry, detach or rollback.
The CLI requires an interactive foreground terminal; status is a scoped cached
projection, not a business readiness or external-delivery claim. An approved
parent must not distribute writer FDs. No MAH command or business database is
opened by the parent itself. Parent mode must be separately incorporated into
new release inventories before use with a real workbench.

During parent shutdown, a journal snapshot taken before observing process exit
may be stale. Observed exit requires one final journal read and full chain/subject
validation before classifying a missing close. Success still requires the exact
verified-close/release/session-close sequence and zero exit of the same child;
missing, changed or nonzero results remain unverified. The final read neither
resends shutdown nor resets the original deadline. A deterministic fixture must
finish the child's close between the first snapshot and exit observation.

## Read-only observer spelling normalization

For the exact launchd label, accept a single complete `print-disabled` declaration
using either `true`/`false` or `disabled`/`enabled`. Only `true` or `disabled`
establishes disabled state. Missing, duplicate, contradictory, malformed or failed
query results remain unverified; unrelated labels never substitute for this one.

Replacement-process exclusion compares strict canonical executable paths and
filesystem `(device, inode)` identities, including symlink and hard-link aliases.
It never searches PATH, infers ownership from a Node name, terminates another
process or excludes a match by working directory. Unresolved executable paths or
identities that change during observation reject admission. Raw process output
and normalized identity evidence stay linked in the private journal. Any process
using a configured executable identity still blocks admission. Identity-resolution
injection is fixture-only and cannot produce a nonfixture observation.

### Kernel process identity and executable paths

The observer uses `ps` only for PID inventory and display text. Every listed PID must have complete libproc identity before and after two kernel executable path reads. UID and parent PID must agree with the inventory; PID, real UID and microsecond start identity must remain unchanged. Both paths and resolved regular-file device/inode identity must agree. Kernel errors, permission failures, disappearing PIDs, malformed replies and unresolved paths remain unverified and refuse admission; no PATH lookup or process-name exemption is permitted. A same-Node device/inode match still blocks regardless of working directory, parent or displayed name. These checks are bounded observations, not atomic protection against a later exec or proof of pre-stop drainage. Injected kernel readers are fixture-only.

### Explicit local kinfo SPI compatibility

`OSObserver(kinfo_profile=<path-and-SHA-256 pin>)` may use the local profile only when full BSD identity returns exactly zero bytes and EPERM. The default remains disabled; no deployment plan is changed by adding this path. The profile identifies Darwin 25.5.0 arm64 little-endian LP64, 648-byte kinfo records, all six field offsets and scalar widths, SDK header digests, and the original layout-observation digest. Source URLs identify Apple kern.proc SPI, not a stable third-party public API. Native use revalidates platform, source bytes and layout-evidence consistency. Changed/missing SDK or evidence refuses compatibility rather than guessing.

Only a successful exact 648-byte, single-record reply is decoded. PID, parent PID, UID, real UID, seconds and microseconds must be valid and agree with short BSD identity. Existing before/after identity, inventory, kernel executable path and device/inode checks continue to apply. EPERM is the only fallback trigger; short replies, ESRCH, other errors, empty or multiple records and conflicts refuse admission. Zero microseconds are valid; missing microseconds are never synthesized. Same-Node matches remain blocking regardless of ownership. Every accepted local identity journals profile/source provenance, SPI classification and fixture provenance. Injected host or syscall providers are fixtures and cannot authorize a real nonfixture launch. No privilege change, signal, service startup, timer change, database access or MAH execution is part of compatibility.

### Formal session consumption of local SPI configuration

The parent request, disabled session template and pinned runtime must agree on the exact boolean `localKinfoCompatibility.enabled`, interface and role-specific profile. A missing optional configuration remains unconfigured/unverified and off; it must not inherit an enabled runtime policy. No environment variable, default filesystem search or caught error enables it. Candidate and controlled-baseline are selected by their bound controller path/digest and own release root; identical profile content does not permit cross-role paths. The profile must be uniquely registered in the own manifest and bind the same copied layout origin as the runtime.

Static validation happens before parent pipe/process creation and before session lease acquisition, then is repeated under the held lease. An enabled profile additionally validates the local host/SDK/source using the existing compatibility validator before observer creation; disabled mode never probes SDK or kernel through compatibility. Parent plan/template pins and session plan pins are reread before use. Parent-to-child live-plan copying preserves the complete configuration; it never flips compatibility on. The prepare-only entry uses the same resolver and observer creator and grants no cross-session launch permission.

The existing EPERM-only fallback, all before/after identity and executable checks, same-Node refusal and production-closed policy remain. Any pin/configuration/source conflict refuses before business launch; uncertainty after lease acquisition retains that lease. Static binding is not host verification, process absence, admission or proof of old-service drainage. Existing distributed templates remain disabled until a later explicitly authorized new plan.

### Process diagnostics v1 (not admission policy)

The separate proposed resource-scope contract is described in
[`landi-resource-scope-v2.md`](landi-resource-scope-v2.md). Its pure evaluator is
not connected to this admission path; current same-Node blocking remains intact.

The independent offline entry is `scripts/guarded-process-report.py --snapshot /absolute/evidence.json --sha256 <expected SHA-256>`. It accepts the version-1 supplied-evidence snapshot consumed by `diagnose_process_snapshot`; older OS collector summaries are not that schema and must remain unverified rather than being silently converted into trusted attestations. No default evidence path or automatic collection exists. Output goes to stdout; exit 0 means reporting succeeded, never deployment admission.

The reader checks bounded regular JSON input, final-symlink rejection, file identity/change detection, expected content digest, strict UTF-8 and duplicate-key rejection. It does not follow record/issuer references, authenticate their contents, inspect OS processes, open business databases, or invoke the admission controller. A digest binds supplied bytes; it does not establish their truth. Use only explicit diagnostic JSON, never database or configuration files as input.

The report separates `conflicts` (conflict evidence in the supplied snapshot, not independently verified current facts), `policyBlocks` (same-Node blocking remains), `insufficient`, `expired`, and `observations`. Its clock comes from the reporting process, not the snapshot's saved `nowMs`. Snapshots older than 15 seconds produce an expired item and no affirmative current classifications; expired resource evidence is also listed separately. Future/missing timestamps and unsupported schemas remain unverified. No output grants admission, exempts another project, proves pre-stop drainage, or enables production or local compatibility. The entry is offline only and is intentionally not added to the user interface or deployed artifacts.

`scripts/guarded-process-diagnostics.py` exposes a pure `diagnose_process_snapshot` function. It consumes caller-supplied version-1 evidence and performs no OS, filesystem, CLI, database, privilege, timer or process operations. It is not imported or called by the existing admission controller. Every result retains `admissionDecision: unchanged`, `mayExempt: false`, closed production/compatibility fields and historical unknowns. These are diagnostic output fields, not an action to change runtime settings.

The snapshot binds its target root, port, Node file identity, database/sidecar file identities and registered entry identities. Stable six-field process identity and executable identity are required. Resource replies must bind that instance, target digest and bounded observation time; complete, clean port and file queries are required for an "other project evidence consistent" diagnosis. Any positive target resource evidence takes precedence over an external-project receipt. Same-path/different-file and IPv6 port overlap remain uncertainty/conflict evidence. A same-Node device/inode match retains `still_blocked_same_Node` even when external-project evidence is consistent. CWD, parent, command title, UID and a different listening port alone do not establish external ownership or resource independence.

Launch and collector creation attestations must name an upstream verifier, issuer/record pins and the canonical payload digest. This module checks supplied structure and consensus only: it does not read those pinned files, authenticate the issuer or independently establish OS truth. Classification names explicitly describe evidence, not independently verified process ownership. A future trusted ingestion/verification boundary remains required before any policy use; no present diagnostic allows exemption.

Single ESRCH, defunct names, later absence and missing first identity do not prove exit. A changed microsecond instance identity reports PID reuse/conflict. An owned-collector exit diagnosis requires a separately registered, instance/executable/owner-bound creation attestation plus a matching wait receipt, pipe EOF and zero exit within the observation window. It describes only that collector's supplied lifecycle evidence; it does not prove process-wide absence, pre-stop drainage, external delivery or permit skipping an admission blocker. Current admission still refuses missing evidence and same-Node matches unchanged. No retry loop is introduced.
