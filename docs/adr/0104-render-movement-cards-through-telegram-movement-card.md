# Render Movement Cards through telegram-movement-card

Landi will render first-slice Movement Action Cards through a dedicated `telegram-movement-card.ts` formatter, following the existing channel-specific style of `telegram-food.ts`. This avoids adding more Telegram rendering logic to `index.ts` and keeps the provider-neutral card service separate from message formatting.

## Considered Options

- Render movement cards inline in `index.ts`. This is direct but continues to grow the server entrypoint.
- Add `telegram-movement-card.ts`. This follows existing naming and keeps channel rendering isolated.
