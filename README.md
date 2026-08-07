# C-assistant

[中文说明](README.zh-CN.md)

C-assistant is a working codename for an open-source regional assistant. Its first Country Pack, `china`, is designed to help foreigners prepare for and adapt to life in China through plans, timely reminders, official-source guidance, and actionable handoffs to local services.

The project is not limited to tourism. The long-term direction includes daily life, study, work, business, banking, legal, and other country-specific capabilities. The Core is country-neutral so additional Country Packs can be added later.

## Current status

The repository contains the approved V1 architecture baseline plus a first local workflow: a Core HTTP service, a Web workspace, local SQLite persistence, Profile editing for nationality, gender, and China visa/residence status, Plan creation and confirmation, a restricted Amap place, nearby-restaurant, and route-facts Connector, a QWeather current/three-day weather-facts Connector, Codex and Claude Code structured Plan-draft flows, an allowlisted official-source Connector with local evidence snapshots, and safe local Telegram bot configuration/identity verification. The user can select one runtime per local instance; Web and Telegram then use that choice without storing its credentials or silently switching it. It is not yet a personal assistant for real use: source-to-Plan applicability analysis, full reminder scheduling, and external action handoffs beyond Amap routing still need implementation.

## Run the local demo

Requirements: Node.js 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The Server health check is available at `http://127.0.0.1:8787/health` by default.

Useful verification commands:

```bash
pnpm build
pnpm typecheck
pnpm test
```

The local instance creates `data/c-assistant.sqlite` on first start. If `AMAP_API_KEY` is set in the ignored `.env` file, the Plan screen can validate place-search facts, show nearby restaurant and accommodation POI and distance facts around a selected place, and compare driving, walking, and public-transit route facts. A user can also enter an already chosen stay by name and address; Amap resolves its location before it is saved inside that Plan. Driving can be handed to the user's Amap app without hailing a ride; the other route types remain factual comparisons until device handoffs are verified. A stay is marked as confirmed only after the user explicitly says they completed an external booking. Nearby results are factual candidates, not ranked recommendations, and the app does not order, reserve, or pay. If QWeather's ignored `QWEATHER_API_KEY` and `QWEATHER_API_HOST` are configured, it can show current conditions and a three-day forecast without exposing either value. If `TELEGRAM_BOT_TOKEN` is configured there, the Settings screen can explicitly verify the bot identity without exposing the token. In Settings, choose the locally logged-in Codex or Claude Code CLI; the Plan composer and paired Telegram account then create a schema-validated draft only after an explicit user request.

In the paired Telegram chat, complete Plans are paginated without omission and only the final page carries the version-bound confirmation button. Ordinary text revises the current user-created draft; `/new <request>` starts a separate Plan. Revision failure leaves the existing draft unchanged, and stale Runtime results cannot overwrite a Plan that changed while they were running.

`/profile` lets the paired user complete long-term basics without switching to Web. Text entry is captured only after the user chooses a specific field and expires after 15 minutes; enum fields use allowlisted buttons. Partial setup remains visibly incomplete and does not imply any policy eligibility.

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
- Default to a context-based transport choice; let a user set a Plan-only preference only when they want to override it.
- Keep traveller count and luggage context optional and Plan-scoped, so it can inform later transport decisions without becoming long-term profile data.
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
