# Map taxi preference to ride-hail car option

Landi will map the existing Plan `taxi` preference to the traveler-facing `ride-hail car` Local Transport Option rather than to a specific provider such as Uber. Provider selection belongs to Service Capability Resolution, so destinations where Uber is not applicable can still satisfy the taxi preference through Manual Handoffs such as Grab, Gojek, Bluebird, or private driver options.

## Considered Options

- Treat `taxi` as Uber because the current handoff is Uber-specific. This preserves old behavior but breaks destination-neutral execution.
- Treat `taxi` as a local transport option. This keeps user preference separate from provider availability.
