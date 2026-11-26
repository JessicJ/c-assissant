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
- Raw Agent Diagnostic Artifacts expire after fourteen days and are deleted immediately with their generation record. Prompts, reasoning traces, and complete source bodies are not persisted.

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

## Generation rule follow-up — 2026-09-30

The New Zealand generation exposed two conflicting assumptions. A quality repair removed an unbooked Waiheke ferry option from 11 November, but the old guard required every previously scheduled place to remain on the same day. A Milford Sound coach-and-cruise day was then rejected because an ordinary sightseeing-day limit was applied to its explicit outbound drive, cruise, and return drive. Both failures prevented a corrected itinerary from reaching the traveler.

Rules now used by the itinerary generator and review:

- The Research Set is the complete place catalog; the scheduled route is a practical subset. An unbooked ferry, excursion, or other high-impact candidate is not a user commitment. A repair may move or remove a flexible stop on an affected overloaded or incoherent day. It must preserve the full date range, confirmed commitments, selected or confirmed lodging, and the trip's arrival and departure nodes.
- Assess a packaged excursion by total burden: outbound travel, on-site activity, return travel, and a practical buffer. Count an operator's all-in package duration once. A single demanding excursion can occupy a longer day when it returns to lodging and adds no unrelated major visit; a normal sightseeing day's capacity rule still applies to ordinary visits.
- Preserve the corrected Blueprint, supplemental research, and diagnostics across a failure or restart. On resume, complete any unfinished day-completion stage from saved checkpoints before proceeding to guide enrichment and compilation; do not repeat completed targeted research batches.
- Record both rejected and repaired itinerary artifacts when a repair fails so the next investigation can identify the actual change instead of inferring it from a place ID in the error message.

Verification: the affected long-trip proposal completed as a draft after these corrections. Focused regressions cover optional-stop removal, protected anchors, and long-excursion capacity.

### Publication gate added after the follow-up

- Review the entire saved itinerary after day completion, flight-origin completion, and accommodation anchoring. The gate checks route capacity and time order, unverified exact operator times, destination coverage, usable day content, useful proposed starts, overnight bases, hotel continuity, and flight departure nodes. Earlier stage checks still catch errors close to their source.
- Once destination research is saved, look up candidate photographs from its existing place identities and evidence pages while the itinerary is being composed and reviewed. This read-only work cannot change the route. After review, match candidates to the current planned places, including the exact branch, and check image availability and provenance before saving. Reuse a photograph across repeated stops at the same place. Send only unresolved places for bounded image research. Save successful batches against the current version. If suitable pictures are unavailable, the card keeps its full text layout.
- If the gate finds an issue, request up to two whole-trip corrections using the saved Research Set and the latest rejected itinerary. Re-import and review each corrected result before publishing. Preserve confirmed bookings, selected lodging, arrival and departure anchors, unaffected days, and the full date range. If both corrections fail, leave the generation failed with both artifacts and review findings in diagnostics; never publish a partially reviewed Draft Plan.
- Show a plain-language generation failure in the planning dialog while retaining technical details in diagnostics. A traveler can retry after correcting input without being asked to interpret internal place IDs or integrity exceptions.
- Run the long-trip regression, including excursion capacity, transport constraints, empty-day recovery, and hotel continuity, as part of the Server test suite.

### Independent long-trip acceptance — 2026-09-30

An isolated 12-day Japan rail trip (Tokyo, Kanazawa, Kyoto, Osaka/Kansai; no hotels booked) completed real Research Set generation and produced a Draft Plan in a separate SQLite database. Research took roughly eight minutes, itinerary composition roughly four minutes, day completion roughly four minutes, and supplemental Explore research roughly four minutes. The Draft contained 12 dates, 32 catalog places, and recommended overnight hotels. It also exposed defects that the first publication gate had missed: the confirmed Haneda arrival and Kansai departure existed only in prose, the last day incorrectly returned to the airport hotel after terminal transfer, and an Osaka market-to-airport-hotel movement was marked as a flight. A normal Tokyo sightseeing day remained under-planned after its first completion attempt.

The subsequent rule changes require traveler-confirmed dated airports to be formal arrival/departure route endpoints; request targeted official airport research when the catalog omitted them; remove a false departure-day hotel return; and normalize a flight movement whose endpoints are not two airports. Airport hotels must never satisfy an airport-node check merely because their names contain “Airport”. A remaining ordinary candidate-gap sightseeing day now reaches the bounded final correction instead of passing publication. The previously generated isolated Draft remains a diagnostic sample, not a corrected user plan. On read-only replay, the new gate found the two missing airports and invalid flight; a real targeted research call returned Haneda and Kansai airports, and adding those nodes cleared the gateway and transport findings. The separate under-planned-day finding still requires itinerary correction in a future full live run.

