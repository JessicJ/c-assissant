# Landi Travel Planning

This context describes the language Landi uses to turn a traveler's intent into researched trip content and, after review, an executable travel plan.

## Language

**Planning Proposal**:
A versioned summary of the travel direction and known constraints that the traveler may approve to authorize full Trip Blueprint generation. Approval authorizes generation, not real-world execution.
_Avoid_: Trip Blueprint, draft Plan, final Plan

**Planning Minimum**:
The smallest confirmed travel boundary that can authorize Blueprint Generation: a destination and either an exact date range or an explicit time window with trip duration.
_Avoid_: Complete traveler profile, all preferences answered

**Blocking Unknown**:
Missing information without which Landi cannot form the Planning Minimum or would generate a Trip Blueprint for the wrong trip boundary. The Agent continues intake until it is resolved.
_Avoid_: Optional preference, evidence gap

**Planning Assumption**:
An explicit provisional choice used when non-blocking information is unavailable. It is visible in the Planning Proposal and becomes authorized for generation only when the traveler approves that proposal.
_Avoid_: Hidden default, verified fact

**Booking Evidence**:
Traveler-provided or imported proof of a real travel commitment, such as a hotel stay, flight, train, rental car, ticket, tour, event, or restaurant reservation. It is collected during the Planning Session before generation and may later be linked to a Plan for execution.
_Avoid_: Post-plan note, generic booking task

**Out-of-Scope Booking Evidence**:
Booking Evidence that has been imported into a Planning Session but does not match the current Planning Minimum, date window, destination, or traveler-confirmed trip boundary. It remains visible but does not produce Booking Constraints for the current Blueprint Generation unless the traveler includes it.
_Avoid_: Deleted evidence, conflicting constraint, hidden attachment

**Booking Constraint**:
A structured planning constraint derived from Booking Evidence and used by the Planning Proposal and Blueprint Generation. Confirmed fixed commitments are hard constraints; pending or incomplete commitments remain soft constraints until reviewed.
_Avoid_: Planning Assumption, reminder, reservation card

**Blueprint Booking Constraint**:
A privacy-minimized Booking Constraint recorded in a Trip Blueprint to explain itinerary structure. It preserves the time, location, role, and constraint strength needed for travel meaning without carrying protected attachment content.
_Avoid_: Plan booking, raw confirmation, execution reminder

**Plan-linked Booking**:
A booking record attached to a Draft Plan or Execution Plan for execution reference, reminders, handoffs, protected attachments, and user review. It may contain execution details that do not belong in the Trip Blueprint, such as confirmation codes, supplier links, notes, and attachment metadata.
_Avoid_: Trip Blueprint constraint, itinerary structure, Planning Assumption

**Downgraded Booking Constraint**:
A Booking Constraint that the traveler explicitly keeps as evidence but prevents from controlling Blueprint Generation as a hard commitment. It remains visible in the Planning Proposal as ignored or informational context.
_Avoid_: Deleted booking, hidden assumption, resolved conflict

**Booking Segment**:
One time-bound part of a travel booking that may independently constrain the itinerary, such as an outbound flight, return flight, train leg, hotel stay period, rental-car pickup, or rental-car return. One Booking Evidence item may produce multiple Booking Segments.
_Avoid_: Separate email, separate trip, generic task

**Transport Availability**:
A time-bound transport resource available to the traveler, such as a rental car, rail pass, or booked transfer. It may influence itinerary generation during its valid window without replacing the Plan's overall transport preference.
_Avoid_: Global transport preference, route segment, vehicle booking

**Lodging Anchor**:
A date-bounded accommodation base used to shape itinerary starts, returns, luggage assumptions, and route checks. It applies only to the stay period confirmed or accepted from Booking Evidence.
_Avoid_: Global trip base, hotel note, generic place

**Proposed Booking Constraint**:
A parsed field or inferred commitment from Booking Evidence that has not yet been accepted as a Booking Constraint. It may be shown in an import preview but does not shape Blueprint Generation as a hard constraint.
_Avoid_: Confirmed field, hard constraint, Planning Assumption

