# Use callback data for Alternative Action Selection

Landi will implement "Try another option" through Telegram callback data carrying minimal context such as Plan ID, Plan version, stop ID, and option ID. The server should regenerate the current Movement Action Card context and promote the selected option to primary instead of storing durable card state.

## Considered Options

- Persist every card and reference it by card ID. This would simplify callbacks, but it conflicts with the no card-history storage boundary.
- Encode the entire card in callback data. This avoids storage but is too large and brittle.
- Use minimal callback context and regenerate. This keeps state small while preserving deterministic behavior.
