# Landi

[中文说明](README.zh-CN.md)

Landi is an open-source regional assistant. Its first Country Pack, `china`, is designed to help foreigners prepare for and adapt to life in China through plans, timely reminders, official-source guidance, and actionable handoffs to local services.

Landi is released under the [Apache License 2.0](LICENSE).

The project is not limited to tourism. The long-term direction includes daily life, study, work, business, banking, legal, and other country-specific capabilities. The Core is country-neutral so additional Country Packs can be added later.

## Current status

Provider decision (August 2026): runtime place, route, nearby discovery, and weather calls use Google Maps Platform. Uber owns taxi handoff. Google Weather is used only where that API supports the requested coordinates; an unsupported location is a non-blocking degraded capability, with no regional weather fallback. Amap and QWeather are paused; their historical connector code and references remain only while provider-neutral naming is migrated.

The repository now contains the complete local V1 implementation slice: a country-neutral Core HTTP service and scheduler, a Web workspace, local SQLite persistence, Profile and Plan editing, verified Codex Plan drafting, a preview Claude Code adapter, the first internal China Pack, approved official-source refresh and traceability, global Google place/route facts and coverage-dependent Google weather facts, Telegram pairing/Plan review/reminders/location handoff, Uber ride handoff, and explicit Plan activation. The user selects one runtime per instance; neither runtime login credentials nor Connector secrets are stored in domain data or passed to Skills. Claude Code has contract coverage but no real-account V1 release validation, so Codex is the supported runtime for `0.1.0`. V1 remains intentionally bounded: it does not decide regulated eligibility from page text, place orders, book accommodation, hail rides, or pay.

## Run the local demo

Requirements: Node.js 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

For a long-running local instance, build once and run the single production process:

```bash
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787/`. The production process serves the built Web workspace together with the Core API, Telegram polling, and Reminder scheduler; Vite is not required at runtime.

On macOS, preview and install a per-user always-on service with:

```bash
pnpm run service:preview:macos
pnpm run service:install:macos
```

The LaunchAgent starts at login and restarts after an unexpected exit. Its plist contains no Connector or Agent credentials. `pnpm run service:remove:macos` removes only the service registration and keeps local data, `.env`, and logs.

Open the local URL printed by Vite. Root-level `pnpm dev` uses `http://127.0.0.1:8877/health` for development so it can run alongside the production service on `8787`.