A second isolated full generation with the revised rules completed as Draft Plan `plan-129j8i5` in about 28 minutes. Its Research Set included both airports from the outset. The 12-day route starts at Haneda, ends at Kansai International Airport, carries the same recommended hotel across each overnight boundary, has no market-to-hotel flight leg, and passed the publication gate. Two Kyoto days received targeted research and a completion rewrite; one intercity rail day retains a non-blocking dependency gap because an actual service has not been chosen. Manual review then found a separate display-usefulness gap: hotel-origin transfers had no proposed leave time, even when the next activity had a time. A deterministic pass now sets a provisional hotel departure on every such day (using the first timed activity when available, 09:00 for otherwise untimed intercity transfers, and a conservative buffer before a traveler-provided outbound flight time). It never presents that time as a booked train or airport-arrival fact. The publication gate checks this, and read-only replay of the second Draft went from 11 missing hotel departures to zero findings; that replay does not alter the saved diagnostic Draft.

The isolated corpus runner disables the optional image-enrichment service and Semantic Shadow, so neither test Draft measures image coverage or Shadow behavior in the normal app. The production app wires image enrichment separately. The final read-only timing replay also passed the Core Blueprint integrity validator; a new full model run after the timing change has not been performed.

## Intake and live route follow-up — 2026-10-08

- A traveler who gives an origin, destination, dates, party, and an explicitly unbooked train or flight can reach a reviewable proposal without supplying an invented exact service, station, or departure time. The conversation asks only for unresolved decisions that matter before generation. Visa status remains unknown until supplied; it is not a first-run prerequisite.
- Confirmed exact arrival/departure railway stations receive the same route-endpoint protection as airports. A provisional terminal for an unbooked return remains provisional. On the last day, the route ends at that station or airport rather than returning to the hotel after the transfer. The false return movement is removed with the false lodging block.
- Blueprint-assisted conversation and map handoff now replan from the saved Research Set, preserve unedited days and booking constraints, review the new Blueprint, then compile a new Draft. Invalid replacements leave the current plan untouched.
- The isolated Shanghai–Hangzhou, 20–22 October 2026 end-to-end run saved a 10-place, 21-source Draft in 53 minutes 52 seconds. Read-only replay of its final day exposed a false return to the recommended hotel after the provisional Hangzhou East station. The new endpoint pass makes the final station the last route node; Core integrity and publication review then pass with zero findings. The original isolated Draft remains unchanged as a diagnostic sample.
- That run had zero sourced images for eight place-backed cards. All three image-search batches timed out after 90 seconds and were repeated once. A wholly failed image round now stops rather than repeating identical requests; the generation event records timeouts explicitly and the plan continues to publication with illustration fallbacks. A quick exact-title Wikipedia/Wikimedia lookup now precedes model search, requires a matching city for ambiguous names, skips branch-specific names, and verifies that the URL serves an image. The image probe allows only Wikimedia's fixed image hosts through the local network's synthetic DNS addresses; all other hosts retain the private-address guard. Read-only replay of the isolated Hangzhou data found and successfully probed a Hangzhou East Station image. This improves coverage but does **not** establish that every card will receive a photo; a new full generation is still needed for that acceptance check.
- Verification after these changes: full `pnpm test`, `pnpm build`, and `pnpm test:browser:ci` passed (42 browser tests passed, one skipped). The development backend uses `tsx watch` and the frontend Vite server remains available at the existing local ports.

## Failure recovery follow-up — 2026-10-04

The failure path saved the latest repaired itinerary as a diagnostic artifact, but the next run ignored that artifact and resumed from an older Blueprint. A quality repair that fixed one finding and exposed another could therefore restart the same expensive composition and fail repeatedly.

- On retry, import the latest saved itinerary artifact against the current Research Set and booking constraints. Resume from it only if structural integrity and the complete publication review both pass. Otherwise keep the previous saved Blueprint and continue the normal repair path.
- Save each structurally valid itinerary correction as a generation checkpoint even when a quality finding remains. Retry starts from the latest checked structure; compilation and traveler-visible Draft publication still wait for the full review to pass.
- Initial itinerary review, day completion review, and final whole-trip review each allow a second bounded correction when the first correction exposes another quality issue. Every result is re-imported and re-reviewed; invalid results never become Draft Plans.
- Unknown route times and unverified operator starts remain provisional. Do not pad a genuine intercity travel day with attractions solely to meet a numeric sightseeing threshold.
- A correction that still fails after the bounded attempts retains its exact diagnostics and checkpoints. Structural failures and unresolved confirmed commitments continue to block publication.

