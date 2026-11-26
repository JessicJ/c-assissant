# Controlled workbench startup and rollback

This is a protected startup path, not a service switch or MAH recovery command.
Normal `standard` and isolated `readonly-diagnostics` startup remain separate.
Production readiness remains false; MAH selects the Agent once its public execution contracts are verified.

## Explicit admission

Select `LANDI_SERVER_MODE=guarded-workbench` before loading any `.env`.
All of these inputs are mandatory; there are no normal database/port fallbacks:

- `LANDI_GUARDED_APP_ROOT`: canonical existing release root.
- `LANDI_GUARDED_DATABASE_PATH`: canonical existing compatible database file.
- `LANDI_GUARDED_ENV_PATH`: canonical existing configuration file.
- `LANDI_GUARDED_PORT`: explicit port 1024–65535, on 127.0.0.1.
- `LANDI_GUARDED_MANIFEST_PATH` and `LANDI_GUARDED_MANIFEST_SHA256`: pinned release manifest and its SHA-256.
- `LANDI_GUARDED_CUTOVER_EVIDENCE_PATH`: fresh, independently established cutover evidence.

The configuration file is fingerprinted but **not loaded** in this mode. Legacy
flags and configuration content cannot turn background operations on. Settings
reads therefore reflect the launch environment; configuration writes are blocked.

Manifest version 1 contains `mode: guarded-workbench`, `projectRoot`,
`databasePath`, `envPath`, `envSha256`, `origin: http://127.0.0.1:<port>`,
`schemaSha256`, and `files: [{path, sha256}]`. File paths are release-relative;
outside paths, symlinks in compiled trees, duplicates and missing digests fail.
All compiled files under `apps/server/lib`, `apps/web/dist` and each
`packages/*/lib` must be listed. Server entry, storage entry, web index and
`pnpm-lock.yaml` are mandatory. Actual startup also checks its entry path belongs
to that release. The dependency fingerprint pins the lockfile, not an independent
attestation of installed third-party dependencies. Their installation must be
verified in the release preparation step; this startup does not install anything.

## Database and execution protections

`SqliteWorkspaceStore` 接收受保护的 Schema 指纹。打开前要求数据库已存在且没有 WAL、SHM 或 journal 伴随文件，并核对精确指纹及必要表。当前 drained-cutover 准入要求 Schema 30；经过明确审阅的 historical/post-stop 准入要求 Schema 27。当前分支由 `packages/storage/src/guarded-schema.ts` 校验回执表精确结构及完整迁移集合。它不执行迁移、种子写入、载体列补充、旧载体 sidecar 导入／删除或规划修订回填；结构缺失或不兼容时直接拒绝，不尝试修复。预期指纹必须来自已审阅的兼容发布 Schema，不能直接信任生产数据库当前结构。

There is no interrupted-generation recovery, MAH recovery, scheduler creation,
immediate monitoring, Agent adapter construction, generation supervision, CLI
snapshot query, SMTP action or automatic retry. MAH connection evidence defaults
to unverified. Both diagnostic GETs retain their existing no-store contract.

Requests use a reviewed route-template allowlist. Local workspace/history/settings
reads and explicit `POST /api/agent/chat` with `mode: new_plan` are permitted.
That POST keeps the existing identity/revision/idempotency save path and blocked
Agent-work receipt; it does not generate. Other mutations, external lookups,
streaming generation events and new unreviewed routes return 503 before their
handlers. This temporary restriction changes neither normal-mode activation
rules nor the frontend design. A user saving requirements may write the database;
startup, read-only inspection and shutdown do not.

Closing drains Fastify requests and closes only its own store. It does not cancel
jobs, restore a database, signal another process, or manipulate a service manager.
Bind or route-registration failure closes owned resources only.

## Cutover and rollback evidence

`guarded-cutover-contract.ts` specifies the typed envelope and validates:

- Candidate and rollback are both guarded releases, with artifact/dependency,
  schema and browser-storage-key digests. Origin, database path, configuration
  path, schema and storage-key identity must match across releases.
- Evidence is at most 60 seconds old and not future-dated. Process PID, start
  time and known manager are present; manager pause and stop are established.
- Writes are drained, with zero active generations, pending deliveries and
  uncertain operations. Backup identity, consistency and digest are verified.
- `restoreDatabase` and `automaticResume` are explicitly false.

Startup binds the candidate to its manifest digest, lockfile digest, schema,
origin and configuration/database paths. These checks validate supplied evidence
consistency; they cannot prove a caller's assertions. The result remains
`consistent_unverified` and `executable: false` even when internally consistent.
Do not invent evidence to satisfy admission.

Actual cutover still requires separately establishing ownership, manager pause,
quiescence and a consistent backup. No pause/drain/stop or switch is implemented
by this change. In particular, the existing KeepAlive-managed instance must not
be killed as a substitute for verified manager control.

