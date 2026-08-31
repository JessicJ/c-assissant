# Use /go as the first movement command

Landi will use `/go` as the first traveler-facing Movement Intent Command. The command is short enough for on-trip mobile use and clearly suggests moving toward the next planned stop, while avoiding provider-specific names such as `/uber` and more ambiguous names such as `/next`.

## Considered Options

- Use `/uber`. This preserves the current test entry but wrongly makes the movement workflow provider-specific.
- Use `/next` or `/move`. These are plausible, but `/next` can mean simply viewing itinerary content and `/move` reads more like an internal operation.
- Use `/go`. This best matches the on-trip action moment.
