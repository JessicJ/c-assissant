# Keep local transport as recommendation and handoff

Landi's first on-trip transport capability will recommend a local transport option and prepare the traveler to continue externally, but it will not claim live fare, live vehicle availability, ETA, dispatch, booking, or payment. Landi may internally resolve service capabilities to choose between a Prefill-capable Handoff and a Manual Handoff, but the traveler should experience the result as a clear action card rather than a visible provider-diagnostics flow.

## Considered Options

- Integrate provider fare and dispatch APIs. This would create a richer experience but depends on partner access, provider-specific contracts, and external action risk.
- Recommend and hand off. This is feasible with current Google route facts, weather, location sharing, and copy/link handoffs, and keeps irreversible decisions inside the traveler's chosen service. Prefill remains an enhancement only when the local provider capability is certain.
