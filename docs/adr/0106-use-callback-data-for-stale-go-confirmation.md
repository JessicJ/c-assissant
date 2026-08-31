# Use callback data for stale /go confirmation

Landi will implement "Yes, still go" for stale Next Planned Stops through Telegram callback data rather than free-text confirmation. The callback can carry the relevant Plan, version, stop, and confirmation intent, making the current execution confirmation explicit without adding card-history storage.

## Considered Options

- Accept a free-text "yes". This is easy, but ambiguous in an active chat.
- Use callback data. This keeps stale-stop confirmation scoped to the exact `/go` interaction.