Useful verification commands:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm test:browser
pnpm release:check
```

`pnpm release:check` runs a credential-free structural and tracked-file safety preflight followed by the complete build, typecheck, and unit/integration test suite. `pnpm test:browser` builds the product and runs the isolated Chromium planning-flow test with a temporary SQLite database; it does not call an Agent runtime or Connector. GitHub Actions runs both gates on pull requests and pushes to `master` or `main`.

The local instance creates `data/c-assistant.sqlite` on first start. `GOOGLE_MAPS_API_KEY` is the single active location/weather credential and must have Places API (New), Routes API, and Weather API enabled with billing, quotas, and server-side restrictions. Google supplies global place discovery, geocoding, and driving/walking/transit route facts. Google Weather supplies weather only for locations within its own coverage. Taxi actions open Uber's rider experience with the one-time device pickup coordinate and Plan destination text; the user reviews the live fare, vehicle, payment method, and final request in Uber, while Landi never hails or pays. `UBER_CLIENT_ID` is optional public attribution and must never contain a client secret or access token. Amap and QWeather are paused and their old environment values are ignored; their connector implementations remain temporarily for compatibility tests only. If `TELEGRAM_BOT_TOKEN` is configured, the Settings flow can verify and pair the bot without exposing its token.

Configure a replacement Google key locally with `pnpm configure:google`. The interactive command hides terminal input, verifies Places API (New), Routes API, and Weather API before saving, and writes only to the ignored local `.env` with private file permissions. Do not paste a production key into chat, source code, a shell argument, or a tracked file.

Settings readiness is calculated from the Profile, selected Agent Runtime, Google Maps Platform, and Telegram pairing, and presents one next setup action at a time. An unselected Runtime does not block readiness. Settings also shows the local SQLite schema and integrity state. `Create local backup` writes a consistent, verified `0600` snapshot under `data/backups` (or beside a custom database path). Backups contain the local workspace state but no Codex/Claude Code login credentials or Connector keys. Restore is intentionally not automatic because replacing the active workspace is destructive.

The Web workspace uses a conversational planning flow rather than a questionnaire. A new request first becomes a server-backed Planning Session; Landi collects the destination, timing, and objective, then presents one versioned proposal. The user can keep chatting to revise that proposal, and only explicit confirmation of the latest version can invoke the selected local Codex/Claude Code Runtime to create a complete draft Plan. Draft revision remains bounded and version-safe, so a stale Runtime result cannot overwrite newer Plan changes.

In the paired Telegram chat, complete Plans are paginated without omission and only the final page carries the version-bound confirmation button. Ordinary text revises a current user-created draft, while `/new <request>` explicitly starts a separate Plan. Once a Plan is active, local intents do not silently create or display another complete Plan: supported intents such as `I prefer taxi` update only this Plan's temporary transport preference and can offer a one-use arrival-route location handoff. An unsupported local request leaves the active Plan unchanged; complete Plan generation requires `/new` or an explicit whole-Plan request. Revision failure leaves the existing draft unchanged, and stale Runtime results cannot overwrite a Plan that changed while they were running.

`/prepare` resolves the single destination country from Google Maps' normalized country fact and runs the matching China or Japan Country Pack. It never selects a Pack from a city-name substring. Each Pack refreshes only its own approved source IDs, links exact snapshots to the draft, collects normalized Google place/route/weather facts, invokes its declared supporting Skills and composite, and atomically saves the next inert draft version. Unknown or ambiguous country facts fail closed. A blocked run preserves the existing Plan; a successful run still requires full review and confirmation.

`/profile` lets the paired user complete long-term basics without switching to Web. Text entry is captured only after the user chooses a specific field and expires after 15 minutes; enum fields use allowlisted buttons. Partial setup remains visibly incomplete and does not imply any policy eligibility.

`/weather` performs an explicit read-only weather check for the current Plan location through Google Places and Google Weather. Where supported, it returns current and dated three-day facts with attribution; an unsupported location is reported explicitly without guessing or trying a regional provider. The command creates no Reminder and stores no weather result in Profile or Plan. During an active arrival route, an unscoped message such as `I prefer taxi` applies only to the next route and leaves the saved Plan preference unchanged. A user must explicitly say the choice is for the whole Plan or trip before Landi persists it.

`/food` provides the first Telegram food-discovery loop. It uses the Plan's party size (or asks once), then displays Telegram's explicit location-share control. That location is accepted only for the current Plan and named purpose for 15 minutes, used once to retrieve Google Places restaurant and straight-line distance facts, and never persisted. Results hand the user to an HTTPS Google Maps place page; Landi does not independently rank, order, reserve, or pay.

This flow invokes the internal China Pack Skill `food-nearby` `0.1.0` over normalized Google Maps facts. The versioned Skill emits structured facts and Google Maps handoff proposals; Telegram only renders them. The Skill remains internal and cannot be installed separately from the complete China Country Pack.

The accommodation flow invokes `housing-area-recommendation` `0.1.0` over normalized Google Maps facts. Its first slice explains candidates relative to one selected Plan anchor using nearby-place distance, and clearly separates that fact from a real commute or a complete area recommendation. Live inventory, price, booking, quality, and foreign-guest eligibility remain unverified.

Route comparison and Telegram arrival routing invoke `transport-planner` `0.1.0` through the complete China Country Pack. It combines current Google Maps route facts with this Plan's preference, party, luggage, and matched weather, without a fixed walking-distance threshold or any automatic travel action.

Weather interpretation is centralized in `weather-and-packing` `0.1.0` for Web, Telegram, and reminder delivery. It preserves Google Weather provenance, uses exact-date matching for reminder forecasts, and returns only cautious packing prompts without silently changing a Plan. If the location is unsupported or weather is temporarily unavailable, the Skill degrades without blocking the remaining Plan.

The production policy evidence gate now runs through `policy-applicability` `0.1.0`. It sees only minimized Profile/Plan facts and official snapshot metadata, and reports readiness for separate review without interpreting policy or deciding eligibility.

The registered `china-arrival-plan` `0.1.0` composite gate now preserves ordered supporting Skill provenance for one exact Plan version. All seven supporting Skill modules exist; an individual composition still fails closed if any required result is absent, and the composite does not yet mutate Core state.

The internal `local-food-guide` `0.1.0` adds only source-backed destination food context during planning. Its first city catalogs cover five references each for Shanghai, Beijing, and Guangzhou from their official English city portals; a matching destination and fresh immutable snapshot are required before the bilingual references enter the complete Plan. Specific restaurant discovery remains an explicit later request.

The internal `digital-life-setup` `0.1.0` selects only the connectivity, communication, navigation, or payment setup capabilities required by the current Plan. It uses fresh allowlisted first-party guidance, presents English steps alongside Chinese names, and does not treat opening a link as setup completion.

The internal `arrival-preparation` `0.1.0` deduplicates normalized supporting guidance into user-confirmable Task and Reminder proposals. It skips completed work, asks for time only when a critical item needs an absent anchor, and calculates reminders only from offset-qualified departure or arrival timestamps. Core compilation and activation remain separate work.

The Core compilation boundary is implemented and connected. China Pack accepts only the exact `arrival-preparation` version/status recorded by a ready composite, converts it to the country-neutral proposal contract, and Core compiles that proposal only against the matching draft Plan version. SQLite atomically saves the next draft version with Task descriptions, inert reminders, compilation provenance, one minimized compilation Run, and eight per-Skill Run records; dependent Tasks and Runs retain exact official snapshot ID/hash pairs without copying source text. Stale or activated targets and evidence that does not match a stored immutable snapshot are rejected.

The deterministic China arrival orchestrator runs credential-free normalized inputs through the seven supporting Skills in the declared order, derives preparation items, invokes the composite, creates the China-to-Core proposal, and returns an inert compiled draft. Server assembles it with source preparation, the production fact collector, atomic persistence, and shared Web/Telegram presentation; it fails closed when a critical source, provider fact, or supporting Skill input is unavailable.

Web exposes this workflow on the Plan screen, and Telegram exposes it through `/prepare`. Both show a complete updated Plan only after a successful atomic save; a source-backed Task names its readable official basis, and Telegram maps it to a numbered original-source link without exposing internal snapshot IDs or hashes. No Task or Reminder becomes active until the user confirms that exact Plan version.

The production China fact collector resolves the Plan destination, weather, nearby accommodation candidates, and driving/walking/transit facts through Google Maps Platform only when this Plan contains the required anchors. It includes only immutable official snapshots explicitly linked to the current Plan and accepts food/digital-life reference catalogs as injected Country Pack data. It does not invent a route origin, read environment variables, or expose provider failure text.

China Pack now supplies the first source-backed digital-life reference catalog. It covers China Mobile SIM setup, WeChat, Amap, and Alipay across connectivity, communication, navigation, and payment preparation. Catalog text is inert: the runtime loader emits an item only when an approved current snapshot exists, chooses the newest snapshot per source, and strips retained page excerpts before Skill invocation.

## Product shape

- Web workspace: the full desktop-grade product interface.
- Telegram: default mobile conversation, proactive reminders, quick actions, and one-tap location sharing.
- WhatsApp Business Platform: optional messaging Connector; proactive messages outside the user-opened service window require an approved utility template.
- Core: profiles, plans, tasks, reminders, events, runs, confirmations, and source evidence.
- Agent runtime: Codex is verified for `0.1.0`; Claude Code remains an opt-in preview until a real-account run is validated.
- China and Japan Country Packs: isolated internal modular Skills, each published externally as one complete pack.
- Google Maps Platform: global V1 place, discovery, routing, and non-taxi handoff foundation; weather is used where Google Weather has coverage.
- Uber: user-confirmed taxi handoff.
- Skill Runtime: validates internal manifests, binds stable entrypoints, rejects duplicate IDs and invalid SkillResult envelopes, and exposes each Country Pack through one registry.

```text
Web / Telegram / optional WhatsApp
  ├── Codex or Claude Code (tool-free structured Plan draft)
  └── Landi Core
          ├── Skill Runtime → resolved China or Japan Country Pack
          └── restricted Connectors → Google Maps Platform / Uber / official sources / Telegram
