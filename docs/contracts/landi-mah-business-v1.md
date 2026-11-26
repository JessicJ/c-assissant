# Landi business AI contract v1

## Planning conversation application

`mah-planning-conversation.ts` processes an already-saved message. It persists
the complete conversation/profile snapshot and business timestamp in immutable
AgentWork input, reuses Work/request/Task identities, and calls the MAH runtime
through `mah-planning-runtime.ts`. The factory binds the standalone journal to
the Work's preallocated Task UUID; cross-Work binding rejects. `findByScope`
reads existing identity without preparing changed input.

Results pass existing planning logic. The saved user message retains its ID and
timestamp, with exactly one assistant message appended. Application rechecks
active session, status and revision inside the transaction that sets the applied
marker. A newer message or replacement session blocks the old result. Failed
application rolls back the session, revision and marker; validated retry applies
without another runtime call. Applied retry returns the saved result and current
session without overwriting newer requirements. Legacy metadata-only blocked
Work is preserved and reports its missing snapshot rather than inventing input.

The existing chat route has an optional conversation service hook behind the
closed production gate. No startup factory provisions a production journal or
enables the service. The default route still saves requirements and returns its
existing blocked response. No workspace table/schema, UI, email, activation or
generation behavior changes. New tests use independent fixture databases.

## Submission and readback orchestration

`mah-business-gateway.ts` composes the runtime port with a caller-owned durable
submission journal, public CLI and result reader. It asserts the public execution
contract before any journal mutation or submit. The default assertion remains the
closed materialization gate; no live authority provider is supplied. The journal
must reserve one random Task UUID and persist the exact request/project before
submission. A durable `submission_unknown` intent is stored before calling MAH;
on any ambiguous/partial receipt, no resubmission occurs. A later explicit call
may only read that same Task. Prepared attachments are temporary and private.

Only canonical `task submit --no-write --personal-os-slot interactive` is used for
these bounded operations, with no Agent/model choice. Legacy explicit receipt
fields (ok, UUID, project, slot, workload and admission) must agree. The current
observed receipt omits ok/project: require title, exact Task-scoped audit/events
refs and result_ref=none, with the same UUID, slot, workload and admission checks.
Public Task readback must then establish canonical project ownership. A minimal
not-yet-materialized Scheduler projection only permits bounded waiting, never
result acceptance. This option is
project write protection, not by itself proof of artifact-only execution authority.
The separate authority provider must establish that before submit is enabled.
Completed result readback uses the fixed business artifact. An independent receipt
provider must correlate actual route, model, timestamps and request/artifact
binding. Missing provider evidence rejects. The gateway records `result_read`, not
domain validation or import; the runtime then applies its existing result/domain
checks. No production store, importer, route, background trigger or UI is wired.
Tests exercise orchestration with fictional public replies and isolated journals.

`mah-business-journal.ts` supplies an optional SQLite submission journal for this
port. Its schema is standalone: workspace migrations and service startup do not
install it. The caller must explicitly open and protect a separate journal DB;
the module opens no filesystem paths. It persists the canonical request, digest,
project and one Task UUID before submission. A committed compare-and-set changes
`prepared` to `submission_unknown`; independent handles cannot both claim it.
Outer transactions, unsafe synchronous/journal modes, changed request identities,
corrupt records and backwards state transitions reject. Restart recovery reuses
the original Task and never resubmits an uncertain attempt. `result_read` remains
readback only; it is not validation, import or execution authority. Targeted tests
use new private temporary databases and fictional CLI replies. No production
journal location, retention policy or workspace wiring is enabled by this module.

## Public result readback

`mah-business-public-result.ts` reads existing completed Tasks only through public
`task show/context` and the canonical CLI binding. The business result path is
fixed to `artifacts/landi-business-result.json`. Task/project identity, lifecycle
revision, unique declared size, exact UTF-8 bytes, digest and unchanged second
readback are checked. Absolute artifact paths, summary and final responses are
never opened or used. A candidate remains unverified: visibility does not prove
materialization, routing or execution authority. Acceptance additionally requires
the separate authenticated receipt and existing envelope/domain validators.
This reader alone persists no result, submits/resumes no Task and changes no
production gate.

`mah-business-public-receipt.ts` independently re-reads the fixed result, requires
the same completed lifecycle, binds canonical request bytes to one present Task
attachment with matching SHA-256/size, and checks actual Agent/model, selected
route and execution times. It opens no attachment or private runtime paths and
uses neither Agent provenance nor configuration preferences as execution proof.
It has positively validated the completed isolated Codex Task through real public
CLI readback and existing envelope/domain validators. This is a public projection
correlation witness, not a cryptographic audit signature or permission grant.
Production permission admission and startup wiring remain closed.

## Current migration implementation

The product target is Landi intake and travel review backed by MAH-selected Agents
and MAH-owned business scheduling. Old development-task delivery is not a prerequisite
for this migration. Preserve it as history; it is not the production execution task.

