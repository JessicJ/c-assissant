# Landi

[中文说明](README.zh-CN.md)

Landi is an open-source regional assistant. Its first Country Pack, `china`, is designed to help foreigners prepare for and adapt to life in China through plans, timely reminders, official-source guidance, and actionable handoffs to local services.

Landi is released under the [Apache License 2.0](LICENSE).

The project is not limited to tourism. The long-term direction includes daily life, study, work, business, banking, legal, and other country-specific capabilities. The Core is country-neutral so additional Country Packs can be added later.

## Current status

The repository now contains the complete local V1 implementation slice: a Core HTTP service and scheduler, a Web workspace, local SQLite persistence, Profile and Plan editing, verified Codex Plan drafting, a preview Claude Code adapter, the complete internal China Pack orchestration path, approved official-source refresh and traceability, Amap and QWeather facts, Telegram pairing/Plan review/reminders/location handoff, and explicit Plan activation. The user selects one runtime per instance; neither runtime login credentials nor Connector secrets are stored in domain data or passed to Skills. Claude Code has contract coverage but no real-account V1 release validation, so Codex is the supported runtime for `0.1.0`. V1 remains intentionally bounded: it does not decide regulated eligibility from page text, place orders, book accommodation, hail rides, or pay.

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

Open the local URL printed by Vite. The Server health check is available at `http://127.0.0.1:8787/health` by default.

