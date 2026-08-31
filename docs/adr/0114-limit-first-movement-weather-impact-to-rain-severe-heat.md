# Limit first movement weather impact to rain, severe weather, and heat

The first Movement Action Card will classify weather impact only as rain, severe weather, or heat for transport recommendation purposes. These categories cover the main movement choices that change walking, motorbike, car, delay, or caution advice without turning `/go` into a full weather interpretation feature.

## Considered Options

- Interpret detailed weather conditions immediately. This could be richer, but it expands the movement slice into broader weather guidance.
- Limit to rain, severe weather, and heat. This is enough for first-slice transport decisions and remains easy to test.
