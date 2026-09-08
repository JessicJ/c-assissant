# Landi Blueprint Workspace Completion Plan

Status: Execution plan requested and authorized by the user on 2026-09-08.
Scope: Complete the Landi-owned Blueprint generation and desktop workspace delivery described in `blueprint-workspace-generation-requirements.md`, subject to the user's later product decisions.

## Completion Boundary

This delivery is complete when Landi-owned generation produces a structured Blueprint, the importer preserves its valid content and evidence boundaries, the desktop workspace presents it, and confirmed edits persist and recover correctly. Completion requires deterministic checks and an isolated live generation acceptance run using the current implementation.

This is not completion of the long-term travel assistant roadmap. Monitoring, in-trip assistance, external booking execution, and new destination services are outside this delivery.

Existing user decisions remain binding:

- Keep the top-right edit bar unchanged.
- Stage edits across days and confirm them together. Confirmation applies ordinary edits directly, without a new Review Changes page or forced conversation screen.
- Preserve itinerary time labels during drag reorder; route checking must not silently reinterpret that interaction.
- Keep left-column place summaries focused on why the place is worth visiting.
- Keep the desktop workspace layout, English map, Google Maps/Leaflet fallback, type-icon markers, and pale-blue selection glow.
- Do not add image placeholders or standalone source icons to text-only itinerary cards.
- Images and image-source disclosure are optional enhancements, not blockers for this text-first delivery.
- Do not reopen earlier skipped work whose numbered description cannot be recovered. Record it as unresolved scope only if it becomes a dependency of an item below.

## Verified Starting Point

The 2026-09-08 audit found existing implementations for Blueprint contracts, importer normalization, versioned storage, deterministic compilation, linked-Blueprint Web reads, guide relationships, typed itinerary blocks, preparation, tips, sources, direct edit batches, assisted replanning, and automatic route refresh with partial success handling.

The audit ran 86 focused Web read-model, display, automatic-route-refresh, and route-line tests successfully. Web typecheck and `git diff --check` passed. These checks do not constitute current browser or live generation acceptance.

There were 14 modified tracked files and five untracked files at the audit checkpoint. Preserve and account for those existing changes; do not reset them or attribute all of them to this plan.

Confirmed gaps:

- Research and itinerary prompts still invoke `interactive-trip-planner`; research still requires Regional Source Pack rules.
- Generation identity and keys are tied to `interactive-trip-planner@0.2.0`.
- Itinerary block evidence survives the adapter but is omitted from aggregate Sources contexts.
- Standalone booking constraints are not exposed in the Web presentation adapter; direct revision guards need verification against those records, beyond place priority and action requirements.
- Local food, product, and experience themes are mainly reached through linked place details; useful records with no linked place need a browse path.
- Current documentation and live acceptance evidence lag behind recent implementations.

## Work Queue

Run A, then B, then C, then D. Implement dependent work as one coherent change rather than splitting individual fields or wording changes into separate development rounds. An item becomes complete only with recorded evidence.

| ID | Deliverable | Status | Completion Evidence |
| --- | --- | --- | --- |
| A1 | Landi-owned, versioned generation instructions and invocation | Implemented; deterministic checks passed | Adapter invocation tests verify embedded policy for research and itinerary and reject unsupported versions before execution. New generation lineage identifies `landi-trip-blueprint@1.0.0`. Live quality remains C2. |
| A2 | Capability-based source selection and generation quality rules | Implemented; deterministic checks passed | Native research receives capability/availability rules, authoritative verification boundaries, optional inspiration handling, and destination-specific content rules. Importer tests protect missing evidence and unverified movements. Actual researched-source quality remains C2. |
| A3 | Generation version transition and checkpoint compatibility | Implemented; deterministic checks passed | Fresh-service recovery tests preserve legacy and current policy, skip saved research, expose persisted status/events, retain place identities, and reuse a compiled plan on repeated generation. |
| B1 | Evidence and booking constraints through read and edit paths | Implemented; deterministic checks passed | Block evidence resolves in Sources and relevant details with deduplication; standalone hard bookings participate in applicable edit checks; broad city-level bookings do not block unrelated places. |
| B2 | Informational guide content coverage | Implemented; deterministic checks passed | Useful food/product/experience themes without concrete places render as read-only informational Explore/Detail topics and cannot be scheduled; linked themes keep their existing place relationships. |
| C1 | Deterministic integration and desktop browser acceptance | Implemented for current A/B scope | Focused browser acceptance passes for unlinked informational topics and standalone fixed booking constraints; existing browser matrix remains broader than this slice. |
| C2 | Isolated live generation acceptance | Implemented; live check passed | The live validation script now uses a real multi-day native Blueprint scenario, stronger assertions, stage logs, and an outer timeout. Sandbox runs fail explicitly on Codex state DB/app-server permissions. The authorized Lisbon live check passed with 15 places, 22 sources, 4 itinerary days, typed blocks for every day, guide catalog content, action requirements, deterministic Plan work, Web presentation, and preserved identities. |
| D1 | Documentation and change handoff | Implemented | CONTEXT, ADR 0171, and this execution plan describe the current behavior, policy boundary, acceptance evidence, and remaining roadmap scope. |