**Booking Import**:
A traveler-initiated intake of booking evidence from pasted confirmation text or uploaded reservation email content. It produces a reviewable preview before any imported fact becomes a Booking Constraint.
_Avoid_: Mailbox sync, automatic email scan, confirmed booking

**Supplemental Booking Import**:
A Booking Import performed after a Trip Blueprint, Draft Plan, or Execution Plan already exists. It adds or updates Plan-linked Booking details and may trigger a Blueprint Revision when accepted constraints change itinerary structure.
_Avoid_: Planning Session intake, silent Plan mutation, post-plan note

**Protected Booking Attachment**:
The retained original booking file or email content associated with Booking Evidence. It may support audit and re-extraction, but it is not ordinary Plan text, Trip Blueprint content, logs, or Agent context.
_Avoid_: Source excerpt, Plan note, generation prompt

**Research Set**:
A recoverable generation checkpoint containing discovered places, sources, and relevant events before a day-by-day itinerary has been completed. It can resume Blueprint generation but is not itself a Trip Blueprint.
_Avoid_: Partial Plan, Trip Blueprint, failed output

**Research Batch**:
A recoverable portion of one Research Set scoped to a confirmed destination city or traveler-meaningful geographic area. Batches merge without reducing their valid, distinct Place Catalog entries.
_Avoid_: Separate trip, candidate quota, pagination page

**Discovery Area**:
An adjacent city or excursion area discovered during research whose places may remain Candidate Places without becoming a confirmed primary destination or consuming substantial itinerary time.
_Avoid_: Confirmed destination, silent scope expansion

**Blueprint Generation**:
One traveler-visible operation that Landi orchestrates through recoverable research and itinerary stages. A retry resumes the failed stage from its latest valid checkpoint.
_Avoid_: Single Agent call, Plan compilation

**Generation Progress**:
The truthful stage and checkpoint summary of Blueprint Generation, including active geographic scope, retained research counts, pending stages, and the next resumable action. It never presents a model-estimated percentage and is not a partial Trip Blueprint or reviewable Plan.
_Avoid_: Draft Plan, generated percentage without a checkpoint

**Generation Event**:
A persisted, traveler-safe change in Generation Progress that can be replayed after navigation or disconnection. It contains stage and checkpoint facts, not prompts or Agent reasoning.
_Avoid_: Process log, transient UI message

**Generation Cancellation**:
An explicit traveler request to stop active Blueprint Generation work without deleting successful checkpoints. Navigation, closing a conversation, or losing a browser connection is not cancellation.
_Avoid_: Page leave, Superseded Generation, Transient Failure

**Generation Failure**:
A stage-specific interruption that records the failed stage, exact validation issues, retained checkpoints, and the next resumable action. It does not erase successful earlier work.
_Avoid_: Generic Plan failure, discarded run

**Stage Retry**:
A new attempt of only the failed Blueprint Generation stage using the same valid upstream checkpoint. It cannot rewrite an accepted Research Set or act as an AI repair of a complete Plan.
_Avoid_: Plan repair, full regeneration, new Generation

**Transient Failure**:
A stage interruption likely to succeed unchanged on a prompt retry, such as a temporary process or network failure. It permits one automatic Stage Retry.
_Avoid_: Structural Defect, evidence gap

**Diagnostic Artifact**:
A short-lived raw Agent response retained only to reproduce parsing or contract failures. It is separate from durable normalized checkpoints and excludes prompts, reasoning traces, and complete fetched source bodies.
_Avoid_: Research Set, audit history, application log

**Generation Key**:
The stable identity of Blueprint Generation authorized by one exact Planning Proposal version. Repeated generation requests attach to or resume the same operation rather than starting concurrent work.
_Avoid_: Run ID, retry ID, Compilation Key

**Superseded Generation**:
A Blueprint Generation whose Planning Proposal is no longer the traveler's current confirmed direction. Its checkpoints remain attributable to the old proposal but its result cannot become the current Draft Plan.
_Avoid_: Failed generation, cancelled retry

