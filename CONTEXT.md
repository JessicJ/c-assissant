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

**Guide Catalog**:
The shared set of user-facing attraction, shopping, dining, and local-experience content in a Trip Blueprint. It belongs under the Itinerary workspace as schedulable or informational planning material rather than as separate top-level Plan workspace modules.
_Avoid_: Separate guide lists, static articles, top-level plan modules

**Blueprint Module Identity**:
The Trip Blueprint declaration of which workspace modules its content can truthfully power, with Itinerary as the primary travel-planning module and Preparation, Tips, and Sources as supporting views.
_Avoid_: Web tab state, Plan stage title, visual navigation

**Guide Theme**:
The traveler-facing narrative frame for a Trip Blueprint, including the trip theme, visitor mode, taste model when used, and city or route segments that explain how the Place Catalog is organized.
_Avoid_: UI theme, color palette, marketing copy

**Guide Relationship Graph**:
The structured relationships between Place Catalog entries, such as alternatives, same-direction additions, meal support, rainy-day swaps, and anchor support. It helps the workspace compare and revise places without inventing relationships from display text.
_Avoid_: Map route, category filter, ranking list

**Scheduling Eligibility**:
The per-place planning judgment that says whether and how a Place Catalog entry may be inserted into itinerary days, including ordinary schedulable places, informational context, blocked places, and high-impact edits that require replanning.
_Avoid_: Current scheduled status, user preference, map eligibility

**Typed Itinerary Block**:
A structured itinerary unit that explains what a day sequence element is, such as a stop, flexible block, meal, rest, transfer, lodging anchor, or event. It keeps day structure separate from generic Plan Tasks.
_Avoid_: Task, route segment, untyped stop list

**Field Evidence Link**:
Evidence attached to a specific Blueprint field or claim rather than only to the whole place or movement. It allows verified claims, recheck claims, and stale claims to remain distinguishable during import and revision.
_Avoid_: Source list entry, whole-place credibility, citation badge

**Place Identity**:
The stable identifier of one Place Catalog entry, used by itinerary stops and candidates. An itinerary may reference an identity only after the corresponding complete place record belongs to its Research Set.
_Avoid_: Place name, list position

**Map Eligibility**:
The ability to place a Place Catalog entry on the interactive map using sufficiently reliable coordinates. A place without Map Eligibility remains available in written content and carries a recheck status.
_Avoid_: Place validity, candidate validity

**Itinerary Map**:
The Web map presentation inside the Itinerary workspace. It supports spatial understanding, selected-place context, route or sequence review, and route status, but it is not the default entrypoint for adding or replacing Guide Items.
_Avoid_: Itinerary Explore Panel, map-first editor, standalone map guide

**Candidate Place**:
A Place Catalog entry that is not currently scheduled in the day-by-day itinerary but remains available for discovery, substitution, or replanning.
_Avoid_: Rejected place, unused place

**Attraction Place**:
A concrete Place Identity for sightseeing, museums, landmarks, neighborhoods, nature, or cultural venues. Attraction Guide Cards correspond directly to Attraction Places; attraction themes are browsing groups, not separate schedulable content objects.
_Avoid_: Attraction theme object, vague sightseeing idea, non-place attraction

**Guide Item**:
A user-facing image-and-text travel content item shown in the Itinerary workspace, such as an attraction, shopping idea, dining option, or local experience, that may reference a Place Identity or represent a schedulable experience. It remains travel content until the traveler promotes it into an Itinerary Day or preparation work.
_Avoid_: Static article, Plan Task, one-line place recommendation

**Guide Card**:
The Web presentation of a Guide Item in browsing lists. Its default anatomy includes title or local name, Guide Card Summary, optional image or compact text teaser, concrete place or related place when applicable, and a state-aware primary action. It should not show default day, time, replacement-type label, scheduling rationale, text-only source markers, or full Guide Value Explanation while the Guide Item remains unscheduled. Informational Guide Items remain browsable and filterable, can open detail, and simply do not show an add action.
_Avoid_: Itinerary Block, source list, recommendation rationale panel

