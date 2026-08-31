# On-trip Execution Assistance implementation plan

This document translates the agreed Travel Execution Capability scope into implementation work. It is a planning artifact, not executable behavior. The first validation scenario is Bali, but the capability must remain destination-neutral.

## Agreed scope

The first slice helps a traveler act during a trip through Execution Action Cards. It does not create a destination pack, pre-departure guide, booking flow, payment flow, live fare integration, provider dispatch, or automatic replanning.

Implementation surface:

- backend domain/service code;
- Telegram command parsing and message rendering;
- tests and validation fixtures;
- no Web frontend changes.
- no new database table for Execution Action Card history.
- avoid database schema changes unless existing Telegram interaction state cannot safely support required feedback.
- no `@c-assistant/core` Plan or Trip Blueprint schema changes for Execution Action Cards.

Supported first-slice cards:

- Movement Action Card: help the traveler get to the Next Planned Stop in the current Execution Plan.
- Nearby Food Action Card: find Ephemeral Nearby Choices from a One-time Location Share.
- Weather Impact Action Card: interpret weather against the current plan or action and suggest a temporary Execution Adjustment.

Primary channel:

- Telegram is the first Execution Channel.
- Web remains the existing planning, Plan display, and configuration surface.
- Web does not show per-step Execution Action Card records in this slice.
- This slice should not add new Web pages, Web configuration fields, or Web execution controls.

## Non-goals

- No Bali, Indonesia, or Regional Pack boundary.
- No Web frontend changes.
- No Execution Action Card history table.
- No Grab or Gojek API dependency.
- No automatic ride-hailing, restaurant booking, food ordering, lodging booking, payment, or external state change.
- No continuous location tracking.
- No arbitrary free-navigation destination for `/go`.
- No automatic long-term preference learning from card feedback.
- No live web search during execution service resolution.

## Existing capabilities to reuse

- Active Plan lifecycle and Execution Plan boundary.
- Telegram commands, buttons, and One-time Location Share intent.
- Google Maps geocoding, route facts, nearby place discovery, and map handoff links.
- Google Weather lookup where covered.
- Existing route-handoff timing and `I haven't arrived` style handling.
- Existing external-action safety boundary.

## Workstreams

## First development slice

The first development slice is the smallest demonstrable path for the Travel Execution Capability:

- `/go` Movement Intent Command;
- Movement Action Card;
- Execution Service Catalog;
- Service Capability Resolution;
- Local Transport Recommendation;
- Bali one-route validation.

Generic `/food` and contextual `/weather` remain in the first-slice product scope, but they follow after the Movement Action Card path is proven.

Recommended implementation order:

1. Define the shared Execution Action Card domain contract.
2. Add Execution Service Catalog and Service Capability Resolution.
3. Implement Local Transport Recommendation.
4. Add Telegram `/go`.
5. Validate the first Movement Action Card end to end.
6. Generalize `/food`.
7. Upgrade `/weather` from lookup-only to contextual impact when possible.
8. Add minimal Execution Card Feedback.
9. Verify the new backend contracts do not break the existing Web planning, Plan display, and configuration surfaces.
10. Run the Bali Validation Scenario.

### 1. Action card domain contract

Define a destination-neutral card contract for:

- card kind: movement, nearby food, weather impact;
- primary recommendation and alternatives;
- rationale and Recommendation Context;
- testable reason fields such as `rationaleCodes`, `visibleRationale`, `degradedReasons`, and `blockingReasons`;
- handoff options: map link, prefill-capable handoff, manual handoff, copyable details;
- degraded state and non-blocking gaps;
- blocking state and traveler-facing recovery message;
- feedback actions: `I haven't arrived`, `Try another option`, `Open Plan`.

The contract should not expose Service Capability Resolution diagnostics to the traveler.
Do not expose debug-only fields on the product card object.
The first slice should keep card state in the active Telegram interaction and existing execution state where possible, rather than creating a durable card-history model.
The first implementation should keep this contract in server-side execution code, not in the long-term Core Plan or Trip Blueprint domain.
Avoid database schema changes for the first contract unless existing Telegram callback or interaction state cannot safely carry the required feedback.

