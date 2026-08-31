# Landi Core Data Model

## Model purpose

The data model preserves one travel objective across planning conversations, Plan versions, service restarts, notifications, real-world changes, and in-trip execution.

The model separates:

- stable traveler information from trip-specific facts;
- planning state from an executable Plan;
- active execution from a replacement draft under review;
- verified provider facts from Agent suggestions;
- reversible preparation from irreversible external actions.

## Aggregate

```text
Traveler Workspace
 ├─ Profile
 ├─ Runtime selection
 ├─ Planning Session
 ├─ Current Plan
 ├─ Execution Plan
 ├─ Historical Plans
 ├─ Inbox
 ├─ Source Snapshots
 └─ Run records

Plan
 ├─ Configuration
 ├─ Presentation
 ├─ Stages
 │   └─ Tasks
 │       └─ Reminder proposal
 ├─ Sources
 ├─ Replacement audit
 └─ Destination arrival events
```

The Roadmap extends the aggregate with persistent Travel Events, Monitoring Jobs, and Travel Attention.

## Profile

Profile stores stable information that the traveler explicitly confirms for reuse.

Current examples:

- preferred name;
- preferred language;
- nationality;
- basic personal settings;
- confirmed status fields required by a regional preparation flow.

Profile does not store temporary trip details such as travel dates, lodging, party size, luggage, or one-time transportation preferences.

### Context priority

When Landi resolves a fact, use this order:

1. explicit information in the current interaction;
2. confirmed Plan-specific information;
3. confirmed Profile information;
4. verified Connector facts;
5. explicit assumptions shown to the traveler.

An assumption never silently becomes a confirmed fact.

## Planning Session

A Planning Session represents the work before a complete Plan exists.

It stores:

- status;
- objective type;
- recent conversation messages;
- structured planning facts with provenance;
- unresolved and deferred questions;
- the latest Planning Proposal;
- the approved proposal version;
- the output Plan ID after generation.

Typical states:

```text
collecting
  -> proposal_ready
  -> proposal_confirmed
  -> generating
  -> draft_ready
```

A failed generation may return the session to a recoverable state. Repeating an already completed generation request must not create another Plan.

## Planning Proposal

A Planning Proposal is a versioned direction checkpoint, not an executable Plan.

It contains:

- title and objective;
- planning theme;
- major segments;
- provisional skeleton;
- tradeoffs;
- assumptions;
- unresolved decision points.

Only the latest proposal version can be approved. A material planning-fact change after approval requires another proposal version and another approval.

## Plan

A Plan is the authoritative structured representation of one travel objective.

Current fields include:

- ID and version;
- title, destination, and dates;
- status;
- known information and assumptions;
- next action;
- Plan-scoped configuration;
- Stages and Tasks;
- optional itinerary or timeline Presentation;
- source references;
- creation time.

### Current status model

```text
draft
active
completed
cancelled
```

The Roadmap adds explicit paused and archived lifecycle behavior. Those states must not be treated as implemented until Core and Storage support them.

### Current and execution pointers

The workspace distinguishes:

- **current Plan** — the draft or active Plan shown for review and editing;
- **execution Plan** — an older active Plan that continues real-world Reminders while a replacement draft is under review.

Approving the replacement atomically moves execution to the new Plan and archives the old version into history.

## Plan configuration

Plan configuration stores trip-specific facts that should not enter Profile:

- lodging status and selected property;
- expected arrival time and time zone;
- transportation preference;
- party size;
- luggage level.

Lodging has explicit `not_set`, `candidate`, and `confirmed` states. A discovered property or external link never becomes confirmed lodging without traveler action.

## Plan presentation

Presentation describes how travel content is explored. It supplements executable Stages and Tasks rather than replacing them.

Current presentation kinds:

- `itinerary` for spatial, day-based travel;
- `timeline` for non-spatial or long-horizon Plans.

An itinerary Presentation contains:

- date range and destination cities;
- itinerary days;
- Places;
- route segments.

### Itinerary day

An itinerary day may contain:

- date and city;
- traveler-facing title and summary;
- ordered scheduled Places;
- same-day candidates;
- capacity and fixed anchors;
- accommodation-to-first-stop route;
- reviewed route geometry and rationale.

Candidates must remain distinct from scheduled stops.

### Place

A Place has a stable ID and may contain:

- primary and localized names;
- location label and normalized coordinates;
- city, area, and category;
- priority and visit role;
- visit duration and traveler-facing rationale;
- reservation state;
- map, official, booking, or experience handoffs;
- source references.

Coordinates and factual claims require appropriate evidence.

### Route segment

A route segment connects two Plan Places.

It records:

- origin and destination Place IDs;
- movement mode;
- day association;
- duration and distance when available;
- verification state;
- observation time;
- source references.

Verification states:

```text
needs_verification
verified
stale
```

Stop coordinates alone may support a sequence guide but do not prove a real road or transit route.