`apps/server/src/mah-business-runtime.ts` implements the three previously missing
bounded operations: planning conversation, email research and email timing. It
reuses existing Landi prompts, schemas and domain parsers over one injected MAH
gateway. Work identity, scope/version and business time must be provided from a
frozen caller context; the adapter generates neither replacement identities nor
tasks. MAH selects the Agent/model. There is no local Agent fallback, CLI process,
schedule, database importer, mail sending or UI change in this adapter.

The default gateway is absent and execution rejects. A future gateway must first
verify the operation's public execution/materialization/routing and artifact-only
authority contract, then return a separately authenticated receipt and raw business
artifact. Its assertion is a trusted integration port, not proof from a supplied
boolean or Agent output. Current production runtime wiring and gates stay blocked.
Local adapter checks establish preparation/result parsing, not live MAH execution.
The installed macOS public command is `/Applications/MAH.app/Contents/Resources/bin/mah`.
The generation transport resolves this public wrapper directly and no longer
requires private runtime executable/main variables for an ordinary installation.
Explicit absolute command overrides remain supported; a legacy executable/main
pair is preserved only when both are supplied, as an existing external launch
binding. Partial or relative bindings reject. This command binding does not prove
public materialization, route ownership or artifact-only execution authority and
does not open any production gate.
Cancellation is passed out of band and checked before and after execution; ambiguous
transport failures are propagated without retry. Exact envelope/result/receipt
validation precedes domain parsing; no result is applied to authoritative Storage.

This is a local, inert contract proposal implemented for validation. It is not a MAH public API, transport adapter, migration, or production capability claim. Both new schemas are envelopes; payload acceptance additionally requires the existing operation-specific domain validator. No request is submitted or persisted by this module.

MAH selects its configured Agent, model and route. Landi supplies the operation, input, required capabilities, language and bounded runtime. The only selection field is `selectionOwner: mah`; Agent/model preferences, arbitrary commands, write access and scheduling parameters are rejected in the execution envelope. `artifact_only` authorizes a business result, not source changes, mail delivery, activation or schedule creation. Input content remains untrusted business data. Public MAH enforcement of these limits is still required before any adapter can be enabled.

Generation requests bind generation/session/proposal/checkpoint versions. Stage-specific batch, skill lineage and repair context belong in the domain input and its SHA-256. Conversation requests bind session and requirements revision. Email requests bind plan/version, business date and recipient configuration revision, without storing recipient credentials in the envelope. Non-generation requests must not invent generation keys or reuse the generation carrier table.

The caller must freeze a UUID v4 request ID, scope, business timestamp and JSON input before submission. An ambiguous retry must reuse the entire request unchanged; `assertSameBusinessRetry` checks this and never retries. New confirmed business input requires a new identity. The optional standalone submission journal preserves this identity for explicit readback recovery. Production persistence, business-result application and recovery remain unwired until a public MAH contract is established; no existing workspace schema/table is changed.

Result acceptance checks exact envelope fields, request identity, scope/version, business time, input digest and output contract. Agent-produced artifacts cannot declare execution provenance. The backend public reader supplies the separate request/artifact/Task/Agent/model/time witness described above; an arbitrary object is not proof. Missing evidence blocks acceptance. The domain validator rejects incomplete/unsupported payloads. The conversation coordinator rechecks current scope/version before transactional application; validation alone never imports, activates or sends anything. Other operation importers and production startup wiring remain pending.

Legacy generation contracts, readers, local diagnostic interfaces and persisted data remain unchanged. Their Codex-specific routing is not migrated or used as fallback by this change. Production readiness and materialization gates remain closed. Real integration still requires public MAH routing/materialization, authoritative receipts, bounded artifact access, operation-specific persistence and recovery. Business scheduling is a separate migration.

Targeted acceptance: all eleven operations have scoped contracts; Agent/model overrides and broad authority are rejected; malformed JSON, missing capabilities, mutated retry identity and stale/cross-request results are rejected; receipts cannot come from artifact fields; payload validation is mandatory; generation gates and existing runtime blockers remain unchanged. New application tests use fictitious independent databases; public readback additionally reuses the completed isolated Codex Task without rerunning it.

### Browser save recovery closure

A requirements revision conflict invalidates the rejected message identity and triggers only a fresh version GET for the same session. The input remains editable; only a later explicit user action may submit it again. A failed version read keeps saving blocked.

On refresh, a fresh, session/message-bound status receipt may settle a pending browser record only when its expected revision and text match the persisted session message. Only that same text may be removed from the editable draft; newer or different drafts survive, including edits made while the status GET is pending. Missing, stale or crossed evidence does not clear anything. This local save acknowledgement never proves MAH execution or acceptance.

A verified saved-but-processing-unverified response uses the existing requirements notice once, without also raising the same global error. No layout, generation gate, automatic submission or recovery behavior is added.
