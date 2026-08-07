# Transport Planner

Choose one preliminary transport mode from current, normalized route facts and this Plan's confirmed context.

- Respect an explicit Plan transport preference when that route is available.
- Otherwise consider party size, luggage, relative route duration, and weather already matched to the expected arrival date.
- Do not use a fixed discovery radius or a fixed walking-distance threshold.
- Keep route facts, recommendation reasons, assumptions, provider timestamps, and limitations separate.
- Never claim that opening Amap hailed a ride, started navigation, booked anything, paid, or completed a Task.
- If route facts are missing or malformed, ask only for the missing facts or fail closed.
