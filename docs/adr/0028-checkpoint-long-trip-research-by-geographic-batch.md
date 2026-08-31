# Checkpoint long-trip research by geographic batch

For multi-city or otherwise broad trips, Landi divides place and source discovery into recoverable Research Batches scoped to destination cities or meaningful geographic areas, then deterministically merges them into one Research Set. This bounds Agent context and allows later batches to fail without discarding earlier verified places.

## Consequences

Batch identity, status, and Skill Lineage are persisted under one Generation Key. Boundaries follow confirmed destination cities and traveler-meaningful geographic areas so progress can name real research scope; token and process budgets affect scheduling only. An adjacent Discovery Area may contribute Candidate Places, but cannot silently become a primary destination or consume substantial itinerary time. Merge logic follows the confirmed-duplicate rule and preserves all other valid places.
