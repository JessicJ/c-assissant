# Server

The first local Core HTTP service. It initializes local SQLite storage, exposes a Workspace API, accepts a natural-language Plan request, and records a Plan confirmation.

Current endpoints:

- `GET /health`
- `GET /api/workspace`
- `POST /api/plans/:planId/confirm`
- `POST /api/plans`
- `PUT /api/profile`

Profile and Plan state persist locally. Scheduling, Telegram, Amap, official sources, and Agent runtimes are deliberately not connected yet.
