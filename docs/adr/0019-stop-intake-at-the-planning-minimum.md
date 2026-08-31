# Stop intake at the Planning Minimum

The planning Agent distinguishes Blocking Unknowns from optional information that can be represented by visible Planning Assumptions. It continues asking questions only until the destination and time boundary are known, then offers a versioned Planning Proposal that exposes remaining assumptions for approval instead of trying to complete every preference field.

## Consequences

Conversational intake remains bounded and cannot silently invent constraints. Proposal approval authorizes its explicit assumptions, while later corrections create a new proposal or Blueprint Revision according to the current lifecycle stage.
