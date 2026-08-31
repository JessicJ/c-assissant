# Limit first Movement Card buttons

The first Movement Action Card will limit traveler actions to opening Google Maps, copying pickup details, copying destination details, and opening a locally applicable ride app or service when available. It will not include ride confirmation, payment confirmation, or arrival-completion buttons because those imply external action state or itinerary progress tracking.

## Considered Options

- Add rich ride and arrival controls immediately. This could make the card feel more complete, but it expands state management beyond first-slice execution guidance.
- Limit buttons to safe handoffs and copy actions. This preserves the External Action boundary and keeps the first card small.
