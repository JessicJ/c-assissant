# Booking Confirmation Requirements

## Purpose

Landi should use confirmed and pending travel bookings such as hotels, flights, trains, rental cars, restaurants, tickets, and tours as foundation facts for Plan generation.

The feature is inspired by TREK's reservation, accommodation, and transport model, but adapted to Landi's single-user, versioned Plan architecture. The goal is not to book, pay, cancel, or modify reservations on behalf of the traveler. The goal is to turn booking evidence into structured generation input first, then into Plan facts that drive itinerary shape, review, reminders, route anchors, handoffs, and in-trip assistance.

## Product Principles

- Booking data begins as Planning Session evidence when it is provided before generation, then becomes Plan-scoped after the generated Plan is reviewed and saved. It must not be written to the long-term Profile unless the traveler explicitly asks to save a reusable preference.
- A discovered booking, imported file, or external link never becomes a confirmed booking without either reliable parsed evidence or explicit traveler confirmation.
- Traveler-initiated import confirms that the source material should be considered Booking Evidence, but it does not automatically confirm every parsed field as a hard Booking Constraint.
- Opening a booking, map, airline, rental, or payment link does not prove completion.
- Imported or AI-extracted bookings may be useful before they are complete; incomplete records must be marked as needing review.
- Confirmed booking times, locations, and stays are hard generation constraints unless the traveler explicitly marks them as flexible.
- Pending or needs-review booking records are soft constraints: they should shape the proposal and draft Plan, but remain visibly unresolved.
- Booking changes that affect dates, lodging base, fixed commitments, arrival/departure, reminders, or itinerary structure require a version-bound impact preview before altering an active Plan.
- Sensitive confirmation codes and attached documents should be treated as private trip data, not normal descriptive plan text.

## Role in Plan Generation

Booking information should be available before a complete Plan exists. Landi should treat it as high-priority structured context during Planning Session collection, proposal creation, and generation-critical fact checks.

### Generation Input Behavior

- Booking Evidence may provide facts that satisfy the Planning Minimum, such as destination and travel dates, but it does not add new mandatory fields to the Planning Minimum.
- A confirmed hotel stay defines a date-bounded Lodging Anchor, check-in/check-out boundaries, and daily route anchor for affected itinerary days.
- A confirmed inbound flight/train defines arrival city, arrival node, local arrival time, and the first transfer requirement.
- A confirmed outbound flight/train defines the final departure node, local departure time, and return-transfer requirement.
- A confirmed rental car defines pickup/return windows and Transport Availability for that time window. It should not rewrite the Plan's global transport preference.
- A confirmed event, restaurant, ticket, or tour defines a fixed commitment on a specific date/time and should block conflicting itinerary suggestions.
- A pending booking may be used as a candidate anchor, but the generated Plan must label it as pending and ask for confirmation before treating it as fixed.
- Missing booking details should become targeted Planning Session unknowns instead of generic "please provide more information" questions.

### Planning Session Changes

The Planning Session should accept booking facts alongside normal conversational facts:

- manual booking snippets from the user;
- pasted confirmation text;
- uploaded confirmation files, when upload is implemented;
- connector-discovered reservations, when connectors are implemented;
- AI-extracted candidates, only after preview.

Imported confirmation content immediately becomes Booking Evidence after the traveler submits it. Parsed fields from that content become Proposed Booking Constraints until the traveler accepts them in preview or correction flow.

Booking Import does not create a Plan, Draft Plan, Trip Blueprint, or Blueprint Generation by itself. It enriches the current Planning Session and must survive browser refresh or session reopening. Booking Evidence and accepted Booking Constraints are promoted to Plan-linked bookings only after Blueprint Publication and Draft Plan compilation.

If no Planning Session exists, Booking Import may create one. Import alone must not auto-create a Planning Proposal or start Blueprint Generation. Landi should first ask the traveler whether to plan around the imported booking evidence and collect any missing trip intent.

When multiple booking items are imported, Landi may suggest that they belong to the same trip based on date proximity, city or airport continuity, traveler names, and provider clues. Suggested grouping does not establish the trip boundary until the traveler confirms it.

The proposal should summarize booking-derived constraints separately from assumptions. Example:

- "Arrive at HND on 2026-10-08 at 17:40."
- "Stay at Hotel Metropolitan Tokyo from 2026-10-08 to 2026-10-12."
- "Rental car pickup is pending; itinerary will avoid assuming a car until confirmed."