## 2026-10-08: shared publication review and evidence preservation

The current implementation replaces separate content-repair loops in initial composition and day completion with one shared publication gate and at most two correction attempts. Structurally valid checkpoints are retained; failed correction responses do not discard them. Day completion is reused by date/city signature, and independent content reviews are cached by canonical input for 14 days. Older descriptions of multiple independent content loops above are historical.

Research passed to composition now includes coordinates, accommodation state, operational facts, official/booking links and guide relationships. The importer no longer invents numeric driving durations from straight-line distance. Legacy generated estimates are removed on resume unless backed by evidence. Proposed hotel departures no longer look past an untimed excursion to derive a departure from a later meal.

Publication review now includes midday breaks, physical luggage-drop occurrences, formal airport/station nodes and an independent assessment of route/pacing/meeting points. Candidate cleanup affects day views, preserving the catalog. Photo probes distinguish inaccessible networks from missing files; exact English Wikipedia lookup supports Wikimedia upload URLs.

See `travel-plan-acceptance.md` for retained product rules, regression mapping and measured live acceptance limitations.


### Follow-up invariants from the fresh short-trip acceptance (2026-10-08)

- Physical route occurrences in ordered blocks govern movement adjacency. A hotel visited again for luggage or sleep remains a separate occurrence; a unique catalog of stops cannot substitute for that route.
- A generic request to recommend a station is not an assertion of a specific station name. Accept a researched local endpoint provisionally, while continuing to enforce explicitly named stations.
- Resume reconciles newer saved research into older Blueprint checkpoints before later integrity checks. Structurally valid diagnostic work goes through the shared publication correction gate.
- No fixed budget statements do not create flight-budget scope questions from unrelated date or party digits.
- Missing clock times do not acquire dayparts from rendered card indexes. Same-place detail context uses the formal visit rather than a destination-labelled transfer.
- Itinerary composition and independent content review use saved evidence with web search explicitly disabled; new evidence is gathered in dedicated research stages.
- Source-bound photo candidates with unknown network probes remain provisional; definite invalid results are rejected, and private-network fetch guards remain enforced.


### Bounded photo enrichment and generic station completion

Start read-only standard-source prefetch after the saved research checkpoint while itinerary composition and review continue. Resolve each place independently, with at most four reads in flight per set and one total deadline for that set. Keep completed candidates when another place times out or ignores cancellation; close only unresolved reads. Prefetch never writes a Blueprint. After review, consume candidates only for the current planned place IDs and matching entity/branch identities, then save against the latest research and Blueprint. A slow new lookup cannot discard an already completed candidate or cause MAH to search that covered place again.

MAH image research receives a compact image-only input: the exact place/branch identity, location and coordinates, official URL, that place's associated research-source URLs, rejected image URLs and output language. It excludes the full trip request, traveler profile, personality and itinerary-generation rules. Keep the full schema, frozen-request binding, result validator and independent verification; check and execute the validator rather than asking the producer to inspect its complete implementation. The production budget is fixed when the batch is created and is independent of the time already spent in standard lookup or earlier batches. The MAH transport owns queue and acceptance supervision. Existing requests retain their exact frozen inputs and limits; legacy prompts can resume only after exact recomputation against their original inputs.

Probe newly returned images with an independent bounded availability check after MAH production, even when the earlier lookup deadline has elapsed. Previously saved images with an unknown probe remain evidence-backed candidates, count as unresolved and may be searched again; they do not count as verified coverage. Never treat an unreachable probe as proof that an image loaded. Count verified card coverage by distinct scheduled place, including a browser decode check in live acceptance. Definite photo failures preserve the accepted route and normal card layout. Normal generation must not automatically reopen a photo task or create a new background phase for the same missing-image input. An explicitly requested photo retry requires a publicly verified terminal outcome matched to the old task UUID and frozen request SHA-256 before creating a new attempt; unresolved submission, execution, cancellation or result verification retains the original task identity.

A generic station request may reuse the local researched station already selected in the itinerary, or a unique local candidate. Specific traveler station names remain authoritative. Endpoint completion reconciles movement adjacency against physical occurrences while preserving applicable route evidence.
