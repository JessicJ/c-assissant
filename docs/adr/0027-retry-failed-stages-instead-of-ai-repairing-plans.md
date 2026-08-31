# Retry failed generation stages instead of AI-repairing complete Plans

Landi removes the Agent step that receives and rewrites an entire rejected Plan. Recovery creates a Stage Retry for only the failed research or itinerary stage from its latest valid upstream checkpoint, because full-output repair combines unrelated responsibilities, increases context size, and can silently lose otherwise valid travel content.

## Consequences

Importer and compiler validation never invoke an Agent. A Stage Retry produces a separate attempt and Diagnostic Artifact under the same Generation Key while preserving already accepted checkpoints unchanged. Landi automatically retries a Transient Failure at most once. Recoverable itinerary-reference defects from the Agent output, such as unknown candidate IDs, non-adjacent route segments, or missing adjacent movements, are normalized locally into recheck state before Blueprint validation; structural validation failures stop only when the normalized itinerary still cannot produce usable days or known scheduled places.