**Trip Blueprint**:
A complete, non-executable and versioned body of researched travel content containing places, sources, events, and a day-by-day itinerary. It is retained as the source from which Draft Plans can be compiled again without repeating research, and contains no execution tasks or reminders.
_Avoid_: Plan draft, Skill Plan, itinerary Plan

**Trip Blueprint Version**:
An immutable revision of a Trip Blueprint produced by one completed generation or replanning operation. Compiling or displaying it does not create a new version.
_Avoid_: Plan version, generation attempt

**Blueprint Publication**:
The atomic transition that makes a structurally complete Trip Blueprint Version available for compilation. It occurs before and independently from Draft Plan creation.
_Avoid_: Plan publication, partial checkpoint

**Legacy Trip Blueprint**:
A read-only Trip Blueprint reconstructed from historical travel content embedded in a Plan. It preserves viewing and provenance but must be revised into a current Trip Blueprint Version before new planning changes are applied.
_Avoid_: Current Blueprint, deleted historical Plan

**Blueprint Revision**:
A traveler-requested change to the Place Catalog or day-by-day itinerary that produces a new Trip Blueprint Version before a replacement Draft Plan is compiled.
_Avoid_: Direct Plan edit, display preference

**Direct Blueprint Revision**:
A precise traveler edit whose complete effect is already known, such as changing a place priority, day assignment, or order. Landi applies it deterministically without asking the Skill to reinterpret the trip.
_Avoid_: Replanning request, direct Plan edit

**Assisted Replanning**:
A Blueprint Revision expressed as an outcome or preference that requires travel-planning judgment. The Skill produces the resulting Trip Blueprint Version while preserving unaffected content.
_Avoid_: Direct edit, Plan repair

**Evidence Status**:
The confidence attached to a place or planning fact, distinguishing verified content from content that the traveler or Landi must recheck. Missing verification does not by itself make a Trip Blueprint structurally invalid.
_Avoid_: Blueprint validity, source count

**Official Evidence**:
Evidence published by the government, embassy, consulate, immigration authority, or other competent authority for the relevant travel rule. Only Official Evidence can support a verified visa or entry conclusion.
_Avoid_: Popular travel advice, search-result summary

**Applicability Inputs**:
Traveler facts needed to decide whether a rule applies personally, such as passport-issuing country, residence, destination, and travel date. Missing inputs keep the conclusion in a recheck state but do not block unrelated Trip Blueprint content.
_Avoid_: Planning Assumption, inferred nationality

**Time-sensitive Fact**:
A planning fact whose reliability can change before it is used, such as opening hours, fares, schedules, entry rules, or event dates. It retains its verification time and may move to a recheck state without removing the related travel content.
_Avoid_: Permanent fact, invalid place

**Structural Defect**:
A broken relationship that makes a Trip Blueprint internally unusable, such as an itinerary referencing a place that the Blueprint does not contain. Structural defects block compilation; evidence gaps do not.
_Avoid_: Unverified fact, low source coverage

**Place Coverage**:
A quality assessment of whether a Trip Blueprint offers enough relevant options for its destination, duration, and traveler constraints. It is contextual guidance, not a universal minimum place count or a validity condition.
_Avoid_: Candidate quota, minimum POI gate

**Place Completeness**:
The traceability of every valid Place Identity from its accepted Research Set through Trip Blueprint persistence and Plan Workspace rendering. Equal counts alone do not establish completeness.
_Avoid_: Place count, coverage score

**Place Catalog**:
The complete set of valid, distinct places retained in a Trip Blueprint, including both scheduled and candidate places. A place is not removed merely because it does not fit into the day-by-day itinerary.
_Avoid_: Scheduled stops, map viewport results

**Place Identity**:
The stable identifier of one Place Catalog entry, used by itinerary stops and candidates. An itinerary may reference an identity only after the corresponding complete place record belongs to its Research Set.
_Avoid_: Place name, list position

**Map Eligibility**:
The ability to place a Place Catalog entry on the interactive map using sufficiently reliable coordinates. A place without Map Eligibility remains available in written content and carries a recheck status.
_Avoid_: Place validity, candidate validity

