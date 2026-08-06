# C-assistant

[中文说明](README.zh-CN.md)

C-assistant is a working codename for an open-source regional assistant. Its first Country Pack, `china`, is designed to help foreigners prepare for and adapt to life in China through plans, timely reminders, official-source guidance, and actionable handoffs to local services.

The project is not limited to tourism. The long-term direction includes daily life, study, work, business, banking, legal, and other country-specific capabilities. The Core is country-neutral so additional Country Packs can be added later.

## Current status

The repository currently contains the approved V1 architecture baseline and project scaffold. Business code and external integrations have not been implemented yet.

## Product shape

- Web workspace: the full desktop-grade product interface.
- Telegram: mobile conversation, proactive reminders, quick actions, and one-tap location sharing.
- Core: profiles, plans, tasks, reminders, events, runs, confirmations, and source evidence.
- Agent runtime: the user chooses Codex or Claude Code and signs in with their own account.
- China Country Pack: internal modular Skills published externally as one complete pack.
- Amap: V1 location facts, discovery, routing, and action handoff foundation.

```text
Web / Telegram
      ↓
C-assistant Core
      ↓
Skill Runtime
      ↓
Codex or Claude Code
      ↓
C-assistant Tool Gateway
      ↓
Amap / Official Sources / External Handoffs
```

## V1 principles

- Generate the complete plan first; ask the user to confirm and activate it once.
- Execute approved, reversible work with as little user intervention as possible.
- Keep long-term Profile data separate from each Plan's temporary configuration.
- Use current official sources for policy, immigration, legal, banking, health, and other regulated information.
- Do not guess when a high-risk conclusion cannot be verified.
- Do not place orders, book accommodation, hail rides, pay, cancel, or submit materials in V1.
- Preserve Chinese names and addresses alongside English explanations.
- Treat exact GPS as task-scoped temporary data, not long-term profile history.

## Repository layout

```text
apps/
  server/                 Node.js Core API and scheduler host
  telegram-bot/           Telegram channel application
  web/                    React + Vite workspace
packages/
  core/                   Country-neutral domain and application logic
  skill-runtime/          Skill registry, assembly, validation, and execution
  agent-adapters/         Codex and Claude Code runtime adapters
  connectors/             Capability-based external integrations
  storage/                SQLite and evidence snapshot persistence
country-packs/
  china/                  The first complete Country Pack
docs/                     Architecture and contract documents
```

## Architecture documents

- [System architecture](docs/architecture.md)
- [Core data model](docs/core-data-model.md)
- [Skill Contract](docs/skill-contract.md)
- [Connector Contract](docs/connector-contract.md)
- [Agent Runtime Adapter Contract](docs/agent-runtime-adapter.md)
- [Web workspace](docs/web-workspace.md)
- [China Pack V1](docs/china-pack-v1.md)
- [Decisions and open items](docs/decisions-and-open-items.md)

## Planned technical baseline

- TypeScript and Node.js monorepo
- pnpm workspaces
- SQLite for single-user instance state
- React and Vite for the Web workspace
- HTTP plus Server-Sent Events for Web updates
- Telegram Bot API for mobile interaction
- MCP-based local Tool Gateway for controlled Agent tools

## Scope note

The repository name uses `c-assissant`; the product codename remains `C-assistant` until a final name is selected.
