# Isolated read-only API startup

Source implementation only; the existing service and its compiled artifacts are not replaced.

The sole Server entry point selects `LANDI_SERVER_MODE` before importing the normal startup module. Missing mode or `standard` retains normal startup. `readonly-diagnostics` selects diagnostics; any other value fails without starting a service.

Diagnostic mode requires both `LANDI_DIAGNOSTIC_DATABASE_PATH` (an explicit absolute path to an existing consistent standalone SQLite snapshot) and `LANDI_DIAGNOSTIC_PORT` (1024–65535, excluding the reserved original port 8787). It does not read `.env`, default business database paths, SMTP credentials or normal Server host/port settings. It binds only to 127.0.0.1. A port conflict fails without stopping another process.

Only GET `/api/agent-readiness` and GET `/api/planning-sessions/:sessionId/return-check` are mounted. No workspace UI or mutation routes are mounted, and automatic HEAD routes are disabled. This is a diagnostic branch, not a replacement workbench or a second persistent service/launcher.

The Storage subpath `@c-assistant/storage/readonly-planning-store` opens SQLite with `readOnly: true` and connection-local `query_only=ON`, and exposes only snapshot readback and close. It does not load the normal Storage constructor, migrate, seed or backfill revisions. Missing files are not created. WAL/SHM companions are rejected: a live database must not be used or copied piecemeal; preparing any real snapshot requires a separately authorized SQLite-consistent backup.

Readiness is offline and unverified; no MAH CLI reader is called. All production gates remain false. No Runtime, recovery, monitoring, periodic business timers or email worker is created. Closing diagnostics closes only its own Fastify instance and read-only connection, without aborting or resuming original work.

Before any future deployment, stage Storage and Server together (including the new subpath) outside the running lib directories. Do not compile over the active service, alter its LaunchAgent or restart it as part of diagnostic validation. Validate with newly created fictional snapshots and Fastify injection; loading normal startup is outside that validation scope.