**Candidate Place**:
A Place Catalog entry that is not currently scheduled in the day-by-day itinerary but remains available for discovery, substitution, or replanning.
_Avoid_: Rejected place, unused place

**Confirmed Duplicate**:
Two place records proven to represent the same real place through a shared stable external identity, official place identity, or traveler-confirmed alias relationship. Only Confirmed Duplicates may be merged automatically.
_Avoid_: Similar name, nearby place

**Possible Duplicate**:
Two distinct retained place records whose names or coordinates suggest that they may represent the same place but lack identity proof. They remain separate until resolved.
_Avoid_: Confirmed Duplicate, invalid place

**Itinerary Day**:
The Trip Blueprint's explicit account of one calendar day in the travel date range. It may schedule places or intentionally represent transit, rest, or unstructured free time.
_Avoid_: Mandatory sightseeing day, Plan Stage

**Movement Plan**:
The intended movement between two adjacent scheduled places on an Itinerary Day. Its existence is structural; its mode, duration, route, and evidence each carry an Evidence Status and may require rechecking.
_Avoid_: Verified route, map geometry

**Plan**:
A reviewable and executable Landi commitment compiled from an approved Trip Blueprint, with the stages, tasks, reminders, and lifecycle state required for execution.
_Avoid_: Trip Blueprint, guide, itinerary

**Draft Plan**:
A Plan compiled from a Trip Blueprint and presented for traveler review. It has no authority to trigger reminders, monitoring, or other execution work.
_Avoid_: Planning Proposal, active Plan

**Plan Workspace**:
The review surface that combines travel content read from a Plan's linked Trip Blueprint with execution work read from the Plan. It does not own a separate copy of either.
_Avoid_: Plan presentation copy, standalone map guide

**Workspace View State**:
Ephemeral, route-scoped choices controlling how a Plan Workspace is viewed, such as map viewport, filters, search text, selected day, open place detail, or whether its planning conversation is open. They are cleared or hidden when leaving the Plan route and do not change travel meaning or create a Trip Blueprint Version.
_Avoid_: Blueprint Revision, traveler preference

**Execution Plan**:
The traveler-approved Plan that currently authorizes reminders, monitoring, and other execution work.
_Avoid_: Draft Plan, active draft

**Replacement Draft**:
A Draft Plan proposed to supersede an existing Execution Plan. It remains isolated from execution until traveler approval atomically replaces the execution pointer.
_Avoid_: Execution Plan update, active replacement

**Execution Switch**:
The atomic approval transition that replaces the current Execution Plan, cancels obsolete future work from the previous Plan, and activates eligible work in the replacement.
_Avoid_: Draft publication, gradual reminder migration

**Stage**:
A grouping of related execution Tasks within a Plan, present only when the trip has corresponding work or responsibility. Stage count and titles are not part of Trip Blueprint completeness.
_Avoid_: Trip Blueprint section, mandatory module

**Action Requirement**:
A structured need proposed by travel-planning expertise or a Country Pack that has an accountable party and a completion condition or relevant execution time. It is eligible for deterministic classification and compilation into a Plan Task or Reminder; descriptive travel advice is not.
_Avoid_: Tip, place description, general caution

**Requirement Identity**:
The stable identity of one Action Requirement across Blueprint Versions while its meaning and completion condition remain unchanged. It allows completed work to carry into a Replacement Draft without relying on title matching.
_Avoid_: Task ID, task title

**Dormant Reminder**:
A Reminder visible in a Draft Plan that describes future recheck or notification work but cannot run until the traveler approves that Plan for execution.
_Avoid_: Scheduled notification, active monitoring

**External Action**:
An operation that spends money, creates a booking, submits personal information, or otherwise changes state in another service. It requires separate confirmation at the time of action even when related to an approved Execution Plan.
_Avoid_: Plan approval, Reminder execution

**Travel Execution Capability**:
A destination-neutral Landi capability that helps a traveler act on an approved trip through current guidance, rechecks, reminders, local-option selection, and External Action handoffs without completing the external action for them.
_Avoid_: Regional Pack, destination demo, booking service

