# Legacy Conversational Workspace Plan

> Project record. This file preserves the implementation plan used to replace one-turn generation with Planning Sessions and an interactive Plan workspace. Most of that work is now represented in code. Current product behavior is defined by `landi-product-baseline.md`, and the complete flow is defined by `travel-planning-and-execution-flow.md`.

## Status

This document defines the approved direction for replacing Landi's current one-turn Plan generation and card-only Plan presentation with a conversational planning flow and an embedded interactive Plan workspace.

The later [Landi Product Baseline](landi-product-baseline.md) narrows and supersedes product-surface decisions in this document where they conflict, especially the Web/Telegram responsibility boundary, the generation-critical fact gate, one-active-Plan rule, and travel-only V1 scope.

The interaction model is informed by the successful `interactive-trip-planner` run, but Landi does not embed that Skill, its Xiaohongshu integration, or its standalone HTML output. Landi adopts the useful planning and interaction contracts as native product capabilities.

## Product outcome

Landi should let a user:

1. describe an initially incomplete objective in ordinary conversation;
2. answer only the questions that materially change the Plan;
3. review and adjust a high-level planning proposal before expensive research begins;
4. explicitly approve that direction;
5. receive a complete, source-backed Plan inside the Web workspace;
6. explore and modify itinerary days, places, priorities, and order without editing files;
7. ask Landi to replan from those changes without copying text into another conversation; and
8. retain Landi's existing version confirmation, Tasks, Reminders, Sources, and execution semantics.

Success is not an HTML file. Success is a versioned Plan whose structured data is rendered and edited by Landi.

## Scope

### Adopt from the reference Skill

- Contextual intake instead of a fixed questionnaire.
- At most one to three groups of route-shaping questions per turn.
- A proposal checkpoint before detailed research.
- Explicit planning theme, segments, daily skeleton, tradeoffs, accommodation logic, and unresolved decisions.
- Separate discovery, fact verification, itinerary composition, presentation, user adjustment, and replanning phases.
- Place detail, day navigation, filters, priority changes, add/remove, same-day reordering, undo, and impact summaries.
- Honest route boundaries: do not display inferred straight lines as verified routes.
- Source-backed facts, checked dates, and visible recheck requirements.
- Local replanning: preserve unaffected Plan work when one day or choice changes.

### Remove

- Xiaohongshu onboarding, URL handling, account-risk flow, importer, library, fields, scripts, and tests.
- REDSkill release packaging.
- Generation of a standalone itinerary HTML file.
- Browser `localStorage` as the authoritative Plan state.
- The Europe-specific template and sample-data coupling.
- Copying a natural-language change request back into Codex as the main replanning bridge.

### Preserve from Landi

- Plan identity, versions, draft review, activation, and replacement-draft semantics.
- The distinction between `activePlan` and an older `executionPlan`.
- Stage, Task, ownership, completion, Reminder, and Inbox behavior.
- Profile versus Plan-scoped information boundaries.
- Source snapshots and exact evidence provenance.
- Agent runtime adapters and Country Pack composition.
- Conflict protection when the Plan changes during an Agent run.

## Current behavior that must change

The Web already contains a chat-style `PlanComposer`, but each `/api/agent/chat` request currently calls `generatePlanDraft` and persists a new or revised complete Plan. The UI is conversational while the backend remains one-turn generation.

The target behavior is:

```text
message
  -> update Planning Session facts
  -> choose the next high-value response
  -> ask, summarize, or prepare a proposal
  -> do not create a Plan yet
  -> user confirms proposal
  -> perform research and generate one complete draft Plan
```

Subsequent Plan edits use a separate replan path and produce a replacement Plan version rather than returning to initial intake.

## End-to-end experience

### 1. Start a Planning Session

Selecting **Create Plan** opens a full conversational surface. No long form is shown and no Plan is created from the first message.

The first message can be incomplete, for example:

> I want to spend about a week in Paris in October with my parents. We like art and architecture.

