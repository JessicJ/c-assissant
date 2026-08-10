# Core data model

## Aggregate

```text
Workspace
├── Profile
├── plans[]
│   └── Plan
│       ├── Stages[]
│       ├── Tasks[]
│       ├── Reminders[]
│       ├── Events[]
│       └── Runs[]
├── Confirmations[]
├── SourceSnapshots[]
└── current_plan_id
```

`plans[]` is a collection. Each `Plan` is one independent plan, such as attending an exhibition or beginning a study year.

## Profile

Profile stores information that remains useful across Plans:

- preferred language and presentation preferences;
- passport-issuing country or region;
- user-confirmed visa or residence status and validity;
- dietary restrictions and serious allergies;
- accessibility needs;
- provenance, confirmation state, confirmation time, and expiration.

Profile does not store passport images or numbers, banking documents, exact GPS history, trip dates, companions, accommodation, or provider credentials.

### Profile write rules

- An explicit user statement is treated as user confirmation and may be saved with a visible receipt.
- An AI inference remains pending until the user confirms it.
- Expiring facts become stale and must be updated before high-risk use.
- A Skill receives only the Profile fields declared in its contract.

The current implementation lets the user review and edit these basics in either Web or the bound Telegram private chat. Telegram `/profile` shows the saved values; text fields use an explicit 15-minute “next message” edit state, while gender and China visa/residence status use allowlisted buttons. Commands and location messages are never consumed as Profile values. The edit state stores only the selected field and start time, not unsaved input, and is cleared when Telegram is disconnected. Profile remains `incomplete` until both nationality and a known China status are recorded; this status is preparation metadata, not a policy eligibility conclusion.

### Context priority

```text
Current explicit user instruction
> current Plan configuration
> long-term Profile
> system default
```

A one-time Plan preference does not update Profile unless the user explicitly makes it a future default.

## Plan

A Plan is one continuous objective in one country and period. It may include multiple cities and dynamically generated Stages.

```text
Plan
├── inputs          User-provided facts for this Plan
├── assumptions     Visible, unconfirmed assumptions
├── decisions       User-selected options
├── stages          Structured execution phases
├── sources         Evidence used by this Plan
└── versions        Material versions of the complete Plan
```

AI regeneration may change derived Stages and Tasks, but it cannot silently overwrite user inputs or decisions.

### Creating a Plan

- A multi-step, continuing objective with time, place, and purpose creates a Plan.
- An immediate request such as “find food near me” creates a Run, not a new Plan.
- Immediate work may be associated with the current Plan without changing it.
- Confirmed new information such as booked accommodation updates the current Plan and recalculates affected work.

### Plan states

Plan lifecycle, reminder activation, and conversation focus are independent:

```text
Plan: open | completed | cancelled | archived
Reminders: off | on | paused
Conversation focus: current_plan_id
```

The Plan is generated and displayed immediately. Confirmation activates the complete Plan version and its declared automation scope.

## Stage

A Stage groups related Tasks inside a Plan. Stages are generated according to purpose and are not limited to travel phases.

Examples include pre-departure preparation, arrival, exhibition attendance, school registration, residence setup, or return.

V1 supports one Stage level. Stages do not recursively contain more Stages or Plans.

## Task

A Task is an executable or trackable unit, not just checklist text.

### Ownership

```text
assistant   Landi can complete it
user        the user must complete it
external    a third-party service or real-world action completes it
```

Core must not mark a user or external Task completed merely because guidance or an external link was delivered.

### Triggers

```text
time         a scheduled time is reached
event        an Event occurs
dependency   another Task reaches the required state
```

### States

```text
scheduled
ready
running
waiting_user
blocked
completed
skipped
failed
cancelled
```

Temporary provider failures are retried before the user is interrupted. Obsolete Tasks from an updated Plan are skipped and cannot send stale Reminders.

## Reminder

A Reminder stores why and when to trigger work, not a permanently frozen message body.

When due, it creates a Run that reads the latest confirmed Plan, refreshes required facts, generates current content, and delivers through the appropriate channel.

Reminder times use the Event location's local timezone. Plan updates recalculate affected Reminders and cancel obsolete ones.

