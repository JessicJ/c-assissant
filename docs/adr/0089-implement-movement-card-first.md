# Implement Movement Action Card first

Landi will implement the Movement Action Card before General Nearby Food Assistance and Weather Impact Action Cards. Movement validates the most important first-slice boundaries, including `/go`, Next-stop Selection, One-time Location Share, route facts, Local Transport Recommendation, Service Capability Resolution, Manual Handoff, degradation, and feedback.

## Considered Options

- Implement all three card types in parallel. This could show breadth quickly, but it risks duplicating immature card semantics.
- Implement Movement first. This proves the hardest execution path and creates reusable structure for food and weather.
