# Use /weather for weather impact when context exists

Landi will keep `/weather` as the weather entrypoint and return a Weather Impact Action Card when enough Plan or current-action context exists. When that context is missing, `/weather` degrades to a Weather Lookup, avoiding a separate `/impact` command while preserving the distinction between weather facts and weather-driven execution guidance.

## Considered Options

- Add a separate `/impact` command. This would make the semantic boundary explicit, but it asks travelers to know an internal distinction.
- Reuse `/weather`. This keeps the entrypoint familiar and lets Landi choose the richest safe response for the available context.
