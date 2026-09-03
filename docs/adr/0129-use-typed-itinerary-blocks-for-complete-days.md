# Use typed itinerary blocks for complete days

Landi will generate complete recommended itinerary days with typed blocks for attractions, meals, shopping, local experiences, transit, rest, and flexible time instead of representing the day only as a flat list of places. Each scheduled block should reference a Schedulable Itinerary Object, such as an Attraction Place, Dining Place, Purchase Place, Experience Offering, movement, rest, or flexible time. Dining, shopping, local-experience, rest, and exploratory stops may use flexible or optional timing when the plan should remain usable without pretending every activity has a precise start time. Theme-level records such as Local Food, Local Product, and Experience Theme can support the block's explanation in detail views but should not be scheduled directly.

This lets dining, shopping, and local experiences become part of the default usable plan while still making replacement and rearrangement clear in the Web workspace.

A sightseeing-only default itinerary was rejected because it would make the generated plan feel incomplete and force travelers to manually place meals, shopping, and local experiences before the plan reflects a real day of travel.
