# Create dedicated Movement Action Card service

Landi will implement `/go` through a dedicated server-side `movement-action-card.ts` service rather than extending the existing `arrival-route.ts` path. Arrival routing is lodging-arrival oriented and currently Uber-specific, while `/go` needs provider-neutral Next Planned Stop movement, Recommended Action Sets, Local Transport Options, and Service Capability Resolution.

## Considered Options

- Extend `arrival-route.ts`. This reuses existing code quickly, but it carries arrival-specific and Uber-specific assumptions into `/go`.
- Create a dedicated movement service. This keeps the new execution semantics clean while still allowing reuse of connector helpers and route timing ideas.
