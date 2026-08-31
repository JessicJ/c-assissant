# Make /go callbacks version-bound

Landi will make `/go` callbacks version-bound by validating Plan ID and Plan version against the current Execution Plan before applying stale-stop confirmation or Alternative Action Selection. If the Plan changed, the callback must not act on old context and should ask the traveler to send `/go` again.

## Considered Options

- Accept callbacks based only on stop ID or option ID. This is simpler, but old buttons could affect a newer Plan.
- Validate Plan identity and version. This follows Landi's existing approval and command safety pattern.