**On-trip Execution Assistance**:
The first slice of Travel Execution Capability focused on what the traveler should do while already executing the trip, such as moving to the next stop, finding nearby food, reacting to weather, choosing a local transport option, or opening an External Action handoff.
_Avoid_: Pre-departure preparation, destination guide, entry checklist

**Execution Action Card**:
A concise traveler-facing unit that turns one on-trip need into a recommended action, a short rationale, the relevant current facts, and any safe handoff or copyable details needed to continue. It hides internal provider capability resolution while preserving explicit user responsibility for External Actions.
_Avoid_: Provider diagnostic, integration status card, completed action

**Execution Card Feedback**:
A traveler response to an Execution Action Card that affects only the current execution moment, such as saying they have not arrived, asking to try another option, or opening the Plan for context. It does not by itself revise the Trip Blueprint or mutate the Execution Plan.
_Avoid_: Plan revision, provider confirmation, automatic replanning

**Session-scoped Execution Preference**:
A temporary preference expressed through an Execution Action Card or current execution interaction. It may affect the current card but is not saved to the long-term Profile or Plan preference without explicit separate confirmation.
_Avoid_: Learned preference, Profile update, implicit personalization

**Alternative Action Selection**:
An Execution Card Feedback path that switches the card's primary recommendation to another option already present in the same Recommended Action Set. It does not call an Agent, add a new destination, change the itinerary, or start replanning.
_Avoid_: Assisted Replanning, free search, new recommendation generation

**Explicit Execution Intent**:
A traveler message or command that clearly names one on-trip need, such as moving to the next stop, finding nearby food, or checking weather impact. The first Travel Execution Capability slice does not infer a broad "what should I do now" intent across multiple card types.
_Avoid_: Ambiguous next-best-action, automatic intent switching, hidden workflow selection

**Movement Action Card**:
An Execution Action Card for getting from the traveler's current or planned origin to the next trip stop. It may recommend a Local Transport Option and include route, departure timing, and External Action handoff details.
_Avoid_: Full-day route plan, provider dispatch, booking confirmation

**Movement Intent Command**:
A provider-neutral Explicit Execution Intent that asks Landi how to get to the Next Planned Stop. It replaces provider-specific transport test commands as the traveler-facing movement entrypoint.
_Avoid_: Uber command, provider test, free navigation command

**/go**:
The first Movement Intent Command. It asks Landi to produce a Movement Action Card for the Next Planned Stop using a One-time Location Share when current position is required.
_Avoid_: /uber, /next, /move

**Execution-only Command**:
A command that may act only against the current Execution Plan and cannot run from an unapproved Draft Plan. It may offer on-trip guidance or handoffs but cannot treat draft content as execution authority.
_Avoid_: Draft preview command, planning command, proposal action

**Read-only Execution Command**:
A command that can assist the current moment without changing a Plan or treating draft content as execution authority, such as nearby food discovery or weather lookup. It may use Plan context when available but does not require an Execution Plan unless its result depends on an approved itinerary stop.
_Avoid_: Execution-only command, Plan mutation, external action completion

**Next Planned Stop**:
The next itinerary stop in the current Execution Plan that Landi selects as the destination for a Movement Action Card. It excludes ad hoc, traveler-named places that are not part of the approved plan.
_Avoid_: Free navigation destination, search result, candidate place by default

**Next-stop Selection**:
The deterministic process that chooses the Next Planned Stop from the current Execution Plan using the travel date, local time, scheduled stop times, and itinerary order. It is not an Agent judgment or traveler-selected ad hoc destination.
_Avoid_: AI route choice, free navigation, candidate selection

**Nearby Food Action Card**:
An Execution Action Card for choosing food near the traveler's current shared location or current itinerary area. It presents candidate places and safe map handoffs without ordering, reserving, paying, or claiming table availability.
_Avoid_: Restaurant booking, food delivery order, destination food guide

