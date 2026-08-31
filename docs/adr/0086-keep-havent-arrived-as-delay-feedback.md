# Keep haven't-arrived as delay feedback

Landi will treat "I haven't arrived" as current delay feedback for a movement interaction, not as durable stop state. It may redisplay movement help or adjust existing arrival guidance timing, but it must not mark a stop incomplete, change itinerary order, or trigger replanning.

## Considered Options

- Use "I haven't arrived" to update itinerary progress. This would make the execution model more complete, but it implies durable stop state and progress tracking.
- Keep it as delay feedback. This reuses existing route guidance semantics without expanding Plan state.
