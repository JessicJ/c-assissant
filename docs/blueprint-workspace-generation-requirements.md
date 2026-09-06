# Blueprint Workspace Generation Requirements

Status: Working requirements draft
Last updated: 2026-09-04
Scope: Landi-native travel planning generation, Trip Blueprint content shape, Skill Importer expectations, and Web Plan Workspace presentation. This draft does not authorize code implementation by itself.

## Purpose

This document defines the next design direction for Landi's plan generation and Web workspace presentation. It keeps the current conversational creation flow, replaces the implicit `interactive-trip-planner` product shape with Landi-owned content modules, and makes the generated plan both beautiful to read and practical to adjust.

The desired result is not a static guide and not only an executable checklist. It is a structured travel workspace where the traveler can review, compare, adjust, and then activate the plan.

## Draft Summary

This draft establishes the baseline for replacing the current `interactive-trip-planner` product shape with a Landi-native planning loop:

```text
Landi-native Blueprint Skill
  -> Landi Trip Blueprint Contract
  -> Skill Importer safe normalization
  -> Plan Compiler
  -> Web Plan Workspace rendered with Landi components
```

Settled product decisions:

- Web remains chat-led for intake and does not add a heavy visible Planning Proposal page.
- The generated plan has three primary content areas: Itinerary, Preparation, and Tips. Sources is a supporting workspace view for evidence inspection.
- Attractions, dining, shopping, and local experiences live as itinerary sub-branches over a shared Guide Catalog.
- The itinerary is a complete recommended plan first, not an empty composition canvas.
- The itinerary sequence presents the time-ordered plan; it is not the primary arrangement tool and does not require a visible line-and-dot timeline treatment.
- The desktop Web workspace is itinerary-sequence-led, with map support and one shared side panel for explore/detail.
- The Web workspace does not target mobile layout or mobile editing.
- Guide Cards are short browsing units; rich value explanation, source context, and comparison live in details.
- Guide source disclosure uses small image markers only when a real image is present; text-only cards, tips, and details use unobtrusive source text or links instead of standalone `i` markers.
- Multiple concrete dining, shopping, and experience options appear as peer choices, not candidates or forced recommendations.
- Preparation is a travel-readiness checklist, not a generic life-advice task list.
- Tips are destination-relevant local cautions, not generic travel inspiration.
- UGC and social material are optional Source Channels, not required dependencies or verified evidence.
- Images are optional enhancements; missing images should not create placeholders.
- Skill output must be structured Landi-native content, not HTML or skill-owned Web UI.

## Product Goal

After a traveler chats with Landi and provides enough trip context, Landi should generate a complete, modular travel blueprint organized around three top-level workspace areas:

- itinerary;
- pre-departure preparation;
- travel tips.

The itinerary is the primary plan presentation surface and contains the elements that compose the trip: attractions, dining, shopping, and local signature experiences. Landi should generate a complete recommended itinerary first, using available time, weather context, user preferences, trip constraints, and evidence. The traveler can apply that plan directly, or use the connected image-and-text sub-branches to understand options and replace, add, remove, or adjust itinerary elements through pending edits.

Pre-departure preparation and travel tips remain separate top-level areas because they serve different user jobs: preparing before travel and understanding local customs, norms, and practical cautions.

## Creation Flow

Landi should keep the current Web interaction style:

```text
Chat with Landi
  -> Landi asks only missing route-shaping questions
  -> Landi confirms the planning direction naturally in conversation
  -> Landi generates a modular Trip Blueprint with a complete recommended itinerary
  -> Web opens the Plan Workspace for review and adjustment
  -> traveler edits, promotes, locks, removes, or asks Landi to rework parts
  -> Landi shows impact before material changes
  -> traveler confirms the complete Plan for execution
```

The product should not introduce a heavy visible "Planning Proposal" page. Internally, Landi may keep a planning direction checkpoint for versioning, deduplication, and generation safety.

## Architecture

```text
Web Conversational Intake
  -> Planning Direction Checkpoint
  -> Landi-native Blueprint Skill
  -> Skill Importer
  -> Trip Blueprint Version
  -> Plan Workspace Presentation Areas
  -> Direct Blueprint Revision or Assisted Replanning
  -> Plan Compiler
  -> Draft Plan review
  -> Execution Plan activation
```

### Web Conversational Intake

The user starts from the existing chat-based planning flow. Landi gathers only the facts needed to generate the correct trip boundary, such as destination, dates, purpose, party, fixed bookings, transportation preference, and important constraints.

### Planning Direction Checkpoint

This is an internal record of the understood trip direction. It may be represented by the current `PlanningProposal` model, but the user-facing experience should remain natural: Landi summarizes the direction and starts generation when the user has clearly accepted it.

### Landi-native Blueprint Skill

The new generation skill should output Landi-native structured content, not UI, HTML, or map-specific state. It should produce enough detail for the three top-level workspace areas and the itinerary guide sub-branches, with enough metadata for Web to make them interactive.

The skill may use many Source Channels for guide themes, visual direction, local products, and possible experiences. Social, UGC, review, short-video, image-board, and travel-community platforms are optional channels, not required dependencies. Inspiration Sources must remain separate from evidence. Any claim that affects reliability, timing, route choice, reservation need, official requirements, safety, or execution must be checked against a more authoritative source such as maps data, official sources, merchant pages, or other structured provider facts.

