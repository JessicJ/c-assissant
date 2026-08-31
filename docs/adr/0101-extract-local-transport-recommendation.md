# Extract Local Transport Recommendation

Landi will implement Local Transport Recommendation in a dedicated server-side helper rather than embedding ranking rules in the Movement Action Card service. Recommendation rules need focused tests across distance, duration, weather, day or night timing, luggage, party size, traveler preference, and rider-confirmed scooter access.

## Considered Options

- Keep recommendation inside the card service. This is faster to wire, but it mixes ranking policy with card assembly and Telegram flow.
- Extract a recommendation helper. This makes the rules easier to test and change without touching command handling.
