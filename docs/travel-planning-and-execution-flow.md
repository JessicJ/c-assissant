# Travel Planning and Execution Flow

## Purpose

This document describes the complete Landi product flow for one travel objective. It connects planning, Plan activation, long-running monitoring, user-approved adjustment, mobile assistance, and trip completion.

The authoritative result is always structured, versioned Plan data stored by Landi. Conversation, maps, notifications, and external handoffs are ways to work with that Plan; none of them replaces it.

## End-to-end flow

```text
Travel intent
  -> Planning Session
  -> Planning proposal
  -> Proposal approval
  -> Generation-critical fact collection
  -> Complete draft Plan
  -> Plan review and activation
  -> Reminders and travel monitoring
  -> Material change detection
  -> Impact preview and alternatives
  -> User-approved replacement Plan
  -> In-trip assistance
  -> Plan completion and archive
```

## 1. Start a Planning Session

The traveler begins with an ordinary description rather than a fixed travel form.

Landi extracts only facts that were actually provided, such as:

- destination or destination sequence;
- approximate or exact dates;
- trip purpose;
- party composition;
- fixed events or required places;
- mobility or transportation preferences;
- known arrival, departure, and lodging information.

The first message creates or updates a Planning Session. It does not create a complete Plan.

The Planning Session stores:

- conversation messages needed to interpret later turns;
- confirmed, inferred, and Profile-derived facts with provenance;
- unresolved questions;
- deferred details that do not yet block progress;
- the latest planning proposal;
- the proposal version approved by the traveler.

## 2. Build planning context

Each turn updates structured facts and chooses the next most useful action:

- ask one route-shaping question;
- summarize the current understanding;
- ask the traveler to correct a conflict;
- present a planning proposal;
- revise the current proposal.

Landi should not repeatedly ask for known information. Details that matter only after an option exists, such as a room type for a selected property, remain deferred.

## 3. Present a planning proposal

The proposal lets the traveler approve the direction before full research and generation.

It contains:

- the travel objective;
- destination order and broad pacing;
- a trip theme or planning approach;
- the major trip segments;
- important tradeoffs;
- visible assumptions;
- unresolved decisions that could still reshape the trip.

The proposal is versioned. If the destination, dates, or another route-shaping fact changes, Landi creates a new proposal version. Only the latest version can be approved.

## 4. Collect generation-critical facts

Proposal approval does not authorize Landi to invent missing execution facts.

Before generating a complete travel Plan, Landi confirms:

- destination and city sequence;
- exact travel dates, including the year;
- arrival origin, node, and expected time;
- departure node and expected time;
- party size;
- transportation preference.

Lodging may remain unknown. In that case, Landi uses an explicitly provisional area or routing anchor and never represents it as a confirmed booking.

## 5. Generate a complete draft Plan

Plan generation may combine:

- an isolated Agent Runtime run;
- regional Skills;
- place, route, and weather facts from Connectors;
- approved official-source snapshots;
- deterministic validation and compilation.

The result must pass Plan integrity checks before persistence. At minimum:

- dates and itinerary days are structurally consistent;
- scheduled Places exist and have normalized coordinates when required;
- candidates are not also represented as scheduled stops;
- fixed commitments do not conflict;
- the traveler’s transportation preference is preserved;
- route evidence is not overstated;
- limitations and facts requiring another check remain visible.

The complete Plan is still a draft. Tasks and Reminders remain inactive until the traveler reviews and activates that exact version.

## 6. Review and activate the Plan

Web is the primary Plan creation and management surface. It presents:

- the itinerary or phase timeline;
- map and Place details where spatial data exists;
- preparation and reservation Tasks;
- decisions and assumptions;
- proposed Reminders;
- sources and freshness warnings.

Activation binds approval to the exact Plan ID and version. A stale screen or old Telegram button cannot activate a newer or different Plan.

Only one Plan executes at a time. When a replacement draft exists, the previous active Plan continues to drive real-world Reminders until the replacement is approved.

## 7. Run the active Plan

