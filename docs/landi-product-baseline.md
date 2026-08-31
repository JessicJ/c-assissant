# Landi Product Baseline

## Purpose

Landi is a long-running travel assistant. It helps a traveler turn an incomplete travel goal into a reliable Plan, then continues assisting after that Plan is activated.

This document defines the current product behavior and scope. When another design note conflicts with this baseline, this document wins until the difference is explicitly resolved.

## Product promise

Landi has two responsibilities:

1. build a complete, reviewable travel Plan from the traveler’s information; and
2. assist the traveler as that Plan progresses and real-world conditions change.

The product should feel like one continuous assistant. Internal Skills, Agent Runtime runs, Connectors, and scheduling work are implementation details, not separate personas or products.

## Primary traveler experience

```text
Describe the trip
  -> Refine the planning context
  -> Review a planning proposal
  -> Generate a complete Plan
  -> Review and activate the Plan
  -> Receive relevant assistance
  -> Approve material adjustments
  -> Complete and archive the trip
```

## Plan creation

Plan creation begins with a conversational Planning Session on Web.

The first message may be incomplete. Landi stores the facts provided, identifies what materially affects the trip, and asks focused follow-up questions. It does not create a complete Plan from every message.

Before detailed generation, Landi presents a versioned planning proposal containing:

- the objective;
- destination sequence and broad pacing;
- major trip segments;
- important tradeoffs;
- assumptions;
- unresolved decisions that could reshape the trip.

The traveler can revise or approve the proposal. Only the latest proposal version can be approved.

## Generation-critical facts

Before Landi generates a complete Plan, it confirms:

- destination and city sequence;
- exact travel dates, including the year;
- arrival origin, node, and expected time;
- departure node and expected time;
- party size;
- transportation preference.

Lodging does not block Plan generation. When lodging is unknown, Landi uses an explicitly provisional area or routing anchor and never represents it as a booked property.

## Plan integrity

A generated result may become a formal draft Plan only when:

- dates, destinations, cities, and itinerary days are structurally consistent;
- scheduled Places exist and use normalized coordinates when required;
- candidates are not also represented as scheduled stops;
- fixed commitments do not conflict;
- traveler constraints and transportation preferences are preserved;
- every itinerary day has an explainable structure;
- external facts retain their verification state and source evidence.

Provider failure must not be replaced with invented routes, opening hours, reservation conclusions, weather, or policy facts. A Plan may remain usable with explicit limitations and items that require another check.

## Plan workspace

Web is the primary Plan creation and management surface.

It supports:

- conversational intake and proposal approval;
- complete Plan review and activation;
- itinerary, map, day, Place, candidate, route, preparation, and source exploration;
- direct structured edits such as add, remove, move, reorder, and priority changes;
- conversational Plan revision;
- version conflict protection and undo;
- review of material impact and replacement drafts;
- Plan history and settings.

The Plan remains authoritative structured data. Generated HTML, browser-local state, map markers, and conversation text do not replace persisted Plan data.

## Mobile assistance

Telegram is the primary mobile assistance channel after a Plan is activated.

It supports:

- time-sensitive Reminders;
- contextual natural-language requests;
- arrival, delay, deviation, and completion input;
- weather and nearby discovery;
- route and external-action handoffs;
- compact review and version-bound confirmation of material changes.

Normal background checks remain quiet. Landi sends a proactive message only when the traveler needs to act or a meaningful exception affects the Plan.

## Plan lifecycle

Only one Plan executes at a time.

A traveler may create or review a replacement draft while the previous active Plan continues running. The execution pointer changes only after the traveler approves the complete replacement Plan.

Activating a replacement Plan must cancel or rebuild affected future Reminders and monitoring work. Sent notifications and earlier Plan versions remain auditable.

The Roadmap extends the current lifecycle with explicit pause, completion, and archive behavior.

## Plan changes

Direct, low-impact edits may be saved as new Plan versions with undo.

Changes that affect dates, destination sequence, lodging base, fixed commitments, party constraints, or automation scope require an impact preview before replanning.

A replacement draft must preserve:

- unaffected itinerary content;
- completed Tasks;
- traveler decisions that still apply;
- an audit link to the Plan version it replaces.

Changed routes and external facts must be marked stale or unverified until refreshed.

## Long-running assistance

After Plan activation, Core owns Reminders, current-destination state, travel events, and monitoring.

The current product includes initial weather, venue, arrival, departure, and Task Reminder capabilities. The next development stage unifies them into persistent Monitoring Jobs and a Travel Attention flow.

Monitoring must follow these principles:

- bind work to a specific Plan version;
- survive a service restart;
- stop obsolete work when the Plan changes;
- remain quiet when no material change exists;
- preserve source and observation time;
- never modify a material part of the Plan without traveler approval.

## External actions

Landi may prepare information and open an external application, but the traveler completes irreversible actions there.

Landi does not automatically:

- book transportation or lodging;
- place an order;
- make a payment;
- call or confirm a ride;
- claim that an external action succeeded because a link was opened.

User-owned and external Tasks advance only after explicit confirmation or reliable evidence.

## Profile and trip-scoped data

Profile stores stable information and preferences that the traveler explicitly confirms for reuse.

Plan stores trip-specific information, including:

- dates;
- arrival and departure details;
- lodging;
- party composition;
- luggage;
- temporary transportation preferences;
- itinerary decisions and completion state.

Landi does not store passport or visa images or full document numbers. Exact location is used only after explicit sharing, scoped to the current action, and excluded from long-term Profile data.

## Current destination and time

Landi derives the current destination from itinerary dates and travel nodes, then corrects it from explicit traveler input such as an arrival confirmation.

Pre-trip assistance follows the traveler’s current time zone when known. During travel, messages and scheduled work follow the relevant destination time zone. Time-bearing messages display the applicable zone.

## Product scope

The current product focuses on one traveler-owned instance and one active travel Plan.

In scope:

- conversational travel planning;
- structured and interactive Plans;
- source-backed preparation;
- versioned revision;
- reminders and long-running monitoring;
- user-approved partial replanning;
- Web and Telegram collaboration;
- external handoff for irreversible actions.

Outside the current scope:

- a generic project-management interface;
- visible internal Agent orchestration;
- automatic booking, payment, ordering, or ride confirmation;
- document-image storage;
- multiple active Plans executing at the same time.

## Product completion path

The long-term travel assistant reaches its intended first complete form when this path works end to end:

```text
Web travel intake
  -> Proposal approval
  -> Complete validated Plan
  -> Plan activation
  -> Persistent travel monitoring
  -> Material change detection
  -> Impact preview and alternatives
  -> User-approved partial replanning
  -> Synchronized Web and Telegram update
  -> Continued trip execution
  -> Plan completion and archive
```
