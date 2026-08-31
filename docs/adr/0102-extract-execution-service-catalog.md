# Extract Execution Service Catalog

Landi will keep code-owned static Service Catalog Entries and Service Capability Resolution in a dedicated `execution-service-catalog.ts` module rather than hard-coding them inside Movement Action Cards or transport recommendation rules. Recommendation chooses the suitable Local Transport Option, while the catalog determines which locally applicable service or Manual Handoff can support that option.

## Considered Options

- Hard-code service choices inside the movement service. This is quick, but it entangles provider knowledge with card assembly.
- Hard-code service choices inside recommendation rules. This conflates "what should the traveler do" with "which service can hand it off."
- Extract the catalog. This keeps service availability and recommendation policy separate.
