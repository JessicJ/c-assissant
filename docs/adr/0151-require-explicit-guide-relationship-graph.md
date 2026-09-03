# Require explicit Guide Relationship Graph

The Landi-native planning Skill should output explicit Guide Relationship Graph data in the Blueprint Contract. Required relationships include `localFoods -> diningPlaces`, `localProducts -> purchasePlaces`, `experienceThemes -> offerings`, and `attractions -> placeIdentity`.

The Skill Importer normalizes and validates these relationships, but Web should not infer them from prose, category labels, or matching names. Timeline blocks should reference Schedulable Itinerary Objects rather than theme-level records.

When the Skill outputs a useful theme-level item without a related Schedulable Itinerary Object, the importer preserves it as an Informational Guide Item and marks it unavailable for timeline placement. Web may show it in explore, search, filter, and detail surfaces, but must not show an add-to-itinerary action. The importer must not discard useful content, invent a concrete place, or allow Web to schedule a theme directly. Landi does not design a separate post-import enrichment workflow that later turns Informational Guide Items into schedulable material.

Implicit Web inference was rejected because it would make guide presentation brittle and could lose the distinction between what to eat and where to eat, what to buy and where to buy it, or an experience theme and the concrete activity that can be scheduled.
