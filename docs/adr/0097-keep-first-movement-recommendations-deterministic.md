# Keep first Movement recommendations deterministic

The first Movement Action Card implementation will generate Local Transport Recommendations and rationale through deterministic rules and templates, not an Agent or LLM call. `/go` is a current execution command, so it should be fast, stable, testable, and grounded in known route, weather, timing, luggage, party, and preference facts.

## Considered Options

- Ask an Agent to write each movement recommendation. This could produce nuanced copy, but it adds latency, variability, and harder-to-test behavior.
- Use deterministic rules and templates. This fits the first movement slice and keeps execution guidance predictable.