The Planning Proposal should emphasize only Booking Constraints that affect generation. Non-structural Booking Evidence, such as room type, breakfast, seat, confirmation code, supplier contacts, prices, or cancellation notes, should appear only in a compact imported-evidence summary or later Trip Logistics view.

Before generation, Landi should verify that all hard booking constraints have enough structure to be used safely:

- local date and time;
- time zone or location from which a time zone can be resolved;
- city or node;
- booking status;
- whether the commitment is fixed or flexible.

If a booking lacks those fields, Plan generation may continue only when the missing field is non-critical or clearly marked as needing review.

Booking Evidence is not an absolute prerequisite for Blueprint Generation. Landi may generate without imported flights, hotels, or rental cars when the Planning Minimum and generation-critical facts are otherwise satisfied. Missing lodging may use an explicit provisional area or routing anchor. Missing arrival or departure details may remain a Blocking Unknown or visible Planning Assumption depending on whether the trip boundary is otherwise safe.

An accommodation confirmation may provide destination and date-boundary facts for generation. It must not be used to invent arrival node, arrival time, departure node, or departure transport when those are not present in the Booking Evidence or traveler input.

Round-trip transport Booking Evidence may provide arrival and departure anchors for generation even when lodging is unknown. In that case, lodging may be represented only as a Planning Assumption or candidate area. Landi must not create a Lodging Anchor, confirmed accommodation, or verified accommodation-to-place route without accepted accommodation evidence or traveler confirmation.

If the traveler states that a hard real-world commitment exists, such as "I already booked the hotel" or "my flight is confirmed", but the commitment lacks usable date, time, location, or status fields, Landi should keep it as an unresolved booking item and must not fabricate the missing constraint.

When imported booking times omit a time zone, Landi may infer the time zone from a sufficiently specific endpoint, airport, station, property location, or city. Inferred time zones must be shown in preview for traveler confirmation. If location context is too weak to resolve a time zone, the segment remains `needs_review` and cannot become a hard Booking Constraint.

Booking Import success must not depend on external geocoding. MVP should preserve textual locations such as airport codes, station names, hotel names, addresses, and city labels. If a map connector is available, Landi may enrich accepted records with coordinates, resolved city, and time zone asynchronously. Route calculation or map placement may remain pending until geocoding succeeds.

Booking Evidence that does not match the current Planning Minimum, date window, destination, or traveler-confirmed trip boundary should be marked out of scope. Out-of-scope evidence remains visible in the Planning Session but does not produce Booking Constraints for the current Blueprint Generation unless the traveler explicitly includes it.

### Conflict Behavior

Accepted hard Booking Constraints take precedence over natural-language trip intent, but Landi must not resolve conflicts silently.

Examples:

- The traveler says the trip is October 8-12, but an accepted hotel stay is October 9-13.
- The traveler says they prefer public transit, but an accepted rental-car booking creates a fixed pickup/return window.
- The traveler asks for a day trip, but an accepted event ticket occupies the same time window.

When a hard Booking Constraint conflicts with traveler intent, Planning Proposal, or another hard constraint, Landi should:

- show the conflict in the Planning Proposal or pre-generation review;
- block Blueprint Generation when the conflict changes the trip boundary or makes the itinerary infeasible;
- let the traveler edit the Booking Evidence, downgrade the Booking Constraint, ignore the conflicting segment, or revise the trip intent;
- record the chosen resolution before generation proceeds.

The traveler may explicitly downgrade an accepted hard Booking Constraint. Downgrading keeps the Booking Evidence and parsed details visible, but prevents that constraint from controlling Blueprint Generation as a fixed commitment. The Planning Proposal should show downgraded constraints as ignored or informational context, not as Planning Assumptions.

## Reference Behavior From TREK

TREK provides a useful reference shape:

- Reservations are grouped by status and type, with cards showing date/time range, confirmation code, linked place/day, notes, files, and type-specific metadata.
- Hotels are special: an accommodation is a distinct stay record tied to check-in/check-out days, and it also creates a linked Hotel reservation.
- Transports are special: flights, trains, cars, and cruises are created through a dedicated transport flow with endpoints, local times, and type-specific fields.
- Booking import supports email, PDF, pass, HTML, and text files; parsed results are previewed before saving; partial parses are flagged for review.
- AI parsing is a fallback for files that structured extraction cannot read, and every AI result requires review before saving.

