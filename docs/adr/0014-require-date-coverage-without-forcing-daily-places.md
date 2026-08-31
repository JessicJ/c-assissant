# Require date coverage without forcing daily places

A complete Trip Blueprint represents every calendar day in the confirmed travel range, while allowing an Itinerary Day to be intentionally devoted to transit, rest, or free time without scheduled places. This preserves chronological completeness without inventing activities merely to satisfy a place-count validator.

## Consequences

Missing or duplicate travel dates are structural defects. An empty scheduled-place list is valid only when the day explicitly states its non-sightseeing intent, and daily place-count targets remain planning guidance rather than validity rules.
