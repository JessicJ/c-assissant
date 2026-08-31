# Checkpoint research before itinerary generation

Landi persists a completed Research Set before the Skill finishes day-by-day itinerary generation. If itinerary generation fails or times out, Landi resumes from that Research Set rather than repeating place and source discovery, while withholding the Trip Blueprint and Draft Plan states until the itinerary is structurally complete.

## Consequences

Generation progress distinguishes research completion from Blueprint completion. Retry and resume operations target the failed or cancelled stage, and cleanup must not delete a persisted Research Set merely because later work failed or the traveler cancelled generation. The Web may show the retained place count and continuation action, but it cannot present the Research Set as a reviewable Plan; deleting checkpoints requires a separate explicit operation.