Sources:

- TREK Reservations and Bookings: https://github.com/liketrek/TREK/wiki/Reservations-and-Bookings
- TREK Accommodations: https://github.com/liketrek/TREK/wiki/Accommodations
- TREK Transport: https://github.com/liketrek/TREK/wiki/Transport-Flights-Trains-Cars
- TREK MCP tools: https://github.com/liketrek/TREK/wiki/MCP-Tools-and-Resources

## Scope

### MVP

The first Landi version should support:

- Manual creation and editing of booking records during Planning Session intake and after Plan generation.
- User-provided booking email import from pasted confirmation text or uploaded `.eml`, `.html`, or `.txt` content.
- Import preview before any imported booking becomes Booking Evidence or a Booking Constraint.
- Hotel/accommodation records that can seed Plan accommodation configuration and itinerary day boundaries.
- Flight, train or long-distance transport, and rental-car records that can seed arrival/departure facts, movement assumptions, and fixed time windows.
- Semi-structured event, ticket, tour, restaurant, and other booking records without full parser coverage.
- Confirmation code, supplier, status, local times, notes, source/evidence, and document attachment metadata.
- Inclusion of booking-derived facts in the generation context passed to Agent Runtime and Country Pack workflows.
- A booking review surface in Web.
- Reminder generation for check-in, check-out, flight departure, car pickup/return, and "review booking details before trip".
- Explicit "needs review" state for incomplete or imported bookings.

### Later

Later phases may add:

- Structured parsing for `.pdf` and `.pkpass`.
- AI extraction fallback for hard-to-read confirmations.
- Gmail, Outlook, or other mailbox connectors with explicit account authorization.
- Calendar export/import.
- Airline or flight-status connectors.
- Live rental, hotel, or ticket provider integrations.
- Budget linkage.
- Search across bookings and attached documents.

## Domain Model

Add a first-class `TravelBooking` aggregate. Before generation it may be linked to a `PlanningSession`; after generation it should be linked to a `Plan`. It should be separate from `Task` and `PlanPlace`, but linkable to both.

### TravelBooking

Required fields:

- `id`
- `planningSessionId`
- `planId`
- `planVersionCreated`
- `type`: `accommodation`, `flight`, `train`, `rental_car`, `cruise`, `restaurant`, `event`, `tour`, `ticket`, `other`
- `status`: `pending`, `confirmed`, `cancelled`, `needs_review`
- `constraintStrength`: `hard`, `soft`, `informational`
- `fixedCommitment`: boolean
- `title`
- `providerName`
- `confirmationCode`
- `startAtLocal`
- `startTimeZone`
- `endAtLocal`
- `endTimeZone`
- `notes`
- `source`: `user`, `imported_file`, `connector`, `ai_extracted`
- `sourceRefs`
- `createdAt`
- `updatedAt`

Recommended fields:

- `travelerNames`
- `partySize`
- `price`
- `currency`
- `cancellationPolicySummary`
- `contactPhone`
- `contactEmail`
- `manageBookingUrl`
- `checkInUrl`
- `mapUrl`
- `needsReviewReasons`
- `sensitiveFields`

### Booking-Derived Planning Fact

During proposal and generation, Landi should not pass raw booking records as loose prose. It should derive explicit planning facts from them.

Fields:

- `id`
- `bookingId`
- `planningSessionId`
- `key`
- `value`
- `source`: `booking_manual`, `booking_import`, `booking_connector`, `booking_ai_extract`
- `confirmed`
- `constraintStrength`
- `generationRole`: `arrival_anchor`, `departure_anchor`, `lodging_anchor`, `fixed_event`, `transport_mode_hint`, `budget_hint`, `document_reference`
- `missingRequiredFields`
- `updatedAt`

### BookingEndpoint

Transport and location-based bookings need ordered endpoints.

Fields:

- `id`
- `bookingId`
- `role`: `origin`, `destination`, `stop`, `pickup`, `return`, `venue`
- `name`
- `address`
- `city`
- `country`
- `iataCode`
- `stationCode`
- `coordinates`
- `timeZone`
- `scheduledAtLocal`
- `terminal`
- `gate`
- `platform`

### BookingSegment

A booking may contain multiple time-bound segments derived from the same Booking Evidence.

Fields:

- `id`
- `bookingId`
- `segmentType`: `flight_leg`, `train_leg`, `hotel_stay`, `rental_pickup`, `rental_return`, `event_window`, `other`
- `title`
- `status`
- `startAtLocal`
- `startTimeZone`
- `endAtLocal`
- `endTimeZone`
- `constraintStrength`
- `fixedCommitment`
- `originEndpointId`
- `destinationEndpointId`
- `sourceRefs`

Behavior:

- A round-trip flight confirmation may create one Booking Evidence item, one TravelBooking, and multiple flight-leg Booking Segments.
- A hotel confirmation usually creates one hotel-stay Booking Segment; extras such as breakfast, late checkout, or shuttle notes remain add-ons unless they create fixed time windows.
- A rental-car confirmation usually creates pickup and return segments under one TravelBooking.
- Blueprint Generation uses accepted Booking Segments as the time-bound units that constrain itinerary structure.
- Ignored segments remain available in Plan-linked booking detail but do not become Blueprint Booking Constraints and do not generate Dormant Reminders.
- Soft segments may shape the proposal or create review work, but should not generate time-sensitive action reminders until upgraded to hard.

### AccommodationStay

Accommodation should remain special because it affects daily route anchors and active trip context.

Fields:

- `id`
- `planId`
- `bookingId`
- `placeId`
- `propertyName`
- `address`
- `coordinates`
- `checkInDayId`
- `checkOutDayId`
- `checkInFromLocal`
- `checkInUntilLocal`
- `checkOutByLocal`
- `confirmationCode`
- `status`

Behavior:

- A confirmed stay updates or links to `Plan.configuration.accommodation`.
- Route recalculation from accommodation to first stop should reuse the existing `prepareAccommodationDepartures` flow.
- A stay appears on every itinerary day from check-in through check-out, with boundary labels for check-in and check-out.
- Multiple stays may create multiple Lodging Anchors. Each itinerary day should use the applicable stay rather than assuming a single trip-wide accommodation base.
- Checkout day handling should distinguish morning checkout, luggage storage, and later departure assumptions when those details affect the day's route.
- Landi must not assume luggage storage after checkout. If checkout-day itinerary structure depends on leaving bags at the property, the Trip Blueprint should mark the assumption as needing review or compile an Action Requirement to confirm luggage storage, unless the Booking Evidence or traveler explicitly confirms it.

### BookingAttachment

Files should be tracked as metadata first, even before binary upload is fully implemented.

Fields:

- `id`
- `bookingId`
- `fileName`
- `mimeType`
- `sizeBytes`
- `storageKey`
- `uploadedAt`
- `sourceHash`
- `extractionStatus`: `not_attempted`, `parsed`, `partial`, `failed`

Behavior:

- Full imported email or file content may be retained only as a protected attachment.
- Normal booking records should store structured fields, source hash, attachment metadata, and short necessary excerpts rather than complete raw email content.
- Protected attachment content must not be copied into ordinary Plan text, Trip Blueprint content, application logs, or Agent Runtime input.

## User Flows

### Booking-First Plan Generation

The traveler starts a Planning Session by pasting or entering known booking details before asking for a complete Plan.

Example inputs:

- "I land at Haneda on Oct 8 at 17:40 and leave from Narita on Oct 13 at 11:10."
- "Hotel is booked near Shinjuku from Oct 8 to Oct 12."
- "I have a rental car from Oct 10 09:00 to Oct 12 18:00."

Acceptance criteria:

- Landi extracts booking facts into structured booking records or booking-derived planning facts.
- The next Planning Proposal lists fixed booking constraints separately from assumptions.
- Generation-critical checks reuse booking facts instead of asking for the same arrival, lodging, or departure details again.
- The generated itinerary respects hard booking constraints and labels soft or pending records.
- A booking-derived conflict, such as a hotel in one city and an event in another city with insufficient travel time, blocks generation or produces an explicit proposal warning.
- Generated route anchors, reminders, and timeline milestones cite the source booking when applicable.

### Manual Booking Entry

The traveler opens a "Bookings" or "Trip details" Web view and creates a booking before or after Plan generation.

Minimum fields by type:

- Accommodation: property name or location, check-in date, check-out date, status.
- Flight or train: departure location, arrival location, local departure time, local arrival time, status.
- Rental car: pickup location/time, return location/time, status.
- Restaurant/event/tour/ticket/other: title, venue or location, start time, status.

Confirmation code is strongly recommended for execution reference but does not block Blueprint Generation because it does not shape itinerary structure.