### 2. Execution Service Catalog

Add static Service Catalog Entries that can be matched by destination and Local Transport Option.

First implementation location:

- keep the catalog as code-owned static configuration, for example in a server module;
- ship it with the application version;
- cover the Bali Validation Scenario with static Manual Handoff entries;
- do not add a user-editable settings surface or database-backed service table in the first slice.

First-slice requirements:

- represent connected providers such as Google Maps and Uber;
- represent Manual Handoff services such as Grab, Gojek, Bluebird, or private driver;
- mark whether a service is prefill-capable or manual-only;
- support simple destination matching only;
- match by normalized country plus optional city or area strings;
- avoid modeling live availability, live fare, neighborhood restrictions, pickup rules, or provider-specific dispatch state.

### 3. Local transport recommendation

Build deterministic recommendation logic for Movement Action Cards.
Use simple priority rules for the first implementation rather than a weighted scoring model.

Allowed Recommendation Context:

- distance;
- estimated duration;
- weather;
- day or night timing;
- luggage;
- party size;
- traveler preference.

Required Local Transport Options:

- walking;
- ride-hail car;
- ride-hail motorbike;
- private driver;
- scooter rental.

Rules:

- Route Modes remain separate from Local Transport Options.
- map the existing Plan `taxi` preference to the `ride-hail car` Local Transport Option, not to a specific provider such as Uber;
- treat the existing Plan `public_transit` preference as a weak preference for movement cards; when transit facts are unavailable or unsuitable, recommend a safer locally applicable option such as ride-hail car with a short explanation;
- allow current safety and comfort factors such as distance, night, rain, or heat to override a `walking` preference with a ride-hail car primary recommendation and a short explanation;
- Scooter rental is rider-confirmed only.
- for `plan_recommended`, use ride-hail car as the safest default; make walking primary only for short daytime acceptable-weather movements, allow ride-hail motorbike as primary or alternative only for short or medium daytime no-rain no-luggage movements, use private driver mainly for long or cross-area alternatives, and include scooter rental only when rider-confirmed.
- use conservative first-slice distance bands: walking-friendly at 800 m or less, motorbike/car-relevant from over 800 m through 8 km, and long or cross-area over 8 km;
- classify weather impact for movement with only rain, severe weather, and heat in the first implementation;
- treat local time from 20:00 through 06:00 as night for first-slice movement rules;
- treat unknown luggage as a light personal or laptop bag for conservative first-slice movement rules, which prevents motorbike or scooter from becoming the primary recommendation;
- treat unknown party size as one traveler for current recommendation ranking only, without writing it to the Plan or Profile;
- short distance, good weather, and daytime may make walking primary;
- night, rain, luggage, or long distance should prefer ride-hail car;
- short or medium distance with daytime, no rain, and no luggage may allow ride-hail motorbike as primary or alternative;
- private driver is mainly a long-distance or cross-area alternative;
- Missing non-blocking facts produce Conservative Execution Defaults and Degraded Action Cards.
- Missing blocking facts prevent the card and explain the next recoverable step.

### 4. `/go` Movement Intent Command

Replace the traveler-facing movement entry with provider-neutral `/go`.

Implementation shape:

- add a dedicated server-side `next-planned-stop.ts` helper for deterministic Next-stop Selection;
- add a dedicated server-side `local-transport-recommendation.ts` helper for deterministic Local Transport Recommendation;
- add a dedicated server-side `execution-service-catalog.ts` module for code-owned static Service Catalog Entries and Service Capability Resolution;
- add a dedicated server-side `movement-action-card.ts` service for `/go`;
- make `movement-action-card.ts` return a provider-neutral card object;
- render Telegram text and buttons through a separate `telegram-movement-card.ts` formatter, following the existing `telegram-food.ts` style;
- reuse existing connector route facts and map handoff helpers where appropriate;
- do not extend `arrival-route.ts` as the primary implementation because it is arrival-to-lodging and Uber-specific.

