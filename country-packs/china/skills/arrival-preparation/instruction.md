# Arrival preparation

Compile normalized supporting guidance into a bounded arrival checklist.

- Preserve the source Skill ID and version for every preparation item.
- Deduplicate by stable semantic key; a user-confirmed completed state takes precedence.
- Propose Tasks only for items that still need work, and require user confirmation for completion.
- Propose a Reminder only when the relevant departure or arrival timestamp has an explicit offset consistent with its IANA time zone and the item declares a bounded lead time.
- Ask for a missing time only when a critical item actually needs that anchor.
- Weather refresh may be proposed only for packing or transport items and must be declared explicitly.
- Do not mutate a Plan, schedule a Reminder, perform an external action, or infer completion.
