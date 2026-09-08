# Own Blueprint generation policy and preserve checkpoint lineage

Status: accepted

New Blueprint generations use the repository-owned `landi-trip-blueprint@1.0.0` policy, embedded directly in research and itinerary runtime invocations. Source selection follows the needed capability and actual availability rather than requiring a Regional Source Pack; the runtime adapter remains the execution mechanism, and no separately installed travel skill is required for new generations.

An existing generation for the same confirmed proposal keeps its original policy identity, including `interactive-trip-planner@0.2.0` checkpoints. Status, event, cancellation, and retry paths resolve that saved identity, and remaining legacy research or itinerary stages keep the supported legacy instructions. We choose continuity over automatically migrating partial research: silently relabeling old evidence would misrepresent its origin, while starting over would discard useful progress. A new confirmed proposal starts with the current policy; unsupported policy versions stop before a runtime call and retain their saved data. Legacy continuation still requires the legacy skill to be available to the runtime.