**Guide Card Summary**:
The short browsing copy on a Guide Card. It helps the traveler scan title, image or text teaser, tags, area, and state without reading the full guide explanation. Longer Guide Value Explanation, comparisons, practical details, and source context belong in the shared detail panel.
_Avoid_: Full article, full Guide Value Explanation, comparison table, schedule rationale

**Guide Theme**:
A traveler-facing grouping of Guide Items around an experience, need, or decision context, such as local breakfast, design shopping, rainy-day museums, or evening neighborhoods. It helps the traveler browse by intent before choosing specific places.
_Avoid_: Place category, top-level module, itinerary day

**Guide Relationship Graph**:
The explicit Blueprint Contract relationships between guide-level concepts and concrete schedulable objects: Local Foods to Dining Places, Local Products to Purchase Places, Experience Themes to Experience Offerings, and Attraction Guide Cards to Attraction Places. The Skill should output these relationships and the Skill Importer should normalize them without relying on Web inference.
_Avoid_: Inferred category match, prose-only relationship, Web-owned data repair

**Itinerary Explore Panel**:
The unified Web workspace surface for browsing Guide Cards inside the Itinerary area, including both material already used in the Recommended Itinerary and available alternatives. It opens in an unfiltered browsing state and may offer lightweight type or state filters without requiring a visible All control. Scheduled cards locate the relevant timeline block; schedulable unscheduled cards start itinerary edits; informational cards open detail only.
_Avoid_: Top-level guide page, day-owned candidate list, separate attraction/dining/shopping module

**Guide Relevance Order**:
The default ordering of Guide Cards in the Itinerary Explore Panel's unfiltered browsing state. It prioritizes relationship to the current trip, current day, or selected Itinerary Block before secondary popularity, distance, rating, or source-richness signals.
_Avoid_: Global ranking, popularity-only list, source-volume score

**Per-block Arrangement Rationale**:
A possible explanation of why Landi placed one scheduled Itinerary Block at a specific day or time, such as preference fit, weather, opening hours, pacing, or route convenience. Landi may use these factors during generation, but the Trip Blueprint and Web workspace do not require a traveler-visible rationale field for each block.
_Avoid_: Itinerary Block status, Source Marker, Guide Relevance Order, Execution Action Card rationale

**Timeline-linked Guide Detail**:
The shared detail state opened when a scheduled Guide Card or timeline block is selected. It locates the corresponding timeline block and shows the Guide Item's image or text content, Source Marker, related guide material, and relevant alternatives in the same detail panel. Relevant alternatives are revealed here, not on timeline blocks by default.
_Avoid_: Separate article page, map-only selection, jump without context

**Guide Detail Template**:
The type-specific detail presentation used inside the shared Workspace Side Panel. Attraction, dining, shopping, and local-experience Guide Items share the same panel shell but render different useful fields for the travel decision.
_Avoid_: One generic detail layout, duplicated side panel, timeline block content

**Guide Option Comparison**:
The detail-panel pattern that shows multiple concrete dining places, purchase places, or experience offerings as peer options for the same food, product, or experience theme. It defaults to compact Option Comparison Rows rather than large image-led cards. It helps the traveler compare route fit, distance, price or quality signals, reservation or queue friction, timing, source state, and personal fit before choosing a concrete schedulable object. Web should not present these options as lower-status candidates or force one recommended default.
_Avoid_: Candidate label, single forced best option, ranked recommendation, large card stack, unschedulable theme

**Option Comparison Row**:
The compact row or table-like presentation of one concrete option inside a Guide Option Comparison. It prioritizes Comparison Facts such as name, area, distance or route fit, hours or source state, price or effort, reservation or queue friction, and the action to choose or inspect details.
_Avoid_: Large Guide Card, article block, promotional tile, subjective hype, hidden comparison data

