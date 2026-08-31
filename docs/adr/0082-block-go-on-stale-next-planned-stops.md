# Block /go on stale Next Planned Stops

Landi will not blindly produce a Movement Action Card for a Next Planned Stop whose planned time is more than 60 minutes in the past. A stop within the past 60 minutes may produce a degraded card, but a more stale stop should block or ask the traveler to confirm or review the Plan; Landi must not automatically skip to a later stop because that would silently change execution order.

## Considered Options

- Always route to the selected next stop. This is simple, but it can push the traveler toward an obviously stale plan.
- Automatically skip stale stops. This is convenient, but it silently changes the approved itinerary order.
- Block or ask for confirmation after a staleness threshold. This keeps `/go` useful while preserving traveler control.
