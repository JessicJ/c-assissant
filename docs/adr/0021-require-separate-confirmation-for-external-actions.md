# Require separate confirmation for External Actions

Approving an Execution Plan authorizes Landi's internal reminders, monitoring, and preparation workflow but does not authorize payments, bookings, application submission, or other External Actions. Each irreversible or third-party state change requires separate, current traveler confirmation because itinerary approval cannot safely stand in for transaction consent.

## Consequences

Plan Tasks may prepare or link to an External Action, but their completion and the external service result remain distinct states. Connectors cannot infer authorization from Plan status alone.
