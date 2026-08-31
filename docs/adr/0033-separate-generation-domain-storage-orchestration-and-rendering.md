# Separate generation, domain, storage, orchestration, and rendering responsibilities

Landi assigns the Blueprint Contract, validation, Skill Importer, and Plan Compiler to Core; durable Research Sets, Blueprints, lineage, and Generation Events to Storage; Skill process invocation and stage-artifact retrieval to Agent Adapters; lifecycle, idempotency, retry, cancellation, and progress streaming to Server; and proposal confirmation, truthful progress, Blueprint travel rendering, and Plan execution review to Web. Agent Adapters no longer own Plan construction or AI repair.

## Consequences

Dependencies point from orchestration toward explicit domain contracts rather than through one broad runtime method. Each boundary has independent fixtures and failure codes, and Web view models cannot become persistence contracts.
