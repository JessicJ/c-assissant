# Blueprint Generation Repair Plan

Status: Accepted — implementation authorized on 2026-08-26.

## Outcome

Landi turns a confirmed Planning Proposal into a persistent, complete Trip Blueprint through the versioned `interactive-trip-planner` Skill, deterministically compiles that Blueprint into a Draft Plan, and renders Blueprint travel content together with Plan execution work in the Web workspace. The traveler approves the complete Draft Plan before execution begins.

## Domain boundaries

- The Planning Proposal records the confirmed destination, time boundary, known constraints, and visible assumptions.
- Blueprint Generation consists of recoverable research and itinerary stages.
- A Research Set persists places, sources, and events before itinerary completion; broad trips use geographic Research Batches.
- The Trip Blueprint is the immutable, versioned source of truth for the complete Place Catalog, itinerary, Movement Plans, evidence, and Action Requirements.
- The Skill Importer converts supported Skill artifacts into Landi's versioned Blueprint Contract using Safe Normalization only.
- The Plan Compiler deterministically and without semantic changes produces Stages, Tasks, Dormant Reminders, and Compilation Lineage.
- The Plan Workspace reads travel content from the linked Blueprint and execution content from the Plan.
- Only approval of the complete Draft Plan performs an Execution Switch. External Actions still require separate current approval.

Canonical language is maintained in [`../CONTEXT.md`](../CONTEXT.md). Architectural decisions are recorded in [`adr/`](./adr/).

## Generation flow

```text
Planning conversation
  -> versioned Planning Proposal
  -> traveler approves generation direction
  -> one idempotent Blueprint Generation
      -> geographic Research Batches
      -> persisted Research Set
      -> itinerary stage referencing Research Set Place Identities
      -> Skill Importer
      -> published Trip Blueprint Version
  -> deterministic Plan Compiler
  -> Draft Plan plus Compilation Lineage
  -> Plan Workspace review
  -> traveler approves complete Plan
  -> atomic Execution Switch
```

## Non-negotiable invariants

- Every valid Research Set Place Identity remains traceable in the Trip Blueprint and Plan Workspace unless it is a Confirmed Duplicate.
- Candidate capacity, context limits, map availability, coordinate availability, or a universal place quota cannot remove a place.
- Every date in the confirmed range has an Itinerary Day; explicit transit, rest, and free-time days may contain no scheduled place.
- Adjacent scheduled places have a Movement Plan. Unverified modes, durations, routes, or geometry use an Evidence Status rather than invalidating the Blueprint.
- Itinerary references resolve to complete records in the Research Set.
- Evidence gaps, missing coordinates, and stale Time-sensitive Facts degrade locally and do not reject unrelated travel content.
- Only structural defects block Blueprint publication.
- The Plan Compiler does not delete places, reorder itineraries, rewrite advice, or call an Agent.
- A Compilation Key is idempotent and cannot duplicate Plans, Tasks, or Reminders.
- Skill Lineage, Blueprint schema version, and Compilation Lineage are durable and independently auditable.
- Exactly six Plan Stages is not a validity requirement.

## Recovery and progress

- Successful Research Batches and Research Sets survive later failure, timeout, cancellation, navigation, and service restart.
- Only Transient Failures receive one automatic Stage Retry.
- Structural output failures stop with exact validation paths and an explicit continuation action.
- The old whole-Plan AI repair call is removed.
- Generation Events persist and stream verifiable stage, geographic scope, saved counts, pending stages, and next action; no invented percentage is shown.
- Repeating Generate attaches to the same Generation Key. A newer confirmed Proposal supersedes the older Generation and prevents late publication.
- Raw Agent Diagnostic Artifacts expire after seven days and are deleted immediately with their generation record. Prompts, reasoning traces, and complete source bodies are not persisted.

## Product rules included in this repair

