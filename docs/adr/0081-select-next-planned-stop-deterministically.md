# Select Next Planned Stop deterministically

Landi will choose the Next Planned Stop for `/go` through deterministic Next-stop Selection from the current Execution Plan, using current travel date, local time, scheduled stop times, and itinerary order. This keeps movement execution anchored to approved plan data and avoids turning `/go` into an Agent-driven navigation or destination-selection workflow.

## Considered Options

- Ask an Agent to decide where the traveler should go next. This could handle ambiguity, but it would make a current execution command dependent on interpretation rather than Plan structure.
- Let the traveler choose an ad hoc destination inside `/go`. This would increase flexibility, but it expands the command into free navigation.
- Select deterministically from the Execution Plan. This is predictable, testable, and aligned with the execution boundary.
