# Cut over Blueprint Generation without old-pipeline fallback

Landi releases the new Blueprint Generation pipeline behind an operational feature switch, but each traveler request runs through exactly one pipeline. A new-pipeline failure never falls back to the old monolithic Plan JSON and AI-repair flow, because such fallback would silently violate the agreed Blueprint, completeness, and lineage contracts.

## Consequences

Operations can disable new generation and Assisted Replanning while preserving viewing of existing conversations, checkpoints, Blueprints, and Plans. The interface reports generation as temporarily unavailable rather than invoking the old generator. Acceptance and rollback procedures test the new pipeline independently; the legacy path remains available only for historical reads during migration, not for new generation.
