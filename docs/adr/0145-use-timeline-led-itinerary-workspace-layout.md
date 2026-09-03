# Use timeline-led itinerary workspace layout

Landi will use a timeline-led desktop layout for the Itinerary workspace: the left side presents the time-ordered Itinerary Timeline as the plan body, the right side presents the Itinerary Map as spatial and route context, and one openable Workspace Side Panel switches between the Itinerary Explore Panel and shared detail view.

This decision scopes the Web workspace as a desktop workspace. Mobile layout and mobile editing behavior are not design targets for Landi's Web workspace.

The layout should embrace Desktop Workspace Density. When screen space allows, timeline, map, and the Workspace Side Panel may be visible together for side-by-side reading, spatial review, and guide comparison instead of collapsing into a mobile-style single-column flow. Explore and detail are modes of the same side panel rather than simultaneous sidebars.

The Workspace Side Panel preserves Side Panel Navigation State when switching from explore mode to detail mode, including filters, sort order, scroll position, and selected card. Returning from detail restores the prior exploration context.

A map-dominant layout was rejected because the itinerary is first a time-ordered plan. The map is important for understanding space and routes, but guide browsing, source inspection, and adjustment actions need a separate panel so the timeline remains readable.