Landi extracts stated facts, records unresolved fields, gives one useful initial judgment, and asks only the information that most changes the Plan. Existing Profile facts may be used according to the normal context priority but must not be presented as newly supplied Plan facts.

### 2. Build understanding over several turns

Each turn merges facts into the Planning Session. It must not repeatedly ask for information already supplied. The response can include quick replies, but the conversation remains the primary input.

Examples of high-value unknowns include:

- dates or duration;
- arrival/departure constraints;
- party and mobility needs;
- purpose and desired experience;
- first or repeat visit when that changes the balance;
- fixed bookings or non-negotiable items;
- accommodation state; and
- a preference that materially changes route, cost, or execution.

Bed type, individual meal budgets, and other dependent details are deferred until a relevant option appears.

### 3. Present a planning proposal

When enough information exists to define the Plan skeleton, Landi creates a proposal, not a Plan. The proposal contains:

- objective and planning theme;
- major Plan segments;
- a provisional day or phase skeleton;
- major inclusions and exclusions;
- accommodation or base-location logic when relevant;
- execution principles;
- visible assumptions;
- two to five unresolved decisions that could still change the skeleton; and
- the declared research and automation scope.

The user can:

- **Confirm direction and generate the complete Plan**;
- **Continue adjusting**; or
- **Request a different direction**.

Only the first action starts the complete generation run.

### 4. Generate the complete Plan

After explicit confirmation, Landi runs the relevant research, Country Pack, Skill, route, source, and compilation work. The Web shows product-level progress, not raw model reasoning:

- Understanding the destination and constraints
- Checking current facts and official sources
- Selecting places and alternatives
- Arranging the itinerary and dependencies
- Preparing the interactive workspace
- Validating the result

Generation produces structured data. A failed optional provider degrades the relevant section and records a limitation; it must not result in invented facts or routes.

### 5. Review the Plan workspace

The complete draft opens in the current Plan page. Before activation, the user reviews the exact version and its automation scope, preserving Landi's existing confirmation contract.

### 6. Modify and replan

Low-impact edits can be saved immediately as user choices:

- priority change;
- adding an ordinary candidate to a compatible day;
- removing an ordinary stop; and
- reordering ordinary stops within one day.

High-impact edits require an impact preview:

- changing accommodation or base location;
- moving a fixed booking;
- removing a required or must-do item;
- moving between cities;
- exceeding day capacity;
- changing Plan dates or party constraints; and
- changing activated reminder scope.

Current implementation: Web revision messages first call a version-bound impact-preview endpoint. Deterministic high-impact matches display the concrete affected reasons and require explicit confirmation. The revision endpoint independently enforces the same confirmation before invoking the Agent, so bypassing the Web preview cannot silently start high-impact replanning. Confirmation permits generation of a replacement draft only; it does not activate that draft or interrupt an older execution Plan.

Each generated replacement now also writes an immutable, version-bound replacement audit. It records the source and replacement Plan references, affected areas, facts that need revalidation (routes, time estimates, official sources, reminders, or accommodation options), and the exact completed Tasks carried into the replacement. The Web workspace shows this handover before Plan confirmation. It does not claim that a textual route or estimate has been revalidated merely because the Agent rewrote it.

User edits create a structured `PlanChangeSet`. They do not silently claim that routes remain valid. Affected days and segments become `needs_replan` until Landi validates and compiles a replacement draft.

## Web information architecture

### Before a Plan exists

The main content is the conversation. It includes:

- assistant and user messages;
- contextual quick replies;
- a compact “what Landi understands” summary;
- proposal cards;
- generation progress; and
- a clear exit that preserves the Planning Session.

### After generation

Desktop layout:

```text
+----------------------------------------------------------------+
| Plan title | dates | status | version | Continue with Landi    |
+--------------------------------------+-------------------------+
|                                      | Day/phase route list    |
| Interactive map or primary canvas    | Stops and candidates    |
|                                      | Selected place detail   |
+--------------------------------------+-------------------------+
| Day/phase navigation | filters | change impact | replan action |
+----------------------------------------------------------------+
```

