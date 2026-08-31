# Use testable rationale fields, not debug fields

The first Movement Action Card object will not expose debug-only fields. It may include testable structured reason fields such as `rationaleCodes`, `visibleRationale`, `degradedReasons`, and `blockingReasons`, allowing deterministic tests without leaking provider diagnostics or internal debugging language into the product contract.

## Considered Options

- Add `debugReasons` to the card object. This is convenient for tests, but it can leak implementation framing into product data.
- Use structured rationale fields. This keeps the card testable while preserving a traveler-facing contract.
