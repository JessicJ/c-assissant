# Compile only structured Action Requirements

The Plan Compiler creates Tasks and Reminders only from structured Action Requirements with an accountable party and a completion condition or relevant execution time. It does not convert place descriptions, route advice, or general cautions into execution work, preserving the boundary between a rich Trip Blueprint and an actionable Plan.

## Consequences

Travel-planning and Country Pack inputs may propose actionable needs, but they must express them explicitly rather than relying on prose extraction during compilation. The Plan Compiler deterministically decides whether each proposal remains information, becomes a traveler or assistant Task, or receives a schedulable Reminder. Informational content remains visible in the Plan Workspace without inflating task lists.
