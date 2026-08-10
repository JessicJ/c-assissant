# Landi 0.1.0 release checklist

This checklist separates reproducible repository evidence from real-account and real-device evidence. A checked automated item does not substitute for a pending manual item.

## Automated release gate

- [x] Root project and all eight workspaces use version `0.1.0`.
- [x] Node.js 22+ and pinned pnpm are checked before release.
- [x] Nine internal China Skills are present and remain internal-only.
- [x] Tracked-file safety checks reject runtime data, populated Connector assignments, Telegram-style tokens, and private keys.
- [x] Build, TypeScript checks, workspace tests, and macOS service tests pass through `pnpm release:check`.
- [x] A credential-free fresh one-user integration test prepares, reviews, and confirms a complete China Plan.

## Real local instance

- [x] Codex is installed, authenticated, and selected for this instance.
- [x] Amap and QWeather are configured and reported ready without exposing their keys.
- [x] Telegram Bot identity is configured and one private account is paired.
- [x] The production Server serves Web, Core API, Telegram polling, and Reminder scheduling from one process.
- [x] The macOS LaunchAgent starts Landi and automatically restarts it after a deliberate process exit.
- [x] A real Codex Plan is generated through the running production Web API and persisted with a successful Run.
- [ ] A normal Telegram command is received by the background poller and its reply is visible on the paired phone.
- [ ] A real Codex Plan is created from Telegram, fully reviewed, prepared with China Pack, and explicitly confirmed.
- [ ] A near-term Reminder is delivered to the paired phone from an active Plan.
- [ ] The explicit Telegram location request is accepted, and the resulting Amap HTTPS route opens correctly on the phone.
- [x] Claude Code is explicitly labelled optional preview: its contract and expired-login handling are tested, but paid access, login, and real-account success are not required for the Codex `0.1.0` release.

## Public release decisions

- [ ] Add the owner-approved open-source license.
- [x] Keep the V1 Web interface consistently English; preserve the unfinished Chinese draft separately without shipping it.
- [ ] Run `pnpm release:check` on the exact release commit.
- [ ] Push the release commit, verify GitHub Actions, and create tag `v0.1.0` with the matching release notes.
