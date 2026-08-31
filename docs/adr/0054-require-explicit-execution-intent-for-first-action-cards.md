# Require explicit execution intent for first Action Cards

The first Travel Execution Capability slice will require an Explicit Execution Intent before producing a Movement, Nearby Food, or Weather Impact Action Card. Landi will not start with a broad "what should I do now" intent router because ambiguous on-trip messages can otherwise trigger the wrong workflow.

## Considered Options

- Add a unified now/next intent immediately. This could feel magical, but it depends on reliable prioritization across movement, food, and weather.
- Require explicit execution intents first. This keeps behavior predictable while the three card types are proven independently.
