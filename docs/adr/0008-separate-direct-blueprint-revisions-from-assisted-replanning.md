# Separate direct Blueprint revisions from assisted replanning

Landi applies precise workspace operations such as priority, day-assignment, and ordering changes as deterministic Direct Blueprint Revisions. It invokes the travel-planning Skill only for Assisted Replanning requests that require judgment, preventing simple edits from incurring Agent latency or introducing unrelated itinerary changes.

## Consequences

Every revision still creates a Trip Blueprint Version, but its provenance identifies whether the change was deterministic or Skill-assisted. Direct revision tests can assert an exact change set, while assisted replanning must demonstrate preservation of unaffected content.