Acceptance criteria:

- Saving a booking does not activate external actions.
- Missing important fields are allowed only when the booking is marked `needs_review` or `pending`.
- Saving a booking during Planning Session updates the structured planning facts and may revise the Planning Proposal.
- Editing a draft Plan applies directly to that draft.
- Editing an active Plan creates an impact preview when the booking changes itinerary dates, lodging base, fixed commitments, or reminders.

### Accommodation Linking

The traveler adds or confirms a hotel.

Acceptance criteria:

- Before generation, the stay becomes a lodging anchor for itinerary generation.
- The stay links to check-in/check-out itinerary days.
- The Plan accommodation status can move from `not_set` or `candidate` to `confirmed`.
- Daily accommodation-to-first-stop routes are recalculated where possible.
- Any route that cannot be verified remains visible as `needs_verification`.

### Transport Booking

The traveler records flight, train, cruise, or car rental details.

Acceptance criteria:

- Before generation, inbound and outbound transport become arrival and departure anchors.
- Departure and arrival times preserve local time zones.
- Flights support airline, flight number, airport codes, terminal, gate, and seat when known.
- Rental cars use pickup and return semantics instead of generic departure/arrival labels.
- Transport bookings can appear in the timeline and can generate departure reminders.

### Import Preview

The traveler pastes confirmation text or uploads one or more booking email files.

Acceptance criteria:

- Landi records the submitted content as Booking Evidence and shows a preview before accepting parsed fields as Booking Constraints.
- Each detected booking can be accepted as one record, ignored, or edited before save.
- A detected booking that appears to belong to another trip can be kept out of scope, included in the current trip, or deleted. Moving it to a separate Planning Session is outside the MVP.
- High-risk fields that shape generation must be prominent in the preview: dates, local times, time zones, locations, airports, stations, accommodation check-in/check-out, and rental-car pickup/return windows.
- The preview should allow editing parsed fields and changing each segment's constraint strength to hard, soft, or ignored before acceptance.
- The traveler should not need to confirm every field individually. Accepting the record accepts its visible parsed fields as Booking Constraints.
- Partially parsed records are flagged `needs_review`.
- The original attachment metadata is retained and linked to created bookings.
- AI-extracted records never save as confirmed without review.
- Accepted import records update Planning Session facts when no Plan exists yet.
- MVP import is traveler-initiated. Landi does not connect to Gmail, Outlook, or another mailbox to scan mail automatically.
- Import should perform lightweight duplicate detection. The same source hash should be reported as already imported. Different sources with matching provider, confirmation code, date, and location should be shown as possible duplicates.
- Duplicate detection must not auto-merge records, because repeated imports may represent corrections, forwarded copies, or changed bookings.
- If an import appears to update an existing booking, Landi should present explicit choices: update the existing booking, save as a new booking, or ignore the import. Updating must not silently overwrite accepted Booking Constraints, and structural changes follow the Trip Blueprint Versioning rules.

## Generation Requirements

Plan generation must receive normalized booking context in addition to ordinary planning facts.

The generation input should include:

- hard constraints from confirmed bookings;
- soft constraints from pending or needs-review bookings;
- fixed events and immovable time windows;
- accommodation anchors by date range;
- arrival and departure anchors;
- transport mode hints from car rental, rail pass, or flight segments;
- booking records excluded from generation, with reasons.

Generation input must be privacy-minimized. It may include accepted Booking Constraints, segment timing/location facts, constraint strength, and short source labels. It must not include confirmation codes, full imported email bodies, raw attachments, payment details, full passenger identity details, provider contact messages, or other protected attachment content.

Traveler names from Booking Evidence may support import grouping and traveler review, but MVP must not write them to Profile, Trip Blueprint, or Agent Runtime input.

Accepted Booking Constraints should default to hard constraints only when they represent real itinerary boundaries:

- flight, train, event, tour, ticket, or restaurant start/end times;
- accommodation check-in/check-out date ranges;
- rental-car pickup and return windows;
- arrival and departure nodes tied to fixed transport.

Rental-car bookings also create local Transport Availability during the pickup-to-return window. Blueprint Generation may prefer self-driving, parking-aware stops, and driving route checks within that window, while preserving the Plan's overall transport preference outside it.

Accepted booking details should remain contextual rather than hard constraints when they do not independently shape itinerary feasibility:

- room type, breakfast, hotel notes, loyalty details, and cancellation summary;
- airline seat, gate, terminal, baggage allowance, and fare class;
- rental-car model, insurance, price, supplier notes, and contact details;
- provider phone numbers, emails, and manage-booking links.

Imported prices may be saved as Plan-linked booking details, but MVP should not use them for budget totals, cost splitting, or recommendation ranking.

The generated Plan should include:

- timeline entries for booking commitments;
- itinerary day anchors for accommodation stays;
- route segments or handoff tasks for airport/station/hotel transfers;
- proposed reminders derived from booking times;
- visible warnings for unresolved booking fields;
- source references linking generated details back to the booking evidence.

The generated Trip Blueprint should include privacy-minimized Blueprint Booking Constraints when those constraints shape itinerary structure. A Blueprint Booking Constraint may include timing, location, role, segment type, constraint strength, and short source labels. It must not include confirmation codes, protected attachment content, or sensitive raw confirmation details.

Integrity checks should reject or warn when:

- a hard booking constraint conflicts with another hard constraint;
- a hard booking constraint conflicts with traveler intent and has no recorded resolution;
- a scheduled stop overlaps a fixed booking window;
- a day uses an accommodation anchor outside its check-in/check-out range;
- a transfer to a booked flight/train/event has no feasible buffer;
- a booking-derived local time lacks enough location/time-zone context.

## Web Requirements

Booking Import should have two front-end entry points because travelers often generate a plan before every hotel, flight, or rental car is booked.

Required UI:

- Planning Session intake should provide booking import beside the normal travel-intent conversation, including paste, upload, and manual entry affordances. This entry point shapes the Planning Proposal and Blueprint Generation.
- Draft Plan and Execution Plan surfaces should provide supplemental booking import inside Trip Logistics or Bookings. This entry point adds execution details and may trigger impact preview or Blueprint Revision when accepted constraints change itinerary structure.
- The Plan surface entry point should not imply that importing a booking silently mutates the active itinerary. Structural changes follow the existing replacement-draft flow.
- Status groups: Needs review, Pending, Confirmed, Cancelled.
- Type filters: accommodation, flight, rental car, restaurant/event/tour/ticket, other.
- Cards with: type, status, title, local date/time, provider, confirmation code, linked itinerary day/place, notes, files.
- Confirmation codes should support hidden-by-default display.
- Accommodation cards should show check-in/check-out boundary information.
- Transport cards should show endpoints in order.
- Booking forms should use type-specific fields rather than one generic notes form.

Integration with existing UI:

- Planning Session should show booking-derived constraints before proposal approval.
- Planning Session should allow the traveler to import booking emails, review parsed records, resolve out-of-scope evidence, and accept Booking Constraints before Blueprint Generation.
- `TravelPlanAdditions` should evolve from accommodation-only into a compact "Trip logistics" panel that can also import bookings after a Draft Plan or Execution Plan exists.
- `ReservationView` should render first-class `TravelBooking` records instead of relying only on generic Tasks.
- Booking-related preparation tasks should link back to their source booking.

## API Requirements

Suggested endpoints:

- `GET /api/planning-sessions/:sessionId/bookings`
- `POST /api/planning-sessions/:sessionId/bookings`
- `PATCH /api/planning-sessions/:sessionId/bookings/:bookingId`
- `POST /api/planning-sessions/:sessionId/bookings/import-preview`
- `POST /api/planning-sessions/:sessionId/bookings/import-confirm`
- `GET /api/plans/:planId/bookings`
- `POST /api/plans/:planId/bookings`
- `PATCH /api/plans/:planId/bookings/:bookingId`
- `DELETE /api/plans/:planId/bookings/:bookingId`
- `POST /api/plans/:planId/accommodations`
- `PATCH /api/plans/:planId/accommodations/:stayId`
- `POST /api/plans/:planId/bookings/import-preview`
- `POST /api/plans/:planId/bookings/import-confirm`

All write endpoints should require:

- `expectedSessionUpdatedAt` or equivalent compare-and-write protection for Planning Session writes.
- `expectedVersion` for draft writes or impact-preview handling for active Plans.
- Zod or equivalent schema validation.
- No silent mutation of active Plans when the booking affects execution.

Generation endpoints should include booking-derived facts in the persisted Agent Run input audit without leaking sensitive raw confirmation text into normal logs.

## Storage Requirements

Add durable SQLite tables:

- `travel_bookings`
- `booking_planning_facts`
- `booking_segments`
- `booking_endpoints`
- `accommodation_stays`
- `booking_attachments`
- `booking_plan_links`

Indexes:

- `travel_bookings(planning_session_id, status)`
- `travel_bookings(plan_id, status)`
- `travel_bookings(plan_id, type)`
- `travel_bookings(plan_id, start_at_local)`
- `booking_planning_facts(planning_session_id, generation_role)`
- `booking_segments(booking_id, start_at_local)`
- `booking_endpoints(booking_id, role)`
- `accommodation_stays(plan_id, check_in_day_id, check_out_day_id)`

Promotion behavior:

- Bookings created during Planning Session are linked to the generated Plan when the draft Plan is persisted.
- The generated Plan stores a snapshot of the booking-derived facts it used.
- The generated Trip Blueprint stores privacy-minimized Blueprint Booking Constraints that shaped itinerary content.
- Plan-linked bookings store execution details that do not belong in the Trip Blueprint, such as confirmation codes, protected attachment metadata, supplier links, notes, and user-visible logistics.
- The Planning Session retains import history, source hash, and accepted constraint snapshots after promotion.
- Protected attachment content should be associated by source or attachment id rather than copied into multiple records.
- The original booking records remain editable through normal draft or active Plan rules.
- Booking Import before generation does not create a Plan or Draft Plan.

Migration should preserve existing `Plan.configuration.accommodation` data by creating an accommodation stay only when enough property/date data exists. Otherwise, keep existing configuration and do not fabricate dates.

## Reminder and Monitoring Requirements

Accepted Booking Constraints may compile into Dormant Reminders, inert until Plan activation. Booking Import alone must not schedule active reminders.

- Review all bookings before departure.
- Hotel check-in.
- Hotel check-out.
- Flight departure buffer.
- Airport transfer reminder.
- Car pickup.
- Car return.
- Event or tour arrival reminder.

MVP reminder buffers should use conservative defaults and remain editable in the Draft Plan review:

- Flight: a 24-hour check plus an airport-departure reminder derived from route/buffer assumptions.
- Train or long-distance transport: 2 hours before departure unless local context suggests another buffer.
- Hotel check-in: morning of check-in day.
- Hotel check-out: evening before checkout.
- Rental-car pickup and return: evening-before review plus same-day advance reminder.
- Event, ticket, tour, or restaurant: arrival reminder based on accepted start time and route context.

Reminder copy must include uncertainty when fields are missing:

- "No terminal recorded."
- "Confirmation code saved, but check-in time needs review."
- "Route to airport needs verification."

Later monitoring may add:

- Flight status checks.
- Venue booking requirement changes.
- Hotel check-in policy changes.
- Rental office opening-hours checks.

## Change and Versioning Requirements

Booking changes should be routed by whether they change travel structure.

Changes that require a new Trip Blueprint Version:

- flight, train, or other fixed transport date/time changes;
- arrival or departure node changes;
- accommodation date range, property, or location changes;
- rental-car pickup/return window or location changes;
- fixed event, ticket, tour, or restaurant time/location changes;
- downgrading or re-enabling a hard Booking Constraint when it affects itinerary feasibility.

Changes that may update only Plan-linked booking data:

- confirmation code corrections;
- seat, room type, fare class, baggage, breakfast, or add-on notes;
- price, cancellation summary, provider contact details, and manage-booking links;
- protected attachment replacement that does not change accepted Booking Constraints.

For an active Execution Plan, structural booking changes should follow the existing impact-preview and replacement-draft flow. Non-structural booking changes may update the Plan-linked booking record without rewriting the Trip Blueprint.

## Import and Extraction Requirements

MVP should support traveler-initiated booking email import from pasted confirmation text or uploaded `.eml`, `.html`, and `.txt` content.

MVP extraction may be narrow and template-based:

- preserve the original imported content as protected attachment metadata and source hash;
- read `.eml`, `.html`, and `.txt` through a local deterministic extraction pipeline that converts supported input into normalized text before field extraction;
- extract obvious fields such as provider name, confirmation code, local times, property names, airports, and pickup/return windows when possible;
- treat extracted fields as Proposed Booking Constraints until accepted;
- create `needs_review` records when important fields are missing;
- require preview confirmation before writing Booking Evidence or Booking Constraints.
- when parsing fails, keep the imported content as Booking Evidence, do not create Booking Constraints, and show a minimal manual form for the traveler to enter core fields.