After activation, Core owns long-running execution.

Current execution capabilities include:

- Task Reminders;
- expected-arrival reminders;
- departure reminders for important scheduled stops;
- current-destination resolution from itinerary dates and explicit arrival events;
- material weather checks;
- upcoming venue-status checks;
- Telegram delivery and external route handoffs.

The Roadmap extends these capabilities into persistent Monitoring Jobs. A monitoring result should remain quiet when no meaningful change exists.

## 8. Detect a material change

A provider result matters only when it can affect the traveler’s Plan or next action.

Examples include:

- disruptive weather;
- a scheduled venue closing;
- a route becoming stale or materially slower;
- a reservation requirement changing;
- an official source changing in a way that requires another review.

The target design records a Travel Attention with:

- the Plan and Plan version;
- the affected dates, Places, Tasks, routes, or decisions;
- severity and expiration;
- evidence and observation time;
- a deduplication key;
- the next useful traveler action.

Detection alone must not rewrite the active Plan.

## 9. Assess impact and offer alternatives

Landi converts a material Attention into a version-bound impact preview.

The preview explains:

- what changed;
- which part of the trip is affected;
- which facts require another check;
- what remains unaffected;
- one or more practical alternatives.

Material changes require traveler approval. The first complete target scenario is a must-see venue closing and Landi offering a replacement for the affected day without rebuilding the rest of the trip.

## 10. Create and activate a replacement Plan

After approval to replan, Landi creates a reviewable replacement draft.

The replacement process must:

- preserve completed Tasks;
- preserve unaffected itinerary days and decisions;
- mark affected routes and estimates stale until revalidated;
- retain an audit linking the source Plan and replacement Plan;
- reject the result if the current Plan changed during generation.

The active execution pointer changes only after the traveler confirms the complete replacement. Future Reminders and monitoring then switch to the new version, while obsolete work from the old version is cancelled.

## 11. Assist during the trip

Telegram is the primary mobile assistance surface after activation.

Landi interprets natural requests in the context of:

- the active Plan;
- current destination and local time;
- the current itinerary day;
- nearby scheduled Places;
- known traveler preferences;
- pending Tasks and recent travel events.

Mobile assistance includes reminders, contextual weather, nearby discovery, route handoffs, deviation reporting, and explicit Task completion.

Opening a map, booking page, payment app, or ride app never proves that an external action was completed. Landi advances user-owned or external Tasks only after explicit confirmation or reliable evidence.

Exact location is accepted only after an explicit traveler action, used for the current Task, and excluded from long-term Profile data.

## 12. Complete and archive the trip

Completing a Plan stops its future Reminders and monitoring work. Landi retains the final Plan version, completion record, and user-visible history according to the project’s retention policy.

Trip-scoped dates, lodging, party composition, and temporary preferences remain with the Plan. Only stable preferences explicitly confirmed by the traveler may be written to Profile.

## Channel responsibilities

### Web

- create and revise the Planning Session;
- review proposals and complete Plans;
- explore maps, days, Places, alternatives, and sources;
- make direct structured edits;
- review material impact and replacement drafts;
- manage Plan history and settings.

### Telegram

- deliver time-sensitive assistance;
- receive contextual natural-language requests;
- collect explicit arrival, delay, deviation, and completion input;
- present compact impact previews and version-bound confirmations;
- hand off irreversible actions to external services.

### Core

- own all persistent state and versions;
- validate changes and prevent stale writes;
- activate and stop execution work;
- schedule Reminders and monitoring;
- retain minimized audit and evidence references.

## Current implementation boundary

The repository already implements Planning Sessions, proposals, complete Plan generation, interactive itinerary data, Plan activation, version-aware replacement drafts, several Reminder paths, weather and venue checks, and Telegram assistance.

The next project milestone is to connect the existing monitoring functions to the full adjustment loop:

```text
Detect change
  -> Record Attention
  -> Assess impact
  -> Offer alternatives
  -> Obtain approval
  -> Replace affected Plan content
  -> Continue execution
```
