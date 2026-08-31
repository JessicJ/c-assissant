# Landi Long-Term Travel Assistant Roadmap

> This document is written for AI systems and engineers working on Landi. It explains where the product is today, how its capabilities should evolve, and how each stage connects to the next.

## 1. Product Direction

Landi should not grow by accumulating disconnected travel tools. It should evolve into a long-running travel assistant that can build a plan, preserve its state, track meaningful changes, and help the traveler respond throughout the trip.

```text
Understand the travel goal
  -> Build a complete travel plan
  -> Provide an interactive plan workspace
  -> Track relevant changes over time
  -> Assess how changes affect the plan
  -> Help the traveler adjust and execute the plan
  -> Support multi-city, cross-border, and extended stays
```

The intended product experience is simple:

> The traveler describes the goal. Landi builds the plan, remembers progress, watches for meaningful changes, and helps the traveler adjust and act when necessary.

## 2. Current Position

Landi has moved beyond a basic itinerary generator. The current product already supports plan creation, structured itinerary data, an interactive workspace, versioned changes, reminders, and early monitoring capabilities.

```text
[Available] Conversational travel intake
     ->
[Available] Planning proposal and complete Plan generation
     ->
[Available, still evolving] Interactive itinerary and map
     ->
[Available in limited form] Reminders, weather checks, and venue checks
     ->
[Next] Unified long-term travel monitoring
     ->
[Next] Change-driven partial replanning
     ->
[Later] Complete in-trip assistance
```

The repository already includes:

- multi-turn travel intake;
- a proposal checkpoint before full Plan generation;
- versioned Plan storage;
- itinerary days, places, candidates, maps, and route segments;
- place priority, day assignment, ordering, and undo;
- Plan-scoped accommodation, transportation, party, and luggage context;
- route, weather, and place fact refreshes;
- Telegram reminders and route handoffs;
- detection of material weather conditions and venue closures;
- historical Plans and replacement-draft continuity;
- a regional Country Pack with source-backed travel preparation.

The main missing link is:

```text
Detect a meaningful change
  -> Understand its impact
  -> Offer an adjustment
  -> Obtain user approval
  -> Update the affected part of the Plan
  -> Continue execution from the new version
```

## 3. Stage One: Travel Intent and Planning Context

**Status: Core flow available**

This stage establishes where the traveler is going, when the trip will happen, what the traveler wants to accomplish, and which constraints shape the plan.

Current capabilities:

- conversational Web intake;
- persistent Planning Sessions;
- extraction of destinations, dates, party size, transportation preference, and other planning facts;
- focused follow-up questions;
- versioned planning proposals;
- proposal revision when the traveler changes direction;
- full Plan generation only after the latest proposal is approved.

Further development:

- improve complex date and multi-destination interpretation;
- improve handling of fixed events and non-negotiable commitments;
- keep user-confirmed facts separate from Profile data and inferred assumptions;
- reduce repeated questions;
- apply the same intake model to family travel, fixed-event trips, and extended stays;
- keep all traveler-facing copy and tests aligned with the release language.

Primary code areas:

- `apps/server/src/planning-session.ts`
- `packages/core/src/index.ts`
- `packages/storage/src/index.ts`
- `apps/web/src/App.tsx`

## 4. Stage Two: Complete Travel Plans

**Status: Core model available**

This stage turns an approved planning direction into a Plan that can be reviewed, stored, updated, and executed.

Current capabilities:

- itinerary and timeline presentation models;
- dates, cities, places, candidates, and route segments;
- Plan integrity validation;
- normalized coordinates and route verification states;
- accommodation, arrival time, transportation preference, party size, and luggage configuration;
- Stages, Tasks, Reminders, Sources, and Plan versions;
- draft review and explicit activation;
- source-backed Country Pack preparation;
- route refresh with safe provider-failure behavior.

Further development:

- strengthen consistency checks across dates, cities, places, and scheduled stops;
- represent flights, rail segments, lodging, and fixed reservations as clearer domain objects;
- improve long-distance movement between cities;
- make verified, stale, and unverified facts consistently visible;
- preserve unaffected Plan content during partial updates;
- support preparation and execution tasks that span longer trips and extended stays.

Primary code areas:

- `packages/core/src/index.ts`
- `packages/core/src/plan-compiler.ts`
- `packages/storage/src/index.ts`
- `packages/agent-adapters/src/index.ts`
- `country-packs/`

## 5. Stage Three: Interactive Plan Workspace

**Status: Initial workspace available and continuing to evolve**

This stage lets the traveler use and modify the Plan inside Landi instead of treating the Plan as a static generated document.

Current capabilities:

- full-trip and day-level navigation;
- connected map, place list, and place details;
- a visible distinction between verified routes and simple stop sequences;
- place priority changes;
- candidate placement into itinerary days;
- moving, removing, and reordering stops;
- undo;
- persisted Plan updates;
- a handoff from direct edits to conversational replanning;
- preparation, reminder, source, and Plan history views.

Further development:

- store every map interaction as a structured Plan change;
- show how a proposed edit affects routes, reservations, and reminders;
- support movements spanning multiple days or cities;
- improve the mobile map and Plan navigation experience;
- display disruptions, alternatives, and approved adjustments on the affected day and place;
- connect notification history to the Plan versions and items it affected.

Primary code areas:

- `apps/web/src/PlanMapWorkspace.tsx`
- `apps/web/public/trip-map/`
- `apps/web/src/App.tsx`
- `packages/storage/src/index.ts`

## 6. Stage Four: Unified Long-Term Monitoring

**Status: Next major development stage**

This stage combines the existing reminder, weather, venue, and route checks into one durable travel-monitoring system.

The intended behavior is:

- activating a Plan creates the monitoring work required by that trip;
- monitoring state is stored in SQLite and survives service restarts;
- each job runs against a specific Plan version and travel scope;
- checks follow the active destination and relevant local time;
- ordinary results remain quiet;
- only meaningful changes enter the notification and adjustment flow.

### Travel state

Develop the Plan lifecycle beyond the current draft and active states:

- pause a Plan without deleting it;
- archive completed or abandoned travel;
- keep no more than one active Plan;
- stop future work from the old Plan when execution moves to a replacement;
- store arrivals, task completion, provider changes, and other travel events;
- resolve the current destination from itinerary dates and explicit arrival events.

### Monitoring jobs

Introduce one persistent Monitoring Job model that can:

- identify the Plan and Plan version it belongs to;
- define the place, date, route, Task, or source being checked;
- store its next run time and latest result;
- survive a process restart;
- retry temporary failures;
- stop when its Plan version is no longer current;
- prevent duplicate execution.

Move existing weather and venue checks into this shared scheduling path. Reminder scheduling and monitoring should follow the same version-invalidation rules even if their delivery behavior remains separate.

### Monitoring coverage

Expand monitoring in this order:

1. weather that can materially affect the itinerary;
2. venue closure and operating status;
3. stale or materially changed route facts;
4. reservation requirements;
5. unconfirmed lodging and transportation decisions;
6. official-source changes that require another policy review;
7. critical pre-departure and same-day Tasks.

Primary code direction:

- extend long-running state in `packages/core/src/index.ts`;
- add durable monitoring storage to `packages/storage/src/index.ts`;
- extract a shared scheduler from `apps/server/src/index.ts`;
- migrate `apps/server/src/plan-weather-monitor.ts`;
- migrate `apps/server/src/plan-venue-monitor.ts`;
- align Reminder and Monitoring Job invalidation behavior.

## 7. Stage Five: Change-Driven Plan Adjustment

**Status: Next major development stage, built on unified monitoring**

This stage moves Landi from reporting a problem to explaining how the problem affects the trip and helping the traveler respond.

```text
Detect a weather, venue, route, reservation, or policy change
  -> Decide whether it affects the active Plan
  -> Identify affected dates, places, routes, reservations, and reminders
  -> Present the impact and practical alternatives
  -> Ask the traveler to approve an adjustment
  -> Update only the affected part of the Plan
  -> Revalidate changed routes and external facts
  -> Continue from the approved Plan version
```

Develop the following capabilities:

- one Travel Attention model for all material changes;
- severity, affected items, source evidence, and observation time;
- deduplication and grouping of related changes;
- conversion from Travel Attention to Plan Change Impact;
- one or more structured alternatives;
- preservation of unaffected days and completed Tasks;
- stale or unverified states for affected route segments;
- synchronized updates to Web, Telegram, Reminders, and monitoring;
- undo for an approved Plan adjustment.

The first complete demonstration should use a venue closure:

```text
A must-see venue closes temporarily
  -> Landi identifies the affected day and route
  -> Landi offers a replacement or a different sequence
  -> The traveler approves the change
  -> Only that day is replanned
  -> Other days remain unchanged
  -> New route facts and reminders become active
```

Primary code areas:

- `apps/server/src/plan-change-impact.ts`
- `apps/server/src/plan-venue-monitor.ts`
- `apps/server/src/plan-weather-monitor.ts`
- `apps/server/src/web-agent.ts`
- `packages/core/src/index.ts`
- `packages/storage/src/index.ts`

## 8. Stage Six: In-Trip Travel Assistance