Behavior:

- require a current Execution Plan;
- use `movement_go` as the Telegram location intent purpose;
- select the Next Planned Stop deterministically from the Execution Plan using current travel date, local time, scheduled stop times, and itinerary order;
- treat a stop planned within the past 60 minutes as still actionable but degraded;
- treat a stop planned more than 60 minutes ago as stale enough to block `/go` until the traveler confirms or reviews the Plan;
- support a `Yes, still go` confirmation for a stale Next Planned Stop before continuing to the Movement Action Card;
- implement `Yes, still go` as Telegram callback data carrying enough context to avoid ambiguous free-text confirmation;
- do not automatically skip to a later stop when the selected stop is stale;
- allow untimed stops only when itinerary order yields one clear next target for the current day;
- block rather than guess when multiple untimed stops could be next;
- block with a recoverable message when no suitable Next Planned Stop exists;
- request a One-time Location Share when current position is required and produce the Movement Action Card only after the traveler shares that location;
- do not guess the origin from lodging, a previous stop, or itinerary order when current position is required;
- resolve origin and destination through Google Maps;
- gather route facts using supported Route Modes;
- produce a Movement Action Card with one primary recommendation and useful alternatives;
- include Google Maps handoff and applicable Manual or Prefill-capable Handoffs.
- first development slice buttons should be limited to `Open in Google Maps`, `Copy pickup`, `Copy destination`, and `Open local ride app/service` when applicable.
- copy actions may be satisfied by long-press-copyable Telegram message text when Telegram buttons cannot write to the clipboard.
- local ride app/service handoff may be satisfied by service name, instructions, and copyable pickup/destination details; a stable app link is an enhancement, not a requirement.
- include a short external-action reminder, such as "Confirm pickup, price, vehicle, and payment in the app before requesting."
- use Landi's current English product language for first-slice Movement Action Card copy.
- generate Movement Action Card recommendations and rationale deterministically without an Agent or LLM call.
- do not include buttons for ride confirmation, payment confirmation, or arrival completion.
- respond only to explicit traveler invocation in the first slice.

Non-goal:

- do not proactively push Movement Action Cards from departure reminders in the first slice.

The existing `/uber` path should be replaced by `/go`, including help text and tests. First-slice implementation should not keep a separate provider-specific diagnostics command as an alternate movement entry.

### 5. Generic `/food`

Move nearby food execution out of Country Pack ownership.

Behavior:

- request or use a One-time Location Share;
- use party size when known and apply a conservative default when absent;
- use Google Places nearby food candidates;
- produce a Nearby Food Action Card;
- keep results as Ephemeral Nearby Choices;
- include Google Maps place handoffs;
- never reserve, order, pay, or modify the Plan.

When enough Plan or current-area context exists, the card may be more contextual. Without that context, it degrades to one-time nearby search.

### 6. Contextual `/weather`

Keep `/weather` as the weather entrypoint but distinguish Weather Lookup from Weather Impact.

Behavior:

- use Google Weather where covered;
- return Weather Lookup when plan or current-action context is insufficient;
- return Weather Impact Action Card when enough context exists;
- recommend only temporary Execution Adjustments;
- avoid automatic Trip Blueprint revision, Plan mutation, or replacement draft activation.

### 7. Execution card feedback

Support minimal feedback on cards.

Required feedback:

- `I haven't arrived`;
- `Try another option`;
- `Open Plan`.
- `Yes, still go` for a stale Next Planned Stop.

Rules:

- `I haven't arrived` may redisplay current movement help or adjust existing arrival guidance timing, but it must not mark stop state, change itinerary order, or trigger replanning.
- `Try another option` only performs Alternative Action Selection inside the existing Recommended Action Set.
- implement `Try another option` as Telegram callback data with minimal context such as Plan ID, Plan version, stop ID, and option ID; regenerate the same card context and promote the chosen option to primary rather than storing card history.
- `Yes, still go` affects only the current `/go` interaction and does not change itinerary order or Plan state.
- all `/go` callbacks must validate Plan ID and Plan version against the current Execution Plan; stale callbacks should ask the traveler to send `/go` again.
- Feedback may affect the current execution interaction only.
- Feedback must not call an Agent, create a new destination, mutate the itinerary, start replanning, or update long-term Profile preferences without separate explicit confirmation.
- Do not add an `I arrived` completion path or stop-completion state in the first slice.

