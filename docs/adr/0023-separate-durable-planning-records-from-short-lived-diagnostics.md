# Separate durable planning records from short-lived diagnostics

Landi durably retains normalized Research Sets, Trip Blueprints, Compilation Lineage, and structured validation reports, while treating an unparsed raw Agent response as a short-lived Diagnostic Artifact. Prompts, reasoning traces, and complete fetched webpage bodies are not persisted, balancing reproducible contract debugging with traveler privacy and bounded data retention.

## Consequences

Diagnostic storage has an explicit access boundary and a default seven-day expiry. Deleting the related generation record removes its Diagnostic Artifacts immediately, while expiration or deletion cannot remove a resumable normalized checkpoint or make an existing Plan unauditable.
