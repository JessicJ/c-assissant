# Record Plan compilation lineage

Every Draft Plan records the identity and version of its source Trip Blueprint and the version of the Plan Compiler that produced it. This separates travel-content changes from compiler behavior changes and makes completeness failures attributable to the Skill, persistence boundary, compiler, or renderer.

## Consequences

Plan history and diagnostics can resolve the exact immutable Blueprint input. The Blueprint identity and version together with the Plan Compiler version form a stable Compilation Key: retrying the same key returns the same Draft Plan result and cannot duplicate Plans, Tasks, or Reminders. A different Blueprint or Compiler version creates a different auditable compilation result.