Platform selection must support global travel planning without requiring fixed regional strategies. Landi should use Source Capability Selection: choose sources by the capability needed, destination coverage, traveler language, content type, and available connectors. Region can inform coverage quality, but the architecture should not start from hard-coded country or region source bundles.

The source mix may vary by planning need:

- visual inspiration;
- restaurant discovery;
- shopping and local product ideas;
- local experience discovery;
- review or popularity signals;
- maps and place facts;
- merchant pages and booking facts;
- official verification.

Missing UGC or social Inspiration Sources should not block complete plan generation when maps, official, merchant, review, image search, or other structured facts are sufficient for a useful plan. UGC is only one possible Source Channel. When social material is unavailable or low-quality, Landi should produce a more conservative reliable-guide presentation with less social or lifestyle texture.

The Skill should follow Guide Content Selectivity. It should prioritize Schedulable Itinerary Objects and use Informational Guide Items only when they add meaningful context for understanding local food, products, culture, customs, or experience choices. It should avoid producing large volumes of theme-only background content, encyclopedic guide copy, or filler cards that cannot help the traveler review or adjust the plan.

Guide Content Selectivity should not become a fixed content ratio or quota per destination or guide type. The amount of backup material should follow trip context, evidence quality, and usefulness rather than a numeric coverage target.

### Skill Importer

The importer validates and normalizes skill output into Landi's Trip Blueprint contract. It may assign stable IDs, normalize categories, mark uncertain evidence, remove invalid references, and preserve safe content. It must not invent missing facts, silently delete valid places, or turn unverified claims into verified content.

When the Skill outputs a useful theme-level item without a related Schedulable Itinerary Object, the importer should preserve it as an Informational Guide Item and mark it unavailable for timeline placement. It should not discard the content, invent a concrete place, or let Web schedule the theme directly.

This requirements slice does not define a separate post-import enrichment path that later turns Informational Guide Items into schedulable guide material.

### Trip Blueprint Version

The Trip Blueprint remains the source of truth for travel content: places, itinerary days, candidates, guide entries, evidence, movement plans, and action requirements. User edits that change travel meaning should create a new Blueprint Version.

### Plan Workspace Presentation Areas

The Web workspace renders Landi's own presentation areas from the Trip Blueprint and Plan. The skill does not decide the layout. Web chooses the visual language, controls, editing behavior, and navigation.

### Plan Compiler

The compiler turns the reviewed Trip Blueprint into executable Plan data: Tasks, Reminders, preparation work, execution boundaries, and activation state. It does not rewrite travel guide content.

## Content Areas

Attraction guide, shopping guide, local signature experiences, and dining guide are itinerary sub-branches rather than top-level workspace areas. They are different lenses over a shared Guide Catalog. A single place may appear in more than one lens when that helps the traveler decide, for example a historic market may be both an attraction, shopping stop, dining cluster, and local experience.

The workspace should preserve those relationships instead of duplicating independent cards. The generated itinerary should already contain Landi's recommended scheduled stops, timing, and movement structure. Guide material then acts as explainable replacement and enrichment material: when the traveler adds a guide item to a day from any lens, the same underlying place or experience should enter a pending itinerary edit with its guide context still visible. It becomes scheduled or optional itinerary content only after the traveler confirms the edit.

Guide material that is not already part of the recommended itinerary should not recommend a specific day or time by default. It may describe suitable contexts and real constraints, but should not show default replacement-type labels such as "replace lunch" or "replace afternoon shopping" on the card. The traveler chooses when and whether to place it. A specific day or time may be shown only when the item is already scheduled in the recommended itinerary or when a real external constraint requires it.

Guide material should be organized primarily by traveler-facing themes or experiences, with specific places shown inside those cards or groups. The browsing path should start from questions like what to eat, what to buy, what kind of evening to have, or what cultural experience fits the trip, rather than only from a raw place list.

Unscheduled guide cards should use a consistent default anatomy:

- title and local name when useful;
- short Guide Card Summary with image-and-text teaser when a suitable image is available;
- polished text-only presentation when no suitable image is available;
- tags, area, and itinerary state when useful for scanning;
- concrete place or related place identity when the item can be visited, eaten, bought, or experienced somewhere specific;
- compact image-level Source Marker only when the card contains a real image;
- one primary add action that starts an itinerary edit.

They should not show default day, time, replacement-type label, scheduling rationale, full Guide Value Explanation, comparison tables, or long practical details on the card. Those belong in the shared detail panel.

### 1. Itinerary

The itinerary area should remain close to the current embedded workspace while becoming the home for the trip's complete recommended itinerary and schedulable guide material:

- a generated recommended itinerary that is complete enough to use directly;
- map and daily time planning;
- typed itinerary blocks for main stops, meals, shopping, local experiences, transit, rest, and flexible time;
- day, city, and phase navigation;
- scheduled stops and candidate places;
- route or sequence visualization;
- place detail side panel;
- same-day reorder;
- add candidate to day;
- remove ordinary stop;
- change priority;
- route status and recheck notices;
- attraction, dining, shopping, and local-experience sub-branches;
- image-and-text guide cards for itinerary elements.

