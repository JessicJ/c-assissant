# MAH integration audit — 2026-10-26

## Follow-up: live Codex connectivity accepted

On 2026-10-26, a fictional request was submitted to a separate temporary MAH
standard project, using MAH's configured Codex Driver. Task
`d3673587-4957-40b6-9593-bfb3b6d84871` reached public `completed` status, with
`agent=codex`, `direct_runtime_model_id=gpt-5.6-sol` and lifecycle revision 6.
Its predeclared `artifacts/landi-business-result.json` was read through public
`task context`. The frozen request ID, scope, business timestamp, input digest,
unique fictional reply and byte count matched. Landi's existing conversation
parser and `MahBusinessPublicResultReader` both accepted the result; the latter
also checked stable completed lifecycle readback. Artifact SHA-256:
`ac0031b3c01841fc9be8cbb12de0a11c1badf5bedcecd6ed3eec512be6e99aca`.

The first submission was rejected before materialization because the temporary
directory was an ordinary Git repository, missing standard MAH project metadata.
Official `project import` initialized it with local temporary remotes. Public
readback then reported the test ID missing; the authorized continuation retained
the same UUID and fictional request. Its next submission was admitted and ran to
completion. Both submission receipts and the initial failure are retained.

This establishes the requested single-Agent connectivity criterion: MAH can call
Codex, complete work and expose a structured result Landi can read and validate.
It does not establish production workspace wiring, transactional result import,
read-only/external-action confinement, scheduling or service hosting. The test
allowed writes only in the isolated project for its artifact. Production gates
remain closed, the original Landi task was not resumed, and no traveler data,
original service or historical tests were used. The sections below describe the
earlier inspection and must not override this newer positive connectivity result.

Evidence manifest:
`/private/var/folders/bn/7fqcwf090yd5mhlsmk6rhb540000gn/T/landi-mah-codex-live-probe-r_ayycj4/acceptance.json`.

## Saved-conversation follow-up: final verification blocked

The new saved-message/application flow uses a separate fictional workspace and
journal. Task `ae165cb0-1997-4ea7-a3ac-7268f2c64282` ran Codex and produced a
767-byte canonical result. Its request/scope/time/input binding and existing
conversation parser checks passed; the candidate is preserved without applying
it. This is not a second completed-task acceptance claim.

Public replay identifies a later `Agent-final verification of Direct Task
governance and acceptance` call failing with `Selected model is at capacity`.
The valid nine-record signed audit includes `task.verification_unavailable`
with `agent_fallback_exhausted`. Scheduler readback remains `running` with
`terminalCommit.decision=absent`. Recovery preview is `not_applicable`, with no
confirmation. No signed successful Task run-final has been established, so the
documented `heal-from-audit` condition is not met. No healing, resume, replacement
submission or new Agent invocation was performed during this diagnosis.

The requirement and frozen identities remain in the isolated DBs, with no reply
applied and all production gates closed. The next dependency is MAH's supported
final-verification/settlement path for this existing prepared result. Evidence:
`/private/var/folders/bn/7fqcwf090yd5mhlsmk6rhb540000gn/T/landi-live-planning-flow-8xglaf9t/continuation-diagnosis.json`.

Scope: current working-tree source and the installed application's public CLI. Existing local changes are retained. No task was submitted/resumed/cancelled, no schedule registered, no service restarted and no business database opened. This is not a production cutover or Evolution delivery.

## Live public observations

- `/Applications/MAH.app/Contents/Resources/bin/mah --version`: `0.1.2029`.
- Public help, setup, task list/show, schedule list and project runtime list were read outside the tool sandbox. Inside the sandbox, help fails with `MAH Production release identity is not verified`; the same command succeeds outside it. That rejection is not evidence of a broken installed MAH.
- `setup status --format json`: Schema 1/setup_readiness, overall ready, Git ready, Codex ready/authenticated. Claude probe failed; this does not invalidate the successful Codex prerequisite observation.
- Project `task list`: exit 0, ok=true. The historical `project_git_owner_unresolvable` error did not recur in this read. This does not establish successful delivery or resolve historical Evolution errors.
- `task schedule list`: Schema 1, ok=true, matched canonical project root, count=0. Schedule submission/help exists, but no Landi schedules are registered.
- `task --help` advertises submit/show/context/cancel. It does not advertise execution-carriers. `project runtime --help` advertises project registration/resources, with no service start/stop/status/reconcile entry. These are help observations, not proof that no alternative public contract could ever exist.
- One publicly listed task was inspected with `task show`. The response has ok/task/project_care/delivery_recovery; task includes root_dir, planner_agent, model_by_agent and task_lifecycle_* fields. It did not have top-level task_record_materialized or task.agent. No private paths returned by the projection were opened. This sample is not a positive Scheduler admission/materialization or business-result test.
- `config driver show` is publicly available and returned a configured Driver. A Driver preference is not proof of the actual Agent/model used for a business task.