- `not_obtained` means the traveler has not obtained the relevant visa or travel permission; it is distinct from `unknown`.
- Visa and entry conclusions require Official Evidence and complete Applicability Inputs to be verified; missing personal inputs degrade only that conclusion.
- Time-sensitive facts retain verification time and may create dormant recheck work.
- Direct workspace edits create deterministic Blueprint Revisions; natural-language changes requiring judgment use Assisted Replanning.
- Map, filters, selected day, open details, and the open conversation window are route-scoped Workspace View State. Leaving Plan closes the conversation window but does not cancel server generation.
- Xiaohongshu import is not part of the generation path.

## Implementation sequence

1. Add the Blueprint Contract, validators, and fixed regression fixtures in Core.
2. Add persistence for Research Sets, Research Batches, Blueprint Versions, Skill and Compilation Lineage, Generation Events, and Diagnostic Artifact expiry.
3. Split Agent Adapter work into typed Skill-backed research and itinerary operations; add the Skill Importer.
4. Add the deterministic Plan Compiler, remove the six-Stage Agent requirement, and delete whole-Plan AI repair.
5. Add Server orchestration for idempotency, stage recovery, supersession, cancellation, status snapshots, and event streaming.
6. Change Web to render the linked Blueprint, show truthful progress and recovery, and keep conversation visibility route-scoped.
7. Reconstruct historical embedded `Plan.presentation` content as read-only Legacy Trip Blueprints and complete live end-to-end acceptance.

The first delivery reuses existing Country Pack, Reminder, execution, and Connector capabilities except for compatibility changes required by the new boundary.

## Acceptance

- A multi-turn intake creates no Plan before Proposal approval.
- One real `interactive-trip-planner` run completes research, itinerary, import, compilation, Web rendering, restart recovery, Draft Plan approval, and execution activation.
- Place Identity sets are compared across Research Set, Trip Blueprint persistence, and Web input; equal counts alone do not pass.
- A long multi-city fixture proves saved batch recovery after a later-stage failure.
- Missing source evidence, coordinates, or route verification remains visible with local recheck status and does not fail the complete Blueprint.
- Recoverable itinerary-reference defects are normalized locally: unknown candidate IDs are removed, invalid scheduled references are dropped, and missing or invalid adjacent movements become `recheck` Movement Plans. Only an itinerary that still has no usable days after normalization fails the stage.
- Repeated Generate and Compile commands do not duplicate work or records.
- A newer Proposal prevents a late older Generation from publishing.
- Existing Execution Plans continue while Replacement Drafts generate or await review.
- Switching from Plan to Plan History or Settings closes the conversation window while generation continues in the background.
- Service restart restores the same Generation Progress, saved checkpoints, Blueprint, and Draft Plan.
- No new generation can use the legacy monolithic generator, fixed six-Stage contract, or whole-Plan AI repair fallback.

## Implementation progress — 2026-08-26

- Complete: Blueprint Contract, integrity validators, Research Set and Blueprint persistence, Skill/Compiler lineage, Generation Events, expiring diagnostics, rich Skill Research Batch and itinerary adapters, local itinerary-reference degradation, safe Importer, deterministic Plan Compiler, Web planning-session orchestration, resumable checkpoints, explicit cancellation, status snapshots, SSE progress, and current Blueprint rendering. New Plan generation is isolated from every legacy one-shot generator and local-template fallback; Blueprint-backed revisions now fail closed until Assisted Replanning is available.
- Verified locally: Core, Agent Adapter, Storage, Server, and Web typechecks/builds; 134 Server tests, 36 Core tests, and 32 Agent Adapter tests pass after the itinerary-reference degradation fix.
- Live verification complete: Codex loaded `$interactive-trip-planner` and completed the isolated research-to-compilation acceptance with 19 places, 20 sources, one Itinerary Day, six Movement Plans, six Action Requirements, and five compiled Stages. All 19 Place Identities were preserved across Research Set and Trip Blueprint. The earlier missing-source edge case remains covered by Source Metadata Gap degradation.
- Remaining post-repair evolution: implement Assisted Replanning for Blueprint-backed Plans, reconstruct historical embedded presentations as read-only Legacy Trip Blueprints, and retire the generator still used only by lineage-free legacy Plan revisions.