Rollback uses a matched guarded frontend/server/storage release, the same browser
origin and storage keys, and fresh admission evidence with the rollback release
as candidate. **Preserve the current database**, including requirements saved
since the upgrade. Never automatically restore an older backup or restart the
unprotected standard instance. Unknown compatibility or in-flight operations
means remain stopped/maintenance until resolved, without resume, retries or a
restart loop. A running process changing the database after evidence collection
invalidates the evidence; the deployment controller must enforce exclusive access.

## Targeted verification

Run `pnpm test:guarded-contracts` (or `python3 scripts/test-guarded-contracts.py`)
after the normal workspace build, with Node 24+ and Python 3.9+ on PATH. The entry
runs every current `scripts/guarded-*.test.py`, the guarded Node tests,
`post-stop-admission.test.mjs`, and `readonly-mechanism.test.mjs`. Each invocation
creates a fresh temporary root and prints its `summary.json` path. The summary
contains only checks actually run in that invocation; no previous pass counts
are reused and no fixed runtime installation or old temporary receipt is needed.

The suite covers schema refusal, zero-write reads, revision persistence, guarded
request injection, disabled external work, continuous leases, pipe/owner binding,
terminal failures, and explicit save followed by fresh rollback admission. OS,
service-manager, kernel identity and endpoint replies are simulated. The owned
child test creates its own empty fictional SQLite file and finite Node children;
it never signals an unrelated process or starts a service. No existing database,
private MAH data, current process inventory, or private IPC evidence is read.

Readonly/post-stop 成功用例标记为 `fixture_mechanism`。共享 helper 创建虚构业务记录，明确删除 Schema 28–30 新表、Schema 29 新列及高于27的迁移记录，再仅在该夹具中移除三条 CHECK；同时断言1–27迁移集合完整、Schema 26字段及索引／触发器保留、后续结构不存在且数据库完整。只有 VM 内替换唯一的已审阅历史指纹，才能让原检查／准入机制检验该夹具；独立且未修改的生产模块必须拒绝同一合成结构。生产常量、Schema 准入和审计检查均不变。这些结果不验证真实历史 Schema、真实停止／保全回执、原生内核支持或部署就绪。controller-session 成功测试使用小型合成文件系统 loader；独立 post-stop 套件则以实际 Storage loader 检验其合成证据链。

Original one-off scripts are preserved verbatim as non-executable `.txt` documents
under `scripts/manual/guarded-history/`. They are not selected by the safe test
entry, and their old local paths and counts are historical context only. Actual
services and historical snapshots are not used for this verification.

## Offline metadata preflight

`scripts/guarded-preflight.mjs` is a reporting tool only. It never supplies
`GuardedCutoverEvidence` to startup and never turns an observation into permission
to switch. Its report always has `status: unverified`, `executable: false` and
`databaseAction: preserve`. No startup or production gates are changed.

Explicit arguments are `--app-root`, `--plist`, `--label`, `--uid`, `--port`,
`--node-path`; optional `--manifest` requires `--manifest-sha256` alongside it.
Paths have no ambient environment or production defaults. Importing the module
has no side effects. Invoking it uses only bounded read-only queries:
`plutil -convert json -o -`, `launchctl print`, `ps`, and `lsof` for the supplied
service/port. There is no shell execution, service-manager mutation, HTTP request,
SQLite import, runtime module import, configuration loading or directory write.

The report retains only selected facts, digests, source IDs, timestamps and
sanitized reason codes. It discards raw command output, process arguments,
configuration/environment values, database paths and exceptions. Plist fields
are inspected transiently; only the intended executable/entry/working directory,
label, KeepAlive and RunAtLoad participate in the metadata comparison. Process
start time is a local observation, not proof that all work has drained.

Declared release artifacts may be hashed only under the explicit release root,
in `apps/server/lib`, `apps/web/dist`, `packages/<name>/lib`, plus
`pnpm-lock.yaml`. Symlinks, outside paths, sensitive/non-artifact paths and
oversized files are refused. This check covers declared files only; complete
release inventory and installed-dependency attestation remain unverified.
Neither `.env`, databases/backups, private MAH records nor logs are opened.

Per-item statuses are `observed`, `consistent_unverified`, or `unverified`.
Missing, malformed, stale (over 60 seconds), future-dated or conflicting evidence
is unverified; counts are `null`, never assumed zero. Process/port/service identity
must agree, with a second launchd/PID observation bounding the query interval.
For `lsof -Fpn`, numeric file-descriptor records such as `f13` are accepted
only after a valid process record; they do not establish a listener or its owner.
Unknown/malformed records, conflicting owners, multiple listeners and non-loopback
addresses remain unverified.
Even consistent metadata does not prove exclusive ownership or a paused manager.
Manager pause, verified stop, drained writes, generation/delivery/uncertain counts,
configuration binding, database compatibility and backup consistency are always
unverified in this tool. Pending work is never cancelled or retried to satisfy it.

Exit 0 means a report was produced, **not** readiness. Invalid invocation exits 2
with a sanitized error. Output is JSON on stdout only; callers must keep any
machine-specific report outside Git and release archives. No real-instance run
is part of this change. New checks in `scripts/guarded-preflight.test.mjs` use
fictional query responses and temporary release files only, without a database.
