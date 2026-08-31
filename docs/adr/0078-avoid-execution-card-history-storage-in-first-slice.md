# Avoid Execution Card history storage in first slice

The first Travel Execution Capability slice will not add a database table or durable history model for Execution Action Cards. Since Web will not show per-step execution records and card feedback remains scoped to the current interaction, Landi should reuse existing Telegram and execution state where possible and persist only the minimum state needed for current handoff or feedback behavior.

## Considered Options

- Add durable Execution Action Card history storage. This would support later review surfaces, but it adds persistence and privacy scope that the first slice does not need.
- Avoid card-history storage. This keeps the implementation aligned with Telegram-only execution and avoids storing unnecessary one-time context.