The itinerary guide material should appear in a unified Itinerary Explore Panel inside the itinerary workspace. It should not be scattered under individual days. The panel should let travelers browse all Guide Cards from one place, including material already scheduled in the recommended itinerary and material that remains available as alternatives or enrichment.

Guide Cards in the panel should be state-aware:

- cards already in the recommended itinerary show an "in itinerary" state and a primary action to locate the corresponding timeline block;
- unscheduled cards show a primary action that starts an itinerary edit;
- cards that are informational only, such as a local product without a concrete purchase place, remain visible in search and filter results and can open details, but do not show a scheduling or add action.

Selecting a scheduled Guide Card should create an itinerary-linked Guide Detail state: the corresponding itinerary block is located and highlighted, and the shared detail panel opens with the Guide Item's image or text content, source context, related guide material, and relevant alternatives. Small Source Markers appear only on images; text-only detail content should expose sources through plain source summaries or links. The same detail panel should also be reachable by selecting the itinerary block directly.

Relevant alternatives should appear only after the traveler opens the shared detail panel. Timeline blocks should not display alternative recommendations by default, so the recommended itinerary remains readable as Landi's proposed plan rather than a crowded comparison board.

The shared detail panel should use Guide Detail Templates. All templates share the same panel shell, source disclosure behavior, related material, alternatives, and adjustment actions, but each content type renders the fields that help that decision:

- attraction details: why it matters, visit style, recommended duration, area, practical notes, route context, and related dining, shopping, or experience links;
- dining details: what to eat, Local Food context, Dining Place Comparison for multiple concrete dining places or food areas, reservation or queue expectations, dietary notes, meal fit, and nearby itinerary links;
- shopping details: what to buy, local product context, Purchase Place Comparison for multiple concrete purchase places, price or quality or convenience signals, tax refund/payment/shipping notes, and nearby itinerary links;
- local-experience details: Experience Theme context, Experience Offering Comparison for multiple concrete offerings, suitable traveler, duration, booking need, seasonal fit, etiquette or risk notes, and related places.

The Skill should not be forced to collapse dining, shopping, and local-experience details into one "best" concrete option. When evidence supports more than one useful option, the Blueprint may include a Guide Option Comparison so Web can show multiple concrete dining places, purchase places, or experience offerings as peer choices. Web should not label them as candidates or mark one as the default recommended option. The traveler can choose the concrete option that best fits distance, route, price, queue, reservation, timing, source state, or personal preference before adding or replacing itinerary content.

Guide Option Comparison should default to compact Option Comparison Rows or a table-like layout rather than large image-led cards for every option. Each row should prioritize Comparison Facts such as name, area, distance or route fit, hours or source state, price or effort, reservation or queue friction, and action controls. Images may appear only as small supporting thumbnails when useful; they should not make peer options feel like separate editorial cards.

Option Comparison Rows should not contain subjective promotional language such as "must-visit", "super popular", "hidden gem", or social-media hype. If subjective appeal is useful and sourceable, it belongs in Guide Value Explanation or supporting guide copy, not in the comparison row. Comparison rows should remain factual, restrained, and useful for decision-making.

Guide Option Comparison may use Neutral Option Ordering to reduce browsing effort. Web may sort peer options by factual convenience signals such as proximity to the current itinerary, route fit, opening-state confidence, reservation friction, queue risk, timing fit, or source freshness. This ordering should not be presented as a recommendation, ranking, or default winner.

Guide details may include a Guide Value Explanation: why a place, food, local product, or experience is worth considering. This explanation supports browsing and comparison. It may use a polished, magazine-like Guide Editorial Voice, but should stay grounded in concrete reasons such as architecture, history, flavor, craft, local life, landscape, collection, ritual, or experience style. It should not use exaggerated advertising language, unsupported superlatives, or empty social-media hype. It is not a Per-block Arrangement Rationale and should not be used to explain why an item appears on a specific day or time.

Guide Editorial Voice should be limited to Guide Value Explanation and supporting guide copy. Functional workspace surfaces should use Functional Workspace Voice: concise, restrained, and optimized for scanning, judgment, and action. This includes Itinerary Timeline blocks, Preparation Checklist items, Travel Tip Cards, Contextual Tip Surfaces, Option Comparison Rows, route status, and action controls.

Guide Card lists should remain short and scannable. Cards may show title, image or polished text teaser, compact tags when they materially help scanning, itinerary state when useful, and compact actions. Full Guide Value Explanation, type-specific comparisons, purchase locations, dining options, experience offerings, practical notes, and source context should open in the shared detail panel.

The Itinerary Explore Panel should be filterable by type:

```text
Attractions
Dining
Shopping
Experiences
```

The unfiltered complete browsing state should exist without requiring a visible "All" chip. It may also support theme, area, and itinerary-state filters when the Blueprint contains that structure, but these controls should appear only when they reduce real browsing friction. Search is not part of the default Explore chrome and should be introduced only if guide volume makes browsing inefficient. These controls should not create separate top-level pages. They are ways to browse and adjust material that belongs to the overall itinerary.

