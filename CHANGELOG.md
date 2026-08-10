# Changelog

All notable changes to Landi are documented here.

## 0.1.0 - 2026-08-10

First local, single-user V1 of Landi and the complete China Country Pack.

### Included

- A local Web workspace backed by Core and SQLite.
- Telegram private-account pairing, Plan creation and revision, complete review, confirmation, reminders, weather, nearby food, and explicit location handoff.
- Verified Codex Plan drafting plus an opt-in Claude Code preview, both using tool-free, credential-minimized Runtime Adapters.
- A complete internal China Country Pack orchestration path with nine internal Skills, immutable official-source evidence, Task provenance, and Run audit records.
- Amap place, nearby food/accommodation, route, and external action handoff facts.
- QWeather current conditions and three-day forecasts, with an honest display-only Amap fallback.
- Single-process production serving for Web, Core, Telegram polling, and Reminder scheduling.
- A macOS per-user LaunchAgent installer with login startup and crash restart.

### Deliberate V1 boundaries

- Landi does not order food, book accommodation, hail rides, pay, submit forms, or treat an external link as completion.
- Telegram cannot silently read GPS. Exact location is requested explicitly and used only for the current handoff.
- Policy evidence preparation does not itself determine personal visa, residence, legal, banking, or medical applicability.
- Telegram live-location ETA progression, Ctrip inventory, and Linux/Windows/remote one-click deployment are not included.
