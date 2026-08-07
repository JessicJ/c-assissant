# China Country Pack

The first regional capability pack for C-assistant. V1 covers arrival preparation and an initial food, accommodation-area, and transport experience.

The pack is installed and versioned as one public unit. Its Skills remain independent internal modules so they can be tested, composed, and evolved safely.

The first executable internal module is `food-nearby` `0.1.0`. Server invokes it after Amap returns normalized nearby POI facts; the Skill emits a bounded structured result while Telegram remains only a renderer and action-handoff surface. Individual Skill installation is still disabled.

`housing-area-recommendation` `0.1.0` adds the first access-oriented accommodation comparison to Web. It explains nearby stay candidates relative to a user-selected Plan anchor, while explicitly deferring full area choice until route facts and preferences are available.

See [China Country Pack V1](../../docs/china-pack-v1.md).
