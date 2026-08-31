# Make Trip Blueprints the travel-content source of truth

Changes to place priority, day assignment, or itinerary order create a new Trip Blueprint Version before Landi compiles a replacement Draft Plan. Landi does not edit the Plan's copy of travel content independently, because allowing both Blueprint and Plan to own itinerary state would create conflicting sources of truth and make recompilation lossy.

## Consequences

The Web workspace sends Blueprint revisions rather than direct Plan-presentation mutations. Existing execution continues from the approved Execution Plan until the traveler approves the newly compiled replacement.
