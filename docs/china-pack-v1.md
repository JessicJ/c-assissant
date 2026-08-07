# China Country Pack V1

The China Country Pack is distributed as one complete pack. Users do not install or run its internal Skills independently in V1.

## Product scope

The Pack helps foreigners prepare for and adapt to life in China. It is a regional assistant, not only a travel assistant. V1 focuses on arrival preparation and the first useful layer of food, accommodation, and transport. Later versions may add legal, banking, business, healthcare, education, and other local-life domains.

## Internal Skills

### `china-arrival-plan`

Composite entry point. Core orchestrates the supporting Skills and compiles one complete Plan. It is not one giant prompt.

Implemented slice: `china-arrival-plan` `0.1.0` is a fail-closed composition gate in the China Skill Registry. All seven supporting modules now exist. The gate binds supplied results to an exact Plan ID/version, orders them according to this document, preserves Skill versions, statuses, summaries, assumptions, recommendations, sources, and warnings, and remains `blocked:composition_incomplete` whenever a particular run omits a required result. Until Core compilation and authorization are connected, it deliberately promotes no Plan changes, Tasks, Reminders, or action cards.

Compilation boundary: a China-specific adapter requires the exact `arrival-preparation` version and status recorded by a ready composite before producing the country-neutral Core proposal. Core independently verifies the target draft Plan ID/version and proposal structure, then creates a new draft version with inert Tasks and Reminders. Server connects approved-source preparation, normalized fact collection, orchestration and atomic SQLite persistence; Web and Telegram show the complete saved draft before the separate version-bound confirmation step. The save includes compilation provenance plus minimized compilation and per-Skill Runs.

Orchestration boundary: the China package now has a deterministic orchestrator that receives normalized, credential-free facts and invokes the seven supporting Skills through the Registry in the declared order. It derives bounded preparation items from successful policy-review readiness, weather prompts, housing/transport recommendations, and incomplete digital setup, then runs arrival preparation, the composite, the China Adapter, and Core compiler. A critical `needs_input` or blocked supporting result prevents compilation. Provider fetching, source-catalog expansion, SQLite invocation, UI presentation, confirmation, and activation remain host responsibilities.

Host service boundary: Server captures an exact draft Plan/Profile snapshot, asks an injected Fact Collector for normalized provider facts, invokes the orchestrator, and submits a successful compilation to SQLite's compare-and-write operation. It returns separate blocked stages for preconditions, fact collection, orchestration, and persistence. It never sends a message or activates the resulting Plan; Server dependency assembly and a Web/Telegram review trigger remain to be implemented.

Fact collection boundary: the first production collector resolves the Plan destination with Amap, collects QWeather facts and nearby accommodation POIs, and requests route modes only from a Plan-saved accommodation coordinate to the destination. It never promotes an accommodation search result into a chosen route origin. Policy evidence is limited to immutable saved snapshots explicitly linked to the exact Plan, while local-food and digital-life material comes from injected Country Pack reference catalogs. The collector passes metadata and normalized facts—not credentials, official-page excerpts, or raw provider failures—to orchestration.

Digital-life catalog boundary: V1 contains bounded setup items for China Mobile SIM, WeChat, Amap, and Alipay, covering all four initial capabilities. Their approved source IDs point to the China Mobile foreign-customer guide, WeChat and Amap official download pages, and the State Council's English working-and-living guide. Runtime selects only the newest matching immutable snapshot and never passes its page excerpt to the Skill. Missing or stale source evidence leaves the corresponding capability unresolved rather than silently relying on bundled text.

### `policy-applicability`

Matches official requirements to nationality, passport or travel document, visa or permit, residence status, student status, purpose, date, and location. A missing requirement becomes a user-owned Task with a Reminder when appropriate; it does not automatically block unrelated parts of the Plan.

Implemented slice: `policy-applicability` `0.1.0` owns the production evidence-preparation gate. Server supplies only nationality, known immigration status, Plan destination and dates, and official snapshot metadata. The Skill requires an approved National Immigration Administration English snapshot inside a seven-day freshness window, rejects unapproved or malformed evidence, and preserves its title, authority, URL, retrieval time, and fingerprint. Its `success` outcome means only ready for a separate source-backed review; it does not read policy text or determine a policy, visa, residence, entry, or eligibility outcome.