The panel should keep an unfiltered complete guide browsing state inside the Itinerary Explore Panel and default it to the same contextual Guide Relevance Order as filtered views. When the traveler has selected a day or Itinerary Block, the unfiltered state should prioritize material related to that context; when no context is selected, it should fall back to trip-level relevance.

The default order should use Guide Relevance Order: prioritize relationship to the current trip, current day, or selected Itinerary Block, then use secondary signals such as distance, popularity, rating, source richness, freshness, and image availability. This ordering should help the traveler adjust the current plan, not present a generic destination ranking. The ranking reason does not need to be shown on cards by default.

Landi may use time, weather, traveler preferences, constraints, fixed bookings, and evidence to generate the recommended itinerary, but the Blueprint does not need to include explicit arrangement rationale for each scheduled block. Web should not require a "why this was placed here" explanation field to render itinerary details.

The itinerary should clearly distinguish:

- verified route geometry;
- intended movement plan;
- simple visit order line;
- stale route;
- route that needs verification.

The recommended itinerary should include dining, shopping, and local experiences by default when they are relevant to the trip, rather than leaving the day as a sightseeing-only route. They should be represented as typed itinerary blocks:

- attractions and fixed experiences may become main stops by referencing concrete Attraction Places or Experience Offerings;
- dining should normally appear as meal blocks such as breakfast, lunch, dinner, cafes, snacks, or markets by referencing concrete Dining Places or food areas;
- shopping should normally appear as a shopping block or a route-compatible stop by referencing concrete Purchase Places or shopping places;
- local signature experiences may become main stops, evening blocks, half-day blocks, or reservation-sensitive blocks by referencing concrete Experience Offerings depending on duration and commitment.

Dining, shopping, and local-experience blocks do not all need exact start times. When the activity is useful as part of the recommended day but naturally depends on queueing, energy, weather, opening status, or traveler choice, the Skill may emit a Flexible Itinerary Block with rough timing or optional status. It is still part of the Recommended Itinerary, not merely an unscheduled candidate, and should retain its concrete Schedulable Itinerary Object, guide detail, and replacement behavior.

Flexible Itinerary Blocks should still appear in the day's rough sequence. Web should render them with localized Rough Time Labels, such as around lunch, flexible afternoon, or optional evening, rather than leaving the time empty or inventing precise times like 14:00. Exact times should be reserved for fixed bookings, opening-hour-sensitive visits, transport commitments, and blocks where the planned start time materially matters.

Timeline blocks should contain Schedulable Itinerary Objects. Local Food, Local Product, and Experience Theme content may explain why the scheduled object matters, but those theme-level records should not directly occupy the timeline.

These blocks make replacement clearer: the traveler can replace lunch with another dining option, replace a shopping block with a different specialty area, or swap an evening experience without treating every change as the same kind of place deletion.

Itinerary blocks should not show "why this was arranged here" rationale by default. The itinerary sequence should render them as the time-ordered recommended plan, using compact cards focused on time, full place title, type, and only action-relevant short status. Itinerary blocks should not show Source Markers, long descriptions, source lists, route-check badges, internal labels, or full guide copy by default. Selecting a block should open image-and-text details, source context, related guide material, relevant alternatives, and available adjustment actions in the detail panel.

The itinerary sequence should not add a separate day overview, daily summary card, or header module above each day. It should start from the day's concrete Itinerary Blocks. Weather, pacing, fixed commitments, and contextual cautions should appear through relevant blocks, detail panels, route status, Placement Advisories, or Contextual Tip Surfaces.

#### Attraction Sub-branch

The attraction sub-branch is a visual reading and selection surface for sightseeing, museums, landmarks, neighborhoods, nature, and cultural venues.

Expected presentation:

- image-led cards or editorial rows;
- theme groups such as first-time landmarks, architecture, rainy-day museums, neighborhoods, or family-friendly stops;
- Attraction Guide Cards correspond directly to concrete Attraction Places;
- attraction themes are browsing groups only, not separate schedulable objects;
- title, local name when useful, area, category, recommended duration, and concrete place identity;
- why it matters, with enough context to understand the visit;
- best fit, such as morning, rainy day, family-friendly, architecture, art, first-time visit;
- compact image-level Source Marker only when a real image is present;
- relationship labels when the attraction also belongs to dining, shopping, or experience modules;
- actions to start an itinerary edit, compare alternatives, mark must-visit, or archive.

#### Shopping Sub-branch

The shopping sub-branch covers malls, markets, local brands, streets, specialty stores, souvenir areas, and shopping customs.

Expected presentation:

- image-and-text guide cards grouped by area or shopping purpose;
- theme groups such as local specialties, design brands, markets, luxury malls, daily-life shopping, or gifts;
- what to buy or browse, including local products and specialties when relevant;
- Local Products modeled separately from Purchase Places, so Landi can explain what to buy before asking the traveler where to go;
- one Local Product may link to multiple concrete Purchase Places;
- concrete recommended Purchase Places for each local product when available, using real place identities rather than vague shopping areas;
- Purchase Place Comparison when multiple purchase places exist, including location, suitable itinerary area, convenience, price or quality signals, hours, source state, and nearby itinerary links when available;
- price or effort signal when available;
- tax refund, payment, shipping, opening-hour, or reservation notes when relevant;
- nearby dining, attraction, or experience links when useful;
- one primary add action that starts an itinerary edit, plus secondary actions to keep as optional or open details.