The conversation becomes a persistent right-side drawer. On mobile, **Plan** and **Conversation** are top-level tabs.

The Plan workspace provides these views:

1. **Plan** — map/canvas, day or phase navigation, route list, candidates, and detail.
2. **Preparation** — actionable pre-departure Tasks and reservations.
3. **Decisions** — confirmed and unresolved choices with reasons.
4. **Reminders** — proposed and active automation.
5. **Sources** — evidence, retrieval date, scope, and freshness warnings.

For itinerary-shaped Plans, the map is the primary canvas. For non-spatial or long-horizon Plans, the primary canvas is a phase timeline; the same conversation, decision, source, change, and version contracts still apply. A map is never fabricated merely to fill the layout.

## Conversation behavior

### Conversation modes

Replace the current two-mode model with explicit states:

```text
collecting
proposal_ready
proposal_confirmed
generating
draft_ready
revising
failed
abandoned
```

`collecting`, `proposal_ready`, and `proposal_confirmed` belong to a Planning Session, not a persisted Plan. `draft_ready` begins after a Plan has been generated and saved.

### Turn decision

For each intake turn, the Agent must choose exactly one primary action:

- acknowledge and ask the next route-shaping question;
- summarize and ask the user to correct understanding;
- present a planning proposal;
- revise the current proposal; or
- explain why generation cannot safely proceed.

It must not generate the final Plan during `collecting` or `proposal_ready`.

### Context contract

Each turn receives:

- current Planning Session facts and provenance;
- unresolved and deferred fields;
- the current proposal when one exists;
- relevant Profile fields allowed by policy;
- prior user decisions; and
- the recent conversation required to interpret the new message.

The runtime should return structured output plus user-facing text. The server validates and merges structured output; model prose is never the authoritative session state.

## Core data model additions

### Planning Session

```ts
type PlanningSessionStatus =
  | "collecting"
  | "proposal_ready"
  | "proposal_confirmed"
  | "generating"
  | "draft_ready"
  | "failed"
  | "abandoned";

interface PlanningSession {
  id: string;
  status: PlanningSessionStatus;
  objectiveType: "travel" | "relocation" | "event" | "other";
  facts: PlanningFact[];
  unresolved: PlanningUnknown[];
  deferred: PlanningUnknown[];
  proposal?: PlanningProposal;
  outputPlanId?: string;
  createdAt: string;
  updatedAt: string;
}
```

Each `PlanningFact` records value, scope, source (`user`, `profile`, or `inferred`), confirmation status, and last-updated time. An inference cannot become a confirmed user input without confirmation.

### Planning proposal

```ts
interface PlanningProposal {
  version: number;
  objective: string;
  theme: string;
  segments: PlanningSegment[];
  skeleton: PlanningSkeletonItem[];
  tradeoffs: string[];
  baseLogic?: string;
  assumptions: string[];
  decisionPoints: PlanningDecisionPoint[];
  researchScope: string[];
}
```

Proposal confirmation binds to the exact Planning Session ID and proposal version.

### Plan presentation data

Extend `Plan` with an optional structured presentation aggregate rather than encoding places as Tasks:

```ts
interface PlanPresentation {
  kind: "itinerary" | "timeline";
  summary: string;
  days?: ItineraryDay[];
  places?: Place[];
  events?: PlanEvent[];
  routeSegments?: RouteSegment[];
  decisions: PlanDecision[];
  changeSet?: PlanChangeSet;
}
```

`Stage` and `Task` remain the execution model. `PlanPresentation` is the exploration and editing model. The two reference stable IDs rather than duplicating user decisions in prose.

