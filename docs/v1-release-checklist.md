# Landi 0.1.0 release checklist

> Release record. This checklist preserves evidence for the 0.1.0 release process. It is not a current product-design source.

This checklist separates reproducible repository evidence from real-account and real-device evidence. A checked automated item does not substitute for a pending manual item.

## Automated release gate

- [x] Root project and all eight workspaces use version `0.1.0`.
- [x] Node.js 22+ and pinned pnpm are checked before release.
- [x] Nine internal China Skills are present and remain internal-only.
- [x] Tracked-file safety checks reject runtime data, populated Connector assignments, Telegram-style tokens, and private keys.
- [x] Build, TypeScript checks, workspace tests, and macOS service tests pass through `pnpm release:check`.
- [x] A credential-free fresh one-user integration test prepares, reviews, and confirms a complete China Plan.
- [x] Optional WhatsApp configuration, phone-identity verification, signed webhook parsing, sender binding, persistent message deduplication, and bounded text-command routing have automated tests.

## Real local instance

- [x] Codex is installed, authenticated, and selected for this instance.
- [ ] A restricted replacement `GOOGLE_MAPS_API_KEY` is configured with Places API (New), Routes API, Weather API, billing, and quotas; Amap and QWeather remain paused.
- [x] Telegram Bot identity is configured and one private account is paired.
- [ ] WhatsApp is configured locally with a newly generated access token and App Secret through `pnpm configure:whatsapp`; no credential is pasted into chat or committed.
- [ ] The Meta webhook uses a public HTTPS callback, passes the generated verification-token challenge, and delivers a signed inbound message from the one paired number.
- [ ] The approved `landi_plan_reminder` utility template is selected for one proactive reminder test outside the service window.
- [x] The production Server serves Web, Core API, Telegram polling, and Reminder scheduling from one process.
- [x] The macOS LaunchAgent starts Landi and automatically restarts it after a deliberate process exit.
- [x] A real Codex Plan is generated through the running production Web API and persisted with a successful Run.
- [x] A normal Telegram command is received once by the background poller and advances the persistent update cursor.
- [x] The corresponding command reply is confirmed visible on the paired phone.
- [x] A real Codex Plan is created from Telegram and prepared through the complete China Pack with current official evidence and provider facts.
- [x] The complete Telegram Plan is reviewed on the paired phone and explicitly confirmed from its final page.
- [x] A near-term Reminder is delivered to the paired phone from an active Plan, and its callback is received.
- [x] The explicit Telegram location request is accepted once; only the receipt timestamp is retained and the coordinates are not persisted.
- [ ] The resulting Google Maps HTTPS route is visible in Telegram and opens correctly on the phone.
- [ ] An ambiguous taxi request in the active arrival context creates no Codex Run or new Plan, leaves the saved Plan preference unchanged, uses Google route facts, and hands off to Uber.
- [ ] The updated taxi card is confirmed visible on the phone, opens Uber, and guides the user through pickup/destination review, vehicle selection, live fare/payment review, and final confirmation in Uber.
- [x] Claude Code is explicitly labelled optional preview: its contract and expired-login handling are tested, but paid access, login, and real-account success are not required for the Codex `0.1.0` release.

## Public release decisions

- [x] Add the owner-approved Apache-2.0 license and declare it consistently across all workspace manifests.
- [x] Keep the V1 Web interface consistently English; preserve the unfinished Chinese draft separately without shipping it.
- [x] Run `pnpm release:check` on the exact release commit.
- [ ] Push the release commit, verify GitHub Actions, and create tag `v0.1.0` with the matching release notes.
