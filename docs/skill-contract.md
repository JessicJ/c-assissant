# Skill Contract

## Definition

A Skill is a versioned, testable business capability. It receives minimized, validated context and approved tools, then returns a structured result.

A Skill cannot:

- write SQLite or other Core state;
- send Telegram messages;
- create timers directly;
- read full Profile, Plan, or chat history by default;
- access API keys or runtime login credentials;
- lower its own risk classification.

Core validates and applies every proposed state change.

## Source layout

```text
skill-name/
├── skill.json
├── instruction.md
├── scripts/              optional deterministic helpers
├── references/           source and field documentation
├── tests/
└── SKILL.md              generated runtime entry; do not hand-edit
```

`skill.json` and `instruction.md` are the primary sources of truth. Runtime-specific `SKILL.md` files are generated from these files and common safety templates.

## Manifest responsibilities

The manifest declares:

- identity, country, and version;
- required and optional inputs;
- permitted Profile and Plan fields;
- required capability interfaces;
- source and freshness policy;
- information and action risk;
- execution policy;
- output Schema;
- fallback and failure behavior;
- Core and Connector compatibility.

## Input contract

Core creates a minimized Skill context containing only:

- declared Profile and Plan fields;
- trigger Task, Reminder, or Event;
- current time and relevant timezone;
- current confirmed Plan version;
- approved automation scope;
- allowed Connector capabilities;
- relevant SourceSnapshots.

Missing optional information results in visible assumptions. Missing information that materially changes the result returns `needs_input` with the exact required field and reason.

## Output contract

```text
SkillResult
├── status
├── summary
├── facts
├── assumptions
├── recommendations
├── proposed_plan_changes
├── proposed_tasks
├── proposed_reminders
├── action_cards
├── sources
└── warnings
```

Supported statuses:

```text
success
needs_input
degraded
not_supported
blocked
failed
```

Natural-language output alone is not executable. Core renders validated structured results for Web and Telegram.

## Source policy

- Regulated policy, immigration, legal, banking, and medical conclusions require current official sources.
- Every high-risk claim references the specific SourceSnapshot that supports it.
- Amap provides location, route, and POI facts for V1.
- AI recommendations are explicitly marked as recommendations or inferences and cite the facts used.
- Missing, conflicting, inaccessible, or inapplicable official sources fail closed.

## Risk contract

Information risk:

```text
ordinary
sensitive
regulated
```

Action risk:

```text
read_only
reversible
external_handoff
irreversible
```

Execution policy:

```text
automatic
automatic_with_notice
confirmation_required
external_handoff
```

Core makes the final authorization decision using the active Plan Confirmation.

## Failure contract

A failure result includes:

- status and stable reason;
- whether retry is appropriate;
- optional retry delay;
- available fallback;
- whether user action is required;
- user-safe explanation material.

Core retries transient failures and applies declared fallbacks before interrupting the user. A high-risk unavailable source cannot be replaced with an unapproved blog or model memory.

## Validation

Agent output is parsed and validated against the SkillResult Schema, risk rules, authorization scope, and source requirements.

The first implemented runtime layer validates manifest shape, unique IDs, semantic versions, entrypoint bindings, supported statuses, result identity/version, and required result arrays. Country Pack handlers are registered internally; individual Skill installation remains disabled.

On validation failure, the same Run receives the validation errors and may repair its output once. A second failure stops the Run. Core never guesses executable actions from malformed prose.

## Versioning and tests

Every Run records the Skill version used. Updating a Skill cannot silently rewrite an already confirmed Plan version.

Required tests cover:

- valid inputs and outputs;
- missing required information;
- Connector unavailable or rate-limited;
- official source stale, inaccessible, or conflicting;
- malformed Agent output;
- unauthorized sensitive data or action requests;
- declared fallback behavior;
- Codex and Claude Code runtime compatibility.