Parsing failure must not cause the imported evidence to be discarded, and must not cause the full imported email or attachment to be sent to Blueprint Generation for the Agent to interpret directly.

MVP parser coverage should focus on:

- hotel or accommodation confirmations;
- flight confirmations;
- train or long-distance transport confirmations;
- rental-car confirmations.

MVP parser coverage targets English booking confirmations. Non-English confirmations may still be imported as Booking Evidence, but they can fall back to manual field entry without parser-specific support.

English extraction should start with general heuristics plus a small pluggable provider-template extension point. The MVP should not attempt a large provider-specific template library. Generic extraction should identify common fields such as confirmation numbers, date/time ranges, hotel names, airport-like locations, train endpoints, rental pickup/return windows, and provider labels.

Event, ticket, tour, restaurant, and other confirmations may be imported as semi-structured records, but first-phase extraction does not need provider-specific coverage for them.

MVP does not perform live flight-status or schedule-change checks. Flight numbers support parsing and display, but itinerary constraints come from traveler-accepted local departure and arrival times. Live status belongs to later monitoring connectors.

When extraction is added:

- Use a deterministic parser first when available.
- Use AI only as a later optional fallback for files or fields the deterministic parser cannot read, and only after explicit traveler action.
- Never send booking files to a remote model unless the user explicitly enables that connector and understands the data boundary.
- Store extraction provenance and confidence.
- Require preview confirmation for every created booking.

## Security and Privacy Requirements

- Confirmation codes, attached files, and passenger names are sensitive.
- Confirmation codes should be hidden by default in Web cards.
- File uploads need size and MIME limits.
- Attachment download endpoints must verify Plan ownership/access.
- Logs must not include confirmation codes or extracted raw document text.
- Full imported email content must not be stored as ordinary business text. If retained, it must be a protected attachment separated from Plan, Trip Blueprint, logs, and Agent input.
- Generation input may include accepted Booking Constraints and short source labels, but not confirmation codes, full email bodies, or raw attachments.
- Traveler names from imported confirmations are used only for grouping and review in MVP, not for Profile enrichment or generation.
- Backups should include booking records and attachments if the backup feature covers trip data.

## Non-Goals

- Booking hotels, flights, cars, restaurants, tickets, or tours directly.
- Paying, cancelling, checking in, or changing reservations automatically.
- Using imported booking prices for budget totals, cost splitting, or recommendation ranking in MVP.
- Claiming an external booking task is complete just because a link was opened.
- Treating AI extraction as authoritative.
- Storing passports, payment cards, or full identity documents in MVP.

## Suggested Delivery Plan

### Phase 1: Booking Intake for Generation

- Add domain types, storage tables, Planning Session API CRUD, and Web intake forms.
- Add traveler-initiated booking email import with preview for pasted text, `.eml`, `.html`, and `.txt`.
- Support accommodation, flight, rental car, event/ticket, and other.
- Derive planning facts from bookings and include them in proposal/generation context.
- Validate hard constraints before generation.

### Phase 2: Generated Plan Integration

- Promote Planning Session bookings into Plan-linked bookings when a draft Plan is persisted.
- Link bookings to itinerary days, Places, route handoffs, Plan configuration, and generated reminders.
- Link accommodation to Plan configuration and daily departure route recalculation.
- Add impact preview behavior for active Plan edits.
- Render bookings in timeline and preparation sections.

### Phase 3: Import Preview

- Extend import preview to richer document formats such as PDF and pass files.
- Improve deterministic extraction coverage across common providers.

### Phase 4: Smart Assistance

- Add AI extraction fallback.
- Add optional mailbox connectors only after explicit authorization, duplicate handling, and retention rules are defined.
- Add optional flight-status or calendar connectors.
- Add booking-aware in-trip Telegram assistance.

## Open Questions

- Should pre-generation booking records live inside Planning Session JSON at first, or immediately use normalized booking tables with nullable `planId`?
- Should generated Plans snapshot booking-derived facts only, or full booking records as of generation time?
- Should active Plan booking edits always create replacement drafts, or can low-impact fields such as notes and confirmation code update in place?
- Do attachments need encrypted-at-rest storage in the first implementation?
- Which local map/search connector should power airport, station, and hotel place resolution?
- Should the Web view be named "Bookings", "Reservations", or "Trip Logistics"?
