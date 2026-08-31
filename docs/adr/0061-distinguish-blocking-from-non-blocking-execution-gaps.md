# Distinguish blocking from non-blocking execution gaps

Landi will block an Execution Action Card only when the requested card lacks the minimum facts needed to act, such as a current Execution Plan, a Next Planned Stop for movement, a required One-time Location Share, or resolvable movement endpoints. Missing recommendation refinements or provider enhancements are Non-blocking Execution Gaps and should produce a Degraded Action Card with conservative defaults.

## Considered Options

- Treat every missing fact as a blocker. This would avoid partial advice but make on-trip assistance fail too often.
- Separate blocking and non-blocking gaps. This keeps the traveler moving while preventing Landi from inventing facts or acting without a viable destination.