Current implementation supports a first Task-level reminder with a concrete local wall-clock time, IANA time zone, purpose, and explicit delivery-time fact policy. Codex or Claude Code may include it only when the request contains enough dated facts; it must set `refreshFacts` to `["weather"]` only when destination weather can materially change the immediate Task, and to `[]` otherwise. Older persisted reminders without the field are treated as requesting no dynamic facts. The policy is persisted with the Plan and disclosed in Web and Telegram previews. The reminder remains inert while the Plan is a draft. After Plan activation, a paired Telegram account receives a delivery attempt when the reminder is due or within a 30-minute restart catch-up window. Retryable failures wait one minute and then five minutes, with no more than three total attempts; non-retryable or exhausted delivery is recorded in Web Inbox alongside successful delivery. The user can remove a Task reminder from the current Plan; this creates a new Plan version and an Inbox receipt. Immediately before claiming each attempt, storage verifies that the Plan is still current and active and that the Task still contains the exact reminder, including its dynamic-fact policy. A cancelled, changed, or superseded reminder therefore cannot begin a stale attempt. Only reminders declaring weather resolve the Plan destination through Amap and refresh QWeather. They append an exact-date forecast only when one matches the reminder's local date; otherwise current conditions are clearly labelled as an observation rather than a forecast. Provider failure never blocks the original reminder. Weather context includes retrieval time and attribution but is not retained in Profile or Plan. The delivery copy reads the current Task and purpose instead of freezing draft text. Local state prevents retries after a recorded terminal result, but a crash after Telegram accepts a message and before SQLite records success can still produce a duplicate. Stronger cross-system idempotency and additional fact policies remain future work.

## Event

An Event records what is expected or what actually occurred.

Sources include:

- planned times and milestones;
- user text, location sharing, and button actions;
- provider facts such as weather or source changes;
- system events such as a Reminder becoming due.

An expected arrival Event may prepare and send a route card. It does not prove that the user has landed. Receiving location or explicit confirmation can mark actual occurrence.

## Run

A Run is one actual system execution. It records:

- triggering Task, Reminder, or Event;
- Skill and version;
- minimized context fields used;
- Connector calls and evidence references;
- validated result and delivery status;
- timing, retry, cancellation, and failure state.

The Web shows user-friendly results and source evidence, not raw Agent logs. Technical details remain available through local diagnostics.

Current implementation has two minimized Run forms. A Plan generation Run stores only the runtime kind, Web or Telegram trigger, start/finish time, outcome (`succeeded`, `failed`, or `fallback`), an Agent-generated Plan id on success, and a short failure classification when needed. A Task Reminder Run spans all delivery retries for one Plan/Task/Reminder key and stores the due/start/update/finish times, attempt count, weather status and failed stage/code when unavailable, Telegram failure code, and final state (`retry_wait`, `succeeded`, `failed`, or `cancelled`). Cancelling the reminder or replacing the current Plan terminates unfinished Reminder Runs; a Telegram success already in flight can still replace `cancelled` with the actual `succeeded` outcome. User requests, reminder message copy, raw weather or model output, coordinates, error text, account state, and credentials are intentionally not retained. Skill versions, richer Event linkage, evidence linkage, and retention controls remain future work.

The first Core Plan compiler accepts a country-neutral, exact-version proposal and returns a new draft Plan version without activation. Generated Stages and Tasks carry origin metadata for Country Pack ID/version, composition Skill ID/version, source Plan version, supporting Skill versions, and the exact immutable source-snapshot ID/hash pairs they actually used. Reminder instants are rejected when stale or malformed and converted to the existing local wall-clock plus IANA time-zone representation. SQLite persists Task descriptions and Stage/Task origins and applies the next draft version only through an atomic ID/version/status comparison; a concurrent edit or confirmation leaves the compiled result unapplied. A minimized `plan_compilation` Run and each supporting Skill Run retain their evidence ID/hash pairs without proposal text, source excerpts, or raw Skill output. Evidence that does not match a stored immutable snapshot makes the whole atomic write fail closed.

## Confirmation

A Confirmation records the exact object, version, scope, channel, and time approved by the user. It may be revoked.

A Confirmation for Plan V3 cannot authorize a materially different Plan V4. Real-time adjustments inside the already approved scope do not require a new confirmation.

Web and the bound Telegram private chat can both create this Confirmation. Telegram callback data includes the reviewed Plan id and version, and Core accepts it only while that exact version remains the current draft. Long mobile Plans are paginated in full, with the confirmation control attached only to the last page.

## SourceSnapshot

A SourceSnapshot stores the minimum evidence needed to verify a conclusion or detect a later change:

- source provider or official institution;
- original URL;
- retrieval and publication/update time;
- jurisdiction and applicability metadata;
- relevant excerpt or normalized factual fields;
- content fingerprint;
- linked Plans, Tasks, and Runs.

It is not an unrestricted archive of entire websites or raw location histories.

Current implementation persists allowlisted official-source snapshots in local SQLite with the source id, authority, original title, HTTPS canonical URL, retrieval time, SHA-256 content fingerprint, and a bounded excerpt. Equal source/url/hash records are deduplicated; a later differing hash reports a content change but does not itself claim that a policy changed or applies to the user. A saved snapshot linked to the current Plan preserves its ID and content fingerprint as well as the title, authority, original URL, and retrieval time. Country Pack compilation additionally links the exact ID/hash pair to each dependent Task, the compilation Run, and the corresponding Skill Run. These links preserve historical provenance after a newer snapshot appears; they do not turn evidence preparation into a policy conclusion.
