# Generate complete recommended itinerary before editing

Landi will generate a complete recommended itinerary before the traveler edits the Plan Workspace, using the trip's time boundary, weather context, traveler preferences, constraints, and available evidence. Timeline blocks in that recommended itinerary should use Schedulable Itinerary Objects such as Attraction Places, Dining Places, Purchase Places, Experience Offerings, movement, rest, or flexible time. Dining, shopping, and local-experience blocks may be Flexible Itinerary Blocks when exact start times would make the plan unnecessarily rigid. Theme-level records such as Local Food, Local Product, and Experience Theme can explain scheduled choices but should not occupy the timeline directly.

The traveler can apply this recommended itinerary as-is, or use guide material under the Itinerary workspace to replace, add, remove, or rearrange elements through pending edits.

Starting from an empty or mostly unscheduled itinerary canvas was rejected because it would make Landi feel like a planning database instead of an assistant, and would force the traveler to do too much composition work before the plan becomes useful.
