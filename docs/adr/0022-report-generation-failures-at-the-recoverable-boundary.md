# Report generation failures at the recoverable boundary

Landi reports Blueprint Generation failures using the failed stage, exact machine-readable validation paths, retained checkpoint summary, and available resume action. It does not collapse research, itinerary, compilation, and rendering failures into a generic Agent or Plan-contract error, because each boundary has a different owner and recovery operation.

## Consequences

Generation status APIs and the Web share a typed failure model. User messages remain concise but identify saved progress and the next action; diagnostic logs retain the corresponding structured issue codes without exposing prompts or private source bodies.
