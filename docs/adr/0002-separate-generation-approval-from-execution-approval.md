# Separate generation approval from execution approval

Landi uses two explicit traveler approvals: approving a Planning Proposal authorizes generation of a Trip Blueprint, while approving the complete Draft Plan authorizes execution. The Plan Compiler may convert a generated Trip Blueprint into a Draft Plan immediately, but reminders, monitoring, and other execution work remain inactive until the traveler approves that complete Plan.

## Consequences

Generating or regenerating travel content cannot silently begin execution. Interfaces and persisted lifecycle states must distinguish proposal approval, draft review, and execution approval. A Draft Plan may expose Dormant Reminders for review, but approval of the complete Plan is the earliest point at which they may become active. When a Replacement Draft exists, the previous Execution Plan continues unchanged until an Execution Switch atomically cancels its obsolete future work, moves the pointer, and activates eligible replacement work.