**Generic Nearby Food Assistance**:
A destination-neutral food execution capability that uses a One-time Location Share and connected place facts to present Ephemeral Nearby Choices. It is independent of Country Packs and does not modify the Trip Blueprint or Plan.
_Avoid_: Country Pack food skill, local cuisine guide, restaurant transaction

**/food**:
The food command that returns a Nearby Food Action Card when enough Plan or current-area context exists and otherwise degrades to a one-time nearby food search from the traveler's shared location.
_Avoid_: Country Pack food command, food delivery command, Plan revision command

**Ephemeral Nearby Choice**:
A temporary option discovered for the current on-trip moment, such as a nearby restaurant found from a One-time Location Share. It helps the traveler act now but does not become a Trip Blueprint place, itinerary stop, or Plan change unless a later explicit revision accepts it.
_Avoid_: Candidate Place, Next Planned Stop, implicit Plan change

**Weather Impact Action Card**:
An Execution Action Card for interpreting current or near-term weather against the active trip context. It recommends a practical response without silently replanning the Trip Blueprint or Execution Plan.
_Avoid_: Automatic replanning, long-range climate guide, weather-only report

**Weather Lookup**:
A read-only report of current or near-term weather facts for the relevant Plan or location. It is not the same as a Weather Impact Action Card because it does not interpret the weather against a current itinerary action.
_Avoid_: Weather impact, execution adjustment, replanning trigger

**/weather**:
The weather command that returns a Weather Impact Action Card when enough Plan or current-action context exists and otherwise degrades to Weather Lookup.
_Avoid_: /impact, automatic replanning command, weather-only command

**Execution Adjustment**:
A temporary recommendation that changes how the traveler should act now without changing the approved Trip Blueprint or Execution Plan. A real itinerary replacement still requires the ordinary Blueprint Revision or Plan replacement flow.
_Avoid_: Automatic replanning, silent Plan mutation, replacement draft

**Execution Channel**:
The surface through which Landi delivers and receives on-trip execution assistance. For the first Travel Execution Capability slice, Telegram is the Execution Channel while Web keeps its existing planning, Plan display, and configuration role without new execution surfaces.
_Avoid_: Planning surface, provider app, channel-neutral requirement

**One-time Location Share**:
A traveler-initiated location disclosure used for one current Execution Action Card and then discarded from execution context. It is not continuous tracking, arrival detection, or long-term Profile data.
_Avoid_: Background location, trip tracking, saved home base

**Local Transport Recommendation**:
A traveler-facing recommendation of the most suitable local transport option for a current movement, using available context such as route facts, distance, time of day, weather, luggage, party size, and traveler preference. It is advice and handoff preparation, not proof of live provider availability or fare.
_Avoid_: Ride booking, fare quote, provider dispatch

**Recommended Action Set**:
The ranked traveler-facing options inside an Execution Action Card, consisting of one primary recommendation and one or more alternatives when useful. It explains why the primary action fits the current context and why alternatives are secondary.
_Avoid_: Single provider button, unordered option list, hidden ranking

**Recommendation Context**:
The bounded facts Landi may use to rank an Execution Action Card's options in the first Travel Execution Capability slice: distance, estimated duration, weather, day or night timing, luggage, party size, and traveler preference.
_Avoid_: Live fare, live provider supply, legal eligibility proof, local rules engine

**Conservative Execution Default**:
A visible fallback assumption Landi uses when a non-blocking Recommendation Context fact is missing. It allows an Execution Action Card to remain useful while avoiding riskier recommendations such as motorbike travel with unknown luggage or weather.
_Avoid_: Hidden default, blocking unknown, fabricated fact

**Degraded Action Card**:
An Execution Action Card that still gives a safe next step even though one or more non-blocking facts or provider capabilities are missing. It names the practical limitation only when the traveler needs it to act responsibly.
_Avoid_: Failed workflow, complete provider result, guessed recommendation

**Blocking Execution Gap**:
A missing fact or capability that prevents Landi from producing the requested Execution Action Card at all, such as no current Execution Plan, no Next Planned Stop for movement, no One-time Location Share when current location is required, or an unresolvable movement endpoint.
_Avoid_: Evidence gap, conservative default, provider enhancement

