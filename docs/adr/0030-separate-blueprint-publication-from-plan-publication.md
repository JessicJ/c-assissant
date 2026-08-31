# Separate Blueprint publication from Plan publication

Landi atomically publishes a structurally complete Trip Blueprint Version before attempting Plan compilation. Draft Plan creation and its Compilation Lineage are committed together in a separate atomic transaction, allowing compiler failures to preserve and reuse the Blueprint without exposing a partially created Plan.

## Consequences

Blueprint and compilation statuses are independently observable and retryable. A published Blueprint does not imply that a Draft Plan exists, while every published Draft Plan must resolve valid lineage to an already published Blueprint.