### A: Landi-owned Generation

Keep the existing recoverable research and itinerary stages, importer, compiler, and runtime adapter. Own the planning instructions and their version in the repository. Do not treat a renamed skill constant as sufficient implementation, or require an uninstalled named skill without ensuring the runtime can load it.

Primary files: `packages/agent-adapters/src/index.ts`, `apps/server/src/planning-generation-state.ts`, `apps/server/src/planning-generation.ts`, and the corresponding tests. Choose the smallest repository-native packaging after checking how the adapter passes instructions to the runtime. Do not repurpose the Country Pack skill registry unless its contract actually fits this generation path.

Preserve rich place value, typed days, scheduling eligibility, peer comparisons, guide relationships, relevant preparation, and destination-specific tips. Reuse existing source/provider capabilities. No new connector installation, service purchase, or global source infrastructure is required by this plan.

Generation quality tests must exercise structured outputs and normalization, not only assert that prompt wording contains a label. Keep historical lineage truthful, including old plans and in-progress checkpoints. Leave unrelated legacy generator retirement outside this change unless it is necessary for the active Blueprint path.

### B: Complete Existing Content Paths

Use the existing Blueprint records as authority. Resolve block evidence to source records, retain verification status, and avoid noisy provenance on default itinerary cards.

Inspect booking constraint identity and segment linkage before introducing new presentation fields. Distinguish an actual fixed booking from an outstanding reservation task. Ensure a booking cannot be bypassed merely because a place lacks a `booked` priority. Reuse current conflict and assisted-replanning behavior; any newly required user interaction must be identified before changing the product flow.

Represent informational catalog entries through the shared Explore/Detail experience without inventing concrete places, duplicating linked place records, or adding top-level modules. Only useful source-backed information should be shown.

Primary files: `packages/core/src/trip-blueprint.ts`, `packages/core/src/blueprint-revision.ts`, `packages/core/src/index.ts`, `apps/web/src/blueprint-presentation.ts`, `apps/web/src/landi-blueprint-workspace-display.ts`, `apps/web/src/LandiBlueprintWorkspace.tsx`, and focused tests.

### C: Acceptance Matrix

Use isolated fixtures and test storage. Do not replace the user's active plan or activate real external actions during acceptance.

| Scenario | Required Result |
| --- | --- |
| Generate a multi-day trip | Date coverage, concrete place references, guide relationships, relevant preparation/tips, and structured output survive import and compilation. |
| Read the current Blueprint | Current Blueprint content wins over stale embedded Plan presentation; explicit empty content remains authoritative. |
| Browse and select | Explore returns to its prior state; selecting an itinerary place opens the matching detail and highlights its map marker. |
| Edit multiple days | Drafts remain coherent, local undo/cancel works, and one confirmation applies the complete batch using current versions. |
| Reorder and restore order | Dragging works in both directions and preserves the agreed time-label behavior. |
| Fixed booking or conflicting change | Existing constraints are respected and a failed edit preserves the usable plan and recoverable draft. |
| Route provider partial/total failure | Successful route facts persist; unchecked legs are not represented as verified; saved itinerary edits are not lost. |
| Google map unavailable | Fallback loads, correct-day markers remain visible, and map language behavior is checked. Verify the Google-success path separately when a working key is available. |
| Stale version or repeated request | No silent overwrites, duplicate generation, duplicate revisions, or duplicate compiled work. |
| Reload or service restart | Saved Blueprint, generation checkpoints, and completed edits recover consistently. Treat unsaved draft persistence according to the established product behavior. |
| Evidence and informational entries | Missing evidence degrades locally; theme-only content remains visible but cannot be scheduled; source contexts resolve and deduplicate correctly. |

