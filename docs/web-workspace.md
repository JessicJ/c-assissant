# Web Workspace

The Web workspace is C-assistant's desktop product surface. It replaces a desktop client; it is not an engineering dashboard.

## Navigation

- **Today** — current Tasks, upcoming reminders, active decisions, and immediate actions.
- **Plans** — all Plans and the active Plan.
- **Inbox** — proactive notices, changes, warnings, and items that need a response.
- **Profile** — long-term facts and preferences, with provenance and edit controls.
- **Settings** — runtime, Telegram pairing, approved official-source evidence, Country Pack, data, language, and recovery.

Conversation is globally available and shares Core context with Telegram.

## Plan experience

A Plan has four views:

- **Overview** — purpose, known information used, assumptions, status, and next actions.
- **Timeline** — Stages, Tasks, expected Events, and Reminders.
- **Decisions** — selected transport, accommodation area, unresolved choices, and reasons.
- **Sources** — official sources, retrieval dates, applicability summaries, and freshness warnings.

The initial generation should present a complete Plan, not a questionnaire. It begins with the information used to generate it and allows a one-sentence correction.

Before activation, the user sees the complete final Plan in normal presentation. One confirmation activates that exact Plan version and its declared automation scope. Later material changes create a new version that must be confirmed when they exceed the existing scope.

## Interaction rules

- Ask only for information required to produce a reliable Plan or execute the current action.
- Save long-term information to Profile only when the user explicitly states or confirms it.
- Keep temporary preferences, such as transport for this visit, inside the active Plan.
- Explain degraded results in user language without exposing stack traces.
- Keep irreversible work in the original provider application.

## Telegram and Web coordination

Both surfaces read and write through the same Core. A direct response returns to its originating surface. Proactive reminders are delivered to Telegram and copied to the Web Inbox.

Conflicting edits are resolved by Plan version. The client must refresh before confirming or changing an outdated version.

## Login and recovery

V1 uses Telegram pairing:

1. the Web workspace displays a short-lived pairing instruction;
2. the user confirms from the bound Telegram account;
3. Core creates a Web session;
4. the user receives or creates a separate recovery credential.

Telegram identity alone must not be the only recovery path. Sessions should be revocable from Settings.

## Setup flow

First use may guide the user through:

- preferred language;
- nationality and other useful personal basics;
- document, visa, residence, or student status when relevant;
- Codex or Claude Code selection and official login;
- Telegram pairing;
- Amap configuration and Connector health.

Setup is optional and progressive. A user can start by writing an open request such as “I will attend an exhibition in Shanghai in September,” and Core collects only missing critical facts.

## Diagnostics boundary

The Web workspace may show user-actionable health messages, such as “Codex login expired” or “Amap is not configured.” Detailed logs, traces, raw model output, and stack errors remain in local logs or CLI diagnostics.

Official-source settings show only Country Pack-approved sources, their original links, latest retained snapshot time, and a content-change warning when saved versions differ. Refresh is always explicit. A warning means the page content differs; it is not a policy conclusion or eligibility result.