Current implementation: schema version 11 persists the optional aggregate directly on each Plan. Runtime-generated drafts must return either an itinerary presentation with internally consistent place/day/segment references, or a non-spatial timeline presentation with empty spatial collections. Existing and host-created Plans may omit it and continue using the phase timeline. The Web workspace renders day navigation, ordered stops, route verification state, a selectable place list, and embedded place detail. Because Agent output cannot establish trusted coordinates, unverified movements are shown as dashed schematic order rather than road geometry; each place retains an explicit Google Maps user handoff.

### Place

At minimum:

```ts
interface Place {
  id: string;
  name: string;
  localizedName?: string;
  locationLabel: string;
  coordinates?: [number, number];
  category: string;
  priority: "must" | "preferred" | "nearby" | "archive" | "recheck" | "booked";
  contentTier: "deep" | "standard" | "compact";
  whyWorthIt: string;
  plan: string;
  tip?: string;
  detailSections: Array<{ title: string; body: string }>;
  sourceRefs: string[];
}
```

### Route segment

A formal route segment requires an origin, destination, mode, reviewed duration or schedule, evidence, checked date, and verified geometry when drawn as a road/transit route. Without verified geometry, the UI shows ordered stops and an explicit unverified-movement state, not a road line.

### Change set

```ts
interface PlanChangeSet {
  basePlanId: string;
  baseVersion: number;
  changes: PlanChange[];
  affectedDayIds: string[];
  affectedTaskIds: string[];
  riskFlags: string[];
  status: "clean" | "needs_replan" | "replanning" | "resolved";
}
```

Every change is structured and can also be rendered into natural language for the conversation and audit view.

## API design

### Planning Sessions

```text
POST   /api/agent/chat                         mode=new_plan
POST   /api/planning-sessions/:id/confirm
DELETE /api/planning-sessions/:id
GET    /api/workspace                         includes the current Planning Session
```

`/api/agent/chat` returns:

- assistant message;
- validated session snapshot;
- optional quick replies;
- optional proposal;
- next allowed actions.

It does not return a Plan during intake.

`confirm` is bound to the latest proposal version, records explicit user approval, and then performs complete Plan generation. Repeating confirmation for a completed Session reuses its output Plan; an older proposal version is rejected.

### Plan interaction

```text
POST /api/plans/:id/change-impact
POST /api/plans/:id/changes
POST /api/plans/:id/changes/:changeId/undo
POST /api/plans/:id/presentation/routes/:segmentId/refresh
```

Every write carries the expected Plan version. Stale writes return a conflict and the client refreshes before retrying.

### Progress

Use a bounded job-status endpoint or Server-Sent Events for generation and replanning progress. Progress events expose stage, status, and user-facing detail only; raw prompts, chain-of-thought, provider credentials, and source bodies remain private.

## Agent and runtime contracts

Split the current broad `generatePlanDraft` responsibility into three contracts:

1. `respondToPlanningTurn` — extract and merge facts, choose the next conversational action, optionally produce a proposal.
2. `generatePlanFromProposal` — perform full research and return a complete structured draft bound to the confirmed proposal.
3. `replanFromChangeSet` — update affected presentation data, Tasks, Sources, and Reminders while preserving unaffected confirmed work.

The second and third contracts may call Country Packs and supporting Skills. The first should remain fast and should not perform full destination research unless a lightweight fact is necessary to avoid an invalid proposal.

## Rendering strategy

Do not embed the reference HTML with an iframe. Extract its behavior into Landi components and reducers:

- `PlanWorkspace`
- `PlanMap`
- `PlanDayNavigation`
- `PlanRouteList`
- `PlanCandidateList`
- `PlaceDetailDrawer`
- `PlanFilters`
- `PlanChangeSummary`
- `ReplanAction`
- `PlanningConversationDrawer`

Map state that is purely presentational can remain client-local. User choices, Plan changes, selected priorities, assignments, order, and undoable domain changes are persisted through the server.

## Implementation phases

### Phase 1 — Planning Session foundation

