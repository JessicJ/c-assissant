# Use movement_go location intent

Landi will use `movement_go` as the Telegram location intent purpose for `/go`. This keeps the new provider-neutral movement flow separate from existing `arrival_route` and `uber_test` paths and makes future cleanup of provider-specific movement code easier.

## Considered Options

- Reuse `arrival_route`. This would reuse existing state, but it carries arrival-to-lodging semantics.
- Reuse `uber_test`. This is clearly wrong for destination-neutral movement.
- Add `movement_go`. This gives the first `/go` flow its own explicit interaction identity.
