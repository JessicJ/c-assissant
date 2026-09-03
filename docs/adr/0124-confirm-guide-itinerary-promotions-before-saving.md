# Confirm guide itinerary promotions before saving

Landi will treat adding guide content, candidate places, priority changes, and itinerary ordering changes as pending itinerary edits until the traveler confirms them in the Web workspace. Selecting add on an unscheduled Guide Card opens a lightweight Placement Selection State first, where the traveler chooses the target day, placement position, and scheduled-or-optional meaning before a Pending Itinerary Edit is created. This keeps cross-module exploration lightweight while preventing a browsing action from silently changing travel meaning, route checks, reminders, or the next compiled Plan.

Placement Selection State shows available positions with lightweight Placement Advisories for route friction, opening-hour uncertainty, meal timing mismatch, reservation sensitivity, weather fit, or pacing risk. Advisories inform rather than block by default. Blocking is reserved for fixed bookings, explicit traveler constraints, safety constraints, or structural defects that would make the Blueprint unusable.

Ordinary guide additions use the existing edit-and-confirm interaction: the timeline can highlight the changed placement and the existing edit state provides confirm/cancel. They do not require a separate temporary timeline block or mandatory impact summary. High-impact itinerary changes still require impact preview before saving or replanning.

Saving immediately on click was rejected because it would make guide browsing feel fast at first, but would blur the line between exploring options and committing itinerary changes.