**Status: Several component capabilities exist; a unified experience is still needed**

This stage makes Landi useful during the trip, not only while the trip is being planned.

Existing foundations:

- Telegram pairing;
- Plan review and activation;
- arrival reminders;
- Task reminders;
- departure reminders for important stops;
- one-time location sharing;
- Google Maps and Uber handoffs;
- on-demand weather and nearby food;
- explicit Task completion;
- current-destination resolution from dates and arrival events.

Further development:

- interpret natural requests without requiring command memorization;
- use the active Plan, current city, local date, route, meal context, and traveler preferences;
- turn messages such as “I arrived,” “I am delayed,” or “this place is closed” into travel events;
- show a compact impact preview for material Plan changes in Telegram;
- keep routes, reminders, Tasks, and Plan versions synchronized;
- preserve important state locally when Telegram is temporarily unavailable;
- never treat an external app handoff as proof that a booking, payment, ride, or Task was completed;
- keep Web focused on the synchronized Plan and low-emphasis notification history.

Target experience:

```text
Receive a material travel alert
  -> Review its impact
  -> Approve an adjustment
  -> Receive an updated departure reminder
  -> Open the route
  -> Explicitly confirm completion
  -> Continue to the next travel item
```

## 9. Stage Seven: Full Travel Lifecycle

**Status: Later development**

This stage extends planning and in-trip assistance across the complete life of a trip.

### Before departure

- destination and route decisions;
- transportation and lodging preparation;
- entry, document, and policy preparation;
- connectivity and payment setup;
- weather, packing, and reservation checks;
- review of incomplete critical Tasks before departure.

### During the trip

- current-destination transitions;
- daily routes and departure reminders;
- weather and venue disruptions;
- nearby food and contextual requests;
- deviation handling and partial replanning;
- lodging-to-first-stop routing for the next day.

### After the trip

- complete the active Plan;
- stop future Reminders and Monitoring Jobs;
- preserve the final Plan version and completion record;
- archive the trip;
- move only explicitly confirmed stable preferences into Profile;
- keep temporary trip details out of long-term Profile data.

## 10. Stage Eight: Multi-City, Cross-Border, and Extended-Stay Travel

**Status: Later development**

This stage allows one Plan to continue across multiple cities, countries, time zones, and jurisdictions.

Develop the following capabilities:

- ordered destination segments;
- arrival, departure, and intercity transportation nodes;
- flights, rail, and other long-distance movement;
- current-destination transitions based on dates and explicit arrival events;
- Country Pack selection by trip segment;
- official sources and policy review by jurisdiction;
- localized dates, currencies, units, and traveler-facing presentation;
- long-term housing, study, work, and daily-life Tasks;
- persistent progress across every segment of the trip.

Target scenario:

> A traveler visits one country, continues to a second country, and then settles in a third city for an extended stay. Landi uses one Plan to manage transitions, transportation, lodging, local preparation, and continuing Tasks.

## 11. Supporting Development Tracks

These tracks support the product roadmap and should advance alongside the main stages.

### Data and recovery

- SQLite schema migrations;
- verified backup and user-approved recovery;
- deletion of historical travel data;
- data-retention rules;
- sensitive-data minimization;
- database and system-key protection.

### External services

- Connector configuration and health;
- authentication-expiration and quota visibility;
- real-device validation for Google Maps, Weather, Telegram, and Uber;
- explicit degradation when a provider is unavailable;
- freshness and historical retention for official evidence.

### Long-running operation

- existing macOS background operation;
- Linux, Windows, and hosted deployment paths;
- restart recovery;
- Reminder and message deduplication;
- network failure and rate-limit handling;
- scheduling records and operational diagnostics.

### Quality validation

- ordinary sightseeing;
- fixed events and time-sensitive travel;
- family or group travel;
- extended stays;
- multi-city, cross-border travel;
- desktop and mobile interaction;
- version conflicts, restart recovery, and disruption-driven replanning.

## 12. Development Sequence from the Current Repository

Development should now follow this order instead of adding more isolated travel features:

```text
Stabilize the current planning and test baseline
  -> Introduce persistent travel monitoring jobs
  -> Move weather and venue checks into the shared scheduler
  -> Introduce Travel Attention
  -> Complete venue-closure partial replanning
  -> Complete weather-disruption partial replanning
  -> Unify the Telegram in-trip experience
  -> Add route, reservation, and policy-change monitoring
  -> Expand to multi-city and cross-border travel
```

The most important next product result is not another page or Connector. It is this complete loop:

```text
Detect a change
  -> Understand the impact
  -> Offer an adjustment
  -> Obtain approval
  -> Update the Plan
  -> Continue the trip
```
