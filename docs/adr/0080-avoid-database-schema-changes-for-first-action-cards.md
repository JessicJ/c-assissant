# Avoid database schema changes for first Action Cards

The first Execution Action Card implementation will avoid database schema changes unless existing Telegram callback or execution interaction state cannot safely support required feedback. Since cards are server-side Telegram responses rather than durable Plan or Web history, schema changes should not be introduced merely to store card content.

## Considered Options

- Add new persistence for card state immediately. This could simplify some feedback handling, but it expands storage and migration scope.
- Avoid schema changes unless necessary. This keeps the first slice small and aligned with the non-durable card boundary.
