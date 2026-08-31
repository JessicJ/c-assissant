# Test first movement slice with deterministic automation

The first `/go` Movement Action Card slice will use unit tests and Telegram command integration tests as its automated gate, while real-device Telegram validation remains manual. This matches the deterministic design for Next-stop Selection, Local Transport Recommendation, Service Capability Resolution, card formatting, and the Bali one-route fixture without making CI depend on live devices.

## Considered Options

- Require real-device Telegram validation as an automated gate. This would be closer to production behavior, but it is fragile and environment-dependent.
- Use deterministic automated tests plus manual device validation. This gives reliable coverage for the first implementation while preserving a real-device sanity check.
