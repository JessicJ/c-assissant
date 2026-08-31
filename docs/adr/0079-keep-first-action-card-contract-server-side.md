# Keep first Action Card contract server-side

The first Execution Action Card contract will live in server-side execution code rather than `@c-assistant/core` Plan or Trip Blueprint schemas. Action Cards are current Telegram responses, not durable travel content or Plan commitments; moving the contract into Core would prematurely make temporary execution UI part of the long-term domain model.

## Considered Options

- Add Execution Action Cards to Core. This would make the contract reusable across surfaces, but it implies durable cross-channel semantics before they are needed.
- Keep the first contract server-side. This preserves the Plan and Blueprint boundaries while the Telegram execution loop is proven.
