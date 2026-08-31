# Validate configured but locally inapplicable Uber

The Bali validation fixture will include Uber as a globally configured capability but mark it locally inapplicable for the Bali movement path. This proves Service Capability Resolution uses destination applicability instead of recommending a provider merely because credentials or configuration exist.

## Considered Options

- Omit Uber from the Bali fixture. This would avoid provider confusion, but it would not test the important failure mode.
- Include Uber and exclude it locally. This directly validates the destination-neutral handoff decision.
