# System architecture

## Product definition

C-assistant is a country-neutral regional assistant runtime. It turns a user's situation into a persistent plan, timed tasks, evidence-backed guidance, and low-friction action handoffs.

The first public extension unit is the complete `china` Country Pack. Individual Skills remain internal modules in V1 and are not installed separately by normal users.

## Runtime topology

```text
User
├── Web workspace
└── Telegram
        ↓
Core application services
├── Profile and Plans
├── Task and Reminder scheduler
├── Event processing
├── Confirmation and risk enforcement
├── Source evidence and versioning
└── Inbox and channel delivery
        ├── Skill Runtime → China Country Pack composition
        ├── restricted Connectors → Amap / QWeather / official sources / Telegram
        └── Agent Runtime Adapter → Codex or Claude Code (tool-free Plan drafting in V1)
```

## Architectural boundaries

### Core

Core owns all durable state and side effects. It decides when a Skill runs, what context it receives, whether its output is valid, and whether a proposed action is inside the user's confirmed Plan scope.

Core is country-neutral. No China-specific policy, provider, language, or workflow may be hard-coded into Core.

### Country Pack

A Country Pack defines local workflows, official-source policy, provider mappings, language presentation, and Skills for one country. It is the public release unit.

### Skill

A Skill is a verifiable business capability. It receives a minimized context and approved tools, then returns a structured proposal or result. It cannot write Core state or send messages directly.

The implemented Skill Runtime loads Country Pack manifests into a duplicate-safe registry, verifies entrypoint bindings, and validates the shared result envelope and Skill identity/version before a caller can consume it. China Pack has a deterministic, credential-free orchestrator that invokes all seven supporting Skills in declared order over normalized facts and fails closed on critical missing input. The package converts only a ready, version-matched composite into a country-neutral proposal, and Core compiles it only against the exact current draft Plan version. A production fact collector converts Amap, QWeather, Plan-linked immutable official snapshots, and injected Country Pack reference catalogs into normalized input without receiving credentials. Server assembles source preparation, collection, orchestration and SQLite compare-and-write behind one workflow used by Web and Telegram. Successful saves retain minimized compilation and per-Skill Runs while the result remains a draft and inert.

Reference catalogs separate stable Country Pack guidance from freshness evidence. A catalog item names a capability, preserves the original Chinese product name, and provides bounded English steps tied to an approved source ID. At runtime, the loader joins it to the newest immutable snapshot for that exact source, strips the retained excerpt, and lets the Skill's freshness policy decide whether the item is usable. A JSON catalog alone can never satisfy a current-source requirement.

### Connector

A Connector implements a capability against an external provider. It returns normalized facts or performs a narrowly defined channel/handoff operation. It does not make product decisions.

### Agent Runtime Adapter

An Adapter asks Codex or Claude Code for a schema-constrained Plan draft. Runtime-specific commands, permissions, and output handling stay inside the Adapter. V1 executes Country Pack Skills deterministically inside the trusted local process rather than through the Agent runtime.

## Interaction and scheduled execution

Interactive and scheduled work use the same execution path:

```text
Web or Telegram request ─┐
                         ├── Task → Run → Skill → validated result → Core
Reminder or Event ───────┘
```

This prevents a split where a capability works in chat but cannot run as a scheduled task.

## Product clients

The Web workspace is the complete desktop-grade product interface. Telegram is the mobile and proactive-service interface. Both use the same Core and state.

Technical diagnostics are not part of the Web product. CLI and local logs contain connector health, raw Agent output, retries, and stack traces. The Web only shows user-understandable status and recovery actions.

## Deployment model

The initial architecture supports a local-first personal instance:

```text
User computer
├── Core and scheduler
├── selected Agent runtime
├── SQLite
├── Web server
└── Telegram Bot process
```

The runtime host may later move to a personal cloud instance without changing the Web, Telegram, Core, Country Pack, or Skill contracts. The official always-on deployment model remains an open decision.

## Autonomy principle

The system should minimize user effort:

1. Generate the complete Plan immediately.
2. Explain assumptions, recommendations, tradeoffs, Tasks, Reminders, and sources.
3. Let the user confirm and activate the complete Plan version once.
4. Execute approved, reversible work automatically.
5. Ask only when information is critical, authorization is missing, or an action is irreversible.

Expected Events may trigger read-only preparation, refreshed routes, and action cards. Actual occurrence is required only when the next action depends on the user's real state.

## Storage strategy

- SQLite stores Profile, Plans, Tasks, Reminders, Events, Runs, Confirmations, and indexes for SourceSnapshots.
- Country Packs, Skills, source policies, and contracts are ordinary version-controlled files.
- Evidence snapshots store the minimum material required to verify a conclusion or detect a source change.
- Secrets are isolated from both data and Agent workspaces.
- Exact task-scoped GPS is not retained as long-term profile history.
