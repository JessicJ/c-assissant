# Keep food and weather read-only across Plan states

Landi will make `/go` execution-only, but nearby food and weather commands may remain available as Read-only Execution Commands across broader Plan states. Nearby food and weather do not mutate the Trip Blueprint or Plan and can provide useful current information without treating an unapproved Draft Plan as execution authority.

## Considered Options

- Require an Execution Plan for every on-trip command. This is stricter, but it unnecessarily blocks read-only or ephemeral help.
- Make only movement execution-only. This keeps the approval boundary where it matters most while preserving low-risk assistance.