### 8. Web boundary

Keep Web out of the first-slice implementation except for compatibility with existing surfaces.

Web responsibilities:

- create and revise plans;
- display Plan and Trip Blueprint content;
- expose configuration and readiness needed by execution;
- continue to show maps and plan context.

First-slice Web non-responsibilities:

- no frontend code changes;
- no Execution Action Card history table;
- no new Web pages;
- no new Web configuration fields;
- no new Web execution controls;
- no Execution Action Card history;
- no per-step execution timeline;
- no replicated Telegram card controls;
- no saved One-time Location Share coordinates;
- no provider receipts or external action state.

### 9. Bali validation scenario

Use Bali only as the first Validation Scenario.

The minimum Bali validation path may use one fixed route from a lodging anchor to the Next Planned Stop. It does not need to cover a complete multi-day itinerary.
The fixture should include a globally configured Uber capability that is not locally applicable to Bali, so validation proves Service Capability Resolution does not recommend Uber merely because it is configured.
Bali first-slice Service Catalog Entries should include only Grab, Gojek, Bluebird, and private driver Manual Handoffs. Scooter rental remains a rider-confirmed Local Transport Option, but the first slice should not recommend specific rental vendors.

Success must not depend on Grab or Gojek APIs. The scenario should pass with:

- Google Maps;
- Google Weather where covered;
- Telegram;
- existing Web Plan display and configuration remaining unchanged;
- static Execution Service Catalog entries;
- map links and copyable pickup or destination details.

Validation should prove:

- `/go` selects the next itinerary stop deterministically without invoking an Agent;
- `/go` does not offer Uber when the service is not locally applicable;
- ride-hail car or ride-hail motorbike can be shown through Manual Handoff;
- scooter rental appears only after rider confirmation;
- one fixed lodging-to-stop route is enough to validate the core movement chain;
- weather can affect transport recommendation without mutating the Plan;
- `/food` works without Country Pack coupling;
- Web does not show per-step Execution Action Card records.

## Test strategy

Automated tests should focus on deterministic behavior:

- Next-stop Selection;
- Local Transport Recommendation;
- Service Capability Resolution;
- Movement Action Card formatting;
- `/go` location request flow;
- Bali one-route fixture.

Telegram real-device validation may be performed manually, but it is not an automated gate for the first development slice.

## Acceptance criteria

First development slice acceptance:

- A traveler with an active Execution Plan can use `/go` in Telegram.
- Landi selects the Next Planned Stop deterministically.
- Landi requests a One-time Location Share when needed.
- Landi produces a Movement Action Card with one primary Local Transport Recommendation and useful alternatives.
- Landi resolves local service handoff behavior from the code-owned Execution Service Catalog.
- Bali validation passes with one fixed lodging-to-stop route and without Grab or Gojek API credentials.

Full first-slice acceptance:

- A traveler with an active Execution Plan can use `/go` in Telegram and receive a Movement Action Card for the Next Planned Stop.
- A traveler can use `/food` in Telegram and receive a Nearby Food Action Card backed by nearby place facts.
- A traveler can use `/weather` and receive either Weather Lookup or Weather Impact depending on available context.
- Movement cards present one primary recommendation plus alternatives when useful.
- Cards use Manual Handoff when prefill-capable local provider support is unavailable.
- Cards degrade safely when non-blocking context is missing.
- Blocking gaps produce a recoverable explanation instead of a misleading card.
- Card feedback does not mutate the Plan or Profile.
- No new Web surface is required.
- Bali validation passes without Grab or Gojek API credentials.

## Open implementation decisions
