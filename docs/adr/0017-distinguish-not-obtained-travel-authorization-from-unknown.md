# Distinguish not-obtained travel authorization from unknown

Landi represents a traveler who has not obtained the relevant visa or travel permission as `not_obtained`, distinct from `unknown` when the traveler cannot state their status. The former explicitly triggers destination-entry research and suitable Action Requirements; the ambiguous label “To be confirmed” is removed because it cannot safely drive planning behavior.

## Consequences

Profile migration, intake controls, prompts, and Country Pack policy inputs must preserve this distinction. User-facing labels describe the actual state rather than an internal follow-up action.
