# Keep Bali validation independent of Grab and Gojek APIs

The Bali Validation Scenario for the first Travel Execution Capability slice must not depend on Grab or Gojek APIs. It may mention locally appropriate services through Manual Handoffs, but successful validation must rely only on capabilities Landi can already control or deterministically provide, such as Google Maps route facts, Google Weather, Telegram interaction, web links, and copyable pickup and destination details.

## Considered Options

- Make Grab or Gojek API integration part of the validation path. This would better match local behavior but risks blocking the feature on partner access and provider-specific approval.
- Keep validation independent of those APIs. This ensures the first slice is feasible while preserving room for future Prefill-capable Handoffs when a provider integration is certain.
