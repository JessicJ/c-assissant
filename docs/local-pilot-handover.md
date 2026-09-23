# Controlled Local Pilot

This pilot uses the normal Web, planning API, Codex runtime adapter, and persisted SQLite workspace. Telegram and WhatsApp sends are captured locally.

## Paths

- Database: `/Users/mable/Documents/C-assissant/data/local-pilot/landi.sqlite`
- Baseline backup: `/Users/mable/Documents/C-assissant/data/local-pilot/backups/controlled-pilot-baseline-20260918.sqlite`
- Notification capture: `/Users/mable/Documents/C-assissant/data/local-pilot/landi.sqlite.captures.jsonl`
- Pilot-only configuration: `/Users/mable/Documents/C-assissant/data/local-pilot/landi.sqlite.env`
- Optional server log: `/Users/mable/Documents/C-assissant/data/local-pilot/server.log`
- Web: `http://127.0.0.1:8896/`

The whole `data/` directory and SQLite, capture, and log files are excluded from Git.

## 1. Start With Canary Off

From the repository root:

```bash
./apps/server/node_modules/.bin/tsx scripts/serve-semantic-execution-v14c.ts \
  /Users/mable/Documents/C-assissant/data/local-pilot/landi.sqlite 8896 \
  2>&1 | tee -a /Users/mable/Documents/C-assissant/data/local-pilot/server.log
```

Open the Web, choose **New plan**, and send the first trip-planning message. Do not confirm the proposal yet.

Read the real session ID:

```bash
curl -sS http://127.0.0.1:8896/api/workspace | jq -r '.planningSession.id'
```

Stop the service with `Ctrl-C`.

## 2. Allow Only That Session

Replace `<SESSION_ID>` with the value returned above:

```bash
LANDI_SEMANTIC_DRAFT_CANARY=1 \
LANDI_SEMANTIC_DRAFT_CANARY_SESSION_IDS=<SESSION_ID> \
./apps/server/node_modules/.bin/tsx scripts/serve-semantic-execution-v14c.ts \
  /Users/mable/Documents/C-assissant/data/local-pilot/landi.sqlite 8896 \
  2>&1 | tee -a /Users/mable/Documents/C-assissant/data/local-pilot/server.log
```

The launcher rejects Canary startup when the allowlist is empty. Configuration is read at startup, so changing the allowlist requires a restart. Return to the same planning session, finish any missing facts, review the proposal, and use its normal confirmation action to start generation.

## 3. Verify The Result

Check generation lineage and failure events:

```bash
curl -sS http://127.0.0.1:8896/api/planning-sessions/<SESSION_ID>/generation | \
  jq '{sessionStatus, strategy:.generation.strategy, stage:.generation.stage, status:.generation.status, generationKey:.generation.generationKey, events}'
```

`strategy` must be `semantic_canary`. Its generation key also contains the Semantic Canary policy suffix. A failed generation reports its stage and events here; do not treat the pre-existing Porto draft as the new result. The new draft ID is available after completion from:

```bash
curl -sS http://127.0.0.1:8896/api/workspace | \
  jq '{planId:.activePlan.id, planVersion:.activePlan.version, status:.activePlan.status, generationKey:.activeBlueprint.generationKey}'
```

The accepted Porto baseline is `plan-1359069`. A newly completed request must have its own Plan ID and matching generation lineage.

## Review And Confirmation Boundaries

- **View** only reads the saved draft.
- **Edit** changes the working draft through the existing edit workflow.
- **Apply** saves the reviewed edit or replacement; it does not activate execution.
- **Confirm and activate** is the separate user-authorized execution transition. Use it only when ready.

Even after confirmation, Telegram and WhatsApp remain capture-only. View captures with:

```bash
tail -n 50 /Users/mable/Documents/C-assissant/data/local-pilot/landi.sqlite.captures.jsonl
```

An empty capture is valid when no reminder satisfies the existing eligibility rules.
Runtime connector refreshes preserve the capture-only messaging boundary; the pilot never writes configuration changes to the repository's normal `.env`.

## Disable New Semantic Requests

Stop the server and restart it with the Canary-off command from section 1. Existing drafts remain in the database and continue to be viewable and editable.

## Current Limits

- Real Telegram delivery is not verified or enabled.
- Long-running operation and provider availability during a real trip are not verified.
- Same-day A to B to A representation remains limited.
- `recheck` and `unknown` are not verified facts.
- No eligible reminder means zero captured messages can be correct.