**Comparison Fact**:
A comparable, traveler-useful fact or explainable signal shown in an Option Comparison Row, such as location, distance, route fit, hours, source state, price or effort, reservation need, queue friction, dietary fit, timing fit, or accessibility. Subjective promotional phrases do not belong in comparison rows.
_Avoid_: Marketing copy, hype phrase, ungrounded popularity claim, Guide Value Explanation

**Neutral Option Ordering**:
The non-promotional default ordering used inside a Guide Option Comparison. It may sort peer options by factual convenience signals such as proximity to the current itinerary, route fit, opening-state confidence, reservation friction, queue risk, timing fit, or source freshness, but it must not label one option as best or recommended.
_Avoid_: Ranked recommendation, default winner, hidden scoring, forced best option

**Guide Value Explanation**:
The traveler-facing explanation of why a Guide Item is worth visiting, eating, buying, or experiencing. It may use Guide Editorial Voice to make the detail view beautiful and engaging, but it should remain grounded in concrete reasons such as architecture, history, flavor, craft, local life, landscape, collection, ritual, or experience style. It supports reading, comparison, and taste judgment in Guide Cards or detail views, but it does not explain why the item was scheduled on a specific day or time.
_Avoid_: Per-block Arrangement Rationale, scheduling rationale, route optimization reason, source list, marketing slogan

**Guide Editorial Voice**:
The polished, magazine-like writing style allowed only in Guide Value Explanation and supporting guide copy. It can be visual, textured, and inviting, but must avoid exaggerated advertising language and should be anchored in specific observable or explainable travel value.
_Avoid_: Hype copy, empty praise, influencer catchphrase, unsupported superlative, timeline copy, checklist copy

**Functional Workspace Voice**:
The concise, restrained writing style for functional workspace surfaces such as Itinerary Timeline blocks, Preparation Checklist items, Travel Tip Cards, Contextual Tip Surfaces, Option Comparison Rows, route status, and action controls. It prioritizes scanning, judgment, and action over editorial atmosphere.
_Avoid_: Guide Editorial Voice, magazine paragraph, marketing copy, decorative prose

**Preparation Checklist**:
The top-level Web area for pre-departure preparation. It presents grouped text-only checklist items with expandable written details, due timing, source-backed status, and completion controls; it does not use image-led guide cards.
_Avoid_: Guide Card, inspiration article, image-led preparation module

**Preparation Relevance Rule**:
The rule that a Preparation Checklist item must materially affect the trip's readiness, legality, access, booking use, payment, connectivity, weather fit, health, safety, transport setup, or destination-specific procedure. Generic life advice and broad wellness suggestions do not belong in Preparation unless tied to a concrete travel requirement.
_Avoid_: Generic to-do, lifestyle advice, vague reminder, filler checklist item

**Travel Tip Card**:
The compact text-first Web presentation of a Travel Tip. It may show a Source Marker when a custom, safety, payment, transport, or other change-sensitive claim needs provenance, but it does not require images.
_Avoid_: Image-led guide card, execution task, generic FAQ

**Canonical Tip**:
The primary Travel Tip record shown in the Tips area. It carries the full text, theme, source state, freshness state, and available actions, and can be referenced from itinerary context without being duplicated.
_Avoid_: Duplicate itinerary note, one-off caution copy, preparation task

**Inspiration Source**:
A non-authoritative content source, such as a social, UGC, short-video, image-board, review, or travel-community platform, used to discover guide themes, visual context, local products, and possible experiences. It can suggest what to investigate, but cannot by itself verify time-sensitive facts, bookings, policy, opening status, route reliability, or safety claims.
_Avoid_: Official Evidence, verified source, execution fact

**Source Channel**:
One available way for Landi to gather planning material or verify facts, such as maps data, official sources, merchant pages, structured providers, review platforms, image search, or UGC. No single Source Channel is required for every trip.
_Avoid_: Required platform, regional bundle, evidence status

