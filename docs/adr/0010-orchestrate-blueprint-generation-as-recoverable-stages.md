# Orchestrate Blueprint generation as recoverable stages

Landi presents Blueprint Generation as one traveler-visible operation but orchestrates it as separate Skill-backed research and itinerary stages. The research stage persists a Research Set, and the itinerary stage consumes that checkpoint, allowing accurate progress reporting and stage-specific retries without treating the Skill as one opaque long-running call.

## Consequences

Each stage has its own typed input, output, status, and retry policy. A stage timeout does not invalidate earlier checkpoints, and the Plan Compiler runs only after both stages produce a complete Trip Blueprint. The itinerary stage references places by stable identities from its Research Set; any newly required place must be added there as a complete record before the itinerary can use it.
