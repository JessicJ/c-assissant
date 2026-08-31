# Own a versioned Blueprint Contract in Landi

Landi defines and versions the domain contracts for Research Sets and Trip Blueprints independently from the `interactive-trip-planner` Skill's internal `pois.json`, `sources.json`, `events.json`, and `itinerary.json` layouts. Skill artifacts enter the product only after conversion to this Blueprint Contract, preventing Skill template changes from directly breaking persistence or Web rendering.

## Consequences

Skill Lineage and Blueprint schema version are separate metadata. A deterministic Skill Importer owns conversion and Safe Normalization from supported Skill artifacts into the Blueprint Contract; it may canonicalize formats, assign stable identities, or merge confirmed duplicates, but cannot invent facts, remove places, rearrange itinerary content, or invoke an Agent to repair invalid structure. The Plan Compiler remains a separate boundary that adds Landi execution semantics.
