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

Implemented slice:

- `food-nearby` `0.1.0`: deterministic, bounded transformation of current Amap nearby-place facts into a structured Skill result and external-handoff proposals. Runtime code is exported only through the complete `@c-assistant/china-country-pack` package.
- `housing-area-recommendation` `0.1.0`: first access-oriented slice that explains accommodation candidates relative to a selected Plan anchor. It does not claim a complete neighborhood recommendation until multi-anchor routes and preferences exist.
