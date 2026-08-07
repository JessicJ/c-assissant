# Internal Skills

Each Skill directory follows the source structure below:

```text
skill-name/
├── skill.json
├── instruction.md
├── references/       # optional
├── scripts/          # optional
├── tests/
└── SKILL.md          # generated distribution artifact
```

V1 does not expose these Skills for separate installation or direct execution.

All implemented manifests are loaded by one China Pack registry. Duplicate IDs, entrypoint drift, unsupported statuses, version mismatch, and incomplete result envelopes fail before Core can consume a result. Six manifests are currently registered, including the composite gate.

Implemented slice:

- `china-arrival-plan` `0.1.0`: orders seven required supporting results against one Plan ID/version, preserves their identity, status, recommendations, sources, and warnings, and blocks while two planned Skills are absent. It does not promote state or action proposals yet.
- `local-food-guide` `0.1.0`: converts up to five traceable official-source food facts into bilingual Plan-time orientation, without selecting a restaurant or creating an action proposal.
- `food-nearby` `0.1.0`: deterministic, bounded transformation of current Amap nearby-place facts into a structured Skill result and external-handoff proposals. Runtime code is exported only through the complete `@c-assistant/china-country-pack` package.
- `housing-area-recommendation` `0.1.0`: first access-oriented slice that explains accommodation candidates relative to a selected Plan anchor. It does not claim a complete neighborhood recommendation until multi-anchor routes and preferences exist.
- `transport-planner` `0.1.0`: chooses a preliminary Plan transport mode from normalized Amap route facts and confirmed Plan context. It has no fixed walking-distance threshold and leaves every Amap handoff incomplete until the user confirms otherwise.
- `weather-and-packing` `0.1.0`: turns normalized QWeather observations and short forecasts into source-bound rain, warmth, heat, and UV packing prompts. Reminder-date guidance uses only an exact date match.
- `policy-applicability` `0.1.0`: checks whether minimized user/Plan facts and a current approved NIA evidence snapshot are ready for separate review. It does not read policy text or decide eligibility.
