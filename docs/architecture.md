# Landi System Architecture

## System purpose

Landi is a single-user, long-running travel assistant. It combines conversational planning, structured Plan storage, source-backed regional preparation, scheduled assistance, and user-approved Plan adjustment.

The system is designed so that no Agent process needs to remain alive to preserve travel state. Core and Storage own continuity; Agent Runtimes perform bounded reasoning runs when needed.

## Runtime topology

```text
Web browser                     Telegram
     |                              |
     +--------------+---------------+
                    |
              Landi Server
                    |
        +-----------+------------+
        |           |            |
       Core     Scheduler     API/Channels
        |           |            |
        +-----------+------------+
                    |
              Local Storage
                 SQLite
                    |
       +------------+-------------+
       |            |             |
 Agent Runtimes  Country Packs  Connectors
```

One production Server process hosts:

- the built Web application;
- the Core HTTP API;
- Telegram polling and delivery;
- Reminder scheduling;
- current weather and venue monitoring;
- Connector access;
- local persistence.

The Roadmap moves the current fixed monitoring loops toward durable, database-backed Monitoring Jobs.

## Major components

### Web

Web is the primary planning and Plan-management surface.

Responsibilities:

- run conversational Planning Sessions;
- present and revise planning proposals;
- review and activate complete Plans;
- render itinerary maps, days, Places, routes, preparation, and sources;
- apply direct structured Plan edits;
- review impact and replacement drafts;
- manage Profile, history, runtime selection, Connectors, and local data.

Web never owns the authoritative Plan. It reads and writes through Server APIs.

### Telegram

Telegram is the primary mobile-assistance surface after activation.

Responsibilities:

- deliver time-sensitive Reminders and travel alerts;
- accept contextual natural-language requests;
- collect explicit arrival, deviation, location-share, and completion actions;
- present compact Plan review and version-bound confirmations;
- hand irreversible actions to maps, booking services, payment services, or ride applications.

Telegram identity and delivery state remain local to the user’s instance.

### Server

Server is the composition and delivery boundary.

Responsibilities:

- expose validated APIs;
- translate channel input into Core operations;
- call Agent Runtime adapters;
- collect normalized Connector facts;
- invoke Country Pack workflows;
- run Reminder and monitoring loops;
- sanitize failures before returning them to product surfaces.

Server may coordinate work but cannot bypass Core version and state checks.

### Core

Core owns domain behavior.

Responsibilities:

- Planning Session and proposal rules;
- Plan structure and integrity;
- Plan version and lifecycle rules;
- Task and Reminder semantics;
- current-destination resolution;
- change impact and replacement behavior;
- confirmation scope;
- compilation of validated regional proposals.

Core is provider-neutral. It receives normalized facts and structured proposals rather than provider SDK responses.

### Storage

Storage owns durable local state and concurrency protection.

Responsibilities:

- SQLite schema migrations;
- Profile, Planning Session, Plan, Stage, Task, and Reminder persistence;
- current and executing Plan pointers;
- source snapshots and evidence links;
- Run and delivery audit;
- compare-and-write protection for Plan versions;
- Reminder retry and deduplication state;
- backup and integrity checks.

Future Storage work adds durable Travel Events, Monitoring Jobs, and Travel Attention records.

### Agent Runtime Adapter

An Agent Runtime Adapter performs one bounded reasoning or generation run.

Responsibilities:

- verify installation and login state;
- execute in an isolated working directory;
- provide only minimized, approved context;
- enforce structured output;
- validate the result before returning it;
- exclude Connector credentials and sensitive runtime state.

Agent Runtimes do not own scheduling, long-term memory, Plan activation, or Connector credentials.

### Country Pack

A Country Pack adds regional preparation and local capability without changing the generic Plan lifecycle.

Responsibilities:

- register regional Skills;
- define approved official sources;
- transform normalized provider facts into structured proposals;
- compose supporting Skill results;
- preserve evidence provenance and limitations.

Country Packs cannot activate a Plan or write directly to Storage.

V1 includes coexisting `china` and `japan` packs. Server selects one Pack only from the normalized destination-country fact returned by the global map provider; a city name or free-text substring is not sufficient. Missing, ambiguous, unsupported, or multi-country facts fail closed and require confirmation. Official-source discovery and refresh use only the selected Pack's allowlist, preventing China policy evidence from entering Japan work and Japan evidence from entering China work.

### Skill

A Skill performs one specialized transformation inside a Country Pack workflow.

A Skill:

- accepts minimized structured input;
- returns a versioned structured result;
- declares sources, assumptions, warnings, and failure state;
- has no direct database, messaging, scheduling, or credential access.

### Connector

A Connector communicates with an external provider.

Examples include:

- place search and route facts;
- weather observations and forecasts;
- Telegram delivery;
- official-source retrieval;
- external route or ride handoff.

Connectors return normalized facts or typed failures. They do not make product decisions, generate travel recommendations, or mark Tasks complete.

## Planning flow

```text
Web message
  -> Planning Session update
  -> Structured facts and next question
  -> Versioned planning proposal
  -> Traveler approval
  -> Agent Runtime generation
  -> Connector and Country Pack enrichment
  -> Core integrity validation
  -> Atomic draft Plan persistence
  -> Traveler activation
```

No complete Plan exists before the generation boundary. No Task or Reminder becomes active before Plan activation.

## Active Plan execution

```text
Active Plan
  -> Core resolves due work
  -> Scheduler claims a Reminder or monitoring check
  -> Server requests current normalized facts
  -> Core decides whether the result matters
  -> Storage records result and audit
  -> Telegram or Web receives user-facing output when needed
```

The current implementation has separate loops for Task Reminders, arrival behavior, itinerary departures, weather, and venues. The target architecture preserves those capabilities behind one durable scheduling model.

## Plan adjustment flow

```text
Traveler request or Travel Attention
  -> Version-bound impact assessment
  -> Traveler review
  -> Replacement generation
  -> Revalidation of affected facts
  -> Atomic replacement draft persistence
  -> Traveler activation
  -> Execution pointer and future work switch versions
```

An older active Plan continues execution while a replacement draft is under review. Concurrent Plan changes invalidate stale generation results.

## Evidence flow

```text
Approved source definition
  -> Connector retrieval
  -> Immutable SourceSnapshot
  -> Normalized Skill input
  -> Skill and compilation provenance
  -> Plan, Task, and Run evidence references
  -> User-visible original source link
```

Evidence preparation does not itself establish personal eligibility or policy applicability. Policy conclusions require a separate, source-bound review.

## State and trust boundaries

### Authoritative state

SQLite is authoritative for:

- Profile;
- Planning Sessions;
- Plans and versions;
- Tasks and Reminders;
- execution pointers;
- source evidence;
- minimized Run and delivery state.

Browser state, conversation text, Agent memory, and external-app screens are not authoritative.

### Sensitive data

- Runtime login credentials remain in the official local runtime.
- Connector credentials remain in the Server environment.
- Skills and Agent Runtimes receive normalized facts, not credentials.
- Exact location is short-lived and action-scoped.
- Plan-scoped travel details do not automatically enter Profile.

### Irreversible actions

Booking, ordering, payment, and ride confirmation occur in external applications. Landi may prepare or hand off the action but must not claim completion without explicit confirmation or reliable evidence.

## Deployment model

The current deployment target is one local instance per traveler.

Supported path:

- Node.js and SQLite on the traveler’s machine;
- one production Server process;
- local Runtime login;
- local Connector configuration;
- macOS background service support.

Future deployment work may add Linux, Windows, or hosted operation, but it must preserve single-user data isolation, local ownership, version safety, and credential boundaries.