**Source Capability Selection**:
A capability-driven source selection model that chooses inspiration, maps, dining, shopping, merchant, review, official, and image sources according to the planning need, destination coverage, traveler language, and available connectors. Region may be a coverage signal, but it is not the organizing strategy.
_Avoid_: Fixed regional strategy, Xiaohongshu-only source, single global platform

**Source Marker**:
A small unobtrusive indicator on a guide card, image, tip, or itinerary detail that reveals inspiration and evidence references on hover, focus, or tap. It preserves source transparency without making source lists part of the default reading layout. Itinerary Timeline blocks do not show Source Markers by default; they use short status text for schedule-critical facts that need attention.
_Avoid_: Visible citation block, hidden provenance, card footer clutter, timeline block default badge

**Local Product**:
A destination-specific shopping item or specialty that can be recommended with context and one or more suitable Purchase Places. It is separate from the places where it can be bought. It remains Guide Catalog content and becomes itinerary material only through an Itinerary Promotion of a related Purchase Place or shopping block.
_Avoid_: Shopping task, generic souvenir, purchase confirmation

**Purchase Place**:
A concrete Place Identity where a Local Product or shopping theme can reasonably be browsed or bought. One Local Product may link to multiple Purchase Places, and each Purchase Place may carry its own location, source state, hours, effort, price, or nearby itinerary context. It must identify a real place rather than a vague area before it can be promoted into an Itinerary Block.
_Avoid_: Product, shopping category, vague shopping area

**Purchase Place Comparison**:
The shopping detail presentation that helps travelers choose among multiple Purchase Places for one Local Product. It compares location, suitable itinerary area, convenience, price or quality signals, hours, source state, and nearby itinerary links when available.
_Avoid_: Name-only store list, generic shopping area, product description

**Local Food**:
A destination-specific dish, drink, food style, dining ritual, or food theme that can be recommended with cultural and practical context. It is separate from the places where it can be eaten and becomes itinerary material only through an Itinerary Promotion of a related Dining Place or meal block.
_Avoid_: Restaurant, meal reservation, generic cuisine tag

**Dining Place**:
A concrete Place Identity where a Local Food or dining theme can reasonably be eaten or explored, such as a restaurant, cafe, market, food hall, food street, or neighborhood dining cluster. One Local Food may link to multiple Dining Places.
_Avoid_: Dish, cuisine category, vague food idea

**Dining Place Comparison**:
The dining detail presentation that helps travelers choose among multiple Dining Places for one Local Food or dining theme. It compares location, suitable itinerary area or meal moment, reservation or queue expectation, dietary fit, price or quality signals, hours, source state, and nearby itinerary links when available.
_Avoid_: Name-only restaurant list, live availability claim, ordering flow

**Experience Theme**:
A destination-specific local-experience concept, such as tea culture, bathing culture, neighborhood nightlife, craft workshops, performances, seasonal festivals, or local rituals. It explains cultural context, suitable travelers, timing, and practical considerations before the traveler chooses a concrete offering.
_Avoid_: Place, booking, generic activity category

**Experience Offering**:
A concrete schedulable activity, venue, provider, event, route, or place where an Experience Theme can be experienced. One Experience Theme may link to multiple Experience Offerings, and an offering must carry enough place, time, or booking context before it can become an Itinerary Block.
_Avoid_: Experience theme, vague local custom, generic inspiration

**Experience Offering Comparison**:
The local-experience detail presentation that helps travelers choose among multiple Experience Offerings for one Experience Theme. It compares location, duration, suitable itinerary area or day part, booking need, seasonal fit, accessibility, etiquette or risk notes, source state, and nearby itinerary links when available.
_Avoid_: Name-only activity list, booking claim, unsourced event