## Current Landi implementation inventory

| Area | Actual source | Remaining work / dependency |
|---|---|---|
| Production admission | `apps/server/src/production-readiness.ts` always returns blocked and all five capabilities false | Replace only after verified operation-specific public contracts and acceptance, not by flipping booleans |
| Planning conversation | `web-agent-routes.ts` saves message/revision, prepares AgentWork, marks blocked and returns without processing; `runtime-services.ts` conversation method throws | Implement actual submit/read/import/recovery for conversation and apply facts/proposal with current session revision checks |
| Blueprint generation | `mah-cli-transport.ts` and `mah-blueprint-runtime.ts` already implement substantial submit, artifact validation, cancellation and recovery logic | Pre-submit `assertMahMaterializationContract()` always throws; observer still invokes the absent execution-carriers command. Adapt to a verified current public replacement, not stale fields |
| Agent selection / transport binding | Existing generation path requires local selectedKind=codex, Codex prerequisite checks and task.agent=codex; command binding requires executable/main environment variables | Migrate to MAH-owned actual routing and a supported public command binding. Current direct public CLI works, but root wrapper rejects this terminal's missing Task binding. No production binding/config changed |
| Non-generation work | `agent-work-store.ts` has durable identities, result checks and transactional application; `mah-business-contract.ts` is explicitly an inert proposal | Wire the distinct work/envelope scopes, durable public receipts, operation-specific result validators/importers, cancellation and restart recovery. Storage alone is not an executor |
| Email research/timing | Runtime methods generateEmailResearch/generateEmailTiming throw; callers/template/outbox code exists | Implement MAH-backed operations with persisted identities and scoped results; preserve existing frozen messages and uncertain SMTP outcomes |
| Business scheduling | `server-lifecycle.ts` retains local departure/weather/venue intervals; email worker/scheduling code remains local | Implement registration/update/readback, version/recipient invalidation, overlap/expiry/DST/recovery and one-owner handoff before disabling old triggers. Current public registration semantics remain unverified |
| Service supervision | Landi launcher code and local lifecycle contracts exist; no verified MAH service adapter | Requires a public service ownership/start/stop/supervision/recovery contract; project registration cannot substitute |
| Final delivery | Working tree contains extensive previous implementation changes | Deliver exact owned changes through MAH, then committed-source package/readback and end-to-end acceptance. A local passing test or this audit does not close Evolution slices |

## Completed in this inspection

Added `scripts/inspect-mah-integration.mjs`, a bounded public-read-only CLI inspection. It records installed version, exact command-family help, host prerequisites and canonical project schedule count. It filters raw responses, does not export task text/account IDs or private paths, rejects wrong project/stale/unknown responses and distinguishes release-identity rejection from unavailable evidence. All output explicitly withholds production authorization. Help is descriptive only; absence of an advertised command never automatically enables a fallback.

Run from the component: `pnpm check:mah-integration`. It uses the Task CLI command binding when provided, otherwise the installed macOS public CLI. A constrained caller may need permission to read the installation outside its sandbox. Do not disable MAH release identity verification to make it pass. Exit 0 means the six diagnostic reads succeeded, not that production integration is ready.

`pnpm test:mah-inspection` verifies malformed/wrong-project/stale responses, help fallback, sanitized failures and the fixed read-command allowlist with fictional responses. Actual installed CLI inspection also passed all six reads on this date. No historical application suite or live Agent workload was run.

## Next implementation order

1. Obtain the current public materialization, actual execution-route and bounded artifact-only authority contracts. Test a separately bounded synthetic task once the required public evidence is available; no traveler data or real messages needed.
2. Adapt the existing generation transport, removing obsolete observer assumptions only when the replacement is demonstrated. Preserve original IDs, cancellation intent and transactional checkpoints.
3. Implement conversation and email executors over their own AgentWork records, not the generation carrier table. Add exact business importers and recovery.
4. Validate schedule semantics, implement reconciliation, then transfer one business scope at a time. Separately implement service supervision after its public contract exists.
5. Complete current end-to-end/runtime acceptance and formal delivery before opening production admission.

Current project governance explicitly restricts production Server/Scheduler/launcher changes while required public contracts are missing. This inspection therefore adds executable diagnostics and an updated inventory; it does not invent APIs or bypass those gates.
