# Record Skill lineage on planning artifacts

Every Research Set and Trip Blueprint Version records the identity and version of the `interactive-trip-planner` Skill that produced it. Skill upgrades affect only future Blueprint Generation or Assisted Replanning operations and cannot silently reinterpret an existing immutable Blueprint.

## Consequences

Generation diagnostics can distinguish Skill behavior changes from source-data and compiler changes. The Generation Key includes the selected Skill version so a run under a different Skill version is not mistaken for an idempotent retry of the same operation. If that version is unavailable, Landi reports a Skill Availability Failure and does not silently substitute generic Agent generation.
