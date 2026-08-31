# Use conservative distance bands for first transport rules

The first Local Transport Recommendation rules will use conservative distance bands: walking-friendly at 800 meters or less, motorbike or car relevant from over 800 meters through 8 kilometers, and long or cross-area over 8 kilometers. These are testable first-slice defaults, not global mobility truths.

## Considered Options

- Avoid explicit thresholds. This would be flexible, but it makes deterministic tests and explanations weaker.
- Use conservative thresholds. This gives the first `/go` implementation clear behavior that can be tuned later with evidence.
