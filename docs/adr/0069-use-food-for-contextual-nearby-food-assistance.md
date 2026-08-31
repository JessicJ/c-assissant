# Use /food for contextual nearby food assistance

Landi will keep `/food` as the food entrypoint and return a Nearby Food Action Card when enough Plan or current-area context exists. When that context is missing, `/food` degrades to a one-time nearby search from the traveler's shared location; in both cases the result remains Generic Nearby Food Assistance and does not modify the Trip Blueprint or Plan.

## Considered Options

- Add a separate contextual food command. This would make implementation states explicit, but it asks travelers to understand an unnecessary distinction.
- Reuse `/food`. This keeps the interaction simple while allowing richer execution guidance when Plan context is available.
