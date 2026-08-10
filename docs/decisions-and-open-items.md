# Decisions and Open Items

This document separates accepted product decisions from questions that still require evidence or a later choice.

## Accepted decisions

- Landi is a regional-assistant ecosystem, with China as the first Country Pack.
- Landi is the confirmed product name.
- One user runs one instance and authenticates with their own Codex or Claude Code account.
- Users may self-deploy, ask a friend to deploy, or eventually use a one-click deployment service.
- Telegram is the only V1 messaging channel; WhatsApp is deferred.
- Web is a full desktop product surface.
- Profile stores long-term facts; Plan stores one concrete objective and its temporary context.
- `plans[]` is the collection; a Plan contains Stages, Tasks, Reminders, Events, Decisions, Sources, and assumptions.
- Core owns state and scheduling; Agent runtimes perform isolated reasoning Runs.
- Skills are independent internal modules but the China Country Pack is distributed as one unit.
- Skills cannot directly modify storage, schedule work, or send messages.
- Amap is the V1 discovery, location-fact, routing, and handoff foundation for food, accommodation areas, and transport.
- Users complete booking, ordering, ride hailing, and payment in external applications.
- Official policies must be current, traceable, and evaluated against the user's relevant status.
- Core asks only when a reliable Plan or current action lacks a critical fact.
- The final confirmation screen presents the complete Plan without a diff or highlighted changes.
- Confirming a Plan activates the exact version and declared automation scope.
- A replacement draft never interrupts the currently executing Plan. Review state and execution state use separate pointers; reminders and timelines switch only when the user confirms the complete replacement.
- Expected Events may trigger reversible preparation and action cards; they do not become occurred Events without evidence.
- Ordinary route handoffs advance from conservative expected timing by default, with an `I haven't arrived` exception action. Expected journey states remain projections and never become confirmed facts or authorize critical actions.
- Exact GPS requires an explicit user share, is scoped to the current Task, and is not stored in Profile.

## Open items before implementation claims

### Licensing and governance

- open-source license;
- public contribution and governance model.

### Deployment

- supported one-click deployment targets;
- how a personal instance remains available around the clock;
- backup, migration, upgrades, and recovery;
- secure secret storage on each supported target.

### Providers

- actual Amap products, quotas, terms, data fields, and deep-link behavior;
- Ctrip search handoff format and stability;
- official source registry for national and local authorities;
- weather horizon and fallback provider strategy;
- whether any later provider can legally and reliably expose restaurant, hotel, or transaction data.

### Agent runtimes

- supported Codex and Claude Code versions;
- installation and login proof of concept on target environments;
- structured-output reliability and cancellation behavior;
- MCP Tool Gateway compatibility and sandbox policy;
- runtime cost and rate-limit communication.

### Product and policy

- Profile fields that are useful enough to request during setup;
- retention periods for Profile, GPS, Runs, and SourceSnapshots;
- exact definition of material Plan changes requiring reconfirmation;
- notification timing, quiet hours, and no-response buffers;
- fact-level departure/arrival recognition from Telegram live location remains deferred; a delivered or opened external handoff never confirms boarding or arrival;
- initial official-source applicability test matrix;
- complete Web visual design and accessibility requirements.

### V1 release gate

V1 should not be called complete until the selected runtime, Amap Connector, Telegram delivery, persistence, scheduler, Web workspace, Plan confirmation, source traceability, and the arrival transport demo work together in a fresh one-user installation.

Implementation status (2026-08-08): the repository satisfies this gate in an isolated, credential-free integration scenario and in component tests. `pnpm release:check` repeats the local structural, tracked-file safety, build, typecheck, and test gates without contacting external services. Real-account/device release checks remain for Claude Code login, Telegram delivery, and Amap mobile handoff; those checks require the user's external sessions and are not simulated as successful.
