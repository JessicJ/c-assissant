# Regional Capability Design: China V1

## Purpose

The China Country Pack is Landi’s first regional capability implementation. It contributes local preparation, source-backed guidance, and normalized proposals to a generic Landi Plan without changing the Plan lifecycle.

The Pack is distributed as one unit. Its internal Skills are implementation modules and are not installed or operated independently by the traveler.

## Product scope

The first version supports travelers preparing to arrive in and navigate daily life in China.

Initial capability areas:

- official entry-information preparation;
- arrival checklist and timing;
- connectivity and essential digital setup;
- lodging-area guidance;
- local transportation planning;
- destination food orientation and nearby discovery;
- weather and packing guidance.

Future regional work may add banking, healthcare, education, business, legal, and extended-stay capabilities. Those areas require their own evidence and product review before entering the Pack.

## Host and Pack responsibilities

### Landi Core and Server

- capture the exact Profile and draft Plan version;
- collect normalized Connector facts;
- refresh approved official sources;
- invoke the Country Pack workflow;
- validate the country-neutral proposal;
- persist the next draft Plan version atomically;
- present the complete result for traveler review;
- activate Tasks and Reminders only after Plan approval.

### China Country Pack

- register and order regional Skills;
- define approved regional sources and reference catalogs;
- transform normalized facts into source-bound recommendations and preparation items;
- compose Skill results into one versioned proposal;
- preserve assumptions, warnings, limitations, Skill versions, and evidence references.

The Pack cannot access credentials, write directly to SQLite, deliver messages, activate a Plan, or perform external transactions.

## Workflow

```text
Exact draft Plan and relevant Profile facts
  -> Approved official-source preparation
  -> Normalized place, route, weather, and reference facts
  -> Supporting Skills in fixed order
  -> Arrival preparation assembly
  -> Composite China proposal
  -> Country-neutral Core proposal
  -> Core validation
  -> Atomic draft Plan persistence
  -> Traveler review and activation
```

A critical missing input or invalid evidence blocks compilation. Optional provider limitations degrade only the affected capability and must not be replaced with invented facts.

## Internal Skills

### `policy-applicability`

Prepares evidence for a separate review of entry and status requirements.

Inputs are limited to relevant traveler status, Plan destination and dates, and approved source metadata. A successful result means the evidence is ready for review; it does not itself determine eligibility, entry permission, visa validity, or another regulated outcome.

### `weather-and-packing`

Turns normalized weather observations and supported forecasts into conservative packing or immediate travel guidance.

An exact-date forecast is required before presenting future conditions as a forecast. Unsupported coverage or provider failure degrades the weather result without blocking the rest of the Plan.

### `housing-area-recommendation`

Uses normalized place and route facts to compare lodging areas or connect a traveler-confirmed property to the Plan.

It does not infer live price, availability, booking status, property quality, or traveler eligibility. A nearby-place distance is not presented as a verified commute.

### `transport-planner`

Recommends a transportation mode using the Plan preference, party size, luggage, route facts, accessibility context, and relevant weather.

It may produce an external route or ride handoff. It never starts navigation, books transportation, confirms a ride, pays, or marks a Task complete.

### `local-food-guide`

Adds destination food orientation from approved, source-backed regional facts.

It preserves localized names and traveler-facing explanations. It does not schedule a specific restaurant, claim availability, or create an order or reservation action.

### `food-nearby`

Transforms current nearby-place facts into a small set of options and map handoffs when the traveler asks during the trip.

It preserves provider facts and known traveler context without inventing rankings, wait times, tables, menu availability, or transaction completion.

### `digital-life-setup`

Explains the local connectivity, communication, navigation, and payment setup relevant to the active Plan.

It uses approved source-backed material, omits items the traveler has explicitly completed, and never handles passwords, verification codes, payment credentials, or account sessions.

### `arrival-preparation`

Combines preparation items produced by the supporting Skills into a deduplicated checklist.

It proposes Tasks only for incomplete items. A Reminder is proposed only when an explicit travel time and valid time zone support it. All Tasks and Reminders remain inactive until Core binds them to a reviewed Plan version and the traveler activates that Plan.

### `china-arrival-plan`

Acts as the composite gate for the complete regional result.

It requires the expected supporting Skill versions and statuses, binds the result to the exact Plan ID and version, and preserves evidence and limitations. Missing critical results fail closed rather than producing a partial result that appears complete.

## Composition order

```text
Policy evidence preparation
  -> Weather and packing
  -> Lodging-area guidance
  -> Transportation planning
  -> Destination food orientation
  -> Digital-life setup
  -> Arrival preparation
  -> Composite China proposal
  -> Core compilation
```

The order allows later Skills to reuse normalized conclusions without receiving raw provider responses or credentials.

## Provider and evidence boundaries

- Google Maps Platform supplies global place, nearby-discovery, and supported route facts.
- Google Weather supplies weather only where the API supports the requested location.
- Uber is the current taxi handoff; the traveler reviews and confirms the action in Uber.
- Official sources must come from the Pack allowlist and be stored as immutable SourceSnapshots before evidence-dependent compilation.
- A source change creates a new snapshot; it does not silently rewrite the evidence used by an existing Plan version.
- External search, booking, ordering, payment, and ride services remain handoff destinations rather than automatic Landi actions.

## Plan output

The Pack may contribute:

- known regional information;
- preparation Stages and Tasks;
- Reminder proposals;
- lodging and transportation recommendations;
- food and digital-setup guidance;
- assumptions and unresolved inputs;
- user-visible original source links;
- compilation and per-Skill audit references.

The Pack does not own the final Plan. Core decides whether a proposal is structurally valid for the exact draft Plan version.

## Current implementation

The repository includes all supporting Skills, the composite gate, deterministic orchestration, normalized fact collection, source preparation, country-neutral proposal adaptation, Core compilation, and atomic SQLite persistence.

Web and Telegram can trigger preparation and present the saved draft for review. The traveler must still approve the resulting Plan version before generated Tasks and Reminders become active.

## Demonstration path

```text
Traveler describes a trip to China
  -> Landi collects only critical missing facts
  -> Regional source and provider facts are prepared
  -> The Country Pack contributes arrival and local-life preparation
  -> Core compiles a complete draft Plan
  -> The traveler reviews and activates it
  -> Landi delivers relevant reminders and route handoffs
  -> External actions remain under traveler control
```
