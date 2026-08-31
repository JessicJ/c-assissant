# Only use untimed stops when the next target is unambiguous

Landi may produce a `/go` Movement Action Card for an untimed itinerary stop only when the current day's itinerary order yields one clear next target. When multiple untimed stops could plausibly be next, Landi should block or ask the traveler to review the Plan instead of guessing the destination.

## Considered Options

- Always use itinerary order for untimed stops. This is deterministic, but it can be wrong when the traveler has already done or skipped earlier flexible stops.
- Block every untimed stop. This is safe, but it makes flexible itineraries less useful.
- Allow only unambiguous untimed stops. This balances flexibility with execution safety.