## Stage

A Stage groups related Tasks inside a Plan.

Examples include:

- trip overview;
- itinerary;
- reservations;
- transportation;
- preparation;
- budget or details.

Each Stage has an explicit presentation kind. Rendering must not infer semantics from translated or user-generated titles.

## Task

A Task is a trackable unit of travel work.

### Ownership

```text
assistant   Landi can prepare or complete the work
user        the traveler must complete the work
external    an external service or real-world event completes it
```

Landi cannot mark a user or external Task complete merely because it supplied instructions or opened a link.

### Current states

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

Tasks may include explicit preparation categories, arrival activation, source provenance, and an optional Reminder proposal.

## Reminder

A Reminder stores why and when Landi should prompt the traveler. It does not freeze the final message body at Plan-generation time.

Current Reminder data includes:

- local wall-clock time;
- IANA time zone;
- purpose;
- explicitly approved dynamic facts to refresh.

A Reminder remains inactive while its Plan is a draft. Delivery must recheck the current execution Plan and exact Reminder definition before sending.

The current dynamic fact policy supports weather where weather can materially change the immediate Task. Other facts require explicit future contracts.

## Destination arrival event

The current implementation stores explicit city-arrival events for an itinerary Plan.

These events help determine the current destination without continuous GPS. They supplement date-based inference and never fabricate an arrival from opening a map or route handoff.

## Planned Travel Event

The Roadmap generalizes the existing arrival record into a Travel Event model.

Planned event categories include:

- arrival and departure confirmation;
- traveler delay or deviation;
- Task completion;
- Reminder due;
- provider fact change;
- system lifecycle transition.

Each Travel Event must bind to a Plan and Plan version, record its source, and retain only the minimum payload required for later behavior and audit.

## Planned Monitoring Job

A Monitoring Job represents durable future checking work for an active Plan.

It should record:

- Plan ID and version;
- monitoring type;
- affected Place, route, Task, date, or source scope;
- time zone and next run time;
- state, retry, and lease information;
- latest normalized result key;
- cancellation or completion state.

Monitoring Jobs survive service restarts and stop when their Plan version is no longer executable.

## Planned Travel Attention

A Travel Attention records a meaningful change that may require traveler action or Plan adjustment.

It should contain:

- Plan ID and version;
- attention type and severity;
- affected dates, Places, routes, Tasks, or decisions;
- evidence references and observation time;
- summary and suggested next action;
- deduplication key and expiration.

A Travel Attention does not directly modify the Plan. It feeds the impact and replacement flow.

## Plan change and impact

Direct structured edits create versioned Plan changes. The current low-impact change model includes Task ordering and itinerary workspace edits.

Natural-language or high-impact changes first produce an impact preview containing:

- affected areas;
- reasons;
- whether confirmation is required;
- whether the result creates a replacement draft.

Affected areas may include dates, destination, lodging, fixed commitments, party constraints, Reminders, and itinerary structure.

## Replacement audit

A replacement audit links one source Plan version to one replacement Plan version.

It records:

- source and replacement references;
- affected areas;
- facts requiring revalidation;
- completed Tasks preserved in the replacement;
- creation time.

Future Attention-driven replanning should also record the Travel Attention that triggered the replacement.

## Confirmation

A Confirmation authorizes one exact object, version, scope, channel, and time.

A Confirmation for Plan V3 cannot activate Plan V4. Telegram controls and Web review must use the same version rule.

## Source snapshot

A SourceSnapshot stores the minimum immutable evidence needed to support a Plan item or detect a later source change.

It includes:

- source identity and authority;
- canonical URL;
- retrieval time;
- content fingerprint;
- bounded excerpt or normalized factual fields;
- links to Plans, Tasks, and Runs.

A newer source snapshot does not rewrite the evidence used by an older Plan version.

## Run

A Run records one actual system execution without retaining unnecessary private content.

Current Run categories include:

- Plan generation;
- Task Reminder delivery;
- Country Pack compilation;
- individual Country Pack Skills.

Runs store sanitized status, timing, version, retry, evidence, and failure classifications. They do not store credentials, raw account state, exact location history, or unrestricted model transcripts.

Future scheduling work should add Monitoring Job runs using the same minimized-audit principle.

## Inbox item

Inbox records user-visible notices, attention, completion receipts, and delivery results.

The target Travel Attention model should remain separate from presentation. One Attention may create an Inbox entry and a Telegram message, but the underlying Attention remains the structured source of truth.

## Version and concurrency rules

- Every material Plan change creates a new version.
- Storage applies changes only when the expected Plan ID, version, and status still match.
- Agent results become invalid if the Plan changes during the run.
- Old Reminders and monitoring work cannot begin after their Plan version becomes obsolete.
- Replacement drafts do not interrupt the current execution Plan before approval.
- Provider facts update only the affected structured fields and retain observation time and evidence.
