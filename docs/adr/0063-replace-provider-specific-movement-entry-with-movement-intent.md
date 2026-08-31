# Replace provider-specific movement entry with Movement Intent

Landi's first movement execution entrypoint will be a provider-neutral Movement Intent Command rather than an Uber-specific command. The command asks how to get to the Next Planned Stop, then Landi resolves the suitable route facts, Local Transport Recommendation, and handoff form without exposing provider capability diagnostics to the traveler.

## Considered Options

- Keep `/uber` as the main movement entry. This reflects the current implementation, but it makes destinations without Uber look unsupported and conflicts with destination-neutral execution.
- Add a provider-neutral movement command. This aligns the user intent with the task, allowing Uber, Google Maps, Manual Handoffs, or other services to be chosen internally.
