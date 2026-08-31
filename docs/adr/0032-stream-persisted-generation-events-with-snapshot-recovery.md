# Stream persisted Generation Events with snapshot recovery

Landi persists traveler-safe Generation Events and streams them to the Web for live progress, while retaining a status snapshot endpoint for initial load and disconnection recovery. Generation state does not live only in browser memory or a process stream, so navigation, refresh, and reconnect preserve the true stage and saved checkpoints.

## Consequences

Events expose verifiable stage, status, geographic scope, retained counts, pending stages, and next action without prompts, reasoning, credentials, source bodies, or model-estimated percentages. Clients load the latest snapshot before subscribing and can fall back to bounded status queries if streaming is unavailable. Browser navigation and subscription loss do not cancel server work; cancellation requires an explicit command.
