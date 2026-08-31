# Treat unknown party size as one for current recommendation

The first Movement Action Card rules will treat unknown party size as one traveler for current recommendation ranking only. This Conservative Execution Default must not update the Plan or Profile, and later explicit party information can change future recommendations.

## Considered Options

- Block `/go` until party size is known. This makes recommendations more precise, but it is too brittle for on-trip use.
- Default to one traveler for ranking. This keeps `/go` useful while preserving explicit Plan and Profile data.
