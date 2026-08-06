# Server

The first local Core HTTP service. It initializes local SQLite storage, exposes a Workspace API, accepts a natural-language Plan request, and records a Plan confirmation.

Current endpoints:

- `GET /health`
- `GET /api/workspace`
- `POST /api/plans/:planId/confirm`
- `POST /api/plans`
- `POST /api/plans/generate`
- `PUT /api/profile`
- `GET /api/runtimes/codex`
- `GET /api/connectors/amap`
- `GET /api/connectors/qweather`
- `GET /api/weather?location=<city-or-region>&language=en|zh`
- `GET /api/connectors/telegram`
- `POST /api/connectors/telegram/verify`

Profile and Plan state persist locally. `POST /api/plans/generate` uses the locally logged-in Codex CLI only after an explicit user request and returns a schema-validated draft. The weather route uses Amap geocoding followed by QWeather's current and three-day facts; it does not create a reminder or change a Plan. The Telegram verification route only calls the Bot API after the user explicitly presses Verify in the Web workspace; it does not pair chats or send messages. Scheduling, Telegram pairing, official sources, Claude Code, and external action handoffs beyond Amap routing remain unimplemented.