Run focused tests while implementing A/B, then the relevant package checks and browser suite once for acceptance. Use `scripts/validate-live-blueprint-generation.mjs` as an existing entry point where appropriate, extending it only to cover meaningful missing assertions.

A missing authenticated runtime, Google key, or provider availability may block a named live check. Record exactly what could and could not be tested; mocks or prompt inspection do not count as a live pass. Continue independent work without repeatedly retrying an unchanged external blocker.

### D: Close Out

Update `CONTEXT.md`, the affected ADRs, and stale sections in the requirements/repair documents as their corresponding behavior lands. Do not rewrite historical acceptance records as if they used the new generator.

Record each work-queue item's changed files, verification result, and remaining limitation. Organize changes into coherent review groups; creating commits or publishing changes follows the user's applicable Git instructions, not an automatic deployment step.

## Progress Reporting

Use the eight work-queue IDs as a stable checklist. The count describes remaining completion deliverables, not equal effort or a percentage of the whole project.

At each milestone report: completed IDs, verification performed, remaining IDs, and blockers that require external input. Do not create new top-level work merely to keep development going. Defects found in acceptance belong to the affected A/B/C item. A change to product scope must be stated explicitly.

### 2026-09-08: Milestone A

- Added `packages/agent-adapters/src/landi-blueprint-policy.ts`; the adapter embeds the policy in actual runtime prompts rather than relying on an installed named skill for new generations.
- Generation lookup now retains existing legacy keys for status, events, cancellation, and continuation; new proposals use the Landi identity. Unsupported versions fail before runtime execution. No historical record is relabeled.
- Native itinerary input includes scheduling eligibility and claim/source evidence; unavailable routing cannot become a fabricated verified duration.
- Updated the isolated live-generation script to use the same native lineage, but did not run it as part of this milestone.
- Passed 59 tests across Agent Adapter, Skill Importer, generation state, and generation service. Adapter and Server typechecks passed. Integration tests use isolated in-memory storage and mocked generation, not a live Agent or a physical service restart.
- Recorded the policy/continuation boundary in ADR 0171 and updated the affected CONTEXT definitions.

At the end of milestone A, A1-A3 were implemented with deterministic evidence while B1-B2/C1-C2/D1 remained pending. Live generation acceptance remained a required completion gate, not an implied result of milestone A.

### 2026-09-08: Milestone B and C1 Slice

- Exposed Blueprint `bookingConstraints` through the core and Web presentation adapters.
- Resolved day block evidence into aggregate Sources and the matching place Detail sources, preserving source deduplication and contexts.
- Added conservative standalone fixed-booking matching for direct Blueprint add/move/remove guards. Matching uses explicit place names/localized names or specific locations; broad city-level booking locations do not block unrelated places.
- Mirrored fixed-booking read behavior in the Web workspace so drag/remove affordances are disabled before the backend rejects them.
- Added read-only informational Explore/Detail topics for unlinked local food, local product, and experience theme records. These topic entries are display-only, do not enter `workspace.places`, and do not create map markers or route anchors.
- Upgraded `scripts/validate-live-blueprint-generation.mjs` from a one-day Lisbon check to a four-day Portugal native Blueprint acceptance script with stronger checks for lineage, typed blocks, sources, alternatives, guide catalog content, action requirements, compilation, and identity preservation.
- Passed 97 focused unit tests covering Web presentation, workspace display, and direct Blueprint revision behavior.
- Passed `pnpm --filter @c-assistant/core build`, `pnpm --filter @c-assistant/web build`, `node --check scripts/validate-live-blueprint-generation.mjs`, `git diff --check`, and a focused Playwright browser test for informational topics plus fixed booking constraints.
- Attempted C2 live validation. The first run failed because the sandbox could not write Codex runtime state. The elevated run started but returned no terminal output before it was interrupted to avoid leaving the task indefinitely blocked.