**Schedulable Itinerary Object**:
A concrete object that can appear in an Itinerary Block because it answers where, when, and what the traveler is doing. Examples include Attraction Place, Dining Place, Purchase Place, Experience Offering, movement, rest, and flexible time. Local Food, Local Product, and Experience Theme explain choices but should not occupy the timeline directly.
_Avoid_: Theme-only block, product-only block, dish-only block

**Informational Guide Item**:
A Guide Item that is useful for understanding local food, shopping, culture, or customs but lacks a related Schedulable Itinerary Object in the imported Blueprint. The Skill Importer preserves it as guide content and marks it unavailable for timeline placement. Web can show it in explore, filter, and detail surfaces, but should not show an add-to-itinerary action. Landi does not design a separate post-import enrichment path for turning these items into schedulable content.
_Avoid_: Invalid content, schedulable block, discarded theme

**Guide Content Selectivity**:
The qualitative generation rule that prioritizes Schedulable Itinerary Objects and keeps Informational Guide Items limited to high-value context that helps the traveler understand local food, shopping, culture, or experience choices. It is not a fixed ratio or quota per destination or guide type.
_Avoid_: Background-content dump, encyclopedic guide, filler cards, content quota

**Unscheduled Guide Option**:
A Guide Item that is available as replacement or enrichment material but is not part of the Recommended Itinerary. It should not carry a default day, time, or visible replacement-type label unless a real constraint, such as a booking window or opening time, requires it. Scheduling compatibility can exist internally for validation and impact checks.
_Avoid_: Scheduled stop, recommended itinerary block, hidden default

**Itinerary Promotion**:
A traveler action that adds a Guide Item or Candidate Place into a compatible Itinerary Day as scheduled or optional content. It first enters a pending edit state for traveler review, and only changes travel meaning after confirmation records a Blueprint Revision.
_Avoid_: Bookmark, filter choice, execution task

**Placement Selection State**:
The lightweight Web state opened by a schedulable unscheduled Guide Card's add action. The traveler chooses the target day and placement position before Landi creates a Pending Itinerary Edit.
_Avoid_: Immediate insertion, default schedule recommendation, hidden auto-placement

**Placement Advisory**:
A lightweight warning shown inside Placement Selection State when a possible placement may create route, opening-hour, meal timing, reservation, weather, or pacing friction. It informs the traveler before confirmation but does not block selection unless a hard booking or explicit safety rule applies.
_Avoid_: Hard validation error, hidden conflict, automatic rejection

**Pending Itinerary Edit**:
An unconfirmed workspace change to guide content, candidate places, priorities, or itinerary order. It is not durable travel meaning until the traveler confirms it through the existing edit confirmation path. Ordinary guide additions can be represented by highlighting the changed placement in the existing edit state, without a separate impact summary module.
_Avoid_: Blueprint Revision, saved itinerary, Workspace View State

**Confirmed Duplicate**:
Two place records proven to represent the same real place through a shared stable external identity, official place identity, or traveler-confirmed alias relationship. Only Confirmed Duplicates may be merged automatically.
_Avoid_: Similar name, nearby place

**Possible Duplicate**:
Two distinct retained place records whose names or coordinates suggest that they may represent the same place but lack identity proof. They remain separate until resolved.
_Avoid_: Confirmed Duplicate, invalid place

**Itinerary Day**:
The Trip Blueprint's explicit account of one calendar day in the travel date range. It may schedule places or intentionally represent transit, rest, or unstructured free time.
_Avoid_: Mandatory sightseeing day, Plan Stage

**Recommended Itinerary**:
The complete day-by-day itinerary Landi generates from the travel boundary, time constraints, weather context, traveler preferences, and available evidence. The traveler may apply it as-is or use guide material to replace, add, remove, or rearrange parts before activation.
_Avoid_: Empty itinerary canvas, fixed itinerary, executed plan

