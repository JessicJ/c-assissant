# Generate only applicable Plan Stages

Landi does not require every Plan to contain exactly six Stages. The Plan Compiler creates only the execution Stages supported by the trip's actual tasks, reminders, and responsibilities, because itinerary presentation belongs to the Trip Blueprint and empty mandatory modules add schema fragility without execution value.

## Considered Options

- Preserve six fixed modules for every trip. This keeps the old Agent output shape but forces content generation to satisfy presentation scaffolding.
- Compile applicable Stages from real execution work. This keeps Plan validation aligned with what Landi can review and execute.

## Consequences

Agent output no longer supplies or counts Plan Stages. Web rendering must use Stage presentation kinds when Stages exist and must not infer a fixed module set from array positions.
