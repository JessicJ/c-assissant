# Server

The first local Core HTTP service. It exposes a health check, a demo workspace, and a Plan confirmation endpoint.

Current endpoints:

- `GET /health`
- `GET /api/workspace`
- `POST /api/plans/:planId/confirm`

The state is in memory and resets on restart. SQLite, scheduling, Telegram, Amap, official sources, and Agent runtimes are deliberately not connected yet.
