# Limit try-another-option to the existing action set

Landi will implement "try another option" as Alternative Action Selection within the same Execution Action Card's Recommended Action Set. It may switch the displayed primary option and handoff details, but it must not call an Agent, add an ad hoc destination, mutate the itinerary, or start Blueprint Revision or Assisted Replanning.

## Considered Options

- Treat "try another option" as a replanning request. This could produce richer alternatives, but it turns lightweight execution feedback into a plan-change workflow.
- Keep it inside the existing action set. This makes the feedback immediate and preserves the boundary between execution assistance and itinerary revision.