The current checkpoint is A1-A3, B1-B2, and the current C1 slice implemented with deterministic evidence. C2 live multi-day generation acceptance remains unresolved, and D1 final handoff remains open until that gate is resolved or explicitly waived.

### 2026-09-08: C2 Diagnostics Hardening

- Bounded Codex and Claude Code runtime health checks at 30 seconds each, so live validation cannot hang before entering generation.
- Added stage-level progress logging and `LANDI_LIVE_BLUEPRINT_TIMEOUT_MS` to `scripts/validate-live-blueprint-generation.mjs`.
- Re-ran the live script in the normal sandbox. It now fails quickly and explicitly because the sandbox cannot write `/Users/mable/.codex/state_5.sqlite` and cannot initialize the in-process app-server client.
- Ran an authorized elevated external-generation check with a 60-minute outer timeout. The Codex runtime started successfully, but the country-scope Portugal research stage hit the adapter research timeout before producing a structured batch.
- Narrowed the live acceptance scenario from country-scope Portugal to a single-city four-day Lisbon trip while keeping the same structural assertions for lineage, typed blocks, sources, alternatives, guide catalog content, action requirements, compilation, and identity preservation.
- Passed `node --check scripts/validate-live-blueprint-generation.mjs`, the 157-test focused A/B/C suite, `git diff --check`, and package builds for Core, Server, Web, and Agent Adapters.

The narrowed Lisbon live acceptance run passed after 744 seconds: 15 places, 9 deep places, 15 detailed places, 22 sources, 4 days, typed blocks on all 4 days, 6 movements, 6 action requirements, 3 local foods, 3 local products, 3 experience themes, 5 deterministic Plan stages, 4 Web presentation days, and preserved place identities.

At this checkpoint, A1-A3, B1-B2, C1, C2, and D1 are complete. The remaining items are broader roadmap scope outside this delivery, not blockers for the Landi Blueprint workspace completion plan.

### 2026-09-08: Final Handoff

- Passed the final 162-test focused A/B/C suite covering Agent Adapter policy, generation state, Skill Importer, Blueprint revision, Blueprint compiler, Web presentation, and Web workspace display.
- Passed `node --check scripts/validate-live-blueprint-generation.mjs` and `git diff --check`.
- Passed package builds for Core, Server, Web, and Agent Adapters. The Web build still reports the existing Vite chunk-size warning, but compilation succeeds.
- Completed D1 by recording the native generation policy, content read paths, C2 live acceptance result, and this delivery boundary.

### 2026-09-08: Post-Completion Workspace Load Hardening

- Kept `/api/workspace` as the only blocking initial Web load dependency. Plan history, configuration, and runtime checks now degrade quietly if they cannot refresh during startup.
- Added explicit workspace response validation so an HTTP success with missing `profile`, `runtime`, or `activePlan` is reported as incomplete workspace data.
- Preserved server diagnostics from `message` as well as `error`, so Fastify/Core startup failures no longer collapse into the generic workspace-data message.
- Converted `/api/workspace` network failures into a recoverable Core-service message instead of exposing the browser's raw fetch failure.
- Added a retry button on the initial workspace error screen for temporary service-startup failures.
- Added bounded automatic retry and visible retry status for initial workspace startup so the Web workspace can recover when Core becomes ready moments after the browser opens.
- Added `pnpm check:workspace` to diagnose local Web/Core/proxy/workspace startup mismatches without reading or changing travel data.
- Added API-client tests for diagnostic propagation, unreachable Core service handling, incomplete workspace payloads, and optional request degradation.
- Added browser coverage for current-plan rendering when auxiliary details fail, manual recovery after temporary or unreachable `/api/workspace` failures, automatic recovery after a short Core startup delay, and bounded retry exhaustion.