- Add Planning Session types and storage.
- Add version-bound proposal types.
- Introduce `respondToPlanningTurn` in runtime adapters.
- Add Planning Session APIs.
- Change `PlanComposer` so intake messages do not generate Plans.
- Add proposal card and confirmation actions.
- Preserve the existing intake form code only until the new flow passes tests, then remove it.

Acceptance:

- A three-turn conversation creates no Plan before proposal confirmation.
- Previously supplied information is not asked again.
- The latest proposal can be revised and only its latest version can be confirmed.
- Refreshing the browser restores the server-backed Planning Session.

### Phase 2 — Structured generation

- Add `generatePlanFromProposal`.
- Bind generation to the confirmed proposal version.
- Add generation progress.
- Extend Plan with optional `PlanPresentation`.
- Validate places, days, sources, and route boundaries before persistence.

Acceptance:

- Confirming a proposal produces exactly one complete draft Plan.
- Retrying the same generation request does not create duplicate Plans.
- A Plan can be generated with partial sources while clearly showing limitations.
- No unsupported route is rendered as verified.

### Phase 3 — Embedded Plan workspace

- Build the React Plan workspace and map.
- Port day navigation, place detail, filters, priority, add/remove, same-day reorder, undo, and refresh recovery.
- Integrate preparation, decisions, reminders, and sources as workspace views.
- Remove standalone HTML output from the product path.

Current implementation: itinerary-shaped Plans now bypass the legacy command-center and Stage-card presentation and render the Skill-native result contract directly inside Landi. The React surface includes Leaflet/OpenStreetMap, all-trip/day/detail navigation, filters, route-versus-sequence distinction, ordered stops, adjacent movement status, candidates, priority/day edits, undo, browser refresh recovery, and a revision request prefilled into Landi's own conversation drawer. The native result remains structured Plan data in SQLite; no iframe, generated guide HTML, or Xiaohongshu path is used.

Acceptance:

- The generated Plan is usable without downloading or opening another file.
- Desktop and mobile support the full Plan/conversation loop.
- All domain changes survive refresh and another browser session.
- Source detail and recheck state remain attached to the relevant content.

### Phase 4 — Change impact and replanning

- Persist version-bound `PlanChangeSet` records.
- Distinguish low- and high-impact changes.
- Invalidate affected route segments and estimates.
- Add `replanFromChangeSet` and replacement-draft review.
- Preserve completed Tasks and unaffected Plan sections.

Current status: impact classification, explicit confirmation, replacement-draft review, execution continuity, completed-Task carry-forward, and persisted replacement audits are implemented. Route and estimate invalidation is represented as explicit revalidation scope because the current Plan model does not persist independent route-segment entities; adding segment-level cache invalidation remains tied to the future structured map model.

Structured route-segment entities are now persisted for newly generated presentations, including explicit `verified`, `needs_verification`, and `stale` states. The next increment can therefore invalidate and refresh individual segments instead of treating routes only as prose.

Current route refresh: the Web route card can refresh one `walking`, `transit`, or `driving` segment. The server binds the request to the current Plan version, resolves both referenced Places through Google Places, requests exactly one Google Routes fact, and conditionally saves only that segment plus the two resolved coordinates. Success records the observed time, distance, optional duration, and `google_maps` provenance. Connector failure, unsupported rail/flight modes, missing Places, or a concurrent Plan edit leave the presentation unchanged. A refresh never opens navigation or starts a transport action.

Acceptance:

- A place reorder marks only affected movement segments for review.
- High-impact changes require an impact confirmation.
- Replanning creates a reviewable replacement version.
- An older active Plan continues executing until the replacement is confirmed.

### Phase 5 — Remove legacy paths and harden