### `arrival-preparation`

Builds the preparation checklist and timing for entry documents, communications, essential apps, payments readiness, luggage, and arrival logistics.

Implemented slice: `arrival-preparation` `0.1.0` receives normalized preparation items from the six preceding supporting Skills, deduplicates them by stable semantic key, preserves every source Skill ID/version, and gives a user-confirmed completed state precedence. It proposes Tasks only for remaining items. A Reminder is calculated only from an explicit departure or arrival timestamp whose offset agrees with its IANA time zone and a bounded lead time; missing time is requested only for a critical item that actually needs that anchor. Weather refresh must be explicit and is permitted only for packing or transport. These remain proposals until Core binds them to the reviewed Plan version and the user confirms activation.

### `digital-life-setup`

Explains the local apps and account setup needed by the active Plan. It provides English steps and links to original official material when available.

Implemented slice: `digital-life-setup` `0.1.0` receives capability needs already derived from the current Plan rather than asking the user to select apps first. It accepts only normalized setup material linked to a Country Pack-approved first-party source snapshot inside a 30-day freshness window, preserves the Chinese original name, and returns an English reason and up to eight English steps. User-confirmed completed items remain visible as facts but are omitted from recommendations and links. The Skill does not install apps, register accounts, handle credentials, create Tasks or Reminders, or infer completion from opening an official link.

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

Implemented slice: `transport-planner` `0.1.0` receives normalized Amap route facts plus this Plan's preference, party size, luggage, and an optional QWeather fact already matched to the expected arrival date. It returns a structured preliminary mode, reasons, limitations, source timestamps, and an external Amap handoff proposal. Walking is considered through relative route duration rather than a fixed distance threshold. The Skill never starts navigation, hails a ride, books, pays, or marks a Task complete.

### `local-food-guide`

Adds local specialties and useful food context to the Plan. It avoids prematurely scheduling specific restaurants unless the user asks.

Implemented slice: `local-food-guide` `0.1.0` accepts only normalized food facts linked to an official-source ID from the Country Pack allowlist and a snapshot retrieved inside a 30-day freshness window. It preserves each Chinese original name, adds an English name and explanation, deduplicates and limits the Plan-time result to five items, and degrades rather than inventing local specialties when no traceable fact is available. It does not select restaurants or propose map, order, reservation, payment, or completion actions; specific places remain the later `food-nearby` flow.

### `food-nearby`

On arrival or request, recommends nearby places using Amap facts and current context. It may ask or reuse the current party size when that changes the result.

Implemented slice: `food-nearby` `0.1.0` is the first executable internal Skill. It requires Plan-scoped party size, accepts normalized Amap candidates and observation time, preserves Provider order, returns at most five facts and Amap handoff proposals, and leaves recommendations empty until trustworthy preference or availability facts exist. Telegram renders this structured result; it does not own the decision contract.

### `weather-and-packing`

Uses seasonal guidance when the trip is too far away for a reliable forecast and schedules a later refresh. Near the relevant date, it uses current weather facts to update packing guidance and reminders. A reminder must explicitly declare that destination weather materially affects its immediate Task; only then does the current delivery path resolve the Plan destination with Amap and refresh QWeather. Only an exact-date forecast is presented as a forecast, provider attribution is retained in the message, and failure falls back to the original reminder without invented weather.

The paired user may also send `/weather` for an immediate read-only check of the current Plan destination. This path returns current observation and dated three-day facts with QWeather attribution and cautious packing notes. It neither activates the Plan nor creates a Reminder.

Implemented slice: `weather-and-packing` `0.1.0` is invoked by Web weather cards, Telegram `/weather`, and Task Reminder weather refresh. It validates normalized QWeather facts and provenance, applies one consistent set of conservative rain, cold, heat, and UV prompts, and omits non-QWeather attribution links. A Reminder target date uses only an exact matching forecast; otherwise the Skill returns a degraded current observation with an explicit warning. It proposes no Plan, Task, or Reminder mutation.

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