Useful verification commands:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm release:check
```

`pnpm release:check` runs a credential-free structural and tracked-file safety preflight followed by the complete build, typecheck, and test suite. It does not contact Telegram, Amap, QWeather, Codex, or Claude Code. The same gate runs in GitHub Actions on pull requests and pushes to `master` or `main`.

The local instance creates `data/c-assistant.sqlite` on first start. If `AMAP_API_KEY` is set in the ignored `.env` file, the Plan screen can validate place-search facts, show nearby restaurant and accommodation POI and distance facts around a selected place, and compare driving, walking, and public-transit route facts. A user can also enter an already chosen stay by name and address; Amap resolves its location before it is saved inside that Plan. Driving can be handed to the user's Amap app without hailing a ride; Amap's documented public URI does not open its taxi-order page, so taxi handoff currently opens a driving-route estimate and instructs the user to switch to Taxi and confirm manually. The other route types remain factual comparisons until device handoffs are verified. A stay is marked as confirmed only after the user explicitly says they completed an external booking. Nearby results are factual candidates, not ranked recommendations, and the app does not order, reserve, or pay. If QWeather's ignored `QWEATHER_API_KEY` and `QWEATHER_API_HOST` are configured, it is the preferred source for current conditions, a three-day forecast, and cautious packing or transport prompts. When QWeather is unavailable, direct Web and Telegram weather checks may fall back to lower-detail Amap city weather; missing precipitation, UV, and feels-like values are never invented, and fallback facts do not enter packing or transport decisions. If `TELEGRAM_BOT_TOKEN` is configured there, the Settings screen can explicitly verify the bot identity without exposing the token. In Settings, choose the locally logged-in Codex or Claude Code CLI; the Plan composer and paired Telegram account then create a schema-validated draft only after an explicit user request.

Settings starts with one instance-readiness summary for the Profile, selected Agent Runtime, Amap, QWeather, and Telegram pairing, and presents one next setup action at a time. An unselected Runtime does not block readiness. Settings also shows the local SQLite schema and integrity state. `Create local backup` writes a consistent, verified `0600` snapshot under `data/backups` (or beside a custom database path). Backups contain the local workspace state but no Codex/Claude Code login credentials or Connector keys. Restore is intentionally not automatic because replacing the active workspace is destructive.

The Web workspace also provides a persistent `Ask Agent` panel at the top of Today as its primary desktop interaction. Each turn explicitly creates a new complete Plan draft or revises the current draft through the selected local Codex/Claude Code Runtime; success switches directly to the complete Plan review. It is not an unrestricted chat endpoint: input is bounded, unknown modes are rejected, the result remains unconfirmed, and a Plan changed while the Runtime is working cannot be overwritten by the stale result.

In the paired Telegram chat, complete Plans are paginated without omission and only the final page carries the version-bound confirmation button. Ordinary text revises a current user-created draft, while `/new <request>` explicitly starts a separate Plan. Once a Plan is active, local intents do not silently create or display another complete Plan: supported intents such as `I prefer taxi` update only this Plan's temporary transport preference and can offer a one-use arrival-route location handoff. An unsupported local request leaves the active Plan unchanged; complete Plan generation requires `/new` or an explicit whole-Plan request. Revision failure leaves the existing draft unchanged, and stale Runtime results cannot overwrite a Plan that changed while they were running.

`/prepare` runs the current draft through the complete China Country Pack path. It refreshes only approved source IDs when their cache is stale, links current National Immigration Administration evidence to the exact draft, collects normalized Amap/QWeather facts, invokes the seven supporting Skills plus the composite Skill, and atomically saves the next inert draft version. A blocked run returns concise missing details and preserves the existing Plan; a successful run sends the full updated Plan for review and confirmation.

`/profile` lets the paired user complete long-term basics without switching to Web. Text entry is captured only after the user chooses a specific field and expires after 15 minutes; enum fields use allowlisted buttons. Partial setup remains visibly incomplete and does not imply any policy eligibility.

`/weather` performs an explicit read-only weather check for the current Plan location through Amap and QWeather. It returns current and dated three-day facts with attribution, but creates no Reminder and stores no weather result in Profile or Plan. During an active arrival route, an unscoped message such as `I prefer taxi` applies only to the next route and leaves the saved Plan preference unchanged. A user must explicitly say the choice is for the whole Plan or trip before Landi persists it.

`/food` provides the first Telegram food-discovery loop. It uses the Plan's party size (or asks once), then displays Telegram's explicit location-share control. That location is accepted only for the current Plan and named purpose for 15 minutes, converted for Amap, used once to retrieve nearby restaurant and distance facts, and never persisted. Results preserve Amap's provider order and hand the user to an HTTPS Amap place page; Landi does not independently rank, order, reserve, or pay.

This flow now invokes the first executable internal China Pack Skill, `food-nearby` `0.1.0`, after Amap normalization. The versioned Skill emits structured facts and handoff proposals; Telegram only renders them. The Skill remains internal and cannot be installed separately from the complete China Country Pack.

The Web accommodation flow invokes `housing-area-recommendation` `0.1.0` after Amap normalization. Its first slice explains candidates relative to one selected Plan anchor using nearby-place distance, and clearly separates that fact from a real commute or a complete area recommendation. Live inventory, price, booking, quality, and foreign-guest eligibility remain unverified.

Web route comparison and Telegram arrival routing invoke `transport-planner` `0.1.0` through the complete China Country Pack. It combines current Amap route facts with this Plan's preference, party, luggage, and matched weather, without a fixed walking-distance threshold or any automatic travel action.

Weather interpretation is centralized in `weather-and-packing` `0.1.0` for Web, Telegram, and reminder delivery. It preserves QWeather provenance, uses exact-date matching for reminder forecasts, and returns only cautious packing prompts without silently changing a Plan.

The production policy evidence gate now runs through `policy-applicability` `0.1.0`. It sees only minimized Profile/Plan facts and official snapshot metadata, and reports readiness for separate review without interpreting policy or deciding eligibility.

The registered `china-arrival-plan` `0.1.0` composite gate now preserves ordered supporting Skill provenance for one exact Plan version. All seven supporting Skill modules exist; an individual composition still fails closed if any required result is absent, and the composite does not yet mutate Core state.

The internal `local-food-guide` `0.1.0` adds only source-backed destination food context during planning. Its first city catalogs cover five references each for Shanghai, Beijing, and Guangzhou from their official English city portals; a matching destination and fresh immutable snapshot are required before the bilingual references enter the complete Plan. Specific restaurant discovery remains an explicit later request.

The internal `digital-life-setup` `0.1.0` selects only the connectivity, communication, navigation, or payment setup capabilities required by the current Plan. It uses fresh allowlisted first-party guidance, presents English steps alongside Chinese names, and does not treat opening a link as setup completion.

The internal `arrival-preparation` `0.1.0` deduplicates normalized supporting guidance into user-confirmable Task and Reminder proposals. It skips completed work, asks for time only when a critical item needs an absent anchor, and calculates reminders only from offset-qualified departure or arrival timestamps. Core compilation and activation remain separate work.

The Core compilation boundary is implemented and connected. China Pack accepts only the exact `arrival-preparation` version/status recorded by a ready composite, converts it to the country-neutral proposal contract, and Core compiles that proposal only against the matching draft Plan version. SQLite atomically saves the next draft version with Task descriptions, inert reminders, compilation provenance, one minimized compilation Run, and eight per-Skill Run records; dependent Tasks and Runs retain exact official snapshot ID/hash pairs without copying source text. Stale or activated targets and evidence that does not match a stored immutable snapshot are rejected.

The deterministic China arrival orchestrator runs credential-free normalized inputs through the seven supporting Skills in the declared order, derives preparation items, invokes the composite, creates the China-to-Core proposal, and returns an inert compiled draft. Server assembles it with source preparation, the production fact collector, atomic persistence, and shared Web/Telegram presentation; it fails closed when a critical source, provider fact, or supporting Skill input is unavailable.

Web exposes this workflow on the Plan screen, and Telegram exposes it through `/prepare`. Both show a complete updated Plan only after a successful atomic save; a source-backed Task names its readable official basis, and Telegram maps it to a numbered original-source link without exposing internal snapshot IDs or hashes. No Task or Reminder becomes active until the user confirms that exact Plan version.

The production China fact collector resolves the Plan destination through Amap, fetches QWeather facts and nearby accommodation candidates, and obtains driving, walking, and transit facts only when this Plan already contains a chosen accommodation coordinate. It includes only immutable official snapshots explicitly linked to the current Plan and accepts food/digital-life reference catalogs as injected Country Pack data. It does not invent a route origin, use a fixed nearby radius, read environment variables, or expose provider failure text.

China Pack now supplies the first source-backed digital-life reference catalog. It covers China Mobile SIM setup, WeChat, Amap, and Alipay across connectivity, communication, navigation, and payment preparation. Catalog text is inert: the runtime loader emits an item only when an approved current snapshot exists, chooses the newest snapshot per source, and strips retained page excerpts before Skill invocation.

## Product shape

- Web workspace: the full desktop-grade product interface.
- Telegram: mobile conversation, proactive reminders, quick actions, and one-tap location sharing.
- Core: profiles, plans, tasks, reminders, events, runs, confirmations, and source evidence.
- Agent runtime: Codex is verified for `0.1.0`; Claude Code remains an opt-in preview until a real-account run is validated.
- China Country Pack: internal modular Skills published externally as one complete pack.
- Amap: V1 location facts, discovery, routing, and action handoff foundation.
- Skill Runtime: validates internal manifests, binds stable entrypoints, rejects duplicate IDs and invalid SkillResult envelopes, and exposes each Country Pack through one registry.

```text
Web / Telegram
  ├── Codex or Claude Code (tool-free structured Plan draft)
  └── Landi Core
          ├── Skill Runtime → China Country Pack
          └── restricted Connectors → Amap / QWeather / official sources / Telegram
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
- A future MCP-based local Tool Gateway for controlled Agent tools; V1 keeps Agent drafting tool-free and runs Connectors through Core

## Scope note

The product name is Landi. The repository name `c-assissant`, package scope `@c-assistant/*`, environment-variable prefix, and existing database filenames remain compatibility-oriented technical identifiers for now.