If a Local Product has no concrete Purchase Place, it may remain informational guide content but should not be promoted as a schedulable shopping block. If it has multiple Purchase Places, the traveler should choose a specific place before adding it to the itinerary.

#### Local Signature Experience Sub-branch

This sub-branch contains destination-specific activities that are not just places, such as workshops, performances, seasonal events, local rituals, bathing culture, tea, nightlife, festivals, short excursions, or guided experiences.

Expected presentation:

- image-led story cards;
- theme groups such as seasonal events, hands-on workshops, performance nights, neighborhood life, bathing or wellness, or short excursions;
- Experience Themes modeled separately from Experience Offerings, so Landi can explain the local experience before asking the traveler which concrete activity or place to choose;
- one Experience Theme may link to multiple concrete Experience Offerings;
- concrete Experience Offerings when available, using real place, provider, event, route, or activity identities rather than vague local custom ideas;
- Experience Offering Comparison when multiple offerings exist, including location, duration, suitable itinerary area or day part, booking need, seasonal fit, accessibility, etiquette or risk notes, source state, and nearby itinerary links when available;
- experience type, suitable traveler, duration, booking need, seasonal fit;
- cultural context and practical notes;
- risk or etiquette notes when useful;
- related attraction, dining, or shopping places;
- one primary add action that starts an itinerary edit, plus secondary actions to save as candidate or create a preparation item.

If an Experience Theme has no concrete Experience Offering, it may remain informational guide content but should not be promoted as a schedulable local-experience block. If it has multiple Experience Offerings, the traveler should choose a specific offering before adding it to the itinerary.

#### Dining Sub-branch

The dining sub-branch covers local food culture, restaurant candidates, food streets, cafes, markets, dining etiquette, reservation-sensitive meals, and dietary constraints.

Expected presentation:

- image-and-text cards grouped by food type, area, or meal moment;
- theme groups such as breakfast, classic local dishes, casual lunch, dinner reservations, night snacks, cafes, desserts, or markets;
- Local Food modeled separately from Dining Places, so Landi can explain what to eat before asking the traveler where to go;
- local dish names and plain descriptions with enough context for a traveler to choose;
- one Local Food may link to multiple concrete Dining Places;
- concrete Dining Places or food areas for each Local Food when available, using real place identities rather than vague food ideas;
- Dining Place Comparison when multiple dining places exist, including location, suitable itinerary area or meal moment, reservation or queue expectation, dietary fit, price or quality signals, hours, source state, and nearby itinerary links when available;
- reservation or queue expectations;
- dietary or accessibility notes when known;
- nearby attraction, shopping, or experience links when useful;
- one primary add action that starts an itinerary edit, plus secondary actions to keep as nearby option or open the map/source.

If a Local Food has no concrete Dining Place or food area, it may remain informational guide content but should not be promoted as a schedulable meal block. If it has multiple Dining Places, the traveler should choose a specific place or food area before adding it to the itinerary.

The dining guide should not claim live table availability, ordering, delivery, or payment.

### 2. Pre-departure Preparation

This area turns preparation needs into actionable checklist items. It should be checklist-first and text-only. It does not need images; items that need traveler understanding before action can expand into concise written instructions or source-backed notes.

Preparation should follow a Preparation Relevance Rule. The Skill should generate items that materially affect travel readiness, legality, access, booking use, payment, connectivity, weather fit, health, safety, transport setup, or destination-specific procedures. It should not generate generic life advice or filler tasks such as buying an unrelated cup, organizing photos, or getting more rest unless the item is tied to a concrete travel requirement.

Expected presentation:

- grouped checklist sections;
- documents, booking confirmations, payment, connectivity, insurance, weather packing, local apps, transport setup, and destination-specific rules;
- expandable detail for items such as local apps, transport cards, entry materials, weather-specific equipment, or unfamiliar local procedures;
- due timing and accountable party in the underlying data when they materially affect readiness, but not as noisy default card text;
- source-backed status when official evidence is needed, shown through unobtrusive text or links rather than standalone `i` markers;
- ability to mark complete;
- ability to open related source or booking handoff.

Preparation checklist rows should not expose internal generation labels, stage names, or bureaucratic category words such as "authorization" unless that wording is the traveler-facing name of a required action.

Preparation items that are time-sensitive may compile into dormant reminders in a Draft Plan and active reminders only after Plan activation.

### 3. Travel Tips

Travel tips should help the traveler behave well and avoid destination-specific friction. They should focus on local customs and practical cautions, including etiquette, transport habits, payment norms, safety, language, weather, dress, taboos, scams, tourist traps, and common local mistakes.

Travel tips should follow a Travel Tip Relevance Rule. The Skill should only generate tips tied to the destination, local culture, local infrastructure, trip context, or a concrete itinerary situation. It should not generate generic travel inspiration, broad life advice, motivational copy, or obvious universal reminders.

Expected presentation:

- compact text-first Travel Tip Cards;
- theme groups such as payment, transportation, dining etiquette, clothing, religious or cultural norms, safety, language, weather, and common mistakes;
- Canonical Tips in the Tips area for full browsing;
- short Contextual Tip Surfaces beside relevant itinerary days or blocks when the tip affects that moment;
- local transport norms, payment habits, safety, etiquette, weather, language, accessibility, family/elder needs, scams or tourist traps when evidence supports them;
- source and freshness disclosure for custom, safety, payment, transport, or other change-sensitive claims through unobtrusive source text or links rather than standalone `i` markers;
- source and freshness state for facts likely to change;
- actions to pin, dismiss, or turn into a preparation item when appropriate.

Travel tips should be organized primarily by theme in the Tips area as Canonical Tips, but the same tip may also appear as a small Contextual Tip Surface beside a relevant Itinerary Day or Itinerary Block. Contextual surfacing should show only the short caution needed at that itinerary moment, while the full explanation stays in the Tips area or shared detail view. It should reference the original tip and should not duplicate it as itinerary content. Travel tips are not execution tasks unless they have a concrete accountable action and completion condition.

## Cross-module Behavior

The workspace should treat attraction guide, shopping guide, local signature experiences, and dining guide as connected itinerary material. A traveler should be able to start from any of these itinerary sub-branches and add the selected item into a pending itinerary edit without losing its original guide context.

The workspace should allow content to move between modules through clear actions:

- add an attraction, shopping area, dining option, or experience to a day;
- save a place for later review;
- mark an item as must-visit, preferred, optional, archived, booked, or needs recheck;
- create a preparation task from a guide item;
- lock a fixed booking or scheduled commitment;
- ask Landi to rework one day, one area, or one module without rebuilding unrelated content.

When the traveler selects the add action on an unscheduled Guide Card, Web should open a lightweight Placement Selection State instead of inserting the item directly. In that state, the traveler should be able to choose:

- exact day;
- placement position or rough time block when useful, such as morning, lunch, afternoon, evening, or flexible;
- whether the new item should replace, append to, or be compared with existing content when that distinction is required.

Web should not expose a required scheduled-or-optional meaning selector in this flow. Landi may mark the resulting replacement draft as scheduled content or flexible itinerary content after route, timing, and constraint checks.

Placement Selection State should show available positions and lightweight Placement Advisories. Advisories may flag route friction, opening-hour uncertainty, meal timing mismatch, reservation sensitivity, weather fit, or day pacing risk. They should guide the traveler without blocking selection by default. Hard blocking should be reserved for fixed bookings, explicit traveler constraints, safety constraints, or structural defects that would make the Blueprint unusable.

After placement is selected, the workspace should create a Pending Itinerary Edit inside the workspace rather than opening a new conversation turn. For ordinary guide additions, the itinerary sequence only needs to highlight the changed placement and expose change/cancel controls until the direct save path exists. These additions do not need a separate mandatory impact summary before saving. Each confirmed meaningful change should be version-aware and preserve unrelated plan content. Until the direct Blueprint Revision write path is connected, Web may keep this as an unsaved local preview and must not imply that the edit has been saved.

## Editing and Impact Rules

Low-impact edits may become Direct Blueprint Revisions:

- changing priority;
- assigning an unscheduled item to a traveler-chosen day with advisory checks;
- removing an ordinary non-fixed stop;
- same-day reorder within capacity;
- archiving a candidate;
- creating a preparation item from a guide card.

These edits should still pass through the existing edit confirmation path before becoming durable Blueprint Revisions, but they do not require the high-impact preview treatment.

High-impact edits require an impact preview before saving or replanning:

- changing trip dates;
- changing destination or city sequence;
- moving a fixed booking;
- deleting a must-visit or booked item;
- changing lodging anchor;
- exceeding day capacity;
- moving content across incompatible cities;
- affecting reminders, transport commitments, or official-source preparation.

The impact preview should explain affected days, routes, reminders, bookings, evidence, and what remains unchanged.

## Data Requirements

The Trip Blueprint contract should be extended or adapted to support module-aware presentation without making Web depend on skill-specific fields.

Required content structures include:

- module identity and display order;
- place and guide item identities;
- place display intent, including `display.type` for guide branch membership and optional `display.markerKind` for map marker icon semantics;
- guide theme identities and ordering;
- Guide Relationship Graph for concept-to-place relationships;
- `localFoods -> diningPlaces` relationships for dining guide material;
- `localProducts -> purchasePlaces` relationships for shopping guide material;
- `experienceThemes -> offerings` relationships for local-experience guide material;
- `attractions -> placeIdentity` relationships for attraction guide material;
- itinerary block type and replacement scope;
- itinerary block timing mode, including exact, rough, optional, and flexible states;
- rough time label intent for flexible timeline rendering;
- itinerary block references to Schedulable Itinerary Objects rather than theme-level records;
- guide item scheduling eligibility, including Informational Guide Items that are not available for timeline placement;
- cross-module memberships for attractions, shopping, dining, and experiences;
- image query or image source metadata;
- inspiration source references when guide material comes from social, UGC, review, short-video, image-board, or travel-community content;
- rich guide copy, not only one-line descriptions;
- Guide Card Summary for list browsing;
- Guide Value Explanation for places, foods, products, and experiences when useful;
- Guide Editorial Voice constraints for polished but grounded guide writing;
- Functional Workspace Voice constraints for timeline, preparation, tips, comparison rows, status, and action controls;
- Guide Option Comparison data when multiple concrete dining places, purchase places, or experience offerings are useful;
- Option Comparison Row fields for compact side-by-side comparison;
- Comparison Facts for option rows, avoiding subjective promotional copy;
- Neutral Option Ordering signals for peer options when useful;
- localized names and plain names;
- categories and tags;
- local products and related purchase places for shopping content;
- concrete purchase place identities for schedulable shopping content;
- local foods and related dining places or food areas for dining content;
- experience themes and related concrete offerings for local-experience content;
- recommended duration or effort;
- suitable contexts;
- internal scheduling compatibility for validation and impact checks, without default day, time, or replacement-type labels on unscheduled guide cards;
- whether an item is already part of the recommended itinerary or is available as replacement/enrichment material;
- evidence status;
- source references;
- compact source marker metadata for hover, focus, and tap disclosure;
- actions eligible in Web;
- relationship metadata, such as alternative, nearby, pairs well with, conflicts with, requires booking, or requires preparation.