**Non-blocking Execution Gap**:
A missing fact or capability that lowers confidence or removes an enhancement but still permits a Degraded Action Card, such as missing luggage, party size, weather, route duration, or prefill support.
_Avoid_: Blocking unknown, workflow failure, fabricated fact

**Local Transport Option**:
A traveler-understandable way to complete a current movement, such as walking, ride-hail car, ride-hail motorbike, private driver, or scooter rental. It may be informed by a generic route mode but is not the same thing as a provider route fact.
_Avoid_: Route mode, provider API mode, booking product

**Rider-confirmed Transport Option**:
A Local Transport Option that Landi may consider only after the traveler has explicitly said they can and intend to use it or already have access to it, such as scooter rental. It remains subject to safety, weather, luggage, and legal recheck prompts.
_Avoid_: Default recommendation, inferred skill, generic driving option

**Route Mode**:
The provider-supported movement category used to obtain route facts, such as walking, driving, or transit. It is factual routing input, not the full traveler-facing local transport choice.
_Avoid_: Local Transport Option, mobility recommendation

**External Action Handoff**:
The act of preparing a traveler to continue in another service through a link, app-opening instruction, or copyable pickup and destination details. Landi has not completed the external action when the handoff is offered.
_Avoid_: Booking, order, payment, dispatch

**Prefill-capable Handoff**:
An External Action Handoff whose target service can reliably receive route or order-start details through an available, supported, and locally applicable integration. It is optional and must degrade to manual handoff when the destination lacks a suitable provider.
_Avoid_: Required handoff, booking API, guaranteed app state

**Manual Handoff**:
An External Action Handoff that gives the traveler enough information to continue in another service without relying on prefilled provider state, usually by opening a general app or web entry point and providing copyable pickup and destination details.
_Avoid_: Failed integration, completed action, provider confirmation

**Copy Handoff**:
A Manual Handoff that exposes pickup or destination details in a copyable form for the traveler to paste into another service. In Telegram, long-press-copyable message text is sufficient for the first slice even if the button itself cannot write to the clipboard.
_Avoid_: One-click clipboard guarantee, provider prefill, completed external action

**Service Capability Resolution**:
An internal Landi decision step that determines which available services can support the current execution need and whether each handoff can be prefilled or must be manual. It shapes the chosen action but is not exposed to the traveler as a diagnostic checklist.
_Avoid_: User-facing provider audit, visible integration status, regional capability

**Execution Service Catalog**:
The configured set of services Landi may consider for on-trip execution, including connected providers and static Manual Handoff entries. It is not built from real-time web search during the traveler interaction.
_Avoid_: Live web discovery, provider marketplace, search-result service list

**Service Catalog Entry**:
A static Execution Service Catalog item that describes when a service may be shown for a destination and Local Transport Option. In the first slice it supports simple destination matching and handoff display, not a full local mobility rules engine.
_Avoid_: Provider availability feed, dispatch rule, traffic policy model

**Destination Execution Context**:
The current, destination-specific facts Landi can use while assisting execution, such as the traveler's current place, lodging anchor, planned stop, weather, route facts, nearby options, available services, and recheck needs. It is not a Regional Pack and does not make the destination a product boundary.
_Avoid_: Regional Pack, Country Pack, destination-specific feature

**Validation Scenario**:
A concrete destination and traveler situation used to prove that a capability works end to end. It does not define the product boundary or require hard-coded behavior for that destination.
_Avoid_: Product scope, Regional Pack, implementation target

**Validation Dependency Boundary**:
The set of capabilities that a Validation Scenario is allowed to require for success. Optional third-party enhancements may appear only as degradable handoffs and cannot be prerequisites.
_Avoid_: Demo wishlist, provider partnership assumption, hidden dependency

**Travel Authorization Status**:
The traveler's current relationship to the visa, permit, or visa-free permission needed for a trip. `not_obtained` means the required authorization has not been obtained and triggers requirement research; `unknown` means the traveler cannot yet state their status.
_Avoid_: Immigration status, to be confirmed

