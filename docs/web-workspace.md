# Legacy Web Workspace Notes

> Project record. This file preserves detailed interface decisions from an earlier implementation phase. It is not a top-level design source. Current product behavior is defined by `landi-product-baseline.md`, and the complete cross-channel flow is defined by `travel-planning-and-execution-flow.md`.

The Web workspace is Landi's desktop product surface. It replaces a desktop client; it is not an engineering dashboard.

## Navigation

- **Today** — current Tasks, upcoming reminders, active decisions, and immediate actions.
- **Plans** — all Plans and the active Plan.
- **Inbox** — proactive notices, changes, warnings, and items that need a response.
- **Profile** — long-term facts and preferences, with provenance and edit controls.
- **Settings** — runtime, Telegram pairing, approved official-source evidence, Country Pack, data, language, and recovery.

Source-backed generated Tasks show an `Official basis` link resolved from the exact snapshot ID/hash stored in Task provenance. The UI displays the official title and original URL, never the internal snapshot identifier or content fingerprint. Telegram uses the same relationship as numbered references in the complete Plan so repeated links remain compact on mobile.

Conversation is globally available and shares Core context with Telegram.

After a Plan exists, **Adjust Plan** opens a persistent right-side conversation drawer over the same workspace instead of returning to a questionnaire or separate document. The drawer keeps Plan-specific conversation locally across closes. On mobile it becomes a full-width conversation surface. A generated replacement draft appears immediately in the workspace while an older active Plan continues executing until the replacement is explicitly confirmed.

## Plan experience

Travel Plans with a structured itinerary open directly in the native interactive trip surface. That surface is the Landi renderer for the `interactive-trip-planner` result contract; it is not an iframe and does not create or download a standalone HTML guide. It provides a real Leaflet/OpenStreetMap map, all-trip and continuous-day navigation, ordered stops, adjacent movement evidence, same-day candidates, search and filters, one shared place-detail surface, priority and day assignment changes, undo, refresh recovery, and a natural-language “ask Landi to rearrange” handoff prefilled into the existing revision conversation. Xiaohongshu import is not part of this product path.

Non-spatial Plans and legacy presentations continue to use the modular views below.

A Plan workspace has five embedded views:

- **Plan** — purpose, known information, route or phase sequence, Stages, and next actions.
- **Preparation** — user-checkable packing, documents, bookings, and digital setup.
- **Decisions** — selected transport, accommodation area, unresolved choices, and reasons.
- **Reminders** — proposed or active automation with local time and time zone.
- **Sources** — official sources, retrieval dates, applicability summaries, and freshness warnings.

The current Plan screen also shows an **evidence preparation** card. It tells the user which saved facts or approved official snapshot are still needed before a separate policy review can begin. “Ready for review” is never presented as an eligibility or policy conclusion.

Initial generation uses a server-backed conversational Planning Session rather than a questionnaire. Landi collects only route-shaping facts, presents a version-bound proposal, and generates a complete Plan only after explicit proposal confirmation. Refreshing the browser restores the current session.

Before activation, the user sees the complete final Plan in normal presentation. One confirmation activates that exact Plan version and its declared automation scope. Later material changes create a new version that must be confirmed when they exceed the existing scope.

The Plan view renders each Stage from its explicit persisted `presentationKind`, not from title-language heuristics. The Preparation, Decisions, Reminders, and Sources views keep their domain content separate while remaining inside the same Plan page. When an Agent draft contains a valid structured reminder proposal, Web shows its local time, time zone, purpose, and activation state. No undeclared dynamic fact is fetched. The reminder is inert while the Plan remains a draft; after activation it becomes eligible for delivery through the configured channel.

## Interaction rules

- Ask only for information required to produce a reliable Plan or execute the current action.
- Save long-term information to Profile only when the user explicitly states or confirms it.
- Keep temporary preferences, such as transport for this visit, inside the active Plan.
- Explain degraded results in user language without exposing stack traces.
- Keep irreversible work in the original provider application.

## Telegram and Web coordination

Both surfaces read and write through the same Core. A direct response returns to its originating surface. Proactive reminders are delivered to Telegram and copied to the Web Inbox. Telegram sends every page of a long Plan without omission and places the confirmation button only on the final page. That callback is bound to the current Plan id and version; a replaced or edited draft must be reviewed again and cannot be activated by an old button.

`/profile` provides the same basic long-term settings from Telegram and must be completed before Plan creation. Nationality, name, and preferred language are entered only after choosing that field; gender and China visa/residence status use explicit choices. A pending text edit expires after 15 minutes and survives a local Server restart, preventing the intended value from being mistaken for a Plan request. Disconnecting Telegram clears that pending edit but retains already confirmed Profile data.

`/weather` provides the same on-demand destination facts from Telegram using the current Plan location. It is user-triggered and read-only: no Reminder is scheduled and no result is written into Profile or Plan. The response includes retrieval time, dated three-day forecasts, and an approved QWeather attribution link; an unresolved location or Provider failure is shown explicitly.

Before confirmation, a normal Telegram message is treated as a correction to the current user-created draft; `/new` is the explicit way to start a separate objective. A successful correction creates a complete replacement draft, preserves Plan-scoped configuration such as party size and luggage, and requires review again. Official evidence links are not silently copied to the replacement. The initial example Plan is not considered user-created, so the user's first ordinary message starts their own Plan.

Conflicting edits are resolved by Plan version. The client must refresh before confirming or changing an outdated version.

## Login and recovery

V1 uses Telegram pairing:

1. the Web workspace displays a short-lived pairing instruction;
2. the user confirms from the bound Telegram account;
3. Core creates a Web session;
4. the user receives or creates a separate recovery credential.

Telegram identity alone must not be the only recovery path. Sessions should be revocable from Settings.

The current Settings surface lets the user explicitly disconnect the bound Telegram chat. This removes only the local chat binding after a confirmation prompt; it retains Plans, Profile, the local Bot token, and the Telegram update cursor. The user may pair a Telegram account again later.

## Setup flow

First Web use blocks the workspace with a required Profile dialog for:

- preferred language;
- preferred name;
- nationality and other useful personal basics;
- document, visa, residence, or student status when relevant;
- a gender selection, including “prefer not to say.”

Codex or Claude Code selection and official login, Telegram pairing, Amap configuration, and Connector health remain separate instance setup. They do not belong to the personal Profile dialog.

Plan drafting starts only after the required Plan basics are submitted. The same dialog may also capture arrival point/time, party size, luggage, accommodation state, transport preference, Plan priority, and free-form requirements. No draft is saved before submission. After generation, progressive refinement asks at most one high-value question for a dependent action; unanswered non-critical details remain visibly pending and do not hide the complete Plan or prevent review.

## Diagnostics boundary

The Web workspace may show user-actionable health messages, such as “Codex login expired” or “Amap is not configured.” Detailed logs, traces, raw model output, and stack errors remain in local logs or CLI diagnostics.

Official-source settings show only Country Pack-approved sources, their original links, latest retained snapshot time, and a content-change warning when saved versions differ. Refresh is always explicit. After a snapshot is saved, the user may explicitly link that exact snapshot to the current Plan; the Plan then keeps a visible source reference. A warning or linked source means the page content was saved for review; it is not a policy conclusion or eligibility result.