**Itinerary Timeline**:
The Web presentation of a Recommended Itinerary as a time-ordered sequence of Itinerary Blocks. It helps the traveler read what happens when, select blocks, review status, and see changed-placement highlighting in the existing edit state; it is not the primary arrangement tool. Timeline blocks default to time, title, type, place or area, and short status. They do not show Source Markers by default; long descriptions, sources, and related material live in the shared detail panel.
_Avoid_: Itinerary Explore Panel, drag-first editor, day overview module

**Itinerary Workspace Layout**:
The default desktop Web workspace arrangement for the Itinerary area: time-ordered Itinerary Timeline as the plan body, Itinerary Map as spatial and route context, and an openable Itinerary Explore Panel or shared detail panel for guide browsing, source inspection, and adjustment actions. The map should not dominate the page. Landi's Web workspace does not target mobile layout or mobile editing.
_Avoid_: Map-first workspace, standalone guide page, timeline editor

**Desktop Workspace Density**:
The Web workspace's ability to keep the Itinerary Timeline, Itinerary Map, and Explore or Detail panel visible together when screen space allows. It uses desktop information density for comparison and review instead of compressing the product into a mobile-style single-column flow.
_Avoid_: Mobile-first layout, single-column workspace, hidden map by default

**Workspace Side Panel**:
The shared right-side desktop workspace region that switches between Itinerary Explore Panel and shared detail view modes. It prevents guide browsing and detail inspection from opening as competing sidebars.
_Avoid_: Multiple simultaneous sidebars, modal-only detail, separate explore and detail columns

**Side Panel Navigation State**:
Ephemeral Web view state that preserves the Workspace Side Panel's previous explore filters, sort order, scroll position, and selected card when switching into detail mode. It lets the traveler return from detail to the prior exploration context without changing Trip Blueprint meaning.
_Avoid_: Blueprint Revision, saved preference, duplicated detail panel

**Itinerary Block**:
A typed part of an Itinerary Day, such as a main stop, meal block, shopping block, local-experience block, transit block, rest block, or flexible block. It helps Landi present a complete day as replaceable planning pieces instead of only as a flat list of places.
_Avoid_: Plan Stage, generic task, untyped place row, day overview module

**Flexible Itinerary Block**:
An Itinerary Block that belongs to the Recommended Itinerary but uses a rough time window, optional status, or flexible placement instead of a precise start time. It remains ordered within its Itinerary Day and may render with a Rough Time Label. It is appropriate for dining, shopping, local experiences, rest, and exploratory stops when the plan should remain useful without becoming rigid.
_Avoid_: Candidate Place, unscheduled Guide Option, exact booking, hidden filler

**Rough Time Label**:
A localized timeline label for a Flexible Itinerary Block, such as around lunch, flexible afternoon, or optional evening. It communicates day rhythm and ordering without pretending the block has an exact start time.
_Avoid_: Exact start time, empty time slot, hidden ordering, scheduling rationale

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

**Travel Tip**:
A traveler-facing local caution or norm that helps the traveler avoid destination-specific friction during the trip, including etiquette, transport habits, payment norms, safety, language, weather, dress, taboos, scams, tourist traps, and common local mistakes. It is grouped by theme and may also be surfaced near a relevant Itinerary Day or Itinerary Block; it remains informational unless it has a concrete accountable action that becomes an Action Requirement.
_Avoid_: Itinerary stop, generic FAQ, automatic task

**Travel Tip Relevance Rule**:
The rule that a Travel Tip must be tied to the destination, local culture, local infrastructure, trip context, or a concrete itinerary situation. Generic travel inspiration, broad life advice, motivational copy, and obvious universal reminders do not belong in Tips.
_Avoid_: Travel essay, motivational advice, generic packing reminder, filler caution

