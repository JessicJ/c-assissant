# Render travel content from the linked Trip Blueprint

The Plan Workspace reads places, itinerary days, candidates, and Movement Plans directly from the Trip Blueprint identified by the Plan's Compilation Lineage. The Plan stores execution Stages, Tasks, Reminders, approval state, and lineage rather than duplicating travel content in `Plan.presentation`, eliminating two independently mutable itinerary representations.

## Consequences

Workspace reads must resolve a consistent Plan-and-Blueprint pair. Existing native map and itinerary components may remain, but their input view model is derived from the linked Blueprint; migration must preserve access to historical Plans that still contain embedded presentation data.
