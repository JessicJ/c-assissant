# Deduplicate generation by confirmed Planning Proposal

One exact confirmed Planning Proposal version authorizes one Blueprint Generation, identified by a stable Generation Key. Repeated generate actions observe or resume that operation instead of starting concurrent Skill calls, preventing duplicate research, conflicting results, and last-writer-wins progress.

## Consequences

Agent Run attempts may change during recovery, but they remain children of the same Generation Key. Only one attempt for a stage may be active, and successful stage checkpoints are reused across retries. Confirming a newer Planning Proposal supersedes the older Generation; a late result remains auditable under its original key but cannot publish or replace the current Draft Plan.