The Web presentation should read from Landi-owned normalized structures. It should not read raw skill output.

Current Trip Blueprint Contract V2 slice:

- `moduleIdentity` declares that the Trip Blueprint primarily powers the Itinerary workspace while Preparation, Tips, and Sources are supporting Blueprint-backed modules.
- `guideTheme` records the trip narrative, visitor mode, taste model labels when used, and city or route segments tied to itinerary days.
- `guideRelationshipGraph` records place-to-place relationships such as alternatives, same-direction additions, meal support, rainy-day swaps, and anchor support.
- `localFoods`, `localProducts`, and `experienceThemes` record non-schedulable guide catalog themes. They link only to concrete `places` through dining, purchase, or offering place ids; itinerary days and blocks still reference concrete places, not themes.
- `schedulingEligibility` on places records whether an item is directly schedulable, informational only, blocked, or high-impact.
- `guideDisplay` on places records Web workspace guide-display intent such as guide inclusion, short card summary, compact tags, detail headings, traveler-facing add labels, and factual comparison rows. Web may fall back to legacy inference only when this field is absent.
- `blocks` on itinerary days records typed sequence units such as stops, flexible time, meals, rest, transfers, lodging anchors, and events.
- `travelTips` records destination-relevant, traveler-facing practical cautions with theme, context, optional day/place linkage, and evidence. Web falls back to older place/task tip inference only when this Blueprint field is absent.
- `preparationChecklist` records traveler-owned checklist items grouped for Web display, linked back to structured Action Requirements when applicable. Web falls back to compiled Plan task grouping only when this Blueprint field is absent.
- `fieldEvidence` records evidence for specific Blueprint fields or claims so importer validation does not treat whole-place evidence as proof for every displayed assertion.
- Direct Blueprint Revisions currently support same-day direct add and same-day direct move for schedulable, non-fixed places. The revision result includes base/applied Blueprint versions, affected days and places, route-refresh movement ids, and an undo-ready snapshot of the previous day and its movements. Web still applies the saved revision through the current confirmation bar; visible undo controls remain a later workspace task.

Images are optional enhancements for itinerary guide material. If no suitable image is available for a guide item, itinerary block, or product, Web should render a polished text-only card and should not reserve an empty image area or show a decorative placeholder. Pre-departure preparation and Travel Tips do not require images and should render as text checklist or text card content.

## Web Presentation Requirements

The Plan Workspace should feel like a rich travel planning studio, not a static generated report.

Primary navigation:

```text
Itinerary
Preparation
Tips
Sources
```

The itinerary tab should use an Itinerary Workspace Layout on desktop: the left side presents the time-ordered itinerary sequence as the plan body, the right side presents the Itinerary Map as spatial and route context, and one openable Workspace Side Panel switches between the Itinerary Explore Panel and shared detail view. Detail does not need its own persistent top-level panel tab; selecting an itinerary block, guide card, or map item may open detail directly, with a clear return control back to Explore. The map should not dominate the workspace.

The layout should embrace Desktop Workspace Density. When screen space allows, the traveler should be able to keep the timeline, map, and Workspace Side Panel visible together for side-by-side reading, spatial review, and guide comparison. Explore and detail should be modes of the same side panel rather than two simultaneous sidebars. The workspace should not collapse into a mobile-style single-column flow.

The Workspace Side Panel should preserve Side Panel Navigation State when switching from explore mode into detail mode. Returning from detail should restore the previous explore filters, sort order, scroll position, and selected card rather than resetting the panel.

The itinerary sequence's primary role is to present the time-ordered recommended plan. The map should support spatial understanding, selected-place context, and route review; it should not be the default entrypoint for adding or replacing guide material. The itinerary sequence should support plan reading, block selection, status review, and changed-placement highlighting inside the existing edit state. The traveler should use the Itinerary Explore Panel, shared detail panel, Placement Selection State, and existing edit confirmation path to adjust the plan.

Attraction, dining, shopping, and local-experience sub-branches should be available inside the itinerary workspace. Those sub-branches should prioritize image-and-text cards, readable grouping, filters, and promotion actions into pending itinerary edits.

Preparation should prioritize actionable checklist groups. Tips should prioritize local customs, etiquette, and practical caution cards. Sources may remain a supporting view where evidence and freshness need to be inspectable.