**Plan Compiler**:
The deterministic, meaning-preserving boundary that converts a Trip Blueprint into a Plan without asking an Agent to invent Landi's execution structure. It may add Landi-owned execution fields but does not remove places, rearrange the itinerary, or rewrite travel advice.
_Avoid_: AI repair, Plan adapter

**Compilation Lineage**:
The immutable association from a Draft Plan to its source Trip Blueprint identity and version and the Plan Compiler version that produced it.
_Avoid_: Generation log, Plan history

**Skill Lineage**:
The immutable Skill identity and version recorded on the Research Set and Trip Blueprint Version it helped produce.
_Avoid_: Current installed Skill, Agent model name

**Skill Availability Failure**:
A generation-blocking state in which the required travel-planning Skill identity or version cannot be invoked. It cannot be converted into a successful generic-Agent Blueprint.
_Avoid_: Evidence gap, degraded research

**Blueprint Contract**:
Landi's versioned domain schema for Research Sets and Trip Blueprints. It remains independent of the travel-planning Skill's internal files and of Plan persistence structure.
_Avoid_: Skill output file, Plan contract, Web view model

**Skill Importer**:
The deterministic boundary that converts one supported Skill artifact format into the Blueprint Contract. It owns format compatibility and safe normalization but no Plan execution semantics.
_Avoid_: Plan Compiler, Agent repair, Skill

**Safe Normalization**:
A deterministic import transformation that can be shown not to change travel meaning, such as canonical formatting, stable identity assignment, or confirmed duplicate merging.
_Avoid_: Fact completion, content pruning, itinerary repair

**Source Metadata Gap**:
A valid HTTPS evidence URL referenced by a Skill artifact without a matching top-level source description. The Skill Importer retains it as a synthetic `recheck` source record; it does not discard the related place or promote the evidence to verified.

### Recoverable Itinerary Reference Defect

A local defect in the Agent's itinerary artifact that can be corrected without losing the Research Set, such as an unknown candidate Place Identity, a non-adjacent Movement Plan, or a missing Movement Plan between adjacent scheduled stops. Landi normalizes these defects into filtered candidates or `recheck` movements before Trip Blueprint validation instead of failing the whole generation.
_Avoid_: Unsupported place, structural source error

**Usage Limit Failure**:
A recoverable runtime failure indicating that Codex cannot continue until its account usage window or credits become available. It is not retried immediately, is not treated as a structural Blueprint defect, and retains every saved checkpoint.
_Avoid_: Timeout, invalid Skill output, automatic retry

**Compilation Key**:
The stable identity of one Trip Blueprint Version compiled by one Plan Compiler Version. Repeating that compilation resolves the same Draft Plan result rather than creating duplicate Plans, Tasks, or Reminders.
_Avoid_: Run ID, retry ID

## Current implementation boundary

The Web planning-session generation path now invokes `interactive-trip-planner@0.2.0` explicitly, persists geographic Research Set checkpoints and Generation Events, publishes a Trip Blueprint, and uses the deterministic Plan Compiler. The current Plan Workspace reads its travel content from the linked Trip Blueprint through a read-only view adapter. Existing execution, Country Pack, reminder, and Connector capabilities remain in place.

No new Plan path can invoke the legacy monolithic generator: Web generation uses Blueprint Generation, while Telegram and WhatsApp direct users to the Web workbench instead of creating a one-shot Plan or local-template fallback. Legacy monolithic generation remains temporarily available only for revisions of Plans that have no Blueprint Lineage. Revisions of Blueprint-backed Plans fail closed and preserve the current Blueprint until Assisted Replanning is implemented.

Live Skill acceptance completed on 2026-08-26 with `interactive-trip-planner@0.2.0`: 19 Research Set places, 20 sources, one complete Itinerary Day, six Movement Plans, and six Action Requirements imported into a Trip Blueprint with the exact Place Identity set preserved. The deterministic Plan Compiler produced five Stages, confirming that Stage count is derived from work rather than fixed at six.
