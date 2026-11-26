# Admission of the reviewed historical backup

This is admission to backup-only diagnostics, not workbench execution, schema
migration, database repair or a first-stop/cutover authorization. Production gates
and guarded-workbench schema validation remain unchanged.

## Exact identity and retained differences

The private admission record pins one existing backup path, complete file SHA-256
and original backup timestamp. It also pins the success receipt, unchanged prior
failure report, candidate and baseline reference manifests, and independent audit
JSON. Records live in the ignored private backup directory, never as user data in
the source tree. The source contains schema fingerprints, not private backup paths
or session content.

The only reviewed historical schema has SHA-256
`b9379f042cd62eb08b907687111a7d080e3cb6267fa36a7f9720b81d31267bc3`.
The fresh reference schema is
`3e45f2e0ba765f5ce2b3e9976b5d8b3410bf15e03fcdedbbf88574508aa68d6f`.
Both report version 27; the version number alone is never sufficient.

Retained differences are header quoting/whitespace in three tables; column order
in five tables; the historical `plans.configuration_json` default; and absent
CHECK constraints on carrier operation/status and stage presentation kind. No
constraint or column is added, removed, normalized or written back. Exact schema
hash validation also retains all column, foreign-key, index and SQL definitions.

## Loading and checks

`readonly-diagnostic-policy.ts` requires explicit database path, separate port,
admission JSON path/SHA and a credential of at least 32 characters. There is no
`.env` load or default database fallback. `readonly-planning-store.ts` requires
the admission path and digest even when called directly, so its old unchecked
construction path no longer exists.

Before opening SQLite, the loader checks the purpose, original-path exclusion,
canonical non-symlink backup file, absence of WAL/SHM/journal, full backup digest
and every referenced evidence digest. It then opens only that backup with
`readOnly`, sets `query_only`, and recomputes schema identity, integrity and the
aggregate historical-data audit. The audit must agree exactly with the pinned
record. File digests are checked during queries and on close. Any mismatch closes
or rejects admission; it never triggers repair or retry.

The data audit covers the missing CHECK predicates, revisions, Proposal and
confirmation versions, JSON representation, timestamps, foreign keys, research/
blueprint references, lineage versions and receipt revisions. Empty carrier and
receipt tables do not prove runtime compatibility; those coverage states remain
`unverified` even after admission succeeds.

## Request boundary and meaning

Both diagnostic GET routes require a loopback peer, Bearer credential and the
new diagnostic instance ID. Other operations are blocked. All successful payloads
carry backup SHA, backup creation timestamp, actual schema SHA, admission SHA,
`scope=backup_snapshot`, `liveSessionMatch=unverified` and `executable=false`.
An input version matching this snapshot does not establish a live-session match.
No UI, business write route, Agent, scheduler, email or MAH execution is enabled.

构造与监听分离。原手工备份验收归档于 `scripts/historical/readonly-schema-admission.test.ts.txt`，其明确准入输入和历史失败记录保留，不由当前安全套件执行。当前 `scripts/readonly-mechanism.test.mjs` 使用 `docs/guarded-workbench.md` 说明的共享合成 Schema 27 helper，指纹只在 VM 内替换。SQLite 构造仅允许夹具的精确路径及 `readOnly=true`，监听启动被截获；未修改的生产门禁必须拒绝同一夹具。这些检查证明隔离机制，不证明真实历史快照验收。
