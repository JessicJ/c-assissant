# Do not add stop completion to first /go

Landi will not add an "I arrived" path or durable stop-completion state to the first `/go` implementation. Arrival completion would affect Next-stop Selection, execution history, replanning, and Plan state, so the first slice keeps feedback limited to delay handling and current-option selection.

## Considered Options

- Add stop completion immediately. This would make `/go` more stateful, but it expands the feature into itinerary progress tracking.
- Avoid stop completion in the first slice. This keeps `/go` focused on current movement assistance.
