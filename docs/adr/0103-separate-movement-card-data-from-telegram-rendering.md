# Separate Movement Card data from Telegram rendering

`movement-action-card.ts` will return a provider-neutral Movement Action Card object, and Telegram-specific text and button rendering will live in a separate formatter. This keeps recommendation, service resolution, and card assembly independent from Telegram markup and allows tests to validate domain data separately from channel rendering.

## Considered Options

- Have the movement service return Telegram messages directly. This is convenient for the first command, but it couples execution semantics to one channel.
- Return card data and render separately. This keeps the first implementation clean without adding Web or cross-channel UI work.
