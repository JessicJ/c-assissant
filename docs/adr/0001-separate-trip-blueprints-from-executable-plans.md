# Separate Trip Blueprints from executable Plans

Landi treats the travel-planning Skill's researched places, sources, events, and itinerary as a non-executable Trip Blueprint. A deterministic Plan Compiler converts an approved Trip Blueprint into Landi's executable Plan structure, because asking the Agent to produce both rich travel content and Landi's persistence and execution contract in one response caused oversized outputs, fragile schema validation, and repeated AI repair attempts.

## Considered Options

- Have the Skill emit Landi's complete Plan contract directly. This couples travel expertise to Landi's storage and execution model and was rejected because structural failures can invalidate otherwise useful research.
- Keep Trip Blueprint and Plan separate. This preserves travel-content richness while making the execution structure deterministic and independently testable.

## Consequences

Trip Blueprint validation and Plan validation are separate gates. The Plan Compiler, rather than the Skill or a repair Agent, owns stages, tasks, reminders, stable identifiers, and other Landi-specific execution fields. Compilation is meaning-preserving: it cannot delete places, rearrange itinerary content, or rewrite travel advice. Any such content change produces a new Trip Blueprint Version before compilation.