The workspace should support:

- visual browsing;
- lightweight filters when they materially reduce browsing friction;
- card detail views;
- small source markers on real images only;
- hover, focus, or tap source disclosure for image markers, plus plain source summaries or links in details and the Sources view that separate inspiration sources from fact or evidence sources;
- itinerary sub-branch add/save/archive actions;
- version-aware save;
- undo for direct edits;
- clear recheck and evidence states.

## Non-goals

- Do not generate standalone HTML as the product artifact.
- Do not let the skill define Web layout or interaction controls.
- Do not design or support a mobile version of the Web workspace.
- Do not design a post-import enrichment workflow for Informational Guide Items.
- Do not treat guide copy as executable work unless it compiles from a structured Action Requirement.
- Do not claim booking, ordering, payment, ride dispatch, live availability, or official eligibility without separate evidence and user confirmation.
- Do not rebuild the whole trip for a small direct edit.

## Acceptance Criteria

- A user can create a trip through the current chat-style flow without a heavy visible proposal page.
- The generated result contains Itinerary, Preparation, and Tips when relevant to the trip.
- Itinerary opens in an itinerary-sequence-led desktop workspace with map support and openable explore/detail side-panel modes.
- Attractions, shopping, experiences, and dining render as itinerary guide sub-branches with rich Guide Cards.
- Travel Tips render as compact text-first cards and contextual tip surfaces.
- Preparation renders as actionable grouped checklists.
- Guide cards can be promoted into itinerary days or preparation items where appropriate.
- Direct edits create version-aware Blueprint Revisions or an equivalent migration-safe write path.
- High-impact edits show an impact preview before changing travel meaning.
- The Plan Compiler creates executable tasks and reminders only from structured requirements.
- Web never depends on raw skill UI output or skill-specific presentation assumptions.

## Skill Output Acceptance Criteria

A Landi-native planning Skill artifact is acceptable when it satisfies these generation-quality checks before or during Skill Importer normalization:

- It outputs Landi-native structured data for the Blueprint Contract, not standalone HTML, map-specific UI state, or Web layout instructions.
- It contains a complete Recommended Itinerary when the trip context supports one, with typed Itinerary Blocks for attractions, dining, shopping, local experiences, movement, rest, and flexible time where relevant.
- It uses Schedulable Itinerary Objects in timeline blocks. Local Food, Local Product, and Experience Theme records may explain choices but do not directly occupy the timeline.
- It supports Flexible Itinerary Blocks with timing modes and rough time label intent instead of inventing exact times for naturally flexible dining, shopping, local-experience, rest, or exploratory content.
- It does not require Per-block Arrangement Rationale for scheduled blocks, and it does not put arrangement explanations into timeline defaults.
- It treats attractions, dining, shopping, and local experiences as itinerary sub-branches over a shared Guide Catalog, not as separate top-level plan modules.
- It provides explicit Guide Relationship Graph data for food-to-place, product-to-place, experience-theme-to-offering, and attraction-to-place relationships.
- It marks useful guide material without a concrete schedulable object as Informational Guide Items that remain visible but unavailable for add-to-itinerary actions.
- It keeps Guide Card Summary short and scannable, with optional images, useful scanning tags, itinerary state where useful, image-level Source Marker metadata when an image exists, and state-aware actions.
- It assigns every place a structured display type for Attractions, Dining, Shopping, or Experiences, and only uses a distinct marker kind when the map icon should intentionally differ from the guide branch.
- It provides Guide Value Explanation when useful, using grounded Guide Editorial Voice rather than advertising language or social-media hype.
- It confines Guide Editorial Voice to guide value/supporting copy, and uses Functional Workspace Voice for timeline, preparation, tips, comparison rows, statuses, and action controls.
- It supports Guide Option Comparison for multiple concrete dining places, purchase places, or experience offerings as peer options, without candidate labels, default recommended labels, or forced best choices.
- It provides Option Comparison Row fields and Comparison Facts for peer options, keeping comparison rows factual and compact.
- It may provide Neutral Option Ordering signals, but only as non-promotional factual ordering, not as recommendation ranking.
- It treats images as optional enhancements. Missing suitable images should not produce placeholders or empty reserved image areas.
- It treats UGC, social, review, image-board, short-video, and travel-community material as optional Source Channels and possible Inspiration Sources, not required dependencies or verified evidence.
- It uses Source Capability Selection for global planning rather than hard-coded regional source bundles.
- It separates Inspiration Sources from evidence sources, and supports compact Source Marker disclosure for images plus plain source disclosure for text-only cards, tips, itinerary details, and the Sources view. Itinerary blocks do not show Source Markers by default.
- It generates Preparation Checklist items only when they satisfy the Preparation Relevance Rule.
- It generates Travel Tips only when they satisfy the Travel Tip Relevance Rule, and supports short Contextual Tip Surfaces for itinerary-linked cautions.
- It does not claim booking, ordering, payment, live table availability, ride dispatch, official eligibility, or external action completion without separate evidence and traveler confirmation.
- It produces rich guide content beyond one-line place descriptions while avoiding filler, generic life advice, generic travel inspiration, and large volumes of unschedulable background material.
