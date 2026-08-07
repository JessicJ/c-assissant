# Server

The first local Core HTTP service. It initializes local SQLite storage, exposes a Workspace API, accepts a natural-language Plan request, and records a Plan confirmation.

Current endpoints:

- `GET /health`
- `GET /api/workspace`
- `POST /api/plans/:planId/confirm`
- `PUT /api/plans/:planId/accommodation`
- `PUT /api/plans/:planId/transport-preference`
- `PUT /api/plans/:planId/travel-context`
- `PUT /api/plans/:planId/arrival`
- `POST /api/plans`
- `POST /api/plans/generate`
- `PUT /api/profile`
- `GET /api/runtimes`, `GET /api/runtimes/codex`, `GET /api/runtimes/claude-code`
- `PUT /api/runtime`
- `GET /api/official-sources`
- `POST /api/official-sources/:sourceId/refresh`
- `GET /api/connectors/amap`
- `GET /api/connectors/qweather`
- `GET /api/runs/task-reminders` for minimized local Reminder Run audit records
- `GET /api/weather?location=<city-or-region>&language=en|zh`
- `GET /api/amap/places?query=<place>&region=<optional-region>`
- `GET /api/amap/nearby/restaurants?location=<longitude,latitude>`
- `GET /api/amap/nearby/accommodation?location=<longitude,latitude>`
- `GET /api/amap/routes/driving?origin=<longitude,latitude>&destination=<longitude,latitude>`
- `GET /api/amap/routes/walking?origin=<longitude,latitude>&destination=<longitude,latitude>`
- `GET /api/amap/routes/transit?origin=<longitude,latitude>&destination=<longitude,latitude>&originCityCode=<amap-city-code>&destinationCityCode=<amap-city-code>`
- `POST /api/plans/:planId/accommodation/manual` with `{ name, address, status }` to resolve a user-entered stay address before saving it to that Plan
- `POST /api/plans/:planId/tasks/:taskId/reminder/cancel` to remove one proposed or active Task reminder from the current Plan
- `GET /api/connectors/telegram`
- `POST /api/connectors/telegram/verify`

Profile, selected runtime type, source snapshots, and Plan state persist locally. A selected Amap accommodation can be saved as a Plan-scoped candidate and, after the user explicitly confirms a completed external booking, marked as confirmed; each change increments the Plan version. The Plan also stores an optional local expected-arrival time and time zone, transport preference, party/luggage context, and structured Task reminder proposals. A Task reminder is inert in a draft; after Plan activation, the Server attempts Telegram delivery at its exact zoned time or within a 30-minute restart catch-up window. Retryable failures use one-minute and five-minute backoff, with at most three attempts; terminal failure and success are mirrored to Web Inbox, and attempts are persistently deduplicated. Cancelling a reminder removes it from the current Plan and increments the Plan version. Every delivery claim rechecks the current Plan and exact reminder content, including its dynamic-fact policy, so a cancelled, changed, or superseded reminder cannot start a stale attempt. After a claim, the Server resolves the current Plan location through Amap and refreshes QWeather only when the reminder explicitly declares `refreshFacts: ["weather"]`; absent or empty declarations make no weather call. An exact-date forecast is appended with retrieval time, attribution, and conservative rain/temperature/UV guidance; if either provider is unavailable, the original reminder still sends without weather. Weather snapshots used here are delivery-time context and are not persisted. One minimized Task Reminder Run spans all retry attempts and retains only identifiers, due/start/finish times, attempt count, weather availability/failure classification, Telegram failure classification, and final state. It stores no message copy, weather response, coordinate, account identity, or credential. `POST /api/plans/generate` uses the selected locally logged-in Codex or Claude Code CLI only after an explicit user request and returns a schema-validated draft. `GET /api/official-sources` only lists the Country Pack allowlist; an explicit `POST /api/official-sources/:sourceId/refresh` may fetch that one approved source and persist/compare its evidence snapshot, without reaching a policy conclusion. The weather route uses Amap geocoding followed by QWeather's current and three-day facts; it does not create a reminder or change a Plan. Nearby restaurant and accommodation discovery return Amap POI and distance facts around a user-selected Plan location; they do not rank, order, reserve, or pay. The Telegram verification route only calls the Bot API after the user explicitly presses Verify in the Web workspace; it does not pair chats or send messages. External action handoffs beyond Amap routing remain unimplemented.