**Contextual Tip Surface**:
A compact itinerary-side display of a Canonical Tip beside a relevant Itinerary Day or Itinerary Block. It should show only the short caution needed in that itinerary context, while the full explanation remains in the Tips area or shared detail view. It references the same Travel Tip rather than duplicating, converting, or scheduling it as itinerary content.
_Avoid_: Full tip copy, separate tip copy, Itinerary Promotion, Plan Task

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
The immutable Skill identity and version recorded on the Research Set and Trip Blueprint Version it helped produce. A resumed generation retains its recorded identity rather than inheriting the currently preferred Skill.
_Avoid_: Current installed Skill, Agent model name

**Landi Blueprint Generation Policy**:
The Landi-owned, versioned planning rules for producing structured travel content, selecting sources by their evidentiary capability, and preserving the boundary between travel advice and executable work. The policy does not own workspace layout or represent the Agent runtime itself.
_Avoid_: Map template, Agent model, installed travel Skill

**Skill Output Acceptance Criteria**:
The checklist used to judge whether a Landi-native planning Skill artifact is usable before or during Skill Importer normalization. It focuses on contract shape, content relevance, schedulable relationships, source handling, image optionality, writing style, and Web presentation readiness, not on Plan execution behavior.
_Avoid_: Web QA checklist, Plan Compiler test, visual regression test

**Blueprint Workspace Requirements Draft**:
The initial PRD-style requirements baseline for the Landi-native travel planning generation and Web workspace presentation redesign. It captures agreed product architecture, content areas, source strategy, guide presentation, timeline behavior, preparation and tips boundaries, and Skill Output Acceptance Criteria, but does not authorize code implementation by itself.
_Avoid_: ADR, implementation plan, raw skill prompt, visual QA checklist

**Skill Availability Failure**:
A generation-blocking state in which the required travel-planning Skill identity or version cannot be invoked. It cannot be converted into a successful generic-Agent Blueprint.
_Avoid_: Evidence gap, degraded research

**Blueprint Contract**:
Landi's versioned domain schema for Research Sets and Trip Blueprints. It remains independent of the travel-planning Skill's internal files and of Plan persistence structure. It includes Guide Relationship Graph data so Web can present guide concepts and schedulable objects without inference.
_Avoid_: Skill output file, Plan contract, Web view model

**Skill Importer**:
The deterministic boundary that converts one supported Skill artifact format into the Blueprint Contract. It owns format compatibility, relationship validation, and safe normalization but no Plan execution semantics. It should preserve explicit Guide Relationship Graph data, mark useful theme-level content without schedulable relationships as Informational Guide Items, and must not invent missing concept-to-place relationships.
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

New Web planning-session generations use the repository-owned `landi-trip-blueprint@1.0.0` policy, persist geographic Research Set checkpoints and Generation Events, publish a Trip Blueprint, and use the deterministic Plan Compiler. Existing generations retain their original policy, including supported `interactive-trip-planner@0.2.0` checkpoint continuation. The current Plan Workspace reads its travel content from the linked Trip Blueprint through a read-only view adapter, including block evidence, guide catalog relationships, informational guide items, and privacy-minimized booking constraints. Existing execution, Country Pack, reminder, and Connector capabilities remain in place. Current-policy live acceptance has not yet produced a completed pass and is tracked separately from the historical run below.

No new Plan path can invoke the legacy monolithic generator: Web generation uses Blueprint Generation, while Telegram and WhatsApp direct users to the Web workbench instead of creating a one-shot Plan or local-template fallback. Legacy monolithic generation remains temporarily available only for revisions of Plans that have no Blueprint Lineage. Blueprint-backed workspace edits use version-aware Direct Blueprint Revisions and the existing Assisted Replanning path when required.

Live Skill acceptance completed on 2026-08-26 with `interactive-trip-planner@0.2.0`: 19 Research Set places, 20 sources, one complete Itinerary Day, six Movement Plans, and six Action Requirements imported into a Trip Blueprint with the exact Place Identity set preserved. The deterministic Plan Compiler produced five Stages, confirming that Stage count is derived from work rather than fixed at six.
