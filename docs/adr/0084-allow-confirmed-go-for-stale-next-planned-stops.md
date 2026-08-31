# Allow confirmed /go for stale Next Planned Stops

Landi will allow the traveler to continue `/go` for a stale Next Planned Stop after an explicit "Yes, still go" confirmation in Telegram. The confirmation applies only to the current movement interaction and does not change itinerary order, mark earlier stops complete, or mutate the Execution Plan.

## Considered Options

- Block stale stops completely. This is safe but too rigid when the traveler still intends to go.
- Route stale stops without confirmation. This is convenient but may act on outdated plan timing.
- Allow explicit current confirmation. This keeps traveler control while preserving Plan immutability.
