# Extract Next-stop Selection

Landi will implement deterministic Next-stop Selection in a dedicated server-side helper rather than burying it inside the Movement Action Card service. The rule is independent of Telegram rendering, handoff behavior, and service capability resolution, so separating it makes stale-stop, untimed-stop, and no-target behavior easier to test.

## Considered Options

- Keep selection inside `movement-action-card.ts`. This is fewer files, but it mixes itinerary-state rules with card assembly.
- Extract a helper. This keeps the selection policy explicit and testable.
