# Require location share before current /go card

When `/go` needs the traveler's current position, Landi will request a One-time Location Share and wait for that response before producing the Movement Action Card. It will not guess the origin from lodging, a previous stop, or itinerary order because `/go` is current on-trip assistance rather than a planned-route preview.

## Considered Options

- Guess the origin from the lodging anchor or previous itinerary stop. This can produce a card faster, but it may route from the wrong place.
- Require a location share first. This keeps current movement guidance grounded in the traveler's explicit location disclosure.