- Remove the old form-first new-Plan path. **Completed:** Web creation now accepts natural-language turns only, the obsolete structured-intake parser and direct Web generation endpoints have been removed, and proposal confirmation is the only Web generation boundary.
- Remove heuristic presentation based on Stage-title regular expressions where explicit presentation types now exist. **Completed for current Plans:** Web renders timeline content only from explicit `presentationKind: itinerary`; title inference remains solely at the legacy normalization boundary.
- Remove any Xiaohongshu and standalone-HTML code accidentally carried into Landi. **Audit complete:** neither exists in the product path; the only HTML entry is the embedded Web application's normal build shell.
- Add browser tests for intake, proposal, generation, modification, undo, refresh, replan, conflict, and mobile layout. **Implemented:** CI Chromium coverage includes first-use setup, removal of the old questionnaire, the single visible proposal, V1→V2 proposal modification, continuation after closing the dialog, mobile overflow, the embedded itinerary result, real-map initialization, date/detail navigation, candidate changes, and the prefilled Landi replanning handoff. Deterministic integration tests cover latest-version conflicts, generation idempotency, change impact, undo, replacement continuity, and route refresh.
- Add unseen-scenario evaluations for planning quality, not only schema conformance. **Initial coverage added:** varied tourism, fixed-event, and long-stay requests must resolve the three planning facts and produce bounded proposals; proposal edits must preserve facts and increment the proposal version.

Acceptance:

- There is one supported new-Plan flow. **Met for Web:** conversation → versioned proposal → explicit confirmation → complete Plan generation.
- Current Plan presentation uses explicit types rather than title matching.
- No core experience relies on copying a request to an external conversation.
- Product tests cover both an itinerary Plan and a non-map timeline Plan.

## File-level implementation map

Likely changes:

- `packages/core/src/index.ts` — Planning Session, proposal, presentation, place, route, and change types.
- `packages/storage/src/index.ts` — Planning Session and Plan presentation persistence, version-bound changes, undo state.
- `packages/agent-adapters/src/index.ts` — three runtime contracts and structured result validation.
- `apps/server/src/web-agent.ts` — replace immediate generation semantics with intake-turn semantics.
- `apps/server/src/index.ts` — Planning Session, generation, progress, change, and replan endpoints.
- `apps/web/src/App.tsx` — split the current monolith into conversation and Plan workspace components.
- `apps/web/src/styles.css` — embedded workspace, map/list split, drawer, proposal, and progress states.
- `docs/core-data-model.md` and `docs/web-workspace.md` — update after implementation decisions are accepted.

New modules should be preferred over further expansion of `App.tsx` and `index.ts`.

## Testing strategy

### Contract tests

- Planning facts and provenance merge correctly.
- Confirmed user facts are not downgraded to assumptions.
- Proposal confirmation is session- and version-bound.
- Generation is idempotent.
- Plan changes reject stale versions.
- Route validation rejects unsupported geometry and transit claims.
- Source references resolve to retained evidence.

### Conversation tests

- Sparse initial request.
- User supplies several facts in one answer.
- User corrects an earlier fact.
- User skips a non-critical question.
- User changes proposal direction.
- Agent does not repeat answered questions.
- Agent does not generate a Plan before confirmation.

### Browser tests

- Create Session, converse, review proposal, confirm, and generate.
- Navigate map and days/phases.
- Open the same place from marker, list, and search.
- Add, remove, reorder, undo, and refresh.
- Confirm a high-impact change.
- Replan and review a replacement draft.
- Handle stale Plan conflict.
- Use Plan and conversation on mobile.

### Quality evaluations

Schema validation is insufficient. Maintain scenario evaluations for:

- relevance to user preferences;
- explicit tradeoffs;
- route feasibility;
- source correctness and freshness;
- reasonable task and candidate volume;
- consistency across repeated runs; and
- preservation of unaffected work after revision.

## Product acceptance boundary

The first acceptable vertical slice is one complete Web flow:

```text
conversation
-> proposal
-> explicit confirmation
-> structured Plan generation
-> embedded itinerary workspace
-> one persisted place/order change
-> Landi replan
-> replacement draft confirmation
```

It does not require every visual enhancement from the reference Skill. It does require the complete state and data loop. A polished map without server-backed conversation, change, version, and replan semantics does not satisfy this design.
