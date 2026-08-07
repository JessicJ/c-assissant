# China Country Pack V1

The China Country Pack is distributed as one complete pack. Users do not install or run its internal Skills independently in V1.

## Product scope

The Pack helps foreigners prepare for and adapt to life in China. It is a regional assistant, not only a travel assistant. V1 focuses on arrival preparation and the first useful layer of food, accommodation, and transport. Later versions may add legal, banking, business, healthcare, education, and other local-life domains.

## Internal Skills

### `china-arrival-plan`

Composite entry point. Core orchestrates the supporting Skills and compiles one complete Plan. It is not one giant prompt.

### `policy-applicability`

Matches official requirements to nationality, passport or travel document, visa or permit, residence status, student status, purpose, date, and location. A missing requirement becomes a user-owned Task with a Reminder when appropriate; it does not automatically block unrelated parts of the Plan.

The current implemented slice is deliberately narrower: an evidence-preparation gate checks that the active Profile has nationality and known immigration status, the Plan has a destination and dates, and a saved National Immigration Administration snapshot is no more than seven days old. Its only outcomes are `needs_input`, `needs_evidence`, and `ready_for_review`. It does not read the source text to determine a policy, visa, residence, or entry outcome; that remains the responsibility of a future source-backed Skill review.

### `arrival-preparation`

Builds the preparation checklist and timing for entry documents, communications, essential apps, payments readiness, luggage, and arrival logistics.

### `digital-life-setup`

Explains the local apps and account setup needed by the active Plan. It provides English steps and links to original official material when available.

### `housing-area-recommendation`

Recommends two or three areas based on event locations, commute, time, transport, and Plan preferences. Amap provides area and route facts. V1 may hand off a search to Ctrip, but it does not promise live inventory, prices, booking, or foreign-guest eligibility without a verified source.

If accommodation is already booked, Core asks only for the place needed to integrate it into the Plan.

Implemented slice: `housing-area-recommendation` `0.1.0` compares current Amap accommodation POIs with one user-selected Plan anchor. It gives at most three preliminary access reasons, labels nearby-place distance as distinct from a real commute, and refuses to infer live price, inventory, booking, payment, quality, or foreign-guest eligibility. Multi-anchor area choice and route-based reasons remain later work.

### `transport-planner`

Recommends transport using party size, luggage, time, weather, route facts, accessibility needs, and this Plan's preference. After Plan confirmation, execution uses the selected option with minimal intervention while retaining alternatives.

At a planned arrival time, Core may send a transport card using the expected airport or station and destination without first asking for GPS. The card includes:

- open in Amap;
- I am not there yet;
- change destination.

If the user does not respond after an appropriate buffer and location would materially improve the action, Telegram may send one explicit location request. Exact GPS is task-scoped and short-lived.

V1 does not hail or pay for a ride.

### `local-food-guide`

Adds local specialties and useful food context to the Plan. It avoids prematurely scheduling specific restaurants unless the user asks.

### `food-nearby`

On arrival or request, recommends nearby places using Amap facts and current context. It may ask or reuse the current party size when that changes the result.

Implemented slice: `food-nearby` `0.1.0` is the first executable internal Skill. It requires Plan-scoped party size, accepts normalized Amap candidates and observation time, preserves Provider order, returns at most five facts and Amap handoff proposals, and leaves recommendations empty until trustworthy preference or availability facts exist. Telegram renders this structured result; it does not own the decision contract.

### `weather-and-packing`

Uses seasonal guidance when the trip is too far away for a reliable forecast and schedules a later refresh. Near the relevant date, it uses current weather facts to update packing guidance and reminders. A reminder must explicitly declare that destination weather materially affects its immediate Task; only then does the current delivery path resolve the Plan destination with Amap and refresh QWeather. Only an exact-date forecast is presented as a forecast, provider attribution is retained in the message, and failure falls back to the original reminder without invented weather.

The paired user may also send `/weather` for an immediate read-only check of the current Plan destination. This path returns current observation and dated three-day facts with QWeather attribution and cautious packing notes. It neither activates the Plan nor creates a Reminder.

## Composition order

Core runs the composite workflow in this order:

1. normalize explicit request, relevant Profile fields, and existing Plan state;
2. evaluate policy applicability;
3. produce weather and packing guidance;
4. recommend accommodation areas or integrate existing accommodation;
5. plan transport between known places and events;
6. add local food guidance;
7. add digital-life setup;
8. assemble and deduplicate arrival preparation;
9. compile Stages, Tasks, Reminders, Events, Decisions, Sources, and assumptions into one Plan;
10. validate and present the complete Plan for confirmation.

## Data and provider boundaries

- Amap is the V1 base for place discovery, routes, weather where available, and action handoff.
- AI decides between areas and options using structured Plan context.
- Ctrip is a possible accommodation search handoff only; its exact deep-link behavior still requires validation.
- Meituan, Airbnb, direct ordering, direct booking, direct payment, and direct ride hailing are not V1 integrations.
- Users complete transactions in the original application.
- Policy conclusions require current official sources and retain direct links to original material.

## First demonstrable slice

The first end-to-end demo should:

1. accept a natural-language China plan;
2. identify or request only critical missing facts;
3. generate and display a complete Plan;
4. allow one confirmation to activate it;
5. schedule an arrival Event;
6. refresh weather and route facts near execution;
7. send a Telegram transport card at the planned arrival time;
8. hand off to Amap while recording that completion remains unknown.