```

Configure the optional WhatsApp Connector with `pnpm configure:whatsapp`. The interactive command hides the access token and App Secret while typing, verifies the configured phone identity, generates a Webhook verification token, and writes the values only to the ignored local `.env`. Do not paste WhatsApp credentials into chat, source files, or commits.

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

## Design documents

Start with the [Landi design document index](docs/README.md). The primary project-design path is:

- [Product Baseline](docs/landi-product-baseline.md)
- [Long-Term Travel Assistant Roadmap](docs/travel-assistant-development-roadmap.md)
- [System Architecture](docs/architecture.md)
- [Core Data Model](docs/core-data-model.md)
- [Travel Planning and Execution Flow](docs/travel-planning-and-execution-flow.md)
- [Regional Capability Design: China V1](docs/china-pack-v1.md)
- [Regional Capability Design: Japan V1](docs/japan-pack-v1.md)

Skill, Connector, and Agent Runtime contracts remain available as contributor references from the design index. Earlier workspace plans, release evidence, and decision logs are retained as project records rather than current top-level design.

## Planned technical baseline

- TypeScript and Node.js monorepo
- pnpm workspaces
- SQLite for single-user instance state
- React and Vite for the Web workspace
- HTTP plus Server-Sent Events for Web updates
- Telegram Bot API for default mobile interaction
- optional WhatsApp Business Platform Connector
- A future MCP-based local Tool Gateway for controlled Agent tools; V1 keeps Agent drafting tool-free and runs Connectors through Core

## Scope note

The product name is Landi. The repository name `c-assissant`, package scope `@c-assistant/*`, environment-variable prefix, and existing database filenames remain compatibility-oriented technical identifiers for now.
