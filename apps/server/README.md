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

Profile and Plan state persist locally. `POST /api/plans/generate` uses the locally logged-in Codex CLI only after an explicit user request and returns a schema-validated draft. Scheduling, Telegram, official sources, Claude Code, and external action handoffs remain unimplemented.
