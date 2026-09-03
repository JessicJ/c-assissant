# Refine Blueprint workspace chrome

Status: accepted

Landi will keep the Web Plan Workspace content-first by showing small `i` Source Markers only on real images, opening Guide Detail by selecting an itinerary block, guide card, or map item instead of through a persistent Detail tab, and rendering the day plan as a time-ordered itinerary card sequence rather than a visible line-and-dot timeline. Text-only guide cards, tips, details, and Sources views expose provenance through plain summaries or links, and the Itinerary Explore Panel may use an implicit unfiltered state rather than a visible "All" chip.

This amends the earlier marker and timeline presentation decisions because the broader marker treatment made text-only planning surfaces feel noisy, while the visual timeline and extra side-panel controls competed with the dense desktop workspace. The underlying domain boundaries remain unchanged: itinerary order, flexible timing, source provenance, guide relationships, and version-aware edits still belong in the Blueprint contract, but Web chooses a quieter presentation for them.
