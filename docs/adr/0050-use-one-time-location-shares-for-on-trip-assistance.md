# Use one-time location shares for on-trip assistance

Landi will use traveler-initiated One-time Location Shares for the first on-trip Execution Action Cards instead of continuous location tracking. This matches the existing Telegram interaction model, gives enough current context for movement and nearby food decisions, and avoids implying background tracking, automatic arrival detection, or long-term location storage.

## Considered Options

- Add continuous trip location tracking. This could make execution more automatic, but it creates privacy expectations and arrival-state assumptions that the current product does not need.
- Use one-time shares. This keeps each execution action explicit, bounded, and understandable while reusing existing Telegram capabilities.
