# Bound first recommendation context

The first Recommended Action Sets will rank options using distance, estimated duration, weather, day or night timing, luggage, party size, and traveler preference. Landi will not use live fares, live provider supply, legal eligibility proof, or a detailed local rules engine in this slice because those inputs are not consistently available or safe to infer.

## Considered Options

- Include live provider and local-rule inputs immediately. This could improve precision, but it would make the first slice depend on unavailable or destination-specific data.
- Use a bounded Recommendation Context. This is sufficient for useful on-trip guidance and matches Landi's current Plan, route, weather, and travel-context facts.
